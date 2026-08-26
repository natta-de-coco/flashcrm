CREATE TABLE public.daily_briefs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  brief_date date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  headline text NOT NULL,
  summary text NOT NULL,
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, brief_date)
);

CREATE INDEX daily_briefs_tenant_date_idx ON public.daily_briefs (tenant_id, brief_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_briefs TO authenticated;
GRANT ALL ON public.daily_briefs TO service_role;

ALTER TABLE public.daily_briefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members read their briefs" ON public.daily_briefs
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());

CREATE POLICY "Tenant members write their briefs" ON public.daily_briefs
  FOR INSERT TO authenticated WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY "Tenant members update their briefs" ON public.daily_briefs
  FOR UPDATE TO authenticated USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());