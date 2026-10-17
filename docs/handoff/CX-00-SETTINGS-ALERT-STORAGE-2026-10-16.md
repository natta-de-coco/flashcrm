# CX-00: Settings/Home audit repair and alert storage, 17 October 2026

## Observed release and database state

PR #84 is merged at `400dad09da9f2a54481d3178b59f2503c7b9cfa3`. Final-head and main CI passed. The final source was checked in Lovable Code, Publish completed with **Your website was updated**, and the live Inbox was reloaded. Dates and reading space were checked at 1440x900 and 375x812 without sending a message. Publication evidence is retained privately; no customer screenshots or content belong in GitHub.

The following live read-only precheck then found a separate Settings setup gap:

```sql
SELECT to_regclass('public.organizations') IS NOT NULL AS organizations_ready,
       to_regclass('public.profiles') IS NOT NULL AS profiles_ready,
       to_regclass('public.leads') IS NOT NULL AS leads_ready,
       to_regclass('public.business_profiles') IS NOT NULL AS business_profiles_ready,
       to_regclass('public.tenant_alert_settings') IS NOT NULL AS alert_preferences_ready,
       to_regclass('public.lead_alerts_log') IS NOT NULL AS alert_evidence_ready,
       to_regclass('public.workspace_notifications') IS NOT NULL AS notifications_ready,
       has_column_privilege('authenticated','public.profiles','tenant_id','UPDATE') AS tenant_browser_update,
       has_column_privilege('authenticated','public.profiles','staff_role','UPDATE') AS role_browser_update,
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
         AND table_name='business_profiles' AND column_name='tax_registration_number') AS tax_profile_ready,
       (SELECT count(*) FROM public.profiles WHERE tenant_id IS NULL) AS profiles_without_company;
```

Results: organizations/profiles/leads/business profiles/tax column **true**; both profile privilege updates **false**; alert preferences/evidence/notifications **false**; two profiles have no company. No memberships or roles were changed. Do not assign those users to a company automatically.

## Narrow prerequisite

`20261010010000_enterprise_growth_pillars.sql` contains the original alert definitions but also email drip, routing and conversation SLA changes with broader policies. Do not run that whole file solely to fix Settings. The reviewed forward migration `20261016142000_settings_alert_prerequisites.sql` supplies only the two missing alert tables, with hardened grants and manager-only reads in the same transaction. Existing data is retained. Unknown policies or incompatible existing schema must stop the migration rather than be overwritten.

The change adds no sends, campaigns, routing, membership changes or historical backfill. Service-role writes remain server-owned. SELECT/INSERT on evidence is the minimum service-role contract, not an exclusive grant: existing server maintenance permissions are retained. Browser roles have no evidence writes. Schema/index operations can acquire locks; inspect existing tables and their size if another process creates them before execution. A successful code merge is not SQL execution.

## Execution order and gates

First review the exact committed head and require its verify/database CI. The manager-checked Settings code and notification bell from #84 are already published; verify that live deployment before revoking old browser writes.

**17 October release gate:** CL-03's follow-up review on #84 found that repeated chat-widget messages for an existing lead can dispatch another notification each time (`lead-automation.server.ts`). PR #87 repairs the dispatcher with the server-only `record_sales_lead_alert` function. Deploy the reviewed new code **before** creating currently absent live notification storage. Old #84 code would duplicate alerts once storage exists. New code safely reports a missing function; lead capture remains saved, but alerts need a later capture retry until SQL completes. There is no automatic retry scheduler or historical backfill. Do not populate the live bell with test customer messages.

Run the precheck above again immediately before execution. Stop on missing organizations/profiles/leads/business profiles/tax column or browser-writable privilege columns. If any of the three alert tables now exists, inspect its columns, constraints, triggers, grants and policy predicates before proceeding. Do not treat `CREATE TABLE IF NOT EXISTS` as schema validation.

Apply these committed files separately, in this order:

