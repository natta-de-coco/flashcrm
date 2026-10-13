-- ==============================================================================
-- Migration: 20261012010000_multi_user_email_accounts_and_storage_cap.sql
-- Description:
--   1. Per-seat/per-user email accounts (multi-mailbox support with AES-256 encryption)
--   2. 1 GB Storage auto-pruning engine and quota metrics
--   3. Email message threads for portal-based bidirectional replying
-- ==============================================================================

-- 1. Table: user_email_accounts
-- Allows each individual team member (Manager, Sales Rep, Support) to connect their own mailbox
CREATE TABLE IF NOT EXISTS public.user_email_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_type text NOT NULL DEFAULT 'personal' CHECK (account_type IN ('personal', 'shared', 'marketing')),
  label text NOT NULL DEFAULT 'Work Mailbox', -- e.g. "Tariq Sales Desk", "Main Marketing"
  from_name text NOT NULL,
  from_email text NOT NULL,
  reply_to text,
  
  -- SMTP sending configuration
  smtp_host text NOT NULL,
  smtp_port integer NOT NULL DEFAULT 465,
  smtp_secure boolean NOT NULL DEFAULT true,
  smtp_user text NOT NULL,
  smtp_pass_enc text NOT NULL, -- AES-256-GCM encrypted
  
  -- IMAP reply tracking configuration
  imap_host text,
  imap_port integer NOT NULL DEFAULT 993,
  imap_secure boolean NOT NULL DEFAULT true,
  imap_user text,
  imap_pass_enc text, -- AES-256-GCM encrypted
  imap_enabled boolean NOT NULL DEFAULT false,
  
  -- Signature & personalization
  signature_html text DEFAULT '',
  
  -- Status & Testing
  verified boolean NOT NULL DEFAULT false,
  last_test_at timestamptz,
  last_test_ok boolean,
  last_test_error text,
  is_default boolean NOT NULL DEFAULT false,
  
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  CONSTRAINT uq_tenant_user_from_email UNIQUE (tenant_id, user_id, from_email)
);

-- Index for fast lookup by tenant and user
CREATE INDEX IF NOT EXISTS idx_user_email_accounts_lookup 
  ON public.user_email_accounts(tenant_id, user_id);

-- Enable Row-Level Security
ALTER TABLE public.user_email_accounts ENABLE ROW LEVEL SECURITY;

-- RLS: Users can see their own personal accounts; Company Admins & Managers can see all tenant accounts
DROP POLICY IF EXISTS "user_email_accounts_select_policy" ON public.user_email_accounts;
CREATE POLICY "user_email_accounts_select_policy"
  ON public.user_email_accounts
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
    )
    AND (
      user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() 
          AND staff_role IN ('company_admin', 'super_admin', 'marketing_manager')
      )
    )
  );

DROP POLICY IF EXISTS "user_email_accounts_insert_policy" ON public.user_email_accounts;
CREATE POLICY "user_email_accounts_insert_policy"
  ON public.user_email_accounts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
    )
    AND user_id = auth.uid()
  );

DROP POLICY IF EXISTS "user_email_accounts_update_policy" ON public.user_email_accounts;
CREATE POLICY "user_email_accounts_update_policy"
  ON public.user_email_accounts
  FOR UPDATE
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
    )
    AND (
      user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() 
          AND staff_role IN ('company_admin', 'super_admin')
      )
    )
  );

DROP POLICY IF EXISTS "user_email_accounts_delete_policy" ON public.user_email_accounts;
CREATE POLICY "user_email_accounts_delete_policy"
  ON public.user_email_accounts
  FOR DELETE
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
    )
    AND (
      user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() 
          AND staff_role IN ('company_admin', 'super_admin')
      )
    )
  );


-- 2. Table: portal_email_messages
-- Stores bidirectional 1-on-1 and campaign email threads for portal-based replying
CREATE TABLE IF NOT EXISTS public.portal_email_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id uuid REFERENCES public.user_email_accounts(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  sender_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  
  direction text NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  from_address text NOT NULL,
  to_address text NOT NULL,
  cc_addresses text[] DEFAULT '{}',
  bcc_addresses text[] DEFAULT '{}',
  subject text NOT NULL,
  body_text text NOT NULL DEFAULT '',
  body_html text NOT NULL DEFAULT '',
  
  message_id_header text,
  in_reply_to_header text,
  
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('draft', 'sending', 'sent', 'delivered', 'failed', 'received')),
  error_message text,
  
  -- Byte size of this message to compute storage budget accurately
  storage_bytes integer NOT NULL DEFAULT 0,
  
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portal_email_messages_tenant 
  ON public.portal_email_messages(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_portal_email_messages_contact 
  ON public.portal_email_messages(contact_id);

CREATE INDEX IF NOT EXISTS idx_portal_email_messages_conv 
  ON public.portal_email_messages(conversation_id);

ALTER TABLE public.portal_email_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "portal_email_messages_tenant_isolation" ON public.portal_email_messages;
CREATE POLICY "portal_email_messages_tenant_isolation"
  ON public.portal_email_messages
  FOR ALL
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
    )
  );


-- 3. Storage Auto-Pruning Engine (Strict 1 GB Cap per Tenant)
-- Hard cap: 1,073,741,824 bytes (1 GB). Warning threshold: 85% (850 MB).
CREATE OR REPLACE FUNCTION public.check_and_prune_tenant_email_storage(target_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  max_cap_bytes bigint := 1073741824; -- 1 GB
  warning_bytes bigint := 912680550;  -- 85% of 1 GB
  total_used_bytes bigint := 0;
  purged_count integer := 0;
  usage_pct numeric := 0;
BEGIN
  -- Compute current usage from portal emails and delivery logs
  SELECT COALESCE(SUM(storage_bytes), 0)
  INTO total_used_bytes
  FROM public.portal_email_messages
  WHERE tenant_id = target_tenant_id;

  usage_pct := ROUND((total_used_bytes::numeric / max_cap_bytes::numeric) * 100, 2);

  -- If usage exceeds 85%, prune raw body contents of emails older than 60 days
  IF total_used_bytes > warning_bytes THEN
    WITH pruned AS (
      DELETE FROM public.portal_email_messages
      WHERE tenant_id = target_tenant_id
        AND created_at < NOW() - INTERVAL '60 days'
      RETURNING id, storage_bytes
    )
    SELECT COUNT(*), COALESCE(SUM(storage_bytes), 0)
    INTO purged_count, total_used_bytes
    FROM pruned;

    -- Recalculate remaining usage
    SELECT COALESCE(SUM(storage_bytes), 0)
    INTO total_used_bytes
    FROM public.portal_email_messages
    WHERE tenant_id = target_tenant_id;

    usage_pct := ROUND((total_used_bytes::numeric / max_cap_bytes::numeric) * 100, 2);
  END IF;

  RETURN jsonb_build_object(
    'tenant_id', target_tenant_id,
    'used_bytes', total_used_bytes,
    'max_cap_bytes', max_cap_bytes,
    'usage_percent', usage_pct,
    'purged_count', purged_count,
    'is_critical', (total_used_bytes >= warning_bytes)
  );
END;
$$;
