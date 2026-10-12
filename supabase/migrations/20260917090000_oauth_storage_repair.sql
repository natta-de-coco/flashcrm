-- =============================================================================
-- OAuth storage repair: makes "OAuth database schema" report Ready, and closes
-- anonymous access to OAuth state consumption.
--
-- WHY THIS EXISTS (verified against production on 17 Sep 2026 with read-only
-- probes using the publishable key):
--
--   * Integrations > Admin diagnostics showed "OAuth database schema: MISSING"
--     for every OAuth provider, blocking every social connection.
--   * The check (oauthPreflight in src/lib/oauth-preflight.server.ts) calls
--     public.integration_oauth_storage_ready(). Production answered PGRST202:
--     the function does not exist. It is defined in
--     20260914170000_integration_storage_readiness.sql, which reached the
--     repository through GitHub and was never run against the database.
--     Lovable applies only the migrations it writes itself.
--   * Every column the check selects already exists in production
--     (oauth_states: id, state_hash, redirect_uri, code_verifier, used_at,
--     attempt_state; social_accounts: id, external_id, connection_state,
--     granted_scopes). No table or column is missing.
--   * public.consume_oauth_state_hash(text) EXECUTED for an anonymous caller.
--     20260914161601 granted it to anon and authenticated; the revoke in
--     20260914170000 never ran. For anyone holding a state value (it is in the
--     sign-in URL), that call burns the attempt and returns its code_verifier,
--     the PKCE secret, so the real callback fails and PKCE no longer protects
--     the exchange.
--
-- Every caller of these functions uses the service-role client (supabaseAdmin),
-- so removing browser-role access breaks nothing a signed-in user does: their
-- requests reach these functions through server functions.
--
-- Safe to run more than once, and safe whether or not 20260914170000 is
-- applied later. It never deletes data.
-- =============================================================================

BEGIN;

-- 1. oauth_states is server-only ---------------------------------------------
ALTER TABLE public.oauth_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.oauth_states FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.oauth_states TO service_role;

-- 2. State and refresh-lease functions are server-only -----------------------
-- Each is repaired only if present, so a database missing one older function
-- still gets every other fix instead of the whole script rolling back.
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.consume_oauth_state_hash(text)',
    'public.consume_oauth_state(text)',
    'public.try_lock_connection_refresh(uuid)',
    'public.release_connection_refresh(uuid)',
    'public.expire_abandoned_oauth_attempts()',
    'public.purge_expired_oauth_states()'
  ] LOOP
    IF to_regprocedure(fn) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    ELSE
      RAISE NOTICE 'oauth storage repair: % is not present, skipped', fn;
    END IF;
  END LOOP;
END $$;

-- 3. RLS on the tables the check requires ------------------------------------
ALTER TABLE public.social_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- 4. One row per connected channel -------------------------------------------
-- Same index and the same refusal as 20260911110000: if duplicate channel rows
-- exist, deleting one could discard a conversation history, so a person must
-- choose. Unlike that migration, this WARNS and continues rather than rolling
-- back the permission fixes above; the report in step 5 then names it.
DO $$
DECLARE
  _duplicates integer;
BEGIN
  IF to_regclass('public.social_accounts_one_row_per_channel') IS NOT NULL THEN
    RETURN;
  END IF;
  SELECT count(*) INTO _duplicates FROM (
    SELECT 1 FROM public.social_accounts
     WHERE external_id IS NOT NULL
     GROUP BY tenant_id, platform, external_id
    HAVING count(*) > 1
  ) d;
  IF _duplicates > 0 THEN
    RAISE WARNING
      'oauth storage repair: % duplicate channel group(s) in social_accounts; unique index NOT created. List them with: SELECT tenant_id, platform, external_id, array_agg(id) FROM public.social_accounts WHERE external_id IS NOT NULL GROUP BY 1,2,3 HAVING count(*) > 1;',
      _duplicates;
    RETURN;
  END IF;
  CREATE UNIQUE INDEX social_accounts_one_row_per_channel
    ON public.social_accounts (tenant_id, platform, external_id)
    WHERE external_id IS NOT NULL;
END $$;

-- 5. The readiness guard ------------------------------------------------------
-- Same conditions as 20260914170000. The guard is built from the per-condition
-- report, so the two can never disagree, and a remaining blocker is named.
CREATE OR REPLACE FUNCTION public.integration_oauth_storage_report()
RETURNS TABLE (condition text, ok boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT * FROM (VALUES
    ('unique index social_accounts_one_row_per_channel',
      EXISTS (SELECT 1 FROM pg_index
               WHERE indexrelid = to_regclass('public.social_accounts_one_row_per_channel')
                 AND indisunique AND indisvalid)),
    ('anon has no access to oauth_states',
      NOT has_table_privilege('anon', 'public.oauth_states', 'SELECT,INSERT,UPDATE,DELETE')),
    ('authenticated has no access to oauth_states',
      NOT has_table_privilege('authenticated', 'public.oauth_states', 'SELECT,INSERT,UPDATE,DELETE')),
    ('anon cannot run consume_oauth_state_hash',
      NOT has_function_privilege('anon', 'public.consume_oauth_state_hash(text)', 'EXECUTE')),
    ('authenticated cannot run consume_oauth_state_hash',
      NOT has_function_privilege('authenticated', 'public.consume_oauth_state_hash(text)', 'EXECUTE')),
    ('anon cannot run consume_oauth_state',
      NOT has_function_privilege('anon', 'public.consume_oauth_state(text)', 'EXECUTE')),
    ('authenticated cannot run consume_oauth_state',
      NOT has_function_privilege('authenticated', 'public.consume_oauth_state(text)', 'EXECUTE')),
    ('service_role can run consume_oauth_state_hash',
      has_function_privilege('service_role', 'public.consume_oauth_state_hash(text)', 'EXECUTE')),
    ('RLS enabled on social_accounts',
      EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.social_accounts'::regclass AND relrowsecurity)),
    ('RLS enabled on organizations',
      EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.organizations'::regclass AND relrowsecurity))
  ) AS t(condition, ok);
$$;

CREATE OR REPLACE FUNCTION public.integration_oauth_storage_ready()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT bool_and(ok) FROM public.integration_oauth_storage_report();
$$;

REVOKE ALL ON FUNCTION public.integration_oauth_storage_report() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.integration_oauth_storage_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.integration_oauth_storage_report() TO service_role;
GRANT EXECUTE ON FUNCTION public.integration_oauth_storage_ready() TO service_role;

COMMIT;

-- The API caches its list of functions. Without this, the new function can
-- keep answering "not found" (PGRST202) for a while after it exists.
NOTIFY pgrst, 'reload schema';

-- Verify (every row should be true):
--   SELECT * FROM public.integration_oauth_storage_report();
--   SELECT public.integration_oauth_storage_ready();          -- expect: true
--
-- Rollback: removes the readiness functions (diagnostics return to MISSING).
-- The permission changes are deliberately NOT reversed: re-granting
-- consume_oauth_state_hash to anon would reopen the PKCE bypass described above.
--   DROP FUNCTION IF EXISTS public.integration_oauth_storage_ready();
--   DROP FUNCTION IF EXISTS public.integration_oauth_storage_report();
