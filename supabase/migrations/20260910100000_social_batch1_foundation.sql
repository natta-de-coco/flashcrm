-- ═════════════════════════════════════════════════════════════════════════════
-- Social Integration Release Gate — Batch 1 foundation.
--
-- Additive except where a section says otherwise. Every section was written
-- against a verified finding in docs/social/BATCH1-FINDINGS.md.
--
--   §1  Token, refresh-lease and observability columns on social_accounts
--   §2  Clients can no longer write tokens, or touch oauth_states at all
--   §3  The 13-state connection model
--   §4  An atomic refresh lease (replaces a lock that never held)
--   §5  Child rows cannot point at another workspace's account
--   §6  One account per (tenant, platform, external_id)
--   §7  The expiry sweep also times out stuck authorizations
--
-- Idempotent. Safe to re-run. Rollback at the bottom.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── §1 Columns ───────────────────────────────────────────────────────────────
-- Encrypted tokens sit beside the plaintext columns during the migration
-- window; the application encrypts, verifies a decrypt, then NULLs plaintext.
-- The plaintext columns are dropped in a later migration, after verification.
ALTER TABLE public.social_accounts
  ADD COLUMN IF NOT EXISTS access_token_enc           text,
  ADD COLUMN IF NOT EXISTS refresh_token_enc          text,
  ADD COLUMN IF NOT EXISTS token_key_id               text,
  ADD COLUMN IF NOT EXISTS refresh_lease_id           uuid,
  ADD COLUMN IF NOT EXISTS refresh_leased_until       timestamptz,
  ADD COLUMN IF NOT EXISTS last_refresh_attempt_at    timestamptz,
  ADD COLUMN IF NOT EXISTS last_refresh_success_at    timestamptz,
  ADD COLUMN IF NOT EXISTS refresh_failure_reason     text,
  ADD COLUMN IF NOT EXISTS last_validation_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_validation_success_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_attempt_at       timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_success_at       timestamptz,
  ADD COLUMN IF NOT EXISTS missing_scopes             text[],
  ADD COLUMN IF NOT EXISTS legacy_manual_connection   boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.social_accounts.last_validation_success_at IS
  'Last time a live provider call proved the token works. A connection that has '
  'never had one is "Not yet verified", never "Healthy" -- a recent sync alone '
  'does not count.';
COMMENT ON COLUMN public.social_accounts.legacy_manual_connection IS
  'Added with a pasted token before Batch 1. Kept, not deleted; treated as '
  'unverified until a live validation succeeds.';

-- Pasted-token rows are marked rather than deleted.
UPDATE public.social_accounts
   SET legacy_manual_connection = true
 WHERE connect_method = 'manual' AND legacy_manual_connection = false;

-- ── §2 Grants ────────────────────────────────────────────────────────────────
-- 20260824 granted authenticated INSERT and UPDATE on access_token. Removing
-- the paste-a-token form did not remove that: any workspace member could still
-- write a token straight through the REST API. Every write to this table now
-- goes through a server function using the service role.
--
-- Column-level privileges are revoked explicitly. A table-level REVOKE does not
-- remove a column-level GRANT made separately, so relying on one would leave
-- exactly the privileges this section exists to remove.
REVOKE INSERT (platform, label, external_id, access_token, active)
  ON public.social_accounts FROM authenticated;
REVOKE UPDATE (platform, label, external_id, access_token, active, last_synced_at)
  ON public.social_accounts FROM authenticated;
REVOKE INSERT (profile, permissions, token_expires_at, profile_url, health, connect_method)
  ON public.social_accounts FROM authenticated;
REVOKE UPDATE (profile, permissions, token_expires_at, profile_url, last_post_at,
               last_analytics_sync_at, health, connect_method)
  ON public.social_accounts FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.social_accounts FROM authenticated;

