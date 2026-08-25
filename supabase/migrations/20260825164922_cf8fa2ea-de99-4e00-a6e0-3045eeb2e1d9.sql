-- lead_routing_rules and wa_numbers had no tenant_id and `USING (true)` SELECT
-- policies, so every company on the platform could read every other company's
-- routing rules and connected WhatsApp numbers. Same fix as lead_sites.

ALTER TABLE public.lead_routing_rules ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE public.wa_numbers ADD COLUMN IF NOT EXISTS tenant_id uuid;

-- Backfill existing rows onto the only tenant that exists today.
UPDATE public.lead_routing_rules SET tenant_id = (
  SELECT p.tenant_id FROM public.profiles p WHERE p.tenant_id IS NOT NULL LIMIT 1
) WHERE tenant_id IS NULL;
UPDATE public.wa_numbers SET tenant_id = (
  SELECT p.tenant_id FROM public.profiles p WHERE p.tenant_id IS NOT NULL LIMIT 1
) WHERE tenant_id IS NULL;

ALTER TABLE public.lead_routing_rules ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();
ALTER TABLE public.wa_numbers ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();

CREATE INDEX IF NOT EXISTS lead_routing_rules_tenant_idx ON public.lead_routing_rules (tenant_id);
CREATE INDEX IF NOT EXISTS wa_numbers_tenant_idx ON public.wa_numbers (tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_routing_rules TO authenticated;
GRANT ALL ON public.lead_routing_rules TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_numbers TO authenticated;
GRANT ALL ON public.wa_numbers TO service_role;

ALTER TABLE public.lead_routing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_numbers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Signed-in users can view routing rules" ON public.lead_routing_rules;
DROP POLICY IF EXISTS "Admins can manage routing rules" ON public.lead_routing_rules;
DROP POLICY IF EXISTS "Team can view number basics" ON public.wa_numbers;
DROP POLICY IF EXISTS "Admins manage wa_numbers" ON public.wa_numbers;

CREATE POLICY "Team reads own tenant routing rules"
ON public.lead_routing_rules FOR SELECT TO authenticated
USING (tenant_id = public.current_tenant_id());

CREATE POLICY "Admins manage own tenant routing rules"
ON public.lead_routing_rules FOR ALL TO authenticated
USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Team reads own tenant wa numbers"
ON public.wa_numbers FOR SELECT TO authenticated
USING (tenant_id = public.current_tenant_id());

CREATE POLICY "Admins manage own tenant wa numbers"
ON public.wa_numbers FOR ALL TO authenticated
USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'::public.app_role));
