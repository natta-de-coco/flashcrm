# Project: Flas CRM Dual-Tier Email Infrastructure

## Architecture
- Dual-tier model:
  1. Platform Super-Admin Tier: Platform transactional emails (password reset, OTP, workspace invites) sent exclusively from `flas@mobidigisol.com`. AES-256-GCM encrypted credentials at rest, connection handshake testing, accessible only to `super_admin` role.
  2. Tenant Email Marketing Tier: Dedicated BYO SMTP/IMAP settings per workspace in `/settings`. Credentials encrypted at rest with RLS isolation. Strictly enforced BYO gating before any campaign scheduling/dispatch. SPF/DKIM verification guide.
  3. Lead Intake & Consent Engine: Public widgets and forms require explicit un-ticked T&C/marketing consent, recording `consent_given: true`, timestamp, and source URL, funneled into marketing audience pool.
  4. Real-time Welcome Automation Engine: Automatic welcome & discount offer triggered on consented lead intake, logged to `email_delivery_log`.
  5. Visual Marketing Campaign Board & Template Composer: 5-stage Kanban board (Draft, Scheduled, In Progress, Sent, Paused), rich-text/HTML composer with dynamic merge tags, audience segment selector, mandatory one-click unsubscribe route.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Super-Admin Platform Email Schema & RLS | `platform_email_config` table with RLS restricting access exclusively to `is_super_admin(auth.uid())` | M1 | ORIGINAL_REQUEST §R1, Security |
