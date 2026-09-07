# Flas CRM fix tracker

Every finding from the 2026-08-29 audit plus the two follow-up asks, in one list
grouped by feature area. Check items off in a PR when you actually fix them —
don't check something off because a doc _says_ it was patched; verify against
source first (see `CLAUDE.md`'s "current state" section for why that matters here).

Legend: **[SHIP]** ship-blocker · **[P0]** critical · **[P1]** integrity/DoS ·
**[P2]** hardening · **[NEW]** requested feature, not a bug.
`(code)` = confirm by reading the file · `(db)` = confirm in Supabase SQL editor ·
`(manual)` = confirm with a live click-through test.

Last verified against source: **2026-09-01**. Items marked "fixed 2026-09-01"
were verified by a clean `tsc --noEmit` + `npm run build` after the change —
that proves the code compiles, NOT that it's been tested live or that any
`(db)` migration it depends on has actually been run against Supabase (see
each item — migrations `20260901000000` and `20260901010000` are written but
unapplied until someone with DB access runs them).

---

## Tenant isolation & data security

- [x] **[SHIP]** `(code)` ~~Inbound messages (WhatsApp + widget chat) aren't tenant-scoped~~ —
      **fixed 2026-09-01**. `ingestInboundMessage` now requires `tenantId` and scopes every
      contact/conversation/message query by it. Needs migration `20260901000000` run (adds
      `tenant_id` to `conversations`/`messages`) before this is live-correct.
- [x] **[SHIP]** `(code)` ~~`wa_numbers` is a global credential pool~~ — **fixed 2026-09-01**.
      `resolveWaCredentials(tenantId, waNumberId)` now filters by tenant on every branch;
      `wa_numbers` already had tenant_id + RLS from an earlier migration (20260825), the bug
      was purely that the code never used it.
- [x] **[SHIP]** `(code)` ~~WhatsApp webhook fails OPEN with no app secret configured~~ —
      **fixed 2026-09-01**. Now returns `{ok:false}` (401) instead of accepting unsigned payloads.
- [x] **[P0]** `(code)` ~~Widget chat allows anonymous, tenant-less sessions~~ — **fixed
      2026-09-01**. `siteKey` is required, `sessionId` min length is 32, tenant is derived from
      the site record.
- [x] **[P0]** `(code)` ~~Domain pinning bypassed by substring match~~ — **fixed 2026-09-01** via
      new shared `src/lib/domain-pin.ts` (exact host-suffix match, requires Origin/Referer),
      applied to both `leads/collect.ts` and `widget/chat.ts`.
- [x] **[P0]** `(code)` ~~null-tenant API keys read every orphaned row~~ — **fixed 2026-09-01**.
      `/api/public/v1/$.ts` now hard-403s when `auth.tenantId` is falsy; the old `wa_numbers`
      "skip tenant filter" special case is gone too (wa_numbers is tenant-scoped now).
- [x] **[P0]** `(code)` ~~React Query cache isn't cleared on sign-out~~ — **fixed 2026-09-01**,
      `queryClient.clear()` called from `signOut()` in `useAuth.tsx`.
- [ ] **[P0]** `(db)` `wa_numbers`, `webhook_events`, `reminders`, `campaigns`, `bot_settings`,
      `wa_config` have no `tenant_id` + `RLS USING(true)`. **Migration written** — see
      `supabase/migrations/20260901000000_tenant_isolation_and_security_hardening.sql` (covers
      conversations/messages/reminders/campaigns/webhook_events) and
      `20260901010000_per_tenant_bot_and_wa_config.sql` (bot_settings/wa_config →
      tenant_bot_settings/tenant_wa_config). **Not yet run against Supabase** — needs DB access.
- [ ] **[P0]** `(db)` `organizations` write policy checks "admin anywhere" not "admin of this
      org". **Fix written** in migration `20260901000000` §9 — not yet run.
- [ ] **[P1]** `(db)` `wa_templates`: tenant_id exists but RLS still allow-all; global `UNIQUE(name)`.
      **Fix written** in migration `20260901000000` §6 — not yet run.
- [ ] **[P1]** `(db)` `team_invites`: any member can invite a `super_admin`. **Fix written** in
      migration `20260901000000` §8 — not yet run.
- [ ] **[P1]** `(db)` `platform_apps.client_secret` readable by regular staff. **Fix written**
      (column-level GRANT restriction) in migration `20260901000000` §10 — not yet run.
- [ ] **[P1]** `(db)` `audit_log` rows forgeable (arbitrary `actor_id` on INSERT). **Fix written**
      (`REVOKE INSERT FROM authenticated`) in migration `20260901000000` §11 — not yet run.
- [ ] **[P1]** `(db)` First signup on a fresh deploy auto-becomes admin (`handle_new_user()`).
      **Fix written** in migration `20260901000000` §12 — not yet run.
- [ ] **[P2]** `(db)` `user_roles` readable platform-wide. **Fix written** in migration
      `20260901000000` §7 — not yet run.

## WhatsApp messaging

- [x] **[P0]** `(code)` ~~Outbound sends/receipts can use another tenant's Meta credentials~~ —
      **fixed 2026-09-01**, same fix as the wa_numbers ship-blocker above (all callers now pass
      a verified `tenantId` through to `resolveWaCredentials`).
- [x] **[P0]** `(code)` ~~No webhook idempotency~~ — **fixed 2026-09-01**. `webhook_dedup` table
      added (migration `20260901000000` §13) and wired up via `claimWebhookEventOnce()` in
      `monitoring.server.ts` for both message and status events.
- [x] **[P0]** `(code)` ~~`getBotSettings()` reads one global row~~ — **fixed 2026-09-01**. Now
      per-tenant via `tenant_bot_settings` (falls back to the old singleton's values only when a
      tenant has no row of its own). Needs migration `20260901010000` run.
- [ ] **[P1]** `(code)` Only `text` WA messages stored — **PARTIALLY fixed 2026-09-01**:
      `extractMessageBody()` now builds a readable placeholder for image/video/audio/sticker/
      document/location/button-list-reply types instead of silently dropping the message. Actual
      media binaries still aren't downloaded/re-hosted (needs a Meta media-id → URL fetch +
      upload-to-storage pipeline) — leaving unchecked since that's the real remaining gap.
