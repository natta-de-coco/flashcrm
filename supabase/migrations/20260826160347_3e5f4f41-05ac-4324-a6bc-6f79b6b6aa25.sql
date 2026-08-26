ALTER TABLE public.business_profiles
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS niche text,
  ADD COLUMN IF NOT EXISTS business_stage text,
  ADD COLUMN IF NOT EXISTS monthly_revenue_target numeric,
  ADD COLUMN IF NOT EXISTS currency text,
  ADD COLUMN IF NOT EXISTS main_goal text,
  ADD COLUMN IF NOT EXISTS competitors text;

CREATE TABLE IF NOT EXISTS public.advisor_reports (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'analysis',
  question text,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS advisor_reports_tenant_created_idx
  ON public.advisor_reports (tenant_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.advisor_reports TO authenticated;
GRANT ALL ON public.advisor_reports TO service_role;

ALTER TABLE public.advisor_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "advisor_reports_tenant_all" ON public.advisor_reports;
CREATE POLICY "advisor_reports_tenant_all" ON public.advisor_reports
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());