# Flas CRM — Platform Super-Admin & Auth/Security Architecture Survey

**Investigator**: Survey Explorer 1 (Platform Super-Admin & Auth/Security)  
**Date**: October 9, 2026  
**Status**: Complete  
**Scope**: Platform architecture, Super-Admin portal, authentication/security mechanisms, encryption at rest, transactional email infrastructure, SMTP/IMAP handshake testing, database schemas, and RLS policies.

---

## 1. Executive Summary & Architecture Overview

Flas CRM (Chat Connect Pro) is a multi-tenant CRM built on **TanStack Start** (React 19 + TypeScript + Vite + Nitro server runtime) backed by **Supabase (PostgreSQL 14.5 + GoTrue Auth)** and integrated with Paddle for billing and Lovable for deployment and sync.

The codebase currently runs on a unified server/client model where:
- **Client Application**: Driven by `@tanstack/react-router` with route tree generated in `src/routeTree.gen.ts`.
- **Server Execution**: TanStack Start server functions (`createServerFn`) and API route handlers (`createFileRoute('/api/...')`) executed via Nitro.
- **Data & Auth Layer**: Supabase with two distinct client tiers:
  1. `src/integrations/supabase/client.ts`: User-scoped client respecting PostgreSQL Row-Level Security (RLS).
  2. `src/integrations/supabase/client.server.ts`: Privileged `supabaseAdmin` client utilizing `SUPABASE_SERVICE_ROLE_KEY` (strictly server-side, bypasses RLS for trusted operational paths).

### Dual-Tier Email Infrastructure Context
The platform requires a clear architectural separation between:
1. **Platform Super-Admin Infrastructure (Tier 1)**: System operations (password reset links, signup OTPs, workspace invitations) originating exclusively from `flas@mobidigisol.com`, configured via an administrative portal accessible solely to `super_admin`.
2. **Tenant BYO Email Marketing Infrastructure (Tier 2)**: Company-specific email marketing campaigns in Settings (`/settings`), strictly requiring each tenant to bring and verify their own SMTP/IMAP credentials before campaign dispatch.

---

## 2. Super Admin Management & Roles Infrastructure

### 2.1 Route Structure & Navigation

In this project, routes are defined using TanStack Start's file-based routing inside `src/routes/`:
- `src/routes/_authenticated/route.tsx`: The primary authenticated layout shell.
  - Controls desktop sidebar (`<aside>`) and mobile drawer (`<Sheet>`).
  - Gated by `useAuth()` (`isSuperAdmin`, `isAdmin`, `user`, `session`).
  - Line 130: `const sections = isSuperAdmin ? [...NAV_SECTIONS, MANAGER_SECTION] : NAV_SECTIONS;`
  - Injects `MANAGER_SECTION` into the sidebar exclusively for users where `isSuperAdmin === true`.
- `src/lib/navigation.ts`:
  - Contains navigation definitions (`NAV_SECTIONS` and `MANAGER_SECTION`).
  - `MANAGER_SECTION` currently declares:
    - `/companies`: "Companies" (`Building2` icon) — workspace overview.
    - `/companies/errors`: "Errors & issues" (`Bug` icon) — customer issue tracker.
- Existing Super-Admin Routes:
  - `src/routes/_authenticated/companies.tsx`: Main manager portal for all companies, plan health thresholds, online user presence, paid-until date adjustment, and tenant suspend/unsuspend.
  - `src/routes/_authenticated/companies.$orgId.tsx`: Read-only troubleshooting view ("view as company") with audit logging.
  - `src/routes/_authenticated/companies.subscribers.tsx`: Full subscriber overview backed by the `list_subscribers()` RPC.
  - `src/routes/_authenticated/companies.emails.tsx`: Global email delivery log across all tenants, displaying `email_delivery_log` and `otp_attempts`.
  - `src/routes/_authenticated/companies.errors.tsx`: Platform-wide incident and error tracking dashboard.
- Workspace Settings Routes:
  - `src/routes/_authenticated/settings.tsx`: Tenant preferences (`RegionCard`, `BillingCard`, `AuditLogCard`, `SecurityCard`, `DataPrivacyCard`, `TeamCard`).
  - `src/routes/_authenticated/settings.email.tsx`: Existing tenant outbound email settings page for `tenant_smtp_config`.

### 2.2 Roles and Access Control Hierarchy

