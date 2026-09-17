-- ═════════════════════════════════════════════════════════════════════════════
-- Cross-tenant data leak: any signed-in company admin could read EVERY
-- organization row on the platform.
--
-- Found by a production audit on 12 Sep 2026 and reproduced locally in
-- supabase/verify/verify-tenant-isolation.mjs, where an Acme company admin
-- listed both "Acme" and "Globex".
--
-- Cause, in two halves that are each defensible alone:
--
--   1. orgs_read_own (20260821141246) is
--        USING (id = public.current_tenant_id() OR public.has_role(auth.uid(),'admin'))
--      The second disjunct was written when 'admin' meant "platform operator".
--
--   2. Since then, onboarding grants that same legacy 'admin' role to every
--      customer who creates a workspace (completeOnboarding) and to every
--      invited company_admin (claimInvite) -- deliberately, because many
--      has_role()-gated policies would otherwise refuse them.
--
--      So "OR has_role(...,'admin')" now reads as "OR is any customer admin",
--      and the tenant filter is bypassed for all of them.
--
-- Exposed: every column, including name, plan, subscription_status,
-- subscription_renews_at, suspended, suspended_reason, currency, timezone and
-- the paddle_customer_id / paddle_subscription_id billing identifiers.
--
-- Platform staff keep cross-company access two ways that do NOT change here:
-- the orgs_super_admin_all policy (is_super_admin()), and the manager portal,
-- which goes through requireSuperAdmin() plus the service-role client and so
-- bypasses RLS entirely.
-- ═════════════════════════════════════════════════════════════════════════════

-- 1. Tenant-scoped SELECT. Super admins are named explicitly rather than
--    inherited from a role that customers also hold.
DROP POLICY IF EXISTS "orgs_read_own" ON public.organizations;
CREATE POLICY "orgs_read_own" ON public.organizations
  FOR SELECT TO authenticated
  USING (id = public.current_tenant_id() OR public.is_super_admin());

-- 2. Defence in depth: a customer has no reason to read payment-provider
--    identifiers for their own company either, and a future policy mistake
--    should not re-expose them. Every other column stays readable, computed
--    from the live column list so a column added later is granted by default
--    (fail-open on new columns is the right trade here: the alternative is a
--    silently broken app, and the tenant filter above is the real control).
--
--    Column-level grants need a table-level REVOKE first: a table-wide GRANT
--    cannot be narrowed by revoking single columns.
DO $$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO cols
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'organizations'
     AND column_name NOT IN ('paddle_customer_id', 'paddle_subscription_id');

  IF cols IS NULL THEN
    RAISE EXCEPTION 'organizations has no columns -- refusing to revoke SELECT';
  END IF;

  EXECUTE 'REVOKE SELECT ON public.organizations FROM authenticated';
  EXECUTE format('GRANT SELECT (%s) ON public.organizations TO authenticated', cols);
END $$;

-- The service role is untouched (GRANT ALL), which is what the Paddle webhook
-- and the manager portal use to read and write those identifiers.

-- ── Verification ─────────────────────────────────────────────────────────────
-- As a signed-in customer admin of one workspace:
--   select id from organizations;                        -- expect exactly 1 row
--   select paddle_customer_id from organizations;        -- expect: permission denied
-- Then run: node supabase/verify/verify-tenant-isolation.mjs
--
-- ── Rollback ─────────────────────────────────────────────────────────────────
-- Restores the previous (leaking) behaviour:
--
--   DROP POLICY IF EXISTS "orgs_read_own" ON public.organizations;
--   CREATE POLICY "orgs_read_own" ON public.organizations
--     FOR SELECT TO authenticated
--     USING (id = public.current_tenant_id() OR public.has_role(auth.uid(),'admin'));
--   GRANT SELECT ON public.organizations TO authenticated;
