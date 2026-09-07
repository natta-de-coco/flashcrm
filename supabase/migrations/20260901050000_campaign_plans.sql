-- Campaign Planner: persists each AI-generated targeting plan so a company
-- can look back at what was recommended and when, rather than the output
-- being thrown away after one view.
BEGIN;

CREATE TABLE IF NOT EXISTS public.campaign_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  goal text NOT NULL,
  product text,
  budget_note text,
  plan jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campaign_plans_tenant_idx ON public.campaign_plans (tenant_id, created_at DESC);
GRANT SELECT, INSERT, DELETE ON public.campaign_plans TO authenticated;
GRANT ALL ON public.campaign_plans TO service_role;
ALTER TABLE public.campaign_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "campaign_plans_tenant_all" ON public.campaign_plans;
CREATE POLICY "campaign_plans_tenant_all" ON public.campaign_plans FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

COMMIT;
