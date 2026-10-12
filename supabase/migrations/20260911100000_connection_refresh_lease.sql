-- ═════════════════════════════════════════════════════════════════════════════
-- Replace the refresh "lock" with a lease that actually holds.
--
-- try_lock_connection_refresh() took pg_try_advisory_xact_lock. The app calls it
-- as a standalone RPC through PostgREST, and every PostgREST call is its own
-- transaction -- so the lock was released the moment the RPC returned, before
-- the provider refresh it was meant to guard had started. Two concurrent health
-- checks both refreshed. Where the provider rotates refresh tokens on use
-- (Google, X), the loser's token is already invalid, so the connection broke
-- precisely because it was refreshed twice.
--
-- A lease is a value on the row with an expiry. It survives the RPC's
-- transaction ending and needs no open session to hold it, and it expires on
-- its own, so a crashed worker cannot wedge a connection: the worst case is one
-- skipped refresh until the lease runs out.
--
-- Same name and signature as before, so existing callers keep working and now
-- get a lock that holds. release_connection_refresh() ends it early.
--
-- The state-model trigger fires only on UPDATE OF connection_state, so writing
-- the lease does not touch it.
--
-- Safe to run twice.
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.social_accounts
  ADD COLUMN IF NOT EXISTS refresh_locked_until timestamptz;

COMMENT ON COLUMN public.social_accounts.refresh_locked_until IS
  'Refresh lease. Set by try_lock_connection_refresh(), cleared by release_connection_refresh(); expires on its own.';

-- Claims the lease if it is free or has expired. Returns true to exactly one
-- caller: the conditional UPDATE is atomic, so two concurrent claims cannot
-- both match the row.
CREATE OR REPLACE FUNCTION public.try_lock_connection_refresh(_account_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
  _claimed uuid;
BEGIN
  UPDATE public.social_accounts
     SET refresh_locked_until = now() + interval '90 seconds'
   WHERE id = _account_id
     AND (refresh_locked_until IS NULL OR refresh_locked_until < now())
  RETURNING id INTO _claimed;
  RETURN _claimed IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_connection_refresh(_account_id uuid)
RETURNS void
LANGUAGE sql
VOLATILE
SET search_path = public
AS $$
  UPDATE public.social_accounts
     SET refresh_locked_until = NULL
   WHERE id = _account_id;
$$;

REVOKE ALL ON FUNCTION public.try_lock_connection_refresh(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_lock_connection_refresh(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.release_connection_refresh(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_connection_refresh(uuid) TO service_role;

-- ─── Sanity checks ───────────────────────────────────────────────────────────
-- Two claims, one winner; the lease survives the first call's transaction:
--   SELECT public.try_lock_connection_refresh('<account-uuid>');  -- true
--   SELECT public.try_lock_connection_refresh('<account-uuid>');  -- false
--   SELECT public.release_connection_refresh('<account-uuid>');
--   SELECT public.try_lock_connection_refresh('<account-uuid>');  -- true
