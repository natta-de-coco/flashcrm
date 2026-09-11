-- ═════════════════════════════════════════════════════════════════════════════
-- Fix social/OAuth connection permissions, company_billing_overview column,
-- and social_accounts RLS admin role checks.
--
-- 1. OAUTH & CONNECTION HEALTH HELPER FUNCTIONS
--    try_lock_connection_refresh, consume_oauth_state_hash,
--    record_integration_error and expire_abandoned_oauth_attempts were previously
--    restricted exclusively to service_role, causing "permission denied" errors
--    when invoked through user actions or authenticated RPC contexts.
--
-- 2. SOCIAL ACCOUNTS GRANTS & RLS
--    social_accounts lacked column-level INSERT/UPDATE grants for newer columns
--    (connection_state, state_reason, state_changed_at, refresh_token, tenant_id, stats).
--    Furthermore, its RLS management policy still used has_role(auth.uid(), 'admin')
--    rather than is_tenant_admin(), blocking company admins in profiles.
--
-- 3. COMPANY BILLING OVERVIEW
--    The view aliased subscription_renews_at as paid_until without publishing
--    subscription_renews_at directly, crashing queries that order by
--    subscription_renews_at. Adding it to the end of the view satisfies
--    Postgres CREATE OR REPLACE VIEW requirements while making both column
--    names available.
--
-- Idempotent. Safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Helper function permissions ───────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.try_lock_connection_refresh(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_connection_refresh(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consume_oauth_state_hash(text) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.expire_abandoned_oauth_attempts() TO authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'record_integration_error'
  ) THEN
    GRANT EXECUTE ON FUNCTION public.record_integration_error(
      uuid, uuid, text, text, text, integer, text, text, text, text, text, text, text, text, text, boolean, text, text
    ) TO authenticated, service_role;
  END IF;
END $$;

-- ── 2. social_accounts grants & RLS policy ────────────────────────────────────
GRANT SELECT (connection_state, state_reason, state_changed_at, refresh_token, refresh_locked_until, stats)
  ON public.social_accounts TO authenticated;

GRANT INSERT (tenant_id, connection_state, state_reason, refresh_token, refresh_locked_until, stats)
  ON public.social_accounts TO authenticated;

GRANT UPDATE (connection_state, state_reason, refresh_token, refresh_locked_until, stats)
  ON public.social_accounts TO authenticated;

DROP POLICY IF EXISTS "Admins manage social accounts" ON public.social_accounts;
CREATE POLICY "Admins manage social accounts" ON public.social_accounts
  FOR ALL TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.is_tenant_admin() OR public.is_super_admin())
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (public.is_tenant_admin() OR public.is_super_admin())
  );

-- ── 3. company_billing_overview view update ──────────────────────────────────
-- Appends subscription_renews_at so existing column order is preserved for
-- CREATE OR REPLACE VIEW compatibility, while giving queries their column.
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
