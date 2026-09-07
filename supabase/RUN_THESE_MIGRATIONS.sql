-- ══════════════════════════════════════════════════════════════════════════
-- FLAS CRM — all pending migrations, in order, as one paste.
--
-- HOW TO RUN
--   1. Supabase Dashboard -> your project -> SQL Editor -> New query
--   2. Paste this whole file
--   3. Run
--
-- BEFORE YOU RUN: take a backup.
--   Dashboard -> Database -> Backups. These change RLS security policies on a
--   live database holding real customer data. A backup costs two minutes.
--
-- RE-RUNNING: safe, and this is now tested rather than asserted. Every one of
-- these files was applied twice to a real PostgreSQL 17 instance -- once to an
-- empty database alongside the full 46-migration history, then a second time
-- on top of itself. Both passes are clean. If the paste fails part-way you can
-- fix the cause and paste the whole thing again.
--
-- WHY THE 2026-08-30 FILES ARE HERE: 20260830010000 never applied. It carried
-- a backfill referencing an oauth_states.redirect_to column that has never
-- existed in any version of this schema, and because the file is a single
-- transaction that one statement rolled back everything in it -- including
-- consume_oauth_state(), which the OAuth callback calls to finish connecting
-- a social account. That is why connecting an account failed at the last step.
-- Both files are idempotent, so including them is safe whether or not parts of
-- them are already present.
--
-- AFTER RUNNING: see the verification queries at the very bottom.
-- ══════════════════════════════════════════════════════════════════════════

-- #########################################################################
-- ## STEP 1 of 13: 20260830000000_email_audit_otp_smtp.sql
-- #########################################################################

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

-- #########################################################################
-- ## STEP 1 of 14: 20260830000000_email_audit_otp_smtp.sql
-- #########################################################################

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


-- #########################################################################
-- ## STEP 2 of 14: 20260830010000_super_admin_lockdown_and_oauth_reliability.sql
-- #########################################################################

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


-- #########################################################################
-- ## STEP 3 of 14: 20260901000000_tenant_isolation_and_security_hardening.sql
-- #########################################################################

-- ═════════════════════════════════════════════════════════════════════════════
-- Flas CRM — tenant isolation & security hardening
-- Written 2026-09-01, verified against the ACTUAL migration history in this
-- repo (not just the 2026-08-29 audit doc, which had gone stale on a few
-- items — wa_numbers/contacts/products/platform_apps/audit_log already had
-- correct tenant-scoped RLS by the time this was written; this migration only
-- touches what's still genuinely broken).
--
-- Idempotent. Safe to re-run. Run AFTER all prior migrations.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. conversations — no tenant_id at all today. Backfill from the contact.
-- ═════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

UPDATE public.conversations c
   SET tenant_id = ct.tenant_id
  FROM public.contacts ct
 WHERE c.contact_id = ct.id AND c.tenant_id IS NULL AND ct.tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS conversations_tenant_idx ON public.conversations (tenant_id);
CREATE INDEX IF NOT EXISTS conversations_contact_idx ON public.conversations (contact_id);
CREATE INDEX IF NOT EXISTS conversations_wa_number_idx ON public.conversations (wa_number_id);

DROP POLICY IF EXISTS "conversations_team_all" ON public.conversations;
DROP POLICY IF EXISTS "conversations_tenant_all" ON public.conversations;
CREATE POLICY "conversations_tenant_all" ON public.conversations FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. messages — no tenant_id at all today. Backfill from the conversation.
-- ═════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

UPDATE public.messages m
   SET tenant_id = c.tenant_id
  FROM public.conversations c
 WHERE m.conversation_id = c.id AND m.tenant_id IS NULL AND c.tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS messages_tenant_idx ON public.messages (tenant_id);

DROP POLICY IF EXISTS "messages_team_all" ON public.messages;
DROP POLICY IF EXISTS "messages_tenant_all" ON public.messages;
CREATE POLICY "messages_tenant_all" ON public.messages FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. reminders — no tenant_id at all today. Backfill via conversation, then contact.
-- ═════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

UPDATE public.reminders r
   SET tenant_id = c.tenant_id
  FROM public.conversations c
 WHERE r.conversation_id = c.id AND r.tenant_id IS NULL AND c.tenant_id IS NOT NULL;

UPDATE public.reminders r
   SET tenant_id = ct.tenant_id
  FROM public.contacts ct
 WHERE r.contact_id = ct.id AND r.tenant_id IS NULL AND ct.tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS reminders_tenant_due_idx ON public.reminders (tenant_id, due_at);
CREATE INDEX IF NOT EXISTS reminders_conversation_idx ON public.reminders (conversation_id);
CREATE INDEX IF NOT EXISTS reminders_contact_idx ON public.reminders (contact_id);
CREATE INDEX IF NOT EXISTS reminders_assigned_idx ON public.reminders (assigned_to);

DROP POLICY IF EXISTS "Team can manage reminders" ON public.reminders;
DROP POLICY IF EXISTS "reminders_tenant_all" ON public.reminders;
CREATE POLICY "reminders_tenant_all" ON public.reminders FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. campaigns — no tenant_id at all today. Backfill via the creator's profile.
-- ═════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

UPDATE public.campaigns camp
   SET tenant_id = p.tenant_id
  FROM public.profiles p
 WHERE camp.created_by = p.id AND camp.tenant_id IS NULL AND p.tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS campaigns_tenant_idx ON public.campaigns (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS campaigns_created_by_idx ON public.campaigns (created_by);

DROP POLICY IF EXISTS "Team can manage campaigns" ON public.campaigns;
DROP POLICY IF EXISTS "campaigns_tenant_all" ON public.campaigns;
CREATE POLICY "campaigns_tenant_all" ON public.campaigns FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. webhook_events — no tenant_id today; RLS is allow-all. Historical rows
--    can't be reliably backfilled (payload shape varies by source), so they
--    stay NULL and are visible only to super admins. New rows must be written
--    with tenant_id by the app going forward (see code changes).
-- ═════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.webhook_events
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS webhook_events_tenant_idx ON public.webhook_events (tenant_id, created_at DESC);

DROP POLICY IF EXISTS "Team can read webhook events" ON public.webhook_events;
DROP POLICY IF EXISTS "Team can update webhook events" ON public.webhook_events;
DROP POLICY IF EXISTS "webhook_events_read_tenant" ON public.webhook_events;
CREATE POLICY "webhook_events_read_tenant" ON public.webhook_events FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() OR public.is_super_admin());
DROP POLICY IF EXISTS "webhook_events_update_tenant" ON public.webhook_events;
CREATE POLICY "webhook_events_update_tenant" ON public.webhook_events FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() OR public.is_super_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() OR public.is_super_admin());

