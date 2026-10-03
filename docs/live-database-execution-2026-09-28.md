# Live database execution — 28 September 2026

Applied through the existing Lovable SQL editor, in the requested SQL-1 to SQL-5 order.

## Before

- Profile table-wide UPDATE: false; staff_role UPDATE: false; trigger present.
- SQL-2 index absent; identity normalized column present (old normalization); social thread column absent; WhatsApp unique-thread index absent.
- Identity collisions: []; duplicate WhatsApp conversations: [].
- History qualifying for archival: 22; inbound open rows: 22.

## Applied and verified

1. Profile grants restricted to avatar_url, full_name, last_seen_at. Corrected trigger to SECURITY INVOKER: the supplied SECURITY DEFINER version made its current_user owner exception always pass.
2. Replaced the global WhatsApp default index with a per-tenant partial unique index.
3. Phone normalization now maps plus, bare and 00 examples to 971501234567. Unique identity index exists. Restricted explicit-tenant SECURITY DEFINER identity resolver to service_role; authenticated cannot execute it. The sole code caller uses supabaseAdmin.
4. Added social thread column/index and archived exactly 22 old inbound open items. No messages deleted. Open inbound count after commit: 0. Initial instrumented count query had a syntax error, changed nothing, and was corrected before successful execution.
5. WhatsApp contact-thread unique index and open_contact_whatsapp(uuid) both exist. Duplicate precheck was empty. No messages sent.

## Final diagnostics

- SQL-1 protected profile updates false/false; trigger invoker true.
- SQL-2, SQL-3 unique index, SQL-4 column, SQL-5 index and function: all true.
- Expired trials: 0.
- WhatsApp templates: [] (no records in FLAS; Meta approval state not inspected).
- Active WhatsApp numbers: 1; using shared platform app secret: 1. This does not alone prove a signature mismatch; verify the number belongs to that app.
- Super-admin addresses exactly match the two-address platform allowlist.
- Instagram/Facebook same external id within a tenant: false.
- Products require company: true.
- Main e4e947f has one shared requestedConversationId parser and retains the re-select effect and older-thread lookup.

## Regression protection

Forward migration 20260928020000_profile_guard_and_identity_resolver_hardening.sql preserves the two security corrections in source control. Do not reapply the uncorrected handoff SQL-1 or SQL-3 afterward: they would restore the ineffective trigger or browser resolver grant. Disposable Postgres tests prove all four protected fields reject browser updates even after deliberately restoring broad UPDATE; normal presentation edits and server updates work.

## Still outside this SQL work

Meta login is required to verify subscribed_apps, messages webhook configuration and app/number ownership. No live inbound/outbound test has passed in this session. No provider credentials were exposed, changed or created.
