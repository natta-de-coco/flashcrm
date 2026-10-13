# Codex Handover Report — Flas CRM (2026-10-13)

**Author:** DeepMind Antigravity Engineering Agent  
**Audience:** Codex, Engineering Collaborators, QA  
**Active Worktree / Path:** `C:\Users\mshr3\.gemini\antigravity\worktrees\flashcrm-azfix\inspect_flashcrm_repo`  
**Active Working Branch:** `qa/acceptance-baseline`  
**Pull Request:** PR #54 against `main` (`mergeStateStatus: CLEAN`, `mergeable: MERGEABLE`)  
**Repository Remotes:**

- `origin`: `https://github.com/natta-de-coco/Chat-Connect-Pro.git` (GitHub CI / PR target)
- `lovable`: `https://github.com/natta-de-coco/flashcrm.git` (Lovable editor sync)

> [!IMPORTANT]
> Lovable sync constraint: Never rewrite published git history (no force-push, rebase, or commit squashing). All changes remain on PR #54 (`qa/acceptance-baseline`). Direct pushes to `main` are strictly forbidden.

---

## 1. Accounting Export Blocker Resolution (PR #54)

### A. Root Cause Analysis

Codex reproduced an unbalanced QuickBooks export for a 100 AED invoice with a 10 AED overall discount (`subtotal: 100`, `invoice_discount: 10`, `grand_total: 90`):

- In **QuickBooks Desktop IIF** (`generateQuickBooksIif`), the transaction header (`TRNS`) recorded a debit of `+90.00` to Accounts Receivable, while line item splits (`SPL`) recorded a credit of `-100.00` to Sales. Because `doc.invoice_discount` was omitted from transaction splits, the sum `+90.00 - 100.00 = -10.00` violated the double-entry identity (`TRNS + SPLs === 0`), causing QuickBooks to reject or corrupt the import.
- In **Tally Prime XML** (`generateTallySalesXml`), debtor debit (`+90.00`) did not match sales credit (`-100.00`), causing Tally to log unbalanced voucher errors. Furthermore, negative rounding adjustments produced malformed `--` double-minus strings (`<AMOUNT>--0.50</AMOUNT>`).

### B. Changes Implemented (`src/lib/accounting-sync.ts`)

1. **Configurable Ledgers**: Added `discountLedger?: string` and wired `roundOffLedger?: string` to `AccountingExportOptions` (defaulting to `"Discounts Given"` and `"Round Off"` respectively).
2. **QuickBooks IIF Balancing**:
   - When `doc.invoice_discount > 0`, emit an `SPL` split line for `discountLedger` with positive debit amount `+Number(doc.invoice_discount).toFixed(2)`.
   - Balanced formula: `TRNS (grand_total: +90.00) + SPL Sales (-100.00) + SPL Discount (+10.00) = 0.00`.
3. **Tally Prime XML Balancing**:
   - When `doc.invoice_discount > 0`, emit `<LEDGERENTRIES.LIST>` for `discountLedger` with `<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>` and `<AMOUNT>${Number(doc.invoice_discount).toFixed(2)}</AMOUNT>`.
   - Fixed rounding adjustments: positive adjustments are credited (`<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>`, `<AMOUNT>-0.50</AMOUNT>`), and negative adjustments are debited (`<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>`, `<AMOUNT>0.50</AMOUNT>`), eliminating double-minus syntax.
   - Total Debits (`grand_total + invoice_discount + abs(neg_adj)`) strictly equals Total Credits (`subtotal + tax_total + shipping + charges + pos_adj`).
4. **QuickBooks CSV & JSON**:
   - Added discount line row to QuickBooks CSV.
   - Added `DiscountLineDetail` with `PercentBased: false` to QuickBooks Online JSON (`generateQuickBooksInvoiceJson`).
   - Added `discount` to Zoho Books JSON (`generateZohoInvoiceJson`).

### C. Test Verification (`tests/invoices.test.mjs`)

Added comprehensive test suites executed through real export functions:

- Verified exact 0.00 zero-variance balance for 100 AED invoice with 10 AED discount (Codex reproducer).
- Verified full multi-component invoice: 100 AED subtotal, 10 AED discount, 5% tax (4.50), 15 shipping, 5 charges, and negative rounding (-0.50) -> 114.00 grand total.
- Verified positive rounding (+0.50) -> 115.00 grand total.
- Verified no `<AMOUNT>--` malformed tags in Tally XML.