-- ═════════════════════════════════════════════════════════════════════════════
-- 6. wa_templates — tenant_id column exists (added 2026-08-22) but the RLS
--    policies were never updated off their original allow-all state, and the
--    UNIQUE(name) constraint is global instead of per-tenant.
-- ═════════════════════════════════════════════════════════════════════════════
UPDATE public.wa_templates SET tenant_id = (
  SELECT p.tenant_id FROM public.profiles p WHERE p.tenant_id IS NOT NULL LIMIT 1
) WHERE tenant_id IS NULL;

DROP POLICY IF EXISTS "Team can read templates" ON public.wa_templates;
DROP POLICY IF EXISTS "Admins can manage templates" ON public.wa_templates;
DROP POLICY IF EXISTS "wa_templates_read_tenant" ON public.wa_templates;
CREATE POLICY "wa_templates_read_tenant" ON public.wa_templates FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS "wa_templates_admin_manage" ON public.wa_templates;
CREATE POLICY "wa_templates_admin_manage" ON public.wa_templates FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'));

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wa_templates_name_key') THEN
    ALTER TABLE public.wa_templates DROP CONSTRAINT wa_templates_name_key;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS wa_templates_tenant_name_key ON public.wa_templates (tenant_id, name);

-- ═════════════════════════════════════════════════════════════════════════════
-- 7. user_roles — the 2026-08-20 "roles_read_all" policy (USING(true)) was
--    never revisited. Every user's platform role is currently readable by
--    every other authenticated user.
-- ═════════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "roles_read_all" ON public.user_roles;
DROP POLICY IF EXISTS "roles_read_self_or_admin" ON public.user_roles;
CREATE POLICY "roles_read_self_or_admin" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.is_super_admin());

-- ═════════════════════════════════════════════════════════════════════════════
-- 8. team_invites — any tenant member (not just admins) can create invites,
--    and nothing stops them setting staff_role='super_admin' on the invite.
-- ═════════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Tenant members can manage own invites" ON public.team_invites;
DROP POLICY IF EXISTS "team_invites_read_tenant" ON public.team_invites;
CREATE POLICY "team_invites_read_tenant" ON public.team_invites FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS "team_invites_admin_write" ON public.team_invites;
CREATE POLICY "team_invites_admin_write" ON public.team_invites FOR ALL TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.staff_role = 'company_admin'
    ))
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND staff_role <> 'super_admin'
    AND (public.has_role(auth.uid(), 'admin') OR EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.staff_role = 'company_admin'
    ))
  );

-- ═════════════════════════════════════════════════════════════════════════════
-- 9. organizations — "orgs_admin_write" checks "is this user an admin
--    anywhere" (the legacy app_role system) instead of "is this user an
--    admin of THIS org". Any admin in any tenant can currently update any
--    other tenant's organization row (plan, suspended, paddle ids...).
-- ═════════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "orgs_admin_write" ON public.organizations;
DROP POLICY IF EXISTS "orgs_own_tenant_admin_write" ON public.organizations;
CREATE POLICY "orgs_own_tenant_admin_write" ON public.organizations FOR UPDATE TO authenticated
  USING (
    id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.staff_role = 'company_admin'
    ))
  )
  WITH CHECK (
    id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.staff_role = 'company_admin'
    ))
  );
DROP POLICY IF EXISTS "orgs_super_admin_all" ON public.organizations;
CREATE POLICY "orgs_super_admin_all" ON public.organizations FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- ═════════════════════════════════════════════════════════════════════════════
-- 10. platform_apps.client_secret — RLS is already tenant-scoped correctly,
--     but any signed-in member of the tenant (not just admins) can currently
--     SELECT the raw client_secret column. Restrict the column grant; the
--     app only ever reads the secret server-side via supabaseAdmin (service
--     role), which keeps GRANT ALL regardless of this change.
-- ═════════════════════════════════════════════════════════════════════════════
REVOKE SELECT ON public.platform_apps FROM authenticated;
GRANT SELECT (id, tenant_id, provider, client_id, label, created_at, updated_at)
  ON public.platform_apps TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 11. audit_log — tenant scoping is already correct, but nothing stops an