-- Safe observability columns are readable by the workspace (RLS still limits
-- rows to the caller's tenant). None of these hold a secret; the two reason
-- columns are written only through redactSecrets().
GRANT SELECT (connection_state, state_reason, state_changed_at, granted_scopes,
              missing_scopes, legacy_manual_connection,
              last_validation_attempt_at, last_validation_success_at,
              last_sync_attempt_at, last_sync_success_at,
              last_refresh_attempt_at, last_refresh_success_at, refresh_failure_reason)
  ON public.social_accounts TO authenticated;
-- access_token_enc, refresh_token_enc, token_key_id, refresh_lease_id and
-- refresh_leased_until are deliberately NOT granted.

-- oauth_states is server-only. It was readable by every member of the tenant,
-- including code_verifier. Every reader already uses the service role.
ALTER TABLE public.oauth_states ADD COLUMN IF NOT EXISTS provider text;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.oauth_states FROM authenticated;

-- ── §3 The 13-state model ────────────────────────────────────────────────────
ALTER TABLE public.social_accounts
  DROP CONSTRAINT IF EXISTS social_accounts_connection_state_check;
ALTER TABLE public.social_accounts
  ADD CONSTRAINT social_accounts_connection_state_check CHECK (connection_state IN (
    'not_configured', 'missing_app_credentials', 'ready_to_authorize',
    'authorization_started', 'authorization_cancelled', 'callback_error',
    'scope_incomplete', 'connected', 'token_expiring', 'refresh_failed',
    'revoked', 'disconnected', 'provider_unavailable'
  ));

-- Mirrors TRANSITIONS in src/lib/connection-state.ts; tests assert they agree.
--
-- Changes from 20260908100000:
--   + the three authorization states and their edges
--   + connected/scope_incomplete -> refresh_failed. Without it, a health check
--     that failed to refresh a connected account had its whole UPDATE rejected
--     by the trigger, losing the error, retry count and backoff with it.
--   - disconnected -> connected and revoked -> connected. Returning to
--     connected now requires a fresh authorization (authorization_started).
--   + every state -> disconnected. A customer must always be able to unplug.
CREATE OR REPLACE FUNCTION public.is_legal_connection_transition(_from text, _to text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT _from = _to OR (_from, _to) IN (
    ('not_configured','missing_app_credentials'), ('not_configured','ready_to_authorize'),
    ('not_configured','authorization_started'),   ('not_configured','connected'),
    ('not_configured','scope_incomplete'),        ('not_configured','token_expiring'),
    ('not_configured','disconnected'),
    ('missing_app_credentials','ready_to_authorize'), ('missing_app_credentials','not_configured'),
    ('missing_app_credentials','disconnected'),
    ('ready_to_authorize','authorization_started'), ('ready_to_authorize','missing_app_credentials'),
    ('ready_to_authorize','connected'),             ('ready_to_authorize','scope_incomplete'),
    ('ready_to_authorize','token_expiring'),        ('ready_to_authorize','disconnected'),
    ('authorization_started','authorization_cancelled'), ('authorization_started','callback_error'),
    ('authorization_started','scope_incomplete'),        ('authorization_started','connected'),
    ('authorization_started','token_expiring'),        ('authorization_started','disconnected'),
    ('authorization_cancelled','authorization_started'), ('authorization_cancelled','ready_to_authorize'),
    ('authorization_cancelled','disconnected'),
    ('callback_error','authorization_started'), ('callback_error','ready_to_authorize'),
    ('callback_error','disconnected'),
    ('connected','scope_incomplete'), ('connected','token_expiring'), ('connected','refresh_failed'),
    ('connected','revoked'),          ('connected','disconnected'),   ('connected','provider_unavailable'),
    ('scope_incomplete','connected'),       ('scope_incomplete','token_expiring'),
    ('scope_incomplete','refresh_failed'),  ('scope_incomplete','revoked'),
    ('scope_incomplete','disconnected'),    ('scope_incomplete','provider_unavailable'),
    ('scope_incomplete','authorization_started'),
    ('token_expiring','connected'), ('token_expiring','scope_incomplete'), ('token_expiring','refresh_failed'),
    ('token_expiring','revoked'),   ('token_expiring','disconnected'),     ('token_expiring','provider_unavailable'),
    ('refresh_failed','connected'), ('refresh_failed','token_expiring'),   ('refresh_failed','revoked'),
    ('refresh_failed','disconnected'), ('refresh_failed','provider_unavailable'),
    ('refresh_failed','authorization_started'),
    -- An outage resolves back to what it interrupted, and never to a state that
    -- discards the token (so never to revoked).
    ('provider_unavailable','connected'),      ('provider_unavailable','token_expiring'),
    ('provider_unavailable','scope_incomplete'), ('provider_unavailable','refresh_failed'),
    ('provider_unavailable','disconnected'),
    ('revoked','authorization_started'), ('revoked','ready_to_authorize'), ('revoked','disconnected'),
    ('disconnected','ready_to_authorize')
  );
$$;

-- ── §4 Refresh lease ─────────────────────────────────────────────────────────
-- try_lock_connection_refresh() took a transaction-scoped advisory lock. Called
-- through PostgREST, each RPC is its own transaction, so the lock was released
-- when the call returned -- before the provider request it was meant to guard.
-- Two concurrent refreshes still both reached the provider.
--
-- A lease is a row value, so it outlives the RPC, and it expires on its own if
-- the worker holding it dies. Acquisition is a single UPDATE whose WHERE clause
-- is re-checked after the row lock is taken, so two callers cannot both win.
CREATE OR REPLACE FUNCTION public.acquire_connection_refresh_lease(
  _account_id uuid, _tenant_id uuid, _lease_seconds integer DEFAULT 60
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _lease uuid := gen_random_uuid();
BEGIN
  UPDATE public.social_accounts
     SET refresh_lease_id        = _lease,
         refresh_leased_until    = now() + make_interval(secs => GREATEST(5, LEAST(_lease_seconds, 600))),
         last_refresh_attempt_at = now()
   WHERE id = _account_id
     AND tenant_id = _tenant_id
     AND (refresh_leased_until IS NULL OR refresh_leased_until < now());
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN _lease;
END; $$;

CREATE OR REPLACE FUNCTION public.release_connection_refresh_lease(
  _account_id uuid, _tenant_id uuid, _lease_id uuid
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Only the holder may release, so a slow worker whose lease already expired
  -- cannot clear a lease a newer worker now holds.
  UPDATE public.social_accounts
     SET refresh_lease_id = NULL, refresh_leased_until = NULL
   WHERE id = _account_id AND tenant_id = _tenant_id AND refresh_lease_id = _lease_id;
  RETURN FOUND;
END; $$;

REVOKE ALL ON FUNCTION public.acquire_connection_refresh_lease(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_connection_refresh_lease(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_connection_refresh_lease(uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_connection_refresh_lease(uuid, uuid, uuid) TO service_role;

DROP FUNCTION IF EXISTS public.try_lock_connection_refresh(uuid);

-- ── §5 Parent-child tenant consistency ───────────────────────────────────────
-- RLS checks a child row's own tenant_id, not whether the account it points at
-- is in the same tenant. A row carrying Workspace A's tenant_id and Workspace
-- B's account_id passed every policy. The database now refuses it.
--
-- SECURITY DEFINER so the check reads the truth: under the caller's RLS the
-- other tenant's account is invisible, which would also refuse -- but for the
-- wrong reason, and a service-role writer would not be checked at all.
CREATE OR REPLACE FUNCTION public.enforce_social_child_tenant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.account_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.social_accounts a
     WHERE a.id = NEW.account_id AND a.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'social account % does not belong to tenant %', NEW.account_id, NEW.tenant_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.enforce_social_test_result_tenant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.social_connection_tests t
     WHERE t.id = NEW.test_id AND t.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'connection test % does not belong to tenant %', NEW.test_id, NEW.tenant_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

DO $$
DECLARE _t text;
BEGIN
  FOREACH _t IN ARRAY ARRAY[
    'social_posts', 'social_interactions', 'social_capabilities', 'social_connection_tests',
    'integration_errors', 'connection_retry_log', 'social_account_scans'
  ] LOOP
    IF to_regclass('public.' || _t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', _t || '_tenant_match', _t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF tenant_id, account_id ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.enforce_social_child_tenant()',
      _t || '_tenant_match', _t);
  END LOOP;

  IF to_regclass('public.social_test_results') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS social_test_results_tenant_match ON public.social_test_results;
    CREATE TRIGGER social_test_results_tenant_match
      BEFORE INSERT OR UPDATE OF tenant_id, test_id ON public.social_test_results
      FOR EACH ROW EXECUTE FUNCTION public.enforce_social_test_result_tenant();
  END IF;
END $$;

-- ── §6 Duplicate connections ─────────────────────────────────────────────────
-- Refuse loudly rather than let CREATE UNIQUE INDEX fail with a generic error.
DO $$
DECLARE _dups integer;
BEGIN
  SELECT count(*) INTO _dups FROM (
    SELECT 1 FROM public.social_accounts
     WHERE external_id IS NOT NULL
     GROUP BY tenant_id, platform, external_id HAVING count(*) > 1
  ) d;
  IF _dups > 0 THEN
    RAISE EXCEPTION
      '% duplicate (tenant, platform, external_id) group(s) in social_accounts. Resolve them, then re-run.',
      _dups;
  END IF;
END $$;

-- Per tenant only. The same Page connected in two workspaces is legitimate when
-- the provider grants both; what must never happen is one tenant's row being
-- reused for another, which the tenant_id in the key prevents.
CREATE UNIQUE INDEX IF NOT EXISTS social_accounts_tenant_platform_external_key
  ON public.social_accounts (tenant_id, platform, external_id)
  WHERE external_id IS NOT NULL;

-- ── §7 Sweep ─────────────────────────────────────────────────────────────────
-- The return type changes, so the function must be dropped first.
DROP FUNCTION IF EXISTS public.expire_abandoned_oauth_attempts();
CREATE FUNCTION public.expire_abandoned_oauth_attempts()
RETURNS TABLE(expired_count integer, deleted_count integer, cancelled_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _expired integer; _deleted integer; _cancelled integer;
BEGIN
  UPDATE public.oauth_states
     SET attempt_state = 'expired',
         attempt_reason = 'oauth_state_expired'
   WHERE attempt_state = 'started' AND used_at IS NULL AND expires_at < now();
  GET DIAGNOSTICS _expired = ROW_COUNT;

  -- A connection cannot stay "authorization_started" for ever. States live 15
  -- minutes, so anything older than that is an authorization nobody finished.
  UPDATE public.social_accounts
     SET connection_state = 'authorization_cancelled',
         state_reason = 'oauth_state_expired: the consent screen was not completed in time'
   WHERE connection_state = 'authorization_started'
     AND state_changed_at < now() - interval '15 minutes';
  GET DIAGNOSTICS _cancelled = ROW_COUNT;

  DELETE FROM public.oauth_states
   WHERE attempt_state IN ('expired', 'completed', 'cancelled', 'callback_error')
     AND COALESCE(used_at, expires_at) < now() - interval '1 day';
  GET DIAGNOSTICS _deleted = ROW_COUNT;

  RETURN QUERY SELECT _expired, _deleted, _cancelled;
END; $$;
REVOKE ALL ON FUNCTION public.expire_abandoned_oauth_attempts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_abandoned_oauth_attempts() TO service_role;

COMMIT;

-- ─── Rollback ────────────────────────────────────────────────────────────────
-- Run in this order. Nothing here deletes data.
--
-- BEGIN;
--   -- §7: restore the two-column sweep from 20260908100000 (re-run that file's
--   --     §5 block after dropping this one).
--   DROP FUNCTION IF EXISTS public.expire_abandoned_oauth_attempts();
--   -- §6
--   DROP INDEX IF EXISTS public.social_accounts_tenant_platform_external_key;
--   -- §5
--   DROP TRIGGER IF EXISTS social_posts_tenant_match            ON public.social_posts;
--   DROP TRIGGER IF EXISTS social_interactions_tenant_match     ON public.social_interactions;
--   DROP TRIGGER IF EXISTS social_capabilities_tenant_match     ON public.social_capabilities;
--   DROP TRIGGER IF EXISTS social_connection_tests_tenant_match ON public.social_connection_tests;
--   DROP TRIGGER IF EXISTS integration_errors_tenant_match      ON public.integration_errors;
--   DROP TRIGGER IF EXISTS connection_retry_log_tenant_match    ON public.connection_retry_log;
--   DROP TRIGGER IF EXISTS social_account_scans_tenant_match    ON public.social_account_scans;
--   DROP TRIGGER IF EXISTS social_test_results_tenant_match     ON public.social_test_results;
--   DROP FUNCTION IF EXISTS public.enforce_social_child_tenant();
--   DROP FUNCTION IF EXISTS public.enforce_social_test_result_tenant();
--   -- §4: re-run 20260909100000 §3 to restore try_lock_connection_refresh.
--   DROP FUNCTION IF EXISTS public.acquire_connection_refresh_lease(uuid, uuid, integer);
--   DROP FUNCTION IF EXISTS public.release_connection_refresh_lease(uuid, uuid, uuid);
--   -- §3: re-run 20260908100000 §§2 and 6. First move any row in a new state:
--   UPDATE public.social_accounts SET connection_state = 'ready_to_authorize'
--    WHERE connection_state IN ('authorization_started','authorization_cancelled','callback_error');
--   -- §2: grants are only restored if the application is also rolled back.
--   GRANT SELECT, INSERT ON public.oauth_states TO authenticated;
--   GRANT DELETE ON public.social_accounts TO authenticated;
--   -- §1: columns are additive and inert without the code; leave them. If
--   --     tokens were already migrated to *_enc, DO NOT drop those columns
--   --     until plaintext has been restored by the application.
-- COMMIT;

-- ─── Sanity checks ───────────────────────────────────────────────────────────
--   SELECT has_column_privilege('authenticated','public.social_accounts','access_token','UPDATE');   -- false
--   SELECT has_column_privilege('authenticated','public.social_accounts','access_token_enc','SELECT'); -- false
--   SELECT has_table_privilege('authenticated','public.oauth_states','SELECT');                        -- false
--   SELECT public.is_legal_connection_transition('disconnected','connected');                          -- false
--   SELECT public.is_legal_connection_transition('connected','refresh_failed');                        -- true
