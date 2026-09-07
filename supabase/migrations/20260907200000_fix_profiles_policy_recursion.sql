-- ═════════════════════════════════════════════════════════════════════════════
-- Break a mutual recursion between the profiles policy and current_tenant_id().
--
-- 20260905000000 replaced the profiles read policy with a tenant-scoped one:
--
--     USING (id = auth.uid()
--            OR tenant_id = public.current_tenant_id()
--            OR public.is_super_admin())
--
-- and current_tenant_id() is:
--
--     SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
--
-- That is fine while the function bypasses RLS. It did -- until Lovable's
-- 20260829112045 ran `ALTER FUNCTION public.current_tenant_id() SECURITY
-- INVOKER`. As an invoker function it reads profiles as the caller, so the
-- profiles policy applies, which calls current_tenant_id() again. Reading
-- profiles can now recurse until Postgres aborts with "stack depth limit
-- exceeded".
--
-- It has not blown up in production yet, because the planner happens to
-- evaluate `id = auth.uid()` first and short-circuit. SQL guarantees no such
-- ordering for OR, so that is luck, not design -- a different plan, a bigger
-- table or an added index can change it. The tenant-isolation harness hit it
-- immediately on a fresh database.
--
-- Fix: give the policies a lookup that is safe to call from a policy ON
-- profiles -- a SECURITY DEFINER function, which bypasses RLS on the table it
-- reads and therefore cannot re-enter the policy. current_tenant_id() is left
-- exactly as Lovable set it, so nothing else changes behaviour.
--
-- Idempotent. Safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.my_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$ SELECT tenant_id FROM public.profiles WHERE id = auth.uid() $$;
REVOKE ALL ON FUNCTION public.my_tenant_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_tenant_id() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.am_i_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = auth.uid() AND p.staff_role = 'super_admin'
  );
$$;
REVOKE ALL ON FUNCTION public.am_i_super_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.am_i_super_admin() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.am_i_tenant_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
     WHERE ur.user_id = auth.uid() AND ur.role = 'admin'::public.app_role
  ) OR EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = auth.uid() AND p.staff_role IN ('company_admin', 'super_admin')
  );
$$;
REVOKE ALL ON FUNCTION public.am_i_tenant_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.am_i_tenant_admin() TO authenticated, service_role;

-- ── Re-point the two policies that read profiles from inside profiles ───────
DROP POLICY IF EXISTS "profiles_read_own_tenant" ON public.profiles;
CREATE POLICY "profiles_read_own_tenant" ON public.profiles FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR (tenant_id IS NOT NULL AND tenant_id = public.my_tenant_id())
    OR public.am_i_super_admin()
  );

DROP POLICY IF EXISTS "profiles_admin_manage_own_tenant" ON public.profiles;
CREATE POLICY "profiles_admin_manage_own_tenant" ON public.profiles FOR UPDATE TO authenticated
  USING (
    public.am_i_super_admin()
    OR (public.am_i_tenant_admin() AND tenant_id IS NOT NULL
        AND tenant_id = public.my_tenant_id())
  )
  WITH CHECK (
    public.am_i_super_admin()
    OR (public.am_i_tenant_admin() AND tenant_id IS NOT NULL
        AND tenant_id = public.my_tenant_id())
  );

-- user_roles policies join to profiles, so they carry the same hazard.
DROP POLICY IF EXISTS "roles_read_self_or_tenant_admin" ON public.user_roles;
CREATE POLICY "roles_read_self_or_tenant_admin" ON public.user_roles FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.am_i_super_admin()
    OR (
      public.am_i_tenant_admin()
      AND EXISTS (
        SELECT 1 FROM public.profiles p
         WHERE p.id = public.user_roles.user_id
           AND p.tenant_id IS NOT NULL
           AND p.tenant_id = public.my_tenant_id()
      )
    )
  );

DROP POLICY IF EXISTS "roles_write_tenant_admin" ON public.user_roles;
CREATE POLICY "roles_write_tenant_admin" ON public.user_roles FOR ALL TO authenticated
  USING (
    public.am_i_super_admin()
    OR (
      public.am_i_tenant_admin()
      AND EXISTS (
        SELECT 1 FROM public.profiles p
         WHERE p.id = public.user_roles.user_id
           AND p.tenant_id IS NOT NULL
           AND p.tenant_id = public.my_tenant_id()
      )
    )
  )
  WITH CHECK (
    public.am_i_super_admin()
    OR (
      public.am_i_tenant_admin()
      AND EXISTS (
        SELECT 1 FROM public.profiles p
         WHERE p.id = public.user_roles.user_id
           AND p.tenant_id IS NOT NULL
           AND p.tenant_id = public.my_tenant_id()
      )
    )
  );

COMMIT;

-- ─── Sanity check ───────────────────────────────────────────────────────────
-- Must return rows rather than "stack depth limit exceeded":
-- SELECT count(*) FROM public.profiles;
