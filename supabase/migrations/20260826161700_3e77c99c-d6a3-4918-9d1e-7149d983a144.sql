CREATE TABLE public.kpi_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id(),
  metric text NOT NULL,
  label text NOT NULL,
  target_value numeric NOT NULL,
  unit text NOT NULL DEFAULT '',
  direction text NOT NULL DEFAULT 'higher' CHECK (direction IN ('higher','lower')),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','advisor')),
  note text,
  active boolean NOT NULL DEFAULT true,
  last_value numeric,
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, metric)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.kpi_targets TO authenticated;
GRANT ALL ON public.kpi_targets TO service_role;
ALTER TABLE public.kpi_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kpi_targets tenant read" ON public.kpi_targets
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "kpi_targets tenant insert" ON public.kpi_targets
  FOR INSERT TO authenticated WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "kpi_targets tenant update" ON public.kpi_targets
  FOR UPDATE TO authenticated USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "kpi_targets tenant delete" ON public.kpi_targets
  FOR DELETE TO authenticated USING (tenant_id = public.current_tenant_id());

CREATE TABLE public.kpi_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id(),
  target_id uuid REFERENCES public.kpi_targets(id) ON DELETE CASCADE,
  metric text NOT NULL,
  label text NOT NULL,
  value numeric,
  target_value numeric,
  severity text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
  message text NOT NULL,
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.kpi_alerts TO authenticated;
GRANT ALL ON public.kpi_alerts TO service_role;
ALTER TABLE public.kpi_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kpi_alerts tenant read" ON public.kpi_alerts
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "kpi_alerts tenant insert" ON public.kpi_alerts
  FOR INSERT TO authenticated WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "kpi_alerts tenant update" ON public.kpi_alerts
  FOR UPDATE TO authenticated USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "kpi_alerts tenant delete" ON public.kpi_alerts
  FOR DELETE TO authenticated USING (tenant_id = public.current_tenant_id());

CREATE INDEX kpi_alerts_tenant_created_idx ON public.kpi_alerts (tenant_id, created_at DESC);