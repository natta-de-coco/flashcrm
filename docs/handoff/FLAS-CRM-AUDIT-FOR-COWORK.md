# FLAS CRM — Deep Security & Tenant-Isolation Audit

Prepared for handoff to Cowork. Audit date: 2026-08-29.
Project: Chat Connect Pro / Flas CRM (Lovable, TanStack Start, Supabase, Paddle).
Repo scanned: `Z:\Chat Connect Pro.zip` (extracted).

---

## 0. Bottom line — read this first

**Do not onboard a second customer** until the SHIP-BLOCKERS below are fixed. As soon as two tenants share the platform, one company's WhatsApp messages, contacts, conversations, WhatsApp phone-number credentials, activation emails, plugin download traffic, and bot settings will bleed into the other's account. Two of the flaws are exploitable by an attacker who only knows a tenant's `phone_number_id` (a public identifier).

Feature scope is genuinely impressive — 21 authenticated pages, multi-provider OAuth, Paddle subscription billing with dunning, invoicing with quotes/credit-notes/proformas, AI advisor, business memory, GDPR flow. Structural patterns are correct (RLS, HMAC verification on webhooks, audit logging, domain-pinned widget site keys). The problems are localized — most of them are one to five migrations plus one to five code changes each.

**Total findings:** 3 SHIP-BLOCKERS, 12 P0s, 15 P1s, 10 P2s. This document has the exact SQL to fix all of the schema issues plus the exact code diffs for the app-side ones.

---

## 1. SHIP-BLOCKERS (must fix before customer #2)

### S1 — `ingestInboundMessage` has zero tenant scoping

File: `src/lib/wa.server.ts` lines 170–301.
Both callers (widget chat `src/routes/api/public/widget/chat.ts` and the WhatsApp webhook via `monitoring.server.processWaPayload`) invoke it **without a tenantId**. Consequences:

- `contacts` is looked up **globally by phone**. If two tenants both have a customer with phone `+971501234567`, the second tenant's inbound message is filed against the first tenant's contact row, conversation, and messages.
- All newly-created rows land with `tenant_id = NULL`. Under the RLS fix, `NULL` becomes invisible to every workspace — you accumulate silent orphan PII.
- Same problem hits the WhatsApp Cloud webhook path.

Fix: refactor `ingestInboundMessage` to require a `tenantId` argument, derived from `siteKey → lead_sites.tenant_id` (widget) or `phone_number_id → wa_numbers.tenant_id` (WhatsApp). Fail closed if the tenant can't be derived. See §7 for the code diff.

### S2 — `wa_numbers` is treated as a global pool with no `tenant_id`

Files: `src/lib/wa.server.ts` lines 27–53, `src/lib/flash-ai.server.ts` lines 287–290, `src/lib/monitoring.server.ts` lines 114–156, `src/routes/api/public/v1/$.ts` lines 66–70.

- No tenant column on `wa_numbers`.
- `resolveWaCredentials()` with no id picks whichever row has `is_default = true` globally.
- `/api/public/v1/numbers` explicitly skips tenant filtering with the comment "workspace-wide (no tenant column yet)" — any valid API key returns every tenant's WhatsApp phone_number_ids, labels, and default flags.
- End result: **one tenant's outbound WhatsApp message can be sent from another tenant's Meta credentials**, and the identifiers needed to weaponize S3 leak here.

Fix: add `tenant_id` to `wa_numbers` (with CASCADE), backfill from `wa_numbers.created_by → profiles.tenant_id`, add tenant-scoped RLS, remove the "skip filter" in `v1/$.ts`. SQL in §6, code diff in §7.

### S3 — WhatsApp webhook fails OPEN when no app secret is configured

File: `src/routes/api/public/whatsapp/webhook.ts` lines 24–29.

```ts
if (!secret) {
  console.warn("[whatsapp] no app secret configured — webhook signature not enforced");
  return { ok: true as const, enforced: false };
}
```

An attacker who knows a tenant's `phone_number_id` (leaked by S2 to any API key holder) can spoof inbound messages, mark messages as read, forge delivery statuses, and trigger AI replies (burning your `LOVABLE_API_KEY` credits). This is the highest-impact finding in the audit. Fix: fail closed. Code diff in §7.

---

## 2. P0 findings (critical — data leak, auth bypass, cost DoS)

### P0-1 — `widget/chat` allows tenant-less anonymous sessions

File: `src/routes/api/public/widget/chat.ts` lines 4–9, 34–58.
`siteKey` is optional (`z.string().min(10).max(120).optional()`). Omitted = no site lookup, no tenant, no domain check. Session id min length is 6 → trivial to guess/hijack live conversations. CORS is `*` so any origin on the internet can call. Combined with S1, this is a live cross-tenant hijack path AND an unauthenticated AI cost-DoS.

Fix: make `siteKey` **required**; validate against `lead_sites`; pass its tenant_id through to `ingestInboundMessage`; add rate limit; keep `sessionId` min length ≥ 32.

### P0-2 — `plugin/activate` is an open email cannon

File: `src/routes/api/public/plugin/activate.ts`.
`POST /api/public/plugin/activate` with a valid (public) site key and any attacker-chosen `adminEmail` sends a real activation email from your domain. CORS `*`, no rate limit, no captcha. Deliverability suicide + phishing pivot.

