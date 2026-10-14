-- Removing or re-roling a workspace member, as one step the database finishes
-- or does not start.
--
-- THE RACE. `user_roles` (the legacy role table) has no workspace column; the
-- real membership is profiles.tenant_id + profiles.staff_role. The server
-- functions removeStaff / setStaffRole first checked that the person belongs to
-- the caller's workspace and then wrote the legacy admin row and the profile as
-- separate requests. If that person accepted an invitation to ANOTHER workspace
-- between the check and the delete, claimInvites moved their profile and gave
-- them that workspace's admin role -- and the delete then took that new admin
-- role away, with the profile update (limited to the old workspace) matching
-- nothing and reporting an error only afterwards.
--
-- THE FIX. Both steps happen in one transaction, behind a row lock on the
-- profile. claimInvites moves the PROFILE first and writes the admin row after,
-- so holding the profile row is what orders the two: whichever gets there first
-- finishes before the other looks. If the person has already moved, the profile
-- no longer matches the workspace, the function answers false and nothing is
-- changed.
--
-- LAST ADMIN. The application also refuses to remove or demote the last company
-- admin. Checked outside a transaction, two admins acting on each other at the
-- same moment both pass. Here the workspace's admin rows are locked together
-- with the target (one statement, ordered by id, so two callers can never wait
-- on each other) and the count is read afterwards.
--
-- ERRORS (named, in the message):  last_company_admin   invalid_role
-- RETURNS: true = done;  false = that person is not a member of that workspace
--          (nothing was changed).
--
-- ORDER OF DEPLOYMENT: either. The application calls these functions when they
-- exist and falls back to its earlier ordered writes when they do not (the race
-- window is open in that case). Run this before or after the code is live.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.remove_workspace_member(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.set_workspace_member_role(uuid, uuid, text);
-- (the application then returns to the ordered writes by itself)
BEGIN;

CREATE OR REPLACE FUNCTION public.remove_workspace_member(_tenant_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _current public.staff_role;
  _admins integer;
  _changed integer;
BEGIN
  IF _tenant_id IS NULL OR _user_id IS NULL THEN
    RETURN false;
  END IF;

  -- The target (only if it still belongs to this workspace) and every company
  -- admin of the workspace, locked in one statement and in id order.
  PERFORM 1
    FROM public.profiles p
   WHERE p.tenant_id = _tenant_id
     AND (p.id = _user_id OR p.staff_role = 'company_admin')
   ORDER BY p.id
     FOR UPDATE;

  -- Read again now that the lock is held: a person who moved away while this
  -- call waited is no longer here.
  SELECT p.staff_role INTO _current
    FROM public.profiles p
   WHERE p.id = _user_id AND p.tenant_id = _tenant_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF _current = 'company_admin' THEN
    SELECT count(*) INTO _admins
      FROM public.profiles p
     WHERE p.tenant_id = _tenant_id AND p.staff_role = 'company_admin';
    IF _admins <= 1 THEN
      RAISE EXCEPTION 'last_company_admin'
        USING HINT = 'Promote someone else to company admin first.';
    END IF;
  END IF;

  UPDATE public.profiles
     SET tenant_id = NULL, staff_role = 'staff'
   WHERE id = _user_id AND tenant_id = _tenant_id;
  GET DIAGNOSTICS _changed = ROW_COUNT;
  IF _changed <> 1 THEN
    RETURN false;
  END IF;

  -- The legacy admin row is global (no workspace column): it must not follow
  -- the person out. Same transaction as the profile change above.
  DELETE FROM public.user_roles WHERE user_id = _user_id AND role = 'admin';

  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.set_workspace_member_role(_tenant_id uuid, _user_id uuid, _role text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _current public.staff_role;
  _admins integer;
  _changed integer;
BEGIN
  -- The roles a company admin can hand out (the app's RoleChangeSchema).
  -- super_admin is the platform owner's and is never set from here.
  IF _role IS NULL OR _role NOT IN ('company_admin', 'marketing_manager', 'staff', 'seo_editor') THEN
    RAISE EXCEPTION 'invalid_role' USING ERRCODE = '22023';
  END IF;
  IF _tenant_id IS NULL OR _user_id IS NULL THEN
    RETURN false;
  END IF;

  PERFORM 1
    FROM public.profiles p
   WHERE p.tenant_id = _tenant_id
     AND (p.id = _user_id OR p.staff_role = 'company_admin')
   ORDER BY p.id
     FOR UPDATE;

  SELECT p.staff_role INTO _current
    FROM public.profiles p
   WHERE p.id = _user_id AND p.tenant_id = _tenant_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF _current = 'company_admin' AND _role <> 'company_admin' THEN
    SELECT count(*) INTO _admins
      FROM public.profiles p
     WHERE p.tenant_id = _tenant_id AND p.staff_role = 'company_admin';
    IF _admins <= 1 THEN
      RAISE EXCEPTION 'last_company_admin'
        USING HINT = 'Promote someone else to company admin first.';
    END IF;
  END IF;

  UPDATE public.profiles
     SET staff_role = _role::public.staff_role
   WHERE id = _user_id AND tenant_id = _tenant_id;
  GET DIAGNOSTICS _changed = ROW_COUNT;
  IF _changed <> 1 THEN
    RETURN false;
  END IF;

  -- Two role systems, kept in line exactly as the application did: a company
  -- admin has the legacy admin row, anyone else does not.
  IF _role = 'company_admin' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (_user_id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    DELETE FROM public.user_roles WHERE user_id = _user_id AND role = 'admin';
  END IF;

  RETURN true;
END $$;

-- Server only. Supabase grants EXECUTE on new functions to anon and
-- authenticated by default; these change who belongs to a workspace.
REVOKE ALL ON FUNCTION public.remove_workspace_member(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_workspace_member_role(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_workspace_member(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_workspace_member_role(uuid, uuid, text) TO service_role;

COMMIT;

-- Verification (read-only). Expected: two rows, security_definer = true,
-- service_role_can_run = true, anon_can_run = false, authenticated_can_run = false.
SELECT p.proname AS function_name,
       p.prosecdef AS security_definer,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can_run,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_run,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_run
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('remove_workspace_member', 'set_workspace_member_role')
 ORDER BY p.proname;