--     authenticated client from calling the REST/JS API directly (bypassing
--     our server functions) and inserting a row with an arbitrary actor_id,
--     forging who did what. All real app writes already go through
--     supabaseAdmin (service_role, unaffected by this revoke).
-- ═════════════════════════════════════════════════════════════════════════════
REVOKE INSERT ON public.audit_log FROM authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 12. handle_new_user — the very first person to ever sign up on a fresh
--     deployment is silently granted the legacy 'admin' app_role. Only
--     matters until a real admin signs up, but a customer beating you to it
--     on a fresh environment inherits admin. Gate it on platform_super_admins
--     instead of "count(*) = 0".
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'), NEW.email)
  ON CONFLICT (id) DO NOTHING;

  IF NEW.email IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.platform_super_admins WHERE lower(email) = lower(NEW.email)
  ) THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin'::public.app_role) ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'agent'::public.app_role) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 13. Webhook idempotency (Meta/Paddle/Shopify all currently retry-unsafe).
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.webhook_dedup (
  event_source text NOT NULL,
  event_id     text NOT NULL,
  seen_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_source, event_id)
);
CREATE INDEX IF NOT EXISTS webhook_dedup_seen_idx ON public.webhook_dedup (seen_at);
GRANT SELECT, INSERT ON public.webhook_dedup TO service_role;
ALTER TABLE public.webhook_dedup ENABLE ROW LEVEL SECURITY;
-- No policy for authenticated => deny by default; only service_role touches this.

COMMIT;

-- ─── Sanity checks (run AFTER commit; all counts should be 0 except where noted) ──
-- SELECT COUNT(*) AS conv_orphans     FROM public.conversations WHERE tenant_id IS NULL;
-- SELECT COUNT(*) AS msg_orphans      FROM public.messages       WHERE tenant_id IS NULL;
-- SELECT COUNT(*) AS reminder_orphans FROM public.reminders      WHERE tenant_id IS NULL;
-- SELECT COUNT(*) AS campaign_orphans FROM public.campaigns      WHERE tenant_id IS NULL;
-- -- webhook_events orphans are EXPECTED for rows created before this migration:
-- SELECT COUNT(*) AS webhook_orphans_pre_migration FROM public.webhook_events WHERE tenant_id IS NULL;


-- #########################################################################
-- ## STEP 4 of 14: 20260901010000_per_tenant_bot_and_wa_config.sql
-- #########################################################################

-- ═════════════════════════════════════════════════════════════════════════════
-- Flas CRM — convert bot_settings and wa_config from platform-wide singletons
-- to per-tenant tables. Every tenant currently shares one bot personality and
-- one "connected number" display card, which is wrong on a multi-tenant
-- platform (this was flagged as part of the original tenant-isolation
-- ship-blocker). The old singleton tables are left in place, unused, as a
-- rollback path — drop them in a later migration once this is verified live.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── tenant_bot_settings ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tenant_bot_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  bot_name text NOT NULL DEFAULT 'Flash Assistant',
  greeting text NOT NULL DEFAULT 'Hi! Thanks for reaching out. How can I help you today?',
  instructions text NOT NULL DEFAULT 'You are a helpful WhatsApp support assistant. Be concise, friendly and professional. Answer in the customer''s language.',
  model text NOT NULL DEFAULT 'google/gemini-3.7-flash',
  handoff_keywords text[] NOT NULL DEFAULT ARRAY['human','agent','representative','complaint'],
  business_hours_only boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.tenant_bot_settings TO authenticated;
GRANT ALL ON public.tenant_bot_settings TO service_role;
ALTER TABLE public.tenant_bot_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_bot_settings_read" ON public.tenant_bot_settings;
DROP POLICY IF EXISTS "tenant_bot_settings_write" ON public.tenant_bot_settings;
DROP POLICY IF EXISTS "tenant_bot_settings_read" ON public.tenant_bot_settings;
CREATE POLICY "tenant_bot_settings_read" ON public.tenant_bot_settings FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS "tenant_bot_settings_write" ON public.tenant_bot_settings;
CREATE POLICY "tenant_bot_settings_write" ON public.tenant_bot_settings FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'));
DROP TRIGGER IF EXISTS tenant_bot_settings_updated ON public.tenant_bot_settings;
CREATE TRIGGER tenant_bot_settings_updated BEFORE UPDATE ON public.tenant_bot_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed one row per existing org from the old singleton's current values.
INSERT INTO public.tenant_bot_settings
  (tenant_id, enabled, bot_name, greeting, instructions, model, handoff_keywords, business_hours_only)
SELECT o.id, s.enabled, s.bot_name, s.greeting, s.instructions, s.model, s.handoff_keywords, s.business_hours_only
  FROM public.organizations o CROSS JOIN public.bot_settings s
 WHERE s.id = true
ON CONFLICT (tenant_id) DO NOTHING;

