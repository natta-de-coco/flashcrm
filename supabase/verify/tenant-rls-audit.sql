-- FLAS read-only tenant RLS audit.
-- Run in Supabase SQL Editor as an administrator. It changes nothing.
-- Any returned row in section A/B needs review before production.

-- A) Public tables with tenant_id where RLS is disabled.
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS force_rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND a.attname = 'tenant_id'
  AND a.attnum > 0
  AND NOT a.attisdropped
  AND c.relrowsecurity = false
ORDER BY c.relname;

-- B) Policies on tenant-owned tables that are unconditional TRUE.
SELECT
  p.schemaname,
  p.tablename,
  p.policyname,
  p.cmd,
  p.roles,
  p.qual,
  p.with_check
FROM pg_policies p
WHERE p.schemaname = 'public'
  AND p.tablename IN (
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND a.attname = 'tenant_id'
      AND a.attnum > 0
      AND NOT a.attisdropped
  )
  AND (
    COALESCE(trim(p.qual), '') IN ('true', '(true)')
    OR COALESCE(trim(p.with_check), '') IN ('true', '(true)')
  )
ORDER BY p.tablename, p.policyname;

-- C) High-value tenant tables and their policies, for human review.
SELECT
  p.tablename,
  p.policyname,
  p.cmd,
  p.roles,
  p.qual,
  p.with_check
FROM pg_policies p
WHERE p.schemaname = 'public'
  AND p.tablename IN (
    'organizations', 'profiles', 'contacts', 'conversations', 'messages',
    'quotes', 'invoices', 'oauth_states', 'platform_apps', 'user_roles',
    'deletion_requests', 'social_accounts', 'social_posts', 'social_interactions',
    'wa_numbers', 'lead_sites', 'audit_log'
  )
ORDER BY p.tablename, p.cmd, p.policyname;

-- D) OAuth-state browser privileges must all be false after the hardening migration.
SELECT
  has_table_privilege('authenticated', 'public.oauth_states', 'SELECT') AS authenticated_can_read_oauth_states,
  has_table_privilege('anon', 'public.oauth_states', 'SELECT') AS anon_can_read_oauth_states,
  CASE
    WHEN to_regprocedure('public.consume_oauth_state_hash(text)') IS NULL THEN false
    ELSE has_function_privilege('authenticated', 'public.consume_oauth_state_hash(text)', 'EXECUTE')
  END AS authenticated_can_consume_state;

-- E) Organization no-filter visibility is an application-level acceptance test:
-- sign in as a normal tenant user and run through the client:
--   SELECT id,name FROM organizations;
-- Expected: own organization only. A super_admin may see all organizations.
