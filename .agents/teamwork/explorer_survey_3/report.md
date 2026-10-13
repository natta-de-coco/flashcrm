# Architectural Survey Report: Lead Intake, Automation Triggers & Email Marketing Campaign Board / Composer

**Explorer**: Survey Explorer 3  
**Date**: 2026-10-09  
**Scope**: Requirements R3, R4, and R5 from `ORIGINAL_REQUEST.md` (Lead Intake & Consent Gating, Automated Welcome/Discount Offer Triggers, Visual Campaign Board & Template Composer, One-Click Unsubscribe)  
**Target Project**: Flas CRM (`z:\Chat Connect Pro`)

---

## 1. Executive Summary

This survey analyzed the end-to-end architecture across front-end widgets, server routes, database schemas, and background dispatch systems in Flas CRM. 

Key architectural takeaways:
1. **Lead Intake & Consent Gating (R3)**:
   - Flas CRM currently has three lead intake interfaces: `public/widget.js` (website floating chat widget), `public/lead-capture.js` (inline embeddable newsletter form), and `public/flas-popup.js` (side popup chatbot), plus internal CRM forms in `src/routes/_authenticated/contacts.tsx`.
   - `public/lead-capture.js` and `public/flas-popup.js` post to `/api/public/leads/collect` and funnel into `ingestLead()` in `src/lib/leads.server.ts`.
   - **Crucial Gap Identified**: `public/widget.js` posts to `/api/public/widget/chat` (`src/routes/api/public/widget/chat.ts`), which routes messages via `ingestInboundMessage()` and only patches `contacts`—it **never creates a record in `leads`**, nor does it capture `source_url`. Consequently, chat widget visitors never enter the marketing lead pool or campaign audience.
   - The consent gating mechanism across widgets must require an explicit, un-ticked checkbox covering Terms & Conditions and Marketing Communications before email collection, saving `consent_given: true`, `consent_at: timestamp`, and `source_url` for GDPR/CAN-SPAM compliance.

2. **Real-Time Automation Triggers (R4)**:
   - Currently, **no automated welcome or discount email trigger exists** when a lead subscribes.
   - The ideal trigger entry point is `ingestLead()` in `src/lib/leads.server.ts` immediately after the lead/contact is upserted with `consented === true`.
   - Outbound delivery infrastructure already exists in `src/lib/email-dispatch.server.ts` (`sendTenantEmail()` and `dispatchEmail()`) and logs to the PostgreSQL table `email_delivery_log` via the `log_email_delivery` RPC.
   - Adding an event-driven automation trigger (`triggerLeadWelcomeAutomation`) will immediately dispatch promotional welcome emails with configured discount codes (e.g. `WELCOME10`) and log delivery status.

3. **Campaign Board & Template Composer (R5)**:
   - The current campaign interface in `src/routes/_authenticated/marketing.tsx` is rudimentary: a basic form with 3 text inputs and a flat list of campaigns with a status badge and a "Queue" button.
   - There is no Kanban/board view, no rich-text/HTML composer, no merge tags (`{{name}}`, `{{company}}`, `{{discount_code}}`, `{{unsubscribe_url}}`), no segment selector querying the consented pool, and no one-click unsubscribe mechanism.
   - The visual Kanban pattern already exists in `src/components/sales/SalesPipelineBoard.tsx` (Draft → Sent → Accepted → Unpaid → Paid) and can be adapted into a `CampaignBoard` with stages: **Draft, Scheduled, In Progress, Sent, Paused**.
   - `email-dispatch.server.ts` currently only supports plain-text messages; adding `html?: string` to `EmailMessage` will unlock rich-text and HTML block dispatch across Resend, Postmark, Mailgun, and SendGrid.
   - A dedicated public route `src/routes/unsubscribe.tsx` must be added to handle one-click unsubscribe requests, verifying tokens and setting `subscribed: false` and `consent_given: false` on both `leads` and `contacts`.

---

## 2. Lead Intake Mechanisms & Widget Architecture

