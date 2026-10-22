# CX-00: WhatsApp operations and public intake release, 17 October

This release combines reviewed #66 and #61 with normal merges and preserves #87's Settings/Home fixes. No customer sends, campaigns or historical webhook-row rewrites were performed.

## Reviewed behavior

- Default-number switching uses one transactional server-only function when available; before its SQL is installed the existing checked two-step/restore fallback remains. Atomicity is **not** promised for that fallback.
- Inbound failure alerts stay with the owning company. The added review repair also keeps the entire webhook payload platform-only unless every entry resolves to the same known company. Per-number receipt processing still routes separately. Unknown, unowned and mixed batches cannot expose one company's full payload to another company through a newly stored event.
- Health calculations classify refusal notes within the same message population as delivery statuses. Capped samples are explicitly labeled with their coverage; failed reads do not become a healthy zero.
- #61 adds incremental public-intake retry/error, replay and request-validation fixes. It introduces no SQL and does not finish the separate plugin activation/secret-column audit.

## SQL and live prerequisites

Read-only checks first:

```sql
SELECT has_table_privilege('service_role','public.webhook_dedup','DELETE') AS intake_retry_cleanup_ready,
       to_regclass('public.wa_numbers_single_default_per_tenant') IS NOT NULL AS default_index_ready,
       to_regclass('public.conversations_whatsapp_contact_unique') IS NOT NULL AS contact_thread_index_ready,
       to_regprocedure('public.open_contact_whatsapp(uuid)') IS NOT NULL AS contact_open_ready;
-- Expect all true. Missing older indexes/functions need their own prechecks; do not force them.
SELECT relrowsecurity FROM pg_class WHERE oid='public.webhook_events'::regclass;
SELECT policyname,cmd,roles,qual,with_check FROM pg_policies
WHERE schemaname='public' AND tablename='webhook_events';
-- SELECT and UPDATE must scope to current_tenant_id() OR platform super admin,
-- with no tenant_id IS NULL branch. A null-tenant payload is platform-only.
```

Older prerequisites are `20260925121000_default_wa_number_is_per_workspace.sql` and `20260927210000_open_contact_whatsapp.sql`. Check duplicates and current schema before any missing older index is considered; no message/contact deletion is authorized.

Then apply committed files separately:

1. `supabase/migrations/20261007120000_set_default_wa_number.sql`
2. `supabase/migrations/20261007130000_open_contact_whatsapp_phone_identity.sql`

Both include verification queries and are re-runnable. The first adds a function without changing existing number grants/policies/indexes. The second replaces the existing authenticated contact-open function and stops if its prerequisite function/index is absent. No application deployment must precede these additive/compatible function changes. Until the second runs, opening an identity-only phone contact retains the previous behavior. Prove grants/search paths and tenant checks after each file. Do not infer application of either file from a code merge or a migration filename in history.

The optional `supabase/proposals/20261007_contact_identity_unique_index_check.sql` is count-first/read-only for its diagnostic sections only. Do not run optional indexing or merge duplicates without separate review.

## Validation and limits

Independent original-head checks: #61 public intake/domain/plugin/abuse plus payments, 209 behavior tests; #66 default-number and contact-identity functions in real PostgreSQL. Review repairs add signed mixed-company endpoint and capped-health regressions. A separate real PostgreSQL proof applied 91 migrations and verified company A/B/unattached/platform access to null-tenant webhook events. Final reconciled CI and exact live outcomes belong in #73; none of these local checks proves live provider delivery.

- Historical mixed-company webhook rows remain unchanged. Inventory them read-only before claiming the past exposure is closed; any reclassification/redaction needs a reviewed preservation plan.
- Identity-only contacts can open a thread after SQL, but sending still needs the separate `contacts.phone` consumer alignment. Do not label that entire send flow complete.
- Pending-site domain/admin claims, static GET activation, browser-readable site secrets and non-atomic rate-limit counters remain separate security findings. #61 is an incremental repair, not closure of all plugin security.
- Recover with a reviewed forward fix. Retain customer messages, audit history and hardened access; do not drop data or re-enable broad browser evidence writes.
