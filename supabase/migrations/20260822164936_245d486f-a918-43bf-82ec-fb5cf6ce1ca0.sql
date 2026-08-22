-- 1. Flash AI business memory (one per company)
CREATE TABLE public.business_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.organizations(id) not null unique,
  website_url text,
  business_name text,
  industry text,
  description text,
  qa jsonb not null default '{}',
  learned_facts text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
GRANT SELECT, INSERT, UPDATE ON public.business_profiles TO authenticated;
GRANT ALL ON public.business_profiles TO service_role;
ALTER TABLE public.business_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant members manage own business profile"
  ON public.business_profiles FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE TRIGGER business_profiles_updated BEFORE UPDATE ON public.business_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. Bring-your-own AI provider keys (raw key is never readable via the API)
CREATE TABLE public.ai_provider_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.organizations(id) not null,
  provider text not null,
  label text not null default 'Default',
  api_key text not null,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
GRANT INSERT, DELETE ON public.ai_provider_keys TO authenticated;
GRANT ALL ON public.ai_provider_keys TO service_role;
ALTER TABLE public.ai_provider_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant admins can add provider keys"
  ON public.ai_provider_keys FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Tenant admins can remove provider keys"
  ON public.ai_provider_keys FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'));

-- 3. Invoices
CREATE TABLE public.invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.organizations(id) not null,
  invoice_number text not null,
  customer_name text not null,
  customer_email text,
  customer_phone text,
  items jsonb not null default '[]',
  subtotal numeric not null default 0,
  tax_percent numeric not null default 0,
  total numeric not null default 0,
  currency text not null default 'USD',
  status text not null default 'draft',
  notes text,
  due_date date,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices TO authenticated;
GRANT ALL ON public.invoices TO service_role;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant members manage own invoices"
  ON public.invoices FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE TRIGGER invoices_updated BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();