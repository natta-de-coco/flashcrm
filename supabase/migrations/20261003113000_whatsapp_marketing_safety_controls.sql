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

-- A suppression only ever stops messages, so staff may add one from the
-- browser: a customer who says "stop" should be honoured by whoever reads it.
-- Removing or editing one is the opposite -- it re-subscribes someone who
-- asked not to be messaged -- so that is the server's, with its audit trail,
-- and never the browser's. The earlier FOR ALL policy and its UPDATE/DELETE
-- grants are dropped, which also corrects a copy of this file that already ran.
DROP POLICY IF EXISTS "whatsapp_marketing_suppressions_tenant_all" ON public.whatsapp_marketing_suppressions;
DROP POLICY IF EXISTS "whatsapp_marketing_suppressions_tenant_read" ON public.whatsapp_marketing_suppressions;
DROP POLICY IF EXISTS "whatsapp_marketing_suppressions_tenant_add" ON public.whatsapp_marketing_suppressions;
CREATE POLICY "whatsapp_marketing_suppressions_tenant_read" ON public.whatsapp_marketing_suppressions
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY "whatsapp_marketing_suppressions_tenant_add" ON public.whatsapp_marketing_suppressions
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id());
REVOKE UPDATE, DELETE ON public.whatsapp_marketing_suppressions FROM authenticated, anon;
GRANT SELECT, INSERT ON public.whatsapp_marketing_suppressions TO authenticated;
GRANT ALL ON public.whatsapp_marketing_suppressions TO service_role;

-- A campaign recipient snapshots the consent proof used at send time. It is
-- evidence for audit/review, not a replacement for the contact's live consent.
ALTER TABLE public.whatsapp_campaign_recipients
  ADD COLUMN IF NOT EXISTS consent_recorded_at timestamptz,
  ADD COLUMN IF NOT EXISTS opt_in_source text,
  ADD COLUMN IF NOT EXISTS marketing_kind text NOT NULL DEFAULT 'marketing'
    CHECK (marketing_kind IN ('marketing', 'utility', 'authentication'));

COMMIT;
