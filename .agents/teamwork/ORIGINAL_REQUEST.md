# Original User Request

## Initial Request — 2026-10-09T16:22:19Z

Implement a dual-tier email infrastructure in Flas CRM: platform-level SMTP/IMAP for super-admin system emails (password resets, OTP verification from `flas@mobidigisol.com`), tenant-level BYO SMTP/IMAP email marketing configurations in Settings, a visual email campaign board with rich template composition, and an automated lead intake pipeline that triggers immediate welcome and discount emails with mandatory consent.

Working directory: z:\Chat Connect Pro
Integrity mode: development

## Requirements

### R1. Platform Super-Admin Email Configuration
- Secure SMTP and IMAP configuration panel in the Super Admin Management portal (`/companies` or `/settings`) for platform transactional emails.
- Used exclusively for system operations: password reset links, OTP verification emails, and workspace invitations sent from `flas@mobidigisol.com`.
- Encrypt credentials at rest (AES-GCM). Provide an instant "Test Connection" button that validates handshake and credentials.

### R2. Strict BYO Tenant Email Marketing Settings
- In workspace settings (`/settings`), add a dedicated **Email Marketing Setup** card allowing each company to connect its own SMTP (outbound sending) and IMAP (inbound reply detection/tracking) credentials.
- Strictly enforce BYO: marketing campaigns cannot be dispatched until the company has connected and verified its own active SMTP server.
- Configurable sender name, reply-to address, and domain SPF/DKIM verification guide.

### R3. Consent-Gated Lead Intake & Website Widget
- Lead intake forms and website chat widgets must require an explicit, un-ticked Terms & Conditions / Marketing consent checkbox before collecting email.
- Recorded leads store `consent_given: true`, the consent timestamp, and source url for legal compliance (GDPR/CAN-SPAM).
- Lead records link directly to the marketing audience pool.

### R4. Automated Welcome & Discount Offer Triggers
- Real-time event-driven automation engine: upon new lead subscription with recorded consent, instantly trigger an automated welcome email delivering the promised promotional discount offer.
- Automation trigger rule engine: immediate dispatch, configurable discount codes/tags, and delivery logging.

### R5. Visual Email Marketing Campaign Board & Template Composer
- Visual campaign board with clear lifecycle stages: Draft, Scheduled, In Progress, Sent, Paused.
- Visual Rich-Text and HTML block email template composer with dynamic merge tags (`{{name}}`, `{{company}}`, `{{discount_code}}`, `{{unsubscribe_url}}`).
- Audience segment selector querying consented leads and CRM contacts.
- Mandatory one-click unsubscribe mechanism that instantly marks leads as `unsubscribed: true`.

## Verification Mechanisms & Acceptance Criteria

### Security & Multi-Tenant Isolation
- [ ] Tenant SMTP/IMAP credentials are encrypted at rest using server secret-box encryption and never readable across tenants via Row-Level Security (RLS).
- [ ] Platform credentials for `flas@mobidigisol.com` are restricted to `super_admin` staff role and never exposed to standard tenants or client-side bundles.

### Delivery & Automation Verification
- [ ] Automated welcome email trigger executes upon verified lead intake and records delivery status.
- [ ] Email dispatch is blocked and produces a clear explanation if a company attempts a campaign without verified SMTP credentials.
- [ ] Unsubscribe links properly revoke marketing consent for the contact across all subsequent campaigns.

### Code Quality & UI Standards
- [ ] All new UI components follow the clean shadcn/Tailwind design system with proper loading skeletons, empty states, and disabled-button tooltips.
- [ ] Full project compiles cleanly with `npx tsc --noEmit` with 0 errors.
