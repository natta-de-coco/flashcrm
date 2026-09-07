-- ═════════════════════════════════════════════════════════════════════════════
-- FLAS CRM — v3.5
-- 1) Super-admin lockdown: moobbi@yahoo.com is undeletable, unsuspendable,
--    unremovable from the allowlist, and can never be downgraded.
-- 2) OAuth reliability: complete oauth_states schema, atomic state consumption
--    RPC, real PKCE storage per state row.
-- 3) Per-tenant webhook secret rotation helper + integrity guards.
--
-- Idempotent.  Run AFTER §6 mega migration + §13 email/OTP/SMTP migration.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. SUPER-ADMIN LOCKDOWN
-- Anchor: the address is stored ONCE in platform_super_admins.  Every guard
-- checks that table so if you ever add / remove super admins, the guards
-- follow automatically — moobbi@yahoo.com is just the seed row.
-- ═════════════════════════════════════════════════════════════════════════════

-- Ensure the seed row is present (idempotent).
INSERT INTO public.platform_super_admins (email)
VALUES ('moobbi@yahoo.com')
ON CONFLICT (email) DO NOTHING;

-- Helper: is this email a locked super-admin (i.e. in the allowlist)?
CREATE OR REPLACE FUNCTION public._is_locked_super_admin_email(_email text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_super_admins
     WHERE lower(email) = lower(_email)
  );
$$;
REVOKE ALL ON FUNCTION public._is_locked_super_admin_email(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._is_locked_super_admin_email(text) TO authenticated, service_role;

-- 1a. Cannot DELETE the row from platform_super_admins.
CREATE OR REPLACE FUNCTION public.guard_super_admin_allowlist_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Platform super-admin allowlist entries cannot be removed via the API. Contact Mobi Digital Solutions.'
    USING ERRCODE = 'insufficient_privilege';
END; $$;
DROP TRIGGER IF EXISTS platform_super_admins_guard_delete ON public.platform_super_admins;
CREATE TRIGGER platform_super_admins_guard_delete
  BEFORE DELETE ON public.platform_super_admins
  FOR EACH ROW EXECUTE FUNCTION public.guard_super_admin_allowlist_delete();

-- 1b. Cannot UPDATE the email of an existing allowlist row (would silently
--     downgrade the effective super admin).  Adding NEW rows is fine.
CREATE OR REPLACE FUNCTION public.guard_super_admin_allowlist_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.email <> OLD.email THEN
    RAISE EXCEPTION 'Platform super-admin allowlist emails cannot be changed. Remove-then-add is also blocked.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS platform_super_admins_guard_update ON public.platform_super_admins;
CREATE TRIGGER platform_super_admins_guard_update
  BEFORE UPDATE ON public.platform_super_admins
  FOR EACH ROW EXECUTE FUNCTION public.guard_super_admin_allowlist_update();

-- 1c. Cannot DELETE the profile row of any locked super admin.
CREATE OR REPLACE FUNCTION public.guard_super_admin_profile_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.email IS NOT NULL AND public._is_locked_super_admin_email(OLD.email) THEN
    RAISE EXCEPTION 'Cannot delete the profile of a platform super admin (%). The account is locked by policy.', OLD.email
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN OLD;
END; $$;
DROP TRIGGER IF EXISTS profiles_guard_super_admin_delete ON public.profiles;
CREATE TRIGGER profiles_guard_super_admin_delete
  BEFORE DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_super_admin_profile_delete();

-- 1d. Cannot DELETE the auth.users row of any locked super admin.
CREATE OR REPLACE FUNCTION public.guard_super_admin_auth_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.email IS NOT NULL AND public._is_locked_super_admin_email(OLD.email) THEN
    RAISE EXCEPTION 'Cannot delete the auth account of a platform super admin (%).', OLD.email
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN OLD;
END; $$;
DROP TRIGGER IF EXISTS auth_users_guard_super_admin_delete ON auth.users;
-- NB: creating triggers on auth.users requires elevated privileges. If Supabase
-- rejects this in your project, drop the trigger and rely on 1c (profile guard)
-- + 1e (role downgrade guard) instead.
DO $$ BEGIN
  BEGIN
    CREATE TRIGGER auth_users_guard_super_admin_delete
      BEFORE DELETE ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.guard_super_admin_auth_delete();
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping auth.users delete guard — requires SUPERUSER. Profile guard still protects the app.';
  END;
END $$;

-- 1e. Cannot change staff_role AWAY from super_admin for a locked email.
--     Also cannot set is_active = false / suspended = true on their tenant.
CREATE OR REPLACE FUNCTION public.guard_super_admin_downgrade()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.email IS NOT NULL AND public._is_locked_super_admin_email(NEW.email) THEN
    IF NEW.staff_role IS DISTINCT FROM 'super_admin' THEN
      RAISE EXCEPTION 'Cannot downgrade platform super admin (%). staff_role must remain super_admin.', NEW.email
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS profiles_guard_super_admin_downgrade ON public.profiles;
CREATE TRIGGER profiles_guard_super_admin_downgrade
  BEFORE UPDATE OF staff_role, email ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_super_admin_downgrade();

-- 1f. Cannot SUSPEND / DELETE the organization owned by a locked super admin.
--     A super admin's org is identified by profiles.tenant_id where they are staff_role='super_admin'.
CREATE OR REPLACE FUNCTION public.guard_super_admin_org()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _is_locked boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     JOIN public.platform_super_admins a ON lower(a.email) = lower(p.email)
     WHERE p.tenant_id = COALESCE(OLD.id, NEW.id)
       AND p.staff_role = 'super_admin'
  ) INTO _is_locked;
  IF NOT _is_locked THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Cannot delete the organization of a platform super admin.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.suspended = true AND (OLD.suspended IS DISTINCT FROM true) THEN
    RAISE EXCEPTION 'Cannot suspend the organization of a platform super admin.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS organizations_guard_super_admin ON public.organizations;