### 2.1 File Map
| Component / File | Location | Primary Role |
| :--- | :--- | :--- |
| **Website Chat Widget** | `public/widget.js` | Embeddable JS widget loaded via `<script data-site-key="...">`. Prompts visitor for identity before chat. |
| **Inline Lead Capture Form** | `public/lead-capture.js` | Embeddable inline newsletter form (`<div data-flas-leads>`). Submits to `/api/public/leads/collect`. |
| **Side Popup Chatbot** | `public/flas-popup.js` | Slide-in drawer chat widget collecting details, submitting to `/api/public/leads/collect`. |
| **Widget Demo Preview** | `src/routes/widget-demo.tsx` | Admin preview route rendering a mock company site running live `widget.js`. |
| **Public Lead Collector API** | `src/routes/api/public/leads/collect.ts` | Validates site key, enforces domain pinning (`checkDomainPin`), parses payload with Zod, invokes `ingestLead()`. |
| **Public Widget Chat API** | `src/routes/api/public/widget/chat.ts` | Handles widget chat messages, enforces domain pinning, handles inbound message via `ingestInboundMessage()`. |
| **Lead Ingestion Engine** | `src/lib/leads.server.ts` | Central server function `ingestLead()` managing contact deduplication, lead upsert, consent capture, and routing rules. |
| **Contact Management UI** | `src/routes/_authenticated/contacts.tsx` | CRM contact management: "New Contact" modal, "Import Numbers" CSV import modal, consent toggle mutations. |
| **Platform Webhooks** | `src/lib/site-webhooks.server.ts` | Ingestion for WordPress / Shopify server-side webhooks, calls `ingestLead()`. |

### 2.2 Deep Dive: Widget Identity & Consent Form Flow

#### `public/widget.js`
- **Current Behavior**:
  - Lines 98–119 render a form `#flasw-gate` asking for:
    - Name (`#flasw-name`, required)
    - WhatsApp number (`#flasw-phone`, required)
    - Email (`#flasw-email`, optional)
    - Consent checkbox (`#flasw-consent`, un-ticked): `"Send me offers and updates on WhatsApp. You can reply STOP at any time."`
  - Submits to `POST /api/public/widget/chat` (`src/routes/api/public/widget/chat.ts`).
  - Sends payload: `{ sessionId, siteKey, message, name, phone, email, marketingConsent }`.
- **Architectural Issues & Required Changes**:
  1. `widget.js` does NOT send `sourceUrl` (`window.location.href`). Must add `sourceUrl: window.location.href`.
  2. The consent copy is WhatsApp-specific. To satisfy R3, it must explicitly encompass **Terms & Conditions and Marketing Communications** (email & WhatsApp) before capturing email.
  3. In `src/routes/api/public/widget/chat.ts` (lines 104–127), the server only runs:
     ```ts
     await supabaseAdmin.from("contacts").update(patch).eq("tenant_id", site.tenant_id).eq("phone", parsed.phone);
     ```
     It **never creates or upserts a row in `leads`**! 
     To fix: When email is provided and consent is given, call `ingestLead()` in `src/lib/leads.server.ts` with `tenantId: site.tenant_id, siteId: site.id, sitePlatform: "website", email: parsed.email, name: parsed.name, phone: parsed.phone, sourceUrl: parsed.sourceUrl, consent: parsed.marketingConsent === true`. This guarantees the lead lands in the marketing audience pool!

#### `public/lead-capture.js`
- **Current Behavior**:
  - Mounts `<form class="flasl">` into `<div data-flas-leads>`:
    - Name (`input[name="name"]`)
    - Email (`input[name="email"]`, required)
    - Consent checkbox (`input[name="consent"]`, required): `"I agree to receive marketing messages by email and WhatsApp."`
  - Submits `POST /api/public/leads/collect`.
  - Sends `{ siteKey, email, name, phone, sourceUrl: window.location.href, consent: true, tags: [] }`.
- **Status**: Correctly passes `sourceUrl` and un-ticked consent. Can refine label to explicitly reference Terms & Conditions and Marketing Consent.

#### `src/lib/leads.server.ts` -> `ingestLead()`
- **Current Behavior**:
  - Scoped to `input.tenantId`.
  - Checks/creates row in `contacts` table:
    - Deduplicates by `(tenant_id, email)`.
    - If new: inserts with `tags: ["lead", input.sitePlatform]`, and if consented, `consent_given: true, consent_at: consentAt`.
    - If existing: updates `consent_given: true, consent_at: consentAt`.
  - Upserts `leads` table:
    - Deduplicates by `(tenant_id, email)`.
    - Sets `source: input.sitePlatform, source_url: input.sourceUrl, site_id: input.siteId, contact_id: contactId`.
    - If consented: sets `consent_given: true, consent_at: consentAt, subscribed: true`.
  - Writes audit record via `logAudit({ action: "consent.capture", entityType: "lead", entityId: email, details: { siteId, platform, consentAt } })`.