- [x] **[P1]** `(code)` ~~`unread_count` read-then-write race~~ — **fixed 2026-09-01** via
      `increment_unread_count()` RPC (migration `20260901020000`, not yet run against Supabase).
- [ ] **[P1]** `(code)` Delivery-status update matches by message body text, not row id —
      `monitoring.server.ts:277` — can tag the wrong message under concurrency.

## Billing & payments (Paddle)

- [x] **[P0]** `(code)` ~~Paddle webhook environment picked by `?env=` query string~~ — **fixed
      2026-09-01**. Now reads `PADDLE_ENV` server env var only. **Set `PADDLE_ENV=live` in
      production** — it defaults to `sandbox` if unset.
- [x] **[P0]** `(code)` ~~Payment amount not capped at remaining balance~~ — **fixed 2026-09-01**
      in `recordDocumentPayment`.
- [x] **[P0]** `(code)` ~~SSRF via invoice `logo_url`~~ — **fixed 2026-09-01**. Blocks non-http(s)
      schemes, loopback/private/link-local IP literals, follows no redirects, 8s timeout.
- [x] **[P1]** `(code)` ~~Paddle webhook trusts `customData.tenantId` from the event itself~~ —
      **fixed 2026-09-01** in `handleSubscriptionCreated`; the other two handlers already derived
      tenant server-side correctly.
- [x] **[P1]** `(db)` ~~Invoice line-item edit is delete-then-insert, not atomic~~ — **fixed
      2026-09-01** via `replace_sales_document_items()` RPC (migration `20260901040000`, not yet
      run).
- [x] **[P1]** `(code)` ~~Invoice PDF line totals exclude tax~~ — **fixed 2026-09-01**, now
      includes tax and the invoice-level discount share.
- [x] **[P1]** `(code)` ~~"Overdue" computed in server-local time, not the tenant's~~ — **fixed
      2026-09-01**, now compares against `organizations.timezone`.

## AI, chatbot & Flash AI

- [x] **[P0]** `(code)` ~~`translateMessage` reads any tenant's messages~~ — **fixed 2026-09-01**.
- [x] **[P0]** `(code)` ~~Catalog message builder has no tenant filter on `products`~~ — **fixed
      2026-09-01**.
- [ ] **[P0]** `(code)` "Bring your own AI key" is dead — `ai_provider_keys` table exists, nothing reads it.
- [ ] **[NEW]** `(manual)` Multi-provider connector: tenants link their own Claude/OpenAI key,
      usable by all their users, feeding Flash AI. **Not started** — requested 2026-08-29,
      cut off mid-write by a session limit, nothing landed. See `session-2026-08-29-recap.md`.
