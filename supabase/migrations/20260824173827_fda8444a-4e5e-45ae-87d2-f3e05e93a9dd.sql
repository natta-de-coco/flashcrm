alter table public.social_accounts drop constraint social_accounts_platform_check;
alter table public.social_accounts add constraint social_accounts_platform_check
  check (platform in ('instagram','facebook','youtube','twitter','linkedin','tiktok','google_business'));
alter table public.social_accounts add column if not exists stats jsonb not null default '{}'::jsonb;