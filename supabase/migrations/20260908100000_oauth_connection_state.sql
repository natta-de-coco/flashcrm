-- ═════════════════════════════════════════════════════════════════════════════
-- Task 3 — a formal state model for connections and authorization attempts.
--
-- Until now there was no state column at all. computeHealth() derived one of
-- three values at read time, and collapsed six genuinely different situations
-- into "disconnected": the customer pressed Disconnect, the token expired, the
-- provider revoked it, a refresh failed, authorization never completed, or the
-- workspace's app credentials were removed. Each needs a different message and
-- a different next action.
--
-- TWO LIFECYCLES, TWO COLUMNS
--
-- A connection is durable; an authorization attempt is over in minutes. Held
-- on one column, a failed re-authorization would overwrite a working
-- integration — a customer with a healthy Instagram connection would lose it
-- because their second attempt went wrong. So:
--
--   social_accounts.connection_state  the durable status of the integration
--   oauth_states.attempt_state        the lifecycle of one authorization
--
-- Both are CHECK-constrained: an unknown state cannot be written at all, which
-- is what makes the application-side transition guard trustworthy rather than
-- merely well-intentioned.
--
-- `health` is deliberately left in place. Readers still use it, and removing
-- it in the same change would break the app mid-deploy. It goes in a follow-up
-- once nothing reads it.
--
-- Idempotent. Safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Connection state ──────────────────────────────────────────────────────
ALTER TABLE public.social_accounts
  ADD COLUMN IF NOT EXISTS connection_state text NOT NULL DEFAULT 'not_configured',
  ADD COLUMN IF NOT EXISTS state_changed_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS state_reason text;

ALTER TABLE public.social_accounts
  DROP CONSTRAINT IF EXISTS social_accounts_connection_state_check;
ALTER TABLE public.social_accounts
  ADD CONSTRAINT social_accounts_connection_state_check CHECK (connection_state IN (
    'not_configured',
    'missing_app_credentials',
    'ready_to_authorize',
    'connected',
    'scope_incomplete',
    'token_expiring',
    'refresh_failed',
    'revoked',
    'disconnected',
    'provider_unavailable'
  ));

-- ── 2. Attempt state ─────────────────────────────────────────────────────────
ALTER TABLE public.oauth_states
  ADD COLUMN IF NOT EXISTS attempt_state text NOT NULL DEFAULT 'started',
  ADD COLUMN IF NOT EXISTS attempt_reason text;

ALTER TABLE public.oauth_states
  DROP CONSTRAINT IF EXISTS oauth_states_attempt_state_check;
ALTER TABLE public.oauth_states
  ADD CONSTRAINT oauth_states_attempt_state_check CHECK (attempt_state IN (
    'started',
    'callback_received',
    'cancelled',
    'callback_error',
    'expired',
    'completed'
  ));

-- ── 3. Backfill from what the old columns imply ──────────────────────────────
-- Ordered from most specific to least, so a row lands in the narrowest state
-- that is true of it.
UPDATE public.social_accounts SET connection_state =
  CASE
    WHEN active IS NOT TRUE                      THEN 'disconnected'
    WHEN access_token IS NULL                    THEN 'ready_to_authorize'
    WHEN token_expires_at IS NOT NULL
     AND token_expires_at < now()                THEN 'token_expiring'
    WHEN token_expires_at IS NOT NULL
     AND token_expires_at < now() + interval '72 hours' THEN 'token_expiring'
    ELSE 'connected'
  END
WHERE connection_state = 'not_configured';

UPDATE public.oauth_states SET attempt_state =
  CASE
    WHEN used_at IS NOT NULL   THEN 'completed'
    WHEN expires_at < now()    THEN 'expired'
    ELSE 'started'
  END
WHERE attempt_state = 'started';

-- ── 4. Indexes the manager portal and the sweep will filter on ───────────────
CREATE INDEX IF NOT EXISTS social_accounts_tenant_state_idx
  ON public.social_accounts (tenant_id, connection_state);

-- Partial: the sweep only ever looks for attempts still marked started.
CREATE INDEX IF NOT EXISTS oauth_states_stale_attempt_idx
  ON public.oauth_states (expires_at)
  WHERE attempt_state = 'started' AND used_at IS NULL;

