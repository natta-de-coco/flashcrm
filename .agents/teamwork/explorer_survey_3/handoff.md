# Handoff Report: Survey Explorer 3 (Lead Intake, Automation Triggers & Campaign Board/Composer)

**Agent**: Survey Explorer 3  
**Date**: 2026-10-09  
**Type**: Hard Handoff (Investigation Complete)  
**Parent Conversation**: 1fd03f27-f47d-43e3-8af6-a7f340a55935  

---

## 1. Observation

1. **Lead Intake in Widgets & Forms**:
   - `public/widget.js` (lines 98–119): Collects name, WhatsApp phone, email (optional), and an unticked checkbox for WhatsApp updates (`#flasw-consent`). Submits to `POST /api/public/widget/chat`. Does not include `sourceUrl`.
   - `src/routes/api/public/widget/chat.ts` (lines 104–127): On chat submission with phone and (email or consent), patches `contacts` table only:
     ```ts
     await supabaseAdmin.from("contacts").update(patch).eq("tenant_id", site.tenant_id).eq("phone", parsed.phone);
     ```
     Crucially, it does not call `ingestLead()` and does not insert or update any row in the `leads` table.
   - `public/lead-capture.js` (lines 26–42, 50–59): Embed form collecting name, email, and consent checkbox. Submits `siteKey`, `email`, `name`, `phone`, `sourceUrl: window.location.href`, `consent: payload.consent === true` to `POST /api/public/leads/collect`.
   - `src/routes/api/public/leads/collect.ts` (lines 72–84): Validates `PayloadSchema`, checks domain pin (`checkDomainPin`), and calls `ingestLead()`.
   - `src/lib/leads.server.ts` (lines 66–161): `ingestLead()` creates/updates `contacts` and upserts `leads` with `source_url: input.sourceUrl`, `consent_given: true`, `consent_at: consentAt`, `subscribed: true` when `input.consent === true`. Logs audit action `consent.capture`.

2. **Automation Trigger Engine Status**:
   - `src/lib/leads.server.ts`: After upserting `contacts` and `leads` (lines 122–161), there is no call to dispatch any welcome email, generate a discount code, or trigger any automated campaign.
   - `src/lib/email-dispatch.server.ts` (lines 20–89, 99–151): Dispatches plain-text emails via Resend, Postmark, Mailgun, and SendGrid, and calls `supabaseAdmin.rpc("log_email_delivery", ...)` to record attempts in `email_delivery_log`. `EmailMessage` type (lines 8–15) does not currently declare `html?: string`.
   - `supabase/migrations/20260830000000_email_audit_otp_smtp.sql` (lines 20–37, 62–86): Table `email_delivery_log` and RPC `log_email_delivery` already exist with columns for `tenant_id`, `recipient`, `subject`, `template`, `provider`, `status`, `error`, `meta`.

3. **Campaign Management UI & Board Status**:
   - `src/routes/_authenticated/marketing.tsx` (lines 89–98, 150–160, 247–264, 834–920): Manages campaigns via basic card with form inputs (`name`, `subject`, `body`) and a flat list of campaign items. It has no Kanban board view, no rich-text/HTML composer, no merge tags, and no audience segment selector.
   - `src/components/sales/SalesPipelineBoard.tsx` (lines 1–100): Implements a modular visual Kanban board with 5 stages (Draft, Sent, Accepted, Unpaid, Paid), column headers with count badges, and empty states. This establishes the UI pattern for the Campaign Board.
   - `src/lib/campaign-intel.server.ts` (lines 20–59): Function `gatherAudienceSegments()` gathers contacts by source, stage, country, and tags, and computes consented share.

4. **One-Click Unsubscribe Mechanism**:
   - Grep search across `src/` for `unsubscribe` showed references in marketing copy (`src/lib/locale.ts`), but zero public endpoints or routes currently exist to process unsubscribe requests or update contact/lead consent.

5. **Type Safety & Build Status**:
   - Executing `npx tsc --noEmit` exited cleanly with code 0 (zero TypeScript errors).

---

## 2. Logic Chain

1. **Widget Leads Missing from Marketing Audience**:
   - *Premise*: R3 mandates that lead intake forms and website chat widgets link directly to the marketing audience pool with recorded consent and source URL.
   - *Observation*: `public/widget.js` submits to `/api/public/widget/chat`, which only modifies `contacts` and ignores `leads`.
   - *Inference*: Website chat visitors who provide an email and consent are completely invisible to the marketing campaigns page because campaigns count and query `leads` (where `subscribed = true`).
   - *Resolution*: When email and consent are present, `/api/public/widget/chat` must invoke `ingestLead()` with `sourceUrl` so the lead is recorded in `leads` and tagged with platform `"website"`.