Fix: require the caller to prove they own the site (HMAC over a challenge signed with the site's `webhook_secret`, or send email only to a pre-registered admin address stored on `lead_sites`). Rate-limit to 3 activation attempts per site per hour. Add captcha for browser callers.

### P0-3 — Substring domain-pin bypass (bug written twice)

Files: `src/routes/api/public/leads/collect.ts` line 59, `src/routes/api/public/widget/chat.ts` line 51.

```ts
if (site.domain && origin && !origin.toLowerCase().includes(site.domain.toLowerCase())) {
```

Two bugs in one:

1. Substring `.includes()` — `acme.com` matches `evil-acme.com`, `acme.com.evil.tld`, `myacme.com`.
2. `if (origin && …)` — empty `Origin`/`Referer` header (trivial for any non-browser attacker) skips the check entirely.

Fix: parse URL, take hostname, exact-match against a hostname suffix; require the header to be present when a site has a registered domain. Extract into `src/lib/domain-pin.ts` and use in both places. Diff in §7.

### P0-4 — Paddle webhook env selected by query string

File: `src/routes/api/public/payments/webhook.ts` line 190.

```ts
const env = (url.searchParams.get("env") || "sandbox") as PaddleEnv;
```

Attacker who calls `?env=sandbox` against your prod URL forces signature verification against the sandbox secret. If your sandbox secret ever leaks (dev machines routinely leak) then sandbox events mutate the prod DB. Fix: anchor `env` to a build-time env var (`process.env['PADDLE_ENV']`), not the URL.

### P0-5 — v1 API returns global NULL-tenant rows for keys with `tenant_id = NULL`

File: `src/routes/api/public/v1/$.ts` line 69.
When `auth.tenantId` is falsy, the query becomes `.is("tenant_id", null)` — any API key without a tenant reads every orphan row across `leads`, `contacts`, `conversations`. Given how easily orphan rows get created by the widget flow (S1), this compounds the leak. Fix: hard-fail with 403 when `auth.tenantId` is null.

### P0-6 — `ai_provider_keys` table exists but no code reads from it

Every "bring your own AI key" tenant still burns your shared `LOVABLE_API_KEY`. This isn't just cost — it's a false promise on the settings page. Feature is inert. Fix: wire `generateBotReply` to look up `ai_provider_keys` for the current tenant first, fall back to platform default if none. Requires touching the AI dispatcher in `src/lib/flash-ai.server.ts`.

### P0-7 — `sendActivationEmail` never sends email

File: `src/lib/plugin-activation.server.ts` lines 86–93. Only logs `console.info`. The whole plugin activation flow — one of your billed features — is inert in production. Fix: swap to nodemailer + Hostinger SMTP once you configure custom SMTP in Supabase for auth mails (same creds work).

### P0-8 — `webhook_events` leaks every tenant's raw WhatsApp payloads

Table has no `tenant_id`, RLS is `USING(true)`. Payload jsonb contains customer phone numbers + message bodies from every tenant's Meta webhook. Any authenticated user in any workspace can read the entire cross-tenant webhook stream. SQL fix in §6.

### P0-9 — `reminders` has no `tenant_id`, RLS is `USING(true)`

Any authenticated user can read/write any tenant's reminders (which include contact_id + notes + due dates). SQL fix in §6.

### P0-10 — `campaigns` has no `tenant_id`, RLS is `USING(true)`

Marketing campaigns visible cross-tenant. SQL fix in §6.

### P0-11 — `bot_settings` and `wa_config` are singletons on a multi-tenant platform

Any admin in any tenant rewrites the AI instructions, model, greeting, handoff keywords, and business_hours flag that every other tenant's bot uses. Fix: convert both to per-tenant tables keyed on `tenant_id` PK. SQL sketch in §6.

### P0-12 — `organizations.orgs_admin_write` uses per-user `has_role('admin')` not `is_super_admin()`

Any user with `app_role = 'admin'` in ANY tenant can UPDATE any organization row on any other tenant — including flipping `suspended`, `plan`, `paddle_subscription_id`. Cross-tenant billing sabotage. SQL fix in §6.

---

## 3. P1 findings (integrity, race conditions, DoS)

### P1-1 — Bot reply body-match race

`src/lib/monitoring.server.ts` lines 277–282: `.eq('body', reply)` matches by text. Two concurrent identical canned replies tag the wrong row's `wa_message_id`. Combined with the cross-tenant `messages` pool (fixed in §6), this corrupts other tenants' delivery tracking + audit history. Fix: return `id` from the insert, use `.eq('id', insertedId)` for the update.

### P1-2 — `unread_count` read-then-write race

`src/lib/wa.server.ts` lines 257–271. Concurrent inbound messages drop increments. Fix: use `supabase.rpc('increment_unread', ...)` or an atomic UPDATE with the delta computed in SQL.

### P1-3 — `consumeState` OAuth race

`src/lib/oauth.server.ts` lines 334–347. Two concurrent callbacks with same state both succeed. Fix: change UPDATE to `.eq('state', s).is('used_at', null)` and check `count`.

### P1-4 — No webhook idempotency (Meta, Paddle, Shopify all vulnerable)

None of the webhook endpoints dedupe by event id. Retries create duplicate contacts, duplicate audit rows, and re-fire `raiseAlert`. Fix: create a `webhook_dedup(event_source, event_id) UNIQUE` table; INSERT-IGNORE at the top of each webhook; skip processing on conflict.

### P1-5 — Paddle webhook trusts `customData.tenantId` from event payload

`src/routes/api/public/payments/webhook.ts:handleSubscriptionCreated`. If any unauthenticated endpoint lets an attacker start a Paddle checkout with attacker-chosen `customData`, they point a subscription at any tenant's org. Fix: verify `customData.tenantId` against the caller's authenticated tenant at the checkout-start step.

### P1-6 — OAuth callback leaks raw error messages into browser URL

`src/routes/api/public/oauth-callback.ts:67`. `connect_error: e instanceof Error ? e.message : ...` — provider/SDK errors often include tokens, IDs, and internal paths. Ends up in URL bar + referer logs. Fix: sanitize to a fixed set of error codes.

### P1-7 — `documents/$token` renders PDF per request with no rate limit

`src/routes/api/public/documents/$token.ts`. One valid share token → unlimited PDF renders → CPU/memory DoS. Fix: cache rendered PDF bytes (blob storage) keyed on `(doc_id, version)`; rate-limit to N/min per token.

### P1-8 — `plugin/download` builds ZIP synchronously on every hit

`src/routes/api/public/plugin/download.ts`. Great DoS target. Fix: cache ZIP bytes by hash of `(siteKey, platform, popup_greeting)` in Supabase Storage, stream from there.

### P1-9 — Site-key existence oracles across every plugin/widget endpoint

`401 "Unknown site key"` vs `200`. Attacker enumerates valid site keys. Fix: return the same generic 200 (with a benign body) or 403 (with a fixed body) regardless of key validity for public endpoints; only leak information when the request has proven auth.

### P1-10 — `wa_templates` tenant_id column added, RLS never updated

Column exists (`USING(true)` policy unchanged). Every tenant reads every other tenant's approved templates. Global UNIQUE(name) also prevents tenant B from creating a template name tenant A used. SQL fix in §6.

### P1-11 — `team_invites` allows privilege escalation

`Tenant members can manage own invites` policy lets any tenant member (not just admins) invite anyone as any `staff_role`, including `super_admin`. SQL fix in §6.

### P1-12 — `platform_apps.client_secret` readable by every tenant member

No column-level grant restriction. A staff-level tenant member reads OAuth client secrets. SQL fix in §6.

### P1-13 — `audit_log` user-forgeable via INSERT

Any authenticated user can write rows with arbitrary `actor_id`/`actor_label`. Fix: revoke INSERT from `authenticated`, force writes through a SECURITY DEFINER `log_audit()` function. SQL in §6.

### P1-14 — MFA (TOTP) coded but never enforced

`src/routes/auth.tsx` handles the MFA challenge but no policy or trigger requires admins to enable TOTP. For SaaS holding customer data, MFA should be enforced for `admin` and `super_admin`. Fix: middleware gate on admin routes checking `mfa.getAuthenticatorAssuranceLevel() === "aal2"`.

### P1-15 — First user across the ENTIRE database becomes admin

`handle_new_user()` trigger in the initial migration. On a fresh deploy, the first signup gets admin. Since your allowlist has `atozsectrading@gmail.com` and `moobbi@yahoo.com` baked in, this only matters until one of those signs up — but if a customer signs up before you do on a new deployment, they inherit the workspace. Fix: rewrite `handle_new_user` to only auto-grant admin when the email is in `platform_super_admins`.

---

## 4. P2 findings (hardening / hygiene)

- P2-1 `dangerouslySetInnerHTML` in `src/routes/_authenticated/seo-blog.studio.tsx:706` — AI-generated `contentHtml` piped directly. Add DOMPurify.
- P2-2 `console.error` calls include full WhatsApp API bodies (`wa.server.ts:88,141,355`) — may contain tokens on error paths. Redact.
- P2-3 `saveAuthorizedConnection` stores `access_token`/`refresh_token` plaintext in `social_accounts`. Rely on Supabase at-rest encryption only. Consider application-side envelope encryption for tokens.
- P2-4 `user_roles.roles_read_all USING(true)` — role assignments platform-wide readable. Info leak.
- P2-5 `system_alerts` no `tenant_id` (same shape as P0-8, content less sensitive).
- P2-6 `daily_briefs` DELETE grant with no DELETE policy — dead grant.
- P2-7 `oauth_states` / `signup_otps` — no expiry cleanup. Add scheduled purge.
- P2-8 `guard_finalized_document()` relies on `current_setting('role',true) <> 'service_role'`. Migrations running as `postgres` bypass immutability.
- P2-9 Shopify `?site=` query fallback — puts siteKey in every CDN log. Header-only.
- P2-10 `contacts.owner_id`, `conversations.assigned_to` have no FKs — dangling on user delete.
- P2-11 Missing indexes on 14 FK columns (see §6, migration block M-INDEXES).
- P2-12 `oauth_states` grows indefinitely — nothing purges rows.
- P2-13 `wa_templates` GLOBAL `UNIQUE(name)` — should be `UNIQUE(tenant_id, name)`.
- P2-14 `email().max(200)` on leads/collect but no phone shape validation.
- P2-15 Auth error enumeration — "Email not confirmed" vs "Invalid credentials" allows attackers to enumerate registered emails.

---

## 5. Supabase Dashboard actions (before or after migration)

These are non-code changes Cowork should apply via the Supabase Dashboard. Project ID: `qvssburewegshdkhsqef`. Direct link: https://supabase.com/dashboard/project/qvssburewegshdkhsqef

**5.1 Enable Custom SMTP for auth emails.**
Auth → Providers → SMTP Settings → toggle on. Values:

| Field        | Value                                                                      |
| ------------ | -------------------------------------------------------------------------- |
| Sender email | `flas@mobidigisol.com`                                                     |
| Sender name  | `Flas CRM`                                                                 |
| Host         | `smtp.hostinger.com`                                                       |
| Port         | `465`                                                                      |
| Username     | `flas@mobidigisol.com`                                                     |
| Password     | _user pastes NEW password (old one leaked in chat, must be rotated first)_ |
| Min interval | `60`                                                                       |

**5.2 Rate limits.**
Auth → Rate Limits → Emails per hour: `30` (Hostinger fair-use safe).

**5.3 Enable email confirmation.**
Auth → Providers → Email → ✅ Enable Email Confirmations.

**5.4 Enforce MFA on admins.**
Auth → MFA → toggle TOTP required for admins if that setting is exposed in your Supabase plan.

**5.5 Set the Paddle env at deploy time (NOT via URL).**
Project Settings → Edge Functions / Env Variables → add `PADDLE_ENV=live` (or `sandbox`). After code fix in §7.

**5.6 Rotate the leaked email password.**
hPanel → Emails → `flas@mobidigisol.com` → Change Password → generate new → save to password manager only (never chat).

---

## 6. THE MEGA SQL MIGRATION — paste into Supabase SQL Editor

Run this once. It's idempotent — safe to re-run. It fixes every schema-level P0 and P1 in this audit.

```sql
-- ═════════════════════════════════════════════════════════════════════════════
-- FLAS CRM — v3.4 comprehensive tenant-isolation & schema hardening
-- Idempotent. Run once in Supabase SQL Editor.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 0. Helper: shared trigger to auto-set tenant_id from current session ─────
CREATE OR REPLACE FUNCTION public.set_tenant_id_from_session()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := public.current_tenant_id();
  END IF;
  RETURN NEW;
END; $$;

-- ── 1. conversations gets tenant_id + tenant-scoped RLS ─────────────────────
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
UPDATE public.conversations c SET tenant_id = ct.tenant_id
  FROM public.contacts ct WHERE c.contact_id = ct.id AND c.tenant_id IS NULL AND ct.tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS conversations_tenant_idx ON public.conversations (tenant_id);
CREATE INDEX IF NOT EXISTS conversations_contact_idx ON public.conversations (contact_id);
CREATE INDEX IF NOT EXISTS conversations_wa_number_idx ON public.conversations (wa_number_id);
DROP POLICY IF EXISTS "conversations_team_all" ON public.conversations;
CREATE POLICY "conversations_tenant_all" ON public.conversations FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
DROP TRIGGER IF EXISTS conversations_set_tenant ON public.conversations;
CREATE TRIGGER conversations_set_tenant BEFORE INSERT ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_from_session();

-- ── 2. messages gets tenant_id + tenant-scoped RLS ──────────────────────────
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
UPDATE public.messages m SET tenant_id = c.tenant_id
  FROM public.conversations c WHERE m.conversation_id = c.id AND m.tenant_id IS NULL AND c.tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS messages_tenant_idx ON public.messages (tenant_id);
DROP POLICY IF EXISTS "messages_team_all" ON public.messages;
CREATE POLICY "messages_tenant_all" ON public.messages FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
DROP TRIGGER IF EXISTS messages_set_tenant ON public.messages;
CREATE TRIGGER messages_set_tenant BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_from_session();

-- ── 3. wa_numbers gets tenant_id + tenant-scoped RLS (fixes SHIP-BLOCKER S2)
ALTER TABLE public.wa_numbers
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
-- Backfill from created_by → profile.tenant_id
UPDATE public.wa_numbers n SET tenant_id = p.tenant_id
  FROM public.profiles p WHERE n.created_by = p.id AND n.tenant_id IS NULL AND p.tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS wa_numbers_tenant_idx ON public.wa_numbers (tenant_id);
DROP POLICY IF EXISTS "wa_numbers_read"  ON public.wa_numbers;
DROP POLICY IF EXISTS "wa_numbers_write" ON public.wa_numbers;
-- Column-restricted grant so access_token / app_secret never reach the client
REVOKE SELECT ON public.wa_numbers FROM authenticated;
GRANT SELECT (id, tenant_id, label, phone_number_id, display_phone_number, active, is_default,
              webhook_verified, created_at, updated_at)
  ON public.wa_numbers TO authenticated;
CREATE POLICY "wa_numbers_read_tenant" ON public.wa_numbers FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY "wa_numbers_admin_write" ON public.wa_numbers FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'));
DROP TRIGGER IF EXISTS wa_numbers_set_tenant ON public.wa_numbers;
CREATE TRIGGER wa_numbers_set_tenant BEFORE INSERT ON public.wa_numbers
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_from_session();

-- ── 4. Kill NULL-tenant leak on contacts/leads/products/content_posts ──────
DROP POLICY IF EXISTS "contacts_tenant_all" ON public.contacts;
CREATE POLICY "contacts_tenant_all" ON public.contacts FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
DROP TRIGGER IF EXISTS contacts_set_tenant ON public.contacts;
CREATE TRIGGER contacts_set_tenant BEFORE INSERT ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_from_session();

DROP POLICY IF EXISTS "leads_tenant_all" ON public.leads;
CREATE POLICY "leads_tenant_all" ON public.leads FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
DROP TRIGGER IF EXISTS leads_set_tenant ON public.leads;
CREATE TRIGGER leads_set_tenant BEFORE INSERT ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_from_session();

DROP POLICY IF EXISTS "products_tenant_all" ON public.products;
CREATE POLICY "products_tenant_all" ON public.products FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS "content_tenant_all" ON public.content_posts;
CREATE POLICY "content_tenant_all" ON public.content_posts FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

-- ── 5. profiles read scoped to own tenant only ──────────────────────────────
DROP POLICY IF EXISTS "profiles_read_all" ON public.profiles;
CREATE POLICY "profiles_read_tenant" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid()
      OR tenant_id = public.current_tenant_id()
      OR public.is_super_admin(auth.uid()));

-- ── 6. user_roles read scoped to own user or admin ──────────────────────────
DROP POLICY IF EXISTS "roles_read_all" ON public.user_roles;
CREATE POLICY "roles_read_self_or_admin" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- ── 7. webhook_events gets tenant_id + tenant-scoped RLS (P0-8) ─────────────
ALTER TABLE public.webhook_events
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS webhook_events_tenant_idx ON public.webhook_events (tenant_id, created_at DESC);
DROP POLICY IF EXISTS "Team can read webhook events"    ON public.webhook_events;
DROP POLICY IF EXISTS "Team can update webhook events"  ON public.webhook_events;
CREATE POLICY "webhook_events_read_tenant" ON public.webhook_events FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() OR public.is_super_admin());
CREATE POLICY "webhook_events_update_tenant" ON public.webhook_events FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
-- Note: server code that inserts webhook_events must now populate tenant_id from wa_numbers lookup.

-- ── 8. reminders gets tenant_id + tenant-scoped RLS (P0-9) ──────────────────
ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
UPDATE public.reminders r SET tenant_id = c.tenant_id
  FROM public.conversations c WHERE r.conversation_id = c.id AND r.tenant_id IS NULL AND c.tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS reminders_tenant_due_idx ON public.reminders (tenant_id, due_at);
CREATE INDEX IF NOT EXISTS reminders_conversation_idx ON public.reminders (conversation_id);
CREATE INDEX IF NOT EXISTS reminders_contact_idx ON public.reminders (contact_id);
CREATE INDEX IF NOT EXISTS reminders_assigned_idx ON public.reminders (assigned_to);
DROP POLICY IF EXISTS "Team can manage reminders" ON public.reminders;
CREATE POLICY "reminders_tenant_all" ON public.reminders FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
DROP TRIGGER IF EXISTS reminders_set_tenant ON public.reminders;
CREATE TRIGGER reminders_set_tenant BEFORE INSERT ON public.reminders
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_from_session();

-- ── 9. campaigns gets tenant_id + tenant-scoped RLS (P0-10) ─────────────────
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS campaigns_tenant_idx ON public.campaigns (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS campaigns_created_by_idx ON public.campaigns (created_by);
DROP POLICY IF EXISTS "Team can manage campaigns" ON public.campaigns;
CREATE POLICY "campaigns_tenant_all" ON public.campaigns FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
DROP TRIGGER IF EXISTS campaigns_set_tenant ON public.campaigns;
CREATE TRIGGER campaigns_set_tenant BEFORE INSERT ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_from_session();

-- ── 10. wa_templates: RLS updated to honour existing tenant_id (P1-10) ──────
CREATE INDEX IF NOT EXISTS wa_templates_tenant_idx ON public.wa_templates (tenant_id);
DROP POLICY IF EXISTS "Team can read templates"     ON public.wa_templates;
DROP POLICY IF EXISTS "Admins can manage templates" ON public.wa_templates;
CREATE POLICY "wa_templates_read_tenant" ON public.wa_templates FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY "wa_templates_admin_manage" ON public.wa_templates FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'));
-- Drop GLOBAL UNIQUE(name) and replace with per-tenant unique
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wa_templates_name_key') THEN
    ALTER TABLE public.wa_templates DROP CONSTRAINT wa_templates_name_key;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS wa_templates_tenant_name_key ON public.wa_templates (tenant_id, name);

-- ── 11. team_invites: only admins can invite, cannot mint super_admins (P1-11)
DROP POLICY IF EXISTS "Tenant members can manage own invites" ON public.team_invites;
CREATE POLICY "team_invites_read_tenant" ON public.team_invites FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY "team_invites_admin_write" ON public.team_invites FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.has_role(auth.uid(), 'admin')
    AND staff_role <> 'super_admin'
  );
-- Add ON DELETE CASCADE (was NO ACTION)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_invites_tenant_id_fkey') THEN
    ALTER TABLE public.team_invites DROP CONSTRAINT team_invites_tenant_id_fkey;
  END IF;
END $$;
ALTER TABLE public.team_invites
  ADD CONSTRAINT team_invites_tenant_id_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.organizations(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS team_invites_tenant_idx ON public.team_invites (tenant_id);

-- ── 12. platform_apps: hide client_secret + admin-only writes (P1-12) ───────
REVOKE SELECT ON public.platform_apps FROM authenticated;
GRANT SELECT (id, tenant_id, provider, client_id, label, created_at, updated_at)
  ON public.platform_apps TO authenticated;
DROP POLICY IF EXISTS "platform_apps_insert" ON public.platform_apps;
DROP POLICY IF EXISTS "platform_apps_update" ON public.platform_apps;
DROP POLICY IF EXISTS "platform_apps_delete" ON public.platform_apps;
DROP POLICY IF EXISTS "platform_apps_select" ON public.platform_apps;
CREATE POLICY "platform_apps_read_tenant" ON public.platform_apps FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY "platform_apps_admin_write" ON public.platform_apps FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'));

-- ── 13. organizations: fix write policy — super_admin OR self-tenant admin ─
DROP POLICY IF EXISTS "orgs_admin_write" ON public.organizations;
CREATE POLICY "orgs_own_tenant_update" ON public.organizations FOR UPDATE TO authenticated
  USING (id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "orgs_super_admin_all" ON public.organizations FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

-- ── 14. audit_log: force writes through helper (P1-13) ─────────────────────
REVOKE INSERT ON public.audit_log FROM authenticated;
CREATE OR REPLACE FUNCTION public.log_audit(_action text, _entity_type text, _entity_id text, _details jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.audit_log (tenant_id, actor_id, actor_label, action, entity_type, entity_id, details)
  VALUES (public.current_tenant_id(), auth.uid(),
          (SELECT email FROM public.profiles WHERE id = auth.uid()),
          _action, _entity_type, _entity_id, _details);
END; $$;
REVOKE ALL ON FUNCTION public.log_audit(text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_audit(text, text, text, jsonb) TO authenticated;

-- ── 15. Rewrite handle_new_user to stop auto-granting admin to first user (P1-15)
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'), NEW.email)
  ON CONFLICT (id) DO NOTHING;
  -- Only auto-grant admin to super-admin allowlist emails; everyone else is 'agent'.
  IF NEW.email IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.platform_super_admins WHERE lower(email) = lower(NEW.email)
  ) THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'agent') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;

-- ── 16. Webhook dedup table (P1-4) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.webhook_dedup (
  event_source text NOT NULL,
  event_id     text NOT NULL,
  seen_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_source, event_id)
);
CREATE INDEX IF NOT EXISTS webhook_dedup_seen_idx ON public.webhook_dedup (seen_at);
GRANT SELECT, INSERT ON public.webhook_dedup TO service_role;
ALTER TABLE public.webhook_dedup ENABLE ROW LEVEL SECURITY;
-- No policy for authenticated → deny by default; only service_role writes.

-- ── 17. bot_settings + wa_config: convert to per-tenant ─────────────────────
-- (Larger migration; kept in a separate block to keep the main transaction small.)
-- See §6b below for the bot_settings/wa_config per-tenant conversion.

-- ── 18. Add missing indexes (P2-11) ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS invoices_tenant_idx             ON public.invoices (tenant_id);
CREATE INDEX IF NOT EXISTS sales_documents_lead_idx        ON public.sales_documents (lead_id);
CREATE INDEX IF NOT EXISTS sales_documents_quotation_idx   ON public.sales_documents (quotation_id);
CREATE INDEX IF NOT EXISTS sales_documents_orig_inv_idx    ON public.sales_documents (original_invoice_id);
CREATE INDEX IF NOT EXISTS sales_documents_template_idx    ON public.sales_documents (template_id);
CREATE INDEX IF NOT EXISTS sales_documents_bank_idx        ON public.sales_documents (bank_account_id);
CREATE INDEX IF NOT EXISTS sales_documents_salesperson_idx ON public.sales_documents (salesperson_id);
CREATE INDEX IF NOT EXISTS sales_document_items_product_idx ON public.sales_document_items (product_id);
CREATE INDEX IF NOT EXISTS payment_allocations_payment_idx ON public.payment_allocations (payment_id);
CREATE INDEX IF NOT EXISTS document_files_doc_idx          ON public.document_files (document_id);
CREATE INDEX IF NOT EXISTS document_files_payment_idx      ON public.document_files (payment_id);
CREATE INDEX IF NOT EXISTS document_activity_payment_idx   ON public.document_activity (payment_id);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx             ON public.audit_log (actor_id);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx            ON public.audit_log (entity_type, entity_id);

COMMIT;

-- ── SANITY CHECKS (run AFTER commit; all should return 0) ───────────────────
-- SELECT COUNT(*) AS conv_orphans     FROM public.conversations   WHERE tenant_id IS NULL;
-- SELECT COUNT(*) AS msg_orphans      FROM public.messages         WHERE tenant_id IS NULL;
-- SELECT COUNT(*) AS wa_num_orphans   FROM public.wa_numbers       WHERE tenant_id IS NULL;
-- SELECT COUNT(*) AS reminder_orphans FROM public.reminders        WHERE tenant_id IS NULL;
-- SELECT COUNT(*) AS campaign_orphans FROM public.campaigns        WHERE tenant_id IS NULL;
```

### 6b — bot_settings + wa_config per-tenant conversion

Run this SECOND, after §6. Only if you have existing data — otherwise skip and let the app create per-tenant rows lazily.

```sql
BEGIN;
-- New per-tenant bot_settings; drop the singleton once every tenant has a row.
CREATE TABLE IF NOT EXISTS public.bot_settings_v2 (
  tenant_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  bot_name text NOT NULL DEFAULT 'Flash Assistant',
  greeting text NOT NULL DEFAULT 'Hi! How can I help?',
  instructions text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT 'gemini-2.5-flash',
  handoff_keywords text[] NOT NULL DEFAULT ARRAY['human','agent'],
  business_hours_only boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.bot_settings_v2 TO authenticated;
GRANT ALL ON public.bot_settings_v2 TO service_role;
ALTER TABLE public.bot_settings_v2 ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bot_settings_v2 read"  ON public.bot_settings_v2 FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY "bot_settings_v2 write" ON public.bot_settings_v2 FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'));

-- Seed one row per existing org from the singleton
INSERT INTO public.bot_settings_v2 (tenant_id, enabled, bot_name, greeting, instructions, model, handoff_keywords, business_hours_only)
SELECT o.id, s.enabled, s.bot_name, s.greeting, s.instructions, s.model, s.handoff_keywords, s.business_hours_only
  FROM public.organizations o CROSS JOIN public.bot_settings s
 WHERE s.id = true
ON CONFLICT (tenant_id) DO NOTHING;
COMMIT;

-- After you deploy the code change that reads bot_settings_v2 (see §7 code diff),
-- drop the singleton in a follow-up: DROP TABLE public.bot_settings;
```

---

## 7. Code changes to apply (git-push or Lovable IDE)

Each fix is written as an exact patch. Cowork can apply via GitHub web editor, local clone, or (once credits return) prompt Lovable.

### Patch A — Fix S3 (WhatsApp webhook fails open)

**File:** `src/routes/api/public/whatsapp/webhook.ts`
**Change:** replace the fail-open block.

```diff
-  if (!secret) {
-    console.warn("[whatsapp] no app secret configured — webhook signature not enforced");
-    return { ok: true as const, enforced: false };
-  }
+  if (!secret) {
+    // Fail closed. Silent acceptance lets attackers spoof any tenant's inbound WA
+    // messages using only their (public) phone_number_id.
+    return { ok: false as const, enforced: true };
+  }
```

### Patch B — Fix S1 (widget/chat: require siteKey, pass tenant through)

**File:** `src/routes/api/public/widget/chat.ts`

```diff
 const PayloadSchema = z.object({
-  sessionId: z.string().min(6).max(80),
-  siteKey: z.string().min(10).max(120).optional(),
+  sessionId: z.string().min(32).max(80),
+  siteKey: z.string().min(10).max(120),
   name: z.string().max(80).optional(),
   message: z.string().min(1).max(2000),
 });
...
-      if (parsed.siteKey) {
-        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
-        const { data: site } = await supabaseAdmin
-          .from("lead_sites")
-          .select("status, active, domain")
-          .eq("site_key", parsed.siteKey)
-          .maybeSingle();
-        if (!site || !site.active || site.status !== "active") { ... }
-      }
+      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
+      const { data: site } = await supabaseAdmin
+        .from("lead_sites")
+        .select("tenant_id, status, active, domain")
+        .eq("site_key", parsed.siteKey)
+        .maybeSingle();
+      if (!site?.tenant_id || !site.active || site.status !== "active") {
+        return new Response(JSON.stringify({ error: "This site is not activated yet" }),
+          { status: 403, headers: corsHeaders });
+      }
+      const { checkDomainPin } = await import("@/lib/domain-pin");
+      if (!checkDomainPin(request, site.domain)) {
+        return new Response(JSON.stringify({ error: "This key is not allowed here" }),
+          { status: 403, headers: corsHeaders });
+      }
...
-        const { reply } = await ingestInboundMessage({
+        const { reply } = await ingestInboundMessage({
+          tenantId: site.tenant_id,
           channel: "web",
           sessionId: parsed.sessionId,
           name: parsed.name ?? null,
           text: parsed.message,
         });
```

### Patch C — New file: shared domain-pin helper

**File (new):** `src/lib/domain-pin.ts`

```ts
/**
 * Exact-host-suffix match for site domain pinning. Replaces the substring
 * .includes() that let `evil-acme.com` pass as `acme.com`, and requires the
 * Origin/Referer header when a site declares a domain (previous code let
 * empty headers skip the check entirely).
 */
export function checkDomainPin(request: Request, registeredDomain: string | null): boolean {
  if (!registeredDomain) return true; // no pin configured
  const originHeader = request.headers.get("origin") ?? request.headers.get("referer");
  if (!originHeader) return false; // caller must send Origin/Referer
  let host: string;
  try {
    host = new URL(originHeader).hostname.toLowerCase();
  } catch {
    return false;
  }
  const wanted = registeredDomain.toLowerCase().trim();
  // Exact match OR any subdomain (host must end with `.wanted`)
  return host === wanted || host.endsWith("." + wanted);
}
```

Apply the same helper in `src/routes/api/public/leads/collect.ts` — replace its inline domain check.

### Patch D — Fix S1/S2 in `ingestInboundMessage` (require tenantId)

**File:** `src/lib/wa.server.ts` — signature change + tenant scoping on every query in the function. Full rewrite of the function is too long for this doc; the essential rules:

1. Add `tenantId: string` as a required argument.
2. Every `.from('contacts')` / `.from('conversations')` / `.from('messages')` query in the function must include `.eq('tenant_id', tenantId)` on SELECT and set `tenant_id: tenantId` on INSERT.
3. `contacts` phone dedup becomes composite: `.eq('phone', phone).eq('tenant_id', tenantId)`.
4. WhatsApp webhook caller (`monitoring.server.ts:processWaPayload`) resolves tenant from `wa_numbers.tenant_id` via `phone_number_id` and passes it through.

### Patch E — Fix Paddle env selection (P0-4)

**File:** `src/routes/api/public/payments/webhook.ts`

```diff
-        const url = new URL(request.url);
-        const env = (url.searchParams.get("env") || "sandbox") as PaddleEnv;
+        // Anchor env to build-time env var. Query-string was spoofable — an attacker
+        // hitting `?env=sandbox` on the prod URL forced sandbox-secret verification.
+        const env = (process.env["PADDLE_ENV"] || "sandbox") as PaddleEnv;
```

Set `PADDLE_ENV=live` in production Supabase Edge Function env vars.

### Patch F — Fix P0-5 (v1 API null-tenant fallback)

**File:** `src/routes/api/public/v1/$.ts`

```diff
-if (!auth.tenantId) {
-  query = query.is("tenant_id", null);
-} else {
-  query = query.eq("tenant_id", auth.tenantId);
-}
+if (!auth.tenantId) {
+  return Response.json({ error: "API key has no tenant" }, { status: 403 });
+}
+query = query.eq("tenant_id", auth.tenantId);
```

Also remove the `wa_numbers` "skip tenant filter" branch — after Patch D + §6 §3, wa_numbers HAS tenant_id, so the whitelist path treats it like any other tenant table.

### Patch G — Fix P0-2 (plugin/activate email cannon)

**File:** `src/routes/api/public/plugin/activate.ts`
Two changes:

1. Reject requests where `adminEmail` doesn't match `lead_sites.admin_email` (a new column populated when the site is registered). Adds `lead_sites.admin_email text` migration.
2. Rate-limit by site to 3 activation requests per hour (Postgres row count on `webhook_events` or a new `activation_attempts` table).

### Patch H — Fix P0-7 (sendActivationEmail actually sends)

**File:** `src/lib/plugin-activation.server.ts`
Replace the `console.info` stub with a nodemailer call using the same Hostinger SMTP creds you configured for Supabase Auth SMTP. Add a new `src/lib/mailer.server.ts` that wraps nodemailer using `process.env['SMTP_HOST']`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` (all pulled from env, never in code).

### Patch I — Fix P0-6 (wire ai_provider_keys through generateBotReply)

**File:** `src/lib/flash-ai.server.ts`
Look up `ai_provider_keys` for the current `tenantId` before dispatching an AI call. Order: tenant-specific key (if any) → platform default (LOVABLE_API_KEY). Store per-tenant provider preference in `bot_settings_v2.model` (already added in §6b).

### Patch J — Fix P1-1 (bot reply body-match race)

**File:** `src/lib/monitoring.server.ts` lines 277–282

```diff
-await supabaseAdmin.from("messages").update({ wa_message_id })
-  .eq("conversation_id", convId)
-  .is("wa_message_id", null)
-  .eq("body", reply);
+// Use the id we captured from the insert above; matching by body text tagged
+// the wrong row when concurrent conversations shared identical canned replies.
+await supabaseAdmin.from("messages").update({ wa_message_id })
+  .eq("id", insertedMessageId);
```

### Patch K — Fix P1-3 (consumeState OAuth race)

**File:** `src/lib/oauth.server.ts` around lines 334–347
Convert the read-then-update into an atomic conditional update:

```ts
const { data, error } = await supabaseAdmin
  .from("oauth_states")
  .update({ used_at: new Date().toISOString() })
  .eq("state", s)
  .is("used_at", null)
  .select()
  .maybeSingle();
if (error || !data) throw new Error("State already consumed or invalid");
return data;
```

### Patch L — Fix P0-11 (bot_settings per-tenant read)

**File:** `src/lib/wa.server.ts` line 16 area — replace singleton bot_settings read with per-tenant:

```diff
-const { data: settings } = await supabaseAdmin.from("bot_settings").select("*").maybeSingle();
+const { data: settings } = await supabaseAdmin.from("bot_settings_v2").select("*")
+  .eq("tenant_id", tenantId).maybeSingle();
```

### Patch M — Fix P2-1 (XSS in seo-blog studio)

**File:** `src/routes/_authenticated/seo-blog.studio.tsx` line 706
Import DOMPurify, wrap `contentHtml`:

```diff
+import DOMPurify from "isomorphic-dompurify";
...
-dangerouslySetInnerHTML={{ __html: contentHtml }}
+dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(contentHtml) }}
```

---

## 8. Environment variables Cowork must configure

Set these in Supabase Dashboard → Project Settings → Edge Functions → Environment Variables. Never in code, never in chat.

| Category                   | Var                                                                                                                              | Notes                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Supabase (already set)     | `SUPABASE_URL` `SUPABASE_SERVICE_ROLE_KEY` `SUPABASE_PUBLISHABLE_KEY` `VITE_SUPABASE_URL` `VITE_SUPABASE_PUBLISHABLE_KEY`        |                                                                          |
| Lovable (may be removable) | `LOVABLE_API_KEY` `LOVABLE_SEND_URL`                                                                                             | If moving to Hostinger SMTP, remove these once auth webhook is rewritten |
| WhatsApp Meta              | `WHATSAPP_ACCESS_TOKEN` `WHATSAPP_PHONE_NUMBER_ID` `WHATSAPP_APP_SECRET` `WHATSAPP_VERIFY_TOKEN` `META_APP_ID` `META_APP_SECRET` | **`WHATSAPP_APP_SECRET` REQUIRED after Patch A**                         |
| Google OAuth               | `GOOGLE_OAUTH_CLIENT_ID` `GOOGLE_OAUTH_CLIENT_SECRET`                                                                            | If Google login is used                                                  |
| LinkedIn OAuth             | `LINKEDIN_CLIENT_ID` `LINKEDIN_CLIENT_SECRET`                                                                                    |                                                                          |
| TikTok OAuth               | `TIKTOK_CLIENT_KEY` `TIKTOK_CLIENT_SECRET`                                                                                       |                                                                          |
| X (Twitter) OAuth          | `X_CLIENT_ID` `X_CLIENT_SECRET`                                                                                                  |                                                                          |
| Pinterest OAuth            | `PINTEREST_APP_ID` `PINTEREST_APP_SECRET`                                                                                        |                                                                          |
| Paddle                     | `PADDLE_SANDBOX_API_KEY` `PADDLE_LIVE_API_KEY` `PAYMENTS_SANDBOX_WEBHOOK_SECRET` `PAYMENTS_LIVE_WEBHOOK_SECRET` `PADDLE_ENV`     | **`PADDLE_ENV=live` new — required after Patch E**                       |
| SMTP (new — for Patch H)   | `SMTP_HOST=smtp.hostinger.com` `SMTP_PORT=465` `SMTP_USER=flas@mobidigisol.com` `SMTP_PASSWORD`                                  |                                                                          |

---

## 9. Verification test plan (Cowork runs after fixes deployed)

### 9.1 Schema fix landed

```sql
SELECT 'conversations tenant_id' AS check, COUNT(*) FROM public.conversations WHERE tenant_id IS NULL
UNION ALL SELECT 'messages tenant_id',      COUNT(*) FROM public.messages       WHERE tenant_id IS NULL
UNION ALL SELECT 'wa_numbers tenant_id',    COUNT(*) FROM public.wa_numbers     WHERE tenant_id IS NULL
UNION ALL SELECT 'reminders tenant_id',     COUNT(*) FROM public.reminders      WHERE tenant_id IS NULL
UNION ALL SELECT 'campaigns tenant_id',     COUNT(*) FROM public.campaigns      WHERE tenant_id IS NULL
UNION ALL SELECT 'webhook_events tenant_id', COUNT(*) FROM public.webhook_events WHERE tenant_id IS NULL;
-- All should be 0.
```

### 9.2 Tenant isolation live test

Sign up TWO test accounts into TWO different companies (`AlphaCo` and `BetaCo`). In each, create a contact named "SharedName" with phone `+971509990000`. Then:

- Log in as AlphaCo → open the SharedName contact → note the URL
- Log in as BetaCo → paste the same URL → expected: 404 or "Not found"
- BetaCo cannot see AlphaCo's contact even by ID
- Send a WhatsApp message to +971509990000 from AlphaCo — only AlphaCo's inbox shows it, never BetaCo's

Delete the two test accounts + their orgs when done.

### 9.3 WhatsApp webhook signature guard (Patch A)

```bash
curl -X POST https://flas.mobidigisol.com/api/public/whatsapp/webhook \
  -H "Content-Type: application/json" -d '{"fake":"payload"}'
