DO $$
DECLARE
  _duplicates integer;
BEGIN
  SELECT count(*) INTO _duplicates
    FROM (
      SELECT tenant_id, platform, external_id
        FROM public.social_accounts
       WHERE external_id IS NOT NULL
       GROUP BY tenant_id, platform, external_id
      HAVING count(*) > 1
    ) d;

  IF _duplicates > 0 THEN
    RAISE EXCEPTION
      'public.social_accounts has % channel(s) connected more than once in the same workspace. Nothing was changed.',
      _duplicates
      USING HINT = 'List them with: SELECT tenant_id, platform, external_id, array_agg(id) FROM public.social_accounts WHERE external_id IS NOT NULL GROUP BY 1,2,3 HAVING count(*) > 1; keep the row with the history, delete the others, then run this again.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS social_accounts_one_row_per_channel
  ON public.social_accounts (tenant_id, platform, external_id)
  WHERE external_id IS NOT NULL;

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