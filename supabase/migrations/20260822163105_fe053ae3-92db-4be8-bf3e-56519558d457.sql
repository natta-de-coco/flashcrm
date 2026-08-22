REVOKE EXECUTE ON FUNCTION public.has_active_subscription(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.has_active_subscription(uuid, text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.current_tenant_id() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;