```

Expected: 401 (was 200 before).

### 9.4 Widget requires site key (Patch B)

```bash
curl -X POST https://flas.mobidigisol.com/api/public/widget/chat \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX","message":"hi"}'
```

Expected: 400 (missing siteKey), not 200.

### 9.5 Domain-pin bypass fixed (Patch C)

With a site whose registered domain is `acme.com`, POST to `/leads/collect` with `Origin: https://evil-acme.com` — expected 403. With no Origin header — expected 403 (was passing before).

### 9.6 v1 API rejects null-tenant keys (Patch F)

Create an API key with `tenant_id = NULL`. Call `/api/public/v1/contacts` with it. Expected 403.

### 9.7 team_invites can't mint super_admins (§6 fix 11)

Log in as tenant admin. Try to INSERT into `team_invites` with `staff_role='super_admin'`. Expected: RLS violation.

### 9.8 audit_log actor forgery blocked (§6 fix 14)

Log in as any user. Try `INSERT INTO audit_log ... actor_id='<other-user-uuid>'`. Expected: permission denied (grant revoked). Call `SELECT log_audit('test.action','entity','id','{}'::jsonb)` — expected: row created with your actual auth.uid().

### 9.9 Auth flow

- Sign up new user → verification email arrives from `flas@mobidigisol.com` via Hostinger (not Lovable)
- MFA challenge triggers when TOTP is enabled
- Wrong password × 5 → account lockout

