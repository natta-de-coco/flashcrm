# CX-00: A clearer home dashboard, 15 October 2026

Owner asks for useful theme cards, icons/graphics and a home page that makes sense to someone who has never used a CRM. Keep FLAS green and the earlier appearance/inbox work. Branch `feat/guided-dashboard-oct15` starts from #83 `ac1f9c3`, then normally merges current main `41668c1` in `c1f421b`. No published history was rewritten.

## Delivered

- Friendly welcome, original code-native artwork using the existing Lucide icons, calm green surfaces and optional inherited visual effects. No remote graphics, new icon library, fake revenue, demo quotas or dead theme controls.
- A numbered Start here guide: connect a channel, add customers, read/reply in Inbox. It expands for a confirmed empty workspace and stays reachable for experienced users. Restricted roles see only their permitted steps; it does not invent a completion percentage or claim that saved credentials prove delivery.
- A next-action card grounded in successfully loaded data, plain task cards, one-sentence explanations, visible keyboard focus and a small glossary. Tasks lead to Inbox, Contacts, Quotes/invoices, Products, Social post writing, Article studio and Content, filtered by the existing role rules. Social writing explicitly says publishing is done using the social app.
- Recent conversations open their exact Inbox thread. Social/WhatsApp setup links now open Connect accounts. Advanced charts, AI summary, activity score, social accounts and manager-only Meta checks remain under More detail, keeping the first view quieter.
- Card descriptions explain what each number means. Chats to read is an exact count of conversations with unread messages, not the previous recent-100 message sum. Open conversations is also a database-side exact count. Misleading all-sender trends under bot-only totals were removed. AI reply totals do not claim the assistant is enabled.
- Failed data reads reject the overview rather than zero-filling it and generating a false clean-inbox recommendation. Independent retry/error states remain visible; unknown values do not become zero. The score is labeled CRM activity, with a clear statement that it is not financial business health.
- Dashboard/brief endpoints check the authenticated caller's own profile role and company before data/AI work; SEO, unknown, missing-profile and no-company callers are refused. The client offers the article editor a writing-focused home instead of customer previews. Provider health polling is manager-only in this screen. Existing endpoint/RLS checks remain, and hiding links is not presented as a security boundary.
- Overview, health, summaries and timestamps are scoped by workspace/role. A late AI response writes to its original cache scope. AI summaries are explicitly requested, with no generation on merely opening Home. The summary stops saying just now as it ages and shows its generation date/time. No customer message is sent by a summary request.
- 68 new interface messages in en/ar/ms/fil/sw; Arabic task/attention cards use logical layout and a full-width mobile action. Light/grey/dark continue using the appearance system from #83.

## Verification

Clean isolated npm installation with current main's versions succeeded (720 packages); `npm ls` passed. Main changed package.json/bun.lock without npm's lock, so this branch repairs package-lock.json: one existing package version changes (Lovable config 2.25.3 to 2.26.5), 89 entries supply main's Drizzle/Postgres additions, none removed. Versions match bun.lock. The large textual lock diff includes npm ordering/platform metadata; no new product dependency was selected by this task.

Full local suite: **1,518 tests pass**. TypeScript clean, lint **0 errors / 21 warnings**, production build clean. The 28 focused tests exercise actual aggregation errors/missing counts, totals above 100 chats, own-profile server authorization, role-filtered tasks, first-use guidance, scope-owned late summaries and explicit AI requests. An additional regression covers a manually generated summary aging while the page remains open. Navigation assertions now explicitly require the empty social card to link to setup, while remaining comment links still select the comments tab.

Independent read-only product/source review prompted corrections to the bot trend, AI freshness note, article destination and API-only Meta label; re-review found no remaining blocker within that scope.

The actual DashboardPage is available in `node scripts/preview-settings.mjs` at `http://127.0.0.1:4316/`, with labeled synthetic active/empty/error workspaces and role controls. Data, brief, provider-health and telemetry functions are aliased to local fixtures. Checked new-company expanded steps, role-specific cards (including article editor and staff), failed reads without zero counters, exact recent-chat navigation, explicit summary action, and Arabic at 375x812 without horizontal overflow. A cramped Arabic attention card found visually was changed to a two-column layout with its action on the next row. Desktop/mobile screenshots are owner-local artifacts under `outputs/guided-dashboard-oct15/`, outside the repository. Fixture screenshots are not live data, real AI, provider checks or delivery evidence.

## Release, database and recovery

This branch includes #82 Settings and #83 appearance/inbox history. Its new work adds no migration, provider secret, customer message, campaign or production deployment. The Drizzle schema/migration files arrived from current main and were not executed here. #82's SQL is still a separate pending rollout under `CX-00-GREEN-SETTINGS-2026-10-14.md`.

Review #82 and #83's included changes before this combined tree is merged. They can land separately and this PR can narrow, or this complete descendant can be reviewed as the release candidate; do not merge an older conflicting tree over it. Reconcile any newer main, require exact-head CI and preserve history. CX-00 coordinates deployment acceptance and separately authorized SQL. Current browser checks are synthetic, not a production release sign-off.

Recovery: revert the guided-home commit through a reviewed forward PR. Keep inherited #82 security/Settings and #83 send ownership/appearance fixes. Do not undo database access controls to roll back the dashboard. Keep main's dependency requirements aligned with both lockfiles.

## Remaining work

- Apply the same task-based language and meaningful empty/error states to the full Integrations, campaign, AI setup and product-import screens in separately owned changes; those pages have not all been redesigned here.
- Legacy health factors still use a bounded conversation sample; message/lead trends are capped and use existing server-day buckets. The new exact chat counters do not make these other figures exact. Server-written factor details and AI content are not translated by the interface dictionary.
- Meta API reachability is explicitly not inbound webhook/delivery proof. Live channels, real account onboarding, actual shell/mobile hardware and screen-reader acceptance remain separate checks after reviewed deployment. AG-01/AG-02/CL-03 assignments continue in issue #73.
