# Comprehensive Exploration Report: Tenant Email Marketing Settings & RLS/Database Architecture

**Agent**: Survey Explorer 2  
**Date**: 2026-10-09  
**Target Project**: Flas CRM (`z:\Chat Connect Pro`)  
**Scope**: Workspace Settings (`/settings`), Tenant BYO SMTP/IMAP Setup, Database Schemas & Migrations, Encryption at Rest, RLS Multi-Tenant Security, Strict BYO Enforcement, Sender Identity & Domain Verification Guides.

---

## Executive Summary

Flas CRM is built on **TanStack Start** (React 19, TanStack Router with code-splitting, TanStack Query v5) coupled with **Supabase PostgreSQL** as the multi-tenant database engine.
The codebase already contains partial foundational infrastructure for email logging and HTTP provider configuration (`tenant_smtp_config` and `email_delivery_log` from migration `20260830000000_email_audit_otp_smtp.sql`), but lacks:
1. A dedicated **Email Marketing Setup** card on the main `/settings` page (`src/routes/_authenticated/settings.tsx`).
2. Support for standard **SMTP host/port/credentials** and inbound **IMAP** (reply detection and tracking).
3. Strict **BYO enforcement** in marketing campaign dispatch (campaigns currently queue directly without verifying tenant SMTP).
4. A **Platform Super-Admin Email Configuration** table/panel for system transactional emails (`flas@mobidigisol.com`).
5. A comprehensive **Domain SPF/DKIM/DMARC verification guide** and sender identity UI for tenant branding.

This report provides the complete architecture, exact file locations, schema definitions, RLS policies, and implementation specifications needed to implement Requirement R2 and its security controls.

---

## 1. Workspace Settings Architecture & Integration Points

### 1.1 Existing Route Structure
- **TanStack Router Settings Route**: `src/routes/_authenticated/settings.tsx`
  - URL Path: `/settings`
  - Renders workspace-level preferences:
    - `RegionCard` (`src/components/settings/RegionCard.tsx`)
    - `BillingCard` (`src/components/settings/BillingCard.tsx`)
    - `AuditLogCard` (`src/components/settings/AuditLogCard.tsx`, admin only)
    - `SecurityCard` (`src/components/settings/SecurityCard.tsx`)
    - `DataPrivacyCard` (`src/components/settings/DataPrivacyCard.tsx`)
    - `TeamCard` (`src/components/settings/TeamCard.tsx`)
- **Existing Sub-Route**: `src/routes/_authenticated/settings.email.tsx`
  - URL Path: `/settings/email`
  - Previously created for HTTP-based provider setup (Resend, Mailgun, SendGrid, Postmark, SES, SMTP relay) with `tenant-smtp.functions.ts`.
  - **Critical Finding**: Currently, `/settings/email` is an isolated route that is **not linked anywhere** from `/settings` or `src/lib/navigation.ts`.
- **Navigation Configuration**: `src/lib/navigation.ts` (lines 176–181)
  - `/settings` is listed under the "System" section with keywords `"settings billing team security data profile account subscription"`.
  - `/companies` (lines 186–204) is listed under the "Manager" section for super admins.

### 1.2 Dedicated Email Marketing Setup Card Integration
The new component **`EmailMarketingCard.tsx`** should be created under `src/components/settings/EmailMarketingCard.tsx` and imported into `src/routes/_authenticated/settings.tsx`.

#### Placement in `src/routes/_authenticated/settings.tsx`:
```tsx
// src/routes/_authenticated/settings.tsx (lines 48-61)
<div className="grid max-w-3xl gap-4">
  <RegionCard />
  <BillingCard />
  
  {/* Dedicated BYO Email Marketing Setup Card */}
  {isAdmin && <EmailMarketingCard />}

  {isAdmin && <AuditLogCard />}
  <SecurityCard />
  <DataPrivacyCard />
  <TeamCard />
</div>
```

#### Responsibilities of `EmailMarketingCard`:
1. **At-a-Glance Status Banner**:
   - Displays whether outbound sending is `Active & Verified` (Green Badge) vs. `Not Connected / Action Required` (Amber/Red Badge).
   - Clear BYO status indicator: `Campaign Dispatch: Enabled` or `Campaign Dispatch: Blocked (Verify SMTP)`.
