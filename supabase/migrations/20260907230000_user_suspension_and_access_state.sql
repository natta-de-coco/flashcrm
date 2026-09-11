-- ═════════════════════════════════════════════════════════════════════════════
-- Suspension that actually suspends, and one place that decides access.
--
-- organizations.suspended already existed and the manager portal already had a
-- button for it -- but the only code that read the flag was safety.server.ts,
-- which gates *sending a WhatsApp message*. A suspended company could still
-- sign in, read every conversation, export contacts and issue invoices. The
-- button looked like it cut off access and did not.
--
-- There was also no way to suspend one person. If a single agent leaves under a
-- cloud, the only lever was suspending their whole company.
--
-- Adds:
--   profiles.suspended        -- per-user, so one person can be cut off
--   access_state(uuid)        -- the single answer to "can this account work?"
--
-- access_state returns 'ok', 'user_suspended', 'company_suspended', or
-- 'unpaid', so the app can say which of those it is instead of a blank refusal.
-- Enforcement lives in the auth middleware, so it covers every server function
-- at once rather than being remembered per feature.
--
-- Idempotent. Safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS suspended boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_reason text;

CREATE INDEX IF NOT EXISTS profiles_suspended_idx
  ON public.profiles (tenant_id) WHERE suspended;

-- A platform super admin can never be locked out of their own platform: the
-- same reasoning as the existing downgrade and delete guards.
CREATE OR REPLACE FUNCTION public.guard_super_admin_suspend()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.suspended = true AND NEW.email IS NOT NULL
     AND public._is_locked_super_admin_email(NEW.email) THEN
    RAISE EXCEPTION 'Cannot suspend the platform super admin (%).', NEW.email
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS profiles_guard_super_admin_suspend ON public.profiles;
CREATE TRIGGER profiles_guard_super_admin_suspend
  BEFORE UPDATE OF suspended ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_super_admin_suspend();

-- ── One place that answers "can this account work right now?" ───────────────
-- SECURITY DEFINER: it reads profiles and organizations, and must not be
-- subject to the very policies it exists to support.
CREATE OR REPLACE FUNCTION public.access_state(_user uuid DEFAULT auth.uid())
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _p record; _o record;
BEGIN
  SELECT suspended, tenant_id, staff_role INTO _p
    FROM public.profiles WHERE id = _user;
  IF _p IS NULL THEN RETURN 'ok'; END IF;           -- pre-onboarding

  -- The platform owner is never blocked, including by their own billing.
  IF _p.staff_role = 'super_admin' THEN RETURN 'ok'; END IF;

  IF _p.suspended THEN RETURN 'user_suspended'; END IF;
  IF _p.tenant_id IS NULL THEN RETURN 'ok'; END IF; -- no workspace yet

  SELECT suspended, subscription_status, subscription_renews_at INTO _o
    FROM public.organizations WHERE id = _p.tenant_id;
  IF _o IS NULL THEN RETURN 'ok'; END IF;

  IF _o.suspended THEN RETURN 'company_suspended'; END IF;

  -- Past the paid period, with no trial or active status to stand on.
  IF _o.subscription_renews_at IS NOT NULL
     AND _o.subscription_renews_at < now()
     AND COALESCE(_o.subscription_status, '') NOT IN ('active', 'trialing', 'trial') THEN
    RETURN 'unpaid';
  END IF;

  RETURN 'ok';
END; $$;
REVOKE ALL ON FUNCTION public.access_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.access_state(uuid) TO authenticated, service_role;

-- ── What the manager portal needs, in one row per company ───────────────────
-- security_invoker so it is the caller's own permissions that decide, not the
-- view owner's -- the same correction Lovable applied to super_admin_subscribers.
CREATE OR REPLACE VIEW public.company_billing_overview
WITH (security_invoker = on) AS
SELECT o.id,
       o.name,
       o.slug,
       o.plan,
       o.subscription_status,
       o.subscription_renews_at                                   AS paid_until,
       o.suspended,
       o.created_at,
       CASE
         WHEN o.suspended THEN 'suspended'
         WHEN o.subscription_renews_at IS NULL THEN 'no billing set'
         WHEN o.subscription_renews_at < now() THEN 'expired'
         WHEN o.subscription_renews_at < now() + interval '7 days' THEN 'expiring soon'
         ELSE 'paid'
       END                                                        AS billing_state,
       GREATEST(0, EXTRACT(DAY FROM o.subscription_renews_at - now())::int) AS days_remaining,
       (SELECT count(*) FROM public.profiles p WHERE p.tenant_id = o.id)                  AS members,
       (SELECT count(*) FROM public.profiles p WHERE p.tenant_id = o.id AND p.suspended)  AS members_suspended,
       (SELECT count(*) FROM public.contacts c WHERE c.tenant_id = o.id)                  AS contacts,
       (SELECT count(*) FROM public.messages  m WHERE m.tenant_id = o.id)                 AS messages,
       (SELECT max(p.last_seen_at) FROM public.profiles p WHERE p.tenant_id = o.id)       AS last_active,
       o.subscription_renews_at                                   AS subscription_renews_at
  FROM public.organizations o;

GRANT SELECT ON public.company_billing_overview TO authenticated;

COMMIT;

-- ─── Sanity checks ──────────────────────────────────────────────────────────
-- SELECT public.access_state();                       -- 'ok' for a healthy account
-- SELECT name, billing_state, days_remaining, members FROM public.company_billing_overview;
-- Suspending the platform owner must raise:
-- UPDATE public.profiles SET suspended = true WHERE email = 'moobbi@yahoo.com';
