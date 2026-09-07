-- ═════════════════════════════════════════════════════════════════════════════
-- Flas CRM — convert bot_settings and wa_config from platform-wide singletons
-- to per-tenant tables. Every tenant currently shares one bot personality and
-- one "connected number" display card, which is wrong on a multi-tenant
-- platform (this was flagged as part of the original tenant-isolation
-- ship-blocker). The old singleton tables are left in place, unused, as a
-- rollback path — drop them in a later migration once this is verified live.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── tenant_bot_settings ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tenant_bot_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  bot_name text NOT NULL DEFAULT 'Flash Assistant',
  greeting text NOT NULL DEFAULT 'Hi! Thanks for reaching out. How can I help you today?',
  instructions text NOT NULL DEFAULT 'You are a helpful WhatsApp support assistant. Be concise, friendly and professional. Answer in the customer''s language.',
  model text NOT NULL DEFAULT 'google/gemini-3.7-flash',
  handoff_keywords text[] NOT NULL DEFAULT ARRAY['human','agent','representative','complaint'],
  business_hours_only boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.tenant_bot_settings TO authenticated;
GRANT ALL ON public.tenant_bot_settings TO service_role;
ALTER TABLE public.tenant_bot_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_bot_settings_read" ON public.tenant_bot_settings;
DROP POLICY IF EXISTS "tenant_bot_settings_write" ON public.tenant_bot_settings;
DROP POLICY IF EXISTS "tenant_bot_settings_read" ON public.tenant_bot_settings;
CREATE POLICY "tenant_bot_settings_read" ON public.tenant_bot_settings FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS "tenant_bot_settings_write" ON public.tenant_bot_settings;
CREATE POLICY "tenant_bot_settings_write" ON public.tenant_bot_settings FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'));
DROP TRIGGER IF EXISTS tenant_bot_settings_updated ON public.tenant_bot_settings;
CREATE TRIGGER tenant_bot_settings_updated BEFORE UPDATE ON public.tenant_bot_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed one row per existing org from the old singleton's current values.
INSERT INTO public.tenant_bot_settings
  (tenant_id, enabled, bot_name, greeting, instructions, model, handoff_keywords, business_hours_only)
SELECT o.id, s.enabled, s.bot_name, s.greeting, s.instructions, s.model, s.handoff_keywords, s.business_hours_only
  FROM public.organizations o CROSS JOIN public.bot_settings s
 WHERE s.id = true
ON CONFLICT (tenant_id) DO NOTHING;

-- ── tenant_wa_config ─────────────────────────────────────────────────────────
-- Per-tenant "primary number" display card. wa_numbers already carries
-- phone_number_id per row/tenant; this table is just the settings-page
-- summary card + the flag the webhook sets once verification succeeds.
CREATE TABLE IF NOT EXISTS public.tenant_wa_config (
  tenant_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  business_name text,
  display_phone text,
  phone_number_id text,
  webhook_verified boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.tenant_wa_config TO authenticated;
GRANT ALL ON public.tenant_wa_config TO service_role;
ALTER TABLE public.tenant_wa_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_wa_config_read" ON public.tenant_wa_config;
DROP POLICY IF EXISTS "tenant_wa_config_write" ON public.tenant_wa_config;
DROP POLICY IF EXISTS "tenant_wa_config_read" ON public.tenant_wa_config;
CREATE POLICY "tenant_wa_config_read" ON public.tenant_wa_config FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS "tenant_wa_config_write" ON public.tenant_wa_config;
CREATE POLICY "tenant_wa_config_write" ON public.tenant_wa_config FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'));
DROP TRIGGER IF EXISTS tenant_wa_config_updated ON public.tenant_wa_config;
CREATE TRIGGER tenant_wa_config_updated BEFORE UPDATE ON public.tenant_wa_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.tenant_wa_config (tenant_id, business_name, display_phone, phone_number_id, webhook_verified)
SELECT o.id, w.business_name, w.display_phone, w.phone_number_id, w.webhook_verified
  FROM public.organizations o CROSS JOIN public.wa_config w
 WHERE w.id = true
ON CONFLICT (tenant_id) DO NOTHING;

-- Service-role helper so a webhook (no authenticated tenant session) can flip
-- webhook_verified for the specific tenant it just verified.
CREATE OR REPLACE FUNCTION public.mark_wa_webhook_verified(_tenant_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.tenant_wa_config (tenant_id, webhook_verified)
  VALUES (_tenant_id, true)
  ON CONFLICT (tenant_id) DO UPDATE SET webhook_verified = true, updated_at = now();
$$;
REVOKE ALL ON FUNCTION public.mark_wa_webhook_verified(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_wa_webhook_verified(uuid) TO service_role;

COMMIT;
