-- 1. Per-company locale, currency and country settings
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS country text NOT NULL DEFAULT 'AE',
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS compliance_region text;

-- 2. Retry / health state for social integrations
ALTER TABLE public.social_accounts
  ADD COLUMN IF NOT EXISTS refresh_token text,
  ADD COLUMN IF NOT EXISTS status_reason text,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS last_error_at timestamptz,
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS granted_scopes text[];

-- 3. Super-admin helper + allowlist
CREATE OR REPLACE FUNCTION public.is_super_admin(_user uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = _user AND p.staff_role = 'super_admin'
  )
$$;

CREATE TABLE IF NOT EXISTS public.platform_super_admins (
  email text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.platform_super_admins TO authenticated;
GRANT ALL ON public.platform_super_admins TO service_role;
ALTER TABLE public.platform_super_admins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "super admins read allowlist" ON public.platform_super_admins;
CREATE POLICY "super admins read allowlist" ON public.platform_super_admins
  FOR SELECT TO authenticated USING (public.is_super_admin());

INSERT INTO public.platform_super_admins (email)
VALUES ('atozsectrading@gmail.com'), ('moobbi@yahoo.com')
ON CONFLICT (email) DO NOTHING;

UPDATE public.profiles
SET staff_role = 'super_admin'
WHERE lower(email) IN (SELECT lower(email) FROM public.platform_super_admins);

CREATE OR REPLACE FUNCTION public.apply_super_admin_allowlist()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.email IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.platform_super_admins a WHERE lower(a.email) = lower(NEW.email)
  ) THEN
    NEW.staff_role := 'super_admin';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS profiles_apply_super_admin ON public.profiles;
CREATE TRIGGER profiles_apply_super_admin
  BEFORE INSERT OR UPDATE OF email ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.apply_super_admin_allowlist();

-- 4. Error / incident capture
CREATE TABLE IF NOT EXISTS public.error_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid,
  user_email text,
  kind text NOT NULL DEFAULT 'frontend',
  severity text NOT NULL DEFAULT 'error',
  message text NOT NULL,
  stack text,
  route text,
  url text,
  user_agent text,
  session_id text,
  release text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS error_events_tenant_created_idx ON public.error_events (tenant_id, created_at DESC);
GRANT SELECT ON public.error_events TO authenticated;
GRANT ALL ON public.error_events TO service_role;
ALTER TABLE public.error_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant members read their errors" ON public.error_events;
CREATE POLICY "tenant members read their errors" ON public.error_events
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() OR public.is_super_admin());

-- 5. Integration retry audit trail
CREATE TABLE IF NOT EXISTS public.connection_retry_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id uuid REFERENCES public.social_accounts(id) ON DELETE CASCADE,
  platform text NOT NULL,
  trigger text NOT NULL DEFAULT 'manual',
  outcome text NOT NULL,
  reason text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS connection_retry_log_tenant_idx ON public.connection_retry_log (tenant_id, created_at DESC);
GRANT SELECT ON public.connection_retry_log TO authenticated;
GRANT ALL ON public.connection_retry_log TO service_role;
ALTER TABLE public.connection_retry_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant members read retry log" ON public.connection_retry_log;
CREATE POLICY "tenant members read retry log" ON public.connection_retry_log
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() OR public.is_super_admin());

-- 6. Signup / subscription OTP codes (server-side only)
CREATE TABLE IF NOT EXISTS public.signup_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  code_hash text NOT NULL,
  purpose text NOT NULL DEFAULT 'signup',
  company_name text,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '15 minutes',
  consumed_at timestamptz,
  requested_ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS signup_otps_email_idx ON public.signup_otps (lower(email), created_at DESC);
GRANT ALL ON public.signup_otps TO service_role;
ALTER TABLE public.signup_otps ENABLE ROW LEVEL SECURITY;