-- ═════════════════════════════════════════════════════════════════════════════
-- Super-admin subscribers view, moved out of 20260830010000.
--
-- It was defined there alongside the OAuth and lockdown work, but it counts
-- public.messages by tenant_id and that column is only added by
-- 20260901000000. Postgres resolves the column when the view is created, so
-- on a database where 20260901 had not yet run this raised 42703 -- and
-- because 20260830010000 is a single transaction, it took the entire
-- migration down with it, including consume_oauth_state(). That is why
-- connecting a social account failed at the callback.
--
-- Splitting it out puts each statement after the thing it depends on.
--
-- Idempotent. Safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. SUPER-ADMIN VIEW: subscribers dashboard
--    One row per tenant with the info the platform owner needs for billing +
--    support.  is_super_admin() gates read.
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.super_admin_subscribers AS
SELECT
  o.id                        AS tenant_id,
  o.name                      AS company_name,
  o.slug,
  o.plan,
  o.subscription_status,
  o.subscription_renews_at,
  o.suspended,
  o.paddle_customer_id,
  o.paddle_subscription_id,
  o.country,
  o.currency,
  o.created_at                AS company_created_at,
  (SELECT count(*) FROM public.profiles p WHERE p.tenant_id = o.id) AS staff_count,
  (SELECT count(*) FROM public.wa_numbers w WHERE w.tenant_id = o.id AND w.active) AS active_wa_numbers,
  (SELECT count(*) FROM public.social_accounts a WHERE a.tenant_id = o.id AND a.active) AS active_social_accounts,
  (SELECT count(*) FROM public.contacts c WHERE c.tenant_id = o.id) AS contacts_count,
  (SELECT count(*) FROM public.messages m WHERE m.tenant_id = o.id) AS messages_count,
  (SELECT max(created_at) FROM public.messages m WHERE m.tenant_id = o.id) AS last_message_at
FROM public.organizations o;

GRANT SELECT ON public.super_admin_subscribers TO authenticated;
-- View doesn't have its own RLS; we scope via a WHERE clause enforced by the
-- underlying table policies + a safety CHECK in the SELECT policy on the
-- companies page that filters by is_super_admin.  Belt-and-braces:
CREATE OR REPLACE FUNCTION public.list_subscribers()
RETURNS SETOF public.super_admin_subscribers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Super admin only';
  END IF;
  RETURN QUERY SELECT * FROM public.super_admin_subscribers ORDER BY company_created_at DESC;
END; $$;
REVOKE ALL ON FUNCTION public.list_subscribers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_subscribers() TO authenticated;

COMMIT;