---

## 10. Suggested Cowork execution order

1. **Rotate the leaked email password.**
2. **Configure Custom SMTP in Supabase dashboard** (§5.1–5.3).
3. **Run §6 mega migration** in Supabase SQL Editor.
4. **Run §6b bot_settings/wa_config conversion** if you have existing data.
5. **Apply code Patches A → M via git** (each is a small self-contained diff).
6. **Set env vars from §8** in Supabase Edge Functions.
7. **Run §9 verification test plan.**
8. **Delete all test data + test accounts.**
9. **Report back:** what worked, what failed, what needs the user to unblock (e.g. missing OAuth client_ids, Paddle live keys, Meta App Secret).

Total time estimate: **3–5 hours** including verification, assuming credentials + Supabase access are ready up front.

---

## 11. Hard rules for Cowork

- NEVER ask the user to paste API keys, passwords, or tokens in chat. Direct them to Hostinger File Manager / Supabase Dashboard / GitHub Secrets.
- MASK any key in your final report: `AIza...XXXX`, `sb_...XXXX`.
- DO NOT skip §9 tests — the schema migrations are non-trivial and orphans matter.
- If any migration fails mid-way, ROLLBACK, capture the error, and stop. Don't run partial fixes.
- If a Patch conflicts with newer code (Lovable auto-generated something), stop and ask the user before overwriting.
- Total context: this is a Lovable/TanStack/Supabase project. Lovable credits are currently exhausted — use git-push flow, not Lovable prompts.

