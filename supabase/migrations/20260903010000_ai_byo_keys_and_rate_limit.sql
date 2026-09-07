-- ═════════════════════════════════════════════════════════════════════════════
-- Two AI-layer problems, both in the same call path.
--
-- 1. "BRING YOUR OWN AI KEY" WAS A DEAD PROMISE.
--    ai_provider_keys has existed since 2026-08-22 and NOTHING in the codebase
--    ever read it. Every tenant who pasted their own OpenAI/Anthropic key into
--    Settings kept silently burning the shared platform key. That is a cost
--    problem and a truthfulness problem — the settings page implied otherwise.
--    Also: api_key is stored as plain text with no column restriction, so any
--    signed-in member of the tenant could read a colleague's key straight back
--    out of the API.
--
-- 2. NO RATE LIMITING ON ANY AI ENDPOINT.
--    Advisor, Flash AI, SEO writer, translate, catalog, connections, social and
--    train all call the model with no per-tenant ceiling. One authenticated
--    user in a loop is an unbounded bill.
--
-- Idempotent. Safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Stop the API key being readable by the whole tenant ──────────────────
-- Same treatment wa_numbers.access_token got: the server still reads it with
-- the service role, but no browser client can select the column.
REVOKE SELECT ON public.ai_provider_keys FROM authenticated;
GRANT SELECT (id, tenant_id, provider, label, active, created_at, created_by)
  ON public.ai_provider_keys TO authenticated;

-- ── 2. Per-tenant AI usage ledger ───────────────────────────────────────────
-- Deliberately small: one row per call, pruned by the caller. Enough to
-- enforce a rolling window and to show a tenant what they actually spent.
CREATE TABLE IF NOT EXISTS public.ai_usage_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  feature text NOT NULL,
  -- 'platform' when the shared key was used, else the tenant's provider.
  provider text NOT NULL DEFAULT 'platform',
  ok boolean NOT NULL DEFAULT true,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_usage_log_window_idx
  ON public.ai_usage_log (tenant_id, created_at DESC);
GRANT SELECT ON public.ai_usage_log TO authenticated;
GRANT ALL ON public.ai_usage_log TO service_role;
ALTER TABLE public.ai_usage_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ai_usage_log_read_tenant" ON public.ai_usage_log;
CREATE POLICY "ai_usage_log_read_tenant" ON public.ai_usage_log FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

-- ── 3. Rate check ───────────────────────────────────────────────────────────
-- Rolling hour and day ceilings per tenant. Returns the decision plus the
-- numbers behind it, so the caller can tell the user how long to wait rather
-- than just refusing.
CREATE OR REPLACE FUNCTION public.check_ai_rate_limit(
  _tenant_id uuid,
  _max_per_hour integer DEFAULT 120,
  _max_per_day integer DEFAULT 1000
) RETURNS TABLE (allowed boolean, reason text, used_hour integer, used_day integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _h integer; _d integer;
BEGIN
  SELECT COUNT(*) FILTER (WHERE created_at > now() - interval '1 hour'),
         COUNT(*) FILTER (WHERE created_at > now() - interval '1 day')
    INTO _h, _d
    FROM public.ai_usage_log
   WHERE tenant_id = _tenant_id AND ok = true;

  used_hour := COALESCE(_h, 0);
  used_day  := COALESCE(_d, 0);

  IF used_hour >= _max_per_hour THEN
    allowed := false; reason := 'hourly'; RETURN NEXT; RETURN;
  END IF;
  IF used_day >= _max_per_day THEN
    allowed := false; reason := 'daily'; RETURN NEXT; RETURN;
  END IF;
  allowed := true; reason := NULL; RETURN NEXT;
END; $$;
REVOKE ALL ON FUNCTION public.check_ai_rate_limit(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_ai_rate_limit(uuid, integer, integer) TO service_role;

-- ── 4. Record one call ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_ai_usage(
  _tenant_id uuid,
  _user_id uuid,
  _feature text,
  _provider text,
  _ok boolean,
  _duration_ms integer
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.ai_usage_log (tenant_id, user_id, feature, provider, ok, duration_ms)
  VALUES (_tenant_id, _user_id, _feature, COALESCE(_provider, 'platform'), COALESCE(_ok, true), _duration_ms);

  -- Keep the ledger bounded; the rate window only ever looks back one day.
  DELETE FROM public.ai_usage_log
   WHERE tenant_id = _tenant_id AND created_at < now() - interval '30 days';
END; $$;
REVOKE ALL ON FUNCTION public.record_ai_usage(uuid, uuid, text, text, boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_ai_usage(uuid, uuid, text, text, boolean, integer) TO service_role;

-- ── 5. Reveal a tenant's own provider key, server-side only ─────────────────
CREATE OR REPLACE FUNCTION public.get_tenant_ai_key(_tenant_id uuid)
RETURNS TABLE (provider text, api_key text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT k.provider, k.api_key
    FROM public.ai_provider_keys k
   WHERE k.tenant_id = _tenant_id AND k.active = true
   ORDER BY k.created_at DESC
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_tenant_ai_key(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_tenant_ai_key(uuid) TO service_role;

COMMIT;

-- ─── Sanity checks ──────────────────────────────────────────────────────────
-- SELECT * FROM public.check_ai_rate_limit('<a-tenant-uuid>');  -- allowed=true
-- SELECT COUNT(*) FROM public.ai_usage_log;                     -- 0 on first run
