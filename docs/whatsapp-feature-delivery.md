# WhatsApp CRM feature delivery

This is a backlog and release plan, not a list of live capabilities.

Market reference checked 2026-09-27: https://respond.io/integrations/whatsapp and https://respond.io/whatsapp-crm-integration describe shared inboxes, routing, broadcasts, AI agents, lifecycle tracking, CRM integration and calling. Provider availability and account eligibility must be checked separately before promising any feature.

## Implemented on this branch, not deployed

- Reject template recipient overrides and non-WhatsApp conversations; validate contact ownership.
- Positional body-template variables, language labels, preview and matching server validation.
- Reject unsupported named/nonconsecutive parameters visibly.
- Describe provider acceptance separately from delivery confirmation.

## Release priorities

1. Lead-to-chat: explicit recipient identity and sending number, reusable conversation, approved template selection, safe retry and provider message reconciliation. Start with this before adding bulk sending.
2. Templates and readiness: provider approval sync, WABA ownership, supported header/media/button components, incoming-webhook evidence, outbound test and actionable diagnostic errors. A locally saved template is not proof of provider approval.
3. Team inbox: assignment, round-robin routing, notes, collision prevention, saved replies, files, voice-note handling, searchable history, SLA reminders and human takeover.
4. Campaigns: segmentation, consent provenance, suppression, preview/exclusions, scheduling/timezones, durable recipient jobs, idempotency, bounded retries, pause/cancel, frequency caps, budget controls and delivery/conversion reporting.
5. AI assistant: business knowledge and catalog retrieval, multilingual drafts, conversation summaries, lead qualification, approved follow-ups, version-bound bulk approvals, spend limits and audit trail. Treat incoming messages and retrieved text as untrusted data. Human takeover pauses automation.
6. Advanced capabilities: commerce/catalog cards, interactive lists/buttons, WhatsApp Flows, ad attribution, conversion events and calling. Verify Meta support, required permissions, regional/account eligibility and billing before implementation or exposing controls.

## Database and security gates

Use tenant-scoped conversation/recipient/sender uniqueness and durable outbound jobs with lease/attempt/provider-status history. Recheck authorization, consent and suppression at execution time. Preserve unknown outcomes after timeouts instead of blind resending. Verify callback signatures; deduplicate and order callback updates. Keep credentials server-only and redact logs.

Resolve outstanding SQL review: SECURITY DEFINER trigger caller checks, cross-tenant identity resolver, per-tenant WhatsApp default index, collision-aware phone normalization, and RPC authorization. Never grant broad EXECUTE to fix a UI error without reviewing the function's tenant checks.

## Release evidence required

Two-workspace authorization tests; mocked provider rejection/timeouts; webhook replay and out-of-order tests; queue restart and duplicate-click tests; opted-out recipient exclusions; a designated consenting test recipient receives exactly one message and replies into the correct thread. No automatic messages to existing real leads during testing. Confirm the deployed commit before calling any capability live.
