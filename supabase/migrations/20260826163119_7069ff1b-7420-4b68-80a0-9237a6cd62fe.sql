ALTER TABLE public.social_accounts DROP CONSTRAINT IF EXISTS social_accounts_platform_check;
ALTER TABLE public.social_accounts ADD CONSTRAINT social_accounts_platform_check
  CHECK (platform IN (
    'instagram','facebook','youtube','twitter','linkedin','tiktok','google_business',
    'pinterest','threads','google_ads','meta_ads','linkedin_ads','tiktok_ads',
    'google_analytics','search_console'
  ));