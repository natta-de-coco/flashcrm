-- ═════════════════════════════════════════════════════════════════════════════
-- Social Connection Doctor — capability-level health, test history, and a
-- real error engine that preserves provider error codes.
--
-- Additive only. The existing social_accounts row (health, status_reason,
-- granted_scopes, token_expires_at, retry_count...) stays exactly as it is
-- and remains the "is the login alive" record. What it could never express
-- is the thing the Doctor exists for: an account whose AUTH is fine while
-- MESSAGING is broken and ADS was never granted. That needs one row per
-- capability, which is what social_capabilities adds.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Per-capability health ────────────────────────────────────────────────
-- One row per (account, capability). This is the fix for "never use a single
-- boolean as the only integration status".
CREATE TABLE IF NOT EXISTS public.social_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.social_accounts(id) ON DELETE CASCADE,
  -- 'profile_read' | 'posts_read' | 'comments_read' | 'comments_reply' |
  -- 'messages_read' | 'messages_send' | 'publish_image' | 'publish_video' |
  -- 'schedule' | 'analytics' | 'follower_stats' | 'ads_read' | 'webhooks' ...
  capability text NOT NULL,
  status text NOT NULL DEFAULT 'unknown'
    CHECK (status IN ('working','degraded','missing_permission','unsupported','failing','untested','unknown')),
  -- Permission side and live-test side are tracked separately on purpose:
  -- a granted scope does NOT prove the call actually succeeds (§5).
  permission_state text NOT NULL DEFAULT 'unknown'
    CHECK (permission_state IN ('granted','missing','declined','expired','requires_admin','requires_review','not_supported','unknown')),
  tested_at timestamptz,
  test_outcome text CHECK (test_outcome IN ('pass','fail','warning','skipped','not_supported')),
  detail text,
  required_scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
  missing_scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, capability)
);
CREATE INDEX IF NOT EXISTS social_capabilities_tenant_idx ON public.social_capabilities (tenant_id);
CREATE INDEX IF NOT EXISTS social_capabilities_account_idx ON public.social_capabilities (account_id);
GRANT SELECT ON public.social_capabilities TO authenticated;
GRANT ALL ON public.social_capabilities TO service_role;
ALTER TABLE public.social_capabilities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "social_capabilities_read_tenant" ON public.social_capabilities;
CREATE POLICY "social_capabilities_read_tenant" ON public.social_capabilities FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
DROP TRIGGER IF EXISTS social_capabilities_updated ON public.social_capabilities;
CREATE TRIGGER social_capabilities_updated BEFORE UPDATE ON public.social_capabilities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 2. Connection test runs ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.social_connection_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.social_accounts(id) ON DELETE CASCADE,
  triggered_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  trigger text NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual','auto','post_oauth','pre_publish','scheduled')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  -- Overall verdict, mirroring the statuses the Hub renders.
  verdict text CHECK (verdict IN ('healthy','partial','action_required','expiring_soon','limited','disconnected','error')),
  health_score integer CHECK (health_score BETWEEN 0 AND 100),
  summary text,
  duration_ms integer
);
CREATE INDEX IF NOT EXISTS social_connection_tests_account_idx
  ON public.social_connection_tests (account_id, started_at DESC);
CREATE INDEX IF NOT EXISTS social_connection_tests_tenant_idx
  ON public.social_connection_tests (tenant_id, started_at DESC);
GRANT SELECT ON public.social_connection_tests TO authenticated;
GRANT ALL ON public.social_connection_tests TO service_role;
ALTER TABLE public.social_connection_tests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "social_connection_tests_read_tenant" ON public.social_connection_tests;
CREATE POLICY "social_connection_tests_read_tenant" ON public.social_connection_tests FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

-- ── 3. Individual checks inside a run ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.social_test_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id uuid NOT NULL REFERENCES public.social_connection_tests(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- 'authentication' | 'identity' | 'token' | 'permissions' | 'capability:<name>' | 'webhook'
  check_key text NOT NULL,
  label text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('pass','fail','warning','skipped','not_supported')),
  detail text,
  http_status integer,
  provider_code text,
  duration_ms integer,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS social_test_results_test_idx ON public.social_test_results (test_id, position);