2. **Sender Identity Section**:
   - `From Name` (e.g., "Acme Sales")
   - `From Email` (e.g., `deals@acme.com`)
   - `Reply-To Address` (e.g., `support@acme.com`)
3. **Outbound SMTP Configuration**:
   - Toggle between **Custom SMTP Server** (Host, Port, Encryption: TLS/SSL/STARTTLS, Username, Password) and **Cloud API Provider** (Resend, SendGrid, Mailgun, Postmark, AWS SES).
4. **Inbound IMAP Configuration**:
   - Inbound IMAP Host, Port (default 993), Username, Password, SSL enabled.
   - Purpose: Automatic detection of customer replies to marketing campaigns, routing replies to the CRM Inbox (`/inbox`).
5. **Interactive Handshake & Test Connection Button**:
   - Instant "Test Connection" button with recipient email input.
   - Performs live server handshake and credentials check, reporting clear success or error messages.
6. **Domain SPF/DKIM/DMARC Verification Guide**:
   - Collapsible DNS setup guide tailored to the tenant's sending domain.
   - Step-by-step TXT and CNAME records with one-click copy buttons.
   - Live DNS check button querying DNS-over-HTTPS (DoH).

---

## 2. Multi-Tenant Security, Credential Storage & Encryption at Rest

### 2.1 Existing Database Foundation
1. **Tenant Isolation Core**:
   - Organizations table: `public.organizations` (Primary tenant entity).
   - User profiles: `public.profiles` (`tenant_id uuid REFERENCES organizations(id)`, `staff_role staff_role`).
   - Session context: `public.current_tenant_id()` returns the calling user's tenant UUID.
   - Role verification: `public.has_role(auth.uid(), 'admin')` and `public.is_super_admin(auth.uid())`.
2. **Existing Migration**: `supabase/migrations/20260830000000_email_audit_otp_smtp.sql`
   - Defines `public.tenant_smtp_config` with columns:
     `tenant_id`, `provider`, `from_email`, `from_name`, `reply_to`, `api_key_enc` (bytea), `region`, `domain`, `webhook_secret`, `verified`, `last_test_at`, `last_test_ok`, `last_test_error`, `created_by`, `created_at`, `updated_at`.
   - Security pattern:
     - `REVOKE SELECT ON public.tenant_smtp_config FROM authenticated;`
     - Explicit column `GRANT SELECT (tenant_id, provider, from_email, from_name, reply_to, region, domain, verified, last_test_at, last_test_ok, last_test_error, created_at, updated_at) ON public.tenant_smtp_config TO authenticated;`
     - **`api_key_enc` is excluded from the client column grant!** Clients cannot query raw or encrypted secrets through PostgREST.

### 2.2 Proposed Migration: Enhancing `tenant_smtp_config` for SMTP + IMAP + BYO
To satisfy Requirement R2 and the multi-tenant isolation acceptance criteria:

```sql
-- Migration: Add SMTP, IMAP, and Domain verification columns to tenant_smtp_config
ALTER TABLE public.tenant_smtp_config
  ADD COLUMN IF NOT EXISTS smtp_host text,
  ADD COLUMN IF NOT EXISTS smtp_port integer DEFAULT 587,
  ADD COLUMN IF NOT EXISTS smtp_user text,
  ADD COLUMN IF NOT EXISTS smtp_pass_enc bytea,
  ADD COLUMN IF NOT EXISTS smtp_secure text DEFAULT 'tls' CHECK (smtp_secure IN ('tls', 'ssl', 'starttls', 'none')),
  ADD COLUMN IF NOT EXISTS imap_host text,
  ADD COLUMN IF NOT EXISTS imap_port integer DEFAULT 993,
  ADD COLUMN IF NOT EXISTS imap_user text,
  ADD COLUMN IF NOT EXISTS imap_pass_enc bytea,
  ADD COLUMN IF NOT EXISTS imap_secure boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS imap_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS imap_last_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS imap_last_sync_status text,
  ADD COLUMN IF NOT EXISTS sending_domain text,
  ADD COLUMN IF NOT EXISTS spf_status text DEFAULT 'pending' CHECK (spf_status IN ('pending', 'verified', 'failed')),
  ADD COLUMN IF NOT EXISTS dkim_status text DEFAULT 'pending' CHECK (dkim_status IN ('pending', 'verified', 'failed')),
  ADD COLUMN IF NOT EXISTS dmarc_status text DEFAULT 'pending' CHECK (dmarc_status IN ('pending', 'verified', 'failed')),
  ADD COLUMN IF NOT EXISTS verified_at timestamptz;

-- Re-assert column-level security so passwords can NEVER be read by authenticated clients
REVOKE SELECT ON public.tenant_smtp_config FROM authenticated;
GRANT SELECT (
  tenant_id, provider, from_email, from_name, reply_to,
  smtp_host, smtp_port, smtp_user, smtp_secure,
  imap_host, imap_port, imap_user, imap_secure, imap_enabled, imap_last_sync_at, imap_last_sync_status,
  region, domain, sending_domain, spf_status, dkim_status, dmarc_status,
  verified, verified_at, last_test_at, last_test_ok, last_test_error,
  created_at, updated_at
) ON public.tenant_smtp_config TO authenticated;
```

