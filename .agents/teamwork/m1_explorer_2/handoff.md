# Handoff Report: Milestone 1 Server Crypto & Socket Handshake

**Agent**: Milestone 1 Explorer 2 (Server Crypto & Socket Handshake)  
**Parent Conversation ID**: `1fd03f27-f47d-43e3-8af6-a7f340a55935`  
**Handoff Type**: Hard (Task Complete)  
**Date**: October 9, 2026

---

## 1. Observation

1. **Existing WebCrypto AES-256-GCM Envelope Pattern**:
   - `src/lib/social-secrets.server.ts` (lines 1–25, 135–216) defines envelope format `v1:<keyId>:<iv>:<ciphertext>:<tag>` where IV is 12 bytes base64url and tag is 16 bytes base64url using `crypto.subtle`.
   - Uses key ring env format: `SOCIAL_TOKEN_ENCRYPTION_KEYS="k1:<base64-32-bytes>,k2:<...>"` and `SOCIAL_TOKEN_ACTIVE_KEY_ID="k1"`.
   - Binds ciphertext to context using Additional Authenticated Data (`tokenAad`).
   - Existing unit test `tests/social-secrets.test.mjs` verifies round-trip encryption, tamper rejection, fresh IVs, and key rotation via `npm run test:social-secrets`, completing 18 tests in 77ms with 0 failures.

2. **Server Function Role Guard Pattern**:
   - `src/lib/companies.functions.ts` (lines 10–20, 38, 96, 143) and `src/lib/errors.functions.ts` (lines 31–40) use the canonical guard:
     ```ts
     async function requireSuperAdmin(supabase: Client, userId: string): Promise<void> {
       const { data } = await supabase
         .from("profiles")
         .select("staff_role")
         .eq("id", userId)
         .maybeSingle();
       if (data?.staff_role !== "super_admin") {
         throw new Error("This area is only available to the Flas platform manager");
       }
     }
     ```
   - Uses `requireSupabaseAuth` middleware in TanStack Start's `createServerFn`.
   - Server-only modules (`client.server.ts`, `audit.server.ts`) are dynamically imported inside handler execution (`const { supabaseAdmin } = await import("@/integrations/supabase/client.server");`).

3. **Current Missing Components for Milestone 1**:
   - `public.platform_email_config` table does not exist in `supabase/migrations/` (latest migration is `20261008000000_business_profile_contact_fields.sql`).
   - `src/lib/email-crypto.server.ts` does not yet exist.
   - `src/lib/email-socket-test.server.ts` does not yet exist.
   - `src/lib/platform-smtp.functions.ts` does not yet exist.
   - TypeScript compilation check `npx tsc --noEmit` runs with 0 errors across the codebase.

---

## 2. Logic Chain

1. **Crypto Standardization (Step 1 -> Observation 1)**:
   - Because `src/lib/social-secrets.server.ts` already implements a zero-dependency, WebCrypto-standard envelope encryption scheme tested in Node.js and compatible with Nitro/Cloudflare Workers, `src/lib/email-crypto.server.ts` should adopt the exact same envelope structure `v1:<keyId>:<iv>:<ciphertext>:<tag>`.
   - To make it zero-friction in deployment, `readEmailKeyRing` can read `EMAIL_TOKEN_ENCRYPTION_KEYS` and fallback to `SOCIAL_TOKEN_ENCRYPTION_KEYS` or `PLATFORM_ENCRYPTION_KEY`.
   - To ensure cryptographic tenant and column isolation, AAD is computed via `emailAad(scope, field)` (`flas-email:v1:platform:smtp_password`), preventing an attacker from copying an SMTP ciphertext into the IMAP column or another tenant.

