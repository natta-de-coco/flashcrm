# Handoff Report: Tenant Email Marketing Settings & Multi-Tenant Security

**Agent**: Survey Explorer 2  
**Handoff Type**: Hard (Investigation complete)  
**Date**: 2026-10-09  
**Target Milestone**: Architecture & Codebase Exploration for Tenant Email Marketing Settings (R2 & RLS/Database)

---

## 1. Observation

1. **Settings Page Layout**:
   - `src/routes/_authenticated/settings.tsx` lines 48–61 renders a vertical grid of cards:
     ```tsx
     <div className="grid max-w-3xl gap-4">
       <RegionCard />
       <BillingCard />
       {isAdmin && <AuditLogCard />}
       <SecurityCard />
       <DataPrivacyCard />
       <TeamCard />
     </div>
     ```
   - All settings cards live under `src/components/settings/` (`RegionCard.tsx`, `BillingCard.tsx`, `AuditLogCard.tsx`, `SecurityCard.tsx`, `DataPrivacyCard.tsx`, `TeamCard.tsx`).
   - A subroute `src/routes/_authenticated/settings.email.tsx` exists, but is currently **not linked** from `/settings` or `src/lib/navigation.ts`.

2. **Existing Email Database Schema & Encryption**:
   - Migration `supabase/migrations/20260830000000_email_audit_otp_smtp.sql` lines 206–224 created `public.tenant_smtp_config`. It has columns: `tenant_id`, `provider`, `from_email`, `from_name`, `reply_to`, `api_key_enc`, `region`, `domain`, `verified`, `last_test_at`, `last_test_ok`, `last_test_error`.
   - Lines 225–227 explicitly revoked/granted columns to `authenticated`:
     ```sql
     GRANT SELECT (tenant_id, provider, from_email, from_name, reply_to, region, domain,
                   verified, last_test_at, last_test_ok, last_test_error, created_at, updated_at)
           ON public.tenant_smtp_config TO authenticated;
     ```
     `api_key_enc` was excluded from the client column grant, ensuring client PostgREST queries cannot select secrets.
   - Pgcrypto sym encryption is performed via `public.set_tenant_smtp_api_key(_api_key text)` and decrypted only in `public.get_tenant_smtp_api_key(_tenant_id uuid)` (lines 280–309) with `GRANT EXECUTE ... TO service_role`.
   - WebCrypto AES-256-GCM encryption is established in `src/lib/social-secrets.server.ts` using authenticated envelope format `v1:<keyId>:<iv>:<ciphertext>:<tag>` and AAD binding.
   - Currently, `tenant_smtp_config` lacks columns for raw outbound SMTP (`smtp_host`, `smtp_port`, `smtp_user`, `smtp_pass_enc`, `smtp_secure`) and inbound IMAP (`imap_host`, `imap_port`, `imap_user`, `imap_pass_enc`, `imap_secure`, `imap_enabled`).
   - Platform super-admin table `public.platform_email_config` does not yet exist; currently platform mail relies solely on static environment variables (`PLATFORM_EMAIL_PROVIDER`, `PLATFORM_EMAIL_API_KEY`, `PLATFORM_EMAIL_FROM` in `src/lib/email-dispatch.server.ts` lines 124–128).

3. **Campaign Scheduling & Missing BYO Enforcement**:
   - In `src/routes/_authenticated/marketing.tsx` lines 294–304:
     ```ts
     async function queueCampaign(id: string) {
       const { error } = await supabase
         .from("campaigns")
         .update({ status: "scheduled", scheduled_at: new Date().toISOString() })
         .eq("id", id);
       if (error) toast.error(friendlyError(error));
       else {
         toast.success("Campaign queued. It sends once your email sending domain is verified.");
         void qc.invalidateQueries({ queryKey: ["campaigns"] });
       }
     }
     ```
   - There is currently **zero check** on `tenant_smtp_config.verified` prior to updating `campaigns.status` to `"scheduled"`. Any workspace can queue a campaign regardless of whether SMTP has been connected or verified.

