-- Migration: 20261014160000_email_schema_and_privacy_hardening.sql
-- Stage 1: Email schema and privacy repairs (Issue #78)
-- 1. platform_email_config least-privilege permissions (revoke TRUNCATE/DELETE from authenticated)
-- 2. tenant_smtp_config column-level grant restriction and removal of cross-tenant NULL fallback in guard_campaign_verified_smtp
-- 3. Uniqueness constraints on drip sequences, steps, and enrollments
-- 4. Explicit tenant RLS policies on drip_steps
-- 5. Safe non-destructive storage budget calculation (drop/replace check_and_prune_tenant_email_storage)

BEGIN;

-- 1. platform_email_config least-privilege permissions
REVOKE ALL ON public.platform_email_config FROM PUBLIC, anon;
REVOKE ALL ON public.platform_email_config FROM authenticated;
GRANT SELECT, UPDATE ON public.platform_email_config TO authenticated;
GRANT ALL ON public.platform_email_config TO service_role;

DROP POLICY IF EXISTS "platform_email_config_superadmin_all" ON public.platform_email_config;
CREATE POLICY "platform_email_config_superadmin_all"
  ON public.platform_email_config
  FOR ALL
  TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- 2. tenant_smtp_config column-level browser grants and trigger hardening
REVOKE ALL ON public.tenant_smtp_config FROM PUBLIC, anon;
REVOKE ALL ON public.tenant_smtp_config FROM authenticated;

-- Only grant SELECT on non-secret columns to authenticated; smtp_pass_enc, imap_pass_enc and api_key_enc remain strictly restricted
GRANT SELECT (
  tenant_id, provider, from_email, from_name, reply_to, region, domain,
  verified, last_test_at, last_test_ok, last_test_error,
  smtp_host, smtp_port, smtp_secure, smtp_user,
  imap_host, imap_port, imap_secure, imap_user, imap_enabled,
  welcome_email_enabled, welcome_discount_code, welcome_discount_percent,
  welcome_subject, welcome_body_html, spf_verified, dkim_verified, dmarc_verified,
  created_by, created_at, updated_at
) ON public.tenant_smtp_config TO authenticated;

GRANT ALL ON public.tenant_smtp_config TO service_role;

-- Fix guard_campaign_verified_smtp: remove cross-tenant LIMIT 1 fallback, require tenant_id, set search_path
CREATE OR REPLACE FUNCTION public.guard_campaign_verified_smtp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_verified boolean;
BEGIN
  IF NEW.status IN ('scheduled', 'in_progress', 'sending') THEN
    IF NEW.tenant_id IS NULL THEN
      RAISE EXCEPTION 'Cannot schedule or send campaign without a valid tenant_id';
    END IF;

    SELECT verified INTO v_verified
    FROM public.tenant_smtp_config
    WHERE tenant_id = NEW.tenant_id;

    IF v_verified IS NOT TRUE THEN
      RAISE EXCEPTION 'Cannot schedule or send campaign without verified tenant SMTP credentials';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Drip automations uniqueness, pre-checks and foreign key integrity
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'drip_sequences' AND constraint_name = 'drip_sequences_tenant_id_fkey'
  ) THEN
    ALTER TABLE public.drip_sequences
      ADD CONSTRAINT drip_sequences_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'drip_enrollments' AND constraint_name = 'drip_enrollments_tenant_id_fkey'
  ) THEN
    ALTER TABLE public.drip_enrollments
      ADD CONSTRAINT drip_enrollments_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 3a. Duplicate pre-check on drip_sequences (tenant_id, trigger_event)
DO $$
DECLARE
  _dup_seqs integer;
BEGIN
  SELECT count(*) INTO _dup_seqs FROM (
    SELECT tenant_id, trigger_event
    FROM public.drip_sequences
    GROUP BY tenant_id, trigger_event
    HAVING count(*) > 1
  ) s;

  IF _dup_seqs > 0 THEN
    RAISE EXCEPTION
      'Cannot create unique index: public.drip_sequences contains % duplicate (tenant_id, trigger_event) group(s). Reconcile definitions before applying migration.',
      _dup_seqs
      USING HINT = 'Inspect with: SELECT tenant_id, trigger_event, array_agg(id ORDER BY created_at) FROM public.drip_sequences GROUP BY 1,2 HAVING count(*) > 1;';
  END IF;
