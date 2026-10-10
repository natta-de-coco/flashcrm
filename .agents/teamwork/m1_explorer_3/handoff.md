# Milestone 1: Super-Admin UI & Transactional Mail Wiring — Handoff Report

**Agent**: Milestone 1 Explorer 3 (Super-Admin UI & Transactional Mail Wiring)  
**Date**: October 9, 2026  
**Status**: Complete (Hard Handoff)  
**Working Directory**: `z:\Chat Connect Pro\.agents\teamwork\m1_explorer_3\`

---

## 1. Observation

1. **Navigation Structure**:
   - In `src/routes/_authenticated/route.tsx` (line 130):
     `const sections = isSuperAdmin ? [...NAV_SECTIONS, MANAGER_SECTION] : NAV_SECTIONS;`
   - In `src/lib/navigation.ts` (lines 186–204):
     `MANAGER_SECTION` currently only contains `/companies` ("Companies") and `/companies/errors` ("Errors & issues").
   - `/companies/emails` and `/companies/subscribers` exist as routes in `src/routes/_authenticated/` but are omitted from the main navigation items.
   - `src/routes/_authenticated/companies.email-settings.tsx` does not exist yet.

2. **Manager Access Control & Server Guard**:
   - In `src/lib/companies.functions.ts` (lines 10–20):
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
   - In `src/routes/_authenticated/companies.tsx` (lines 137–145):
     ```tsx
     if (!isSuperAdmin) {
       return (
         <main className="grid flex-1 place-items-center p-6">
           <p className="text-sm text-muted-foreground">
             This area is only available to the Flas platform manager.
           </p>
         </main>
       );
     }
     ```

3. **Existing UI Design System**:
   - Verified that shadcn/ui components (`Card`, `CardContent`, `CardHeader`, `CardTitle`, `CardDescription`, `Button`, `Input`, `Label`, `Badge`, `Skeleton`, `Switch`, `Alert`, `Table`) exist in `src/components/ui/`.
   - Toast notifications utilize `sonner` (`toast.success`, `toast.error`).
   - Skeletons are used extensively across `dashboard.tsx`, `advisor.tsx`, and `contacts.tsx` for progressive loading states.

4. **Transactional Email Mechanisms**:
   - **Password recovery & OTP resend**: In `src/lib/otp-resend.functions.ts`, `resendVerification` handles `signup_verify`, `password_recovery`, and `magic_link` via `supabaseAdmin.auth.resend` and `supabaseAdmin.auth.resetPasswordForEmail`, rate-limited via `check_otp_attempt`.
   - **Auth email webhook**: In `src/routes/lovable/email/auth/webhook.ts` (lines 12–16 & 48–52):
     ```ts
     const SITE_NAME = "Flas CRM";
     const FROM_DOMAIN = "flas.mobidigisol.com";
     ...
     const handler = createAuthEmailHandler({
       apiKey: process.env["LOVABLE_API_KEY"]!,
       from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
       ...
     ```
     Sends from `noreply@flas.mobidigisol.com` instead of the mandated `flas@mobidigisol.com`.
   - **Workspace invitations**: In `src/lib/onboarding.functions.ts` (lines 177–208), `inviteStaff` inserts an invite into `team_invites`, but **never dispatches an email**. Meanwhile, `src/routes/lovable/email/auth/webhook.ts` has a fully rendered `invite` email template (`InviteEmail` from `src/lib/email-templates/invite.tsx`).
   - **Delivery logging**: In `src/lib/email-dispatch.server.ts` and `supabase/migrations/20260830000000_email_audit_otp_smtp.sql`, `log_email_delivery` records email events into `public.email_delivery_log`, visible to super-admin in `src/routes/_authenticated/companies.emails.tsx`.

---

## 2. Logic Chain

1. From Observation 1, because `route.tsx` appends `MANAGER_SECTION` only when `isSuperAdmin === true`, adding `/companies/email-settings` to `MANAGER_SECTION` in `src/lib/navigation.ts` will immediately render the link in the sidebar and Command Palette for super-admins without leaking it to standard tenant users.
2. From Observation 2, all privileged operations must check `requireSuperAdmin` both on the client route level (for immediate UX redirection) and inside server functions via `context.supabase.from("profiles").select("staff_role")`.
3. From Observation 3, the UI in `src/routes/_authenticated/companies.email-settings.tsx` can leverage existing shadcn components (`Card`, `Input`, `Button`, `Skeleton`, `Switch`, `Badge`, `Alert`) with zero external UI dependencies. Loading skeletons prevent CLS, masked inputs with show/hide toggle secure credential entry, and a callout alert enforces and explains the immutable `flas@mobidigisol.com` sender.
4. From Observation 4, transactional mail sender binding currently has two discrepancies:
   - `src/routes/lovable/email/auth/webhook.ts` dispatches from `noreply@flas.mobidigisol.com`. Updating this to `flas@mobidigisol.com` ensures that password resets and signup confirmations use the official platform sender identity.
   - `src/lib/onboarding.functions.ts` `inviteStaff` creates database invites without sending an email. Adding `supabaseAdmin.auth.admin.inviteUserByEmail` (or direct mailer dispatch) triggers the existing `invite` template in `webhook.ts` and delivers invitations from `flas@mobidigisol.com`.

---

## 3. Caveats

1. **Network mode during tests**: Server socket handshake tests (TCP ports 465, 587, 993) require outbound network connectivity to the target mail server. In strict offline/sandbox environments, socket connection timeouts must be gracefully captured and reported as diagnostic feedback rather than crashing the server.
2. **Supabase Auth Hook vs Direct SMTP Relay**: While Supabase Auth Webhook dispatches authentication emails via the HTTPS hook handler, having SMTP/IMAP credentials verified in `platform_email_config` allows future or custom direct relay dispatch if desired.
3. **Password write-only semantics**: Decrypted passwords should never be sent from server functions to the client UI. The UI only receives boolean flags (`smtpPassConfigured`, `imapPassConfigured`).

---

## 4. Conclusion

The architecture, UI blueprint, and wiring plan for Milestone 1 Super-Admin UI & Transactional Mail Wiring are complete and ready for implementation:
1. **Super-Admin Route**: `src/routes/_authenticated/companies.email-settings.tsx` with full shadcn layout, loading skeletons, masked credentials with eye toggle, locked `flas@mobidigisol.com` sender card with deliverability explanation, and instant handshake test with latency badges and step-by-step diagnostics.
2. **Navigation**: Linked via `MANAGER_SECTION` in `src/lib/navigation.ts` and accessible via subnav headers on `/companies`.
3. **Server Functions**: `getPlatformEmailConfig`, `savePlatformEmailConfig`, `testPlatformEmailConnection`, and `sendPlatformTestEmail` in `src/lib/platform-email.functions.ts`, protected by `requireSuperAdmin` and AES-256-GCM envelope encryption.
4. **Transactional Email Wiring**: 
   - `src/routes/lovable/email/auth/webhook.ts`: Update sender to `Flas CRM <flas@mobidigisol.com>`.
   - `src/lib/otp-resend.functions.ts`: Ensure password resets and OTPs pass `from_address: flas@mobidigisol.com`.
   - `src/lib/onboarding.functions.ts`: Wire `inviteStaff` to trigger invitation dispatch from `flas@mobidigisol.com`.
   - `src/lib/auth-email-audit.server.ts`: Audit `invite` alongside `signup` and `recovery`.

---

## 5. Verification Method

1. **Static Analysis & Typecheck**:
   ```bash
   npx tsc --noEmit
   ```
   Must pass with 0 errors.

2. **Build and Route Generation**:
   ```bash
   npm run build
   ```
   Confirm that TanStack Router incorporates `/_authenticated/companies/email-settings` without errors.

3. **Super-Admin Route & UI Verification**:
   - Inspect `src/routes/_authenticated/companies.email-settings.tsx`.
   - Verify non-super-admins receive manager gate or redirect.
   - Verify super-admins see loading skeletons followed by form population.
   - Verify masked password inputs show placeholder when configured, with working show/hide toggle.
   - Verify "Test Connection" button executes handshake and displays latency badge and status.

4. **Transactional Email Flow Audit**:
   - Verify password recovery request triggers delivery log with `from_address: flas@mobidigisol.com`.
   - Verify signup verification triggers delivery log with `from_address: flas@mobidigisol.com`.
   - Verify team invitation triggers invitation email from `flas@mobidigisol.com`.
