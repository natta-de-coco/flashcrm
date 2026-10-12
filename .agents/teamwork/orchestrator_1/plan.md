# Execution Plan — Dual-Tier Email Infrastructure in Flas CRM

## Phase 0: Survey & Codebase Mapping
- [ ] Dispatch 3 Explorers in parallel to inspect the full codebase architecture, Supabase schema, existing routes, UI components, and current email/lead mechanisms.
  - Explorer 1 (`survey_explorer_1`): Super-Admin (`/companies`, `/settings`), platform email config, role-based access, encryption helpers, Edge Functions.
  - Explorer 2 (`survey_explorer_2`): Tenant settings (`/settings`), tenant email marketing configuration, SMTP/IMAP connection testing, database schema, RLS policies.
  - Explorer 3 (`survey_explorer_3`): Lead intake & website widget consent capture, marketing audience pool, automated welcome triggers, campaign board & template composer.
- [ ] Synthesize Survey findings into `PROJECT.md` (Feature Inventory, Milestones, Interface Contracts, Code Layout).
- [ ] Spawn parallel E2E Testing Orchestrator (`e2e_orch`) to build opaque-box test runner and Tier 1-4 tests (`TEST_INFRA.md` -> `TEST_READY.md`).

## Phase 1: Milestone Decomposition & Execution
- [ ] Milestone 1: Platform Super-Admin Email Configuration (AES-GCM encryption at rest, connection test, platform system emails).
- [ ] Milestone 2: Strict BYO Tenant Email Marketing Settings (workspace settings, SMTP/IMAP credentials, RLS isolation, verification guide).
- [ ] Milestone 3: Consent-Gated Lead Intake & Website Widget (un-ticked consent checkbox, consent recording, marketing audience pool).
- [ ] Milestone 4: Automated Welcome & Discount Offer Triggers (real-time trigger on consented lead intake, delivery logging).
- [ ] Milestone 5: Visual Email Marketing Campaign Board & Template Composer (Kanban stages, merge tags, segment selector, one-click unsubscribe).

## Phase 2: Final Milestone & Verification
- [ ] Verify `TEST_READY.md` published by E2E Testing Track.
- [ ] Sub-orchestrator Final Milestone Phase 1: Pass 100% of E2E tests (Tiers 1-4).
- [ ] Sub-orchestrator Final Milestone Phase 2: Adversarial coverage hardening (Tier 5).
- [ ] TypeScript clean compilation verification (`npx tsc --noEmit` -> 0 errors).
- [ ] Forensic integrity audit check.

## Phase 3: Reporting & Victory Audit Handoff
- [ ] Produce final handoff report.
- [ ] Notify Sentinel for independent Victory Audit.