- **Status**: Robust foundation. Needs automation trigger hook (see Section 4).

---

## 3. Database Schemas & Audience Segmentation

### 3.1 Existing Tables

#### `public.leads`
```sql
CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  site_id uuid REFERENCES public.lead_sites(id) ON DELETE SET NULL,
  email text NOT NULL,
  name text,
  phone text,
  source text NOT NULL,             -- e.g. 'wordpress', 'shopify', 'website'
  source_url text,                  -- page URL where lead was captured
  tags text[] DEFAULT '{}'::text[],
  status text NOT NULL DEFAULT 'new',
  subscribed boolean NOT NULL DEFAULT false,
  consent_given boolean NOT NULL DEFAULT false,
  consent_at timestamptz,
  lead_score numeric DEFAULT 0,
  assigned_to uuid,
  assigned_wa_number_id uuid,
  custom_fields jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leads_tenant_email_key UNIQUE (tenant_id, email)
);
```

#### `public.contacts`
```sql
CREATE TABLE public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text,
  phone text,
  company text,
  stage lead_stage NOT NULL DEFAULT 'lead',  -- 'lead','contacted','meeting','proposal','won','lost'
  value numeric DEFAULT 0,
  tags text[] DEFAULT '{}'::text[],
  notes text,
  consent_given boolean NOT NULL DEFAULT false,
  consent_at timestamptz,
  owner_id uuid,
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

#### `public.campaigns`
```sql
CREATE TABLE public.campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  audience_tag text,
  recipients_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',  -- 'draft','scheduled','in_progress','sent','paused'
  scheduled_at timestamptz,
  sent_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
```

#### `public.email_delivery_log`
```sql
CREATE TABLE public.email_delivery_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  recipient text NOT NULL,
  from_address text,
  subject text,
  template text,     -- 'welcome_discount' | 'campaign' | 'signup' | 'invite' | etc.
  provider text NOT NULL DEFAULT 'lovable',
  provider_msg_id text,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('queued','sent','bounced','complained','rejected','delivered','opened','clicked','failed')),
  error text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

#### `public.tenant_smtp_config`
```sql
CREATE TABLE public.tenant_smtp_config (
  tenant_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'platform' CHECK (provider IN ('platform','resend','mailgun','sendgrid','postmark','ses','smtp_relay')),
  from_email text,
  from_name text,
  reply_to text,
  api_key_enc bytea,
  region text,
  domain text,
  webhook_secret text,
  verified boolean NOT NULL DEFAULT false,
  last_test_at timestamptz,
  last_test_ok boolean,
  last_test_error text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

### 3.2 Audience Pool & Segmentation Architecture

1. **Audience Pool Query Model**:
   An audience segment queries across both `leads` and `contacts` within the current `tenant_id` subject to strict consent filtering:
   ```sql
   -- Verified Consented Audience Query
   SELECT DISTINCT ON (lower(email))
     id, email, name, 'lead' AS source_type, tags, source
   FROM public.leads
   WHERE tenant_id = :tenant_id
     AND email IS NOT NULL
     AND consent_given = true
     AND subscribed = true
   UNION ALL
   SELECT DISTINCT ON (lower(email))
     id, email, name, 'contact' AS source_type, tags, stage::text AS source
   FROM public.contacts
   WHERE tenant_id = :tenant_id
     AND email IS NOT NULL
     AND consent_given = true
     AND NOT EXISTS (
       SELECT 1 FROM public.leads l
       WHERE l.tenant_id = :tenant_id
         AND lower(l.email) = lower(contacts.email)
         AND (l.subscribed = false OR l.consent_given = false)
     );
   ```

2. **Supported Segment Filters**:
   - `all_consented`: Entire verified consented pool
   - `by_source`: Filter by lead intake platform (`wordpress`, `shopify`, `website`, etc.)
   - `by_tag`: Filter by contact or lead tag (e.g. `popup-chat`, `newsletter`, `wholesale`, `vip`)
   - `by_stage`: Filter by CRM pipeline stage (`lead`, `contacted`, `proposal`, `won`)

---

## 4. Real-Time Automation Trigger Engine (R4)

### 4.1 Trigger Workflow Diagram
```
  [Website Form / Chat Widget / Plugin Webhook]
                       │
                       ▼ POST /api/public/leads/collect
               [collect.ts / chat.ts]
                       │
                       ▼ ingestLead() in leads.server.ts
      ┌────────────────┴────────────────┐
      │ (1) Upsert Contacts (consent)   │
      │ (2) Upsert Leads (consent, url) │
      │ (3) Log Audit (consent.capture) │
      └────────────────┬────────────────┘
                       │ If consent === true
                       ▼
         triggerLeadWelcomeAutomation()
                       │
      ┌────────────────┴────────────────────────┐
      │ A. Check Tenant Automation Rule Status  │
      │    (enabled, discount_code, template)   │
      │                                         │
      │ B. Check Tenant SMTP Verification (R2)  │
      │    - If not verified: Log delivery      │
      │      attempt as 'failed', abort send.   │
      │                                         │
      │ C. Interpolate Dynamic Merge Tags:      │
      │    {{name}}, {{company}},               │
      │    {{discount_code}},                   │
      │    {{unsubscribe_url}}                  │
      │                                         │
      │ D. Dispatch via sendTenantEmail()       │
      │                                         │
      │ E. Record in email_delivery_log         │
      │    (template: 'welcome_discount')       │
      │                                         │
      │ F. Append tag 'welcome_sent' to lead    │
      └─────────────────────────────────────────┘
