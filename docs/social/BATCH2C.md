# Batch 2C — LinkedIn Pages, TikTok, X and Pinterest

Status: **built and tested locally. Not pushed, not deployed, not production-ready.**

These four connectors now use the Batch 2A authorization/channel model. There is no new migration.

## Defects found and fixed

Found while verifying provider facts against official documentation on 2026-09-11.

| # | Defect | Effect | Fix |
|---|---|---|---|
| 1 | LinkedIn calls sent `LinkedIn-Version: 202405` | That version was retired long ago. Microsoft's docs list 2025-08 to 2026-08 as supported and say even 202508 sunsets on 17 August 2026, so every LinkedIn sync was refused | `LINKEDIN_API_VERSION = "202608"` in `src/lib/linkedin-api.ts`, one shared constant |
| 2 | Pinterest's code exchange and refresh put `client_id` and `client_secret` in the body | Pinterest authenticates the client with HTTP Basic, so its token exchange would fail | `tokenRequestHeaders()` sends `Authorization: Basic`; the secret is no longer in the body |
| 3 | X's code exchange put `client_secret` in the body | X's docs say confidential clients "will need to use a basic authentication scheme" | Basic header; `client_id` and the PKCE verifier stay in the body; no secret in the body |
| 4 | LinkedIn requested `w_organization_social` (posting) | A write permission for code that does not exist | Moved to a publishing tier that cannot be requested while it is not built |
| 5 | X requested `tweet.write` | Same | Same |
| 6 | Pinterest requested `pins:write`, `boards:read` and `pins:read` | Three permissions with no code using them | It now requests only `user_accounts:read` |

## What changed

### Add Channel works for all four

Each connector's flow is now platform → sign in → permissions → discover → select → connect. Nobody types an organization id or a token.

| Platform | How the channel is found | Channel id stored (what the sync expects) |
|---|---|---|
| LinkedIn | `GET /rest/organizationAcls?q=roleAssignee&state=APPROVED`; then `/rest/organizations?ids=List(…)` for Pages the person administers, and `/rest/organizationsLookup` for the others | numeric organization id |
| TikTok | `GET /v2/user/info/`, asking only for fields covered by the granted scopes | `open_id` |
| X | `GET /2/users/me` | numeric user id |
| Pinterest | `GET /v5/user_account` | account id |

### LinkedIn roles

The picker shows every Page the member has an approved role on, with that role. Only a **Super admin** can connect one: LinkedIn returns a Page's full record and its statistics to no other role. An Analyst or Content admin sees the Page greyed out with the reason, instead of connecting a channel whose first sync would be refused.

A member with no admin role anywhere is told to ask a Super admin to add them.

### Progressive scopes

Derived from the registry.

| Platform | First connection | Never requested (not built) |
|---|---|---|
| LinkedIn | `r_organization_social`, `rw_organization_admin` | `w_organization_social` |
| TikTok | `user.info.basic`, `user.info.profile`, `user.info.stats`, `video.list` | `video.publish`, `video.upload` |
| X | `tweet.read`, `users.read`, `offline.access` | `tweet.write`, `dm.read`, `dm.write` |
| Pinterest | `user_accounts:read` | `pins:write`, `boards:read`, `pins:read` |

LinkedIn has no narrower read-only permission for Page details and statistics. Its lookup and statistics APIs list `rw_organization_admin`, described as "Manage organization pages and retrieve reporting data". The permission screen says so, and says Flas changes nothing.

X's `offline.access` is what returns a refresh token. Without it the access token lasts two hours, and the channel dies with it.

### Wizard and picker

- Each provider has its own account-choice note, replacing the Google note every platform showed before.
- Each provider has its own empty-state message.
- The second metric has the right name: Videos, Pins or Posts.

## Tests

| Suite | Result |
|---|---|
| `tests/social-channels-2c.test.mjs` (new) | 23 / 23. Covers: scopes, the unofferable publishing tier, LinkedIn roles and URNs, fetch shape (version header, token never in a URL), TikTok field gating, the Basic-auth code exchange for Pinterest and X |
| `MUTATION=legacy_scopes` | fails 4, as required |
| `tests/social-channels.test.mjs` | 37 / 37; `MUTATION=grant_all` fails 3, as required |
| All unit suites | 185 / 185 |
| `tsc --noEmit`, `vite build` | clean |
| eslint on the changed files | 0 errors. `eslint --fix` also cleared 55 prettier errors that were already in `HEAD`. That is formatting only (line wrapping and spacing), but it is more than whitespace: `git diff -w` grew from 496+/33− to 750+/101−. Tests, `tsc` and the build pass after it |

The LinkedIn fetch test found a real bug. A pending Super admin request was looked up as an administered Page, because only the parser filtered by `state`. The fetcher now filters too.

## Remaining limitations

- Nothing was checked against real provider apps or accounts. No sandbox credentials were available.
- LinkedIn needs Community Management API approval before any organization scope is granted.
- LinkedIn Page logos are media-asset URNs, not URLs, so the picker shows a placeholder.
- Pinterest has no content sync: connecting validates the account and nothing more.
- Connections made before 2C keep working, but only move to the new model when they reconnect.
- Publishing, comments and DMs on these four platforms are not built.

## Provider requirements

- **LinkedIn:** a Developer app with Community Management API access. Redirect URI `https://<staging-origin>/api/public/oauth-callback`.
- **TikTok:** Login Kit and Display API approved; the redirect URI registered.
- **X:** an OAuth 2.0 confidential client with the redirect URI registered, and a paid tier for useful read volume.
- **Pinterest:** an app with Standard access for production and the redirect URI registered.

## Configuration (names only)

`LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `X_CLIENT_ID`, `X_CLIENT_SECRET`, `PINTEREST_APP_ID`, `PINTEREST_APP_SECRET`, plus the Batch 2A set: `OAUTH_ALLOWED_ORIGINS`, `SOCIAL_TOKEN_ENCRYPTION_KEYS`, `SOCIAL_TOKEN_ACTIVE_KEY_ID`, `SUPABASE_SERVICE_ROLE_KEY`.

## Rollback

There is no migration. Revert the commit.

Channels connected through 2C keep their `authorization_id`, and their tokens stay encrypted on the authorization, so they keep syncing. Reverting also brings back the retired LinkedIn version and the old Pinterest and X token requests, which were broken before.

**Not production-ready.**
