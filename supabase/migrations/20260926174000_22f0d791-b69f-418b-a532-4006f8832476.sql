ALTER TABLE public.products ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();
ALTER TABLE public.products ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.content_posts ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();
ALTER TABLE public.content_posts ALTER COLUMN tenant_id SET NOT NULL;

DROP POLICY IF EXISTS contacts_tenant_all ON public.contacts;
CREATE POLICY contacts_tenant_all ON public.contacts FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS leads_tenant_all ON public.leads;
CREATE POLICY leads_tenant_all ON public.leads FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS products_tenant_all ON public.products;
CREATE POLICY products_tenant_all ON public.products FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS content_tenant_all ON public.content_posts;
CREATE POLICY content_tenant_all ON public.content_posts FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());