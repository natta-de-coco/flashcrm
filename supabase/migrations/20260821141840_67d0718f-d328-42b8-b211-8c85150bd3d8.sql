ALTER TABLE public.lead_sites
  ADD COLUMN IF NOT EXISTS domain text,
  ADD COLUMN IF NOT EXISTS admin_email text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS activation_token text NOT NULL DEFAULT encode(extensions.gen_random_bytes(24), 'hex'),
  ADD COLUMN IF NOT EXISTS activated_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS popup_greeting text NOT NULL DEFAULT 'Hi! Leave your WhatsApp number and we will reply right away.',
  ADD COLUMN IF NOT EXISTS ask_whatsapp boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ask_email boolean NOT NULL DEFAULT true;

UPDATE public.lead_sites
SET status = 'active', activated_at = COALESCE(activated_at, now())
WHERE status = 'pending' AND active = true AND created_at < now();

CREATE INDEX IF NOT EXISTS lead_sites_activation_token_idx ON public.lead_sites (activation_token);