4. **Types & Build Validation**:
   - Running `npx tsc --noEmit` executed with code 0 (0 compilation errors).
   - In `src/integrations/supabase/types.ts` lines 810–860, `campaigns` table is typed, but `tenant_smtp_config` is currently not in `types.ts`.

---

## 2. Logic Chain

1. **Settings Integration Point**:
   - From Observation 1, the settings page is composed of independent card components mounted in `src/routes/_authenticated/settings.tsx`.
   - Therefore, the cleanest and most modular implementation of Requirement R2 is creating `src/components/settings/EmailMarketingCard.tsx` and rendering it inside `src/routes/_authenticated/settings.tsx` for `isAdmin` users.

2. **Credential Storage & Multi-Tenant Security**:
   - From Observation 2, `tenant_smtp_config` already establishes RLS scoped to `tenant_id = public.current_tenant_id()` and revokes client SELECT on encrypted columns.
   - Expanding `tenant_smtp_config` with `smtp_*` and `imap_*` columns following this exact column-level REVOKE/GRANT pattern guarantees that passwords and keys are encrypted at rest (using AES-GCM or pgcrypto) and cannot be leaked across tenants or returned over PostgREST.

3. **Strict BYO Enforcement**:
   - From Observation 3, campaigns currently transition to `"scheduled"` with no validation, violating Requirement R2 ("marketing campaigns cannot be dispatched until the company has connected and verified its own active SMTP server").
   - By creating a database trigger `trg_enforce_campaign_byo_smtp` on `public.campaigns` preventing transitions to `scheduled`, `sending`, or `in_progress` unless `tenant_smtp_config.verified = true`, coupled with application-level UI gates (disabled buttons and warning banners), strict BYO enforcement is guaranteed even against direct API manipulation.

4. **Domain Verification Guide**:
   - Outbound deliverability requires SPF and DKIM DNS records matching the tenant's domain.
   - Providing SPF, DKIM, and DMARC copyable DNS records in `EmailMarketingCard`, with automated verification checks via DNS-over-HTTPS (DoH), satisfies Requirement R2 without adding heavy external dependencies.

---

## 3. Caveats

- **Runtime Networking**: The application runs on TanStack Start / Cloudflare Worker / serverless edge. Raw TCP sockets on ports 25/465/587 may require an HTTP relay (e.g., SMTP2GO, Resend, SendGrid) or Node runtime depending on hosting environment. Supporting both standard SMTP and HTTP relay APIs in `EmailMarketingCard` ensures universal compatibility.
- **IMAP Polling Daemon**: IMAP inbox reply detection requires an event or periodic scheduled worker to check unread replies. The database schema and settings configuration are fully prepared to store IMAP credentials, while the background poller can run as a scheduled edge job.

---

## 4. Conclusion

1. Implement `src/components/settings/EmailMarketingCard.tsx` and integrate it into `src/routes/_authenticated/settings.tsx`.
2. Apply migration `20261009000000_tenant_byo_smtp_imap.sql` to add SMTP/IMAP credentials, SPF/DKIM verification fields, the campaign BYO enforcement database trigger, and the `platform_email_config` table for super admin transactional email.
3. Update `src/lib/tenant-smtp.functions.ts` to support SMTP/IMAP saving, testing, and encryption.
4. Gate campaign creation and dispatch in `src/routes/_authenticated/marketing.tsx` based on `tenant_smtp_config.verified`.

---

## 5. Verification Method

To verify the exploration findings and subsequent implementation:
1. **Type Checking**:
   ```bash
   npx tsc --noEmit
   ```
   Must pass with 0 errors.
2. **Settings Page Inspection**:
   - Inspect `src/routes/_authenticated/settings.tsx` to verify `<EmailMarketingCard />` renders for workspace admins.
3. **RLS Verification**:
   - Verify non-admin or cross-tenant users cannot query another workspace's `tenant_smtp_config` rows or secret columns.
4. **BYO Enforcement Verification**:
   - Attempting to update `campaigns.status` to `'scheduled'` or `'sending'` on a workspace with `verified: false` must be blocked by the PostgreSQL trigger and return an informative error.