1. `supabase/migrations/20261016142000_settings_alert_prerequisites.sql`
2. `supabase/migrations/20261014180000_lead_alert_preferences_server_only.sql`
3. `supabase/migrations/20261014181000_workspace_notifications.sql`
4. `supabase/migrations/20261017100000_lead_alert_dispatch_dedup.sql`

The date order above is intentional for this live database: the new forward prerequisite repairs an absent old table before the earlier Settings scripts can run. Before the fourth file, also require `email_delivery_log` and `log_email_delivery(uuid,uuid,text,text,text,text,text,text,text,text,jsonb)` to exist. Run the duplicate checks below first. No duplicate removal is authorized by this runbook. The fourth file locks the three evidence tables briefly, stops on duplicates or incompatible index shape, installs a notification uniqueness index, and installs the service-only transactional function. It inserts no customer rows during migration. Do not edit historical migrations or claim a row in Supabase migration history was written by pasting SQL unless it actually was. Stop on any unexpected error/drift and record each file separately.

```sql
SELECT to_regclass('public.email_delivery_log') IS NOT NULL AS email_evidence_ready,
       to_regprocedure('public.log_email_delivery(uuid,uuid,text,text,text,text,text,text,text,text,jsonb)') IS NOT NULL AS email_log_function_ready;
-- Both true before file 4.
SELECT count(*) AS duplicate_notification_groups FROM (
  SELECT tenant_id,recipient_user_id,lead_id FROM public.workspace_notifications
  WHERE lead_id IS NOT NULL GROUP BY 1,2,3 HAVING count(*)>1
) duplicates;
SELECT count(*) AS duplicate_alert_log_groups FROM (
  SELECT tenant_id,lead_id,alert_channel,
    CASE WHEN alert_channel='email' THEN lower(btrim(recipient)) ELSE btrim(recipient) END
  FROM public.lead_alerts_log WHERE lead_id IS NOT NULL GROUP BY 1,2,3,4 HAVING count(*)>1
) duplicates;
SELECT count(*) AS duplicate_email_log_groups FROM (
  SELECT tenant_id,lower(btrim(recipient)),provider_msg_id FROM public.email_delivery_log
  WHERE template='internal_sales_lead_alert' AND provider='platform_smtp'
    AND provider_msg_id LIKE 'alert_unsent_%' GROUP BY 1,2,3 HAVING count(*)>1
) duplicates;
-- All three counts must be 0. Stop and request a reviewed preservation plan otherwise.
```

After the prerequisite, verify that both alert tables exist with RLS, zero browser writes at table and column level, manager-only same-company SELECT, service-role preference CRUD and evidence SELECT/INSERT. After all four scripts, run:

```sql
SELECT has_table_privilege('authenticated','public.tenant_alert_settings','UPDATE') AS browser_preferences_update,
       has_column_privilege('authenticated','public.tenant_alert_settings','lead_alerts_enabled','UPDATE') AS browser_column_update,
       has_table_privilege('authenticated','public.lead_alerts_log','INSERT') AS browser_evidence_insert,
       has_column_privilege('authenticated','public.workspace_notifications','read_at','UPDATE') AS recipient_mark_read,
       has_column_privilege('authenticated','public.workspace_notifications','body','UPDATE') AS browser_body_update,
       has_table_privilege('authenticated','public.workspace_notifications','INSERT') AS browser_notification_insert;
-- Expected false,false,false,true,false,false.
SELECT relname, relrowsecurity FROM pg_class WHERE oid IN
 ('public.tenant_alert_settings'::regclass,'public.lead_alerts_log'::regclass,'public.workspace_notifications'::regclass);
-- All true.
SELECT policyname,tablename,cmd,roles,qual,with_check FROM pg_policies WHERE schemaname='public'
 AND tablename IN ('tenant_alert_settings','lead_alerts_log','workspace_notifications');
-- Only manager SELECT for alert settings/evidence. Notifications: own eligible recipient + company SELECT/read_at UPDATE.
SELECT has_function_privilege('anon','public.validate_workspace_notification_recipient()','EXECUTE') AS anon_guard,
       has_function_privilege('authenticated','public.validate_workspace_notification_recipient()','EXECUTE') AS browser_guard,
       has_function_privilege('service_role','public.validate_workspace_notification_recipient()','EXECUTE') AS service_guard;
-- Expected false,false,true. Inspect the BEFORE INSERT recipient/lead tenant guard as well.
SELECT has_function_privilege('anon','public.record_sales_lead_alert(uuid,uuid,text,text)','EXECUTE') AS anon_dispatch,
       has_function_privilege('authenticated','public.record_sales_lead_alert(uuid,uuid,text,text)','EXECUTE') AS browser_dispatch,
       has_function_privilege('service_role','public.record_sales_lead_alert(uuid,uuid,text,text)','EXECUTE') AS service_dispatch;
-- Expected false,false,true. Inspect the pinned search_path and unique notification index too.
```

