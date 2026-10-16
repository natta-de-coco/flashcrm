# CX-00: Inbox dates and reading space, 16 October 2026

Owner explicitly authorizes publishing #84 and reports a small inbox scroll area with dates difficult to see. This forward change is on #84's existing branch after normally merging main `0f973e3` (the new inherited change is preview authentication storage, preserved unchanged).

## Change and cause

Older WhatsApp conversations automatically opened the full tools panel, taking up to 40% of the pane. It stayed open when switching chats. Tools now open only when requested, reset on chat change, and remain accessible through the header and an explicit approved-template action for a closed reply window. The server's 24-hour and sender safety gates are unchanged. The unrelated company-profile reminder stays on other pages but no longer consumes inbox reading space.

Day dividers were attached to a day's first message and scrolled off-screen, leaving faint 10px times. The thread now has a fixed date bar reflecting the first visible message, explicit full date/time on every message, and date plus time in conversation rows. Company timezone and interface language still determine formatting. Metadata has stronger contrast and the message scrollbar is wider. Existing day dividers remain.

A stable thread ref callback detects pane mounting after supporting queries load and after returning from Social. It initializes the newest-message position/date even if the message ID did not change while the pane was absent. Ordinary incoming messages still follow only when already at the bottom, and the existing visible-message history anchor is preserved. No message sending, retry ownership, tenant selection, customer history or credentials are changed.

## Verification and release limits

Final local validation passed: 1,519 tests, including 20 focused inbox regressions; TypeScript clean; lint with zero errors (21 existing warnings); formatting and production build clean. Exact tested head and CI results are recorded in #73/#84. Focused assertions cover date metadata, the fixed bar, mount initialization and removal of automatic tools expansion, while existing send/window/idempotency/history tests remain. Independent read-only review identified the pane-mount gap, then passed an in-memory React check for delayed mounting, visible dates, tools preserving scroll, Social-to-Chats remounting and conversation changes after the repair. The separate Settings authorization/grants review found no blockers in the changes included by #84.

The synthetic preview now includes an older second conversation to exercise the closed-window case. It does not send externally. New browser acceptance could not run in this session: root browser control initialization failed twice after reset, and a separate fresh agent exposed no enabled browser surfaces. A desktop/browser reconnection was requested from the owner. Do not claim that these latest changes were visually tested live or that Lovable's Publish action completed until the browser reconnects and those actions are verified.

No new SQL is added. #82's two Settings migrations remain separately pending under `CX-00-GREEN-SETTINGS-2026-10-14.md`; source review and disposable PostgreSQL checks do not prove live grants. The user has authorized merging/publishing #84; preserve history, require green final-head checks, and record GitHub merge, Lovable publish and live acceptance separately. Recovery is a reviewed forward revert of this inbox fix, retaining the older security and send-ownership changes.