2. **Socket Handshake Testing without External Dependencies (Step 2 -> Observation 3)**:
   - Node's standard libraries `node:net` and `node:tls` provide full support for TCP connection, TLS connection, and dynamic STARTTLS socket upgrades.
   - Using `node:net` and `node:tls` directly eliminates heavy dependencies (like nodemailer or imap), keeping server functions lean and fast.
   - Buffering socket stream data into a line reader that understands SMTP multiline reply codes (`250-...` ending in `250 `) and IMAP tagged lines (`A001 OK ...`) provides accurate timing and protocol verification.

3. **Server Function Architecture (Step 3 -> Observation 2)**:
   - Exposing `getPlatformEmailConfig`, `savePlatformEmailConfig`, and `testPlatformEmailConnection` via TanStack Start `createServerFn` with `requireSupabaseAuth` and `requireSuperAdmin` guarantees platform security.
   - In `getPlatformEmailConfig`, passwords are masked (`hasSmtpPassword`, `smtpPasswordMasked: "••••••••"`), preventing credential exposure over HTTP.
   - In `savePlatformEmailConfig`, non-masked passwords are encrypted with `encryptEmailSecret` and stored in `public.platform_email_config`.
   - In `testPlatformEmailConnection`, credentials are decrypted on the server and verified via socket tests, updating `last_test_at`, `last_test_ok`, `last_test_error`, and `verified`.

---

## 3. Caveats

1. **Firewall / Network Ports in Server Environments**:
   - Outbound TCP/TLS to ports 465, 587, and 993 requires that the hosting network does not block egress SMTP/IMAP ports. If run inside a restricted container with all outbound ports blocked, the tester will return status `timeout` or `connection_refused`.
2. **Cloudflare Workers Socket Support**:
   - In Cloudflare Workers, raw TCP sockets require the `nodejs_compat` flag or Cloudflare's `connect()` API from `cloudflare:sockets`. In Node.js / Nitro, standard `node:net` and `node:tls` operate natively.
3. **Database Migration Prerequisite**:
   - `platform-smtp.functions.ts` depends on table `public.platform_email_config`. Migration `20261009100000_platform_email_config.sql` must be applied before invoking server functions against the database.

---

## 4. Conclusion

The module blueprints for Milestone 1 Server Crypto & Socket Handshake are fully designed and documented in `z:\Chat Connect Pro\.agents\teamwork\m1_explorer_2\report.md`:
1. `src/lib/email-crypto.server.ts`: Complete WebCrypto AES-256-GCM envelope utility compatible with `social-secrets.server.ts`.
2. `src/lib/email-socket-test.server.ts`: Zero-dependency SMTP and IMAP connection tester supporting ports 465, 587, and 993 with millisecond latency measurement and greeting/auth validation.
3. `src/lib/platform-smtp.functions.ts`: Super-admin guarded server functions for masked retrieval, encrypted saving, and live socket connection testing.
4. `supabase/migrations/20261009100000_platform_email_config.sql`: Database schema with `is_super_admin` RLS policy.
5. `tests/email-crypto.test.mjs` and `tests/email-socket-handshake.test.mjs`: Standalone test suite blueprint utilizing local mock servers for 100% deterministic testing.

---

## 5. Verification Method

To independently verify the planned implementation once authored:
1. **TypeScript compilation**:
   ```powershell
   npx tsc --noEmit
   ```
   *Expected result*: Exit code 0 with 0 errors.

2. **Existing Crypto Test Suite Compatibility**:
   ```powershell
   npm run test:social-secrets
   ```
   *Expected result*: 18/18 tests pass in <100ms.

3. **New Test Execution**:
   ```powershell
   node --test tests/email-crypto.test.mjs
   node --test tests/email-socket-handshake.test.mjs
   ```
   *Expected result*: All crypto round-trip, tampering, and socket handshake mock tests pass.

4. **Invalidation Conditions**:
   - If `src/lib/email-crypto.server.ts` outputs plaintext or ignores key rotation.
   - If `testSmtpSocket` hangs indefinitely on blocked ports without timing out at `timeoutMs`.
   - If `getPlatformEmailConfig` returns unmasked passwords to non-superadmin users.
