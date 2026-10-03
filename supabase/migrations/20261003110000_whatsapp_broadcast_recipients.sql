-- Durable per-recipient evidence for a WhatsApp campaign. A campaign never
-- becomes an untraceable bulk action: every selected contact has one outcome.
BEGIN;

CREATE TABLE IF NOT EXISTS public.whatsapp_campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  wa_number_id uuid REFERENCES public.wa_numbers(id) ON DELETE SET NULL,
  recipient_phone text NOT NULL,
  recipient_name text,
  template_name text NOT NULL,
  template_language text NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','sending','sent','delivered','read','failed','replied','suppressed','cancelled')),
  wa_message_id text,
  failure_reason text,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  replied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, recipient_phone)
);

CREATE INDEX IF NOT EXISTS whatsapp_campaign_recipients_campaign_status_idx
  ON public.whatsapp_campaign_recipients (campaign_id, status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_campaign_recipients_wa_message_id_key
  ON public.whatsapp_campaign_recipients (wa_message_id) WHERE wa_message_id IS NOT NULL;

ALTER TABLE public.whatsapp_campaign_recipients ENABLE ROW LEVEL SECURITY;

-- This table is evidence of what was sent, so the browser may read its own
-- workspace's rows and nothing more. Status, wa_message_id and the delivery
-- timestamps are written by the server from the provider's answer; a browser
-- that could write them could mark a message "delivered" or delete the record
-- of having sent it. The earlier FOR ALL policy, if a previous copy of this
-- file ran, is dropped, and its write grants are revoked.
DROP POLICY IF EXISTS "whatsapp_campaign_recipients_tenant_all" ON public.whatsapp_campaign_recipients;
DROP POLICY IF EXISTS "whatsapp_campaign_recipients_tenant_read" ON public.whatsapp_campaign_recipients;
CREATE POLICY "whatsapp_campaign_recipients_tenant_read" ON public.whatsapp_campaign_recipients
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
REVOKE INSERT, UPDATE, DELETE ON public.whatsapp_campaign_recipients FROM authenticated, anon;
GRANT SELECT ON public.whatsapp_campaign_recipients TO authenticated;
GRANT ALL ON public.whatsapp_campaign_recipients TO service_role;

COMMIT;