GRANT SELECT ON public.social_test_results TO authenticated;
GRANT ALL ON public.social_test_results TO service_role;
ALTER TABLE public.social_test_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "social_test_results_read_tenant" ON public.social_test_results;
CREATE POLICY "social_test_results_read_tenant" ON public.social_test_results FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

-- ── 4. Integration error engine ─────────────────────────────────────────────
-- Deduplicated by fingerprint so 37 identical failures are ONE row with a
-- count, not 37 rows. Provider code/subcode/type are preserved verbatim —
-- a generic "something failed" string is useless for debugging Meta.
CREATE TABLE IF NOT EXISTS public.integration_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id uuid REFERENCES public.social_accounts(id) ON DELETE CASCADE,
  platform text NOT NULL,
  feature text,
  operation text,
  http_status integer,
  provider_code text,
  provider_subcode text,
  provider_type text,
  -- Redacted before storage — never contains tokens or secrets.
  provider_message text,
  friendly_title text NOT NULL,
  friendly_message text NOT NULL,
  likely_cause text,
  recommended_fix text,
  severity text NOT NULL DEFAULT 'warning'
    CHECK (severity IN ('info','warning','action_required','critical','system_failure')),
  retryable boolean NOT NULL DEFAULT false,
  api_version text,
  fingerprint text NOT NULL,
  occurrence_count integer NOT NULL DEFAULT 1,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (tenant_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS integration_errors_tenant_idx
  ON public.integration_errors (tenant_id, last_seen DESC);
CREATE INDEX IF NOT EXISTS integration_errors_account_idx ON public.integration_errors (account_id);
CREATE INDEX IF NOT EXISTS integration_errors_unresolved_idx
  ON public.integration_errors (tenant_id, severity) WHERE resolved_at IS NULL;
GRANT SELECT ON public.integration_errors TO authenticated;
GRANT ALL ON public.integration_errors TO service_role;
ALTER TABLE public.integration_errors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "integration_errors_read_tenant" ON public.integration_errors;
CREATE POLICY "integration_errors_read_tenant" ON public.integration_errors FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

-- Records/updates one error occurrence. Service-role only: this is called
-- from server code, never from a browser.
CREATE OR REPLACE FUNCTION public.record_integration_error(
  _tenant_id uuid,
  _account_id uuid,
  _platform text,
  _feature text,
  _operation text,
  _http_status integer,
  _provider_code text,
  _provider_subcode text,
  _provider_type text,
  _provider_message text,
  _friendly_title text,
  _friendly_message text,
  _likely_cause text,
  _recommended_fix text,
  _severity text,
  _retryable boolean,
  _api_version text,
  _fingerprint text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid;
BEGIN
  INSERT INTO public.integration_errors (
    tenant_id, account_id, platform, feature, operation, http_status,
    provider_code, provider_subcode, provider_type, provider_message,
    friendly_title, friendly_message, likely_cause, recommended_fix,
    severity, retryable, api_version, fingerprint
  ) VALUES (
    _tenant_id, _account_id, _platform, _feature, _operation, _http_status,
    _provider_code, _provider_subcode, _provider_type, _provider_message,
    _friendly_title, _friendly_message, _likely_cause, _recommended_fix,
    COALESCE(_severity,'warning'), COALESCE(_retryable,false), _api_version, _fingerprint
  )
  ON CONFLICT (tenant_id, fingerprint) DO UPDATE
    SET occurrence_count = public.integration_errors.occurrence_count + 1,
        last_seen = now(),
        http_status = EXCLUDED.http_status,
        provider_message = EXCLUDED.provider_message,
        -- A recurrence un-resolves a previously resolved error.
        resolved_at = NULL
  RETURNING id INTO _id;
  RETURN _id;
END; $$;
REVOKE ALL ON FUNCTION public.record_integration_error(uuid,uuid,text,text,text,integer,text,text,text,text,text,text,text,text,text,boolean,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_integration_error(uuid,uuid,text,text,text,integer,text,text,text,text,text,text,text,text,text,boolean,text,text) TO service_role;

COMMIT;

-- ─── Sanity checks ──────────────────────────────────────────────────────────
-- SELECT COUNT(*) FROM public.social_capabilities;        -- 0 until a test runs
-- SELECT COUNT(*) FROM public.social_connection_tests;    -- 0 until a test runs
-- SELECT COUNT(*) FROM public.integration_errors;         -- 0 on a clean install
