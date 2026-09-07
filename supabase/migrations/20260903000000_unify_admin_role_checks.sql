-- ═════════════════════════════════════════════════════════════════════════════
-- Reconcile the two parallel admin-role systems.
--
-- THE BUG
-- This app has two role systems that grew up side by side:
--   * user_roles.role (app_role: 'admin' | 'agent') — the original, checked by
--     has_role() in most RLS policies and SECURITY DEFINER RPCs.
--   * profiles.staff_role (company_admin | marketing_manager | staff |
--     seo_editor | super_admin) — the newer per-tenant one the UI shows.
--
-- completeOnboarding() grants BOTH to whoever creates a workspace, so the
-- founder never notices. Claiming a team invite only ever set staff_role.
-- Result: an invited "company admin" appears to be an admin everywhere in the
-- product, while every has_role()-gated policy silently refuses them —
-- WhatsApp templates, bot settings, SMTP API keys, connected-app credentials.
-- No error that names the cause; things just don't save.
--
-- THE FIX
-- 1. is_tenant_admin() — one helper that accepts EITHER system, so new policy
--    work stops having to pick a side.
-- 2. Re-point the policies this repo added to use it.
-- 3. Backfill the legacy role for people already stuck in that state.
--
-- Idempotent. Safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Canonical admin check ────────────────────────────────────────────────
-- True when the user is an admin under EITHER system. Kept SECURITY DEFINER
-- and STABLE so it is safe and cheap to call from inside RLS policies.
CREATE OR REPLACE FUNCTION public.is_tenant_admin(_user uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
     WHERE ur.user_id = _user AND ur.role = 'admin'::public.app_role
  ) OR EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = _user AND p.staff_role IN ('company_admin', 'super_admin')
  );
$$;
REVOKE ALL ON FUNCTION public.is_tenant_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_tenant_admin(uuid) TO authenticated, service_role;

-- ── 2. Re-point the policies this repo introduced ───────────────────────────
DROP POLICY IF EXISTS "tenant_bot_settings_write" ON public.tenant_bot_settings;
CREATE POLICY "tenant_bot_settings_write" ON public.tenant_bot_settings FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_tenant_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_tenant_admin());

DROP POLICY IF EXISTS "tenant_wa_config_write" ON public.tenant_wa_config;
CREATE POLICY "tenant_wa_config_write" ON public.tenant_wa_config FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_tenant_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_tenant_admin());

DROP POLICY IF EXISTS "wa_templates_admin_manage" ON public.wa_templates;
CREATE POLICY "wa_templates_admin_manage" ON public.wa_templates FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_tenant_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_tenant_admin());

DROP POLICY IF EXISTS "team_invites_admin_write" ON public.team_invites;
CREATE POLICY "team_invites_admin_write" ON public.team_invites FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_tenant_admin())
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND staff_role <> 'super_admin'
    AND public.is_tenant_admin()
  );

DROP POLICY IF EXISTS "orgs_own_tenant_admin_write" ON public.organizations;
CREATE POLICY "orgs_own_tenant_admin_write" ON public.organizations FOR UPDATE TO authenticated
  USING (id = public.current_tenant_id() AND public.is_tenant_admin())
  WITH CHECK (id = public.current_tenant_id() AND public.is_tenant_admin());

DROP POLICY IF EXISTS "roles_read_self_or_admin" ON public.user_roles;
CREATE POLICY "roles_read_self_or_admin" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_tenant_admin() OR public.is_super_admin());

-- ── 3. The per-tenant SMTP key RPC ──────────────────────────────────────────
-- Its own admin check disagreed with the app's (requireCompanyAdmin checks
-- staff_role), so a company_admin could pass the UI gate and then get a
-- zero-row UPDATE with no error — the key silently never saved.
CREATE OR REPLACE FUNCTION public.set_tenant_smtp_api_key(_api_key text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tid uuid;
BEGIN
  _tid := public.current_tenant_id();
  IF _tid IS NULL THEN RAISE EXCEPTION 'No tenant context'; END IF;
  IF NOT public.is_tenant_admin() THEN
    RAISE EXCEPTION 'Only company admins can change email settings';
  END IF;
  UPDATE public.tenant_smtp_config
     SET api_key_enc = public.pgp_sym_encrypt(_api_key, public._smtp_encryption_key())
   WHERE tenant_id = _tid;
  -- A no-op UPDATE previously looked like success. Say so instead.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Save your email provider settings before adding the API key.';
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public.set_tenant_smtp_api_key(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_tenant_smtp_api_key(text) TO authenticated;

-- ── 4. Backfill people already stuck ────────────────────────────────────────
-- Anyone who accepted an invite as company_admin/super_admin before this fix
-- has staff_role but no legacy role, and has been quietly unable to administer
-- anything. Give them the legacy role so existing has_role() policies work.
INSERT INTO public.user_roles (user_id, role)
SELECT p.id, 'admin'::public.app_role
  FROM public.profiles p
 WHERE p.staff_role IN ('company_admin', 'super_admin')
   AND NOT EXISTS (
     SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = p.id AND ur.role = 'admin'::public.app_role
   )
ON CONFLICT DO NOTHING;

COMMIT;

-- ─── Sanity checks ──────────────────────────────────────────────────────────
-- Should return 0 — every staff/super admin now also holds the legacy role:
-- SELECT COUNT(*) AS admins_missing_legacy_role
--   FROM public.profiles p
--  WHERE p.staff_role IN ('company_admin','super_admin')
--    AND NOT EXISTS (SELECT 1 FROM public.user_roles ur
--                     WHERE ur.user_id = p.id AND ur.role = 'admin'::public.app_role);
--
-- Should return true when run as an admin:
-- SELECT public.is_tenant_admin();
