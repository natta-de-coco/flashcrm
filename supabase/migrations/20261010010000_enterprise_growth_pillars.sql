-- ==============================================================================
-- 20261010010000_enterprise_growth_pillars.sql
--
-- Schema additions for:
-- 1. Multi-Step Email Marketing Drip Automations (Sequences, Steps, Enrollments)
-- 2. Instant Sales Lead Alerts (Notification settings & delivery logs)
-- 3. Round-Robin WhatsApp Chat Assignment & Response-Time SLAs
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Multi-Step Email Marketing Drip Sequences
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.drip_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  trigger_event text NOT NULL DEFAULT 'lead_consented_intake',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.drip_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id uuid NOT NULL REFERENCES public.drip_sequences(id) ON DELETE CASCADE,
  step_number int NOT NULL,
  delay_days int NOT NULL DEFAULT 0,
  template_id text NOT NULL DEFAULT 'welcome_discount',
  subject text NOT NULL,
  discount_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.drip_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  sequence_id uuid NOT NULL REFERENCES public.drip_sequences(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  email text NOT NULL,
  current_step int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'enrolled' CHECK (status IN ('enrolled', 'in_progress', 'completed', 'unsubscribed', 'paused')),
  next_run_at timestamptz NOT NULL DEFAULT now(),
  last_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_drip_enrollments_next_run 
  ON public.drip_enrollments (status, next_run_at) 
  WHERE status IN ('enrolled', 'in_progress');

CREATE INDEX IF NOT EXISTS idx_drip_enrollments_tenant 
  ON public.drip_enrollments (tenant_id, email);

-- ------------------------------------------------------------------------------
-- 2. Instant Sales Lead Alerts Settings
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.tenant_alert_settings (
  tenant_id uuid PRIMARY KEY,
  lead_alerts_enabled boolean NOT NULL DEFAULT true,
  alert_email_addresses text[] NOT NULL DEFAULT '{}',
  alert_whatsapp_enabled boolean NOT NULL DEFAULT false,
  alert_whatsapp_phone text,
  quote_threshold_alert boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lead_alerts_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  alert_channel text NOT NULL CHECK (alert_channel IN ('email', 'whatsapp', 'in_app')),
  recipient text NOT NULL,
  subject text,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_alerts_tenant_created 
  ON public.lead_alerts_log (tenant_id, created_at DESC);

-- ------------------------------------------------------------------------------
-- 3. Round-Robin WhatsApp Chat Assignment & Response-Time SLAs
-- ------------------------------------------------------------------------------

-- Ensure conversations table has SLA and assignment tracking columns
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'conversations' AND column_name = 'assigned_at'
  ) THEN
    ALTER TABLE public.conversations ADD COLUMN assigned_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'conversations' AND column_name = 'first_response_at'
  ) THEN
    ALTER TABLE public.conversations ADD COLUMN first_response_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'conversations' AND column_name = 'sla_minutes'
  ) THEN
    ALTER TABLE public.conversations ADD COLUMN sla_minutes int DEFAULT 15;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'conversations' AND column_name = 'sla_breached'
  ) THEN
    ALTER TABLE public.conversations ADD COLUMN sla_breached boolean DEFAULT false;
  END IF;
END $$;

-- Tenant Assignment & SLA Settings
CREATE TABLE IF NOT EXISTS public.tenant_chat_routing_settings (
  tenant_id uuid PRIMARY KEY,
  auto_assignment_enabled boolean NOT NULL DEFAULT true,
  assignment_mode text NOT NULL DEFAULT 'round_robin' CHECK (assignment_mode IN ('round_robin', 'least_active', 'manual')),
  default_sla_minutes int NOT NULL DEFAULT 15,
  active_agent_ids uuid[] NOT NULL DEFAULT '{}',
  last_assigned_agent_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS Security Policies
ALTER TABLE public.drip_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drip_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drip_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_alert_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_alerts_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_chat_routing_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "drip_sequences_tenant_isolation" ON public.drip_sequences
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "drip_enrollments_tenant_isolation" ON public.drip_enrollments
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "tenant_alert_settings_isolation" ON public.tenant_alert_settings
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "lead_alerts_log_isolation" ON public.lead_alerts_log
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "tenant_chat_routing_settings_isolation" ON public.tenant_chat_routing_settings
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));
