-- 1. Tenant-scoped API keys (hashed at rest, scoped permissions)
CREATE TABLE public.api_keys (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  last_used_at TIMESTAMP WITH TIME ZONE,
  revoked_at TIMESTAMP WITH TIME ZONE,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_keys TO authenticated;
GRANT ALL ON public.api_keys TO service_role;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
-- NULL tenant_id = legacy single-tenant workspace; otherwise strictly tenant-scoped.
CREATE POLICY "members manage own tenant api keys" ON public.api_keys FOR ALL TO authenticated
  USING ((tenant_id IS NULL AND public.current_tenant_id() IS NULL) OR tenant_id = public.current_tenant_id())
  WITH CHECK ((tenant_id IS NULL AND public.current_tenant_id() IS NULL) OR tenant_id = public.current_tenant_id());
CREATE INDEX api_keys_hash_idx ON public.api_keys (key_hash);

-- 2. Append-only audit log (no UPDATE/DELETE grants = tamper-proof from the API)
CREATE TABLE public.audit_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  actor_id UUID,
  actor_label TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read own tenant audit" ON public.audit_log FOR SELECT TO authenticated
  USING ((tenant_id IS NULL AND public.current_tenant_id() IS NULL) OR tenant_id = public.current_tenant_id());
CREATE POLICY "members write own tenant audit" ON public.audit_log FOR INSERT TO authenticated
  WITH CHECK ((tenant_id IS NULL AND public.current_tenant_id() IS NULL) OR tenant_id = public.current_tenant_id());
CREATE INDEX audit_log_tenant_idx ON public.audit_log (tenant_id, created_at DESC);

-- 3. Per-number Meta app secret for webhook signature verification,
--    and lock secret columns away from browser reads.
ALTER TABLE public.wa_numbers ADD COLUMN IF NOT EXISTS app_secret TEXT;
REVOKE SELECT ON public.wa_numbers FROM authenticated;
GRANT SELECT (id, label, display_phone, phone_number_id, is_default, active, created_at) ON public.wa_numbers TO authenticated;

-- 4. Subscription fields for the $20/mo plan + manager suspension control
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'flash_monthly_20',
  ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'trial',
  ADD COLUMN IF NOT EXISTS subscription_renews_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS suspended BOOLEAN NOT NULL DEFAULT false;