# Flas CRM (Chat Connect Pro) — project memory

Read this first in any new session. Full detail lives in `docs/`.

## What this is

A multi-tenant CRM for WhatsApp-driven sales teams — inbox, contacts, invoicing/Paddle
billing, an AI assistant ("Flash AI"), social publishing, SEO/blog studio, and a
WordPress/Shopify/Chrome-extension lead-capture ecosystem. Built on **TanStack Start +
Supabase + Paddle**, developed in **Lovable** (see `AGENTS.md` — do not rewrite published
git history, Lovable syncs off this branch).

Brand: sender email `flas@mobidigisol.com`, live URL referenced in code as
`https://flas.mobidigisol.com`. Owner/super-admin: `moobbi@yahoo.com` (also locked in
as an undeletable super-admin at the DB level — see migration `20260830010000`).

A separate, unrelated project (PHP, Hostinger-hosted, "MobiCRM") exists elsewhere on
this machine at `Z:\mobicrm-hostinger` — don't confuse the two.

## Current state (as of 2026-09-01)

- **This repo was assembled from two sources**, reconciled and merged on 2026-08-31:
  1. `Z:\Chat Connect Pro.zip` — the raw snapshot the 2026-08-29 security audit scanned.
  2. `FlasCRM-patched-v3.5.zip` (in `C:\Users\atozm\Downloads`) — added genuinely-completed
     work on top: per-tenant SMTP + rate-limited OTP resend, a super-admin lockdown +
     subscribers dashboard, atomic OAuth state consumption, real PKCE for X/Twitter,
     sanitized OAuth error codes.
- **2026-09-01: a full day of fixes** — all 3 ship-blockers, essentially every P0,
  and most of the P1/P2 backlog from the audit are now fixed in code (~35 items
  across tenant isolation, WhatsApp, billing, integrations, and account settings).
  Full list with line-level detail and status: **[`docs/fix-tracker.md`](docs/fix-tracker.md)**
  — read it before assuming anything is or isn't done.
- **What's deliberately NOT done, and why** (bigger design/infra work, not
  quick fixes): AI endpoint rate limiting, `social_accounts` token encryption,
  MFA enforcement, wiring `ai_provider_keys` into the AI dispatcher, real media
  download/re-hosting for non-text WhatsApp messages, and caching/rate-limiting
  on `documents/$token` and `plugin/download`. Each needs a design decision or
  new infrastructure, not a line-level patch — see the fix tracker for specifics.
- **`npx tsc --noEmit` and `npm run build` are both clean** as of this commit — the
  Aug 29 v3.5 merge had actually left the project in a non-compiling state (missing
  types for tables/RPCs it added), fixed as part of this pass too.
- **Two new migrations are written but NOT yet applied to Supabase** (no DB
  credentials in this environment): `supabase/migrations/20260901000000_tenant_isolation_and_security_hardening.sql`
  and `20260901010000_per_tenant_bot_and_wa_config.sql`. Several P0/P1 findings are
  only half-fixed until someone runs these — check `docs/fix-tracker.md` for which
  ones say "not yet run" vs. genuinely done.
- **Do not assume anything is fixed** without re-checking — this file will be kept
  updated as real fixes land, but always verify against source, not memory.

➡ **Full findings + live status: [`docs/fix-tracker.md`](docs/fix-tracker.md)** — every
finding from both audits, grouped by feature area, with a checkbox per item.

➡ **Original audit docs (verbatim, for full SQL/code-diff reference):**

- [`docs/handoff/FLAS-CRM-AUDIT-FOR-COWORK.md`](docs/handoff/FLAS-CRM-AUDIT-FOR-COWORK.md) — the
  full audit: 3 ship-blockers, 12 P0s, 15 P1s, 10 P2s, the mega SQL migration, and
  code patches A–M.

➡ **What happened the night of 2026-08-29 and why some promised work never landed:**
[`docs/session-2026-08-29-recap.md`](docs/session-2026-08-29-recap.md)

## Campaign Planner (added 2026-09-01)

New page at `/campaign-planner` (nav: Business section). Generates AI campaign
targeting plans grounded in real computed data — see
`src/lib/campaign-intel.server.ts` for the audience-segment and channel-
performance math, and `src/lib/campaign-planner.functions.ts` for the server
functions. Plans persist in `campaign_plans` (migration `20260901050000`, not
yet run against Supabase).

Explicitly NOT built (flagged as bigger follow-ups, not attempted blind):

- Real website-visitor tracking — contacts have no city/country field at all
  today; the planner's "geography" is inferred from phone calling codes only,
  and says so in its own output.
- Per-platform audience demographics (age/gender/location breakdowns) — each
  social API exposes this differently and some need elevated permissions
  (e.g. Meta Page Insights demographics) not verified as granted here.

Before this was built, all 6 social sync functions in `social.server.ts`
(Meta, YouTube, X, LinkedIn, TikTok, Google Business) were code-reviewed
against their documented API shapes at the user's request — no bugs found
beyond the 2 already fixed earlier that day (LinkedIn duplicate posts, the
deprecated Google Business endpoint). **This was a code review, not a live
test** — there's no real connected social account or Supabase access in this
environment to actually run a sync and confirm it works end-to-end.

## Outstanding feature requests (asked 2026-08-29, not yet built)

1. **Multi-provider AI connector** — let each tenant link their own Claude API key
   and/or OpenAI (ChatGPT) key, used across that tenant's users, feeding Flash AI.
   Nothing in the codebase yet (`ai_provider_keys` table exists but is unused by any
   code path — see fix tracker item `ai-byok-dead`).
2. **Flash AI training-data collection layer** — not started.
3. **Seed `+971509630506`** as the org's/moobbi's official WhatsApp number — no
   migration or seed exists for this anywhere in the project.

## New env vars introduced 2026-09-01

Set these in Supabase Dashboard → Edge Functions → Environment Variables when deploying:

- `PADDLE_ENV` — `live` or `sandbox`. Defaults to `sandbox` if unset (was previously,
  insecurely, read from a URL query parameter).
- `PLATFORM_EMAIL_PROVIDER` / `PLATFORM_EMAIL_API_KEY` / `PLATFORM_EMAIL_FROM` —
  optional platform-wide fallback email sender (used by `sendTenantEmail()` in
  `src/lib/email-dispatch.server.ts` for tenants who haven't configured their own
  provider in Settings → Email). Without these, plugin-activation emails simply
  report failure instead of silently doing nothing.

## Working agreements

- **Never commit `.env`, `.env.development`, `.env.production`** — `.gitignore` excludes
  them; keep it that way. Secrets live in Supabase Dashboard → Edge Functions → env vars.
- **This is a live product handling real customer WhatsApp/billing data** — treat every
  tenant-isolation fix as security-critical, not a style nit. Prefer the exact patches
  in `docs/handoff/FLAS-CRM-AUDIT-FOR-COWORK.md` §7 (they were reviewed once already)
  over improvising new ones, unless the code has since diverged from what they assume.
- When you fix something, update `docs/fix-tracker.md`'s checkbox and re-verify the
  claim in this file if it changes the "current state" summary above.
- No `.git` history existed before 2026-08-31 — this was assembled fresh from zips, so
  don't expect old commits to explain past decisions; `docs/` is the record instead.
