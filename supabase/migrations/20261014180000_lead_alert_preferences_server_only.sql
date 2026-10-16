-- Prerequisite: 20261010010000_enterprise_growth_pillars.sql.
-- Browser role must not configure company alerts or forge delivery history.
-- No data writes/deletes. Apply after the Settings safeguards deploy.
BEGIN;
ALTER TABLE public.tenant_alert_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_alerts_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_alert_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.lead_alerts_log FROM PUBLIC, anon, authenticated;
-- Table revocation alone does not revoke an older column-level grant.
DO $$
DECLARE relation_name text; columns_sql text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['tenant_alert_settings', 'lead_alerts_log'] LOOP
    SELECT string_agg(quote_ident(attname), ', ') INTO columns_sql
    FROM pg_attribute WHERE attrelid = format('public.%I', relation_name)::regclass
    AND attnum > 0 AND NOT attisdropped;
    EXECUTE format('REVOKE SELECT (%s), INSERT (%s), UPDATE (%s), REFERENCES (%s) ON public.%I FROM PUBLIC, anon, authenticated', columns_sql, columns_sql, columns_sql, columns_sql, relation_name);
  END LOOP;
END $$;
GRANT SELECT ON public.tenant_alert_settings, public.lead_alerts_log TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_alert_settings TO service_role;
GRANT SELECT, INSERT ON public.lead_alerts_log TO service_role;
DROP POLICY IF EXISTS "tenant_alert_settings_isolation" ON public.tenant_alert_settings;
DROP POLICY IF EXISTS "lead_alerts_log_isolation" ON public.lead_alerts_log;
DROP POLICY IF EXISTS "tenant_alert_settings_admin_read" ON public.tenant_alert_settings;
CREATE POLICY "tenant_alert_settings_admin_read" ON public.tenant_alert_settings
FOR SELECT TO authenticated USING (EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
  AND p.tenant_id = tenant_alert_settings.tenant_id
  AND p.staff_role IN ('company_admin', 'super_admin')
));
DROP POLICY IF EXISTS "lead_alerts_log_admin_read" ON public.lead_alerts_log;
CREATE POLICY "lead_alerts_log_admin_read" ON public.lead_alerts_log
FOR SELECT TO authenticated USING (EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
  AND p.tenant_id = lead_alerts_log.tenant_id
  AND p.staff_role IN ('company_admin', 'super_admin')
));
COMMIT;
