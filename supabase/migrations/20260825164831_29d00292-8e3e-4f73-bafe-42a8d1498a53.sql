-- Leads and contacts had GLOBAL unique keys on email/phone. With multiple
-- companies on the platform, Company B capturing a lead that Company A already
-- has would overwrite Company A's row (upsert onConflict:email) or fail hard.
-- Scope uniqueness per tenant instead.

ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_email_key;
DROP INDEX IF EXISTS public.leads_email_key;

ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS contacts_phone_key;
DROP INDEX IF EXISTS public.contacts_phone_key;

CREATE UNIQUE INDEX IF NOT EXISTS leads_tenant_email_key
  ON public.leads (tenant_id, email);

CREATE UNIQUE INDEX IF NOT EXISTS contacts_tenant_phone_key
  ON public.contacts (tenant_id, phone)
  WHERE phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS contacts_tenant_email_idx
  ON public.contacts (tenant_id, email);