-- ── tenant_wa_config ─────────────────────────────────────────────────────────
-- Per-tenant "primary number" display card. wa_numbers already carries
-- phone_number_id per row/tenant; this table is just the settings-page
-- summary card + the flag the webhook sets once verification succeeds.
CREATE TABLE IF NOT EXISTS public.tenant_wa_config (
  tenant_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  business_name text,
  display_phone text,
  phone_number_id text,
  webhook_verified boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.tenant_wa_config TO authenticated;
GRANT ALL ON public.tenant_wa_config TO service_role;
ALTER TABLE public.tenant_wa_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_wa_config_read" ON public.tenant_wa_config;
DROP POLICY IF EXISTS "tenant_wa_config_write" ON public.tenant_wa_config;
DROP POLICY IF EXISTS "tenant_wa_config_read" ON public.tenant_wa_config;
CREATE POLICY "tenant_wa_config_read" ON public.tenant_wa_config FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
DROP POLICY IF EXISTS "tenant_wa_config_write" ON public.tenant_wa_config;
CREATE POLICY "tenant_wa_config_write" ON public.tenant_wa_config FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'));
DROP TRIGGER IF EXISTS tenant_wa_config_updated ON public.tenant_wa_config;
CREATE TRIGGER tenant_wa_config_updated BEFORE UPDATE ON public.tenant_wa_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.tenant_wa_config (tenant_id, business_name, display_phone, phone_number_id, webhook_verified)
SELECT o.id, w.business_name, w.display_phone, w.phone_number_id, w.webhook_verified
  FROM public.organizations o CROSS JOIN public.wa_config w
 WHERE w.id = true
ON CONFLICT (tenant_id) DO NOTHING;

-- Service-role helper so a webhook (no authenticated tenant session) can flip
-- webhook_verified for the specific tenant it just verified.
CREATE OR REPLACE FUNCTION public.mark_wa_webhook_verified(_tenant_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.tenant_wa_config (tenant_id, webhook_verified)
  VALUES (_tenant_id, true)
  ON CONFLICT (tenant_id) DO UPDATE SET webhook_verified = true, updated_at = now();
$$;
REVOKE ALL ON FUNCTION public.mark_wa_webhook_verified(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_wa_webhook_verified(uuid) TO service_role;

COMMIT;


-- #########################################################################
-- ## STEP 5 of 14: 20260901020000_atomic_unread_increment.sql
-- #########################################################################

-- Concurrent inbound messages could drop unread-count increments (read the
-- current value, then write value+1 — a second message arriving between the
-- read and the write gets overwritten). Atomic increment via a single UPDATE.
BEGIN;

CREATE OR REPLACE FUNCTION public.increment_unread_count(_conversation_id uuid)
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.conversations
     SET unread_count = unread_count + 1
   WHERE id = _conversation_id
   RETURNING unread_count;
$$;
REVOKE ALL ON FUNCTION public.increment_unread_count(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_unread_count(uuid) TO service_role;

COMMIT;


-- #########################################################################
-- ## STEP 6 of 14: 20260901030000_restrict_secret_column_reads.sql
-- #########################################################################

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


-- #########################################################################
-- ## STEP 7 of 14: 20260901040000_atomic_document_items_and_billing_fixes.sql
-- #########################################################################

-- Invoice line-item edits were a DELETE then a separate INSERT from the
-- client — a crash or dropped connection between the two calls could leave
-- an invoice with zero items. Wrap both in one atomic function.
BEGIN;

CREATE OR REPLACE FUNCTION public.replace_sales_document_items(
  _document_id uuid,
  _tenant_id uuid,
  _items jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- SECURITY DEFINER bypasses RLS, so this check IS the tenant boundary —
  -- never trust _tenant_id from the caller without it.
  IF _tenant_id <> public.current_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'You can only edit documents in your own workspace';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.sales_documents d
     WHERE d.id = _document_id AND d.tenant_id = _tenant_id
  ) THEN
    RAISE EXCEPTION 'Document not found for this tenant';
  END IF;

  DELETE FROM public.sales_document_items WHERE document_id = _document_id;

  INSERT INTO public.sales_document_items (
    tenant_id, document_id, product_id, position, name_snapshot, sku_snapshot,
    description_snapshot, image_snapshot, quantity, unit, unit_price,
    discount_value, discount_type, discount_amount, tax_rate, tax_amount,
    line_total, serial_number, warranty, service_period, notes
  )
  SELECT
    _tenant_id, _document_id, r.product_id, r.position, r.name_snapshot, r.sku_snapshot,
    r.description_snapshot, r.image_snapshot, r.quantity, r.unit, r.unit_price,
    r.discount_value, r.discount_type, r.discount_amount, r.tax_rate, r.tax_amount,
    r.line_total, r.serial_number, r.warranty, r.service_period, r.notes
  FROM jsonb_to_recordset(_items) AS r(
    product_id uuid, position integer, name_snapshot text, sku_snapshot text,
    description_snapshot text, image_snapshot text, quantity numeric, unit text,
    unit_price numeric, discount_value numeric, discount_type text, discount_amount numeric,
    tax_rate numeric, tax_amount numeric, line_total numeric, serial_number text,
    warranty text, service_period text, notes text
  );
END; $$;
REVOKE ALL ON FUNCTION public.replace_sales_document_items(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_sales_document_items(uuid, uuid, jsonb) TO authenticated, service_role;

COMMIT;


-- #########################################################################
-- ## STEP 8 of 14: 20260901050000_campaign_plans.sql
-- #########################################################################

-- Campaign Planner: persists each AI-generated targeting plan so a company
-- can look back at what was recommended and when, rather than the output
-- being thrown away after one view.
BEGIN;

CREATE TABLE IF NOT EXISTS public.campaign_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  goal text NOT NULL,
  product text,
  budget_note text,
  plan jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campaign_plans_tenant_idx ON public.campaign_plans (tenant_id, created_at DESC);
GRANT SELECT, INSERT, DELETE ON public.campaign_plans TO authenticated;
GRANT ALL ON public.campaign_plans TO service_role;
ALTER TABLE public.campaign_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "campaign_plans_tenant_all" ON public.campaign_plans;
CREATE POLICY "campaign_plans_tenant_all" ON public.campaign_plans FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

COMMIT;


-- #########################################################################
-- ## STEP 9 of 14: 20260901060000_social_connection_doctor.sql
-- #########################################################################

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


-- #########################################################################
-- ## STEP 10 of 14: 20260903000000_unify_admin_role_checks.sql
-- #########################################################################

-- ═════════════════════════════════════════════════════════════════════════════
-- Reconcile the two parallel admin-role systems.
--
-- THE BUG
-- This app has two role systems that grew up side by side:
--   * user_roles.role (app_role: 'admin' | 'agent') — the original, checked by
--     has_role() in most RLS policies and SECURITY DEFINER RPCs.
--   * profiles.staff_role (company_admin | marketing_manager | staff |
--     seo_editor | super_admin) — the newer per-tenant one the UI shows.
--
-- completeOnboarding() grants BOTH to whoever creates a workspace, so the
-- founder never notices. Claiming a team invite only ever set staff_role.
-- Result: an invited "company admin" appears to be an admin everywhere in the
-- product, while every has_role()-gated policy silently refuses them —
-- WhatsApp templates, bot settings, SMTP API keys, connected-app credentials.
-- No error that names the cause; things just don't save.
--
-- THE FIX
-- 1. is_tenant_admin() — one helper that accepts EITHER system, so new policy
--    work stops having to pick a side.
-- 2. Re-point the policies this repo added to use it.
-- 3. Backfill the legacy role for people already stuck in that state.
--
-- Idempotent. Safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Canonical admin check ────────────────────────────────────────────────
-- True when the user is an admin under EITHER system. Kept SECURITY DEFINER
-- and STABLE so it is safe and cheap to call from inside RLS policies.
CREATE OR REPLACE FUNCTION public.is_tenant_admin(_user uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
     WHERE ur.user_id = _user AND ur.role = 'admin'::public.app_role
  ) OR EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = _user AND p.staff_role IN ('company_admin', 'super_admin')
  );
$$;
REVOKE ALL ON FUNCTION public.is_tenant_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_tenant_admin(uuid) TO authenticated, service_role;

-- ── 2. Re-point the policies this repo introduced ───────────────────────────
DROP POLICY IF EXISTS "tenant_bot_settings_write" ON public.tenant_bot_settings;
CREATE POLICY "tenant_bot_settings_write" ON public.tenant_bot_settings FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_tenant_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_tenant_admin());

DROP POLICY IF EXISTS "tenant_wa_config_write" ON public.tenant_wa_config;
CREATE POLICY "tenant_wa_config_write" ON public.tenant_wa_config FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_tenant_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_tenant_admin());

DROP POLICY IF EXISTS "wa_templates_admin_manage" ON public.wa_templates;
CREATE POLICY "wa_templates_admin_manage" ON public.wa_templates FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_tenant_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_tenant_admin());

DROP POLICY IF EXISTS "team_invites_admin_write" ON public.team_invites;
CREATE POLICY "team_invites_admin_write" ON public.team_invites FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_tenant_admin())
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND staff_role <> 'super_admin'
    AND public.is_tenant_admin()
  );

