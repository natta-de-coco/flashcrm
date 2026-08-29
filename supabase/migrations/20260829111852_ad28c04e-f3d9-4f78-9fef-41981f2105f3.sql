CREATE TABLE public.auth_email_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  recipient_email text NOT NULL,
  action_type text NOT NULL CHECK (action_type IN ('signup', 'recovery')),
  status text NOT NULL CHECK (status IN ('requested', 'accepted', 'rejected')),
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  provider_error text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.auth_email_attempts TO service_role;
ALTER TABLE public.auth_email_attempts ENABLE ROW LEVEL SECURITY;
CREATE INDEX auth_email_attempts_recipient_action_time_idx ON public.auth_email_attempts (recipient_email, action_type, requested_at DESC);
CREATE INDEX auth_email_attempts_tenant_time_idx ON public.auth_email_attempts (tenant_id, requested_at DESC);

CREATE OR REPLACE FUNCTION public.check_auth_email_attempt(
  _recipient_email text,
  _action_type text
) RETURNS TABLE (allowed boolean, attempt_number integer, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_email text := lower(trim(_recipient_email));
  latest_at timestamptz;
  attempts integer;
  wait_seconds integer;
BEGIN
  IF _action_type NOT IN ('signup', 'recovery') THEN
    RAISE EXCEPTION 'Unsupported authentication email action';
  END IF;

  SELECT max(a.requested_at), count(*)::integer
  INTO latest_at, attempts
  FROM public.auth_email_attempts a
  WHERE a.recipient_email = normalized_email
    AND a.action_type = _action_type
    AND a.requested_at >= now() - interval '1 hour';

  wait_seconds := CASE
    WHEN latest_at IS NULL THEN 0
    ELSE greatest(0, 60 - floor(extract(epoch FROM (now() - latest_at)))::integer)
  END;

  RETURN QUERY SELECT (wait_seconds = 0 AND attempts < 5), attempts + 1, wait_seconds;
END;
$$;
REVOKE ALL ON FUNCTION public.check_auth_email_attempt(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_auth_email_attempt(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.link_auth_email_attempts_to_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.tenant_id IS NOT NULL AND (OLD.tenant_id IS DISTINCT FROM NEW.tenant_id) THEN
    UPDATE public.auth_email_attempts
    SET tenant_id = NEW.tenant_id
    WHERE tenant_id IS NULL
      AND recipient_email = lower(trim(NEW.email));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.link_auth_email_attempts_to_tenant() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS profiles_link_auth_email_attempts ON public.profiles;
CREATE TRIGGER profiles_link_auth_email_attempts
AFTER UPDATE OF tenant_id ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.link_auth_email_attempts_to_tenant();