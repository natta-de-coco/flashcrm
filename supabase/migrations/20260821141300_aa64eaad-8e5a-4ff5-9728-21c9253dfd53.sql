REVOKE EXECUTE ON FUNCTION public.current_tenant_id() FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO service_role;