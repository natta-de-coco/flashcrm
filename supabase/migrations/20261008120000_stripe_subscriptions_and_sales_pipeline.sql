-- ═════════════════════════════════════════════════════════════════════════════
-- Stripe subscriptions & billing migration
-- Adds Stripe customer & subscription identifiers alongside existing Paddle support.
-- Existing Paddle subscribers keep paying and renewing undisturbed.
-- New subscribers use Stripe checkout.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Organizations: Stripe billing metadata & provider tracking
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS stripe_customer_id text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS stripe_subscription_id text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS billing_provider text DEFAULT 'stripe';

-- 2. Subscriptions: make Paddle columns nullable so Stripe rows can be stored cleanly
ALTER TABLE public.subscriptions ALTER COLUMN paddle_subscription_id DROP NOT NULL;
ALTER TABLE public.subscriptions ALTER COLUMN paddle_customer_id DROP NOT NULL;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS stripe_subscription_id text;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS stripe_customer_id text;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'paddle';
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.organizations(id);

-- PostgreSQL conflict inference requires a non-partial UNIQUE index/constraint matching onConflict: stripe_subscription_id
DROP INDEX IF EXISTS idx_subscriptions_stripe_subscription_id;
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_stripe_subscription_id
  ON public.subscriptions(stripe_subscription_id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant_id
  ON public.subscriptions(tenant_id);

CREATE INDEX IF NOT EXISTS idx_organizations_stripe_customer_id
  ON public.organizations(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_organizations_stripe_subscription_id
  ON public.organizations(stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

-- 3. Sales documents: unique index on stripe_invoice_id for idempotency and concurrency safety
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_documents_stripe_invoice_id
  ON public.sales_documents ((custom_fields->>'stripe_invoice_id'))
  WHERE (custom_fields->>'stripe_invoice_id') IS NOT NULL;

COMMIT;
