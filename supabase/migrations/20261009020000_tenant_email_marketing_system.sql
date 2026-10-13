-- Migration: 20261009020000_tenant_email_marketing_system.sql
-- Comprehensive Tenant Email Marketing, Consent Gated Intake, and Campaign Architecture

-- 1. Extend tenant_smtp_config with modern BYO SMTP & IMAP credentials, verification, and welcome automation settings
ALTER TABLE public.tenant_smtp_config
  ADD COLUMN IF NOT EXISTS smtp_host text,
  ADD COLUMN IF NOT EXISTS smtp_port integer DEFAULT 465,
  ADD COLUMN IF NOT EXISTS smtp_secure boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS smtp_user text,
  ADD COLUMN IF NOT EXISTS smtp_pass_enc text,
  ADD COLUMN IF NOT EXISTS imap_host text,
  ADD COLUMN IF NOT EXISTS imap_port integer DEFAULT 993,
  ADD COLUMN IF NOT EXISTS imap_secure boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS imap_user text,
  ADD COLUMN IF NOT EXISTS imap_pass_enc text,
  ADD COLUMN IF NOT EXISTS imap_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS welcome_email_enabled boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS welcome_discount_code text DEFAULT 'WELCOME20',
  ADD COLUMN IF NOT EXISTS welcome_discount_percent integer DEFAULT 20,
  ADD COLUMN IF NOT EXISTS welcome_subject text DEFAULT 'Welcome to Flas CRM — Here is your discount code!',
  ADD COLUMN IF NOT EXISTS welcome_body_html text,
  ADD COLUMN IF NOT EXISTS spf_verified boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS dkim_verified boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS dmarc_verified boolean DEFAULT false;

-- 2. Extend leads with consent metadata and workspace tenancy
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS consent_given boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS leads_tenant_consent_idx ON public.leads (tenant_id, consent_given, subscribed);

-- 3. Extend campaigns with template, media, and 5-stage lifecycle support
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS template_id text DEFAULT 'welcome_discount',
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS attachments jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS preview_text text;

-- Update status check constraint on campaigns to support 5 Kanban stages
ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS campaigns_status_check;
ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_status_check
  CHECK (status IN ('draft', 'scheduled', 'in_progress', 'sending', 'sent', 'paused', 'failed'));

-- 4. Strict BYO SMTP Enforcement Trigger on Campaigns
CREATE OR REPLACE FUNCTION public.guard_campaign_verified_smtp()
RETURNS TRIGGER AS $$
DECLARE
  v_verified boolean;
BEGIN
  IF NEW.status IN ('scheduled', 'in_progress', 'sending') THEN
    -- Look up verification state in tenant_smtp_config
    IF NEW.tenant_id IS NOT NULL THEN
      SELECT verified INTO v_verified
      FROM public.tenant_smtp_config
      WHERE tenant_id = NEW.tenant_id;
    ELSE
      -- Fallback to any verified tenant smtp config if tenant_id wasn't populated yet
      SELECT verified INTO v_verified
      FROM public.tenant_smtp_config
      LIMIT 1;
    END IF;

    IF v_verified IS NOT TRUE THEN
      RAISE EXCEPTION 'Cannot schedule or send campaign without verified tenant SMTP credentials';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS guard_campaign_verified_smtp_trigger ON public.campaigns;
CREATE TRIGGER guard_campaign_verified_smtp_trigger
  BEFORE INSERT OR UPDATE OF status ON public.campaigns
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_campaign_verified_smtp();
