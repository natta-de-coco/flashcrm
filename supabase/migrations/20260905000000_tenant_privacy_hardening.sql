-- ═════════════════════════════════════════════════════════════════════════════
-- Every company's data private to that company.
--
-- Found the way these things should be found: the owner signed in, opened
-- Settings, and saw three people listed under Team -- including accounts that
-- are not in his workspace. The Team list does not filter by tenant at all; it
-- trusts RLS, and RLS on profiles was:
--
--     CREATE POLICY "profiles_read_all" ON public.profiles
--       FOR SELECT TO authenticated USING (true);
--
-- Every signed-in user of every company could read every profile on the
-- platform -- names and email addresses of all clients. The earlier
-- tenant-isolation migration (20260901000000) covered conversations, messages,
-- reminders, campaigns, webhook_events, wa_templates, team_invites and
-- organizations, and simply missed profiles.
--
-- Worse, writes were unscoped too:
--
--     CREATE POLICY "profiles_admin_manage" ON public.profiles
--       FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'));
--
-- Any company admin could edit any other company's user rows.
--
-- A sweep of all 72 live policies found four more with no scoping at all.
-- plan_thresholds (platform reference data) and the service-role-only
-- subscriptions policy are legitimately unscoped and are left alone.
--
-- Idempotent. Safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. profiles: the leak the owner actually saw ────────────────────────────
-- You can always read yourself (needed before a tenant is assigned, and by
-- current_tenant_id() itself). Otherwise: same workspace only.
DROP POLICY IF EXISTS "profiles_read_all" ON public.profiles;
DROP POLICY IF EXISTS "profiles_read_own_tenant" ON public.profiles;
CREATE POLICY "profiles_read_own_tenant" ON public.profiles FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR (tenant_id IS NOT NULL AND tenant_id = public.current_tenant_id())
    OR public.is_super_admin()
  );

-- Admins manage their own workspace's people, nobody else's.
DROP POLICY IF EXISTS "profiles_admin_manage" ON public.profiles;
DROP POLICY IF EXISTS "profiles_admin_manage_own_tenant" ON public.profiles;
CREATE POLICY "profiles_admin_manage_own_tenant" ON public.profiles FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR (public.is_tenant_admin() AND tenant_id IS NOT NULL
        AND tenant_id = public.current_tenant_id())
  )
  WITH CHECK (
    public.is_super_admin()
    OR (public.is_tenant_admin() AND tenant_id IS NOT NULL
        AND tenant_id = public.current_tenant_id())
  );

-- ── 2. user_roles: reachable only through the profile that owns the role ────
-- The table has no tenant_id of its own, so scope it through profiles.
-- Previously an admin of any company could read -- and write -- the roles of
-- every user on the platform.
DROP POLICY IF EXISTS "roles_read_all" ON public.user_roles;
DROP POLICY IF EXISTS "roles_read_self_or_admin" ON public.user_roles;
DROP POLICY IF EXISTS "roles_read_self_or_tenant_admin" ON public.user_roles;
CREATE POLICY "roles_read_self_or_tenant_admin" ON public.user_roles FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_super_admin()
    OR (
      public.is_tenant_admin()
      AND EXISTS (
        SELECT 1 FROM public.profiles p
         WHERE p.id = public.user_roles.user_id
           AND p.tenant_id IS NOT NULL
           AND p.tenant_id = public.current_tenant_id()
      )
    )
  );

