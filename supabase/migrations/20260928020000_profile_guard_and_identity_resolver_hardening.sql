-- Match the production hardening applied through Lovable on 2026-09-28.
-- SECURITY DEFINER made current_user the function owner (postgres), so the
-- profile trigger's owner exception bypassed every browser-session check.
BEGIN;
ALTER FUNCTION public.guard_profile_privilege_columns() SECURITY INVOKER;
-- This resolver accepts an explicit tenant id and bypasses RLS. Its only app
-- caller is contact-resolve.server.ts using supabaseAdmin; browsers need no grant.
REVOKE ALL ON FUNCTION public.resolve_contact_by_identity(uuid,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_contact_by_identity(uuid,text,text)
  TO service_role;
COMMIT;
