## 2026-10-09T16:51:41Z
Your identity: Milestone 1 Worker (Platform Super-Admin Email Configuration & Server Crypto)
Your working directory is: z:\Chat Connect Pro\.agents\teamwork\m1_worker_1\
The authoritative user request is located at: z:\Chat Connect Pro\.agents\teamwork\ORIGINAL_REQUEST.md
The project scope is located at: z:\Chat Connect Pro\.agents\teamwork\PROJECT.md
You MUST read both files before starting work.

Also read the 3 explorer reports for Milestone 1:
- z:\Chat Connect Pro\.agents\teamwork\m1_explorer_1\report.md (Database migration, schema, RLS)
- z:\Chat Connect Pro\.agents\teamwork\m1_explorer_2\report.md (AES-256-GCM crypto, socket handshake)
- z:\Chat Connect Pro\.agents\teamwork\m1_explorer_3\report.md (Super-admin UI, navigation, transactional mail)

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Exclusively Owned Files:
- supabase/migrations/20261009010000_platform_email_config.sql
- src/types/platform-email.ts
- src/integrations/supabase/types.ts (integrate platform_email_config)
- src/lib/email-crypto.server.ts
- src/lib/email-socket-test.server.ts
- src/lib/platform-email.functions.ts
- src/routes/_authenticated/companies.email-settings.tsx
- src/components/companies/PlatformEmailSettingsCard.tsx
- src/lib/navigation.ts (MANAGER_SECTION link)
- src/routes/lovable/email/auth/webhook.ts (ensure flas@mobidigisol.com sender)
- src/lib/otp-resend.functions.ts
- src/lib/onboarding.functions.ts
- tests/email-crypto.test.mjs
- tests/email-socket-handshake.test.mjs

Tasks:
1. Implement the database migration supabase/migrations/20261009010000_platform_email_config.sql with singleton trigger and strict is_super_admin(auth.uid()) RLS policy.
2. Implement TypeScript definitions in src/types/platform-email.ts and update src/integrations/supabase/types.ts.
3. Implement AES-256-GCM envelope encryption utility in src/lib/email-crypto.server.ts using WebCrypto API (crypto.subtle) compatible with social-secrets.server.ts format (v1:<keyId>:<iv>:<ciphertext>:<tag>) and AAD context binding.
4. Implement native socket connection handshake tester in src/lib/email-socket-test.server.ts for SMTP (ports 465/587) and IMAP (port 993) using node:net and node:tls, validating protocol greetings, STARTTLS, credentials, and measuring latency in milliseconds.
5. Implement server functions in src/lib/platform-email.functions.ts guarded by requireSuperAdmin(userId):
   - getPlatformEmailConfig (passwords masked with •••••••• and boolean flags)
   - savePlatformEmailConfig (encrypting secrets at rest via email-crypto.server.ts)
   - testPlatformEmailConnection (decrypting secrets on server and running live socket handshake test)
6. Implement the Super-Admin UI in src/routes/_authenticated/companies.email-settings.tsx and src/components/companies/PlatformEmailSettingsCard.tsx adhering to shadcn/Tailwind standards:
   - Proper loading skeletons for initial data fetch
   - Masked password inputs with eye show/hide toggle
   - Instant "Test Connection" button with latency badges and status feedback
   - Locked sender address flas@mobidigisol.com with explanation card
   - Super-admin role protection and error handling
7. Update src/lib/navigation.ts to add /companies/email-settings to MANAGER_SECTION.
8. Update transactional email sender identity in src/routes/lovable/email/auth/webhook.ts to flas@mobidigisol.com, and wire workspace invitations in src/lib/onboarding.functions.ts to invite from flas@mobidigisol.com.
9. Create tests/email-crypto.test.mjs and tests/email-socket-handshake.test.mjs to verify encryption round-trip, tampering, and socket handshake.
10. Run build and tests:
   - Execute npx tsc --noEmit to confirm 0 TypeScript compiler errors.
   - Execute npm run test:social-secrets and your new test scripts.
11. Write handoff report to z:\Chat Connect Pro\.agents\teamwork\m1_worker_1\handoff.md.
12. Notify orchestrator via send_message (conversation ID: 1fd03f27-f47d-43e3-8af6-a7f340a55935).