DROP POLICY IF EXISTS "orgs_own_tenant_admin_write" ON public.organizations;
CREATE POLICY "orgs_own_tenant_admin_write" ON public.organizations FOR UPDATE TO authenticated
  USING (id = public.current_tenant_id() AND public.is_tenant_admin())
  WITH CHECK (id = public.current_tenant_id() AND public.is_tenant_admin());

DROP POLICY IF EXISTS "roles_read_self_or_admin" ON public.user_roles;
CREATE POLICY "roles_read_self_or_admin" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_tenant_admin() OR public.is_super_admin());

-- ── 3. The per-tenant SMTP key RPC ──────────────────────────────────────────
-- Its own admin check disagreed with the app's (requireCompanyAdmin checks
-- staff_role), so a company_admin could pass the UI gate and then get a
-- zero-row UPDATE with no error — the key silently never saved.
CREATE OR REPLACE FUNCTION public.set_tenant_smtp_api_key(_api_key text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tid uuid;
BEGIN
  _tid := public.current_tenant_id();
  IF _tid IS NULL THEN RAISE EXCEPTION 'No tenant context'; END IF;
  IF NOT public.is_tenant_admin() THEN
    RAISE EXCEPTION 'Only company admins can change email settings';
  END IF;
  UPDATE public.tenant_smtp_config
     SET api_key_enc = public.pgp_sym_encrypt(_api_key, public._smtp_encryption_key())
   WHERE tenant_id = _tid;
  -- A no-op UPDATE previously looked like success. Say so instead.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Save your email provider settings before adding the API key.';
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public.set_tenant_smtp_api_key(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_tenant_smtp_api_key(text) TO authenticated;

-- ── 4. Backfill people already stuck ────────────────────────────────────────
-- Anyone who accepted an invite as company_admin/super_admin before this fix
-- has staff_role but no legacy role, and has been quietly unable to administer
-- anything. Give them the legacy role so existing has_role() policies work.
INSERT INTO public.user_roles (user_id, role)
SELECT p.id, 'admin'::public.app_role
  FROM public.profiles p
 WHERE p.staff_role IN ('company_admin', 'super_admin')
   AND NOT EXISTS (
     SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = p.id AND ur.role = 'admin'::public.app_role
   )
ON CONFLICT DO NOTHING;

COMMIT;

-- ─── Sanity checks ──────────────────────────────────────────────────────────
-- Should return 0 — every staff/super admin now also holds the legacy role:
-- SELECT COUNT(*) AS admins_missing_legacy_role
--   FROM public.profiles p
--  WHERE p.staff_role IN ('company_admin','super_admin')
--    AND NOT EXISTS (SELECT 1 FROM public.user_roles ur
--                     WHERE ur.user_id = p.id AND ur.role = 'admin'::public.app_role);
--
-- Should return true when run as an admin:
-- SELECT public.is_tenant_admin();


-- #########################################################################
-- ## STEP 11 of 14: 20260903010000_ai_byo_keys_and_rate_limit.sql
-- #########################################################################

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


-- #########################################################################
-- ## STEP 12 of 14: 20260904000000_otp_per_ip_rate_limit.sql
-- #########################################################################

-- ═════════════════════════════════════════════════════════════════════════════
-- The OTP resend endpoint claimed a per-IP rate limit it never had.
--
-- otp-resend.functions.ts is unauthenticated by necessity: someone who cannot
-- sign in must still be able to ask for a reset link. Its docblock says
-- "per-email + per-IP rate limits enforced in the DB", and it does compute the
-- caller's IP and store it on every attempt -- but check_otp_attempt only ever
-- took (_email, _kind). Nothing looked at the IP column again.
--
-- So the caps were 60s cooldown / 5 per hour / 20 per day PER EMAIL ADDRESS,
-- with no aggregate ceiling at all. One host cycling through addresses could
-- send unlimited mail through the project's SMTP credentials. The cost is not
-- the volume, it is the sending domain's reputation: that is how
-- flas@mobidigisol.com ends up on a blocklist and legitimate password resets
-- stop arriving.
--
-- This replaces the function with a three-argument version that also counts
-- recent attempts from the same IP across every address. The old two-argument
-- version is dropped in the same transaction; the only caller is updated in
-- the same commit.
--
-- Idempotent. Safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- The per-IP count scans by ip_address + created_at, which nothing indexed.
CREATE INDEX IF NOT EXISTS otp_attempts_ip_window_idx
  ON public.otp_attempts (ip_address, created_at DESC);

DROP FUNCTION IF EXISTS public.check_otp_attempt(text, text);

CREATE OR REPLACE FUNCTION public.check_otp_attempt(
  _email text,
  _kind text,
  _ip text DEFAULT NULL
) RETURNS TABLE (
  allowed boolean,
  reject_reason text,
  seconds_until_next integer,
  attempts_last_hour integer
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _cooldown_seconds int := 60;   -- min gap between requests for one address
  _max_per_hour int := 5;        -- per email per kind per hour
  _max_per_day  int := 20;       -- per email per kind per day
  -- Deliberately loose: a whole office behind one NAT must not be locked out
  -- by a colleague resetting their password. This is a mail-cannon ceiling,
  -- not a per-user limit.
  _ip_max_per_hour int := 20;
  _ip_max_per_day  int := 100;
  _last_at timestamptz;
  _hourly int;
  _daily int;
  _ip_hourly int;
  _ip_daily int;
  _wait int;
BEGIN
  SELECT MAX(created_at),
         COUNT(*) FILTER (WHERE created_at > now() - interval '1 hour'),
         COUNT(*) FILTER (WHERE created_at > now() - interval '1 day')
    INTO _last_at, _hourly, _daily
    FROM public.otp_attempts
   WHERE lower(email) = lower(_email) AND kind = _kind
     AND status IN ('requested','sent');

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

  -- The check that was missing: aggregate volume from one source, regardless
  -- of how many different addresses it targets. A NULL/unknown IP is not
  -- counted -- it would collapse every unattributable request into one bucket
  -- and lock out real users.
  IF _ip IS NOT NULL AND _ip <> '' AND _ip <> '0.0.0.0' THEN
    SELECT COUNT(*) FILTER (WHERE created_at > now() - interval '1 hour'),
           COUNT(*) FILTER (WHERE created_at > now() - interval '1 day')
      INTO _ip_hourly, _ip_daily
      FROM public.otp_attempts
     WHERE ip_address = _ip::inet AND status IN ('requested','sent');

    IF COALESCE(_ip_hourly, 0) >= _ip_max_per_hour THEN
      allowed := false; reject_reason := 'ip_max_attempts_hour'; seconds_until_next := 3600; RETURN NEXT; RETURN;
    END IF;
    IF COALESCE(_ip_daily, 0) >= _ip_max_per_day THEN
      allowed := false; reject_reason := 'ip_max_attempts_day'; seconds_until_next := 86400; RETURN NEXT; RETURN;
    END IF;
  END IF;

  allowed := true; reject_reason := NULL; seconds_until_next := 0; RETURN NEXT;
END; $$;

REVOKE ALL ON FUNCTION public.check_otp_attempt(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_otp_attempt(text, text, text) TO authenticated, service_role;

COMMIT;

-- ─── Sanity checks ──────────────────────────────────────────────────────────
-- Fresh address from an unseen IP -> allowed = true:
-- SELECT * FROM public.check_otp_attempt('nobody@example.com','signup_verify','203.0.113.9');
-- The two-argument form must now be gone (expect 1 row, 3 arguments):
-- SELECT pronargs FROM pg_proc WHERE proname = 'check_otp_attempt';


-- #########################################################################
-- ## STEP 13 of 14: 20260904010000_super_admin_subscribers_view.sql
-- #########################################################################

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


-- #########################################################################
-- ## STEP 14 of 14: 20260905000000_tenant_privacy_hardening.sql
-- #########################################################################

-- ═════════════════════════════════════════════════════════════════════════════
-- Every company's data private to that company.
--
-- Found the way these things should be found: the owner signed in, opened
-- Settings, and saw three people listed under Team -- including accounts that
-- are not in his workspace. The Team list does not filter by tenant at all; it
-- trusts RLS, and RLS on profiles was:
--
--     CREATE POLICY "profiles_read_all" ON public.profiles
--       FOR SELECT TO authenticated USING (true);
--
-- Every signed-in user of every company could read every profile on the
-- platform -- names and email addresses of all clients. The earlier
-- tenant-isolation migration (20260901000000) covered conversations, messages,
-- reminders, campaigns, webhook_events, wa_templates, team_invites and
-- organizations, and simply missed profiles.
--
-- Worse, writes were unscoped too:
--
--     CREATE POLICY "profiles_admin_manage" ON public.profiles
--       FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'));
--
-- Any company admin could edit any other company's user rows.
--
-- A sweep of all 72 live policies found four more with no scoping at all.
-- plan_thresholds (platform reference data) and the service-role-only
-- subscriptions policy are legitimately unscoped and are left alone.
--
-- Idempotent. Safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. profiles: the leak the owner actually saw ────────────────────────────
-- You can always read yourself (needed before a tenant is assigned, and by
-- current_tenant_id() itself). Otherwise: same workspace only.
DROP POLICY IF EXISTS "profiles_read_all" ON public.profiles;
DROP POLICY IF EXISTS "profiles_read_own_tenant" ON public.profiles;
CREATE POLICY "profiles_read_own_tenant" ON public.profiles FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR (tenant_id IS NOT NULL AND tenant_id = public.current_tenant_id())
    OR public.is_super_admin()
  );

-- Admins manage their own workspace's people, nobody else's.
DROP POLICY IF EXISTS "profiles_admin_manage" ON public.profiles;
DROP POLICY IF EXISTS "profiles_admin_manage_own_tenant" ON public.profiles;
CREATE POLICY "profiles_admin_manage_own_tenant" ON public.profiles FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR (public.is_tenant_admin() AND tenant_id IS NOT NULL
        AND tenant_id = public.current_tenant_id())
  )
  WITH CHECK (
    public.is_super_admin()
    OR (public.is_tenant_admin() AND tenant_id IS NOT NULL
        AND tenant_id = public.current_tenant_id())
  );

-- ── 2. user_roles: reachable only through the profile that owns the role ────
-- The table has no tenant_id of its own, so scope it through profiles.
-- Previously an admin of any company could read -- and write -- the roles of
-- every user on the platform.
DROP POLICY IF EXISTS "roles_read_all" ON public.user_roles;
DROP POLICY IF EXISTS "roles_read_self_or_admin" ON public.user_roles;
DROP POLICY IF EXISTS "roles_read_self_or_tenant_admin" ON public.user_roles;
CREATE POLICY "roles_read_self_or_tenant_admin" ON public.user_roles FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_super_admin()
    OR (
      public.is_tenant_admin()
      AND EXISTS (
        SELECT 1 FROM public.profiles p
         WHERE p.id = public.user_roles.user_id
           AND p.tenant_id IS NOT NULL
           AND p.tenant_id = public.current_tenant_id()
      )
    )
  );

DROP POLICY IF EXISTS "roles_admin_write" ON public.user_roles;
DROP POLICY IF EXISTS "roles_write_tenant_admin" ON public.user_roles;
CREATE POLICY "roles_write_tenant_admin" ON public.user_roles FOR ALL TO authenticated
  USING (
    public.is_super_admin()
    OR (
      public.is_tenant_admin()
      AND EXISTS (
        SELECT 1 FROM public.profiles p
         WHERE p.id = public.user_roles.user_id
           AND p.tenant_id IS NOT NULL
           AND p.tenant_id = public.current_tenant_id()
      )
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR (
      public.is_tenant_admin()
      AND EXISTS (
        SELECT 1 FROM public.profiles p
         WHERE p.id = public.user_roles.user_id
           AND p.tenant_id IS NOT NULL
           AND p.tenant_id = public.current_tenant_id()
      )
    )
  );

-- ── 3. bot_settings / wa_config: legacy singletons ──────────────────────────
-- One shared row from before this product was multi-tenant. bot_settings holds
-- the chatbot's instructions and business knowledge; wa_config holds the
-- business name and phone number id. Both were readable by every signed-in
-- user of every company, and writable by any admin.
--
-- tenant_bot_settings and tenant_wa_config (20260901010000) replaced them.
-- The server still reads these two as a fallback, but it does so with the
-- service role, which bypasses RLS -- so closing them to browser clients
-- changes no behaviour.
DROP POLICY IF EXISTS "bot_read" ON public.bot_settings;
DROP POLICY IF EXISTS "bot_read_superadmin" ON public.bot_settings;
CREATE POLICY "bot_read_superadmin" ON public.bot_settings FOR SELECT TO authenticated
  USING (public.is_super_admin());

DROP POLICY IF EXISTS "bot_admin_update" ON public.bot_settings;
DROP POLICY IF EXISTS "bot_admin_insert" ON public.bot_settings;
DROP POLICY IF EXISTS "bot_write_superadmin" ON public.bot_settings;
CREATE POLICY "bot_write_superadmin" ON public.bot_settings FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "wa_read" ON public.wa_config;
DROP POLICY IF EXISTS "wa_read_superadmin" ON public.wa_config;
CREATE POLICY "wa_read_superadmin" ON public.wa_config FOR SELECT TO authenticated
  USING (public.is_super_admin());

DROP POLICY IF EXISTS "wa_admin_update" ON public.wa_config;
DROP POLICY IF EXISTS "wa_admin_insert" ON public.wa_config;
DROP POLICY IF EXISTS "wa_write_superadmin" ON public.wa_config;
CREATE POLICY "wa_write_superadmin" ON public.wa_config FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- ── 4. system_alerts: give an alert an owner ────────────────────────────────
-- Read AND update were both USING (true): every company could see, and resolve,
-- every other company's alerts. The table had no tenant at all, so add one.
-- NULL means a platform-level alert (billing, Paddle) and stays with the owner.
ALTER TABLE public.system_alerts
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS system_alerts_tenant_idx ON public.system_alerts (tenant_id, created_at DESC);

DROP POLICY IF EXISTS "Team can read alerts" ON public.system_alerts;
DROP POLICY IF EXISTS "alerts_read_own_tenant" ON public.system_alerts;
CREATE POLICY "alerts_read_own_tenant" ON public.system_alerts FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (tenant_id IS NOT NULL AND tenant_id = public.current_tenant_id())
  );

DROP POLICY IF EXISTS "Team can manage alerts" ON public.system_alerts;
DROP POLICY IF EXISTS "alerts_update_own_tenant" ON public.system_alerts;
CREATE POLICY "alerts_update_own_tenant" ON public.system_alerts FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR (tenant_id IS NOT NULL AND tenant_id = public.current_tenant_id())
  )
  WITH CHECK (
    public.is_super_admin()
    OR (tenant_id IS NOT NULL AND tenant_id = public.current_tenant_id())
  );

