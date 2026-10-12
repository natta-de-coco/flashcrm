# FLAS audit punch-list — execution status

Source audit: 12 Sep 2026. Implementation branch: `fix/audit-punchlist-2026-09-14`.

This file separates code changes from hosting/provider actions. A task is not marked verified merely because code exists.

| Task | Status | Evidence / next action |
|---|---|---|
| T1 OAuth return-address secret | MANUAL BLOCKER | In Lovable/server secrets set `PUBLIC_APP_URL=https://flas.mobidigisol.com` and `OAUTH_ALLOWED_ORIGINS=https://flas.mobidigisol.com`, then redeploy. Code already trims allowlist entries. |
| T2 Chatbot dormant warning | ALREADY DONE | Chatbot renders the dormant warning, missing-condition list and character count. |
| T3 renews_at column | ALREADY DONE / REVERIFY TYPES | Billing code and migration expose `subscription_renews_at`; regenerate Supabase types after applying current migrations. |
| T4 organizations RLS | FIXED IN MIGRATION | `20260914090000_audit_punchlist_security.sql` removes unconditional SELECT policies and adds own-tenant/super-admin SELECT. Must be applied and verified in the real DB. |
| T5 tenant-table RLS audit | PARTLY COMPLETE | Existing hardening migrations cover conversations, messages, reminders, campaigns, user_roles, platform_apps and others. Added `supabase/verify/tenant-rls-audit.sql` for the live database. Any row returned by sections A/B is a release blocker. |
| T6 OAuth-state RPC permissions | FIXED IN MIGRATION | Browser roles lose consume/purge access; service role retains callback access. Re-test a real OAuth round trip after T1 and migration apply. |
| T7 provider credential entry | FIXED IN UI | Integrations now wires the existing secure `CredentialsStep`/`savePlatformApp` flow into Provider Setup. |
| T8 false Meta Configured state | FIXED IN READINESS | A provider is not Ready just because two credential fields exist; origin/app URL/encryption are also checked. |
| T9 all preflight failures | FIXED IN READINESS | Side-effect-free preflight returns a blocker list instead of the first error only. |
| T10 WhatsApp/store readiness | FIXED IN UI | Provider Setup includes WhatsApp and WordPress/Shopify/WooCommerce readiness groups. |
| T11 AI keys pointer | FIXED | Integrations now contains `#ai-keys` and renders the existing `AiKeysCard`. |
| T12 reachable contact + E.164 | SERVER/DB FIXED; CLIENT POLISH REMAINS | DB trigger requires phone or email and E.164 phone. Existing form already requires phone/email but its inline phone validation is looser; tighten before final release. |
| T13 shared main landmark | FIXED FOR LEGACY ROUTES | Authenticated shell supplies `main#content` for Inbox and Sales; routes already owning `<main>` remain unchanged. |
| T14 no connection row for blocked pre-auth | VERIFIED BY CODE PATH | `startAuthorization` creates OAuth state only; `social_accounts` is saved after callback/provider authorization. Blocked attempts remain audit events. |
| T15 aborted-fetch console noise | FIXED | Telemetry ignores abort-like navigation errors but still records genuine server/network failures with operation context. |
| T16 app shell reload | ALREADY MOSTLY DONE | Authenticated shell already persists across route changes; skeleton is only for auth/session hydration. Re-test after deployment. |
| T17 stale provider error | FIXED | Marketplace clears blocked state when search/category/provider context changes. |
| T18 brand capitalization | FIXED IN NEW READINESS UI | Uses Meta, LinkedIn, TikTok, X, Pinterest, Google display names rather than slug capitalization. |
| T19 one connect verb | FIXED IN NEW MARKETPLACE | Ready integrations use `Connect <name>`; setup blockers use `Fix setup`; unavailable integrations use `Coming soon`. |
| T20 provider-specific field names | FIXED | Meta/Pinterest App ID, Google/LinkedIn/X Client ID, TikTok Client Key, with matching secret labels. |
| T21 model label typo | FIXED | Chatbot displays the actual configured model identifiers; no `Flas` typo. |
| T22 billing section | ALREADY DONE | Settings currently renders `BillingCard`; audit finding is stale. |
| T23 consolidate role systems | DEFERRED ARCHITECTURE | Do not combine role stores inside this security release. Write a separate migration plan after current RLS changes are verified. |
| T24 localStorage session tokens | DEFERRED HARDENING | Supabase default remains. Revisit with a deliberate auth/cookie migration; not safe as an incidental patch. |
| T25 provider developer credentials | USER/PROVIDER ACTION | Meta, Google, LinkedIn, TikTok, X, Pinterest and WhatsApp credentials must be created in their official consoles. Never commit them. |

## Release gates

Before merging/deploying this branch:

1. Apply the new migration to staging/Lovable Supabase.
2. Run `supabase/verify/tenant-rls-audit.sql` and resolve every result in sections A/B.
3. Run `npm test`, `npm run lint`, `npm run build`, and TypeScript checking.
4. Re-test a real Meta OAuth round trip after T1.
5. Verify a normal tenant cannot enumerate `organizations` or call OAuth-state consume functions.
6. Verify no secrets appear in browser responses, URLs, logs or committed files.
7. Tighten the contact form's inline E.164 validation to match the database trigger.

Until those gates pass: **NOT READY FOR PRODUCTION**.
