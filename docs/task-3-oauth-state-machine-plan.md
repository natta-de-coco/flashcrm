# Task 3 — OAuth connection state machine: preparation

**Status: not started.** This document is the inspection and design that the
brief asks for before code changes. Nothing in Task 3 has been implemented.

Everything below was verified against the repository on 2026-09-08. File and
line references are real; claims about behaviour were read from the code rather
than inferred from names.

---

## 1. What exists today

### 1.1 There is no connection state column

State is inferred at read time from four fields on `social_accounts`:

| Column | Purpose today |
|---|---|
| `active` (bool) | Set false on manual disconnect |
| `health` (text, default `'unknown'`) | Only ever written as `connected`, `disconnected`, `attention` |
| `token_expires_at` | Compared against now |
| `last_synced_at` | Staleness |

`computeHealth()` — `src/lib/connections.server.ts:110` — collapses everything
into three values:

```
!active || !access_token          -> disconnected
token_expires_at in the past      -> disconnected
expires within 72h                -> attention
never synced                      -> attention
last sync older than 7 days       -> attention
otherwise                         -> connected
```

The consequence is that **six distinct situations report as `disconnected`**: a
user who pressed Disconnect, a token that expired, a token the provider
revoked, a connection whose refresh failed, one that never completed
authorization, and one whose app credentials were removed. Each needs a
different message and a different next action, and today they are
indistinguishable.

Supporting columns already exist and are unused for state: `status_reason`,
`last_error`, `last_error_at`, `retry_count`, `next_retry_at`, `last_retry_at`,
`granted_scopes`, `token_expires_at`.

### 1.2 The OAuth attempt table is sound; its housekeeping never runs

`oauth_states` has `state`, `tenant_id`, `user_id`, `platform`, `redirect_uri`,
`code_verifier`, `created_at`, `expires_at` (default now + 15 minutes) and
`used_at`. `consume_oauth_state()` is single-use and guarded by
`used_at IS NULL AND expires_at > now()`, which is the right shape.

`purge_expired_oauth_states()` exists in
`20260830010000_super_admin_lockdown_and_oauth_reliability.sql:264` and
**nothing calls it.** It appears once in `src/` — as a generated type
declaration in `integrations/supabase/types.ts`, not a call site. There is no
scheduler, no cron entry and no server function invoking it, so abandoned
attempt rows accumulate indefinitely.

### 1.3 An abandoned authorization has no terminal event

`connection.authorize_started` is written in `connections.functions.ts:81`.
Terminal outcomes (`succeeded`, `cancelled`, `expired`, `failed`) are written
in `oauth-callback.ts` — but **only if the callback is reached**. A user who
closes the provider tab never returns, so the audit log keeps a start with no
finish. This is precisely the brief's complaint, and adding outcomes to the
callback did not fix it because the callback never runs in that case.

### 1.4 The scope-completeness check is dead code

`connection-status.ts:101` reads:

```ts
const permissions = account.permissions ?? [];
if (required && permissions.length > 0) { ... }
```

It types `permissions?: string[]`, but `connections.server.ts:168` writes it as
a JSON **object**:

```ts
permissions: { granted: args.permissions }
```

`{...}.length` is `undefined`, so the guard is never true and the missing-scope
branch has never executed. Separately, `REQUIRED_PERMISSIONS` lists scopes Flas
does not request — `instagram_manage_messages`, `video.publish` — so even with
the shape corrected it would report those as permanently missing.

The correct input is the `granted_scopes` column, which does hold real scopes
from the token response.

### 1.5 REQUIRED_PERMISSIONS is a fourth scope list

Task 2 removed three duplicated scope lists. `REQUIRED_PERMISSIONS` in
`connection-status.ts:42` survived, is keyed by the old broad capability
vocabulary, and disagrees with the registry. Task 3 should delete it and derive
from `social-connector-definitions.ts`.

### 1.6 Token refresh exists but is only reactive

`refreshAccessToken()` — `oauth.server.ts:~340` — is called from exactly one
place, `integration-health.server.ts:297`, during a manual retry. Nothing
refreshes proactively ahead of `token_expires_at`, and there is no locking, so
two concurrent retries would both refresh.

---

## 2. Design question to settle before coding

**The thirteen states in the brief are two lifecycles, not one.**

Some describe a *connection* that persists (`connected`, `revoked`,
`disconnected`, `token_expiring`). Others describe a single *authorization
attempt* that is over in minutes (`authorization_started`,
`authorization_cancelled`, `callback_error`). Storing both on one column means
a live, healthy connection is overwritten by a failed re-authorization attempt
— the customer loses a working integration because a second attempt went wrong.

Recommended split:

- **Connection state** on `social_accounts.connection_state` — the durable
  status of the integration.
- **Attempt state** on `oauth_states.attempt_state` — the lifecycle of one
  authorization, which already has the right row and expiry.

The UI reads the connection state and shows the most recent attempt alongside
it when the attempt failed. This keeps "you have a working Instagram
connection" and "your last attempt to reconnect was cancelled" as separate,
simultaneously true facts.

**This needs your decision**, because the brief implies a single model. The
rest of this plan assumes the split; say the word and I will fold it into one
column instead.

---

## 3. Proposed model

### 3.1 Connection state (`social_accounts.connection_state`)