### 2.3 Encryption at Rest Architecture
There are two complementary encryption approaches in the codebase:

1. **PostgreSQL `pgcrypto` (`pgp_sym_encrypt` / `pgp_sym_decrypt`)**:
   - Used in `20260830000000_email_audit_otp_smtp.sql` via `_smtp_encryption_key()`.
   - Keys are retrieved from Supabase Vault (`vault.decrypted_secrets WHERE name = 'tenant_smtp_key'`) or Postgres GUC `app.tenant_smtp_key`.
   - RPCs:
     - `set_tenant_smtp_credentials(_smtp_pass text, _imap_pass text)`: encrypts passwords and stores in `smtp_pass_enc` and `imap_pass_enc`.
     - `get_tenant_smtp_credentials(_tenant_id uuid)`: executable **only** by `service_role`.
2. **Server-Side AES-256-GCM via WebCrypto (`src/lib/social-secrets.server.ts`)**:
   - Uses WebCrypto `crypto.subtle.encrypt` with authenticated envelope format: `v1:<keyId>:<iv>:<ciphertext>:<tag>`.
   - Additional Authenticated Data (AAD) binds the ciphertext to the tenant:
     `flas-email:v1:${tenantId}:${field}`.
   - Any attempt to copy a ciphertext from one tenant to another or between fields causes authentication tag failure.

### 2.4 Row-Level Security (RLS) Isolation
Strict RLS policies ensure cross-tenant data leakage is impossible:

```sql
-- Read policy: Only company admins within the same tenant or platform super-admins
CREATE POLICY "tenant_smtp_config_select_admin" ON public.tenant_smtp_config
  FOR SELECT TO authenticated
  USING (
    (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'))
    OR public.is_super_admin(auth.uid())
  );

-- Write policy: Strictly restricted to the company admin of the owning tenant
CREATE POLICY "tenant_smtp_config_modify_admin" ON public.tenant_smtp_config
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'));
```

---

## 3. Strict BYO Enforcement Engine

### 3.1 The Problem in Existing Code
In `src/routes/_authenticated/marketing.tsx` (lines 294–304):
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
**Vulnerability**: No check is performed against `tenant_smtp_config.verified`! A tenant without an active, verified SMTP configuration can set campaigns to `scheduled` or attempt sending.

### 3.2 Dual-Layer BYO Enforcement Design

#### Layer 1: PostgreSQL Trigger Constraint (Database Level)
Enforces BYO at the database engine level so that no client or API can bypass verification:

```sql
CREATE OR REPLACE FUNCTION public.enforce_tenant_byo_smtp_on_campaign()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  _is_verified boolean;
BEGIN
  -- If attempting to schedule, send, or dispatch a campaign
  IF NEW.status IN ('scheduled', 'sending', 'in_progress') THEN
    SELECT verified INTO _is_verified
      FROM public.tenant_smtp_config
     WHERE tenant_id = NEW.tenant_id
       AND verified = true
       AND last_test_ok = true;

    IF _is_verified IS NOT TRUE THEN
      RAISE EXCEPTION 'BYO SMTP Enforcement: Marketing campaigns cannot be scheduled or dispatched without an active, verified tenant SMTP server. Please configure and test your outbound email in Settings -> Email Marketing.';
    END IF;
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_enforce_campaign_byo_smtp ON public.campaigns;
CREATE TRIGGER trg_enforce_campaign_byo_smtp
  BEFORE INSERT OR UPDATE OF status ON public.campaigns
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_tenant_byo_smtp_on_campaign();
```