Reload the live bell and verify it loads instead of reporting missing setup. Do not create a production lead or send a message to populate it; an empty real feed is valid. Real persisted-alert delivery/read acknowledgement should be tested only through an existing disposable-company workflow. Recipients are current same-company managers plus explicitly listed eligible teammates; a newly eligible recipient can receive a notification on a later capture retry. Each lead/recipient is stored once, not once per widget message. Email and WhatsApp delivery remain unimplemented/paused and are recorded as failed, never sent. Diagnostic storage failure preserves the internal notification and reports pending diagnostics for a safe later capture retry.

## Verification, handover and recovery

The existing disposable PostgreSQL verifier is expanded to execute the actual new prerequisite on an empty schema and on legacy tables/grants, rerun it, assert no history loss, exercise tenant/role isolation and reject deliberate schema/policy drift. Final tested head and CI, followed by exact live SQL outcomes, belong in #73 and the relevant PR. Until those outcomes are posted, the scripts are **pending**, not applied.

Local verification completed on 17 October using an exact-source copy in the isolated `work/db-runtime` dependency runtime (PostgreSQL 17.10). `FLAS_SETTINGS_TEST_PORT=55082 node supabase/verify/verify-lead-alert-settings.mjs` printed its PASS line and exited 0. The full current migration harness passed fresh 99/99, pending rerun 0 failures and all seven critical function smoke calls; its 22 known baseline historical rerun failures remain unchanged. Independent source review cleared the fixed canonical-definition guards and found no additional blocker. Initial sandbox loopback denial and a colliding local test port were runtime failures, not counted as passes; the final checked run used a separate local port.

All four files are transactional. Keep hardened grants, the deduplication index/function and retained history if UI rollback is needed. Do not roll the dispatcher back to #84 while notification storage is enabled. Recover application behavior with a reviewed forward fix; do not drop tables, purge history or restore browser evidence writes. Partial execution of the four separate files requires recording the last successful file and verifying state before retrying.

## Other #84 audit repairs in this PR

- Settings saves hosted logo URLs and explicit clearing. Explicit null tax numbers clear billing and business-profile mirrors. Mirror rejection is reported as a partial save; these two existing writes are not an atomic transaction.
- Meta health requires a company manager before service-role/provider access. Database failures cannot become zero counts or "no numbers". Joined exact counts avoid unbounded conversation-ID lists.
- Home skips modules hidden from a staff role, marks incomplete ordered samples, and excludes missing/partial factors from scores. Fewer than three measured factors shows insufficient activity, not an invented business-risk grade. The AI brief has the same caveats and its own advisor-role gate.
- Settings labels alert coverage as website-chat leads only. Other lead intake paths are not represented as covered. #69's already-included hook fixes retain their missing loading-to-loaded regression coverage here; no stale route tree is merged.
- #86 provider status and #68 two-factor remain separate and held for CL-03's round 2. This release does not prove live social delivery or full REST/realtime MFA enforcement.
