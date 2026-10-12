# Milestone 1 — Database Migration & RLS Specification: Platform Email Configuration

**Investigator**: Milestone 1 Explorer 1 (Database & RLS)  
**Date**: October 9, 2026  
**Status**: Ready for Implementation  
**Target Migration**: `supabase/migrations/20261009010000_platform_email_config.sql`  
**Target Types**: `src/integrations/supabase/types.ts` and `src/types/platform-email.ts`

---

## 1. Executive Summary

Milestone 1 establishes the Tier 1 platform email infrastructure for Flas CRM: platform-level SMTP and IMAP for super-admin system operations (password resets, signup OTP verification, and workspace invitations) originating exclusively from `flas@mobidigisol.com`.

This specification provides:
1. **The complete, idempotent SQL migration** creating `public.platform_email_config`.
2. **Row-Level Security (RLS)** strictly restricting all operations (SELECT, INSERT, UPDATE, DELETE) exclusively to authenticated super-admins using `public.is_super_admin(auth.uid())`.
3. **Singleton & Immutability Integrity**: Pre-seeded primary configuration record (`00000000-0000-0000-0000-000000000001`), an anti-multi-row insert guard, and a deletion prevention trigger.
4. **TypeScript Definitions**: Complete, strict typings for `Database['public']['Tables']['platform_email_config']` matching PostgREST standards and dedicated application-level interfaces.

---

## 2. PostgreSQL Schema & Migration Specification

### Migration File Path
`supabase/migrations/20261009010000_platform_email_config.sql`

### Full Migration Code
```sql
-- ═════════════════════════════════════════════════════════════════════════════
-- FLAS CRM — Milestone 1: Platform Super-Admin Email Configuration
--
-- Table: public.platform_email_config
-- Purpose: Platform-wide SMTP/IMAP credentials for transactional emails
--          (password resets, OTP verification, invites) sent from flas@mobidigisol.com.
--
-- Security:
--   1. RLS strictly enabled: only is_super_admin(auth.uid()) can read or modify.
--   2. Credentials at rest stored as encrypted envelope strings (AES-256-GCM).
--   3. Singleton pattern enforced: exactly 1 configuration record allowed.
--   4. Protected against accidental DELETE.
--
-- Idempotent. Safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Create table
CREATE TABLE IF NOT EXISTS public.platform_email_config (
  id              uuid PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  from_email      text NOT NULL DEFAULT 'flas@mobidigisol.com',
  from_name       text NOT NULL DEFAULT 'Flas CRM',
  smtp_host       text,
  smtp_port       integer NOT NULL DEFAULT 465,
  smtp_user       text,
  smtp_pass_enc   text,
  smtp_secure     boolean NOT NULL DEFAULT true,
  imap_host       text,
  imap_port       integer NOT NULL DEFAULT 993,
  imap_user       text,
  imap_pass_enc   text,
  imap_secure     boolean NOT NULL DEFAULT true,
  verified        boolean NOT NULL DEFAULT false,
  last_test_at    timestamptz,
  last_test_ok    boolean,
  last_test_error text,
  updated_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- 2. Ensure default singleton seed record exists
INSERT INTO public.platform_email_config (
  id,
  from_email,
  from_name,
  smtp_port,
  smtp_secure,
  imap_port,
  imap_secure,
  verified
)
VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'flas@mobidigisol.com',
  'Flas CRM',
  465,
  true,
  993,
  true,
  false
)
ON CONFLICT (id) DO NOTHING;

-- 3. Automatic updated_at trigger
DROP TRIGGER IF EXISTS platform_email_config_updated_at ON public.platform_email_config;
CREATE TRIGGER platform_email_config_updated_at
  BEFORE UPDATE ON public.platform_email_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. Singleton Guard: prevent inserting additional configuration records
CREATE OR REPLACE FUNCTION public.guard_platform_email_config_singleton()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT count(*) FROM public.platform_email_config WHERE id <> NEW.id) >= 1 THEN
    RAISE EXCEPTION 'Only one platform email configuration record is allowed on the system'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS platform_email_config_singleton_guard ON public.platform_email_config;
CREATE TRIGGER platform_email_config_singleton_guard
  BEFORE INSERT ON public.platform_email_config
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_platform_email_config_singleton();

-- 5. Deletion Guard: prevent accidental deletion of platform configuration
CREATE OR REPLACE FUNCTION public.guard_platform_email_config_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Platform email configuration cannot be deleted. Update settings instead.'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS platform_email_config_delete_guard ON public.platform_email_config;
CREATE TRIGGER platform_email_config_delete_guard
  BEFORE DELETE ON public.platform_email_config
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_platform_email_config_delete();

-- 6. Row-Level Security Configuration
ALTER TABLE public.platform_email_config ENABLE ROW LEVEL SECURITY;

-- Revoke all permissions from anonymous and public roles
REVOKE ALL ON public.platform_email_config FROM PUBLIC, anon;

-- Grant permissions to authenticated users and service_role
GRANT ALL ON public.platform_email_config TO authenticated;
GRANT ALL ON public.platform_email_config TO service_role;

-- Strictly gate ALL operations to super_admin users
DROP POLICY IF EXISTS "platform_email_config_superadmin_all" ON public.platform_email_config;
CREATE POLICY "platform_email_config_superadmin_all"
  ON public.platform_email_config
  FOR ALL
  TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

COMMIT;
```