#### Layer 2: Server Function & UI Pre-Flight Check (Application Level)
1. **Server Function Check** (`src/lib/campaigns.server.ts` or `marketing.functions.ts`):
   ```ts
   export const scheduleCampaign = createServerFn({ method: "POST" })
     .middleware([requireSupabaseAuth])
     .handler(async ({ data, context }) => {
       const tenantId = await getTenantId(context);
       const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
       const { data: smtp } = await supabaseAdmin
         .from("tenant_smtp_config")
         .select("verified, last_test_ok, provider")
         .eq("tenant_id", tenantId)
         .maybeSingle();

       if (!smtp || !smtp.verified || !smtp.last_test_ok) {
         throw new Error(
           "Campaign dispatch blocked: Your workspace has not verified an active outbound email server. Configure your SMTP in Settings → Email Marketing."
         );
       }
       // Proceed with scheduling...
     });
   ```
2. **UI Enforcement** (in `MarketingPage` / Campaign Board):
   - Query `tenant_smtp_config` verification status.
   - If `!smtpConfig?.verified`:
     - Render warning banner: *"Outbound SMTP unverified. Campaign scheduling and sending is disabled until credentials are confirmed."*
     - "Schedule" and "Send" buttons disabled with tooltip explaining the requirement.
     - Direct CTA: *"Configure Email Marketing"* linking to `/settings`.

### 3.3 Verification State Transition Rules
- When any connection field (`smtp_host`, `smtp_port`, `smtp_user`, `smtp_pass`, `provider`, `api_key`) is updated:
  `verified` is **immediately set to `false`**.
- `verified` is set to `true` **only** upon successful completion of the "Test Connection" handshake (`testTenantSmtp` server function returning `{ ok: true }`).

---

## 4. UI Specification: Sender Identity & Domain SPF/DKIM Guide

### 4.1 Sender Identity Form Fields
Located inside `EmailMarketingCard`:
- **Sender Display Name**: e.g., `Northline Trading Deals`
- **Sender / From Email**: e.g., `newsletter@northlinetrading.com`
- **Reply-To Email**: e.g., `support@northlinetrading.com`
- **Sending Domain**: automatically extracted from `From Email` (or custom subdomain e.g. `mail.northlinetrading.com`).

### 4.2 SPF / DKIM / DMARC DNS Verification Guide
To maximize inbox deliverability and prevent spam classification, the UI provides a structured DNS setup guide:

| Record Type | Host / Name | Recommended Value | Purpose |
| :--- | :--- | :--- | :--- |
| **TXT (SPF)** | `@` (or subdomain) | `v=spf1 include:_spf.yourrelay.com ~all` | Authorizes outbound mail servers |
| **CNAME / TXT (DKIM)** | `flas._domainkey` | `k=rsa; p=MIGfMA0GCSqGSIb3...` (or CNAME pointer) | Cryptographic signature of email headers |
| **TXT (DMARC)** | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com` | Domain-based message authentication policy |

#### UI Features for the Guide:
1. **One-Click Copy**: Copy button for both Record Name and Value.
2. **Provider Instructions**: Accordion instructions for Cloudflare, GoDaddy, Namecheap, Google Domains/Squarespace, and AWS Route 53.
3. **Verify DNS Button**: Performs real-time DNS lookup via Cloudflare DNS-over-HTTPS (`https://cloudflare-dns.com/dns-query?name=${domain}&type=TXT`), comparing returned records against expected values and updating badges (`Verified` / `Pending` / `Failed`).

---

## 5. Platform Super-Admin Email Configuration (Requirement R1 Architecture)

### 5.1 Requirement R1 Context
Platform transactional emails (password reset links, OTP verification emails, and workspace invitations) must be sent from `flas@mobidigisol.com`. Credentials must be manageable by `super_admin` in `/companies` or `/settings` and encrypted at rest with AES-GCM.

