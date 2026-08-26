-- 1. social_accounts enrichment
ALTER TABLE public.social_accounts
  ADD COLUMN IF NOT EXISTS profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS profile_url text,
  ADD COLUMN IF NOT EXISTS last_post_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_analytics_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS health text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS connect_method text NOT NULL DEFAULT 'manual';

GRANT SELECT (profile, permissions, token_expires_at, profile_url, last_post_at, last_analytics_sync_at, health, connect_method, stats)
  ON public.social_accounts TO authenticated;
GRANT INSERT (profile, permissions, token_expires_at, profile_url, health, connect_method)
  ON public.social_accounts TO authenticated;
GRANT UPDATE (profile, permissions, token_expires_at, profile_url, last_post_at, last_analytics_sync_at, health, connect_method)
  ON public.social_accounts TO authenticated;

-- 2. account scans
CREATE TABLE IF NOT EXISTS public.social_account_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id(),
  account_id uuid NOT NULL REFERENCES public.social_accounts(id) ON DELETE CASCADE,
  overall integer NOT NULL DEFAULT 0,
  scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  suggestions jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS social_account_scans_account_idx ON public.social_account_scans(account_id, created_at DESC);
GRANT SELECT, INSERT, DELETE ON public.social_account_scans TO authenticated;
GRANT ALL ON public.social_account_scans TO service_role;
ALTER TABLE public.social_account_scans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Team manages own account scans" ON public.social_account_scans;
CREATE POLICY "Team manages own account scans" ON public.social_account_scans
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

-- 3. brand training knowledge
ALTER TABLE public.business_profiles
  ADD COLUMN IF NOT EXISTS locations text,
  ADD COLUMN IF NOT EXISTS target_countries text,
  ADD COLUMN IF NOT EXISTS target_cities text,
  ADD COLUMN IF NOT EXISTS products_summary text,
  ADD COLUMN IF NOT EXISTS services_summary text,
  ADD COLUMN IF NOT EXISTS brands text,
  ADD COLUMN IF NOT EXISTS target_customers text,
  ADD COLUMN IF NOT EXISTS usp text,
  ADD COLUMN IF NOT EXISTS pricing_approach text,
  ADD COLUMN IF NOT EXISTS contact_details text,
  ADD COLUMN IF NOT EXISTS tone text,
  ADD COLUMN IF NOT EXISTS brand_personality text,
  ADD COLUMN IF NOT EXISTS preferred_cta text,
  ADD COLUMN IF NOT EXISTS keywords text,
  ADD COLUMN IF NOT EXISTS forbidden_words text,
  ADD COLUMN IF NOT EXISTS compliance_rules text,
  ADD COLUMN IF NOT EXISTS priority_products text,
  ADD COLUMN IF NOT EXISTS avoid_products text,
  ADD COLUMN IF NOT EXISTS seasonal_campaigns text,
  ADD COLUMN IF NOT EXISTS marketing_goals text;

-- 4. website knowledge
CREATE TABLE IF NOT EXISTS public.website_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id(),
  url text NOT NULL,
  title text,
  kind text NOT NULL DEFAULT 'page',
  word_count integer NOT NULL DEFAULT 0,
  summary text,
  keywords text,
  indexed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, url)
);
CREATE INDEX IF NOT EXISTS website_pages_tenant_idx ON public.website_pages(tenant_id, kind);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.website_pages TO authenticated;
GRANT ALL ON public.website_pages TO service_role;
ALTER TABLE public.website_pages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Team manages own website pages" ON public.website_pages;
CREATE POLICY "Team manages own website pages" ON public.website_pages
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE TABLE IF NOT EXISTS public.website_sync_state (
  tenant_id uuid PRIMARY KEY DEFAULT public.current_tenant_id(),
  site_url text,
  last_synced_at timestamptz,
  pages integer NOT NULL DEFAULT 0,
  products integer NOT NULL DEFAULT 0,
  services integer NOT NULL DEFAULT 0,
  blog_posts integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'idle',
  error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.website_sync_state TO authenticated;
GRANT ALL ON public.website_sync_state TO service_role;
ALTER TABLE public.website_sync_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Team manages own website sync" ON public.website_sync_state;
CREATE POLICY "Team manages own website sync" ON public.website_sync_state
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());