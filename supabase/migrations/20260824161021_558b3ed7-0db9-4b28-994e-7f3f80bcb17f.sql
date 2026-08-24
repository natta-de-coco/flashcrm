create table public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id(),
  platform text not null check (platform in ('instagram','facebook')),
  label text not null,
  external_id text,
  access_token text,
  active boolean not null default true,
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);

grant select (id, tenant_id, platform, label, external_id, active, last_synced_at, created_at) on public.social_accounts to authenticated;
grant insert (platform, label, external_id, access_token, active) on public.social_accounts to authenticated;
grant update (platform, label, external_id, access_token, active, last_synced_at) on public.social_accounts to authenticated;
grant delete on public.social_accounts to authenticated;
grant all on public.social_accounts to service_role;

alter table public.social_accounts enable row level security;
create policy "Team can view social accounts" on public.social_accounts for select to authenticated using (tenant_id = public.current_tenant_id());
create policy "Admins manage social accounts" on public.social_accounts for all to authenticated using (tenant_id = public.current_tenant_id() and public.has_role(auth.uid(), 'admin')) with check (tenant_id = public.current_tenant_id() and public.has_role(auth.uid(), 'admin'));

create table public.social_interactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id(),
  account_id uuid not null references public.social_accounts(id) on delete cascade,
  kind text not null check (kind in ('comment','dm')),
  direction text not null default 'in' check (direction in ('in','out')),
  author_name text,
  author_handle text,
  body text not null,
  external_id text,
  status text not null default 'open' check (status in ('open','replied','archived')),
  ai_suggestion text,
  replied_at timestamptz,
  created_at timestamptz not null default now(),
  unique (account_id, external_id)
);

grant select, insert, update, delete on public.social_interactions to authenticated;
grant all on public.social_interactions to service_role;

alter table public.social_interactions enable row level security;
create policy "Tenant manages interactions" on public.social_interactions for all to authenticated using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id());

create table public.social_posts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id(),
  account_id uuid references public.social_accounts(id) on delete set null,
  caption text not null,
  status text not null default 'draft' check (status in ('draft','scheduled','published')),
  scheduled_at timestamptz,
  published_at timestamptz,
  reach integer not null default 0,
  likes integer not null default 0,
  comments_count integer not null default 0,
  shares integer not null default 0,
  external_id text,
  created_at timestamptz not null default now(),
  unique (account_id, external_id)
);

grant select, insert, update, delete on public.social_posts to authenticated;
grant all on public.social_posts to service_role;

alter table public.social_posts enable row level security;
create policy "Tenant manages social posts" on public.social_posts for all to authenticated using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id());