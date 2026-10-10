# Handoff Report — Explorer Survey 1 (Platform Super-Admin & Auth/Security)

**Date**: 2026-10-09T16:37:00Z  
**Agent**: Survey Explorer 1 (Platform Super-Admin & Auth/Security)  
**Type**: Hard Handoff (Investigation & Architecture Survey Complete)  
**Reference Document**: `z:\Chat Connect Pro\.agents\teamwork\explorer_survey_1\report.md`  

---

## 1. Observation

1. **Routing and Shell Architecture**:
   - `src/routes/_authenticated/route.tsx` (lines 120–131): Navigation sidebar is conditionally expanded for platform managers:
     ```ts
     const { session, loading, signOut, user, isSuperAdmin } = useAuth();
     const sections = isSuperAdmin ? [...NAV_SECTIONS, MANAGER_SECTION] : NAV_SECTIONS;
     ```
   - `src/lib/navigation.ts` (lines 186–204): `MANAGER_SECTION` currently exposes `/companies` ("Companies") and `/companies/errors` ("Errors & issues").
   - Existing Super Admin routes in `src/routes/_authenticated/`:
     - `companies.tsx`: Main manager portal (lines 53–56: `isSuperAdmin` guard, presence view, plan health thresholds, paid-until date, suspend/unsuspend).
     - `companies.$orgId.tsx`: Read-only troubleshooting view.
     - `companies.subscribers.tsx`: Full subscriber view backed by `supabase.rpc("list_subscribers")`.
     - `companies.emails.tsx`: Global email delivery log across all tenants (`email_delivery_log` and `otp_attempts`).
     - `companies.errors.tsx`: Platform-wide incident tracker.
   - Settings routes in `src/routes/_authenticated/`:
     - `settings.tsx`: Workspace preferences rendering `RegionCard`, `BillingCard`, `AuditLogCard`, `SecurityCard`, `DataPrivacyCard`, `TeamCard`.
     - `settings.email.tsx`: Outbound provider picker for individual tenants (`tenant_smtp_config`).

2. **Role Checking & Immutability**:
   - `src/lib/permissions.ts` (line 15): `StaffRole = "super_admin" | "company_admin" | "marketing_manager" | "staff" | "seo_editor"`.
   - `src/hooks/useAuth.tsx` (lines 62–68): `supabase.from("profiles").select("staff_role").eq("id", userId).maybeSingle().then(({ data }) => { if (active) setIsSuperAdmin(data?.staff_role === "super_admin"); });`.
   - `src/lib/companies.functions.ts` (lines 11–20):
     ```ts
     async function requireSuperAdmin(supabase: Client, userId: string): Promise<void> {
       const { data } = await supabase.from("profiles").select("staff_role").eq("id", userId).maybeSingle();
       if (data?.staff_role !== "super_admin") {
         throw new Error("This area is only available to the Flas platform manager");
       }
     }
     ```
   - Migration `20260830010000_super_admin_lockdown_and_oauth_reliability.sql` (lines 21–120): Table `public.platform_super_admins` holds seed email `moobbi@yahoo.com`. Triggers `platform_super_admins_guard_delete`, `platform_super_admins_guard_update`, `profiles_guard_super_admin_delete`, and `profiles_guard_super_admin_downgrade` prevent deletion or downgrading of super-admin accounts.
   - Migration `20260827154801_fbabe091-fd2c-4adc-b995-efdf2148f18f.sql` (lines 21–27): Declares `public.is_super_admin(_user uuid DEFAULT auth.uid())`.

3. **Encryption at Rest in Codebase**:
   - `src/lib/social-secrets.server.ts` (lines 1–233): WebCrypto API (`crypto.subtle`) AES-256-GCM authenticated secret-box implementation with envelope `v1:<keyId>:<iv>:<ciphertext>:<tag>`, environment key ring (`SOCIAL_TOKEN_ENCRYPTION_KEYS`, `SOCIAL_TOKEN_ACTIVE_KEY_ID`), and Additional Authenticated Data (`tokenAad`). Pure WebCrypto, zero native dependencies, compatible with Node.js and Cloudflare Workers.
   - `supabase/migrations/20260830000000_email_audit_otp_smtp.sql` (lines 204–311): Uses `pgcrypto` (`pgp_sym_encrypt`/`pgp_sym_decrypt`) with Vault secret `tenant_smtp_key` to encrypt `tenant_smtp_config.api_key_enc`. `api_key_enc` is revoked from `authenticated` SELECT grants.

4. **Transactional Email Pipeline**:
   - `src/routes/lovable/email/auth/webhook.ts` (lines 42–136): Supabase Auth webhook route utilizing `@lovable.dev/email-js` `createAuthEmailHandler` with React Email templates: `SignupEmail` (`signup.tsx`), `InviteEmail` (`invite.tsx`), `MagicLinkEmail` (`magic-link.tsx`), `RecoveryEmail` (`recovery.tsx`), `EmailChangeEmail` (`email-change.tsx`), `ReauthenticationEmail` (`reauthentication.tsx`).
   - Current sender configuration hardcoded in `webhook.ts`: `from: "Flas CRM <noreply@flas.mobidigisol.com>"`.
   - `src/lib/otp-resend.functions.ts` (lines 100–120): `resendVerification` dispatches `supabaseAdmin.auth.resend({ type: 'signup' })`, `supabaseAdmin.auth.resetPasswordForEmail()`, or `signInWithOtp()`, and records events via `log_email_delivery`. Rate-limited via DB RPC `check_otp_attempt`.
   - `src/lib/email-dispatch.server.ts` (lines 99–151): `sendTenantEmail()` checks tenant provider, falls back to `PLATFORM_EMAIL_PROVIDER`, `PLATFORM_EMAIL_API_KEY`, `PLATFORM_EMAIL_FROM`.
   - `src/lib/onboarding.functions.ts` (lines 177–208): `inviteStaff()` inserts into `team_invites` table.