| 2 | Platform Credential Encryption at Rest | Server-side AES-256-GCM envelope encryption for platform SMTP/IMAP credentials | M1 | ORIGINAL_REQUEST §R1, Security |
| 3 | Platform Email Connection Test | Socket handshake validation on SMTP (465/587) and IMAP (993) returning handshake latency and credentials status | M1 | ORIGINAL_REQUEST §R1 |
| 4 | Super-Admin Email Configuration UI | Dedicated management card/tab in Super-Admin portal (`/companies` or `/companies/email-settings`) for `flas@mobidigisol.com` | M1 | ORIGINAL_REQUEST §R1 |
| 5 | System Transactional Email Binding | Ensure password reset, OTP verification, and workspace invites use `flas@mobidigisol.com` | M1 | ORIGINAL_REQUEST §R1 |
| 6 | Tenant SMTP/IMAP Schema & Secret Protection | Extend `tenant_smtp_config` with SMTP/IMAP fields, revoked client SELECT on secret columns, RLS isolation | M2 | ORIGINAL_REQUEST §R2, Security |
| 7 | Tenant Credential Encryption & Test | Server functions to encrypt tenant SMTP/IMAP credentials with AES-GCM and validate connection handshake | M2 | ORIGINAL_REQUEST §R2 |
| 8 | Workspace Email Marketing Setup UI | Dedicated `EmailMarketingCard` in `src/routes/_authenticated/settings.tsx` for workspace admins | M2 | ORIGINAL_REQUEST §R2 |
| 9 | Strict BYO Enforcement Engine | Dual-layer check (PostgreSQL trigger + application pre-flight) blocking campaign scheduling/dispatch without verified SMTP | M2 | ORIGINAL_REQUEST §R2, Delivery |
| 10 | Domain SPF/DKIM Verification Guide | UI guide displaying SPF, DKIM, DMARC DNS records with one-click copy and DoH verification check | M2 | ORIGINAL_REQUEST §R2 |
| 11 | Website Chat Widget Consent Checkbox | Update `public/widget.js` to require explicit un-ticked T&C/marketing consent checkbox before email submission | M3 | ORIGINAL_REQUEST §R3 |
| 12 | Lead Capture Source URL & Consent Ingestion | Record `source_url`, `consent_given: true`, and timestamp in `leads` and `contacts` | M3 | ORIGINAL_REQUEST §R3 |
| 13 | Chat Widget Lead Intake Funnel | Update `/api/public/widget/chat` to call `ingestLead()` with `sourceUrl` and consent, entering marketing audience | M3 | ORIGINAL_REQUEST §R3 |
| 14 | Real-time Welcome Automation Trigger | Synchronous event trigger inside `ingestLead()` on consented subscription to dispatch welcome discount email | M4 | ORIGINAL_REQUEST §R4, Delivery |
| 15 | Configurable Discount Offer & Rules Engine | Configurable welcome promo codes (e.g. WELCOME10/WELCOME20) and automated discount offer generation | M4 | ORIGINAL_REQUEST §R4 |
| 16 | Welcome Email Delivery Logging | Audit and record welcome email dispatch in `email_delivery_log` via `log_email_delivery` RPC | M4 | ORIGINAL_REQUEST §R4, Delivery |
| 17 | HTML Marketing Email Dispatch Support | Extend `EmailMessage` in `src/lib/email-dispatch.server.ts` to support HTML content payload | M4 | ORIGINAL_REQUEST §R4 |
| 18 | Visual Campaign Kanban Board | 5-stage Kanban board (Draft, Scheduled, In Progress, Sent, Paused) in `src/routes/_authenticated/marketing.tsx` | M5 | ORIGINAL_REQUEST §R5 |
| 19 | Rich Template Composer & Merge Tags | Visual template composer supporting `{{name}}`, `{{company}}`, `{{discount_code}}`, `{{unsubscribe_url}}` | M5 | ORIGINAL_REQUEST §R5 |
| 20 | Audience Segment Selector | Selector querying consented leads (`subscribed = true`) and CRM contacts by tags/sources | M5 | ORIGINAL_REQUEST §R5 |
| 21 | Mandatory One-Click Unsubscribe | Public `/unsubscribe` route and HMAC token verification that revokes marketing consent across leads and contacts | M5 | ORIGINAL_REQUEST §R5, Delivery |
| 22 | Clean TypeScript Compilation | Full project compiles with `npx tsc --noEmit` with 0 errors | M-Final | ORIGINAL_REQUEST §Code Quality |
| 23 | Comprehensive E2E Verification | 100% pass of Tiers 1-4 E2E tests and Tier 5 adversarial hardening | M-Final | ORIGINAL_REQUEST §Verification |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Platform Super-Admin Email Configuration & Server Crypto | Features 1, 2, 3, 4, 5 | none | DONE |
| M2 | Strict BYO Tenant Email Marketing Settings & Security | Features 6, 7, 8, 9, 10 | none | PLANNED |
| M3 | Consent-Gated Lead Intake & Audience Pipeline | Features 11, 12, 13 | none | PLANNED |
| M4 | Automated Welcome & Discount Offer Triggers | Features 14, 15, 16, 17 | M3 | PLANNED |
| M5 | Visual Campaign Board, Template Composer & Unsubscribe | Features 18, 19, 20, 21 | M2, M4 | PLANNED |
| M-Final | E2E Test Suite Validation & Adversarial Hardening | Features 22, 23 | M1, M2, M3, M4, M5 | PLANNED |

## Milestone 1 Outputs
- Migration: `supabase/migrations/20261009010000_platform_email_config.sql`
- Types: `src/types/platform-email.ts` and `src/integrations/supabase/types.ts`
- Crypto: `src/lib/email-crypto.server.ts` (AES-256-GCM envelope, AAD context binding)
- Socket Handshake Tester: `src/lib/email-socket-test.server.ts` (SMTP 465/587, IMAP 993)
- Server Functions: `src/lib/platform-email.functions.ts` (`requireSuperAdmin` guarded)
- Super-Admin UI: `src/routes/_authenticated/companies.email-settings.tsx`, `src/components/companies/PlatformEmailSettingsCard.tsx`
- Navigation: `/companies/email-settings` in `MANAGER_SECTION` (`src/lib/navigation.ts`)
- Transactional Binding: `flas@mobidigisol.com` in `webhook.ts`, `onboarding.functions.ts`, `otp-resend.functions.ts`
- Tests: 16 crypto unit tests, 7 socket tests, 52 adversarial crypto tests, 29 socket stress tests, 51 access control tests. All passing.
