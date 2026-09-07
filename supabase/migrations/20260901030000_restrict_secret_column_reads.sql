-- WhatsApp access_token/app_secret and the WordPress app_password are
-- written straight from the browser (the user has to paste them somewhere,
-- that part's unavoidable for a manual "paste your token" flow), but they
-- were also fully SELECT-able by any signed-in tenant member afterwards —
-- nothing stopped a non-admin from reading the raw secret back out via the
-- same Supabase client the settings page already uses. Full encryption at
-- rest would need every server-side reader of these columns
-- (wa.server.ts, flash-ai.server.ts, meta-health.functions.ts,
-- integration-health.server.ts, seo.server.ts) rewritten to call a decrypt
-- RPC — too large a change to make blind, without a way to test it live.
-- This is the immediately-safe half: nobody but service_role can read the
-- raw value back through the API at all, matching the platform_apps fix.
BEGIN;

REVOKE SELECT ON public.wa_numbers FROM authenticated;
GRANT SELECT (
  id, tenant_id, label, phone_number_id, display_phone, is_default, active,
  created_at, alerts_enabled, deliverability_min, read_rate_min
) ON public.wa_numbers TO authenticated;

-- NOTE: wordpress_sites was ALREADY column-restricted when it was created
-- (migration 20260824125051 grants select on everything except app_password).
-- This block is therefore a no-op safety net that re-asserts the same grant,
-- not a fix — the earlier claim that app_password was client-readable was
-- wrong. Kept so the intended grant is stated in one obvious place.
REVOKE SELECT ON public.wordpress_sites FROM authenticated;
GRANT SELECT (
  id, tenant_id, label, site_url, username, default_author, seo_plugin, created_at, created_by
) ON public.wordpress_sites TO authenticated;

COMMIT;