- [ ] **[NEW]** `(manual)` Flash AI training-data collection layer. **Not started**, same fate.
- [ ] **[P1]** `(code)` No rate limiting on any AI endpoint (advisor/flash-ai/seo/train/crm/
      connections/social).

## Social & marketing

- [ ] **[P0]** `(db)` `campaigns`: no `tenant_id`, `RLS USING(true)`. **Fix written** in
      migration `20260901000000` §4 — not yet run.
- [x] **[P1]** `(code)` ~~LinkedIn sync can create duplicate posts on missing id~~ — **fixed
      2026-09-01**, now skips posts with no id instead of fabricating one.
- [x] **[P1]** `(manual)` ~~Google Business Profile calls a deprecated endpoint~~ — **fixed
      2026-09-01**, now calls `mybusinessreviews.googleapis.com/v1`. **Not verified against a
      live account** — check the response shape on the first real sync.
- [ ] **[P1]** `(code)` `social_accounts.access_token`/`refresh_token` stored in plaintext.
- [x] **[P2]** `(code)` ~~Deal currency hard-coded to USD~~ — **fixed 2026-09-01**, now uses
      `useTenant().currency`.

## SEO & content studio

- [x] **[P0]** `(code)` ~~AI-generated blog HTML unsanitized before render~~ — **fixed
      2026-09-01** via `isomorphic-dompurify` (new dependency, added to package.json).
- [x] **[P1]** `(db)` ~~Monitoring page shows every tenant's raw webhook JSON~~ — this reads
      `webhook_events` through the RLS-respecting client, so it's already covered by the
      `webhook_events_read_tenant` policy in migration `20260901000000` — no code change needed,
      just needs that migration run.

## Integrations — WordPress, Shopify, widget, OAuth

- [x] **[P0]** `(code)` ~~`plugin/activate` is an open email cannon~~ — **fixed 2026-09-01**.
      `admin_email` is now a one-time claim (a later request can't override an already-set
      address), rate-limited to 3 attempts/hour per site via the audit log.
- [x] **[P0]** `(code)` ~~`sendActivationEmail` never actually sends~~ — **fixed 2026-09-01**.
      New `src/lib/email-dispatch.server.ts` sends via the tenant's configured HTTP email
      provider (or a `PLATFORM_EMAIL_*` env fallback), reusing the Aug 29 tenant-SMTP work.
      Honestly reports failure when no provider is configured, instead of always claiming success.
- [x] **[P0]** `(code)` ~~Any staff (not just admins) can rewrite/delete platform OAuth app
      credentials~~ — **fixed 2026-09-01**, both functions now require company_admin/super_admin.
- [x] **[P0]** `(code)` ~~Command palette search is injectable into a PostgREST filter~~ — **fixed
      2026-09-01** (quote-escaping before interpolation into `.or()`).
- [x] **[P1]** `(code)` ~~OAuth callback can be replayed~~ — **fixed 2026-08-29** via
      `consume_oauth_state()` atomic RPC (migration `20260830010000`). Verified in
      `src/lib/oauth.server.ts`.
- [x] **[P1]** `(code)` ~~OAuth errors leak raw provider detail into the URL~~ — **fixed
      2026-08-29** via `sanitizeError()` in `src/routes/api/public/oauth-callback.ts`.
- [ ] **[P1]** `(code)` `documents/$token` re-renders a PDF on every hit — no cache, no rate limit.
- [ ] **[P1]** `(code)` `plugin/download` rebuilds a ZIP on every request — same DoS shape.
- [x] **[P1]** `(code)` ~~Public site-key endpoints return different statuses for valid vs.
      invalid keys~~ — **fixed 2026-09-01** for `leads/collect` and `widget/chat` (unified generic
      403 for every rejection reason). `plugin/activate` still returns a distinct 401 for unknown
      keys — lower priority since it has no second rejection reason to distinguish against.

## Account, auth & settings

- [ ] **[P0]** `(db)` WhatsApp `access_token`/`app_secret` written in plaintext from the client —
      **PARTIALLY fixed 2026-09-01**: no authenticated client can read the raw value back out
      anymore (migration `20260901030000`, not yet run). Still stored unencrypted at rest in the
      DB — full encryption would need 4+ server-side readers rewritten (`wa.server.ts`,
      `flash-ai.server.ts`, `meta-health.functions.ts`, `integration-health.server.ts`) to call a
      decrypt RPC instead of a plain column read. Not attempted — too much blast radius to do
      without a way to test it live. Leaving unchecked since encryption-at-rest, the actual ask,
      isn't done.
