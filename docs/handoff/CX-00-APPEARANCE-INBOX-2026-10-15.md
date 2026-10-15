# CX-00: Appearance and inbox workflow, 15 October 2026

Owner requests: keep FLAS green and existing functions; introduce optional light, grey and dark appearances, gentle Nexora-inspired backgrounds/motion, and clearer desktop/mobile chat workflows. This branch is stacked on green Settings PR #82 at `267d39442a5f9cd4832949af1a7482ebab92244c`, whose main base is `61f3a731be50c5686d8857e5eb0b7e42cc505d3c`. It does not depend on the neutral-theme draft #80.

## What changed

- Personal Appearance section and quick header/drawer/sidebar switcher: FLAS light, soft grey, dark or device theme; comfortable/compact conversation rows; optional gradients, gentle motion and chat pattern. Preferences stay in this browser, contain no customer data, apply before first paint and remain usable when storage fails. Reduced-motion device preferences take priority. FLAS green actions and branding remain.
- Dashboard header adopts a restrained green/sky glow and rings. Existing metrics remain unchanged. This does not add a Reports module or invented analytics. The supplied local theme and its reports/settings pages were visual references, not a replacement application tree.
- Inbox fits between shell controls; the message thread owns its scroll area. Mobile opens the conversation list first, with a back button from a chat. Focus mode hides the desktop list. Secondary tools remain available in an expandable, bounded scrolling panel: assistant, translation, status, assignment, tags, transcript, templates, catalog and reminders.
- Clear sender/recipient line, bounded message widths, long-text wrapping, company-timezone date dividers, explicit unknown receipts, failed-load Retry and disabled sends while the thread/sender check is unreadable. No provider capability or delivery evidence is invented.
- Per-conversation drafts survive in-app page/thread changes. They and pending/idempotency references live only in memory under the signed-in user/company identity; changing identity remounts and clears them. A full page reload discards drafts and unresolved browser references. There is no server draft store, cross-tab draft sync or unload confirmation in this change.
- Send and template requests capture their original conversation and payload. A shared synchronous lock prevents double-clicks and pending sends after route remount. Transport errors retain the same reference for a same-payload retry even after sending in another conversation. A server answer releases that attempt. Late acknowledgements clear only the matching unchanged draft; late AI suggestions do not overwrite edits. Existing server gates, 24-hour window, receipts and provider pipeline are retained.
- Earlier history anchors to the visible message, rather than total scroll height. New incoming messages leave the reading position alone when the agent is browsing history; Jump to latest returns to the end.
- Arabic menu direction, isolated LTR phone numbers, keyboard sidebar resize and optional-storage error handling. New text is supplied in en/ar/ms/fil/sw.

## Verification

Local final suite: **1,489 tests pass**, TypeScript clean, lint **0 errors / 21 warnings**, production build clean. One additional warning is the appearance hook/provider mixed export used by Fast Refresh; it is not a production error. No dependency versions or lockfiles changed; existing installed dependencies were used locally, with clean installation left to CI.

Eleven new regression tests cover safe preference parsing, first-paint behavior, denied storage, theme resolution, scoped drafts, late replies/suggestions, session send locks and lost-response retries across chat/navigation, delivery labels and timezones. Existing WhatsApp composer and inbox assertions now pin the captured request/session ownership and message-based history anchoring. No server security tests were removed.

Two independent read-only reviews found and prompted fixes for route-persistent send ownership, history anchoring, Arabic dropdown direction and the Android viewport configuration mismatch. The re-review also exercised TanStack callbacks with an in-memory observer harness after route unmount. No blocking findings remained in that scope.

Browser acceptance uses actual Settings and Inbox components with explicitly labeled synthetic in-memory workspaces at `http://127.0.0.1:4316/` (`node scripts/preview-settings.mjs`). This harness aliases all relevant data/server functions; it sends nothing externally and is not a production route. Checked:

- Appearance radio keyboard navigation, grey preference after reload, optional effects/motion and light/dark controls.
- Independent chat drafts, retention after Settings navigation, focus/list mode, failed reads disabling Send while retaining drafts, and recovery.
- Double-click Send yields exactly one synthetic bubble and clears the matching reply.
- Loading earlier history preserves the visible message (under half a pixel of layout rounding on the final check); incoming messages while reading history expose Jump to latest without jumping.
- 375×812 mobile and Arabic layouts: no horizontal page overflow, phone remains LTR, Tools scrolls and the reply box remains visible. Physical mobile keyboard behavior, actual mobile hardware and screen-reader behavior are not verified.

Preview screenshots are local owner artifacts under `outputs/appearance-inbox-oct14/`, outside the repository. The overview screenshot deliberately labels its figures as samples; do not use it as proof of real reporting. Production login, real WhatsApp delivery, provider authorization, actual notification SQL and all other module screens are outside this fixture verification.

## Release and recovery

This UI branch adds **no SQL**, credentials, dependency changes, external sends or new provider capabilities. PR #82 has its own two migrations and reviewed rollout; see `CX-00-GREEN-SETTINGS-2026-10-14.md`. Those migrations are not claimed applied by this task.

1. Review and merge #82 first. PR #83 initially targeted its feature branch, then moved to main because existing CI runs only for main-targeted PRs. Until #82 lands, review the UI-only commit `901b607` separately from the included Settings base. Reconcile with current main after #82 lands, preserving history and re-running exact-head checks.
2. Review the UI diff and CI, then merge through the approved PR workflow. No direct main push or automatic production deployment is performed by this task.
3. After the actual deployment, run disposable-workspace acceptance for each appearance, real shell/mobile navigation, workspace switching, sender refusal, uncertain retry and RTL. Provider delivery needs separate authorized test recipients and receipt evidence.
4. Coordinate overlaps with AG-01 and CL-03 in issue #73, especially pending inbox/shell/MFA work (#66/#68). Preserve server guards and chosen draft/session behavior; do not replace entire files with an older version.

Recovery: revert only this UI commit through a reviewed forward PR, retaining #82's Settings/security work and migrations. Personal `flas-appearance-v1` browser preferences may remain harmlessly stored; switching to FLAS light or clearing that preference restores the original appearance. Do not roll back database security to undo visual changes.

## Next UI work, kept visible

Finish live acceptance after reviewed release; then audit each module's contrast, empty/error states, translations, focus and mobile interaction in the chosen themes. Workflow automation, reporting with real data, customizable dashboards, AI campaign composition, integration readiness and advanced template features remain separate owned tasks. Existing Settings backlog and AG-01/AG-02/CL-03 assignments remain active. This change does not mean the full CRM is error-free or that any provider is fully working.