Defined in `src/lib/permissions.ts` and `src/hooks/useAuth.tsx`:
- Staff roles enum:
  ```ts
  export type StaffRole = "super_admin" | "company_admin" | "marketing_manager" | "staff" | "seo_editor";
  ```
- **Platform Super-Admin** (`super_admin`):
  - Stored on `profiles.staff_role`.
  - Has unrestricted route access (`ROUTES_BY_ROLE.super_admin = ALL_ROUTES`).
  - Access to `MANAGER_SECTION` and all `/companies/*` management routes.
- **Company Admin** (`company_admin`):
  - Full access to workspace features, team management, billing, and connections (`isCompanyManager() === true`).
- **Staff / Marketing / SEO**: Limited to operational subsets (deny-by-default routing).

### 2.3 Super-Admin Lockdown & Immutability Guarantees

In migration `20260830010000_super_admin_lockdown_and_oauth_reliability.sql` and `20260827154801_fbabe091-fd2c-4adc-b995-efdf2148f18f.sql`:
- Table `public.platform_super_admins`: Contains allowlisted emails (seeded with `moobbi@yahoo.com` and `atozsectrading@gmail.com`).
- Immutability Triggers:
  - `platform_super_admins_guard_delete`: Prevents deletion of super-admin allowlist entries.
  - `platform_super_admins_guard_update`: Prevents updating the email of an existing allowlist entry.
  - `profiles_guard_super_admin_delete`: Prevents deleting the `profiles` record of a locked super-admin.
  - `profiles_guard_super_admin_downgrade`: Prevents modifying `staff_role` away from `'super_admin'` for locked emails.
- PostgreSQL Helper Function:
  ```sql
  CREATE OR REPLACE FUNCTION public.is_super_admin(_user uuid DEFAULT auth.uid())
  RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = _user AND p.staff_role = 'super_admin'
    );
  $$;
  ```

### 2.4 Server Function Guard Pattern

In `src/lib/companies.functions.ts` (lines 10–20):
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
All privileged server functions invoke `requireSuperAdmin(context.supabase, context.userId)` prior to utilizing `supabaseAdmin`.

---

## 3. Secrets, Environment Variables & Encryption at Rest

### 3.1 Secrets Management

1. **Environment Variables**:
   - Injected by Vite/Nitro (`vite.config.ts`, lines 11–14). Server-only variables (never exposed with `VITE_` prefix to the browser).
   - Key server secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `LOVABLE_API_KEY`, `LOVABLE_SEND_URL`, `SOCIAL_TOKEN_ENCRYPTION_KEYS`, `SOCIAL_TOKEN_ACTIVE_KEY_ID`, `PLATFORM_EMAIL_PROVIDER`, `PLATFORM_EMAIL_API_KEY`, `PLATFORM_EMAIL_FROM`.
2. **Current Encryption at Rest Implementations in Codebase**:
   - **Pattern A: WebCrypto AES-256-GCM (Application-Level Secret-Box)**:
     - Implemented in `src/lib/social-secrets.server.ts` (lines 1–233).
     - Standard: AES-256-GCM via `crypto.subtle`.
     - Envelope format: `v1:<keyId>:<iv>:<ciphertext>:<tag>` where IV is 12 bytes base64url, tag is 16 bytes base64url.
     - Key Ring: Parsed from env (`SOCIAL_TOKEN_ENCRYPTION_KEYS="k1:<base64-32-bytes>,k2:<...>"` and `SOCIAL_TOKEN_ACTIVE_KEY_ID="k2"`). Enables zero-downtime key rotation.
     - Additional Authenticated Data (AAD): Cryptographically binds ciphertexts to contextual scope (`flas-social:v1:${tenantId}:${platform}:${field}`) to prevent ciphertext relocation across rows or columns.
     - Runtime compatibility: Works in Node.js, Cloudflare Workers, and Netlify Edge without external native dependencies.
   - **Pattern B: PostgreSQL `pgcrypto` + Supabase Vault**:
     - Implemented in `supabase/migrations/20260830000000_email_audit_otp_smtp.sql` for `tenant_smtp_config.api_key_enc`.
     - Uses `pgp_sym_encrypt(api_key, _smtp_encryption_key())` and `pgp_sym_decrypt(...)`.
     - Column-level grant prevents authenticated users from selecting `api_key_enc`:
       `GRANT SELECT (tenant_id, provider, from_email, ...) ON public.tenant_smtp_config TO authenticated;`
   - **Pattern C: Column-Level Revocation**:
     - Implemented in `20260901030000_restrict_secret_column_reads.sql`: Revokes `SELECT` on sensitive columns (e.g. `wa_numbers.access_token`, `wa_numbers.app_secret`) from `authenticated`.