COMMIT;

-- ─── Sanity checks ──────────────────────────────────────────────────────────
-- No policy on these tables may be an unconditional USING (true). Expect 0:
-- SELECT tablename, policyname FROM pg_policies
--  WHERE schemaname='public' AND qual = 'true'
--    AND tablename IN ('profiles','user_roles','bot_settings','wa_config','system_alerts');
--
-- Signed in as a company admin, this must return only your own workspace:
-- SELECT email, tenant_id FROM public.profiles;


-- ══════════════════════════════════════════════════════════════════════════
-- VERIFICATION — run AFTER the above completes. All should be 0 except noted.
-- ══════════════════════════════════════════════════════════════════════════

-- The function whose absence broke every social connection. Expect 1:
SELECT COUNT(*) AS consume_oauth_state_exists
  FROM pg_proc WHERE proname = 'consume_oauth_state';

-- The other objects that went down with it. Expect 1 each:
SELECT proname, COUNT(*) AS present FROM pg_proc
 WHERE proname IN ('purge_expired_oauth_states','rotate_site_webhook_secret',
                   'rotate_wa_number_app_secret','list_subscribers',
                   'guard_super_admin_downgrade')
 GROUP BY proname ORDER BY proname;

SELECT 'conversations missing tenant' AS check, COUNT(*) AS bad FROM public.conversations WHERE tenant_id IS NULL
UNION ALL SELECT 'messages missing tenant',  COUNT(*) FROM public.messages   WHERE tenant_id IS NULL
UNION ALL SELECT 'reminders missing tenant', COUNT(*) FROM public.reminders  WHERE tenant_id IS NULL
UNION ALL SELECT 'campaigns missing tenant', COUNT(*) FROM public.campaigns  WHERE tenant_id IS NULL;

