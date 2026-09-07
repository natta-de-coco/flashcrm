-- 1. Fixed search_path on the remaining two functions
CREATE OR REPLACE FUNCTION public.guard_super_admin_allowlist_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  RAISE EXCEPTION 'Platform super-admin allowlist entries cannot be removed via the API. Contact Mobi Digital Solutions.'
    USING ERRCODE = 'insufficient_privilege';
END; $function$;

CREATE OR REPLACE FUNCTION public.guard_super_admin_allowlist_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.email <> OLD.email THEN
    RAISE EXCEPTION 'Platform super-admin allowlist emails cannot be changed. Remove-then-add is also blocked.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END; $function$;

-- 2. Revoke EXECUTE on SECURITY DEFINER functions from anon/authenticated/PUBLIC.
--    These are internal: they run from triggers, from other definer functions, or
--    from server code using the service role. is_tenant_admin is excluded because
--    RLS policies evaluate it as the signed-in role.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosecdef
       AND p.proname <> 'is_tenant_admin'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

-- 3. wa_numbers: explicit per-command rules instead of one blanket policy
DROP POLICY IF EXISTS "Admins manage own tenant wa numbers" ON public.wa_numbers;

CREATE POLICY "wa numbers insert" ON public.wa_numbers
FOR INSERT TO authenticated
WITH CHECK (
  (tenant_id = public.current_tenant_id() AND public.is_tenant_admin(auth.uid()))
  OR public.is_super_admin(auth.uid())
);

CREATE POLICY "wa numbers update" ON public.wa_numbers
FOR UPDATE TO authenticated
USING (
  (tenant_id = public.current_tenant_id() AND public.is_tenant_admin(auth.uid()))
  OR public.is_super_admin(auth.uid())
)
WITH CHECK (
  (tenant_id = public.current_tenant_id() AND public.is_tenant_admin(auth.uid()))
  OR public.is_super_admin(auth.uid())
);

CREATE POLICY "wa numbers delete" ON public.wa_numbers
FOR DELETE TO authenticated
USING (
  (tenant_id = public.current_tenant_id() AND public.is_tenant_admin(auth.uid()))
  OR public.is_super_admin(auth.uid())
);