- [ ] **[P0]** `(db)` WordPress `app_password` — **THIS FINDING WAS WRONG.** Re-checked
      2026-09-03: `wordpress_sites` has had a column-level grant since it was created
      (migration `20260824125051` grants select on every column *except* `app_password`), so
      it was never client-readable. The migration block for it is a harmless no-op that
      re-asserts the same grant. The only real change here was correcting the UI copy, which
      claimed the password was "stored encrypted" — it isn't, it's just unreadable through the
      API. Still unencrypted at rest, hence left unchecked.
- [x] **[P1]** `(code)` ~~Region/currency change is broken for every real customer~~ — **fixed
      2026-09-01**, `workspace.functions.ts` now checks `company_admin`/`super_admin`.
- [x] **[P1]** `(code)` ~~Client can flip a WA template to "approved" without Meta approval~~ —
      **fixed 2026-09-01**, `setTemplateStatus` now blocks setting `"approved"` from the client.
- [x] **[P1]** `(code)` ~~GDPR data export silently truncates at 5,000 rows/table~~ — **fixed
      2026-09-01**, now pages through every row up to a 50k/table ceiling and warns if that
      ceiling is hit instead of silently dropping rows past a flat limit.
- [ ] **[P1]** `(code)` MFA/TOTP implemented but never enforced for admins.
- [x] **[P2]** `(code)` ~~2FA QR code rendered via `dangerouslySetInnerHTML`~~ — **fixed
      2026-09-01**, now a plain `<img src>` (Supabase returns `qr_code` as a data URI meant to be
      used exactly that way per their own docs).
- [x] **[P2]** `(code)` ~~Onboarding has no unique constraint — double-submit can create
      duplicate orgs~~ — **fixed 2026-09-01** via a conditional `UPDATE ... WHERE tenant_id IS
    NULL` claim instead of check-then-write; the losing request cleans up its orphaned org.
- [ ] **[P1]** `(db)` `set_tenant_smtp_api_key()` checks the legacy `has_role(admin)` (app_role
      system) but the client-side gate (`requireCompanyAdmin` in `tenant-smtp.functions.ts`)
      checks `staff_role IN ('company_admin','super_admin')` — a real company_admin who was
      never separately granted the old `admin` app_role will pass the app check and then get a
      silent no-op UPDATE from the RPC (0 rows affected, no error). Found 2026-09-01 while
      wiring `sendActivationEmail` through this same infra. Fix: change the RPC's check to match
      `requireCompanyAdmin`'s.
- [x] **[NEW]** `(manual)` ~~Per-tenant SMTP + rate-limited OTP resend~~ — **built 2026-08-29**,
      see `src/lib/tenant-smtp.functions.ts`, `src/lib/otp-resend.functions.ts`,
      `settings.email.tsx`. Needs a live test per `docs/handoff/...md` §13.5 before trusting it.
- [x] **[NEW]** `(manual)` ~~Super-admin lockdown for moobbi@yahoo.com~~ — **built 2026-08-29**,
      migration `20260830010000_super_admin_lockdown_and_oauth_reliability.sql`. Needs the
      sanity-check queries at the bottom of that file run once in Supabase.

## Requested 2026-08-29 — org setup

- [ ] **[NEW]** `(manual)` Seed `+971509630506` as the org's/moobbi's original number. **Not
      started** — no migration exists for this.

---

## Live test plan (once the ship-blockers above are actually patched)

See `docs/handoff/FLAS-CRM-AUDIT-FOR-COWORK.md` §9 for the full verification script,
including the two-tenant cross-leak test (§9.2) and curl commands for each patch
(§9.3–9.8). Don't mark tenant-isolation items fixed without running §9.2 for real.

---

## Found 2026-09-03 — the two-role-systems bug

- [x] **[P0]** `(code+db)` ~~Invited admins silently can't administer anything~~ — **fixed
      2026-09-03.** This app runs two parallel role systems: `user_roles.role` (legacy
      `app_role`, what `has_role()` and most RLS policies check) and `profiles.staff_role`
      (newer, what the UI shows). `completeOnboarding()` grants BOTH to the workspace founder,
      so it never showed up for them. Claiming a team invite set only `staff_role` — so an
      invited "company admin" looked like an admin throughout the product while every
      `has_role()`-gated policy quietly refused them: WhatsApp templates, bot settings, SMTP
      API keys, connected-app credentials. No error naming the cause; saves just didn't stick.
      Fix: `claimInvites` now grants the legacy role too; new `is_tenant_admin()` accepts
      either system and the policies this repo added were re-pointed at it; existing stuck
      admins are backfilled. Migration `20260903000000`.