```

### 4.2 Automation Engine Schema
To support configurable discount offers and trigger rules, the database needs a tenant-level automation configuration table or JSON column:
```sql
CREATE TABLE public.tenant_automation_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  welcome_enabled boolean NOT NULL DEFAULT true,
  discount_code text NOT NULL DEFAULT 'WELCOME10',
  discount_description text NOT NULL DEFAULT '10% off your first purchase',
  welcome_subject text NOT NULL DEFAULT 'Welcome to {{company}}! Your {{discount_code}} discount is inside',
  welcome_body text NOT NULL DEFAULT 'Hi {{name}},\n\nWelcome to {{company}}! As promised, use code {{discount_code}} for {{discount_description}} at checkout.\n\nBest regards,\nThe {{company}} Team\n\nUnsubscribe: {{unsubscribe_url}}',
  welcome_html text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

### 4.3 Immediate Delivery Logging
Every automated trigger execution logs to `email_delivery_log` via `log_email_delivery`:
- `template`: `'welcome_discount'`
- `status`: `'sent'` or `'failed'`
- `error`: Error message if provider or verification fails
- `meta`: `{ discount_code: 'WELCOME10', lead_source: 'wordpress', trigger: 'lead_intake_consent' }`

---

## 5. Visual Email Marketing Campaign Board & Template Composer (R5)

### 5.1 Campaign Lifecycle Stages (Kanban Board)
The campaign board should provide a visual Kanban board with 5 distinct columns:
1. **Draft**: Newly created or in-progress compositions. Actions: *Edit, Delete, Queue, Send Test Email*.
2. **Scheduled**: Configured and awaiting scheduled delivery time. Actions: *Pause, Reschedule, Edit*.
3. **In Progress**: Currently executing batch delivery. Actions: *Pause dispatch*.
4. **Sent**: Successfully dispatched campaigns. Shows delivery stats (Recipients, Sent, Delivered, Bounced). Actions: *View Report, Duplicate*.
5. **Paused**: Temporarily stopped by user. Actions: *Resume, Cancel, Edit*.

### 5.2 Template Composer Architecture
The composer should be implemented as a dedicated component (`src/components/marketing/CampaignComposerModal.tsx` or similar):
1. **Subject Line Field**: Supports merge tags, e.g. `Special offer for {{name}} from {{company}}!`.
2. **Composer Modes**:
   - **Visual Rich-Text Editor**: Standard formatting (Headings, bold, italic, lists, links, dividers).
   - **HTML Block Composer**: Pre-styled blocks (Header, Hero image, Offer card, Discount callout, Unsubscribe footer).
   - **Live Preview Tab**: Interactive preview substituting merge tags with real mock values.
3. **Dynamic Merge Tags Toolbar**:
   Clickable chips that insert tags at the current cursor position:
   - `{{name}}`: Recipient's name (falls back to "there" if null)
   - `{{company}}`: Company name from tenant profile
   - `{{discount_code}}`: Campaign discount/promo code
   - `{{unsubscribe_url}}`: One-click unsubscribe link
