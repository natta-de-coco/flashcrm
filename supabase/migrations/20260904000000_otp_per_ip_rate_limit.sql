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
