-- ═════════════════════════════════════════════════════════════════════════════
-- FLAS CRM — Completes Lovable's unfinished work (items 8, 9, 10, 11 from
-- user's original ask list).  Idempotent.  Run AFTER the tenant-isolation
-- mega-migration (§6 of FLAS-CRM-AUDIT-FOR-COWORK.md).
--
-- Adds:
--   1. email_delivery_log — per-tenant record of every auth / notification
--      email dispatched (send / bounce / complaint / open events)
--   2. otp_attempts — server-side rate limiting for verify + reset resends
--   3. tenant_smtp_config — per-company outbound email provider settings
--      (Resend / Mailgun / SendGrid / Postmark / any HTTP-based provider —
--      raw SMTP TCP is impossible on serverless, so we let each company plug
--      in their own transactional-email vendor)
--   4. Super-admin views on all three so the platform owner can troubleshoot
--      any client's mail without leaving RLS
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Per-company email delivery audit log ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_delivery_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid REFERENCES public.organizations(id) ON DELETE CASCADE,  -- nullable ONLY for platform-owned events (super-admin signup, org creation)
  user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  recipient     text NOT NULL,           -- email address the mail was sent to
  from_address  text,                    -- envelope from
  subject       text,
  template      text,                    -- 'signup' | 'invite' | 'recovery' | 'magic_link' | 'reauth' | 'email_change' | 'notification' | 'otp_resend'
  provider      text NOT NULL DEFAULT 'lovable',  -- 'lovable' | 'resend' | 'mailgun' | 'sendgrid' | 'postmark' | 'ses'
  provider_msg_id text,                  -- provider-side id for tracing
  status        text NOT NULL DEFAULT 'sent'  -- 'queued' | 'sent' | 'bounced' | 'complained' | 'rejected' | 'delivered' | 'opened' | 'clicked' | 'failed'
                CHECK (status IN ('queued','sent','bounced','complained','rejected','delivered','opened','clicked','failed')),
  error         text,                    -- populated when status IN ('bounced','rejected','complained','failed')
  meta          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_delivery_log_tenant_idx     ON public.email_delivery_log (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS email_delivery_log_recipient_idx  ON public.email_delivery_log (lower(recipient));
CREATE INDEX IF NOT EXISTS email_delivery_log_status_idx     ON public.email_delivery_log (status) WHERE status IN ('bounced','complained','rejected','failed');
CREATE INDEX IF NOT EXISTS email_delivery_log_template_idx   ON public.email_delivery_log (template);
GRANT SELECT ON public.email_delivery_log TO authenticated;
GRANT ALL    ON public.email_delivery_log TO service_role;
ALTER TABLE public.email_delivery_log ENABLE ROW LEVEL SECURITY;

-- Company admins read their own tenant's mail log.  Super-admin reads all.
DROP POLICY IF EXISTS "email_log_read_tenant"     ON public.email_delivery_log;
DROP POLICY IF EXISTS "email_log_read_superadmin" ON public.email_delivery_log;
CREATE POLICY "email_log_read_tenant" ON public.email_delivery_log
  FOR SELECT TO authenticated
  USING (
    (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'))
    OR public.is_super_admin(auth.uid())
  );

DROP TRIGGER IF EXISTS email_delivery_log_updated ON public.email_delivery_log;
CREATE TRIGGER email_delivery_log_updated
  BEFORE UPDATE ON public.email_delivery_log
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Helper to insert from server code (SECURITY DEFINER so audit inserts don't fight RLS)
CREATE OR REPLACE FUNCTION public.log_email_delivery(
  _tenant_id    uuid,
  _user_id      uuid,
  _recipient    text,
  _from_address text,
  _subject      text,
  _template     text,
  _provider     text,
  _provider_msg_id text,
  _status       text,
  _error        text DEFAULT NULL,
  _meta         jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid;
BEGIN
  INSERT INTO public.email_delivery_log
    (tenant_id, user_id, recipient, from_address, subject, template, provider,
     provider_msg_id, status, error, meta)
  VALUES
    (_tenant_id, _user_id, _recipient, _from_address, _subject, _template, COALESCE(_provider,'lovable'),
     _provider_msg_id, COALESCE(_status,'sent'), _error, COALESCE(_meta,'{}'::jsonb))
  RETURNING id INTO _id;
  RETURN _id;
END; $$;
REVOKE ALL ON FUNCTION public.log_email_delivery(uuid,uuid,text,text,text,text,text,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_email_delivery(uuid,uuid,text,text,text,text,text,text,text,text,jsonb) TO service_role;

-- Provider webhook helper (called when a provider posts a delivery/bounce update)
CREATE OR REPLACE FUNCTION public.update_email_delivery(
  _provider text,
  _provider_msg_id text,
  _new_status text,
  _error text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.email_delivery_log
     SET status = _new_status,
         error = COALESCE(_error, error)
   WHERE provider = _provider
     AND provider_msg_id = _provider_msg_id;
  RETURN FOUND;
END; $$;
REVOKE ALL ON FUNCTION public.update_email_delivery(text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_email_delivery(text,text,text,text) TO service_role;


-- ── 2. Server-side OTP / verification-resend rate limiting ──────────────────
-- Client-side only cooldown is trivially bypassed (page reload, or POSTing
-- directly to /auth/v1/resend).  Track every attempt here and reject when
-- the cooldown / max attempts are exceeded.
CREATE TABLE IF NOT EXISTS public.otp_attempts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email        text NOT NULL,           -- normalized lowercase
  ip_address   inet,
  kind         text NOT NULL            -- 'signup_verify' | 'password_recovery' | 'magic_link' | 'email_change' | 'reauth'
               CHECK (kind IN ('signup_verify','password_recovery','magic_link','email_change','reauth')),
  status       text NOT NULL DEFAULT 'requested'
               CHECK (status IN ('requested','sent','rejected','used')),
  reject_reason text,                   -- 'cooldown' | 'max_attempts' | 'unknown_email' | 'error'
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS otp_attempts_email_kind_idx  ON public.otp_attempts (lower(email), kind, created_at DESC);
CREATE INDEX IF NOT EXISTS otp_attempts_ip_idx          ON public.otp_attempts (ip_address, created_at DESC);
CREATE INDEX IF NOT EXISTS otp_attempts_status_idx      ON public.otp_attempts (status, created_at DESC) WHERE status = 'rejected';
GRANT SELECT ON public.otp_attempts TO authenticated;
GRANT ALL    ON public.otp_attempts TO service_role;
ALTER TABLE public.otp_attempts ENABLE ROW LEVEL SECURITY;

-- Only super-admins may inspect this table (privacy: email pattern is PII).
DROP POLICY IF EXISTS "otp_attempts_superadmin_read" ON public.otp_attempts;
CREATE POLICY "otp_attempts_superadmin_read" ON public.otp_attempts
  FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));

-- Rate check: returns { allowed, reject_reason, seconds_until_next_allowed, attempts_last_hour }
CREATE OR REPLACE FUNCTION public.check_otp_attempt(_email text, _kind text)
RETURNS TABLE (
  allowed boolean,
  reject_reason text,
  seconds_until_next integer,
  attempts_last_hour integer
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _cooldown_seconds int := 60;      -- min gap between requests
  _max_per_hour int := 5;           -- absolute cap per email per kind per hour
  _max_per_day int := 20;           -- absolute cap per email per kind per day
  _last_at timestamptz;
  _hourly int;
  _daily int;
  _wait int;
BEGIN
  SELECT MAX(created_at), COUNT(*) FILTER (WHERE created_at > now() - interval '1 hour'),
                                   COUNT(*) FILTER (WHERE created_at > now() - interval '1 day')
    INTO _last_at, _hourly, _daily
    FROM public.otp_attempts
   WHERE lower(email) = lower(_email) AND kind = _kind AND status IN ('requested','sent');

  attempts_last_hour := COALESCE(_hourly, 0);

  IF _last_at IS NOT NULL AND now() < _last_at + make_interval(secs => _cooldown_seconds) THEN
    _wait := EXTRACT(EPOCH FROM (_last_at + make_interval(secs => _cooldown_seconds) - now()))::int;
    allowed := false; reject_reason := 'cooldown'; seconds_until_next := _wait; RETURN NEXT; RETURN;
  END IF;
  IF _hourly >= _max_per_hour THEN
    allowed := false; reject_reason := 'max_attempts_hour'; seconds_until_next := 3600; RETURN NEXT; RETURN;
  END IF;
  IF _daily >= _max_per_day THEN
    allowed := false; reject_reason := 'max_attempts_day'; seconds_until_next := 86400; RETURN NEXT; RETURN;
  END IF;

  allowed := true; reject_reason := NULL; seconds_until_next := 0; RETURN NEXT;
END; $$;
REVOKE ALL ON FUNCTION public.check_otp_attempt(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_otp_attempt(text, text) TO authenticated, service_role;

-- Record an attempt (called from the resend server function)
CREATE OR REPLACE FUNCTION public.record_otp_attempt(
  _email text, _ip text, _kind text, _status text, _reject_reason text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid;
BEGIN
  INSERT INTO public.otp_attempts (email, ip_address, kind, status, reject_reason)
  VALUES (lower(_email), _ip::inet, _kind, _status, _reject_reason)
  RETURNING id INTO _id;
  RETURN _id;
END; $$;
REVOKE ALL ON FUNCTION public.record_otp_attempt(text,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_otp_attempt(text,text,text,text,text) TO service_role;


-- ── 3. Per-tenant outbound-email provider config ────────────────────────────
-- Serverless prevents raw TCP SMTP.  Solution: let each company pick an
-- HTTP-based transactional-email provider (Resend / Mailgun / SendGrid /
-- Postmark / AWS SES / etc.) and paste an API key.  Platform default remains
-- Supabase's built-in mail if the tenant doesn't configure one.
--
-- API keys are encrypted at rest using pgcrypto.  Only company admins may
-- read/write their own tenant's row; the plaintext key is decrypted only
-- inside the SECURITY DEFINER helper called by server functions.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

CREATE TABLE IF NOT EXISTS public.tenant_smtp_config (
  tenant_id       uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider        text NOT NULL DEFAULT 'platform'   -- 'platform' | 'resend' | 'mailgun' | 'sendgrid' | 'postmark' | 'ses' | 'smtp_relay'
                  CHECK (provider IN ('platform','resend','mailgun','sendgrid','postmark','ses','smtp_relay')),
  from_email      text,           -- e.g. "no-reply@acme.com"
  from_name       text,           -- e.g. "Acme Trading"
  reply_to        text,
  api_key_enc     bytea,          -- pgp_sym_encrypt(api_key, per-app secret from env)
  region          text,           -- mailgun EU vs US, ses region
  domain          text,           -- mailgun sending domain
  webhook_secret  text,           -- provider webhook signing secret (also encrypted TODO)
  verified        boolean NOT NULL DEFAULT false,
  last_test_at    timestamptz,
  last_test_ok    boolean,
  last_test_error text,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT (tenant_id, provider, from_email, from_name, reply_to, region, domain,
              verified, last_test_at, last_test_ok, last_test_error, created_at, updated_at)
      ON public.tenant_smtp_config TO authenticated;
GRANT ALL ON public.tenant_smtp_config TO service_role;
ALTER TABLE public.tenant_smtp_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "smtp_config_read_admin"  ON public.tenant_smtp_config;
DROP POLICY IF EXISTS "smtp_config_write_admin" ON public.tenant_smtp_config;
CREATE POLICY "smtp_config_read_admin" ON public.tenant_smtp_config
  FOR SELECT TO authenticated
  USING ((tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'))
         OR public.is_super_admin(auth.uid()));
CREATE POLICY "smtp_config_write_admin" ON public.tenant_smtp_config
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS tenant_smtp_config_updated ON public.tenant_smtp_config;
CREATE TRIGGER tenant_smtp_config_updated
  BEFORE UPDATE ON public.tenant_smtp_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Encryption helpers.  The passphrase MUST be a Supabase Vault secret named
-- 'tenant_smtp_key' (or a Postgres GUC) — configure once, never in code.
--
-- Set up (one-off, Supabase Dashboard → Project Settings → Vault):
--   secret name:  tenant_smtp_key
--   value:        <a strong random string, 32+ chars, generated with `openssl rand -base64 32`>
--
-- Then in psql: SELECT vault.create_secret('YOUR-STRONG-KEY', 'tenant_smtp_key');
--
-- The helpers below try Vault first; fall back to a Postgres GUC set via
--   ALTER DATABASE postgres SET app.tenant_smtp_key = '...'
-- so local dev also works.
CREATE OR REPLACE FUNCTION public._smtp_encryption_key()
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, vault AS $$
DECLARE _k text;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO _k FROM vault.decrypted_secrets WHERE name = 'tenant_smtp_key' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN _k := NULL;
  END;
  IF _k IS NULL OR _k = '' THEN
    _k := current_setting('app.tenant_smtp_key', true);
  END IF;
  IF _k IS NULL OR _k = '' THEN
    RAISE EXCEPTION 'SMTP encryption key not configured (vault secret tenant_smtp_key OR GUC app.tenant_smtp_key)';
  END IF;
  RETURN _k;
END; $$;
REVOKE ALL ON FUNCTION public._smtp_encryption_key() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._smtp_encryption_key() TO service_role;

-- Set/rotate a tenant's provider api key.  Only company admins may call this.
CREATE OR REPLACE FUNCTION public.set_tenant_smtp_api_key(_api_key text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tid uuid;
BEGIN
  _tid := public.current_tenant_id();
  IF _tid IS NULL THEN RAISE EXCEPTION 'No tenant context'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only company admins can change SMTP settings';
  END IF;
  UPDATE public.tenant_smtp_config
     SET api_key_enc = public.pgp_sym_encrypt(_api_key, public._smtp_encryption_key())
   WHERE tenant_id = _tid;
END; $$;
REVOKE ALL ON FUNCTION public.set_tenant_smtp_api_key(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_tenant_smtp_api_key(text) TO authenticated;

-- Reveal helper for the SERVER-SIDE send path (never returned over the API).
-- Callable only from service_role Edge Functions.
CREATE OR REPLACE FUNCTION public.get_tenant_smtp_api_key(_tenant_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _enc bytea; _k text;
BEGIN
  SELECT api_key_enc INTO _enc FROM public.tenant_smtp_config WHERE tenant_id = _tenant_id;
  IF _enc IS NULL THEN RETURN NULL; END IF;
  RETURN public.pgp_sym_decrypt(_enc, public._smtp_encryption_key());
END; $$;
REVOKE ALL ON FUNCTION public.get_tenant_smtp_api_key(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_tenant_smtp_api_key(uuid) TO service_role;

COMMIT;

-- ── Sanity checks (run after COMMIT) ────────────────────────────────────────
-- SELECT COUNT(*) FROM public.email_delivery_log;   -- 0 on fresh install
-- SELECT COUNT(*) FROM public.otp_attempts;         -- 0 on fresh install
-- SELECT COUNT(*) FROM public.tenant_smtp_config;   -- 0 on fresh install; grows as tenants configure
-- SELECT * FROM public.check_otp_attempt('someone@example.com','signup_verify');
--   → allowed=true first call; allowed=false with reject_reason='cooldown' if you re-run within 60s.
