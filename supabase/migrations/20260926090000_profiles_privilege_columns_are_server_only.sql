-- Any signed-in user could make themselves platform super admin.
--
-- Three things lined up:
--   1. `GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated`
--      (20260820134904) is table-wide, so it covers every column added later --
--      including staff_role (20260821141246), tenant_id and suspended. No
--      REVOKE was ever issued.
--   2. The policy `profiles_update_self` allows UPDATE where `id = auth.uid()`,
--      and unlike every other broad policy from that first migration it was
--      never dropped or narrowed.
--   3. `is_super_admin()` is simply "does my own profiles row say super_admin".
--
-- So one request with a publishable key and the user's own JWT --
--   PATCH /rest/v1/profiles?id=eq.<self>   {"staff_role":"super_admin"}
-- -- granted the platform owner's role: every customer's leads, contacts,
-- numbers, invoices and message previews through the manager portal, and the
-- ability to suspend any workspace. `{"tenant_id":"<other org>"}` in the same
-- request repointed the account into another workspace for every tenant-scoped
-- policy, and `{"suspended":false}` undid a suspension.
--
-- Neither existing trigger stopped it: guard_super_admin_downgrade only refuses
-- to move an allowlisted email AWAY from super_admin, and
-- apply_super_admin_allowlist only ever grants the role to a listed address.
--
-- The control here is the column grant, because it applies whichever policy
-- matched. The trigger is the second line of defence.
--
-- ORDER OF DEPLOYMENT: the code change that moves setStaffRole to the service
-- role must be live before this runs, or changing a teammate's role fails with
-- "permission denied for table profiles". Merge the PR, wait for the deploy,
-- then run this.
BEGIN;

-- ── 1. A signed-in user may only edit their own presentational fields ───────
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (full_name, avatar_url, last_seen_at) ON public.profiles TO authenticated;

COMMENT ON COLUMN public.profiles.staff_role IS
  'Set by the server only (service role). A browser-role UPDATE of this column is refused by grant and by trigger: it decides platform super admin.';

-- ── 2. Second line of defence ───────────────────────────────────────────────
-- If a future migration re-grants the table by accident, this still refuses.
CREATE OR REPLACE FUNCTION public.guard_profile_privilege_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _jwt_role text := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  );
BEGIN
  -- The service role and a direct database session are the server.
  IF _jwt_role = 'service_role' OR current_user IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.staff_role IS DISTINCT FROM OLD.staff_role
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.suspended IS DISTINCT FROM OLD.suspended
     OR NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION
      'staff_role, tenant_id, suspended and email on a profile are changed by the server, not from a browser session.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS profiles_guard_privilege_columns ON public.profiles;
CREATE TRIGGER profiles_guard_privilege_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_privilege_columns();

COMMIT;

-- ── Verification (run after the commit) ─────────────────────────────────────
-- The authenticated role must hold UPDATE on exactly three columns:
--   SELECT column_name FROM information_schema.column_privileges
--   WHERE table_schema='public' AND table_name='profiles'
--     AND grantee='authenticated' AND privilege_type='UPDATE'
--   ORDER BY column_name;
--   -- expected: avatar_url, full_name, last_seen_at
--
-- And no table-level UPDATE:
--   SELECT privilege_type FROM information_schema.table_privileges
--   WHERE table_schema='public' AND table_name='profiles' AND grantee='authenticated';
--   -- expected: SELECT, INSERT   (no UPDATE)
--
-- Then confirm nobody escalated while the hole was open. Every super admin
-- should be an address you recognise:
--   SELECT id, email, staff_role, tenant_id, created_at
--   FROM public.profiles WHERE staff_role = 'super_admin' ORDER BY created_at;
--
-- And check the allowlist table it is supposed to come from:
--   SELECT email FROM public.platform_super_admins;
--
-- Any super_admin whose email is not in that list, and is not yours, was either
-- promoted by hand or took this path. Audit their activity:
--   SELECT created_at, action, entity_type, entity_id, details
--   FROM public.audit_log WHERE actor_id = '<that id>' ORDER BY created_at DESC LIMIT 200;