### 3.2 Evaluation for Super-Admin & Tenant Email Credentials

For platform SMTP/IMAP credentials (`smtp_host`, `smtp_port`, `smtp_user`, `smtp_pass`, `imap_host`, `imap_port`, `imap_user`, `imap_pass`):
- **Recommendation**: Adopt the established **WebCrypto AES-256-GCM envelope pattern** (`v1:<keyId>:<iv>:<ciphertext>:<tag>`) via a dedicated utility `src/lib/platform-secrets.server.ts` (or generalized `src/lib/crypto-secrets.server.ts`).
- **Benefits**:
  1. Plaintext credentials never enter PostgreSQL in unencrypted form; the database only ever stores ciphertext strings.
  2. Decryption occurs strictly on the server during handshake tests or message dispatch.
  3. No dependency on PostgreSQL extensions (`pgcrypto` or `vault`) being pre-configured with database superuser rights.
  4. Fully testable using Node's native test runner (`node --test`).

---

## 4. Platform Transactional Email Mechanisms

### 4.1 Current Transactional Email Workflows

Flas CRM currently handles three primary transactional email types:
1. **Password Resets (`password_recovery`)**:
   - User initiates via `src/routes/reset-password.tsx` or `src/lib/otp-resend.functions.ts`.
   - Calls `supabaseAdmin.auth.resetPasswordForEmail(email, { redirectTo })`.
   - Dispatches Supabase Auth Hook to `/lovable/email/auth/webhook`.
   - Webhook uses React Email template: `src/lib/email-templates/recovery.tsx`.
   - Rate-limited and audited in `otp_attempts` and `auth_email_attempts`.
2. **OTP / Signup Verification (`signup_verify`)**:
   - User initiates via `src/routes/auth.tsx` or `resendVerification` in `src/lib/otp-resend.functions.ts`.
   - Calls `supabaseAdmin.auth.resend({ type: "signup", email })`.
   - Dispatches to Auth Hook `/lovable/email/auth/webhook`.
   - Webhook uses React Email template: `src/lib/email-templates/signup.tsx`.
   - Rate-limited per-email (60s cooldown, 5/hr, 20/day) and per-IP (20/hr, 100/day) via `check_otp_attempt`.
3. **Workspace Invitations (`invite`)**:
   - Company admin invites teammate via `src/components/settings/TeamCard.tsx` calling `inviteStaff` in `src/lib/onboarding.functions.ts`.
   - Records invitation in `team_invites` table.
   - Auth Hook handler supports `invite` in `src/routes/lovable/email/auth/webhook.ts` using template `src/lib/email-templates/invite.tsx`.

### 4.2 Auth Email Webhook Hook Integration (`src/routes/lovable/email/auth/webhook.ts`)

- Receives HTTP `POST` from Supabase Auth Webhook.
- Configured with `@lovable.dev/email-js` `createAuthEmailHandler`.
- Current sender identity:
  - `SITE_NAME = "Flas CRM"`
  - `FROM_DOMAIN = "flas.mobidigisol.com"`
  - Sender: `Flas CRM <noreply@flas.mobidigisol.com>`
  - Requirement: System operations must be sent from **`flas@mobidigisol.com`**.

### 4.3 Outbound Email Dispatch Utility (`src/lib/email-dispatch.server.ts`)

- `sendTenantEmail(tenantId, message)` checks `tenant_smtp_config`.
- If no tenant provider configured, falls back to environment variables:
  `PLATFORM_EMAIL_PROVIDER`, `PLATFORM_EMAIL_API_KEY`, `PLATFORM_EMAIL_FROM`.
- Logs all deliveries to `email_delivery_log` via `log_email_delivery` RPC.

---

## 5. SMTP & IMAP Handshake Testing Architecture

### 5.1 Requirement Specification
- Provide an instant "Test Connection" button in the Super Admin Management portal that validates handshake and credentials for both SMTP and IMAP for `flas@mobidigisol.com`.
- Strict isolation: Only accessible to `super_admin`.

### 5.2 Protocol Handshake Mechanics