-- Every company/super admin should also hold the legacy role. Expect 0:
SELECT 'admins missing legacy role' AS check, COUNT(*) AS bad
  FROM public.profiles p
 WHERE p.staff_role IN ('company_admin','super_admin')
   AND NOT EXISTS (SELECT 1 FROM public.user_roles ur
                    WHERE ur.user_id = p.id AND ur.role = 'admin'::public.app_role);

-- Expected > 0 only for rows created BEFORE this migration:
SELECT 'webhook_events pre-migration (ok if >0)' AS check, COUNT(*) AS n
  FROM public.webhook_events WHERE tenant_id IS NULL;

-- New tables should exist (empty on a fresh run):
SELECT 'tenant_bot_settings' AS table_name, COUNT(*) AS rows FROM public.tenant_bot_settings
UNION ALL SELECT 'tenant_wa_config',    COUNT(*) FROM public.tenant_wa_config
UNION ALL SELECT 'campaign_plans',      COUNT(*) FROM public.campaign_plans
UNION ALL SELECT 'social_capabilities', COUNT(*) FROM public.social_capabilities
UNION ALL SELECT 'integration_errors',  COUNT(*) FROM public.integration_errors
UNION ALL SELECT 'webhook_dedup',       COUNT(*) FROM public.webhook_dedup
UNION ALL SELECT 'ai_usage_log',        COUNT(*) FROM public.ai_usage_log;

