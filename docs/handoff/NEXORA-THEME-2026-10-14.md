# FLAS · Nexora theme adaptation

Owner supplied `New Theme 14 oct/CRM theme/nexora-crm`, and requested that its
features remain part of the future product roadmap. CX-00 owns this visual PR,
based on main `ea0825be9e9b527d24a8c234f9c70bd9bc8a2933`.

## What this change does

Adapts the supplied inset workspace, neutral light/dark palette, typography,
compact grouped navigation, active menu treatment, dashboard cards, table spacing
and subtle panels. FLAS retains its own logo, workspace identity and green accents.
The sidebar can collapse to icons; width resizing also works with keyboard arrows.
Appearance has Light, Dark and device modes, persists when browser storage is
available, and synchronizes between tabs. New controls have all five UI languages.

The design tokens apply to the authenticated CRM and its overlays. The public
FLAS website keeps its existing palette. The supplied demo router, demo users,
external avatars, sample finance figures and mock integrations are not installed.
No new package dependency, database migration or credential is required.

FLAS's real route tree, `useNavAccess`, user/tenant providers, onboarding, search,
quick-create, mobile navigation, locale/RTL, profile banners, presence heartbeat,
message pipelines, contact/invoice data and error/retry states are retained.
This is not an integration readiness fix or evidence of provider delivery.

## Safe local preview

After `npm ci`, run `node scripts/preview-theme.mjs`, then open
`http://127.0.0.1:4314/`. This is a separate developer preview using AppFrame,
AppearanceMenu, PageHeader and the actual shared UI components and styles.
Its labeled sample records and illustrative dashboard are never production data.
It has no auth, Supabase or server-function imports and cannot send or save.
It is not a production route. The real dashboard retains its existing widgets.

## Feature inventory to preserve and expand

Do not remove existing modules because they are absent from Nexora's demo menu.
Do not present a visual theme control as a completed backend feature.

| Supplied theme area               | FLAS mapping / next product work                                                                                                          |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard and analytics           | Existing dashboard, real health/AI brief, activity, social pulse and sync errors; expand reporting using genuine delivery/sales evidence  |
| Contacts and companies            | Existing tenant contacts and role-scoped company management; preserve identities, imports, search and assignments                         |
| Leads and lead pipeline           | Existing contacts/leads; decide one canonical lifecycle before adding a separate duplicate lead store                                     |
| Deals and deals pipeline          | Quotes/invoices and sales; future configurable stages, values, owners and activity timeline                                               |
| Activities and calendar           | Future real tasks, reminders, appointments and calendar integrations; no demo schedule in production                                      |
| Reports, goals and regions        | Existing KPI targets/region settings; future saved report filters, exports and genuine conversion/forecast calculations                   |
| Team                              | Existing membership, permissions, atomic role/removal and invitations; no replacement with mock teammates                                 |
| Settings and appearance           | Existing company identity/logo, invoice branding, region, AI keys and account connections; this PR adds visual appearance controls        |
| Authentication                    | Preserve working FLAS registration/sign-in/recovery and security; do not copy the theme's demo authentication                             |
| WhatsApp and shared inbox         | Retain send/receive/history, evidence, assignment, templates, consent and 24-hour rules; AG-01/#79 and CL-03/#66 own functional expansion |
| Email and automation              | Retain campaigns/consent; AG-02/#78 owns real delivery, mailbox sync, drip and AI planning                                                |
| Social posts and accounts         | Preserve discoverability and honest limitations; shared FLAS apps, provider review/credentials and actual publishing remain separate work |
| Catalog and website fetcher       | Preserve catalog/domain ingestion and security; future product feeds must be tenant-scoped and validated                                  |
| AI assistant and business advisor | Retain existing controls; future failover, knowledge, bounded tools and approval gates must use actual models and provider evidence       |
| Invoice/export improvements       | AG-01's #54 stays independently reviewed; this theme does not silently import its blocked tax/export/billing changes                      |
| Public website / landing          | Existing FLAS website stays intact; a separate reviewed design scope can later adapt public pages                                         |

## Validation on 14 October

- `npm ci --no-audit --no-fund`: passed with the existing lockfile.
- `npm test`: 1,324 passed, no failures or skips.
- `npm run test:i18n`: 203 passed after the final shell changes.
- `npx tsc --noEmit`: passed.
- `npm run lint`: zero errors; 19 inherited warnings.
- `npm run build`: passed (client and server).
- Local browser preview: light/dark, saved dark mode after reload, collapsed
  sidebar, contacts table, Arabic direction and start-aligned headings,
  390×844 layout, menu drawer, reply typing, LTR phone number and disabled send.
  No document-level horizontal overflow in the checked views. Table overflow
  stays inside its container.

These browser checks use the isolated preview, not authenticated customer pages.
Provider delivery and live integration setup have not been tested by this PR.

## Release and recovery

Use a feature PR. No direct main push or SQL. Review the exact head and its CI,
then test on a deployed preview with a disposable workspace: full menu, search,
quick-create, keyboard/resize, overlays, light/dark, Arabic, mobile and the real
Inbox/Sales forms. Appearance and sample-screen testing alone do not establish
provider, tenant-isolation or live financial-operation readiness.

Do not merge before the owner reviews the visual result. Coordinate future
shell/CSS edits through issue #73. If a release must be rolled back, revert the
theme commit through a normal PR; there is no data migration to undo. Do not
force-push or replace main with the supplied demo repository.
