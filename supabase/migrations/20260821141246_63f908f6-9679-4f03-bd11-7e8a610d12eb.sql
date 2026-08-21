-- 1. Organizations
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO authenticated;
GRANT ALL ON public.organizations TO service_role;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- 2. Staff profile extensions
CREATE TYPE public.staff_role AS ENUM ('super_admin','company_admin','marketing_manager','staff','seo_editor');
ALTER TABLE public.profiles
  ADD COLUMN tenant_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  ADD COLUMN staff_role public.staff_role NOT NULL DEFAULT 'staff';

-- Tenant helper (security definer avoids recursive RLS on profiles)
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$ SELECT tenant_id FROM public.profiles WHERE id = auth.uid() $$;

CREATE POLICY "orgs_read_own" ON public.organizations
  FOR SELECT TO authenticated USING (id = public.current_tenant_id() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "orgs_admin_write" ON public.organizations
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "profiles_admin_manage" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER organizations_updated BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. Products catalog
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  sku text,
  price numeric(10,2),
  description text,
  specs jsonb NOT NULL DEFAULT '{}'::jsonb,
  images text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "products_tenant_all" ON public.products
  FOR ALL TO authenticated
  USING (tenant_id IS NULL OR tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id IS NULL OR tenant_id = public.current_tenant_id());
CREATE TRIGGER products_updated BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX products_tenant_idx ON public.products (tenant_id);

-- 4. Content posts & SEO
CREATE TABLE public.content_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  author_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  title text,
  body text,
  platforms text[] NOT NULL DEFAULT ARRAY[]::text[],
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','published','failed')),
  scheduled_at timestamptz,
  media_urls text[] NOT NULL DEFAULT ARRAY[]::text[],
  seo_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_posts TO authenticated;
GRANT ALL ON public.content_posts TO service_role;
ALTER TABLE public.content_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "content_tenant_all" ON public.content_posts
  FOR ALL TO authenticated
  USING (tenant_id IS NULL OR tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id IS NULL OR tenant_id = public.current_tenant_id());
CREATE TRIGGER content_posts_updated BEFORE UPDATE ON public.content_posts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX content_posts_tenant_idx ON public.content_posts (tenant_id);

-- 5. Tenant scoping for existing CRM records
ALTER TABLE public.contacts
  ADD COLUMN tenant_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.leads
  ADD COLUMN tenant_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  ADD COLUMN assigned_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','qualified','proposal','won','lost')),
  ADD COLUMN lead_score int NOT NULL DEFAULT 0,
  ADD COLUMN custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX contacts_tenant_idx ON public.contacts (tenant_id);
CREATE INDEX leads_tenant_idx ON public.leads (tenant_id);

DROP POLICY IF EXISTS "contacts_team_all" ON public.contacts;
CREATE POLICY "contacts_tenant_all" ON public.contacts
  FOR ALL TO authenticated
  USING (tenant_id IS NULL OR tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id IS NULL OR tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS "Team can manage leads" ON public.leads;
CREATE POLICY "leads_tenant_all" ON public.leads
  FOR ALL TO authenticated
  USING (tenant_id IS NULL OR tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id IS NULL OR tenant_id = public.current_tenant_id());