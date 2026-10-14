-- ==============================================================================
-- Migration: 20261014110000_withdraw_marketing_consent.sql
-- Description:
--   One function that withdraws a person's marketing consent for ONE company, completely and in
--   one transaction: every spelling of the address (any case, stray spaces) in that company's
--   leads and contacts, and its active drip enrolments when that table exists.
--
--   Called only by the server (service role) when someone opens the unsubscribe link in a
--   marketing email. Safe to run twice. Until it is applied the app falls back to a paged,
--   checked sequence of writes (complete, but not one transaction); nothing breaks either way.
--
--   Rollback:  DROP FUNCTION IF EXISTS public.withdraw_marketing_consent(uuid, text);
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.withdraw_marketing_consent(_tenant_id uuid, _email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Addresses are stored as typed or imported, so they are compared trimmed (space, tab, line
  -- breaks) and lower-cased, never as a substring: "xsam@example.com" is not "sam@example.com".
  v_email    text    := lower(btrim(coalesce(_email, ''), E' \t\r\n\f\v'));
  v_leads    integer := 0;
  v_contacts integer := 0;
  v_drips    integer := 0;
BEGIN
  IF _tenant_id IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'withdraw_marketing_consent needs a company and an address'
      USING ERRCODE = '22023';
  END IF;

  -- Only rows still consenting are written, so a second call changes nothing and says 0.
  UPDATE public.leads
     SET subscribed = false,
         consent_given = false
   WHERE tenant_id = _tenant_id
     AND lower(btrim(email, E' \t\r\n\f\v')) = v_email
     AND (subscribed IS DISTINCT FROM false OR consent_given IS DISTINCT FROM false);
  GET DIAGNOSTICS v_leads = ROW_COUNT;

  UPDATE public.contacts
     SET consent_given = false
   WHERE tenant_id = _tenant_id
     AND lower(btrim(email, E' \t\r\n\f\v')) = v_email
     AND consent_given IS DISTINCT FROM false;
  GET DIAGNOSTICS v_contacts = ROW_COUNT;

  -- The drip tables arrive with a later migration and the live database may not have them yet.
  -- Dynamic SQL, so this function is valid whether or not the table exists.
  IF to_regclass('public.drip_enrollments') IS NOT NULL THEN
    EXECUTE
      'UPDATE public.drip_enrollments
          SET status = ''unsubscribed'',
              updated_at = now()
        WHERE tenant_id = $1
          AND lower(btrim(email, E'' \t\r\n\f\v'')) = $2
          AND status IN (''enrolled'', ''in_progress'')'
    USING _tenant_id, v_email;
    GET DIAGNOSTICS v_drips = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'leads', v_leads,
    'contacts', v_contacts,
    'drip_enrollments', v_drips
  );
END;
$$;

COMMENT ON FUNCTION public.withdraw_marketing_consent(uuid, text) IS
  'Withdraws marketing consent for one address in one company (leads, contacts, active drip enrolments) in a single transaction. Server only (service_role).';

-- The function writes with the owner's rights, so nobody but the server may call it. Supabase
-- grants new functions to anon and authenticated by default; take that back every time.
REVOKE ALL ON FUNCTION public.withdraw_marketing_consent(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_marketing_consent(uuid, text) TO service_role;

-- Read-only check. Expect: security_definer = true, settings = {search_path=public, pg_temp},
-- anon_can_run = false, authenticated_can_run = false, service_role_can_run = true.
SELECT p.proname,
       p.prosecdef AS security_definer,
       p.proconfig AS settings,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_run,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_run,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can_run
  FROM pg_proc p
 WHERE p.oid = 'public.withdraw_marketing_consent(uuid, text)'::regprocedure;
