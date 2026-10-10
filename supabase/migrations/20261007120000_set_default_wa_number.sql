-- ═════════════════════════════════════════════════════════════════════════════
-- Flas CRM — switching a workspace's default WhatsApp number, all or nothing.
--
-- "Make default" cleared the old default and set the new one as two separate
-- requests from the server. When the second one failed, the workspace was left
-- with no default number at all, and every send that relies on the default
-- stayed broken after the database had recovered.
--
-- This function does both writes in one call. A function call is one
-- statement in one transaction: if anything in it fails, everything it did is
-- undone and the previous default is exactly as it was.
--
-- It runs with the caller's own rights, and only the server's role
-- (service_role) may call it. The server checks that the caller is a company
-- admin and takes the workspace from their own profile before calling; the
-- function checks again that the number belongs to that workspace. No grant,
-- policy or index on wa_numbers is changed.
--
-- The application works the same before and after this is applied: until it
-- is, the database answers "no such function" and the server switches in two
-- steps, undoing the first if the second is refused.
--
-- Safe to run more than once.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.set_default_wa_number(_tenant_id uuid, _number_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF _tenant_id IS NULL OR _number_id IS NULL THEN
    RAISE EXCEPTION 'A workspace and a number are both required.' USING ERRCODE = '22004';
  END IF;

  -- One switch at a time per workspace. Two admins choosing different numbers
  -- at the same moment take turns here, so the second one sees what the first
  -- one did instead of colliding with it.
  PERFORM 1 FROM public.wa_numbers WHERE tenant_id = _tenant_id ORDER BY id FOR UPDATE;

  IF NOT EXISTS (
    SELECT 1 FROM public.wa_numbers WHERE id = _number_id AND tenant_id = _tenant_id
  ) THEN
    RAISE EXCEPTION 'That number is not connected to this workspace.' USING ERRCODE = 'P0002';
  END IF;

  -- The old default first: the unique index allows one default at a time.
  UPDATE public.wa_numbers
     SET is_default = false
   WHERE tenant_id = _tenant_id
     AND is_default
     AND id <> _number_id;

  UPDATE public.wa_numbers
     SET is_default = true
   WHERE id = _number_id
     AND tenant_id = _tenant_id
     AND NOT is_default;

  RETURN _number_id;
END;
$$;

COMMENT ON FUNCTION public.set_default_wa_number(uuid, uuid) IS
  'Makes one of a workspace''s own WhatsApp numbers its default, clearing the previous default in the same call: both happen or neither does. Returns the number. Server role only.';

REVOKE ALL ON FUNCTION public.set_default_wa_number(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_default_wa_number(uuid, uuid) TO service_role;

COMMIT;

-- So the API sees the new function straight away instead of at its next reload.
NOTIFY pgrst, 'reload schema';

-- Verification (read-only). Expect one row: runs_as_owner = false,
-- server_may_call = true, signed_in_user_may_call = false, visitor_may_call = false.
SELECT p.proname AS function,
       p.prosecdef AS runs_as_owner,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS server_may_call,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS signed_in_user_may_call,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS visitor_may_call
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname = 'set_default_wa_number';
