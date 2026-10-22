-- ==============================================================================
-- Migration: 20261022090000_social_accounts_browser_writes_server_only.sql
-- Description:
--   The browser role can no longer INSERT into or UPDATE social_accounts. Every write to
--   that table is made by the server with the service role, after the server has checked who
--   is asking.
--
--   Why: a connected account is shown as "Connected" only when last_validation_success_at is
--   set, and that column (with last_validation_attempt_at) is meant to be written only by the
--   server, only after a platform answered a live check. Nothing in the database enforced it.
--   Where the browser role (`authenticated`) holds table-level INSERT and UPDATE on
--   social_accounts (the review of PR #86 found that on the live database; Supabase's default
--   privileges give it to every table in public), a column added later inherits that grant, so
--   the two evidence columns were writable by any company admin straight through the REST API
--   with a forged "verified" time. The row-level policy ("Admins manage social accounts") only
--   decides whose rows, not which columns. A column-level REVOKE cannot undo a table-level grant,
--   so the table-level grant is what goes.
--
--   What it does, and only this:
--     1. REVOKE INSERT, UPDATE ON social_accounts FROM PUBLIC, anon, authenticated. PostgreSQL
--        takes the column-level INSERT and UPDATE grants of the same roles away in the same
--        statement (20260824, 20260826, 20260911 and 20260914 each made some, and one may sit on
--        an evidence column), so no per-column list is needed: it works whether or not the two
--        evidence columns have been added yet, and a column added later starts with no grant.
--        verify-social-accounts-writes.mjs proves it with only column-level grants present.
--     2. Keeps service_role at full access (GRANT ALL, as it already is).
--   SELECT and DELETE are not touched. It changes no row, backfills nothing and marks no
--   account verified. Safe to run twice.
--
--   The browser-role writers that existed were moved to the server in the same pull request:
--     src/lib/social.functions.ts        connectSocialAccount   INSERT platform, label,
--                                         external_id, access_token (the admin-only "paste a
--                                         token" fallback)
--     src/lib/connections.functions.ts   disconnectConnection  UPDATE active, health
--   Both now check is_tenant_admin() on the server and write with the service role, scoped to the
--   caller's company. Every other write to this table in src/ already used the service role.
--   Deleting a connection (deleteSocialAccount) is unchanged.
--
--   ORDER: deploy the code first, then run this. Run it before, or together with,
--   20261015120000_social_account_validation_evidence.sql; running it after is also safe and
--   closes the gap from that moment. Until it is applied nothing breaks (the new code does not
--   need the grant) and the hole stays open.
--
--   PRE-CHECK AND RECOVERY (one read-only query). Run it BEFORE applying this file and keep the
--   output: it lists every INSERT and UPDATE grant the browser roles hold today, table-level and
--   column-level, and the last column of each row is the exact statement that puts that grant
--   back. To recover, run those statements. (They are made by the table owner, which is also who
--   made the original grants on a Supabase project.) An empty result means the browser roles hold
--   no INSERT or UPDATE on the table: nothing to recover, and this file changes nothing.
--
--   begin-precheck-and-recovery
--     WITH held AS (
--       SELECT 'table' AS level, NULL::text AS col, a.grantee, a.privilege_type, a.is_grantable
--         FROM pg_class c, LATERAL aclexplode(c.relacl) a
--        WHERE c.oid = 'public.social_accounts'::regclass
--       UNION ALL
--       SELECT 'column', t.attname::text, a.grantee, a.privilege_type, a.is_grantable
--         FROM pg_attribute t, LATERAL aclexplode(t.attacl) a
--        WHERE t.attrelid = 'public.social_accounts'::regclass
--          AND t.attnum > 0 AND NOT t.attisdropped
--     ), browser AS (
--       SELECT h.*, CASE WHEN h.grantee = 0 THEN 'PUBLIC'
--                        ELSE quote_ident(pg_get_userbyid(h.grantee)) END AS role
--         FROM held h
--        WHERE h.privilege_type IN ('INSERT', 'UPDATE')
--          AND (h.grantee = 0 OR pg_get_userbyid(h.grantee) IN ('anon', 'authenticated'))
--     )
--     SELECT level, col AS "column", role, privilege_type, is_grantable AS grantable,
--            format(CASE level
--                     WHEN 'table' THEN 'GRANT %1$s ON public.social_accounts TO %3$s%4$s;'
--                     ELSE 'GRANT %1$s (%2$I) ON public.social_accounts TO %3$s%4$s;' END,
--                   privilege_type, col, role,
--                   CASE WHEN is_grantable THEN ' WITH GRANT OPTION' ELSE '' END) AS restore_with
--       FROM browser
--      ORDER BY level, role, privilege_type, col;
--   end-precheck-and-recovery
-- ==============================================================================

BEGIN;

REVOKE INSERT, UPDATE ON public.social_accounts FROM PUBLIC, anon, authenticated;

GRANT ALL ON public.social_accounts TO service_role;

COMMIT;

-- Verification (read-only).
-- 1. Expect three rows. anon and authenticated: all four columns false. service_role: all four true.
SELECT r.rolname AS role,
       has_table_privilege(r.rolname, 'public.social_accounts', 'INSERT') AS table_insert,
       has_table_privilege(r.rolname, 'public.social_accounts', 'UPDATE') AS table_update,
       has_any_column_privilege(r.rolname, 'public.social_accounts', 'INSERT') AS any_column_insert,
       has_any_column_privilege(r.rolname, 'public.social_accounts', 'UPDATE') AS any_column_update
  FROM pg_roles r
 WHERE r.rolname IN ('anon', 'authenticated', 'service_role')
 ORDER BY r.rolname;
-- 2. Expect zero rows: no column of social_accounts is writable by the browser roles.
SELECT a.attname AS column_name, r.rolname AS role, p.privilege
  FROM pg_attribute a
 CROSS JOIN pg_roles r
 CROSS JOIN (VALUES ('INSERT'), ('UPDATE')) AS p(privilege)
 WHERE a.attrelid = 'public.social_accounts'::regclass
   AND a.attnum > 0
   AND NOT a.attisdropped
   AND r.rolname IN ('anon', 'authenticated')
   AND has_column_privilege(r.rolname, a.attrelid, a.attnum, p.privilege)
 ORDER BY a.attname, r.rolname, p.privilege;
-- 3. Expect the same number as before this file: it changed no row and backfilled nothing.
SELECT count(*) AS accounts FROM public.social_accounts;