-- No policy may be an unconditional USING (true) on these. Expect 0 rows:
SELECT tablename, policyname FROM pg_policies
 WHERE schemaname='public' AND qual = 'true'
   AND tablename IN ('profiles','user_roles','bot_settings','wa_config','system_alerts');

-- The PKCE column the OAuth flow inserts on every connect. Expect 1 row:
SELECT column_name FROM information_schema.columns
 WHERE table_schema='public' AND table_name='oauth_states' AND column_name='code_verifier';

-- The OTP gate must now take three arguments (email, kind, ip). Expect 3:
SELECT pronargs AS otp_gate_args FROM pg_proc WHERE proname = 'check_otp_attempt';

-- Secret columns must not be READABLE by browser clients. Note the
-- privilege_type filter: without it this also lists INSERT grants, and
-- api_key legitimately keeps INSERT so a tenant can still save a key.
-- Expect NO rows at all:
SELECT table_name, column_name
  FROM information_schema.column_privileges
 WHERE grantee = 'authenticated'
   AND privilege_type = 'SELECT'
   AND (table_name, column_name) IN
       (('ai_provider_keys','api_key'), ('wa_numbers','access_token'));

-- And the positive control -- these SHOULD still be readable. Expect 2 rows:
SELECT table_name, column_name
  FROM information_schema.column_privileges
 WHERE grantee = 'authenticated'
   AND privilege_type = 'SELECT'
   AND (table_name, column_name) IN
       (('ai_provider_keys','provider'), ('wa_numbers','label'));