4. **Audience Segment Selector**:
   - Segment dropdown: All Consented Leads & Contacts, Filter by Source, Filter by Tag, Filter by Pipeline Stage.
   - Real-time recipient counter querying the consented pool.
5. **BYO SMTP Strict Verification Gate (R2)**:
   - Checks `tenant_smtp_config.verified === true`.
   - If `verified === false`: The "Schedule" / "Send Now" button is disabled with a prominent tooltip:
     *"Your workspace must have a verified active SMTP server before campaigns can be dispatched. Visit Settings → Email to configure."*

### 5.3 One-Click Unsubscribe Mechanism
1. **Public Endpoint & Route**:
   Create `src/routes/unsubscribe.tsx` (and/or API handler `src/routes/api/public/unsubscribe.ts`).
2. **Token Format**:
   URL format: `https://<domain>/unsubscribe?token=<base64_hmac_token>`
   Contains `{ email, tenant_id, timestamp, sig }` signed with platform secret.
3. **Unsubscribe Action**:
   - Validates signature and timestamp.
   - Updates `leads` for `(tenant_id, email)`: `subscribed: false, consent_given: false`.
   - Updates `contacts` for `(tenant_id, email)`: `consent_given: false`.
   - Logs audit record: `{ action: "consent.revoked", entityType: "lead", entityId: email, details: { method: "one_click_unsubscribe" } }`.
   - Displays clean, reassuring confirmation UI: *"You have been successfully unsubscribed from [Company] marketing emails."*

---

## 6. HTML Support in Email Dispatch Engine

### 6.1 Current Dispatch Code (`src/lib/email-dispatch.server.ts`)
Currently, `EmailMessage` only has `text`:
```ts
export type EmailMessage = {
  from: string;
  to: string;
  subject: string;
  text: string;
  region?: string | undefined;
  domain?: string | undefined;
};
```
### 6.2 Proposed Enhancement
Expand `EmailMessage` to include `html?: string`:
```ts
export type EmailMessage = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  region?: string | undefined;
  domain?: string | undefined;
};
```
And pass `html` to the HTTP API providers:
- **Resend**: `body: JSON.stringify({ from: m.from, to: [m.to], subject: m.subject, text: m.text, html: m.html })`
- **Postmark**: `body: JSON.stringify({ From: m.from, To: m.to, Subject: m.subject, TextBody: m.text, HtmlBody: m.html })`
- **Mailgun**: `if (m.html) form.set("html", m.html);`
- **SendGrid**: `content: [{ type: "text/plain", value: m.text }, ...(m.html ? [{ type: "text/html", value: m.html }] : [])]`

---

## 7. Concrete Implementation Roadmap for Subsequent Agents

| Phase | Milestone | Files to Modify / Create | Key Action |
| :--- | :--- | :--- | :--- |
| **Phase 1** | **Database Migration** | `supabase/migrations/20261009000000_campaigns_automations_unsubscribe.sql` | Add `tenant_automation_settings` table, expand `campaigns` with `html_body`, `audience_filter`, `discount_code`. Add RPC for unsubscribe token validation. |
| **Phase 2** | **Consent & Ingestion Fixes** | `public/widget.js`<br>`src/routes/api/public/widget/chat.ts`<br>`public/lead-capture.js` | Enforce explicit un-ticked consent in widget before capturing email. Send `sourceUrl`. In `widget/chat.ts`, route consented visitor emails into `ingestLead()`. |
| **Phase 3** | **Real-Time Welcome Trigger** | `src/lib/leads.server.ts`<br>`src/lib/lead-automations.server.ts`<br>`src/lib/email-dispatch.server.ts` | Add HTML support to `email-dispatch.server.ts`. In `ingestLead()`, trigger `triggerLeadWelcomeAutomation()`, verify SMTP, substitute merge tags, dispatch, and log delivery. |
| **Phase 4** | **Campaign Board & Composer** | `src/components/marketing/CampaignBoard.tsx`<br>`src/components/marketing/CampaignComposerModal.tsx`<br>`src/routes/_authenticated/marketing.tsx` | Build 5-stage visual Kanban board, rich-text/HTML composer with dynamic merge tags, audience segment selector, and strict BYO SMTP verification check. |
| **Phase 5** | **One-Click Unsubscribe** | `src/routes/unsubscribe.tsx`<br>`src/lib/unsubscribe.server.ts` | Implement public unsubscribe page and handler revoking consent in `leads` and `contacts`. |
