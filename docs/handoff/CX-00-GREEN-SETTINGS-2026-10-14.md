# CX-00: Green FLAS Settings, 14 October 2026

Owner decision: preserve FLAS's existing green design. Adopt useful Settings organisation from the supplied Nexora reference; do not replace the palette, fonts, shell or existing business functions. PR #80 remains a separate draft and is not a prerequisite.

## Delivered in this branch

- Searchable, responsive Settings sections: My profile, Security, Company & region, Logo & invoices, Notifications, Team & access, Plan & billing, Apps & connections, Data & activity. All ten existing Settings cards remain reachable under their appropriate permissions.
- Personal profile and security are discoverable for known staff roles. Unknown/loading roles remain Home-only. Company sections and `/settings/email` remain manager-only. The display-name endpoint accepts only the authenticated user's name; no caller-supplied role, company, email or user ID.
- Saved-state indicators, reset edits, retained drafts across section switches, tenant/identity reset, pending-save controls, and a leave-page confirmation for the migrated forms. Background refreshes preserve edits; failed reads never offer editable invented defaults. This does not retrofit draft protection into the unchanged Team, billing, SMTP or privacy cards.
- Company/contact/tax/region configuration, with validation rather than silently converting a bad tax rate to zero. Reading billing settings creates nothing. A zero-row billing update cannot report success.
- Separate invoice logo/terms saves no longer overwrite company details. A completed upload acknowledges only the uploaded logo, preserving other edits. Existing storage, file-size/type checks and PDF snapshot behaviour are retained.
- Lead-alert preferences enforce manager access on the server and reject enabling raw WhatsApp alerts. Email and WhatsApp lead-alert delivery is explicitly unfinished. No synthetic sent/delivered evidence is produced. New main's email-not-sent reason and failed-email logging are retained; failed external diagnostics do not prevent an internal notification.
- A personal notification bell lists the latest 20 alerts, reports the actual unread count, polls every 30 seconds, and marks only the caller's selected rows as read. Alerts target company managers plus eligible teammates whose email is explicitly listed. Unrelated external email addresses receive no in-app access. Notification bodies render as text. This is a lead-alert centre, not a complete notification framework or mobile push service.
- New interface text is supplied in en/ar/ms/fil/sw. Arabic layout and mobile overflow were checked.

## Verification and limits

Local automated checks: full npm test suite, TypeScript, lint and production build. Focused tests exercise actual Settings server handlers with scoped database adapters, failed reads/writes, strict inputs, absent rows and external-send truthfulness. The disposable PostgreSQL verifier executes both migrations twice and tests real grants/RLS for two companies, staff, managers, anonymous visitors, changed roles/tenants, forged evidence, foreign recipients/leads and read-at-only updates. The repository migration harness checks fresh install and pending re-runs.

Browser acceptance uses the actual profile, region, company, invoice and alert components with **labeled in-memory fixtures**: no credentials, external messages, customer rows, invoices, payment actions or storage writes. Tested draft retention, separate logo/terms save, disabled saves after success, failed-load Retry, country search `+966` by keyboard, two-workspace region isolation, staff-only personal sections, display-name save, notification read state, and Arabic at 390×844. This is not evidence of production OAuth, PDF/logo storage, MFA enrollment, SMTP or end-to-end provider delivery.

Existing finance tax mirroring (`billing_settings` and `business_profiles`) is not atomic. `ensureBillingSettings` and the mirror still require the finance owner's hardening; this branch checks the primary update actually affected a row. Coordinate with AG-01/#54. SMTP server authorisation/error/default-opt-in findings were posted separately on #78 for AG-02; no SMTP secrets or auth flow were changed here. No claim that all CRM issues are resolved.

## SQL: authored and verified locally, NOT applied to Lovable

Files:

1. `supabase/migrations/20261014180000_lead_alert_preferences_server_only.sql`
2. `supabase/migrations/20261014181000_workspace_notifications.sql`

Prerequisites: base schema including organizations, profiles, leads and `20261010010000_enterprise_growth_pillars.sql` (tenant_alert_settings and lead_alerts_log). Company profile read also requires the existing `20261008000000_business_profile_contact_fields.sql`. Confirm the profile privilege fix is already applied: users must not be able to change their tenant or staff role.

Read-only precheck:

```sql
select to_regclass('public.tenant_alert_settings') as preferences,
       to_regclass('public.lead_alerts_log') as evidence,
       to_regclass('public.workspace_notifications') as notifications;
select count(*) as profiles_without_company
from public.profiles where tenant_id is null;
select has_column_privilege('authenticated','public.profiles','tenant_id','UPDATE') as tenant_browser_update,
       has_column_privilege('authenticated','public.profiles','staff_role','UPDATE') as role_browser_update;
select exists(select 1 from information_schema.columns where table_schema='public'
  and table_name='business_profiles' and column_name='tax_registration_number') as tax_profile_column;
```

Stop if prerequisite tables/tax column are absent or either privilege column is browser-writable. Do not assign missing-company users, change customer memberships or repair old rows blindly.

Deployment: merge only after review/checks. Deploy the code containing manager-checked preferences and the bell. CX-00 then applies SQL 1 followed by SQL 2 in Lovable and records results. During that interval the bell shows a setup/load error and Retry, rather than an empty inbox or fake ready state. SQL 2 may also be prepared before deployment since it adds a new table and leaves existing history untouched. Neither script sends a message or archives/deletes existing data.

Read-only postcheck:

```sql
select has_table_privilege('authenticated','public.tenant_alert_settings','UPDATE') as browser_preferences_update,
       has_column_privilege('authenticated','public.tenant_alert_settings','lead_alerts_enabled','UPDATE') as browser_column_update,
       has_table_privilege('authenticated','public.lead_alerts_log','INSERT') as browser_evidence_insert,
       has_column_privilege('authenticated','public.workspace_notifications','read_at','UPDATE') as recipient_mark_read,
       has_column_privilege('authenticated','public.workspace_notifications','body','UPDATE') as browser_body_update,
       has_table_privilege('authenticated','public.workspace_notifications','INSERT') as browser_notification_insert;
-- Expected false,false,false,true,false,false.
select relname, relrowsecurity from pg_class where oid in
  ('public.tenant_alert_settings'::regclass,'public.lead_alerts_log'::regclass,'public.workspace_notifications'::regclass);
-- All true. Policies restrict SELECT/read_at UPDATE to the current user and company.
select policyname,cmd,roles from pg_policies where schemaname='public'
  and tablename in ('tenant_alert_settings','lead_alerts_log','workspace_notifications');
```

After deployment, use disposable test companies to verify each user's alert feed and own display-name save; do not use real customers for test sends. For an existing test lead-capture workflow, confirm a real persisted notification and read acknowledgement after SQL. Do not call a lead capture against production simply to populate the bell.

Recovery: both SQL files are transactional and re-runnable. If a script fails, fix its prerequisites and rerun; do not force customer-data updates. Keep the strengthened grants/RLS even if UI rollback is required. Roll back via a reviewed code revert to the prior green UI; leave the new notification table and its history intact. Returning to code with the old raw alert sender or missing manager guard is not an acceptable recovery. No automatic database rollback or data purge is provided.

## Future reference features retained as backlog

| Reference idea                                           | FLAS state / next requirement                                                                                                                      |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Profile, security, workspace, billing, connections, data | Actual existing modules organised here; unchanged modules need their own operational QA.                                                           |
| Logo and professional invoices                           | Existing logo pipeline retained; test actual upload/storage/PDF on a test company after reviewed deployment. Finance atomicity remains AG-01 work. |
| Notification controls                                    | Internal lead alerts here; real external email and approved WhatsApp pipeline/template delivery remain separate work.                              |
| Personal appearance/accessibility                        | Keep green branding. Add documented individual choices only when backed by persisted preferences and keyboard/contrast/RTL tests.                  |
| Sales pipelines/custom fields                            | Future schema, tenant isolation, migration, filtering and import/export compatibility required; no demo save controls.                             |
| API keys/webhooks                                        | Existing advanced Integrations remains authoritative; future Settings shortcut needs admin permissions, redacted views and rotation evidence.      |
| Team/session management                                  | Existing team/MFA controls retained; session revocation and additional account changes require genuine server support and audits.                  |
| Data portability/retention                               | Existing privacy module retained. Do not present unimplemented backup, restore or deletion controls as working.                                    |

Preserve future functions as explicit backlog, not an assertion that the supplied theme's mock controls provide those capabilities. Each follow-up needs a commit-scoped GitHub handover in #73.