- [x] **[P1]** `(db)` ~~`set_tenant_smtp_api_key()` role-check mismatch~~ — **fixed
      2026-09-03** by the same migration. It also silently succeeded on a zero-row UPDATE when
      no settings row existed yet; it now says so explicitly.

---

## Found 2026-09-04 — AI metering, and a sweep of every service-role query

### AI layer

- [x] **[P0]** `(code+db)` ~~`ai_provider_keys` was a dead promise~~ — **fixed 2026-09-04.**
      The table had existed since 2026-08-22 and nothing in the codebase ever read it. Every
      tenant who pasted their own OpenAI/Anthropic key into Settings kept silently burning the
      shared platform key — a cost problem, and a truthfulness one because the settings page
      implied otherwise. `api_key` was also plain text with no column grant, so any signed-in
      member of a tenant could read a colleague's key back out through the API.
      Fix: `callFlashAi` resolves whose key pays; `api_key` is column-restricted the way
      `wa_numbers.access_token` already was. Migration `20260903010000`.
- [x] **[P1]** `(code+db)` ~~No rate limit on any AI endpoint~~ — **fixed 2026-09-04.**
      Advisor, Flash AI, SEO writer, translate, catalog, connections, social and train all
      called the model with nothing between an authenticated user in a loop and an unbounded
      bill. Now a rolling hour/day window per tenant, checked before spending, recorded in
      `ai_usage_log`. **All 18 call sites pass `{ tenantId, feature, userId }`** — without that
      the machinery compiles and does nothing, which is how this kind of fix usually dies.

### Service-role sweep

Audited every `supabaseAdmin` query for an explicit tenant filter. `supabaseAdmin` bypasses
RLS entirely, so a missing `.eq("tenant_id")` is caught by no policy — the same class of
mistake as the original ship-blockers. 27 chains flagged; 24 were correctly keyed by an
unforgeable secret (`share_token`, `site_key`, `phone_number_id`, `paddle_subscription_id`)
or gated behind `requireSuperAdmin`. Three were not.

- [x] **[P0]** `(code)` ~~`getMetaSyncHealth` leaked every tenant's WhatsApp numbers~~ —
      **fixed 2026-09-04.** Any signed-in user of any tenant got labels, phone numbers, Meta
      quality ratings and 24h message volumes for every other company on the platform. Now
      tenant-filtered on both the numbers and the conversation counts, and returns empty
      rather than falling back to "all" when the tenant can't be resolved.
- [x] **[P0]** `(code)` ~~`gatherMessagingAnalytics` leaked wa_numbers across tenants~~ —
      **fixed 2026-09-04.** It took an RLS-scoped client for messages but read `wa_numbers`
      through `supabaseAdmin` unfiltered, so the analytics dashboard showed other tenants'
      numbers — and called the Meta API once per number on the whole platform, every load.
- [x] **[P2]** `(code)` ~~Manager portal showed the same number count for every company~~ —
      **fixed 2026-09-04.** `listCompanies` counted `wa_numbers` without a tenant filter
      inside a per-org loop. Super-admin only, so not a leak — just wrong on screen.

### Abuse ceilings on the two intentionally-public writers

- [x] **[P1]** `(code+db)` ~~OTP resend claimed a per-IP limit it never had~~ — **fixed
      2026-09-04.** The docblock said "per-email + per-IP rate limits enforced in the DB", and
      the code did compute and store the caller's IP on every attempt — but
      `check_otp_attempt` only ever took `(_email, _kind)` and never looked at the IP again.
      Real caps were per address only, with no aggregate ceiling, so one host cycling through
      addresses could send unlimited mail on the project's SMTP credentials. The cost isn't
      volume, it's the sending domain's reputation — this is how `flas@mobidigisol.com` lands
      on a blocklist and real password resets stop arriving. Migration `20260904000000` adds
      per-IP counting (20/hr, 100/day, deliberately loose so an office behind one NAT isn't
      locked out; unknown IPs aren't counted, which would collapse every unattributable
      request into one bucket).