1. **SMTP Connection Handshake**:
   - **Target**: Port 465 (Implicit TLS/SMTPS) or Port 587 (Explicit STARTTLS) or Port 25.
   - **Handshake Sequence**:
     1. TCP Connection establishment.
     2. Read initial server banner (expect code `220 ...`).
     3. Send `EHLO flas.mobidigisol.com` (expect code `250`).
     4. (If STARTTLS on 587): Send `STARTTLS` (expect `220`), perform TLS upgrade, re-issue `EHLO`.
     5. Authentication: Send `AUTH LOGIN` (or `AUTH PLAIN`).
     6. Provide base64-encoded username and password.
     7. Validate response code `235 2.7.0 Authentication successful`.
     8. Test sender envelope: Send `MAIL FROM:<flas@mobidigisol.com>` (expect `250`), then `RSET` and `QUIT`.
2. **IMAP Connection Handshake**:
   - **Target**: Port 993 (Implicit TLS/IMAPS) or Port 143 (STARTTLS).
   - **Handshake Sequence**:
     1. TCP Connection establishment with TLS.
     2. Read server greeting (expect `* OK ...`).
     3. Send tagged login command: `A001 LOGIN "<username>" "<password>"`.
     4. Expect tagged confirmation: `A001 OK ...`.
     5. Test mailbox inspection: Send `A002 SELECT INBOX`.
     6. Expect tagged confirmation: `A002 OK [READ-WRITE] ...` or `[READ-ONLY]`.
     7. Send `A003 LOGOUT` and terminate socket.

### 5.3 Implementation in Current Runtime Environment

- **Server Runtime**: The application runs under Node.js / Vite in development and Nitro / Cloudflare in production.
- **Socket Connectivity**:
  - In Node.js / Nitro: `node:net` and `node:tls` provide native socket support without requiring third-party CLI binaries.
  - In Cloudflare Workers: `cloudflare:sockets` `connect()` provides raw TCP and TLS socket support.
  - Alternatively: A standalone helper in `src/lib/smtp-imap-test.server.ts` can execute native `tls.connect` / `net.connect` with a 10-second timeout, returning granular diagnostic steps (`{ ok: boolean, latencyMs: number, steps: string[], error?: string }`).

---

## 6. Database Tables, Migrations & RLS Policy Mapping

### 6.1 Existing Database Tables Relevant to Super-Admin & Email

| Table Name | Purpose | Key Columns | Current RLS Policies |
|---|---|---|---|
| `public.platform_super_admins` | Immutable allowlist of super-admin emails | `email` (PK), `created_at` | `super admins read allowlist` (SELECT to authenticated if `is_super_admin()`) |
| `public.profiles` | User profiles with tenant & role linkage | `id`, `tenant_id`, `email`, `staff_role`, `suspended` | Tenant isolation + self-read. Triggers protect super-admin. |
| `public.organizations` | Workspaces / client companies | `id`, `name`, `slug`, `plan`, `subscription_status`, `suspended` | `tenant_isolation` (tenant members read own org; super-admin reads all) |
| `public.tenant_smtp_config` | Tenant-level email provider configuration | `tenant_id`, `provider`, `from_email`, `api_key_enc`, `verified` | `smtp_config_read_admin`, `smtp_config_write_admin` (restricted to company admins & super-admin) |
| `public.email_delivery_log` | Platform-wide email audit trail | `id`, `tenant_id`, `recipient`, `template`, `provider`, `status` | Tenant admins read own tenant's logs; super-admin reads all. |
| `public.otp_attempts` | Server-side OTP / auth resend rate limiting | `id`, `email`, `ip_address`, `kind`, `status`, `reject_reason` | `otp_attempts_superadmin_read`: Restricted exclusively to `is_super_admin()`. |
| `public.auth_email_attempts` | Audit log of signup & recovery requests | `id`, `tenant_id`, `recipient_email`, `action_type`, `status` | Read/write via service role in server functions. |

### 6.2 Key Stored Procedures & RPCs

- `is_super_admin(_user uuid)`: Returns true if user has `staff_role = 'super_admin'`.
- `list_subscribers()`: SECURITY DEFINER RPC returning subscriber metrics across all tenants for super-admin.
- `log_email_delivery(...)`: SECURITY DEFINER helper inserting delivery events.
- `check_otp_attempt(_email, _kind, _ip)`: Enforces 60s cooldown, 5/hr, 20/day per email, 20/hr per IP.
- `set_tenant_smtp_api_key(_api_key)`: Stores pgcrypto-encrypted API key for tenant.
- `get_tenant_smtp_api_key(_tenant_id)`: Decrypts tenant API key (restricted to service role).

