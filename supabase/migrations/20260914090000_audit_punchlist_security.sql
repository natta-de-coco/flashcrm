-- FLAS audit punch-list security fixes — 2026-09-14
-- Idempotent. Safe to re-run.
BEGIN;

-- ---------------------------------------------------------------------------
-- SEC-1: organizations must never be enumerable across tenants.
-- The write policy was hardened earlier, but a broad/legacy SELECT policy can
-- still expose every company. Remove unconditional authenticated SELECT
-- policies on this table and replace them with one own-tenant policy.
-- ---------------------------------------------------------------------------
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT policyname
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'organizations'
       AND cmd = 'SELECT'
       AND roles::text LIKE '%authenticated%'
       AND COALESCE(qual, '') IN ('true', '(true)')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.organizations', p.policyname);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "orgs_read_all" ON public.organizations;
DROP POLICY IF EXISTS "organizations_read_all" ON public.organizations;
DROP POLICY IF EXISTS "orgs_read_own_tenant" ON public.organizations;
CREATE POLICY "orgs_read_own_tenant" ON public.organizations
  FOR SELECT TO authenticated
  USING (id = public.current_tenant_id() OR public.is_super_admin());

-- Keep updates restricted to the caller's own organization. Re-create the
-- policy here so this migration is self-contained even if an older environment
-- missed the 20260901 hardening migration.
DROP POLICY IF EXISTS "orgs_admin_write" ON public.organizations;
DROP POLICY IF EXISTS "orgs_own_tenant_admin_write" ON public.organizations;
CREATE POLICY "orgs_own_tenant_admin_write" ON public.organizations
  FOR UPDATE TO authenticated
  USING (
    id = public.current_tenant_id()
    AND (public.is_tenant_admin() OR public.is_super_admin())
  )
  WITH CHECK (
    id = public.current_tenant_id()
    AND (public.is_tenant_admin() OR public.is_super_admin())
  );

-- ---------------------------------------------------------------------------
-- OAuth state consumption is a server callback responsibility.
-- Earlier migration 20260911200000 granted these RPCs to browser roles to work
-- around a callback permission error. The callback now uses supabaseAdmin, so
-- browser execution is unnecessary and lets one user race another state.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.consume_oauth_state_hash(text)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.consume_oauth_state_hash(text) FROM anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.consume_oauth_state_hash(text) TO service_role;
  END IF;
  IF to_regprocedure('public.consume_oauth_state(text)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.consume_oauth_state(text) FROM anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.consume_oauth_state(text) TO service_role;
  END IF;
  IF to_regprocedure('public.purge_expired_oauth_states()') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.purge_expired_oauth_states() FROM anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.purge_expired_oauth_states() TO service_role;
  END IF;
  IF to_regprocedure('public.expire_abandoned_oauth_attempts()') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.expire_abandoned_oauth_attempts() FROM anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.expire_abandoned_oauth_attempts() TO service_role;
  END IF;
END $$;

-- oauth_states itself contains PKCE verifier/state metadata and is server-only.
REVOKE ALL ON public.oauth_states FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Contact reachability: require phone OR email on every new/changed contact,
-- and normalize/validate phone numbers as E.164 at the database boundary.
-- Existing rows are not rewritten; they become compliant the next time they
-- are edited.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_contact_reachability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  normalized_phone text;
BEGIN
  NEW.email := NULLIF(lower(btrim(COALESCE(NEW.email, ''))), '');
  normalized_phone := NULLIF(regexp_replace(COALESCE(NEW.phone, ''), '[\s\-().]', '', 'g'), '');
  IF normalized_phone LIKE '00%' THEN
    normalized_phone := '+' || substr(normalized_phone, 3);
  END IF;
  NEW.phone := normalized_phone;

  IF NEW.phone IS NULL AND NEW.email IS NULL THEN
    RAISE EXCEPTION 'A contact needs at least one reachable channel: phone or email.'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.phone IS NOT NULL AND NEW.phone !~ '^\+[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'Phone number must use E.164 format, for example +971501234567.'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.email IS NOT NULL AND NEW.email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Email address is not valid.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contacts_reachability_guard ON public.contacts;
CREATE TRIGGER contacts_reachability_guard
BEFORE INSERT OR UPDATE OF phone, email ON public.contacts
FOR EACH ROW EXECUTE FUNCTION public.enforce_contact_reachability();

COMMIT;

-- Verification after applying:
-- 1) As a normal tenant user: SELECT id,name FROM organizations; => own org only.
-- 2) has_function_privilege('authenticated','public.consume_oauth_state_hash(text)','EXECUTE') => false.
-- 3) INSERT/UPDATE a contact without phone/email => rejected.
-- 4) phone '0501234567' => rejected; '+971501234567' => accepted.