### 5.2 Proposed Table: `public.platform_email_config`
```sql
CREATE TABLE IF NOT EXISTS public.platform_email_config (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_email      text NOT NULL DEFAULT 'flas@mobidigisol.com',
  from_name       text NOT NULL DEFAULT 'Flas CRM Platform',
  reply_to        text DEFAULT 'support@mobidigisol.com',
  provider        text NOT NULL DEFAULT 'smtp' CHECK (provider IN ('smtp', 'resend', 'sendgrid', 'mailgun', 'ses')),
  smtp_host       text,
  smtp_port       integer DEFAULT 587,
  smtp_user       text,
  smtp_pass_enc   bytea,
  smtp_secure     text DEFAULT 'tls',
  imap_host       text,
  imap_port       integer DEFAULT 993,
  imap_user       text,
  imap_pass_enc   bytea,
  imap_secure     boolean DEFAULT true,
  api_key_enc     bytea,
  verified        boolean NOT NULL DEFAULT false,
  last_test_at    timestamptz,
  last_test_ok    boolean,
  last_test_error text,
  updated_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON public.platform_email_config FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.platform_email_config TO service_role;

ALTER TABLE public.platform_email_config ENABLE ROW LEVEL SECURITY;

-- Accessible EXCLUSIVELY by platform super admins
CREATE POLICY "platform_email_super_admin_all" ON public.platform_email_config
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));
```

---

## 6. Existing Files, Models, and Helper Hook Catalog

| File Path | Role & Existing Functionality | Required Enhancement / Integration |
| :--- | :--- | :--- |
| `src/routes/_authenticated/settings.tsx` | Main workspace settings page | Mount `<EmailMarketingCard />` inside the card grid |
| `src/components/settings/EmailMarketingCard.tsx` | *To be created* | Dedicated UI for BYO SMTP/IMAP, sender identity, verification status, DNS guide |
| `src/routes/_authenticated/settings.email.tsx` | Dedicated email settings route | Update to support full SMTP + IMAP fields, or route directly to/from settings |
| `src/lib/tenant-smtp.functions.ts` | Server functions for reading/saving SMTP config | Extend schemas and handlers to accept `smtp_host`, `smtp_port`, `smtp_user`, `smtp_pass`, `imap_*`, sender fields, and test connection |
| `src/lib/email-dispatch.server.ts` | Server-side email sender | Integrate tenant SMTP dispatch alongside HTTP providers; enforce verified status |
| `src/routes/_authenticated/marketing.tsx` | Marketing campaigns & leads route | Add BYO SMTP check before allowing campaign scheduling/dispatch; display status banner |
| `src/routes/_authenticated/companies.emails.tsx` | Super admin email delivery log | Add Super Admin Platform Email Configuration tab/card for `flas@mobidigisol.com` |
| `src/integrations/supabase/types.ts` | Supabase TypeScript types | Add typing for updated `tenant_smtp_config` and `platform_email_config` |
| `supabase/migrations/` | Database migrations directory | Add migration for SMTP/IMAP columns, trigger enforcement, and platform email config |

---

## 7. Concrete Next Steps & Recommendations for Implementation

1. **Database Migration**:
   - Write idempotent migration `20261009000000_tenant_byo_smtp_imap.sql` adding SMTP/IMAP fields to `tenant_smtp_config`.
   - Add the `check_campaign_tenant_smtp` trigger on `public.campaigns`.
   - Create `public.platform_email_config` with super-admin-only RLS.
2. **Server Functions & Crypto**:
   - Extend `src/lib/tenant-smtp.functions.ts` with inputs for SMTP and IMAP credentials.
   - Add `testTenantSmtpConnection` that performs live handshake validation.
3. **UI Implementation**:
   - Create `src/components/settings/EmailMarketingCard.tsx` following shadcn/Tailwind design.
   - Mount `<EmailMarketingCard />` in `src/routes/_authenticated/settings.tsx`.
   - Add SPF/DKIM verification guide with DoH checking.
4. **Campaign Dispatch Gate**:
   - Update `src/routes/_authenticated/marketing.tsx` to verify `tenant_smtp_config.verified` before enabling scheduling or dispatch.