---

## 2. Corrected Webhook Routing & Provider Instructions

### A. WhatsApp Cloud API Webhook

- **Canonical Webhook URL:** `https://<DOMAIN>/api/public/whatsapp/webhook`  
  _(Implemented in `src/routes/api/public/whatsapp/webhook.ts`. Note: `/api/public/widget/chat` is exclusively for the website visitor chat widget, NOT for Meta)._
- **Meta Verification Token (GET):** Environment variable `WHATSAPP_VERIFY_TOKEN`  
  _(Meta sends `hub.mode=subscribe`, `hub.verify_token`, and `hub.challenge`. The server matches against `process.env.WHATSAPP_VERIFY_TOKEN`, returns HTTP 200 with `hub.challenge`, and updates `wa_config.webhook_verified = true`)._
- **Meta Payload Signature (POST):** Validates `X-Hub-Signature-256` HMAC-SHA256 against the phone number's encrypted `app_secret` stored in `wa_numbers`, falling back to `process.env.WHATSAPP_APP_SECRET`.  
  _Security Gate: Fails CLOSED (HTTP 401) if no secret is configured or if signature verification fails._
- **Meta Event Processing:** Handled via `processWaPayload` in `src/lib/monitoring.server.ts` to update message delivery receipts (`sent` -> `delivered` -> `read` -> `failed`) and process inbound messages scoped to the number's `tenant_id`.

### B. Payment Webhooks (Stripe & Paddle)

- **Canonical Payments Webhook URL:** `https://<DOMAIN>/api/public/payments/webhook`  
  _(Implemented in `src/routes/api/public/payments/webhook.ts`)._
- **Stripe Routing:** If incoming request contains header `stripe-signature`, it is delegated to `handleStripeWebhook` (`src/lib/stripe.server.ts`).
- **Paddle Routing:** Otherwise, verified via Paddle webhook verification (`verifyWebhook` using `process.env.PADDLE_ENV`).

---

## 3. WhatsApp Feature Delivery Matrix

| Feature                              | State                | Implementation Details                                                                                                                             |
| ------------------------------------ | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Onboarding & Number Registration** | Implemented & Tested | Manual admin number setup tests read access against Meta Graph API before saving credentials. Tokens encrypted server-side; strict tenant scoping. |
| **Send / Receive**                   | Implemented & Tested | Inbound messages scoped to `tenant_id`. Reuses single WhatsApp thread per contact. 24-hour customer service window awareness.                      |
| **Template Messages**                | Implemented & Tested | Approved WhatsApp templates validated server-side. Positional body variables, language labels, recipient validation.                               |
| **Delivery Receipts**                | Implemented & Tested | Webhook reconciles `sent`, `delivered`, `read`, and `failed` with provider timestamps. Deduplicated and ordered.                                   |
| **Consent & Opt-in Tracking**        | Implemented & Tested | Explicit consent verification before sending outbound template or campaign messages.                                                               |
| **AI Assistant / Bot Replies**       | Implemented & Tested | Respects workspace assistant policy. Handover to human pauses automation. AI drafts vs direct send controls.                                       |
| **Broadcast Campaigns**              | Implemented & Tested | Audience segmentation with consent filtering and suppression check.                                                                                |

---

## 4. Verification Status & Test Evidence

All checks have been executed locally in the worktree and passed 100%:

```bash
# 1. Typecheck (0 errors)
npx tsc --noEmit

# 2. Invoicing & Sales tests (20 tests passed)
npm run test:invoices

# 3. Full test regression suite (all 28 suites, 492+ tests passed)
npm test

# 4. Code formatting check (Prettier clean)
npx prettier --check src/lib/accounting-sync.ts tests/invoices.test.mjs
```

---

## 5. Pending Work & Known Context for Codex

1. **Remote CI / Merge**:
   - Push commit to `qa/acceptance-baseline` on `origin`.
   - Verify GitHub Actions CI on PR #54 (`gh pr checks 54`).
   - PR #54 is ready to merge cleanly once Codex completes review.
2. **Meta Embedded Signup**:
   - Manual admin number connector is complete. Self-service Embedded Signup ("Continue with WhatsApp") requires Tech Provider verification on the FLAS Meta app before exposing to end-users.