---

## 3. Schema Design Highlights & Security Guarantees

| Column | Type | Default / Nullability | Security & Purpose |
|---|---|---|---|
| `id` | `uuid` | PK, `'00000000-0000-0000-0000-000000000001'` | Well-known singleton identifier enabling deterministic upserts and single-row lookups. |
| `from_email` | `text` | NOT NULL `'flas@mobidigisol.com'` | The mandatory platform sender address for transactional communications. |
| `from_name` | `text` | NOT NULL `'Flas CRM'` | Sender display name. |
| `smtp_host` | `text` | NULL | Outbound SMTP server hostname (e.g. `mail.mobidigisol.com` or `smtp.sendgrid.net`). |
| `smtp_port` | `integer` | NOT NULL `465` | Outbound port (465 SSL/TLS or 587 STARTTLS). |
| `smtp_user` | `text` | NULL | SMTP username. |
| `smtp_pass_enc` | `text` | NULL | **AES-256-GCM envelope ciphertext** (`v1:<keyId>:<iv>:<ciphertext>:<tag>`). Never plaintext. |
| `smtp_secure` | `boolean` | NOT NULL `true` | True for implicit SSL/TLS (port 465), false for STARTTLS (port 587). |
| `imap_host` | `text` | NULL | Inbound IMAP server hostname for mailbox inspection. |
| `imap_port` | `integer` | NOT NULL `993` | Inbound IMAP port (typically 993). |
| `imap_user` | `text` | NULL | IMAP username. |
| `imap_pass_enc` | `text` | NULL | **AES-256-GCM envelope ciphertext**. Never plaintext. |
| `imap_secure` | `boolean` | NOT NULL `true` | True for implicit TLS (port 993). |
| `verified` | `boolean` | NOT NULL `false` | True only after successful socket handshake and authentication test. |
| `last_test_at` | `timestamptz` | NULL | Timestamp of the most recent test run. |
| `last_test_ok` | `boolean` | NULL | Status outcome of the most recent test run. |
| `last_test_error`| `text` | NULL | Error diagnostics if last test failed (e.g. socket timeout, authentication rejected). |
| `updated_by` | `uuid` | NULL | Foreign key reference to `auth.users(id)` recording who updated the config. |
| `created_at` | `timestamptz` | NOT NULL `now()` | Record creation timestamp. |
| `updated_at` | `timestamptz` | NOT NULL `now()` | Auto-updated via trigger `public.set_updated_at()`. |

### Security Evaluation
1. **Multi-Tenant Isolation**: Standard tenant members (and even tenant admins) query PostgreSQL as `authenticated` with `auth.uid()` which does not have `staff_role = 'super_admin'`. RLS evaluates `public.is_super_admin(auth.uid())` which returns `false`. PostgreSQL returns 0 rows on SELECT and rejects any modification.
2. **Encrypted at Rest**: Plaintext passwords never enter PostgreSQL; they are encrypted via AES-256-GCM before database insertion. The database only ever stores ciphertexts.
3. **No Accidental Leaks**: Server functions return `PlatformEmailConfigPublic` which masks passwords (`has_smtp_password: true`), so neither plaintext nor ciphertext passwords ever reach the browser UI bundle.

---

## 4. TypeScript Definitions Specification

### 4.1 Addition to `src/integrations/supabase/types.ts`

To be placed alphabetically in `Database['public']['Tables']` between `platform_apps` (line 2726) and `platform_super_admins` (line 2727):

