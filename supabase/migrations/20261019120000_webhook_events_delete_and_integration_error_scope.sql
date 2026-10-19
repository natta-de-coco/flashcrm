-- Two permission holes, closed by taking the permission away from the browser role.
-- Safe to run twice. No data is written or deleted. One transaction.
--
-- 1. webhook_events DELETE.
--    20260821133211 granted DELETE on public.webhook_events to `authenticated` and added
--    the policy "Admins can delete webhook events" (USING has_role(auth.uid(), 'admin')).
--    That role is global: it names no company. 20260901000000 later scoped the SELECT and
--    UPDATE policies to the caller's company but left DELETE alone, so anyone carrying the
--    legacy `admin` role could delete webhook events with no regard to company. (A DELETE
--    that names a column in its WHERE is also filtered by the tenant-scoped SELECT policy;
--    one that names none, such as an unfiltered DELETE, is judged by the DELETE policy
--    alone and removed every company's events.)
--    Nothing in the app deletes webhook events from the browser (the Monitoring screen and
--    the integration log only read them; the server inserts, updates and retries them with
--    the service role), so the policy is dropped and the privilege is revoked. The
--    service role keeps it. SELECT and UPDATE are not touched.
--
-- 2. record_integration_error().
--    SECURITY DEFINER, and it writes whatever tenant id the caller passes. 20260911200000
--    and 20260914161601 granted EXECUTE on it to `authenticated`, so any signed-in person
--    could write error rows into another company. The only caller is server code
--    (src/lib/integration-errors.server.ts, through supabaseAdmin = service role), so
--    EXECUTE is taken back from every role but service_role. The function body, its
--    signature and its pinned search_path are not changed.
--
-- Prerequisites: 20260821133211 (webhook_events), 20260901060000 (record_integration_error).
-- Independent of the mfa_session_gate migration: it drops one named policy and changes two
-- privileges, and never touches any other policy. Run it after every other pending
-- migration; if 20260911200000 or 20260914161601 is ever pasted again, run this file again.
--
-- Rollback (restores both exactly as 20260821133211 and 20260914161601 left them):
--   GRANT DELETE ON public.webhook_events TO authenticated;
--   CREATE POLICY "Admins can delete webhook events" ON public.webhook_events
--     FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
--   GRANT EXECUTE ON FUNCTION public.record_integration_error(
--     uuid, uuid, text, text, text, integer, text, text, text, text, text, text, text, text, text, boolean, text, text
--   ) TO authenticated;
BEGIN;

-- Stop and change nothing rather than queue behind a long query on a busy table.
SET LOCAL lock_timeout = '10s';

-- 1. webhook_events: the server deletes, the browser does not.
DROP POLICY IF EXISTS "Admins can delete webhook events" ON public.webhook_events;
REVOKE DELETE ON public.webhook_events FROM PUBLIC, authenticated;

-- 2. record_integration_error: the server writes, the browser does not.
DO $$
BEGIN
  IF to_regprocedure('public.record_integration_error(uuid,uuid,text,text,text,integer,text,text,text,text,text,text,text,text,text,boolean,text,text)') IS NULL THEN
    RAISE NOTICE 'record_integration_error does not exist here; nothing to revoke';
  ELSE
    REVOKE ALL ON FUNCTION public.record_integration_error(
      uuid, uuid, text, text, text, integer, text, text, text, text, text, text, text, text, text, boolean, text, text
    ) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.record_integration_error(
      uuid, uuid, text, text, text, integer, text, text, text, text, text, text, text, text, text, boolean, text, text
    ) TO service_role;
  END IF;
END $$;

COMMIT;

-- Read-only check. Expect: webhook_delete_policies = 0, every can_* column = false,
-- server_can_delete = true, server_can_record = true (NULL if the function is absent).
SELECT
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'webhook_events'
      AND permissive = 'PERMISSIVE' AND cmd IN ('DELETE', 'ALL'))                  AS webhook_delete_policies,
  has_table_privilege('authenticated', 'public.webhook_events', 'DELETE')          AS authenticated_can_delete,
  has_function_privilege('authenticated',
    to_regprocedure('public.record_integration_error(uuid,uuid,text,text,text,integer,text,text,text,text,text,text,text,text,text,boolean,text,text)'),
    'EXECUTE')                                                                     AS authenticated_can_record,
  has_function_privilege('anon',
    to_regprocedure('public.record_integration_error(uuid,uuid,text,text,text,integer,text,text,text,text,text,text,text,text,text,boolean,text,text)'),
    'EXECUTE')                                                                     AS anon_can_record,
  has_table_privilege('service_role', 'public.webhook_events', 'DELETE')           AS server_can_delete,
  has_function_privilege('service_role',
    to_regprocedure('public.record_integration_error(uuid,uuid,text,text,text,integer,text,text,text,text,text,text,text,text,text,boolean,text,text)'),
    'EXECUTE')                                                                     AS server_can_record;