### 6.3 Missing Schema: Platform Super-Admin Email Configuration

Currently, there is **NO table** dedicated to platform-level SMTP/IMAP configuration.
To support R1 ("Platform Super-Admin Email Configuration" for `flas@mobidigisol.com`), a new migration should create `public.platform_email_config`:
```sql
CREATE TABLE IF NOT EXISTS public.platform_email_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  smtp_host text NOT NULL,
  smtp_port integer NOT NULL DEFAULT 465,
  smtp_secure boolean NOT NULL DEFAULT true,
  smtp_user text NOT NULL,
  smtp_password_enc text NOT NULL,
  from_email text NOT NULL DEFAULT 'flas@mobidigisol.com',
  from_name text NOT NULL DEFAULT 'Flas CRM',
  imap_host text,
  imap_port integer DEFAULT 993,
  imap_secure boolean DEFAULT true,
  imap_user text,
  imap_password_enc text,
  verified boolean NOT NULL DEFAULT false,
  last_test_at timestamptz,
  last_test_ok boolean,
  last_test_error text,
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_email_config ENABLE ROW LEVEL SECURITY;

-- Strictly restricted to super_admin:
CREATE POLICY "platform_email_config_superadmin_all" ON public.platform_email_config
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

GRANT ALL ON public.platform_email_config TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.platform_email_config TO authenticated;
```

---

## 7. Actionable Implementation Blueprint for Implementation Agents

### Component 1: Platform Secrets Encryption Helper
- **File**: `src/lib/platform-secrets.server.ts`
- **Specification**: Implement AES-256-GCM encryption/decryption using the WebCrypto pattern from `src/lib/social-secrets.server.ts`, with envelope `v1:<keyId>:<iv>:<ciphertext>:<tag>`.
- **Environment variables**: Use `PLATFORM_ENCRYPTION_KEY` or fallback to existing active key ring.

### Component 2: SMTP / IMAP Handshake Tester
- **File**: `src/lib/smtp-imap-test.server.ts`
- **Specification**: Lightweight socket connection handler performing:
  1. `testSmtpConnection({ host, port, secure, user, pass, fromEmail })`: Connects via TLS/TCP, checks banner `220`, performs `EHLO`, validates `AUTH LOGIN`, tests `MAIL FROM`.
  2. `testImapConnection({ host, port, secure, user, pass })`: Connects via TLS, checks greeting `* OK`, issues `A001 LOGIN`, checks `A002 SELECT INBOX`.
  3. Returns `{ ok: boolean, latencyMs: number, log: string[], error?: string }`.

### Component 3: Platform Super-Admin Server Functions
- **File**: `src/lib/platform-email.functions.ts`
- **Endpoints**:
  - `getPlatformEmailConfig`: Guarded by `requireSuperAdmin()`. Returns configuration (omits passwords).
  - `savePlatformEmailConfig`: Guarded by `requireSuperAdmin()`. Encrypts passwords via AES-GCM before storage.
  - `testPlatformEmailConnection`: Guarded by `requireSuperAdmin()`. Decrypts passwords on server, executes handshake test, updates `last_test_at`, `last_test_ok`, `verified`.

### Component 4: Super Admin Management UI Panel
- **File**: `src/routes/_authenticated/companies.email-settings.tsx` or new tab/card in `src/routes/_authenticated/companies.tsx`.
- **UI Elements**:
  - Card: "Platform System Email Configuration (`flas@mobidigisol.com`)".
  - SMTP Form: Host, Port (465/587), Secure toggle, Username, Password input (write-only / masked).
  - IMAP Form: Host, Port (993), Secure toggle, Username, Password input.
  - Sender Settings: Fixed to `flas@mobidigisol.com`, Sender Name "Flas CRM".
  - Action buttons: "Save Configuration", "Test Connection" (with status indicator, handshake latency badge, and error toast).
  - Nav Link: Add "System Email" to `MANAGER_SECTION` in `src/lib/navigation.ts`.

---

## 8. Verification & Test Commands

1. **TypeScript compilation**:
   ```bash
   npx tsc --noEmit
   ```
2. **Build bundle**:
   ```bash
   npm run build
   ```
3. **Existing test suite**:
   ```bash
   npm run test
   ```
4. **Targeted capability and connection tests**:
   ```bash
   npm run test:oauth-security
   npm run test:social-secrets
   ```

---
*Report completed and verified against current codebase as of 2026-10-09.*
