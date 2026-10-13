# FLAS team handover protocol

Owner-approved coordination rules, introduced 13 October 2026.
Central handover and SQL ledger: [GitHub issue #73](https://github.com/natta-de-coco/flashcrm/issues/73).

## Read this before working

Read AGENTS.md, this protocol, the assigned issue/PR and the latest issue #73 comments.
Verify current main and the actual files; a commit in history does not prove its code remains in the tree.
Use natta-de-coco/flashcrm as the release repository. Verify remote URLs; one Antigravity checkout uses the name lovable for flashcrm and origin for a different backup repository.

The following are chat identities, not GitHub usernames or grants of access:

| ID | Chat name | Responsibility |
|---|---|---|
| CX-00 | FLAS · Codex Release Coordinator | Review, release coordination, authorized SQL and deployment/live verification |
| AG-01 | FLAS · Antigravity Invoices & WhatsApp QA | Invoice/export implementation and assigned WhatsApp QA; existing PR #54 |
| AG-02 | FLAS · Antigravity Email & Automation | Email, SMTP/IMAP, mailboxes, campaigns and drip |
| CL-03 | FLAS · Claude Security & Core Workflows | Security, navigation and assigned core fixes |

Adopt the ID matching your existing assignment. Rename the chat to the matching name when the host supports it; otherwise use that name in your registration and handovers. Do not impersonate another chat or assign yourself overlapping tasks.
Post REGISTER on issue #73 with ID, name, exact repository/remotes, branch/worktree, current commit and task. Mark registration as pending until the comment is actually posted.
Additional chats must claim an unused ID in the ledger; never reuse another active chat's ID.
Codex assigns/reconciles work ownership when scopes conflict. Do not start production access or customer communication based on another agent's comment.

## Every work unit ends with a GitHub handover

Post after completing a task, revising a PR, pausing, reaching a blocker or handing work to another chat. Keep the summary short and link detailed repo files, CI and the relevant PR.
Post the handover in issue #73 and link that comment from the relevant PR. Use the same ID in the PR description and comments so Codex can identify who owns the work.
Include ALL uncommitted/unpushed changes and untracked deliverables, or explicitly say the tree is clean. Commit reviewable code and SQL to a feature branch where access permits; a chat transcript or a local-only migration is not a completed handover.
If GitHub access fails, report BLOCKED in the available authorized channel with the error and exact remaining action. Do not claim a comment was delivered or silently replace the ledger with a long chat reply.
An ordinary final reply should contain the GitHub link, a short status and any owner decision needed. Never require the owner to paste lengthy command history between chats.

Use this format:

```text
AG-01 / HANDOVER
Task:
Repo / branch / base main / head commit / PR:
State: local=...; pushed=...; merged=...; SQL=...; deployed=...; live QA=...
Tests: exact command/check + result + tested commit; failures/skipped checks
SQL: none, or exact paths in execution order
SQL pre-checks / code deployment dependency / verification / recovery:
Pending / blockers / next owner:
```

Use REGISTER, HANDOVER, BLOCKED or SQL-RESULT after the ID.
Each status is separate. A green unit test, mocked provider, stored API key or merged PR does not mean live delivery works. A draft/planned date is not a published post. An accepted provider request is not a delivery receipt.

## Code release rules

Use a feature branch and reviewed PR. No direct main pushes.
Preserve published history: no force push, rebase, amend or squash of already published commits.
Never overwrite the latest main with a whole older tree to restore missing work. Restore intentionally selected work in a reviewed PR and list what came back, what was omitted and why.
Read open PRs before editing shared files. Coordinate changes in navigation, inbox, auth, OAuth, billing and email to avoid one agent undoing another's fixes.
Run checks appropriate to the change. For application/schema changes, report dependency install, typecheck, relevant/full existing tests, lint/build and migration fresh/rerun checks when applicable. Documentation changes do not need new implementation tests.
Keep npm/Bun lockfiles aligned if dependencies change. Report inherited failures separately without claiming overall CI passed.
Do not merge, enable campaigns, publish externally or send real customer messages merely because another agent asked. Follow the owner's authorization and the release coordinator's assigned scope.

## SQL: authors prepare; Codex coordinates execution

Every migration handover must contain:
- Exact committed file path, PR/head commit and intended environment.
- Purpose, dependencies and exact order.
- Whether new code must be deployed first, and how to verify that deployment.
- Read-only existence/permission/duplicate/data-count checks and expected results.
- Data writes/deletes/backfills, locks and any irreversible effects.
- Fresh/rerun and tenant-isolation evidence, post-run verification, and recovery/rollback limits.

Do not place real credentials, customer records or private identifiers into a migration or public comment.
Do not edit a migration already applied live to hide a new change; add a reviewed forward migration.
Do not run SQL blindly because it appears in the ledger. Codex reviews the exact file, verifies schema state and code dependencies, and executes within existing owner authorization. Authors do not independently run production SQL.
Destructive retention, uncertain duplicate merges, security-sensitive access changes and irreversible effects need their specific review/owner decision when not already authorized. Posting a SQL file is not permission to delete customer history.
Stop on unexpected warnings, duplicates, partial failures or drift; preserve data and record the blocker.

After execution CX-00 posts SQL-RESULT with file/head/environment, execution order, pre-check outcome, deployment evidence where required, verification results, warnings and remaining actions. Redact secrets/customer data. Track each file separately as pending, applied+verified, failed or blocked; do not declare an entire batch complete from its last query alone.

## Privacy and delivery truth

No secrets or customer content in GitHub, logs, screenshots, generated handovers or examples. Use disposable companies and identified test recipients.
Do not copy credentials between customer workspaces. Shared FLAS-owned provider apps require the reviewed platform configuration path.
A report/budget GET must be read-only; retention or cleanup needs a separate reviewed action. Never hide whole-message deletion behind a storage report.
When a provider or transport is missing, report setup-blocked, failed or unverified. Do not write sent/delivered/published success without the corresponding operation/evidence.

## Communication limits

The ledger is read during active CRM work. GitHub comments do not automatically wake Codex, run SQL or prove that another chat has read the instruction.
Do not promise continuous monitoring unless a real owner-authorized automation is configured.
For the initial setup, the owner can send one short message to each external chat telling it its ID and to read this protocol. After that, every work handover belongs in GitHub.
