-- ═════════════════════════════════════════════════════════════════════════════
-- FLAS CRM — Milestone 1: Platform Super-Admin Email Configuration
--
-- Table: public.platform_email_config
-- Purpose: Platform-wide SMTP/IMAP credentials for transactional emails
--          (password resets, OTP verification, invites) sent from flas@mobidigisol.com.
--
-- Security:
--   1. RLS strictly enabled: only is_super_admin(auth.uid()) can read or modify.
--   2. Credentials at rest stored as encrypted envelope strings (AES-256-GCM).
--   3. Singleton pattern enforced: exactly 1 configuration record allowed.
--   4. Protected against accidental DELETE.
--
-- Idempotent. Safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Create table
CREATE TABLE IF NOT EXISTS public.platform_email_config (
  id              uuid PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  from_email      text NOT NULL DEFAULT 'flas@mobidigisol.com',
  from_name       text NOT NULL DEFAULT 'Flas CRM',
  smtp_host       text,
  smtp_port       integer NOT NULL DEFAULT 465,
  smtp_user       text,
  smtp_pass_enc   text,
  smtp_secure     boolean NOT NULL DEFAULT true,
  imap_host       text,
  imap_port       integer NOT NULL DEFAULT 993,
  imap_user       text,
  imap_pass_enc   text,
  imap_secure     boolean NOT NULL DEFAULT true,
  verified        boolean NOT NULL DEFAULT false,
  last_test_at    timestamptz,
  last_test_ok    boolean,
  last_test_error text,
  updated_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- 2. Ensure default singleton seed record exists
INSERT INTO public.platform_email_config (
  id,
  from_email,
  from_name,
  smtp_port,
  smtp_secure,
  imap_port,
  imap_secure,
  verified
)
VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'flas@mobidigisol.com',
  'Flas CRM',
  465,
  true,
  993,
  true,
  false
)
ON CONFLICT (id) DO NOTHING;

-- 3. Automatic updated_at trigger
DROP TRIGGER IF EXISTS platform_email_config_updated_at ON public.platform_email_config;
CREATE TRIGGER platform_email_config_updated_at
  BEFORE UPDATE ON public.platform_email_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. Singleton Guard: prevent inserting additional configuration records
CREATE OR REPLACE FUNCTION public.guard_platform_email_config_singleton()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT count(*) FROM public.platform_email_config WHERE id <> NEW.id) >= 1 THEN
    RAISE EXCEPTION 'Only one platform email configuration record is allowed on the system'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS platform_email_config_singleton_guard ON public.platform_email_config;
CREATE TRIGGER platform_email_config_singleton_guard
  BEFORE INSERT ON public.platform_email_config
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_platform_email_config_singleton();

-- 5. Deletion Guard: prevent accidental deletion of platform configuration
CREATE OR REPLACE FUNCTION public.guard_platform_email_config_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Platform email configuration cannot be deleted. Update settings instead.'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS platform_email_config_delete_guard ON public.platform_email_config;
CREATE TRIGGER platform_email_config_delete_guard
  BEFORE DELETE ON public.platform_email_config
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_platform_email_config_delete();

-- 6. Row-Level Security Configuration
ALTER TABLE public.platform_email_config ENABLE ROW LEVEL SECURITY;

-- Revoke all permissions from anonymous and public roles
REVOKE ALL ON public.platform_email_config FROM PUBLIC, anon;

-- Grant permissions to authenticated users and service_role
GRANT ALL ON public.platform_email_config TO authenticated;
GRANT ALL ON public.platform_email_config TO service_role;

-- Strictly gate ALL operations to super_admin users
DROP POLICY IF EXISTS "platform_email_config_superadmin_all" ON public.platform_email_config;
CREATE POLICY "platform_email_config_superadmin_all"
  ON public.platform_email_config
  FOR ALL
  TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

COMMIT;
