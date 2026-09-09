CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$ SELECT tenant_id FROM public.profiles WHERE id = auth.uid() $function$;

REVOKE ALL ON FUNCTION public.current_tenant_id() FROM anon;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO authenticated, service_role;