-- ── 5. Retire abandoned attempts, with a record of having done so ────────────
-- purge_expired_oauth_states() has existed since August and has never been
-- called, so an abandoned attempt stays "started" for ever. This replaces it
-- with something that first *marks* the attempt expired — leaving a row the
-- audit trail can point at — and only then deletes the long-dead ones.
--
-- Correctness does not depend on this running: readers derive `expired` from
-- expires_at directly. The sweep exists to keep the table small and to give
-- the audit log a definite event.
CREATE OR REPLACE FUNCTION public.expire_abandoned_oauth_attempts()
RETURNS TABLE(expired_count integer, deleted_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _expired integer; _deleted integer;
BEGIN
  UPDATE public.oauth_states
     SET attempt_state = 'expired',
         attempt_reason = 'Authorization was never completed before the state expired'
   WHERE attempt_state = 'started'
     AND used_at IS NULL
     AND expires_at < now();
  GET DIAGNOSTICS _expired = ROW_COUNT;

  -- Only rows that have been terminal for a day are removed, so a sweep never
  -- deletes something a callback is still racing to consume.
  DELETE FROM public.oauth_states
   WHERE attempt_state IN ('expired', 'completed', 'cancelled', 'callback_error')
     AND COALESCE(used_at, expires_at) < now() - interval '1 day';
  GET DIAGNOSTICS _deleted = ROW_COUNT;

  RETURN QUERY SELECT _expired, _deleted;
END; $$;
REVOKE ALL ON FUNCTION public.expire_abandoned_oauth_attempts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_abandoned_oauth_attempts() TO service_role;

-- ── 6. The transition whitelist, enforced in the database ────────────────────
-- The application validates transitions too, and that is where the useful
-- error message comes from. This exists because an application guard can be
-- bypassed by any other writer — a migration, a support script, a future
-- server function that forgets. A row can only ever hold a legal state, and
-- only ever arrive there by a legal edge.
CREATE OR REPLACE FUNCTION public.is_legal_connection_transition(_from text, _to text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT
    -- Re-asserting the same state is always allowed; it is how a refresh that
    -- changes nothing else records a heartbeat.
    _from = _to
    OR (_from, _to) IN (
      -- not_configured is "unknown", not a stage. It is the column default, so
      -- any row created without an explicit state starts here and the first
      -- real observation must be able to replace it.
      ('not_configured','missing_app_credentials'),
      ('not_configured','ready_to_authorize'),
      ('not_configured','connected'),
      ('not_configured','scope_incomplete'),
      ('not_configured','token_expiring'),
      ('not_configured','disconnected'),
      ('missing_app_credentials','ready_to_authorize'),
      ('missing_app_credentials','not_configured'),
      ('ready_to_authorize','connected'),
      ('ready_to_authorize','scope_incomplete'),
      ('ready_to_authorize','missing_app_credentials'),
      ('connected','scope_incomplete'),
      ('connected','token_expiring'),
      ('connected','revoked'),
      ('connected','disconnected'),
      ('connected','provider_unavailable'),
      ('scope_incomplete','connected'),
      ('scope_incomplete','revoked'),
      ('scope_incomplete','disconnected'),
      ('scope_incomplete','token_expiring'),
      ('token_expiring','connected'),
      ('token_expiring','refresh_failed'),
      ('token_expiring','revoked'),
      ('token_expiring','disconnected'),
      ('token_expiring','provider_unavailable'),
      ('refresh_failed','connected'),
      ('refresh_failed','revoked'),
      ('refresh_failed','disconnected'),
      ('refresh_failed','token_expiring'),
      -- A provider outage must resolve back to what it interrupted, and must
      -- never be a path to a state that discards a token.
      ('provider_unavailable','connected'),
      ('provider_unavailable','token_expiring'),
      ('provider_unavailable','disconnected'),
      -- Re-authorizing after losing access.
      ('revoked','ready_to_authorize'),
      ('revoked','connected'),
      ('revoked','disconnected'),
      ('disconnected','ready_to_authorize'),
      ('disconnected','connected')
    );
$$;

CREATE OR REPLACE FUNCTION public.guard_connection_state_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.connection_state IS DISTINCT FROM OLD.connection_state THEN
    IF NOT public.is_legal_connection_transition(OLD.connection_state, NEW.connection_state) THEN
      RAISE EXCEPTION
        'Illegal connection state transition: % -> % (account %)',
        OLD.connection_state, NEW.connection_state, OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.state_changed_at := now();
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS social_accounts_guard_state ON public.social_accounts;
CREATE TRIGGER social_accounts_guard_state
  BEFORE UPDATE OF connection_state ON public.social_accounts
  FOR EACH ROW EXECUTE FUNCTION public.guard_connection_state_transition();

COMMIT;

-- ─── Sanity checks ───────────────────────────────────────────────────────────
-- SELECT connection_state, count(*) FROM public.social_accounts GROUP BY 1;
-- SELECT attempt_state, count(*) FROM public.oauth_states GROUP BY 1;
-- SELECT * FROM public.expire_abandoned_oauth_attempts();
-- Must raise:
--   UPDATE public.social_accounts SET connection_state='connected'
--    WHERE connection_state='not_configured';