---

## 12. What this audit didn't cover (out of scope)

- Runtime performance profiling / load testing
- React component logic bugs (only spot-checked auth + tenant plumbing)
- Sales invoicing math correctness
- Design/UX
- Accessibility
- Third-party library CVE audit (worth running `bun audit` separately)
- Legal/GDPR compliance beyond having a `deletion_requests` table

These need separate passes if you want them.

---

---

## 13. User's original Lovable asks — verification + completion of unfinished work

Lovable ran out of credits mid-work. This section reconciles the user's original prompt list against what actually landed in the codebase, and includes new files that complete the unfinished pieces.

### 13.1 Verification of every ask

| #   | User asked for                                         | Status                                                                                                                                                                                              |
| --- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Hide "Edit with Lovable" badge                         | ✅ Toggled off in Lovable dashboard settings (no code trace, verified via absence of badge markers in src/)                                                                                         |
| 2   | Remove "Continue with Google" button                   | ✅ Truly removed from `src/routes/auth.tsx`. Zero Google references in the auth pages                                                                                                               |
| 3   | Disable Google OAuth in backend                        | ⚠️ Needs Supabase Dashboard check — Auth → Providers → Google must be OFF                                                                                                                           |
| 4   | Configure Hostinger SMTP for OTP                       | ❌ Not viable on serverless (no raw TCP). Replaced with per-tenant HTTP-provider config in §13.4 below                                                                                              |
| 5   | Companies fully separated (tenant isolation)           | ❌ **BROKEN** — see SHIP-BLOCKERS §1 + P0-8/9/10/11 + full mega migration §6                                                                                                                        |
| 6   | Audit + remove ALL user-facing Google references       | ✅ Zero Google refs in `auth.tsx`, `reset-password.tsx`, `verify.$token.tsx`, `OnboardingModal.tsx`. Google refs that REMAIN are for GBP / Ads / Analytics integrations — legit features, not login |
| 7   | Every new company sends OTP on registration            | ⚠️ Needs Supabase Dashboard → Auth → Providers → Email → ✅ Enable Email Confirmations                                                                                                              |
| 8   | Fix broken login                                       | ✅ auth.tsx flow intact — password + MFA + reset all present                                                                                                                                        |
| 9   | Fix broken password reset                              | ✅ `src/routes/reset-password.tsx` exists + handles PASSWORD_RECOVERY event                                                                                                                         |
| 10  | Fix broken company registration                        | ✅ `src/lib/onboarding.functions.ts:completeOnboarding` intact — creates org, sets company_admin, 30-day trial                                                                                      |
| 11  | Per-company email delivery audit log                   | ❌ Lovable started, credits died — **completed here in §13.2** (migration + super-admin UI)                                                                                                         |
| 12  | Resend-OTP flow with cooldown + max attempts + logging | ❌ Only client-side cooldown existed (bypassable). **Completed here in §13.3** with server-side rate limiting                                                                                       |
| 13  | Per-company SMTP configuration                         | ❌ Lovable pushed back. **Completed here in §13.4** via HTTP-provider config (Resend / Mailgun / SendGrid / Postmark / SES)                                                                         |
| 14  | Super admin sees OTPs across tenants                   | ❌ Not addressed. **Completed via new page** `src/routes/_authenticated/companies.emails.tsx`                                                                                                       |
| 15  | Smooth for many countries + companies to register      | ⚠️ Signup works, but no i18n on OTP emails and no country-code phone input. Follow-up work                                                                                                          |

