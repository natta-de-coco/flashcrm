# BRIEFING — 2026-10-09T16:38:00Z

## Mission
Map and investigate all existing codebase files, architecture, database schemas, and UI components related to Tenant Email Marketing Settings and multi-tenant security (R2 & security constraints) in Flas CRM.

## 🔒 My Identity
- Archetype: explorer
- Roles: Teamwork explorer (Survey Explorer 2)
- Working directory: z:\Chat Connect Pro\.agents\teamwork\explorer_survey_2
- Original parent: 1fd03f27-f47d-43e3-8af6-a7f340a55935
- Milestone: Exploration & Architecture Mapping

## 🔒 Key Constraints
- Read-only investigation — do NOT implement or modify source code
- Document concrete file paths, component names, schema definitions, and integration points
- Focus on Tenant Email Marketing Settings, RLS/Database schemas, encryption at rest, BYO enforcement, and domain verification

## Current Parent
- Conversation ID: 1fd03f27-f47d-43e3-8af6-a7f340a55935
- Updated: 2026-10-09T16:38:00Z

## Investigation State
- **Explored paths**:
  - `src/routes/_authenticated/settings.tsx` and `src/components/settings/*`
  - `src/routes/_authenticated/settings.email.tsx` and `src/lib/tenant-smtp.functions.ts`
  - `src/lib/email-dispatch.server.ts` and `src/lib/social-secrets.server.ts`
  - `src/routes/_authenticated/marketing.tsx` and `src/lib/leads.server.ts`
  - `src/routes/_authenticated/companies.emails.tsx` and `src/routes/_authenticated/companies.tsx`
  - `supabase/migrations/20260830000000_email_audit_otp_smtp.sql` and `supabase/migrations/20260901000000_tenant_isolation_and_security_hardening.sql`
  - `src/integrations/supabase/types.ts`
  - `public/widget.js` and `src/routes/api/public/leads/collect.ts`
- **Key findings**:
  - `src/routes/_authenticated/settings.tsx` is ready for `<EmailMarketingCard />` to be mounted alongside `BillingCard`, `SecurityCard`, etc.
  - `tenant_smtp_config` table exists with pgcrypto API key encryption, but lacks columns for raw SMTP (`smtp_host`, `smtp_port`, `smtp_user`, `smtp_pass_enc`, `smtp_secure`) and inbound IMAP (`imap_host`, `imap_port`, `imap_user`, `imap_pass_enc`, `imap_secure`, `imap_enabled`).
  - Strict BYO enforcement is missing: `src/routes/_authenticated/marketing.tsx` sets `campaigns.status = "scheduled"` without checking `tenant_smtp_config.verified`. Needs both database trigger `trg_enforce_campaign_byo_smtp` and UI pre-flight gating.
  - Column-level REVOKE SELECT prevents client-side leaks of secrets via PostgREST.
  - Super-admin platform email config requires a dedicated `platform_email_config` table with super-admin exclusive RLS.
- **Unexplored areas**: None within the exploration scope; investigation complete.

## Key Decisions Made
- Fully documented 6 core areas in `report.md`.
- Formulated handoff in `handoff.md` following 5-component protocol.

## Artifact Index
- `z:\Chat Connect Pro\.agents\teamwork\explorer_survey_2\DISPATCH.md` — Initial dispatch message
- `z:\Chat Connect Pro\.agents\teamwork\explorer_survey_2\BRIEFING.md` — Working memory
- `z:\Chat Connect Pro\.agents\teamwork\explorer_survey_2\progress.md` — Progress tracker
- `z:\Chat Connect Pro\.agents\teamwork\explorer_survey_2\report.md` — Comprehensive exploration report
- `z:\Chat Connect Pro\.agents\teamwork\explorer_survey_2\handoff.md` — Handoff report