CREATE TRIGGER organizations_guard_super_admin
  BEFORE UPDATE OR DELETE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.guard_super_admin_org();

-- 1g. Cannot deactivate a super admin via user_roles.  Their admin role stays.
CREATE OR REPLACE FUNCTION public.guard_super_admin_role_removal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _email text;
BEGIN
  SELECT email INTO _email FROM auth.users WHERE id = OLD.user_id;
  IF _email IS NOT NULL AND public._is_locked_super_admin_email(_email) THEN
    IF OLD.role = 'admin' THEN
      RAISE EXCEPTION 'Cannot remove admin role from platform super admin (%).', _email
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN OLD;
END; $$;
DROP TRIGGER IF EXISTS user_roles_guard_super_admin_delete ON public.user_roles;
CREATE TRIGGER user_roles_guard_super_admin_delete
  BEFORE DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.guard_super_admin_role_removal();


-- ═════════════════════════════════════════════════════════════════════════════
-- 2. OAUTH RELIABILITY
--   - Complete `oauth_states` schema (columns the code assumes exist)
--   - Atomic single-use state consumption RPC
--   - Real per-state PKCE storage
-- ═════════════════════════════════════════════════════════════════════════════

-- 2a. Add / normalize columns the OAuth code path references.
--     Original schema had: state PK, platform, user_id, redirect_to, code_verifier, created_at.
--     The current code assumes: state, tenant_id, user_id, platform, redirect_uri, expires_at, used_at.
ALTER TABLE public.oauth_states
  ADD COLUMN IF NOT EXISTS tenant_id    uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS redirect_uri text,
  ADD COLUMN IF NOT EXISTS expires_at   timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  ADD COLUMN IF NOT EXISTS used_at      timestamptz,
  -- 2026-09-04: code_verifier was never actually added anywhere, despite the
  -- comment above claiming the original schema had it and despite this
  -- migration's own header promising "real per-state PKCE storage".
  --
  -- The app has always assumed it exists: oauth.server.ts inserts it when the
  -- flow starts (line ~201) and consume_oauth_state() returns it at the
  -- callback. src/integrations/supabase/types.ts declares it too, which is why
  -- TypeScript never objected -- that file is hand-maintained, so it asserted a
  -- column the database did not have.
  --
  -- Net effect: PKCE providers (X/Twitter) failed on the very first request of
  -- the OAuth flow, and consume_oauth_state() would have failed at the callback
  -- for every provider. Both ends of connecting a social account were broken.
  ADD COLUMN IF NOT EXISTS code_verifier text;

-- Backfill redirect_uri from legacy redirect_to if only that existed.
--
-- 2026-09-04: this block is why NONE of this migration ever applied. The
-- comment above assumed the original schema had `redirect_to`, but the
-- migration that actually created oauth_states (20260826163049) declared
-- `redirect_uri text NOT NULL` from the start. `redirect_to` has never
-- existed in any version of this schema.
--
-- Postgres resolves column names in a plain UPDATE at parse time, so this
-- statement raised 42703 immediately -- and since the whole file is one
-- transaction (BEGIN line 12 / COMMIT line 335), everything below it rolled
-- back with it: consume_oauth_state, purge_expired_oauth_states,
-- rotate_site_webhook_secret, rotate_wa_number_app_secret, list_subscribers,
-- and every super-admin lockdown trigger above.
--
-- The visible symptom was that connecting a social account always failed at
-- the callback, because oauth.server.ts calls consume_oauth_state() and the
-- function was never created.
--
-- Now guarded: run the backfill only if a legacy column is actually present.
-- EXECUTE keeps the column name out of the parser until we know it exists.
DO $backfill$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'oauth_states'
       AND column_name = 'redirect_to'
  ) THEN
    EXECUTE 'UPDATE public.oauth_states
                SET redirect_uri = redirect_to
              WHERE redirect_uri IS NULL AND redirect_to IS NOT NULL';
  END IF;
END $backfill$;

CREATE INDEX IF NOT EXISTS oauth_states_tenant_idx ON public.oauth_states (tenant_id);
CREATE INDEX IF NOT EXISTS oauth_states_expires_idx ON public.oauth_states (expires_at);

