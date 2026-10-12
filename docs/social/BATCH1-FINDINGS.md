# Batch 1 — Phase 0 findings

Verified against `main` at `09eafae` on 2026-09-10. Working tree clean; local
`work` equals `lovable/main` (0 ahead, 0 behind). Nothing below is taken from a
comment or a previous report — each line was checked in source or migrations.

The "foundation files" the brief refers to (`social-capability-registry.ts`,
`oauth-foundation.server.ts`, `social-token-store.server.ts`,
`social-secrets.server.ts`, `migrate-social-token-encryption.ts`,
`20260909000100_social_integration_batch1_foundation.sql`) **do not exist
anywhere on this machine**. Batch 1 is built from `main`, not from them.

## The 15 known issues

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | `oauth_states.state` is plaintext | **FALSE on main** | Only `state_hash` is written (`oauth.server.ts:275`), consumed by hash (`:530`). Migration `20260909100000`. Gaps vs brief: entropy is two UUIDv4 (~244 bits, brief asks ≥256); `code_verifier` is plaintext and the table grants `SELECT` to `authenticated`, so a teammate in the same tenant can read it. |
| 2 | Redirect origin comes from `window.location.origin` | **PARTLY TRUE** | The browser sends it (`ConnectBusiness.tsx:153`), but the server checks it against an exact-origin allowlist (`resolveAllowedOrigin`, `oauth.server.ts:182`) before anything is built. Gap: the variable is `OAUTH_ALLOWED_ORIGINS` with a loopback fallback; brief asks for `SOCIAL_OAUTH_ALLOWED_ORIGINS`. |
| 3 | Social tokens stored plaintext | **TRUE** | `connections.server.ts:155-157`, `integration-health.server.ts:357-358`, `social.functions.ts:82`. |
| 4 | Social Hub accepts a pasted access token | **TRUE** | `social.tsx:211,486`; schema `social.functions.ts:19`; written at `:82`. |
| 5 | Meta calls put tokens in URL query strings | **TRUE** | `social.server.ts:31` (every Graph call), `connections.server.ts:37,69`, `meta-discovery.server.ts:86`, `social-doctor.server.ts:221`, `integration-health.server.ts:178`; Google `tokeninfo?access_token=` at `:198`; WhatsApp in `meta-health.functions.ts:62,83` and `flash-ai.server.ts:504`. |
| 6 | Callback logs raw exceptions | **PARTLY TRUE** | The main failure path logs a redacted message (`oauth-callback.ts:218`). Two catch blocks log the raw error object: `:57` and `:251`. |
| 7 | Some service-role writes scoped only by record ID | **TRUE** | `social.server.ts:101` (`supabaseAdmin` update by `id` only), `connections.server.ts:192`, `integration-health.server.ts:386`. The `.eq("id")` calls in `social.functions.ts` use the RLS client or also filter `tenant_id` — not affected. |
| 8 | `getConnections()` fabricates token presence | **TRUE** | `connections.functions.ts:53`: `... ? "set" : "set"` — both branches are `"set"`. |
| 9 | Healthy without a live provider check | **TRUE** | `connection-status.ts:129` says "Healthy" from `last_synced_at` alone. |
| 10 | YouTube advertised as messaging-capable | **FALSE on main** | Catalog comment and registry: not supported. Marketing corrected in `b0fea49`. |
| 11 | GBP advertised as messaging-capable | **FALSE on main** | Same; registry marks all four inbox capabilities not supported. |
| 12 | Instagram DM sync not proven | **TRUE** | Registry: Instagram DM read/send `not_implemented`, but the catalog blurb still says "comments, DMs" (`connections-catalog.ts:71`). The `/conversations` call that exists is **Facebook Messenger**, in a best-effort block whose `catch {}` swallows permission failures. |
| 13 | TikTok Ads reuses consumer TikTok OAuth | **TRUE** | Registry `tiktok_ads.requestedScopes = ["user.info.basic"]`, `oauth2_pkce` — the Login Kit shape. |
| 14 | Capability definitions duplicated | **TRUE** | Own scope map in `social-doctor.server.ts:228-239`; scope hints in `social.tsx:140,181`; a separate `Capability` type and blurbs in `connections-catalog.ts`. |
| 15 | `.env*` tracked in git | **TRUE, no rotation needed** | `.env`, `.env.development`, `.env.production`, `.env.example` are tracked. Every value ever committed is public by design (Supabase URL, project ID, publishable key; Paddle client token). Every secret-named key in history was an empty template line. |

## Also found

- **Phase 21 (0 checks = 100%)** — already correct: `monitoring.tsx:154` returns `null` for zero rows and renders "No data".
- **Phase 26** — YouTube sends the credential as `key=` (`social.server.ts:249`), the API-key mechanism, not OAuth Bearer.
- **Phase 22** — registry already exports `CONNECTOR_COUNTS` (19 total), but the UI labels do not say which category they count.
- **Phase 33** — to be confirmed: no social storage bucket found yet.

## What Tasks 1–4 already delivered

| Phase | Status | Where |
|---|---|---|
| 1 Registry | Done, naming differs | `social-connector-definitions.ts` (19 entries: 15 platform + 4 website/store/messaging) |
| 2 State machine | Done, state names differ | `connection-state.ts` has 10 connection states + 6 attempt states; brief wants 13 in one set |
| 3 Hashed, atomic, single-use state | Done | `20260909100000`, `consume_oauth_state_hash()` |
| 4 Abandoned attempts | Done | `expire_abandoned_oauth_attempts()`, `sweepAbandonedAttempts()` |
| 5 Exact-origin allowlist | Done, variable name differs | `resolveAllowedOrigin()` |
| 15 Scopes from registry | Done for `oauth.server.ts` | other modules still duplicate (claim 14) |
| 16 Refresh lock | Done | `try_lock_connection_refresh()` — transaction-scoped advisory lock, auto-releases |
| 29 Replay tests | Done | `verify-oauth-security.mjs`, `verify-oauth-roundtrip.mjs` |
| 30 Isolation harness | Partly | `verify-social-tenant-isolation.mjs` (252 checks, two workspaces); six identities not yet |
| 42 Redaction tests | Done | `tests/oauth-security.test.mjs` |

Everything else in phases 6–55 is open.
