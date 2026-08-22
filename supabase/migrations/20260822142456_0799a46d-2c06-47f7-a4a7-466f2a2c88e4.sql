ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS consent_given boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS consent_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS assigned_wa_number_id uuid REFERENCES public.wa_numbers(id) ON DELETE SET NULL;

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS consent_given boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS consent_at timestamp with time zone;

CREATE TABLE public.lead_routing_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  match_field text not null default 'tag' check (match_field in ('tag', 'source', 'platform', 'email_domain')),
  match_value text not null,
  wa_number_id uuid not null references public.wa_numbers(id) on delete cascade,
  priority integer not null default 100,
  active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

GRANT SELECT ON public.lead_routing_rules TO authenticated;
GRANT ALL ON public.lead_routing_rules TO service_role;

ALTER TABLE public.lead_routing_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Signed-in users can view routing rules"
  ON public.lead_routing_rules FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage routing rules"
  ON public.lead_routing_rules FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER lead_routing_rules_updated
  BEFORE UPDATE ON public.lead_routing_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();