- [x] **[P2]** `(code)` ~~`reportErrorEvent` had no ceiling at all~~ — **fixed 2026-09-04.**
      Unauthenticated by necessity (a browser must be able to report a crash after its session
      is gone). The realistic failure isn't an attacker but a render loop reporting the same
      ~10KB error thousands of times a minute. Identical reports from one session are now
      dropped past 20 in five minutes; the first occurrences are always kept.

### What is NOT verified

The two leak fixes are **not** verified live — that needs two tenants and a signed-in session.
Re-run `docs/handoff/FLAS-CRM-AUDIT-FOR-COWORK.md` §9.2 once the migrations are applied.
All 12 public endpoints *were* re-tested live and still reject unauthenticated traffic.

---

## Found 2026-09-04 (second pass) — by actually running the migrations

Everything above this line was found by reading code. None of it explained why
connecting a social account never worked. That answer was in a migration that
had never been applied, and it took ~20 minutes of running the SQL against a
real PostgreSQL 17 to find. The harness is now in `supabase/verify/`.

- [x] **[SHIP-BLOCKER]** `(db)` ~~`20260830010000` never applied at all~~ — **fixed
      2026-09-04.** It carried `UPDATE public.oauth_states SET redirect_uri = redirect_to`.
      `redirect_to` has never existed in any version of this schema — the table was created
      with `redirect_uri` from the start (`20260826163049`), and the comment claiming a legacy
      column was simply wrong. Postgres resolves column names in a plain UPDATE at parse time,
      so it raised 42703 immediately, and because the file is a single transaction
      (`BEGIN` line 12 / `COMMIT` line 335) **every object in it rolled back**:
      `consume_oauth_state`, `purge_expired_oauth_states`, `rotate_site_webhook_secret`,
      `rotate_wa_number_app_secret`, `list_subscribers`, and all seven super-admin lockdown
      triggers. Backfill is now guarded on the column actually existing.
- [x] **[SHIP-BLOCKER]** `(db)` ~~`oauth_states.code_verifier` was never added~~ — **fixed
      2026-09-04.** The migration header promised "real per-state PKCE storage" and then never
      added the column. `oauth.server.ts:201` inserts it when the flow starts and
      `consume_oauth_state()` returns it at the callback, so **both ends of connecting an
      account were broken**. TypeScript never objected because `types.ts` is hand-maintained
      and declared a column the database did not have — a reminder that `types.ts` is an
      assertion, not evidence. Found by smoke-calling the function, not by applying the DDL:
      Postgres does not resolve identifiers inside a plpgsql body at CREATE time.
- [x] **[P1]** `(db)` ~~Ordering: subscribers view defined before its column exists~~ —
      **fixed 2026-09-04.** The view counts `messages.tenant_id`, added by `20260901000000`.
      Moved to `20260904010000` so each statement runs after what it depends on.
- [x] **[P1]** `(db)` ~~"Safe to re-run" was asserted, not true~~ — **fixed 2026-09-04.**
      17 `CREATE POLICY` and 2 `CREATE TRIGGER` statements in the pending migrations had no
      drop guard (they dropped the *old* policy name and created a *new* one, which only works
      once). Now verified by a second pass rather than claimed in a header.
- [x] **[P2]** `(docs)` ~~`RUN_THESE_MIGRATIONS.sql` omitted the 2026-08-30 files~~ —
      **fixed 2026-09-04.** Pasting it would have left `consume_oauth_state` missing and the
      connector still broken. Now 13 steps.
- [x] **[P2]** `(docs)` ~~A verification query cried wolf~~ — **fixed 2026-09-04.** It listed
      column privileges without filtering `privilege_type`, so it reported `api_key` as
      readable when that grant is INSERT. `api_key` legitimately keeps INSERT so a tenant can
      still save a key.

### Now verified rather than asserted

- 47/47 migrations apply clean to an empty database
- every pending migration re-applies clean on top of itself
- the paste-file applies clean over a simulated live database, twice
- all 7 critical functions are callable (smoke-called, not just created)
- OAuth round trip works: insert with `code_verifier`, consume once, replay
  rejected, expired rejected
- `authenticated` is blocked reading `ai_provider_keys.api_key` and
  `wa_numbers.access_token`, and still allowed on the non-secret columns

### Still not verified

Nothing has run against the real Supabase project, and no social account has
been connected through a real Meta/X app. The schema is now proven correct; the
network path to the providers is not.
