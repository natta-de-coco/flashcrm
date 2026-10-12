-- Backups are explicit per workspace: a failed key must not silently send
-- customer content to another provider or spend shared credits without opt-in.
BEGIN;
CREATE TABLE IF NOT EXISTS public.tenant_ai_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  fallback_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tenant_ai_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_ai_settings_read ON public.tenant_ai_settings;
CREATE POLICY tenant_ai_settings_read ON public.tenant_ai_settings FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
REVOKE ALL ON public.tenant_ai_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.tenant_ai_settings TO authenticated;
GRANT ALL ON public.tenant_ai_settings TO service_role;

CREATE OR REPLACE FUNCTION public.get_tenant_ai_resilience(_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT fallback_enabled FROM public.tenant_ai_settings WHERE tenant_id = _tenant_id), false);
$$;
REVOKE ALL ON FUNCTION public.get_tenant_ai_resilience(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_tenant_ai_resilience(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.set_tenant_ai_resilience(_tenant_id uuid, _enabled boolean)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.tenant_ai_settings(tenant_id, fallback_enabled) VALUES (_tenant_id, _enabled)
  ON CONFLICT (tenant_id) DO UPDATE SET fallback_enabled = excluded.fallback_enabled, updated_at = now();
$$;
REVOKE ALL ON FUNCTION public.set_tenant_ai_resilience(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_tenant_ai_resilience(uuid, boolean) TO service_role;
COMMIT;
