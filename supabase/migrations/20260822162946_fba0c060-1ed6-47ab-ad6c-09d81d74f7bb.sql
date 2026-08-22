-- 1. Site webhook secrets (per-site HMAC key for WordPress/Shopify/custom webhooks)
ALTER TABLE public.lead_sites ADD COLUMN IF NOT EXISTS webhook_secret text NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex');

-- 2. WhatsApp template approval workflow
ALTER TABLE public.wa_templates ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.wa_templates ADD COLUMN IF NOT EXISTS wa_number_id uuid REFERENCES public.wa_numbers(id);
ALTER TABLE public.wa_templates ADD COLUMN IF NOT EXISTS meta_template_id text;
ALTER TABLE public.wa_templates ADD COLUMN IF NOT EXISTS rejection_reason text;
ALTER TABLE public.wa_templates ADD COLUMN IF NOT EXISTS submitted_at timestamp with time zone;
ALTER TABLE public.wa_templates ADD COLUMN IF NOT EXISTS reviewed_at timestamp with time zone;

-- 3. Idempotency: a WhatsApp message id may only be stored once (Meta redelivers webhooks)
CREATE UNIQUE INDEX IF NOT EXISTS messages_wa_message_id_key ON public.messages (wa_message_id) WHERE wa_message_id IS NOT NULL;

-- 4. Subscriptions (billing) — keyed by user, mirrored onto organizations by the webhook
CREATE TABLE public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  paddle_subscription_id text not null unique,
  paddle_customer_id text not null,
  product_id text not null,
  price_id text not null,
  status text not null default 'active',
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean default false,
  environment text not null default 'sandbox',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
CREATE INDEX idx_subscriptions_user_id ON public.subscriptions(user_id);
CREATE INDEX idx_subscriptions_paddle_id ON public.subscriptions(paddle_subscription_id);
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own subscription"
  ON public.subscriptions FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "Service role can manage subscriptions"
  ON public.subscriptions FOR ALL
  USING (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.has_active_subscription(
  user_uuid uuid,
  check_env text default 'live'
)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE user_id = user_uuid
    AND environment = check_env
    AND (
      (status IN ('active', 'trialing') AND (current_period_end IS NULL OR current_period_end > now()))
      OR (status = 'canceled' AND current_period_end > now())
    )
  );
$$;

-- 5. Link organizations to their billing customer
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS paddle_customer_id text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS paddle_subscription_id text;

-- 6. GDPR deletion requests
CREATE TABLE public.deletion_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.organizations(id),
  requested_by uuid references auth.users(id),
  scope text not null default 'contact',
  target text,
  status text not null default 'pending',
  details jsonb not null default '{}',
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
GRANT SELECT, INSERT ON public.deletion_requests TO authenticated;
GRANT ALL ON public.deletion_requests TO service_role;
ALTER TABLE public.deletion_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant members can view own deletion requests"
  ON public.deletion_requests FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY "Tenant members can create deletion requests"
  ON public.deletion_requests FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id());

-- 7. Team invites
CREATE TABLE public.team_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.organizations(id) not null,
  email text not null,
  staff_role public.staff_role not null default 'staff',
  invited_by uuid references auth.users(id),
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_invites TO authenticated;
GRANT ALL ON public.team_invites TO service_role;
ALTER TABLE public.team_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant members can manage own invites"
  ON public.team_invites FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());