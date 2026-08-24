CREATE TABLE public.plan_thresholds (
  plan text PRIMARY KEY,
  deliverability_min numeric NOT NULL DEFAULT 95,
  read_rate_min numeric NOT NULL DEFAULT 60,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.plan_thresholds TO authenticated;
GRANT ALL ON public.plan_thresholds TO service_role;

ALTER TABLE public.plan_thresholds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Signed-in users can view plan thresholds"
ON public.plan_thresholds FOR SELECT TO authenticated USING (true);

INSERT INTO public.plan_thresholds (plan, deliverability_min, read_rate_min) VALUES
  ('default', 95, 60),
  ('starter', 90, 50),
  ('trial', 90, 50),
  ('growth', 95, 60),
  ('standard', 95, 60),
  ('agency', 97, 70),
  ('enterprise', 98, 75);

CREATE TRIGGER plan_thresholds_updated BEFORE UPDATE ON public.plan_thresholds
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- NULL on a number now means "inherit the plan default"
ALTER TABLE public.wa_numbers ALTER COLUMN deliverability_min DROP NOT NULL;
ALTER TABLE public.wa_numbers ALTER COLUMN read_rate_min DROP NOT NULL;