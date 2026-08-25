-- lead_sites had no tenant_id and a `USING (true)` SELECT policy, so every
-- company could read every other company's site keys (which authorize lead
-- ingestion). Scope the table to a tenant like every other business table.

ALTER TABLE public.lead_sites ADD COLUMN IF NOT EXISTS tenant_id uuid;

-- Backfill: no rows exist yet, but be safe for any future re-run.
UPDATE public.lead_sites s
SET tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.tenant_id IS NOT NULL LIMIT 1)
WHERE s.tenant_id IS NULL;

ALTER TABLE public.lead_sites
  ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();

CREATE INDEX IF NOT EXISTS lead_sites_tenant_id_idx ON public.lead_sites (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS lead_sites_site_key_key ON public.lead_sites (site_key);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_sites TO authenticated;
GRANT ALL ON public.lead_sites TO service_role;

ALTER TABLE public.lead_sites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Team can read lead sites" ON public.lead_sites;
DROP POLICY IF EXISTS "Admins can manage lead sites" ON public.lead_sites;

CREATE POLICY "Team can read own tenant lead sites"
ON public.lead_sites FOR SELECT TO authenticated
USING (tenant_id = public.current_tenant_id());

CREATE POLICY "Admins can insert own tenant lead sites"
ON public.lead_sites FOR INSERT TO authenticated
WITH CHECK (
  tenant_id = public.current_tenant_id()
  AND public.has_role(auth.uid(), 'admin'::public.app_role)
);

CREATE POLICY "Admins can update own tenant lead sites"
ON public.lead_sites FOR UPDATE TO authenticated
USING (
  tenant_id = public.current_tenant_id()
  AND public.has_role(auth.uid(), 'admin'::public.app_role)
)
WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY "Admins can delete own tenant lead sites"
ON public.lead_sites FOR DELETE TO authenticated
USING (
  tenant_id = public.current_tenant_id()
  AND public.has_role(auth.uid(), 'admin'::public.app_role)
);
