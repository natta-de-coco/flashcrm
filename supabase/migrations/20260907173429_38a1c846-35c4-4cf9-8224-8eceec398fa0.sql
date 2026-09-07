-- 1. ai_provider_keys: admin-scoped read/update, and never expose the key value to the browser.
CREATE POLICY "Tenant admins can view provider keys" ON public.ai_provider_keys
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_tenant_admin(auth.uid()));

CREATE POLICY "Tenant admins can update provider keys" ON public.ai_provider_keys
  FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_tenant_admin(auth.uid()))
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_tenant_admin(auth.uid()));

REVOKE SELECT ON public.ai_provider_keys FROM authenticated;
GRANT SELECT (id, tenant_id, provider, label, active, created_at, created_by) ON public.ai_provider_keys TO authenticated;
GRANT ALL ON public.ai_provider_keys TO service_role;

-- 2. platform_apps: admin only, and client_secret is server-side only.
DROP POLICY IF EXISTS "platform_apps_select" ON public.platform_apps;
DROP POLICY IF EXISTS "platform_apps_insert" ON public.platform_apps;
DROP POLICY IF EXISTS "platform_apps_update" ON public.platform_apps;
DROP POLICY IF EXISTS "platform_apps_delete" ON public.platform_apps;

CREATE POLICY "platform_apps_admin_select" ON public.platform_apps
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_tenant_admin(auth.uid()));
CREATE POLICY "platform_apps_admin_insert" ON public.platform_apps
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_tenant_admin(auth.uid()));
CREATE POLICY "platform_apps_admin_update" ON public.platform_apps
  FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_tenant_admin(auth.uid()))
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_tenant_admin(auth.uid()));
CREATE POLICY "platform_apps_admin_delete" ON public.platform_apps
  FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_tenant_admin(auth.uid()));

REVOKE SELECT ON public.platform_apps FROM authenticated;
GRANT SELECT (id, tenant_id, provider, client_id, label, created_at, updated_at) ON public.platform_apps TO authenticated;
GRANT ALL ON public.platform_apps TO service_role;

-- 3. social_accounts: team may list accounts, but tokens are server-side only.
REVOKE SELECT ON public.social_accounts FROM authenticated;
GRANT SELECT (
  id, tenant_id, platform, label, external_id, active, last_synced_at, created_at,
  stats, profile, permissions, token_expires_at, profile_url, last_post_at,
  last_analytics_sync_at, health, connect_method, status_reason, last_error,
  last_error_at, retry_count, last_retry_at, next_retry_at, granted_scopes
) ON public.social_accounts TO authenticated;
GRANT ALL ON public.social_accounts TO service_role;

-- 4. wa_numbers: team may list numbers, but access_token / app_secret are server-side only.
REVOKE SELECT ON public.wa_numbers FROM authenticated;
GRANT SELECT (
  id, tenant_id, label, display_phone, phone_number_id, active, is_default,
  alerts_enabled, deliverability_min, read_rate_min, created_at
) ON public.wa_numbers TO authenticated;
GRANT ALL ON public.wa_numbers TO service_role;

-- 5. wordpress_sites: admin-only writes, app_password never readable by the browser.
DROP POLICY IF EXISTS "Tenant members manage wordpress sites" ON public.wordpress_sites;

CREATE POLICY "Team reads own tenant wordpress sites" ON public.wordpress_sites
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() OR public.is_super_admin(auth.uid()));
CREATE POLICY "Tenant admins add wordpress sites" ON public.wordpress_sites
  FOR INSERT TO authenticated
  WITH CHECK ((tenant_id = public.current_tenant_id() AND public.is_tenant_admin(auth.uid())) OR public.is_super_admin(auth.uid()));
CREATE POLICY "Tenant admins update wordpress sites" ON public.wordpress_sites
  FOR UPDATE TO authenticated
  USING ((tenant_id = public.current_tenant_id() AND public.is_tenant_admin(auth.uid())) OR public.is_super_admin(auth.uid()))
  WITH CHECK ((tenant_id = public.current_tenant_id() AND public.is_tenant_admin(auth.uid())) OR public.is_super_admin(auth.uid()));
CREATE POLICY "Tenant admins remove wordpress sites" ON public.wordpress_sites
  FOR DELETE TO authenticated
  USING ((tenant_id = public.current_tenant_id() AND public.is_tenant_admin(auth.uid())) OR public.is_super_admin(auth.uid()));

REVOKE SELECT ON public.wordpress_sites FROM authenticated;
GRANT SELECT (id, tenant_id, label, site_url, username, default_author, seo_plugin, created_by, created_at) ON public.wordpress_sites TO authenticated;
GRANT ALL ON public.wordpress_sites TO service_role;

-- 6. invoices (legacy table with customer PII): owner / tenant admin / platform owner only.
DROP POLICY IF EXISTS "invoices read" ON public.invoices;
CREATE POLICY "invoices read" ON public.invoices
  FOR SELECT TO authenticated
  USING (
    (tenant_id = public.current_tenant_id()
      AND (created_by = auth.uid() OR public.is_tenant_admin(auth.uid())))
    OR public.is_super_admin(auth.uid())
  );