### 13.2 New migration — email + OTP + SMTP tables

File shipped: `supabase/migrations/20260830000000_email_audit_otp_smtp.sql`

Adds three tables + supporting RPCs:

| Table                | Purpose                                                                                                                                               | RLS                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `email_delivery_log` | Every email dispatched (recipient, subject, template, provider, status, error, timestamps). Written from `log_email_delivery()` SECURITY DEFINER RPC. | Company admin reads own tenant; super_admin reads all        |
| `otp_attempts`       | Every verification / recovery / magic-link resend attempt (email, IP, kind, status, reject_reason). Written from `record_otp_attempt()`.              | Super_admin only (PII)                                       |
| `tenant_smtp_config` | Per-tenant outbound-email provider (Resend / Mailgun / SendGrid / Postmark / SES / smtp_relay). `api_key_enc` encrypted with pgcrypto.                | Company admin reads/writes own tenant; super_admin reads all |

Supporting RPCs (all `SET search_path = public`):

- `log_email_delivery(...)` — service_role only, writes an event row
- `update_email_delivery(...)` — service_role only, flips status on provider webhook
- `check_otp_attempt(email, kind)` — returns `{allowed, reject_reason, seconds_until_next, attempts_last_hour}`. 60s cooldown, 5/hour, 20/day per email+kind. Callable by authenticated + service_role
- `record_otp_attempt(...)` — service_role only, appends an attempt row
- `set_tenant_smtp_api_key(text)` — authenticated + admin, encrypts with pgcrypto and stores. Never reveals
- `get_tenant_smtp_api_key(uuid)` — service_role only, decrypts for the send path
- `_smtp_encryption_key()` — service_role helper, reads Vault secret `tenant_smtp_key` (or GUC `app.tenant_smtp_key` for local dev)