2. **Welcome & Discount Offer Automation Trigger**:
   - *Premise*: R4 mandates real-time event-driven triggers upon new consented lead intake to immediately dispatch welcome and discount offer emails with delivery logging.
   - *Observation*: `ingestLead()` in `src/lib/leads.server.ts` is the single funnel point for all verified lead intakes. Currently, it stops after audit logging.
   - *Inference*: Triggering an automation function (`triggerLeadWelcomeAutomation`) inside `ingestLead()` when `consented === true` ensures immediate dispatch regardless of intake source (chat widget, inline form, popup, or plugin webhook).
   - *Inference*: Outbound email dispatch already logs to `email_delivery_log` via `log_email_delivery`. Providing `template: "welcome_discount"` and passing the discount code in `meta` fulfills the delivery logging requirement.

3. **Visual Campaign Board & Rich Template Composer**:
   - *Premise*: R5 mandates a visual campaign board with lifecycle stages (Draft, Scheduled, In Progress, Sent, Paused), rich-text/HTML composer with merge tags (`{{name}}`, `{{company}}`, `{{discount_code}}`, `{{unsubscribe_url}}`), audience segment selector, and mandatory unsubscribe mechanism.
   - *Observation*: `src/routes/_authenticated/marketing.tsx` already loads campaigns, while `src/components/sales/SalesPipelineBoard.tsx` provides a battle-tested visual Kanban implementation.
   - *Inference*: Creating a dedicated `CampaignBoard` component with the 5 lifecycle stages, paired with a `CampaignComposerModal` that supports merge tag chips, segment selection, live preview, and strict BYO SMTP verification gating, satisfies R5 while adhering to the existing design system.
   - *Observation*: `src/lib/email-dispatch.server.ts` currently sends plain text only.
   - *Inference*: Adding `html?: string` to `EmailMessage` and passing it to Resend, Postmark, Mailgun, and SendGrid enables HTML marketing email dispatch with minimal code changes.

4. **One-Click Unsubscribe**:
   - *Premise*: R5 mandates a mandatory one-click unsubscribe mechanism that marks leads as `unsubscribed: true` and revokes marketing consent across subsequent campaigns.
   - *Observation*: No unsubscribe endpoint currently exists in the project.
   - *Inference*: Creating a public route `src/routes/unsubscribe.tsx` that decodes an HMAC token with `(email, tenant_id)`, updates `leads.subscribed = false` and `contacts.consent_given = false`, logs an audit record, and displays a confirmation UI provides full legal compliance (GDPR/CAN-SPAM).

---

## 3. Caveats

1. **Serverless Socket Limitation**: As documented in `src/lib/email-dispatch.server.ts`, raw TCP SMTP sockets (ports 465/587) cannot run directly in edge/serverless environments. Tenant-level SMTP configuration relies on HTTP transactional email providers (Resend, Mailgun, SendGrid, Postmark) or an HTTPS SMTP relay gateway.
2. **Third-Party Email Templates**: The project currently uses `@react-email/components` for transactional auth emails. Marketing campaign templates will use either sanitized HTML blocks or visual markdown/rich-text.
3. **Multi-Tenant Scoping**: All campaign queries, audience segment selections, and automation settings must strictly enforce `tenant_id` scoping to prevent cross-tenant data leakage.

---

## 4. Conclusion

The existing codebase contains strong foundational primitives (secure HTTP email dispatch, per-tenant email delivery logging, lead ingestion deduplication, domain pinning, and Kanban UI components), but lacks the specific wiring for R3, R4, and R5:
1. **R3**: Update `public/widget.js` to enforce un-ticked consent covering Terms & Conditions, capture `sourceUrl`, and update `/api/public/widget/chat` to call `ingestLead()` so chat leads enter the marketing audience pool.
2. **R4**: Hook an event-driven `triggerLeadWelcomeAutomation()` inside `src/lib/leads.server.ts` to dispatch promotional discount emails with delivery logging upon new consented lead intake.
3. **R5**: Transform the campaign section of `src/routes/_authenticated/marketing.tsx` into a 5-stage visual Kanban board, build a rich-text/HTML composer with dynamic merge tags, audience segment selector, strict BYO SMTP verification check, and implement the public `/unsubscribe` route.

Full architectural details, schemas, and implementation roadmap are documented in `z:\Chat Connect Pro\.agents\teamwork\explorer_survey_3\report.md`.

---

## 5. Verification Method

Subsequent implementation agents can independently verify this survey's findings and test their implementations via:

1. **TypeScript Compilation Check**:
   ```powershell
   npx tsc --noEmit
   ```
   Must exit with code 0 and zero errors.

2. **File Inspection**:
   - Inspect `src/routes/api/public/widget/chat.ts` (lines 104–127) to confirm absence of `leads` table insertion.
   - Inspect `src/lib/leads.server.ts` (lines 66–161) to confirm absence of welcome automation trigger.
   - Inspect `src/routes/_authenticated/marketing.tsx` (lines 834–920) to confirm current basic campaign UI.
   - Inspect `src/lib/email-dispatch.server.ts` (lines 8–15) to confirm `EmailMessage` lacks `html`.

3. **Test Suite**:
   ```powershell
   npm run test
   ```
   Ensures existing capability registry and connection state tests continue to pass.
