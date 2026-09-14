ALTER TABLE public.social_accounts
  ADD COLUMN IF NOT EXISTS refresh_locked_until timestamptz;

COMMENT ON COLUMN public.social_accounts.refresh_locked_until IS
  'Refresh lease. Set by try_lock_connection_refresh(), cleared by release_connection_refresh(); expires on its own.';

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