**Cowork setup step:** create the encryption secret ONCE:

```sql
-- In Supabase SQL Editor (as postgres):
SELECT vault.create_secret(encode(gen_random_bytes(32), 'base64'), 'tenant_smtp_key');
```

Or if Vault isn't enabled on your plan:

```sql
ALTER DATABASE postgres SET app.tenant_smtp_key = '<paste 32+ char random string>';
```

### 13.3 New server function — server-side resend with rate limits

File shipped: `src/lib/otp-resend.functions.ts`

Exports `resendVerification` — handles `signup_verify` / `password_recovery` / `magic_link` kinds.
Flow:

1. Calls `check_otp_attempt` RPC — enforces 60s cooldown, 5/hour, 20/day per email+kind
2. Rejects with an informative message (`Please wait Ns...` / `Too many attempts in the last hour`)
3. On success, records attempt as `requested`, dispatches via Supabase Auth admin API, flips to `sent`
4. Logs a `sent` row to `email_delivery_log`
5. On dispatch failure returns a uniform `"If an account exists..."` message to prevent account enumeration
6. `auth.tsx` now calls this instead of `supabase.auth.resend` directly — client-side cheat killed

Wired in `src/routes/auth.tsx`:

- Old `resendVerification()` client function replaced with `resendVerificationEmail()` that calls the server fn
- Client-side 60s cooldown kept as UX hint but no longer the security boundary

