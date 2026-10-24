<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

## FLAS shared-agent handovers (owner instruction, 13 October 2026)

Advisor AI entry points must resolve the authenticated caller's Advisor access through `requireDashboardAccess` and forward that role to their live snapshot; this preserves module visibility without treating every caller as staff.

Before working, read [the team handover protocol](docs/handoff/TEAM-HANDOVER-PROTOCOL.md)
and the latest comments in [the central GitHub ledger](https://github.com/natta-de-coco/flashcrm/issues/73).
Every Claude, Antigravity and Codex chat must register its fixed chat name/ID there,
then post a short commit-scoped GitHub handover after each task, revision, pause or blocker.
A final chat reply alone does not complete a handover.

Use reviewed PRs; do not push directly to main. Preserve published history.
SQL authors provide committed migrations, order, pre-checks, deployment dependencies,
verification and recovery instructions. CX-00 (Codex) reviews and coordinates authorized
SQL execution and records results in the ledger. Posting SQL does not run it or authorize
destructive customer-data changes. Never include secrets or customer data in handovers.
