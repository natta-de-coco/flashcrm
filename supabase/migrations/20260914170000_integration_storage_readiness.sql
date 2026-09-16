-- Read-only server preflight. No credentials or OAuth rows are returned.
BEGIN;
-- Reassert service-only entry points after the 20260914 permission repair.
-- OAuth callback handling uses the service role; browser RPC access is neither
-- needed nor safe for single-use state consumption and refresh leases.
REVOKE ALL ON FUNCTION public.consume_oauth_state_hash(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_oauth_state(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.try_lock_connection_refresh(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_connection_refresh(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_abandoned_oauth_attempts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_oauth_state_hash(text), public.consume_oauth_state(text),
  public.try_lock_connection_refresh(uuid), public.release_connection_refresh(uuid),
  public.expire_abandoned_oauth_attempts() TO service_role;

CREATE OR REPLACE FUNCTION public.integration_oauth_storage_ready()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM pg_index
      WHERE indexrelid = to_regclass('public.social_accounts_one_row_per_channel')
        AND indisunique AND indisvalid
    )
    AND NOT has_table_privilege('anon', 'public.oauth_states', 'SELECT,INSERT,UPDATE,DELETE')
    AND NOT has_table_privilege('authenticated', 'public.oauth_states', 'SELECT,INSERT,UPDATE,DELETE')
    AND NOT has_function_privilege('anon', 'public.consume_oauth_state_hash(text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.consume_oauth_state_hash(text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.consume_oauth_state(text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.consume_oauth_state(text)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.consume_oauth_state_hash(text)', 'EXECUTE')
    AND EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.social_accounts'::regclass AND relrowsecurity)
    AND EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.organizations'::regclass AND relrowsecurity);
$$;
REVOKE ALL ON FUNCTION public.integration_oauth_storage_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.integration_oauth_storage_ready() TO service_role;
COMMIT;
