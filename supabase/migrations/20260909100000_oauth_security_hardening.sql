-- ═════════════════════════════════════════════════════════════════════════════
-- Task 4 — OAuth security hardening.
--
-- Two changes, both about what happens if the database is read by someone who
-- should not be reading it.
--
-- 1. THE STATE TOKEN IS NO LONGER STORED
--
--    oauth_states.state held the live state value in plaintext. Anyone with
--    read access to that table during the fifteen minutes an authorization is
--    open could take a state, race the real user to the callback, and have the
--    resulting connection saved against the victim's workspace.
--
--    Only the SHA-256 of the state is stored now. The value itself exists in
--    the provider's redirect URL and nowhere else we control, so a database
--    read no longer yields anything usable.
--
--    In-flight authorizations at deploy time will fail and need retrying.
--    States live fifteen minutes, so the window is small, and the alternative
--    — writing both forms during a transition — would keep the plaintext this
--    change exists to remove.
--
-- 2. TOKEN REFRESH TAKES A LOCK
--
--    Two concurrent health checks on the same account both called the provider
--    to refresh, and the second's response overwrote the first. With providers
--    that rotate refresh tokens on use, the losing token is invalidated and the
--    connection breaks. try_lock_connection_refresh() serialises it.
--
-- Idempotent. Safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Hashed state ──────────────────────────────────────────────────────────
ALTER TABLE public.oauth_states
  ADD COLUMN IF NOT EXISTS state_hash text;

-- Backfill so in-flight rows written by the previous release remain
-- consumable through the hashed path for the rest of their fifteen minutes.
UPDATE public.oauth_states
   SET state_hash = encode(extensions.digest(state, 'sha256'), 'hex')
 WHERE state_hash IS NULL AND state IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS oauth_states_state_hash_key
  ON public.oauth_states (state_hash);

-- `state` becomes optional: new rows do not populate it at all.
ALTER TABLE public.oauth_states ALTER COLUMN state DROP NOT NULL;

COMMENT ON COLUMN public.oauth_states.state IS
  'Legacy plaintext state. New rows leave this NULL — only state_hash is stored. '
  'Drop this column once no row written by the previous release survives.';
COMMENT ON COLUMN public.oauth_states.state_hash IS
  'SHA-256 (hex) of the state value. The state itself is never stored.';

-- ── 2. Consumption by hash ───────────────────────────────────────────────────
-- Still a single UPDATE, so two concurrent callbacks presenting the same state
-- cannot both win: the second matches no row because used_at is already set.
CREATE OR REPLACE FUNCTION public.consume_oauth_state_hash(_state_hash text)
RETURNS TABLE (
  id text,
  tenant_id uuid,
  user_id uuid,
  platform text,
  redirect_uri text,
  code_verifier text
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  UPDATE public.oauth_states s
     SET used_at = now(),
         attempt_state = 'callback_received'
   WHERE s.state_hash = _state_hash
     AND s.used_at IS NULL
     AND s.expires_at > now()
  RETURNING s.state_hash, s.tenant_id, s.user_id, s.platform, s.redirect_uri, s.code_verifier;
END; $$;
REVOKE ALL ON FUNCTION public.consume_oauth_state_hash(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_oauth_state_hash(text) TO service_role;

-- ── 3. Refresh locking ───────────────────────────────────────────────────────
-- A transaction-scoped advisory lock keyed on the account id. Transaction
-- scope matters: a session lock leaked by a crashed request would block that
-- account's refreshes until the connection was recycled.
--
-- Returns false rather than waiting, so a caller that loses the race skips the
-- refresh instead of queueing behind it and then performing a second,
-- redundant one against the provider.
CREATE OR REPLACE FUNCTION public.try_lock_connection_refresh(_account_id uuid)
RETURNS boolean LANGUAGE sql VOLATILE SET search_path = public AS $$
  SELECT pg_try_advisory_xact_lock(
    -- A stable 64-bit key from the uuid. hashtextextended is deterministic
    -- across sessions, which a plain hashtext() on a cast is not guaranteed
    -- to be for this purpose.
    hashtextextended(_account_id::text, 0)
  );
$$;
REVOKE ALL ON FUNCTION public.try_lock_connection_refresh(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.try_lock_connection_refresh(uuid) TO service_role;

COMMIT;

-- ─── Sanity checks ───────────────────────────────────────────────────────────
-- New rows must carry a hash and no plaintext:
--   SELECT count(*) FILTER (WHERE state IS NOT NULL) AS legacy_plaintext,
--          count(*) FILTER (WHERE state_hash IS NULL) AS missing_hash
--     FROM public.oauth_states;
-- Consuming twice must return one row then none:
--   SELECT * FROM public.consume_oauth_state_hash('<hex>');
