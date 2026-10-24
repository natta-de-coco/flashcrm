# CX-00 — WhatsApp repair and rollout

This repairs PR #99 at `1ee8902`; its original nine failing review checks are
retained in the normal WhatsApp suite, with additional send/role/history cases.
No live messages, SQL, credentials or customer-data cleanup were used to test it.

## Behavior

- Routing directory reads and mutations require a company admin and the current
  workspace ID. Old workspace forms cannot write to a newly selected workspace.
- Staff recipients are server controlled. Alerts default off and require an
  explicit admin setup, an active registered colleague, recorded contact consent
  and an existing WhatsApp conversation. Both automatic and sample sends use
  the Inbox pipeline: current number/window checks, saved message before send,
  stable reference, recipient binding and accepted/rejected/unconfirmed results.
  A timeout stays unconfirmed in history; it is not advertised as sent.
- The sample action cannot send to an arbitrary typed phone number. Outside the
  current reply window it is blocked; the owner can use an approved template in
  Inbox. This editor's free-text merge tags are not Meta-approved templates.
- Staff phone numbers/names are omitted from the AI prompt. Routing accepts only
  active department codes from the company's directory. Unknown model output
  cannot choose a recipient. Department labels are translated in all five UI
  languages, with phone numbers isolated left-to-right in Arabic.
- Messages are stored and deduplicated before choosing one reply per sender in
  a webhook batch. A final duplicate cannot suppress a new question. Requests
  for a person pause automation across the batch, retain pending status and
  produce one stored acknowledgement. Ordinary staff assignment is not proof
  of human takeover. A recent response no longer discards a follow-up question.

There is **no delayed cross-webhook worker or external-CRM agent detection**.
Their misleading controls/promises are removed. Separate requests get normal
responses; existing unused grouping columns are retained for compatibility.
This is not a claim of crash-proof AI jobs or exactly one response across
independent simultaneous webhook requests. That requires a separately reviewed
durable queue and worker; no edge-runtime timer is being sold as one.

## SQL — pending, not executed

File: `supabase/migrations/20261022000000_staff_department_routing_and_alerts.sql`.
The file was not applied in the release ledger; it is repaired before release.
If a live inventory shows that any earlier version **was** applied, stop and
create a reviewed forward migration instead of pretending its history changed.

1. Read-only pre-check: inspect the table, its columns/grants/policies, and the
   two bot-settings/conversation tables. If the directory exists, count it and
   check canonical-phone collisions:

   ```sql
   SELECT tenant_id, regexp_replace(phone, '[^0-9]', '', 'g') AS canonical,
          count(*) AS copies
   FROM public.tenant_staff_routing_numbers
   GROUP BY 1,2 HAVING count(*) > 1;
   ```

   Expected: no rows. If duplicates exist, stop and report private IDs for a
   human decision. Do not delete staff/contact/chat history or force the index.

2. Deploy the repaired code before enabling any staff alerts. It accepts inbound
   messages on the old schema and reports directory/setup errors honestly.
3. Apply the exact reviewed file once, then rerun its verification queries.
   It creates the directory if missing; adds bot/department fields; changes
   future defaults to off; revokes browser table **and column** write grants;
   gives admins only company-scoped SELECT; grants the server CRUD; adds a
   canonical-number unique index and restrictive admin/company policy. No
   existing message/contact row is changed. Lock timeout is five seconds and
   schema reload is requested. A collision aborts the transaction.
4. Verify RLS, both policies, canonical index, defaults and grants. Authenticated
   must have no INSERT/UPDATE/DELETE/TRUNCATE or column INSERT/UPDATE privilege;
   anon no read/write; service role retains CRUD. A non-admin sees zero rows;
   each admin sees only their company. Check the before/after directory row count.
5. In a test workspace only: load the directory as admin and member; add a
   consenting colleague and verify saved/reloaded settings. Use an identified
   test recipient who has messaged the business recently. Double-click sample:
   one CRM message/provider request. Test inactive number, no consent, expired
   window and simulated timeout before any customer rollout.

Recovery: turn off `staff_alert_whatsapp_enabled`, retain additive schema and
history, then revert application behavior through a reviewed commit. Do not
restore public/member write grants. If the index fails, PostgreSQL rolls back
the whole transaction; fix the reported collision deliberately before retrying.

## Executable verification

`npm run test:whatsapp` now includes both original PR tests and
`tests/staff-routing-safety.test.mjs`. External AI/provider requests are mocked.
`node supabase/verify/verify-staff-routing.mjs` uses disposable PostgreSQL 17,
applies the file repeatedly, injects inherited broad/column grants and tests
real anon/member/admin/service roles, restrictive isolation, defaults, CRUD and
non-destructive duplicate refusal. Both are wired into CI. Local results and
the exact tested commit/CI links belong in issue #73, separately from live QA.
