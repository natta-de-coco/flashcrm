ALTER FUNCTION public.current_tenant_id() SECURITY INVOKER;
ALTER FUNCTION public.has_active_subscription(uuid, text) SECURITY INVOKER;
ALTER FUNCTION public.has_role(uuid, public.app_role) SECURITY INVOKER;
ALTER FUNCTION public.is_super_admin(uuid) SECURITY INVOKER;