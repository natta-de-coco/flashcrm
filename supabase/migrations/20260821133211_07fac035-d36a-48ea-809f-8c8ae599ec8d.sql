-- 1. Webhook delivery monitoring
CREATE TABLE public.webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL DEFAULT 'whatsapp',
  event_type text NOT NULL DEFAULT 'message',
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','processed','failed')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  attempts integer NOT NULL DEFAULT 1,
  wa_message_id text,
  duration_ms integer,
  last_retry_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webhook_events_created_idx ON public.webhook_events (created_at DESC);
CREATE INDEX webhook_events_status_idx ON public.webhook_events (status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.webhook_events TO authenticated;
GRANT ALL ON public.webhook_events TO service_role;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Team can read webhook events" ON public.webhook_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "Team can update webhook events" ON public.webhook_events FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Admins can delete webhook events" ON public.webhook_events FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 2. Alerts
CREATE TABLE public.system_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  severity text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
  title text NOT NULL,
  message text,
  source text NOT NULL DEFAULT 'webhook',
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX system_alerts_created_idx ON public.system_alerts (created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.system_alerts TO authenticated;
GRANT ALL ON public.system_alerts TO service_role;
ALTER TABLE public.system_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Team can read alerts" ON public.system_alerts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Team can manage alerts" ON public.system_alerts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- 3. Inbox thread tags
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

-- 4. Follow-up reminders
CREATE TABLE public.reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note text NOT NULL DEFAULT '',
  due_at timestamptz NOT NULL,
  done boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reminders_due_idx ON public.reminders (due_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reminders TO authenticated;
GRANT ALL ON public.reminders TO service_role;
ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Team can manage reminders" ON public.reminders FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 5. WhatsApp templates
CREATE TABLE public.wa_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  language text NOT NULL DEFAULT 'en_US',
  category text NOT NULL DEFAULT 'MARKETING' CHECK (category IN ('MARKETING','UTILITY','AUTHENTICATION')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','approved','rejected')),
  header text,
  body text NOT NULL DEFAULT '',
  footer text,
  variables text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_templates TO authenticated;
GRANT ALL ON public.wa_templates TO service_role;
ALTER TABLE public.wa_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Team can read templates" ON public.wa_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage templates" ON public.wa_templates FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 6. Lead capture sites (WordPress / Shopify plugin)
CREATE TABLE public.lead_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  platform text NOT NULL DEFAULT 'wordpress' CHECK (platform IN ('wordpress','shopify','other')),
  site_key text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_sites TO authenticated;
GRANT ALL ON public.lead_sites TO service_role;
ALTER TABLE public.lead_sites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Team can read lead sites" ON public.lead_sites FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage lead sites" ON public.lead_sites FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 7. Leads collected from plugins / widget
CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  name text,
  phone text,
  source text NOT NULL DEFAULT 'other',
  source_url text,
  site_id uuid REFERENCES public.lead_sites(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  subscribed boolean NOT NULL DEFAULT true,
  tags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email)
);
CREATE INDEX leads_created_idx ON public.leads (created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Team can manage leads" ON public.leads FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 8. Marketing campaigns
CREATE TABLE public.campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  subject text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  audience_tag text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','sending','sent','failed')),
  scheduled_at timestamptz,
  sent_at timestamptz,
  recipients_count integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaigns TO authenticated;
GRANT ALL ON public.campaigns TO service_role;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Team can manage campaigns" ON public.campaigns FOR ALL TO authenticated USING (true) WITH CHECK (true);