-- 2b. Atomic single-use state consumption.  Prevents the race where two
--     concurrent callbacks with the same state both succeed.
CREATE OR REPLACE FUNCTION public.consume_oauth_state(_state text)
RETURNS TABLE (
  id text,
  tenant_id uuid,
  user_id uuid,
  platform text,
  redirect_uri text,
  code_verifier text
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  UPDATE public.oauth_states s
     SET used_at = now()
   WHERE s.state = _state
     AND s.used_at IS NULL
     AND s.expires_at > now()
  RETURNING s.state, s.tenant_id, s.user_id, s.platform, s.redirect_uri, s.code_verifier;
END; $$;
REVOKE ALL ON FUNCTION public.consume_oauth_state(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_oauth_state(text) TO service_role;

-- 2c. Housekeeping: purge stale states (idempotent; safe to call regularly).
CREATE OR REPLACE FUNCTION public.purge_expired_oauth_states()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n integer;
BEGIN
  DELETE FROM public.oauth_states
   WHERE expires_at < now() - interval '1 day'
      OR (used_at IS NOT NULL AND used_at < now() - interval '1 day');
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END; $$;
REVOKE ALL ON FUNCTION public.purge_expired_oauth_states() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_oauth_states() TO service_role;


-- ═════════════════════════════════════════════════════════════════════════════
-- 3. PER-TENANT WEBHOOK SECRET HELPERS
--    Each customer has a per-site webhook_secret (already on lead_sites,
--    added in migration 20260822162946).  Provide a rotation RPC + view.
-- ═════════════════════════════════════════════════════════════════════════════

-- 3a. Rotate a site's webhook secret.  Company admin only.
CREATE OR REPLACE FUNCTION public.rotate_site_webhook_secret(_site_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tid uuid; _new text;
BEGIN
  SELECT tenant_id INTO _tid FROM public.lead_sites WHERE id = _site_id;
  IF _tid IS NULL THEN RAISE EXCEPTION 'Site not found'; END IF;
  IF _tid <> public.current_tenant_id() AND NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'You can only rotate secrets for your own workspace';
  END IF;
  IF NOT public.has_role(auth.uid(), 'admin') AND NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only admins can rotate webhook secrets';
  END IF;
  _new := encode(gen_random_bytes(24), 'hex');
  UPDATE public.lead_sites SET webhook_secret = _new WHERE id = _site_id;

  INSERT INTO public.audit_log (tenant_id, actor_id, actor_label, action, entity_type, entity_id, details)
  VALUES (_tid, auth.uid(),
          (SELECT email FROM public.profiles WHERE id = auth.uid()),
          'webhook.secret_rotated', 'lead_site', _site_id::text, '{}'::jsonb);
  RETURN _new;
END; $$;
REVOKE ALL ON FUNCTION public.rotate_site_webhook_secret(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rotate_site_webhook_secret(uuid) TO authenticated, service_role;

-- 3b. Same for wa_numbers.app_secret (per-number WhatsApp app secret rotation).
CREATE OR REPLACE FUNCTION public.rotate_wa_number_app_secret(_wa_number_id uuid, _new_secret text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tid uuid;
BEGIN
  SELECT tenant_id INTO _tid FROM public.wa_numbers WHERE id = _wa_number_id;
  IF _tid IS NULL THEN RAISE EXCEPTION 'WhatsApp number not found'; END IF;
  IF _tid <> public.current_tenant_id() AND NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'You can only rotate secrets for your own workspace';
  END IF;
  IF NOT public.has_role(auth.uid(), 'admin') AND NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only admins can rotate WhatsApp app secrets';
  END IF;
  UPDATE public.wa_numbers SET app_secret = _new_secret WHERE id = _wa_number_id;

  INSERT INTO public.audit_log (tenant_id, actor_id, actor_label, action, entity_type, entity_id, details)
  VALUES (_tid, auth.uid(),
          (SELECT email FROM public.profiles WHERE id = auth.uid()),
          'wa_number.secret_rotated', 'wa_number', _wa_number_id::text, '{}'::jsonb);
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.rotate_wa_number_app_secret(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rotate_wa_number_app_secret(uuid, text) TO authenticated, service_role;


-- NOTE (2026-09-04): the super-admin subscribers view that used to live here
-- has moved to 20260904010000. It counts public.messages by tenant_id, and
-- that column is not added until 20260901000000 -- so defining it here made
-- this whole transaction fail on any database where 20260901 had not run yet.
-- The dependency is real, so the code runs later rather than being weakened.

COMMIT;

-- ─── Sanity checks ─────────────────────────────────────────────────────────
-- SELECT public._is_locked_super_admin_email('moobbi@yahoo.com');  -- true
-- SELECT public._is_locked_super_admin_email('random@example.com'); -- false
-- Try deletion (should raise): DELETE FROM public.platform_super_admins WHERE email='moobbi@yahoo.com';
-- Try downgrade (should raise): UPDATE public.profiles SET staff_role='staff' WHERE email='moobbi@yahoo.com';
-- SELECT * FROM public.list_subscribers();  -- works only when signed in as super admin