5. **Current Gap for Platform Super-Admin Email**:
   - No `platform_email_config` table exists in PostgreSQL.
   - No UI panel exists for configuring platform SMTP/IMAP credentials for `flas@mobidigisol.com`.
   - No SMTP/IMAP socket handshake tester exists in the project.

---

## 2. Logic Chain

1. **Access Control**: Because `useAuth()` derives `isSuperAdmin` from `profiles.staff_role === "super_admin"`, and database RPC `is_super_admin()` checks the exact same column protected by database downgrade triggers, restricting new platform email configuration tables and routes to `super_admin` will guarantee that standard tenants cannot read or write platform settings (Observations 1, 2).
2. **Encryption Architecture**: Because `src/lib/social-secrets.server.ts` already implements a robust, audited AES-256-GCM envelope format using native WebCrypto API that runs in both Node.js and Edge/Workers, replicating this pattern for platform credentials (`smtp_password_enc`, `imap_password_enc`) guarantees encrypted storage at rest without requiring database superuser privileges or external native dependencies (Observation 3).
3. **Database Security**: Creating `public.platform_email_config` with RLS policy `USING (public.is_super_admin(auth.uid()))` and granting access only to `authenticated` (filtered by policy) and `service_role` ensures tenant isolation at the database engine level (Observations 1, 2, 5).
4. **Handshake Verification**: Because TanStack Start server functions run in a Node/Nitro environment with access to native `node:tls` and `node:net`, an instant "Test Connection" button can open direct TCP/TLS connections to SMTP (ports 465/587) and IMAP (port 993) to perform protocol-level EHLO/LOGIN handshakes and return latency and status back to the UI (Observations 1, 5).
5. **Sender Identity**: System transactional emails (recovery, OTP, invites) require sender identity `flas@mobidigisol.com`, which directly maps to the configuration fields to be managed in the platform Super-Admin settings panel (Observation 4).

---

## 3. Caveats

1. **Serverless Outbound TCP Ports**: Cloudflare Workers standard fetch does not allow raw TCP sockets without `cloudflare:sockets` `connect()`. In Node.js / Nitro server environments (where the server functions currently execute), `node:net` and `node:tls` work directly. If deploying to Cloudflare Workers, handshake testing must import `connect` from `cloudflare:sockets`.
2. **Supabase Auth Hook vs. Custom SMTP**: Supabase Auth handles system emails (resets, OTPs) via either the Auth Webhook (`src/routes/lovable/email/auth/webhook.ts`) or Supabase Dashboard SMTP settings. Changing the platform sender in Flas CRM requires updating the webhook sender header or configuring the SMTP transport in the backend.
3. **Existing Unapplied Migrations**: `CLAUDE.md` noted two migrations (`20260901000000` and `20260901010000`) were written but might need application in fresh databases; any new migration should be sequenced cleanly after the latest migration (`20261008000000_business_profile_contact_fields.sql`).

---

## 4. Conclusion

The Flas CRM codebase possesses all the necessary architectural foundations (strict `super_admin` role guards, TanStack Start server functions, WebCrypto AES-GCM encryption utilities, and shadcn/Tailwind UI patterns) to cleanly implement the Platform Super-Admin Email Configuration:
1. **Database**: A migration creating `public.platform_email_config` with `is_super_admin()` RLS policy.
2. **Crypto**: A server-side AES-256-GCM encryption utility for credentials at rest.
3. **Tester**: An SMTP/IMAP protocol handshake tester validating connections and credentials on ports 465/587 and 993.
4. **Server Functions**: Guarded by `requireSuperAdmin()`, handling get, save (with encryption), and test connection.
5. **UI**: A dedicated management card in `/companies` or `/companies/email-settings` following existing shadcn card/table patterns.

---

## 5. Verification Method

To independently verify the findings and existing architecture:
1. **Inspect Super-Admin Guard**:
   - View `src/lib/companies.functions.ts` lines 10–33.
   - View `src/routes/_authenticated/route.tsx` lines 120–135.
2. **Inspect Existing AES-256-GCM Implementation**:
   - View `src/lib/social-secrets.server.ts` lines 70–215.
   - Run existing crypto tests:
     ```powershell
     npm run test:social-secrets
     ```
3. **Inspect Super-Admin Immutability Triggers**:
   - View `supabase/migrations/20260830010000_super_admin_lockdown_and_oauth_reliability.sql` lines 20–120.
4. **Inspect Transactional Email Webhook**:
   - View `src/routes/lovable/email/auth/webhook.ts` lines 40–107.
5. **Compile Project**:
   - Verify zero TypeScript compiler errors:
     ```powershell
     npx tsc --noEmit
     ```
