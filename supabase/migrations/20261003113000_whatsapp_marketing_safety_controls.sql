-- Evidence and suppression required for policy-safe WhatsApp marketing.
-- This migration does not send a message or change existing consent records.
BEGIN;

CREATE TABLE IF NOT EXISTS public.whatsapp_marketing_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  normalized_phone text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('unsubscribe', 'manual', 'policy', 'frequency_cap')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, normalized_phone)
);

CREATE INDEX IF NOT EXISTS whatsapp_marketing_suppressions_tenant_phone_idx
  ON public.whatsapp_marketing_suppressions (tenant_id, normalized_phone);

ALTER TABLE public.whatsapp_marketing_suppressions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "whatsapp_marketing_suppressions_tenant_all" ON public.whatsapp_marketing_suppressions
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_marketing_suppressions TO authenticated;
GRANT ALL ON public.whatsapp_marketing_suppressions TO service_role;

-- A campaign recipient snapshots the consent proof used at send time. It is
-- evidence for audit/review, not a replacement for the contact's live consent.
ALTER TABLE public.whatsapp_campaign_recipients
  ADD COLUMN IF NOT EXISTS consent_recorded_at timestamptz,
  ADD COLUMN IF NOT EXISTS opt_in_source text,
  ADD COLUMN IF NOT EXISTS marketing_kind text NOT NULL DEFAULT 'marketing'
    CHECK (marketing_kind IN ('marketing', 'utility', 'authentication'));

COMMIT;
