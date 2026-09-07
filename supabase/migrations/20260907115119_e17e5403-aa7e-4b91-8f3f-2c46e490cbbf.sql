-- 1. Storage: protect invoice files per tenant
CREATE POLICY "Tenant staff read own invoice files"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'invoices'
  AND (storage.foldername(name))[1] = public.current_tenant_id()::text
);

CREATE POLICY "Super admins read all invoice files"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'invoices' AND public.is_super_admin(auth.uid()));

-- 2. Invoices: explicit per-command rules
DROP POLICY IF EXISTS "Tenant members manage own invoices" ON public.invoices;

CREATE POLICY "invoices read" ON public.invoices FOR SELECT TO authenticated
USING (tenant_id = public.current_tenant_id() OR public.is_super_admin(auth.uid()));

CREATE POLICY "invoices insert" ON public.invoices FOR INSERT TO authenticated
WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY "invoices update" ON public.invoices FOR UPDATE TO authenticated
USING (tenant_id = public.current_tenant_id())
WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY "invoices delete" ON public.invoices FOR DELETE TO authenticated
USING (
  (tenant_id = public.current_tenant_id() AND public.is_tenant_admin(auth.uid()))
  OR public.is_super_admin(auth.uid())
);

-- 3. Convert the security definer view to run as the caller
ALTER VIEW public.super_admin_subscribers SET (security_invoker = on);
REVOKE ALL ON public.super_admin_subscribers FROM anon, authenticated;