```ts
      platform_email_config: {
        Row: {
          created_at: string
          from_email: string
          from_name: string
          id: string
          imap_host: string | null
          imap_pass_enc: string | null
          imap_port: number | null
          imap_secure: boolean
          imap_user: string | null
          last_test_at: string | null
          last_test_error: string | null
          last_test_ok: boolean | null
          smtp_host: string | null
          smtp_pass_enc: string | null
          smtp_port: number
          smtp_secure: boolean
          smtp_user: string | null
          updated_at: string
          updated_by: string | null
          verified: boolean
        }
        Insert: {
          created_at?: string
          from_email?: string
          from_name?: string
          id?: string
          imap_host?: string | null
          imap_pass_enc?: string | null
          imap_port?: number | null
          imap_secure?: boolean
          imap_user?: string | null
          last_test_at?: string | null
          last_test_error?: string | null
          last_test_ok?: boolean | null
          smtp_host?: string | null
          smtp_pass_enc?: string | null
          smtp_port?: number
          smtp_secure?: boolean
          smtp_user?: string | null
          updated_at?: string
          updated_by?: string | null
          verified?: boolean
        }
        Update: {
          created_at?: string
          from_email?: string
          from_name?: string
          id?: string
          imap_host?: string | null
          imap_pass_enc?: string | null
          imap_port?: number | null
          imap_secure?: boolean
          imap_user?: string | null
          last_test_at?: string | null
          last_test_error?: string | null
          last_test_ok?: boolean | null
          smtp_host?: string | null
          smtp_pass_enc?: string | null
          smtp_port?: number
          smtp_secure?: boolean
          smtp_user?: string | null
          updated_at?: string
          updated_by?: string | null
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "platform_email_config_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
```

### 4.2 Dedicated TypeScript Contract: `src/types/platform-email.ts`

For clean import across server functions, UI components, and test suites:

```ts
import type { Database } from "@/integrations/supabase/types";

export type PlatformEmailConfigRow =
  Database["public"]["Tables"]["platform_email_config"]["Row"];
export type PlatformEmailConfigInsert =
  Database["public"]["Tables"]["platform_email_config"]["Insert"];
export type PlatformEmailConfigUpdate =
  Database["public"]["Tables"]["platform_email_config"]["Update"];

/**
 * Public representation exposed to the Super Admin UI.
 * Plaintext passwords and ciphertexts are masked out for security.
 */
export interface PlatformEmailConfigPublic {
  id: string;
  from_email: string;
  from_name: string;
  smtp_host: string | null;
  smtp_port: number;
  smtp_user: string | null;
  smtp_secure: boolean;
  has_smtp_password: boolean;
  imap_host: string | null;
  imap_port: number | null;
  imap_user: string | null;
  imap_secure: boolean;
  has_imap_password: boolean;
  verified: boolean;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_test_error: string | null;
  updated_at: string;
}

/**
 * Input payload submitted by the Super Admin UI to update settings.
 * Passwords are submitted in plaintext and encrypted on the server before storage.
 */
export interface SavePlatformEmailConfigInput {
  fromEmail?: string;
  fromName?: string;
  smtpHost?: string | null;
  smtpPort?: number;
  smtpUser?: string | null;
  smtpPassword?: string | null; // Plaintext, encrypted by server
  smtpSecure?: boolean;
  imapHost?: string | null;
  imapPort?: number | null;
  imapUser?: string | null;
  imapPassword?: string | null; // Plaintext, encrypted by server
  imapSecure?: boolean;
}

/**
 * Socket handshake test diagnostic outcome.
 */
export interface PlatformConnectionTestResult {
  ok: boolean;
  latencyMs: number;
  steps: string[];
  message?: string;
  error?: string;
}
```

---

## 5. Verification Plan & Test Commands

1. **Syntax & Schema Verification**:
   - Migration executes within PostgreSQL transaction without syntax or constraint errors.
   - Singleton check ensures `INSERT INTO public.platform_email_config ...` a second time raises an exception.
   - Trigger check ensures `DELETE FROM public.platform_email_config` raises an exception.
2. **RLS Verification**:
   - Regular tenant session attempting `supabase.from("platform_email_config").select("*")` returns 0 records.
   - Regular tenant session attempting update/insert fails with 401/403 or RLS policy violation.
   - Super-admin session (`staff_role = 'super_admin'`) successfully reads and updates the record.
3. **TypeScript Compilation**:
   ```bash
   npx tsc --noEmit
   ```
   Must pass with 0 errors.