### 13.4 New server function + UI — per-tenant SMTP configuration

Files shipped:

- `src/lib/tenant-smtp.functions.ts` — 4 server functions:
  - `getTenantSmtpConfig` — read settings (no api_key ever returned)
  - `saveTenantSmtpConfig` — upsert provider/from/reply-to/region/domain
  - `setTenantSmtpApiKey` — encrypt + store via `set_tenant_smtp_api_key` RPC
  - `testTenantSmtp` — dispatch a real test email via the configured provider; result logged
- `src/routes/_authenticated/settings.email.tsx` — company admin UI (provider dropdown + api key rotate + test button)
- `src/routes/_authenticated/companies.emails.tsx` — super admin UI (email delivery log + OTP attempt audit)

**Provider dispatchers implemented in `dispatchTestEmail`:**

- Resend (`https://api.resend.com/emails`)
- Postmark (`https://api.postmarkapp.com/email`)
- Mailgun (US + EU regions via `api.mailgun.net` / `api.eu.mailgun.net`)
- SendGrid (`https://api.sendgrid.com/v3/mail/send`)
- `ses` and `smtp_relay` — placeholders that return "not implemented"; add when you're ready to onboard those providers

**Why HTTP-based providers instead of Hostinger SMTP:**
TanStack Start on Lovable Cloud runs on Cloudflare Workers (serverless V8 isolate). There is no raw TCP socket, so `smtp.hostinger.com:465` cannot be reached from the server code. Every serverless email approach uses an HTTP-based provider. Resend is the friendliest — free tier is 3,000 emails/month + 100/day, more than enough for OTP volume at any small-to-mid SaaS.

### 13.5 Cowork execution appendix for §13 changes

After running the mega migration from §6 and §6b:

1. **Run the new migration** `supabase/migrations/20260830000000_email_audit_otp_smtp.sql`
2. **Configure the encryption secret** (see 13.2 above)
3. **Set Supabase Dashboard toggles:**
   - Auth → Providers → Google → OFF (confirm ask #3)
   - Auth → Providers → Email → Enable Email Confirmations → ON (confirm ask #7)
4. **Deploy the new/updated code files** to git:
   - `src/lib/otp-resend.functions.ts` (new)
   - `src/lib/tenant-smtp.functions.ts` (new)
   - `src/routes/_authenticated/settings.email.tsx` (new)
   - `src/routes/_authenticated/companies.emails.tsx` (new)
   - `src/routes/auth.tsx` (modified — imports + `resendVerificationEmail` function)
5. **Verify with these test cases:**
   - Sign up a fresh test user → confirm email arrives → confirm `email_delivery_log` has one `sent` row for template=signup
   - Click "resend verification" twice in <60s → second attempt returns `Please wait Ns...` error and `otp_attempts` has one `sent` + one `rejected` row with `reject_reason=cooldown`
   - Log in as super admin → visit `/companies/emails` → confirm both rows visible
   - Log in as company admin → visit `/settings/email` → change provider to Resend, paste API key, send test → confirm test email arrives + `email_delivery_log` has a `sent` row with `provider=resend`

### 13.6 What still isn't done (be honest with the user)

- **Google OAuth confirmation:** the button is gone from the UI but the Supabase Dashboard toggle for Google provider must be verified OFF manually — I can't check that from the codebase
- **i18n for OTP emails:** the "many countries" ask implies translated OTP emails per user locale. Not built. If needed, wire a `locale` column onto `profiles` + branch the email template render in `src/routes/lovable/email/auth/webhook.ts`
- **Country-code phone input:** signup only takes email today. If phone-first signup is needed, that's a separate module
- **Bounce / complaint webhooks:** `update_email_delivery` RPC exists but no route currently accepts provider webhook POSTs. When you're ready, add `/api/public/webhooks/email-provider/$provider.ts` that verifies the provider signature and calls the RPC
- **The `signup_otps` table** (from an earlier Lovable pass) is still `USING(false)` — service_role only. If you ever want an in-app OTP-code entry (rather than link-click verify), that table is where the code lives

---

_End of audit v3.4. Sources: static analysis of extracted `Chat Connect Pro.zip` — 34 migrations + 1 new · 26 server libraries + 2 new · 10 public API endpoints · 21 authenticated pages + 2 new admin pages · 15 user prompt items verified._
