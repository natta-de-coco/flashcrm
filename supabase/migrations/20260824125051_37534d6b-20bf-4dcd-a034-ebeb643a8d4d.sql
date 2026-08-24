create table if not exists public.wordpress_sites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.organizations(id) on delete cascade,
  label text not null,
  site_url text not null,
  username text not null,
  app_password text not null,
  default_author text,
  seo_plugin text not null default 'yoast' check (seo_plugin in ('yoast','rankmath','seopress','none')),
  created_by uuid,
  created_at timestamptz not null default now()
);

grant select (id, tenant_id, label, site_url, username, default_author, seo_plugin, created_by, created_at) on public.wordpress_sites to authenticated;
grant insert (tenant_id, label, site_url, username, app_password, default_author, seo_plugin, created_by) on public.wordpress_sites to authenticated;
grant update (label, site_url, username, app_password, default_author, seo_plugin) on public.wordpress_sites to authenticated;
grant delete on public.wordpress_sites to authenticated;
grant all on public.wordpress_sites to service_role;

alter table public.wordpress_sites enable row level security;

create policy "Tenant members manage wordpress sites"
  on public.wordpress_sites for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create table if not exists public.seo_articles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.organizations(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  title text not null,
  slug text,
  meta_title text,
  meta_description text,
  content_html text,
  excerpt text,
  primary_keyword text,
  secondary_keywords text[] not null default '{}',
  seo_score int not null default 0,
  schema_markup jsonb not null default '{}'::jsonb,
  featured_image_url text,
  wp_site_id uuid references public.wordpress_sites(id) on delete set null,
  wp_post_id int,
  wp_post_url text,
  status text not null default 'draft' check (status in ('draft','review','scheduled','published')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.seo_articles to authenticated;
grant all on public.seo_articles to service_role;

alter table public.seo_articles enable row level security;

create policy "Tenant members manage seo articles"
  on public.seo_articles for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create trigger set_seo_articles_updated_at before update on public.seo_articles
  for each row execute function public.set_updated_at();