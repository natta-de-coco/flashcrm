# Batch 2B — Meta asset discovery (Facebook Pages + Instagram Professional)

Status: **built and tested locally. Not pushed, not deployed, not production-ready.**

Builds on Batch 2A's authorization/channel model. No new migration.

## What changed

### One Meta sign-in, both platforms

*Connect Facebook* or *Connect Instagram* starts one Meta authorization. Discovery
returns every Facebook Page the person manages and every Instagram professional account
linked to one of those Pages. The picker groups them — *Facebook Pages (N)*,
*Instagram Professional (N)* — with *Select all* per group. Nothing is preselected when
more than one channel is found, so an agency must choose deliberately. Each Instagram
account shows the Page it is linked to.

One authorization can therefore create several Facebook and Instagram channels. The
user token is stored once, on the authorization.

### Page tokens

A Facebook Page has its own access token, and an Instagram professional account uses the
token of the Page it is linked to. Page tokens:

- are **never** in the discovery list. `parseMetaChannels()` copies named fields only,
  and a test asserts no token reaches a candidate, even when one is on the input.
- are fetched fresh at connect time, with the stored user token.
- are stored encrypted on their own channel (AES-256-GCM, bound to tenant, platform and
  field).

`readTokensForAccount()` uses a channel's own token when it has one, and the
authorization's otherwise.

### The short-lived token defect

Meta's code exchange returns a user token valid for **hours**. Meta's documentation says
Page tokens only stop expiring when obtained **with a long-lived user token** (about 60
days). The previous flow stored the short-lived token and derived Page tokens from it,
so Meta connections could expire within hours of connecting.

`completeChannelAuthorization()` now swaps for the long-lived token **before**
discovery, so every Page token is fetched with it. If the swap fails, the authorization
records `long_lived_exchange_failed` rather than hiding it.

### The app secret was in a URL

`refreshAccessToken()` extended Meta tokens with a GET whose query string carried
`client_secret`. Both the connect-time swap and refresh now use
`exchangeForLongLivedToken()`, which sends a `POST` form body.

Meta documents this call as a GET. The `POST` form was verified on 2026-09-11 with fake
credentials: a `POST` with a bad `client_id` returned *Invalid Client ID*, so the body
was parsed; a `PUT` reported the parameter missing. A test records the outgoing request
and asserts the URL carries neither the secret nor the user token.

### What was granted

Meta's token response carries no scope list, so Flas previously never knew what a
person had granted. Discovery now reads `/me/permissions` and stores the granted list on
the authorization. Eligibility follows it:

- An Instagram account appears but is **not connectable** without `instagram_basic`.
- A Page is not connectable if Page access was not shared.

"Signed in as" shows the Meta account name. Meta shares no email without the `email`
scope, which Flas does not request.

### Progressive scopes

Derived from the registry.

| Platform | First connection | Upgrades | Never requested |
|---|---|---|---|
| Facebook | `public_profile`, `pages_show_list`, `pages_read_engagement`, `read_insights` | Messenger (`pages_messaging`), Replies (`pages_manage_engagement`) | `pages_manage_posts` — publishing is not built |
| Instagram | `public_profile`, `instagram_basic`, `pages_show_list`, `instagram_manage_insights` | Comments (`instagram_manage_comments`, read and reply) | `instagram_content_publish` — publishing is not built |

Before this batch, both connectors requested their publishing scope on every connection,
although Flas has no publishing code.

Instagram offers no read-only comment permission, so the Comments upgrade says plainly
that reading and replying come together.

If `META_LOGIN_CONFIG_ID` is set, Facebook Login for Business sends `config_id` and no
scope list; the configuration then decides what is granted.

### Personal Instagram accounts

Meta's API only exposes Instagram professional accounts linked to a Page, so personal
accounts never appear. The picker says so, rather than leaving the person to wonder
where their account went.

## Tests

| Suite | Result |
|---|---|
| `tests/social-channels.test.mjs` | 38 / 38. New Meta tests cover tiers, the discovery family, parsing, eligibility, no token in any candidate, and the secret staying out of the URL |
| All unit suites | 163 / 163 |
| `tsc --noEmit`, `vite build`, lint | clean (0 lint errors) |

## Remaining limitations

- Not verified against a real Meta app or account; no sandbox credentials were
  available.
- Meta Advanced Access (app review) is still required for these permissions to work for
  anyone outside the app's own Business.
- Legacy Facebook and Instagram connections made before Batch 2A keep working, but are
  not moved to the new model until they reconnect.
- Messenger DM **sending**, Instagram DMs and publishing are not built.

## Provider requirements

- A Meta app with Facebook Login (or Login for Business) and a Business portfolio.
- Advanced Access through App Review for:
  - `pages_show_list`
  - `pages_read_engagement`
  - `read_insights`
  - `instagram_basic`
  - `instagram_manage_insights`
  - optional upgrades: `pages_messaging`, `pages_manage_engagement`,
    `instagram_manage_comments`
- Business verification.
- Redirect URI registered in the Meta app: `https://<staging-origin>/api/public/oauth-callback`

## Configuration (names only)

`META_APP_ID`, `META_APP_SECRET` (or per-workspace keys), `OAUTH_ALLOWED_ORIGINS`,
`SOCIAL_TOKEN_ENCRYPTION_KEYS`, `SOCIAL_TOKEN_ACTIVE_KEY_ID`,
`SUPABASE_SERVICE_ROLE_KEY`, and optionally `META_LOGIN_CONFIG_ID`.

## Rollback

There is no migration to roll back. Revert this commit. Facebook and Instagram then
return to the pre-2B flow; channels connected through 2B keep their encrypted Page
tokens and continue to sync.

**Not production-ready.**
