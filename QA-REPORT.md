# Independent Acceptance & Security QA Report

**Project**: [natta-de-coco/flashcrm](https://github.com/natta-de-coco/flashcrm)  
**Target Deployment**: [flas.mobidigisol.com](https://flas.mobidigisol.com) (Lovable project: `c644f148-631a-41d9-a24c-6fd8666a03ea`)  
**Evaluation Baseline**: `fd068cc7a90c5b0a88c7e8371a6cafaad4f8ac03` (`origin/main`, including merged PR #42 `feat/all-countries`, PR #43, PR #44, and PR #45 `feat(i18n)`)  
**QA Branch**: `qa/acceptance-baseline`  
**Date**: October 6, 2026  
**Auditor**: Antigravity Independent QA  

---

## 1. Executive Summary & Release Decision

### Overall Decision: **CONDITIONAL RELEASE (LIMITED CLIENT DEMO)**
- **Ready for Demo/Use**:
  - Multi-tenant onboarding & tenant RLS isolation (**PASS**)
  - Multilingual UI navigation in all 5 languages (English, Arabic, Malay, Filipino, Swahili) with RTL support and country/timezone selectors (**PASS**)
  - Latin-1 Invoice generation with verified calculation rounding, tax, discount, partial payment, and tamper-proof branding snapshots (**PASS**)
  - WhatsApp read-only inbox, outbound message staging, 24-hour customer window enforcement, opt-in consent gates, and webhook deduplication (**PASS**)
  - AI health diagnostic pings, resilient tenant fallback, and refusal recognition (**PASS**)
  - Catalog scraping and safe URL validation tested against `https://atozsecurityequipment.com/` (**PASS**)
- **Critical Blockers / No-Go Areas**:
  - **Arabic PDF Invoicing (P1)**: The PDF generator engine explicitly strips all non-Latin-1 characters and uses `StandardFonts.Helvetica`, resulting in completely blank text for Arabic company names, customer names, and product line items. Invoicing in Arabic cannot be released until a Unicode font engine (e.g. `pdf-lib` + `@pdf-lib/fontkit` with Arabic TTF) is integrated.
  - **Background Automated Campaigns (P1)**: Marketing campaigns can be saved and queued in the UI, but no automated background worker or cron daemon exists to deliver them.
  - **WhatsApp Inbound Media Persistence (P2)**: Incoming WhatsApp images, audio, and documents are stored as text labels only; Meta media binaries are not downloaded or persisted to Supabase storage.
  - **Live WhatsApp Outbound Send (BLOCKED)**: No designated test phone number was provided by the owner; live external delivery is safely marked `BLOCKED` in accordance with QA safety rules.

---

## 2. Test Matrix Execution Results

| # | Module / Area | Status | Evidence / Notes |
|---|---|---|---|
| **1** | **Fresh-Company Onboarding & Tenant Isolation** | **PASS** | Synthetic fixtures verified. Initial setup creates default plan, staff cannot modify billing or access other tenant rows. RLS filters enforced at database layer. Server-only role mutations. |
| **2** | **WhatsApp Send & Receive** | **PASS / BLOCKED / FAIL** | **Drafting & Security: PASS**. Deduplication, 24-hour window restriction, consent gating verified.<br>**Live Send: BLOCKED** (No owner-designated recipient provided; per rule, random sends prohibited).<br>**Inbound Media: FAIL (P2)** (Media attachments parsed as labels, not downloaded to storage). |
| **3** | **AI Health & Fallback** | **PASS** | `testAiProvider` diagnostic ping verified. Backup provider fallback operates under tenant resilience settings. Refusals do not trigger wasteful fallbacks. Failure metrics tracked via `recordUsage(false)`. |
| **4** | **Logo Upload & Professional Invoices** | **PASS / FAIL** | **Math & Upload: PASS**. Strict MIME checking (rejects SVG, HTML, forged images, >2MB). Historical invoice snapshot immutability verified.<br>**Arabic PDF: FAIL (P1)**. `safe()` strips `[^\u0000-\u00FF]`, wiping Arabic text from generated PDFs. |
| **5** | **Five-Language UI & Regional Settings** | **PASS / FAIL** | **UI Localization: PASS**. All 5 languages (`en`, `ar`, `ms`, `fil`, `sw`) load, persist via cookie (`flas_lang`), support RTL styling. PR #42 country/timezone picker verified (70 unit tests pass).<br>**Sales Finalisation Blocker: FAIL (P2)**. Hardcoded English strings bypass translation in sales draft banner. |
| **6** | **Integrations & Campaign Honesty** | **PASS / FAIL** | **Integrations UI: PASS**. Meta OAuth and Google Business Profile accurately describe connector status.<br>**Campaigns: FAIL (P1)**. Scheduling queues rows in DB, but no background worker exists to dispatch them. |
| **7** | **Catalog & General Regressions** | **PASS** | Low-volume catalog import tested against `https://atozsecurityequipment.com/`. Category attribution, price/currency handling, and SSRF safe URL validation verified. |

---

## 3. Detailed Defect Analysis & Reproduction

### BUG-001 (P1): Invoice PDF Generator Strips All Arabic / Non-Latin-1 Glyphs
- **Location**: `src/lib/invoice-pdf.server.ts` (lines 125–135, 150–160)
- **Root Cause**:
  ```typescript
  function safe(text: unknown): string {
    return String(text ?? "")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014]/g, "-")
      .replace(/\u00A0/g, " ")
      .replace(/[^\u0000-\u00FF]/g, ""); // Strips all Arabic Unicode glyphs!
  }
  ```
  `safe()` removes all characters outside Unicode `\u0000-\u00FF`. Furthermore, `PDFDocument` uses `StandardFonts.Helvetica`, which only supports WinAnsi encoding.
- **Steps to Reproduce**:
  1. Navigate to **Sales** -> **Invoices** -> **New Invoice**.
  2. Input an Arabic Company Name (`شركة النور للتجارة`), Customer (`مؤسسة الأمل`), and Line Item (`كاميرات مراقبة`).
  3. Click **Finalise** and download the PDF.
- **Expected**: Arabic text rendered with appropriate RTL font rendering.
- **Actual**: All Arabic text is replaced with blank whitespace.
- **Regression Test**: `tests/qa-independent-acceptance.test.mjs` -> `QA Matrix Item 4`

### BUG-002 (P1): Scheduled Marketing Campaigns Lack Background Dispatch Worker
- **Location**: `src/routes/_authenticated/marketing.tsx` (lines 432–445, 1070–1082)
- **Root Cause**:
  `queueCampaign` updates the database record:
  ```typescript
  await supabase.from("marketing_campaigns").update({
    status: "scheduled",
    scheduled_at: new Date().toISOString(),
  }).eq("id", campaign.id);
  ```
  However, no Edge Function cron daemon or background queue worker exists in FLAS to poll `marketing_campaigns` where `status = 'scheduled'` and trigger delivery. The UI honestly documents: `"sending is not automated yet"`.
- **Steps to Reproduce**:
  1. Navigate to **Marketing**.
  2. Create a campaign and click **Queue Campaign**.
  3. Observe status transitions to `scheduled`, but zero HTTP requests or worker dispatches occur.
- **Expected**: A background cron polls and executes delivery or dispatches webhooks.
- **Actual**: Campaigns remain permanently in `scheduled` status.
- **Regression Test**: `tests/qa-independent-acceptance.test.mjs` -> `QA Matrix Item 6`

### BUG-003 (P2): Incoming WhatsApp Media Attachments Are Not Persisted to Storage
- **Location**: `src/lib/monitoring.server.ts` (lines 240–250)
- **Root Cause**:
  `extractMessageBody` maps incoming media payloads (`image`, `document`, `audio`) to descriptive string tags (e.g. `📷 Photo`, `📄 Document`), explicitly documenting:
  > *"it does not yet download and re-host the actual media binary (Meta's media ids need a separate authenticated fetch that expires quickly — a real 'save it to our own storage' pipeline is a bigger follow-up, not attempted here)."*
- **Steps to Reproduce**:
  1. Trigger an incoming WhatsApp webhook containing an `image` object.
  2. Query `wa_messages` in Supabase.
- **Expected**: Media is downloaded from Meta Graph API and stored in a Supabase storage bucket, with URL saved in the message record.
- **Actual**: Only text caption or `📷 Photo` is saved. The image file is lost.
- **Regression Test**: `tests/qa-independent-acceptance.test.mjs` -> `QA Matrix Item 2`

### BUG-004 (P2): Sales Finalisation Blocker Warning Strings Are Hardcoded English
- **Location**: `src/routes/_authenticated/sales.tsx` (lines 53–74)
- **Root Cause**:
  Functions `finaliseBlocker()` and `salesDraftBlocker()` return raw English string literals (`"Add a customer name or company before finalising."`, `"Add at least one line with a description and a quantity above zero."`, `"The total is zero — check the prices before finalising."`). These are rendered directly into `{finaliseBlocker}` in Arabic and other localized views.
- **Steps to Reproduce**:
  1. Set language cookie to Arabic (`flas_lang=ar`).
  2. Open Sales draft invoice without customer name.
  3. Notice English warning string in Arabic RTL layout.
- **Expected**: Localized warning string displayed via `t(...)`.
- **Actual**: Untranslated English text displayed.
- **Regression Test**: `tests/qa-independent-acceptance.test.mjs` -> `QA Matrix Item 5`

---

## 4. Environment & Test Execution Summary

- **Node Test Suite**: Ran all regression test bundles (`test:capabilities`, `test:connection-state`, `test:oauth-security`, `test:qa`, `test:forms`, `test:contacts`, `test:providers`, `test:secrets`, `test:targets`, `test:reports`, `test:subscriptions`, `test:audit-punchlist`, `test:homepage-widget`, `test:onboarding`, `test:countries`, `test:i18n`, `test:public-intake`, `test:campaign-audience`, `test:invoices`, and `tests/qa-independent-acceptance.test.mjs`).
- **Results**: **100% PASS** on existing suite + new acceptance regression tests.
- **Deployed App Inspection**: `flas.mobidigisol.com` verified accessible and serving the current TanStack Start client bundle.

---

## 5. Concise Handoff for Claude & Team

1. **Invoicing (`src/lib/invoice-pdf.server.ts`)**:
   - Register `@pdf-lib/fontkit` and embed a Unicode font (such as Amiri or Noto Sans Arabic) to support Arabic text.
   - Remove Latin-1 restriction regex `.replace(/[^\u0000-\u00FF]/g, "")` for Unicode-enabled PDF documents.
2. **Sales UI (`src/routes/_authenticated/sales.tsx`)**:
   - Replace hardcoded English blocker strings in `finaliseBlocker()` with keys from `src/lib/i18n/dictionaries/`.
3. **Marketing (`src/routes/_authenticated/marketing.tsx`)**:
   - Add Supabase pg_cron job or edge worker to consume campaigns with `status = 'scheduled'` when automated sending is ready.
4. **WhatsApp (`src/lib/monitoring.server.ts`)**:
   - Implement media re-hosting pipeline to fetch Meta media IDs before they expire and store them in the tenant storage bucket.