DROP POLICY IF EXISTS "roles_admin_write" ON public.user_roles;
DROP POLICY IF EXISTS "roles_write_tenant_admin" ON public.user_roles;
CREATE POLICY "roles_write_tenant_admin" ON public.user_roles FOR ALL TO authenticated
  USING (
    public.is_super_admin()
    OR (
      public.is_tenant_admin()
      AND EXISTS (
        SELECT 1 FROM public.profiles p
         WHERE p.id = public.user_roles.user_id
           AND p.tenant_id IS NOT NULL
           AND p.tenant_id = public.current_tenant_id()
      )
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR (
      public.is_tenant_admin()
      AND EXISTS (
        SELECT 1 FROM public.profiles p
         WHERE p.id = public.user_roles.user_id
           AND p.tenant_id IS NOT NULL
           AND p.tenant_id = public.current_tenant_id()
      )
    )
  );

-- ── 3. bot_settings / wa_config: legacy singletons ──────────────────────────
-- One shared row from before this product was multi-tenant. bot_settings holds
-- the chatbot's instructions and business knowledge; wa_config holds the
-- business name and phone number id. Both were readable by every signed-in
-- user of every company, and writable by any admin.
--
-- tenant_bot_settings and tenant_wa_config (20260901010000) replaced them.
-- The server still reads these two as a fallback, but it does so with the
-- service role, which bypasses RLS -- so closing them to browser clients
-- changes no behaviour.
DROP POLICY IF EXISTS "bot_read" ON public.bot_settings;
DROP POLICY IF EXISTS "bot_read_superadmin" ON public.bot_settings;
CREATE POLICY "bot_read_superadmin" ON public.bot_settings FOR SELECT TO authenticated
  USING (public.is_super_admin());

DROP POLICY IF EXISTS "bot_admin_update" ON public.bot_settings;
DROP POLICY IF EXISTS "bot_admin_insert" ON public.bot_settings;
DROP POLICY IF EXISTS "bot_write_superadmin" ON public.bot_settings;
CREATE POLICY "bot_write_superadmin" ON public.bot_settings FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "wa_read" ON public.wa_config;
DROP POLICY IF EXISTS "wa_read_superadmin" ON public.wa_config;
CREATE POLICY "wa_read_superadmin" ON public.wa_config FOR SELECT TO authenticated
  USING (public.is_super_admin());

DROP POLICY IF EXISTS "wa_admin_update" ON public.wa_config;
DROP POLICY IF EXISTS "wa_admin_insert" ON public.wa_config;
DROP POLICY IF EXISTS "wa_write_superadmin" ON public.wa_config;
CREATE POLICY "wa_write_superadmin" ON public.wa_config FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- ── 4. system_alerts: give an alert an owner ────────────────────────────────
-- Read AND update were both USING (true): every company could see, and resolve,
-- every other company's alerts. The table had no tenant at all, so add one.
-- NULL means a platform-level alert (billing, Paddle) and stays with the owner.
ALTER TABLE public.system_alerts
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS system_alerts_tenant_idx ON public.system_alerts (tenant_id, created_at DESC);

DROP POLICY IF EXISTS "Team can read alerts" ON public.system_alerts;
DROP POLICY IF EXISTS "alerts_read_own_tenant" ON public.system_alerts;
CREATE POLICY "alerts_read_own_tenant" ON public.system_alerts FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (tenant_id IS NOT NULL AND tenant_id = public.current_tenant_id())
  );

DROP POLICY IF EXISTS "Team can manage alerts" ON public.system_alerts;
DROP POLICY IF EXISTS "alerts_update_own_tenant" ON public.system_alerts;
CREATE POLICY "alerts_update_own_tenant" ON public.system_alerts FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR (tenant_id IS NOT NULL AND tenant_id = public.current_tenant_id())
  )
  WITH CHECK (
    public.is_super_admin()
    OR (tenant_id IS NOT NULL AND tenant_id = public.current_tenant_id())
  );

COMMIT;

-- ─── Sanity checks ──────────────────────────────────────────────────────────
-- No policy on these tables may be an unconditional USING (true). Expect 0:
-- SELECT tablename, policyname FROM pg_policies
--  WHERE schemaname='public' AND qual = 'true'
--    AND tablename IN ('profiles','user_roles','bot_settings','wa_config','system_alerts');
--
-- Signed in as a company admin, this must return only your own workspace:
-- SELECT email, tenant_id FROM public.profiles;
