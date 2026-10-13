# BRIEFING — 2026-10-09T16:50:00Z

## Mission
Analyze, design, and blueprint Milestone 1 Server Crypto (AES-256-GCM envelope encryption compatible with social secrets) & Protocol Socket Handshaking (SMTP/IMAP tls/net testers) and superadmin server functions for Chat Connect Pro platform email settings.

## 🔒 My Identity
- Archetype: Teamwork explorer
- Roles: Read-only investigation, architectural analysis, module blueprinting
- Working directory: z:\Chat Connect Pro\.agents\teamwork\m1_explorer_2
- Original parent: 1fd03f27-f47d-43e3-8af6-a7f340a55935
- Milestone: Milestone 1 (Platform SMTP Configuration & Verification)

## 🔒 Key Constraints
- Read-only investigation — do NOT implement / modify source code directly
- Must comply with WebCrypto API (crypto.subtle) & compatibility with src/lib/social-secrets.server.ts
- Sockets must handle Node tls/net without external npm dependencies if possible or identify needed libraries
- Superadmin role check via requireSuperAdmin(userId)
- Passwords masked in getPlatformEmailConfig and encrypted at rest in savePlatformEmailConfig

## Current Parent
- Conversation ID: 1fd03f27-f47d-43e3-8af6-a7f340a55935
- Updated: 2026-10-09T16:50:00Z

## Investigation State
- **Explored paths**: `ORIGINAL_REQUEST.md`, `PROJECT.md`, `explorer_survey_1/report.md`, `src/lib/social-secrets.server.ts`, `tests/social-secrets.test.mjs`, `src/lib/companies.functions.ts`, `src/lib/errors.functions.ts`, `src/lib/tenant-smtp.functions.ts`, `src/lib/email-dispatch.server.ts`, `src/routes/lovable/email/auth/webhook.ts`, `supabase/migrations/`
- **Key findings**:
  1. Envelope crypto `v1:<keyId>:<iv>:<ciphertext>:<tag>` via WebCrypto `crypto.subtle` is fully established and tested (18 tests passing in 77ms).
  2. Protocol testing for SMTP (ports 465/587) and IMAP (port 993) is fully realizable without external npm packages using Node `node:net` and `node:tls` with socket line buffering.
  3. Superadmin functions require `requireSupabaseAuth` and `requireSuperAdmin` checking `profiles.staff_role === 'super_admin'`.
  4. Platform email configuration table `public.platform_email_config` is specified with RLS locked to `is_super_admin(auth.uid())`.
- **Unexplored areas**: None for M1 crypto & socket scope.

## Key Decisions Made
- `src/lib/email-crypto.server.ts` will support `EMAIL_TOKEN_ENCRYPTION_KEYS` with fallback to `SOCIAL_TOKEN_ENCRYPTION_KEYS` and `PLATFORM_ENCRYPTION_KEY`, using AAD `flas-email:v1:platform:smtp_password` / `imap_password`.
- `src/lib/email-socket-test.server.ts` will use native `node:net` and `node:tls` to avoid third-party dependencies and measure latency down to the millisecond.
- `src/lib/platform-smtp.functions.ts` masks passwords on read, encrypts on save, and supports testing stored or in-flight credentials.
- Comprehensive blueprints and test strategy documented in `report.md` and `handoff.md`.

## Artifact Index
- DISPATCH.md — incoming dispatch instructions
- BRIEFING.md — persistent situational awareness
- progress.md — liveness heartbeat
- report.md — comprehensive technical design blueprint
- handoff.md — 5-component handoff report