| State | Meaning | Entered from |
|---|---|---|
| `not_configured` | No account row, or no platform app for this provider | initial |
| `missing_app_credentials` | Connector needs app keys the workspace has not supplied | not_configured |
| `ready_to_authorize` | Credentials present, no authorized account yet | missing_app_credentials |
| `connected` | Valid token, required scopes granted | ready_to_authorize, token_expiring, refresh_failed |
| `scope_incomplete` | Authorized, but a scope needed by an advertised capability was declined | connected |
| `token_expiring` | `token_expires_at` within the refresh window | connected |
| `refresh_failed` | Refresh attempted and rejected; retry scheduled | token_expiring |
| `revoked` | Provider says the grant is gone (401/190) | any authorized state |
| `disconnected` | The customer disconnected it deliberately | any authorized state |
| `provider_unavailable` | Provider returning 5xx or rate limiting; not our fault, not the customer's | connected, token_expiring |

`provider_unavailable` is deliberately **transient and non-destructive** — it
must never clear a token, or a provider outage would log every customer out.

### 3.2 Attempt state (`oauth_states.attempt_state`)

| State | Meaning |
|---|---|
| `started` | Authorization URL issued, row created |
| `callback_received` | Callback arrived and state consumed |
| `cancelled` | Provider returned an error or the user declined |
| `callback_error` | Token exchange or profile discovery failed |
| `expired` | `expires_at` passed with `used_at` still null — **the abandoned case** |
| `completed` | Connection saved |

### 3.3 Transition rules

Every transition is validated server-side in one function, and an illegal
transition raises rather than writing. The table above is the whitelist; nothing
else is permitted. Each accepted transition writes
`connection.state_changed` to the audit log with `from`, `to`, `reason` and
`platform`.

---

## 4. Timeout handling for abandoned attempts

Two mechanisms, because one is not enough:

1. **On read.** Any `oauth_states` row with `used_at IS NULL` and
   `expires_at < now()` is reported as `expired`. This is correct immediately
   and needs no scheduler, so an abandoned attempt stops showing as "started"
   the moment anyone looks.
2. **On sweep.** A server function calls the existing
   `purge_expired_oauth_states()`, writing one `connection.authorize_expired`
   audit row per attempt it retires before deleting. Invoked from the manager
   portal and, once Task 3 lands, on a schedule.

Deriving on read means correctness does not depend on the sweep running — which
matters, because the sweep has existed and never run for the life of the table.

---

## 5. Migration plan

One migration, `2026090810xxxx_oauth_connection_state.sql`:

- `ALTER TABLE social_accounts ADD COLUMN connection_state text` with a CHECK
  constraint listing the ten values, `NOT NULL DEFAULT 'not_configured'`.
- Backfill from existing data: `active AND access_token AND token_expires_at
  in future` → `connected`; expired → `token_expiring`; `NOT active` →
  `disconnected`; else `ready_to_authorize`.
- `ALTER TABLE oauth_states ADD COLUMN attempt_state text` with a CHECK
  constraint, defaulting to `started`; backfill `used_at IS NOT NULL` →
  `completed`, expired-and-unused → `expired`.
- Index `social_accounts (tenant_id, connection_state)` — the manager portal
  will filter on it.
- Keep `health` for one release so nothing breaks mid-deploy, then remove it in
  a follow-up once no reader remains.

Idempotent, transactional, and verifiable with the existing harness
(`supabase/verify/verify-migrations.mjs`) before it goes near production.

---

## 6. Test plan

Added to `supabase/verify/` and `tests/`:

- Every legal transition is accepted; a sample of illegal ones raises.
- An abandoned attempt reads as `expired` without the sweep running.
- The sweep writes one audit row per retired attempt.
- A failed re-authorization does not downgrade a working connection.
- `provider_unavailable` never clears a token.
- `scope_incomplete` is computed from `granted_scopes` against the registry,
  and a connector with all scopes granted does not report it.
- Backfill correctness: a table of pre-migration rows and the state each must
  land in.
- A mutation run that removes the transition guard must fail the suite.

---

## 7. Open items needing your decision

1. **Split model or single column** (section 2). My recommendation is split.
2. **Refresh window** — how far ahead of expiry to enter `token_expiring`.
   72 hours matches the current `computeHealth` behaviour.
3. **Whether `provider_unavailable` should suppress customer-facing alerts.**
   It is not the customer's problem to fix, so I would not alert them.
4. **Retention for retired `oauth_states` rows** — currently deleted after one
   day. Keeping the audit row instead of the state row preserves the history
   without keeping a consumable token.

---

## 8. Rollback

The migration only adds columns and an index, so rollback is:

```sql
ALTER TABLE public.social_accounts DROP COLUMN IF EXISTS connection_state;
ALTER TABLE public.oauth_states DROP COLUMN IF EXISTS attempt_state;
DROP INDEX IF EXISTS social_accounts_tenant_state_idx;
```

`health` is retained through the transition, so reverting the code alone
restores previous behaviour without touching the database.

---

## 9. Scope boundary

Task 3 is the state model, its transitions, timeout handling and audit. It does
**not** include Task 4's OAuth security work (encryption at rest, key rotation,
refresh locking, replay hardening) or Task 5's adapter contract, even where
this document notes them — the missing refresh lock in section 1.6 is a Task 4
item and is recorded here only so it is not lost.
