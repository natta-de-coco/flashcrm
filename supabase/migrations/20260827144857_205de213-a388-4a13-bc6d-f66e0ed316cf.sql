ALTER TABLE public.billing_settings ADD COLUMN IF NOT EXISTS online_payment_url TEXT;

CREATE TABLE IF NOT EXISTS public.platform_apps (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_secret TEXT NOT NULL,
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_apps TO authenticated;
GRANT ALL ON public.platform_apps TO service_role;

ALTER TABLE public.platform_apps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform_apps_select" ON public.platform_apps
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "platform_apps_insert" ON public.platform_apps
  FOR INSERT TO authenticated WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "platform_apps_update" ON public.platform_apps
  FOR UPDATE TO authenticated USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "platform_apps_delete" ON public.platform_apps
  FOR DELETE TO authenticated USING (tenant_id = public.current_tenant_id());