END $$;

-- 3b. Duplicate pre-check on drip_steps (sequence_id, step_number)
DO $$
DECLARE
  _dup_steps integer;
BEGIN
  SELECT count(*) INTO _dup_steps FROM (
    SELECT sequence_id, step_number
    FROM public.drip_steps
    GROUP BY sequence_id, step_number
    HAVING count(*) > 1
  ) st;

  IF _dup_steps > 0 THEN
    RAISE EXCEPTION
      'Cannot create unique index: public.drip_steps contains % duplicate (sequence_id, step_number) group(s). Reconcile step numbers before applying migration.',
      _dup_steps
      USING HINT = 'Inspect with: SELECT sequence_id, step_number, array_agg(id ORDER BY created_at) FROM public.drip_steps GROUP BY 1,2 HAVING count(*) > 1;';
  END IF;
END $$;

-- 3c. Safe reconciliation for concurrent active drip_enrollments:
-- Non-destructive: keeps the newest active enrollment and transitions older duplicates to 'paused'
DO $$
DECLARE
  _reconciled integer := 0;
BEGIN
  WITH duplicates AS (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY tenant_id, sequence_id, email
             ORDER BY created_at DESC, id DESC
           ) as rn
    FROM public.drip_enrollments
    WHERE status IN ('enrolled', 'in_progress')
  ),
  updated AS (
    UPDATE public.drip_enrollments
    SET status = 'paused',
        updated_at = NOW()
    WHERE id IN (SELECT id FROM duplicates WHERE rn > 1)
    RETURNING id
  )
  SELECT count(*) INTO _reconciled FROM updated;

  IF _reconciled > 0 THEN
    RAISE NOTICE 'Reconciled % duplicate active drip enrollment(s) to paused state.', _reconciled;
  END IF;
END $$;

-- Ensure one trigger event per tenant for drip_sequences
CREATE UNIQUE INDEX IF NOT EXISTS idx_drip_sequences_tenant_trigger 
  ON public.drip_sequences (tenant_id, trigger_event);

-- Ensure unique step_number per sequence in drip_steps
CREATE UNIQUE INDEX IF NOT EXISTS idx_drip_steps_sequence_step 
  ON public.drip_steps (sequence_id, step_number);

-- Ensure unique active enrollment per tenant, sequence, and email
CREATE UNIQUE INDEX IF NOT EXISTS idx_drip_enrollments_active_unique 
  ON public.drip_enrollments (tenant_id, sequence_id, email)
  WHERE status IN ('enrolled', 'in_progress');

-- 4. Explicit tenant RLS policies on drip_steps
ALTER TABLE public.drip_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "drip_steps_tenant_isolation" ON public.drip_steps;
CREATE POLICY "drip_steps_tenant_isolation" ON public.drip_steps
  FOR ALL TO authenticated
  USING (
    sequence_id IN (
      SELECT id FROM public.drip_sequences
      WHERE tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
    )
  )
  WITH CHECK (
    sequence_id IN (
      SELECT id FROM public.drip_sequences
      WHERE tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
    )
  );

-- 5. Safe non-destructive storage calculation: no automated deletion of customer emails
CREATE OR REPLACE FUNCTION public.check_and_prune_tenant_email_storage(target_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  max_cap_bytes bigint := 1073741824; -- 1 GB
  warning_bytes bigint := 912680550;  -- 85% of 1 GB
  total_used_bytes bigint := 0;
  usage_pct numeric := 0;
BEGIN
  SELECT COALESCE(SUM(storage_bytes), 0)
  INTO total_used_bytes
  FROM public.portal_email_messages
  WHERE tenant_id = target_tenant_id;

  usage_pct := ROUND((total_used_bytes::numeric / max_cap_bytes::numeric) * 100, 2);

  -- Non-destructive: never DELETE emails automatically
  RETURN jsonb_build_object(
    'tenant_id', target_tenant_id,
    'used_bytes', total_used_bytes,
    'max_cap_bytes', max_cap_bytes,
    'usage_percent', usage_pct,
    'purged_count', 0,
    'is_critical', (total_used_bytes >= warning_bytes)
  );
END;
$$;

COMMIT;
