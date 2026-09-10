# Batch 2A — Add Channel, authorizations and YouTube

Status: **built and tested locally. Not pushed, not deployed, not production-ready.**
Ready for staging SMM testing only once the three configuration items in
section 14 exist on a staging deployment.

## 1. Architecture changes

Authentication and channel connection are separate steps.

```
Person signs in  ->  social_authorizations (tokens, encrypted, stored once)
                          |
                  Flas discovers the channels that person manages
                          |
                  Person chooses which to connect
                          |
                  social_accounts (one row per channel, referencing the authorization)
```

- One authorization can back many channels. Tokens are never copied onto a channel.
- A channel with no `authorization_id` still holds its own token, exactly as before.
  Every connector except YouTube keeps working unchanged.
- `CHANNEL_MODEL_CONNECTORS = ["youtube"]` decides which connectors use the new flow.
  Meta joins in 2B; LinkedIn, TikTok, X and Pinterest in 2C.

## 2. Database changes

`supabase/migrations/20260911100000_social_authorizations.sql`

| Change | Purpose |
|---|---|
| `social_authorizations` table | One person's authorization; tokens encrypted; discovered channels (public metadata) |
| RLS + column grants | Workspace reads safe columns only; no client writes; token columns never granted |
| `social_accounts.authorization_id`, `account_type` | Channels reference their authorization |
| Trigger `enforce_account_authorization_tenant` | A channel cannot reference another workspace's authorization |
| `acquire/release_authorization_refresh_lease` | One refresh per authorization, however many channels share it |
| `oauth_states.purpose / target_account_id / requested_scopes` | What an attempt is for, which channel, which scopes |

Additive and idempotent.

## 3. The authorization / channel model

- `src/lib/social-authorizations.server.ts`: storage, discovery, connection, rebinding,
  refresh, detach.
- Authorization tokens are AES-256-GCM encrypted, bound by AAD to the specific
  authorization row: a token copied to another row does not decrypt.
- `connectDiscoveredChannels()` accepts **ids only** from the browser and resolves them
  against the server's own discovery list. Names, avatars and eligibility never come
  from the request.
- Discovery results expire after 60 minutes; after that the person signs in again.

## 4. YouTube connection flow

1. **Add Channel → YouTube → Connect YouTube.**
2. The permission screen states, in plain language, what Flas asks for and what it will
   not do. Scope names are hidden under *Advanced permission details*.
3. **Continue with Google.** Google always shows its account chooser
   (`prompt=select_account consent`), including Brand Accounts.
4. The callback stores the authorization, calls `channels.list?mine=true` and Google
   userinfo, and redirects to `/channels?authorization=<id>&step=select`. The URL
   carries an opaque id only.
5. The picker shows **Signed in as** separately from the channel being connected, with
   avatar, name, handle, masked ID, subscriber and video counts. One channel is
   preselected; several are never preselected.
6. **Confirm** shows the channel and the Flas access it will get.
7. **Connect** → *YouTube connected successfully* → first sync of videos and statistics.

## 5. Channel discovery

`discoverYouTubeChannels()` → `parseYouTubeChannels()` (pure, fixture-tested).

- A hidden subscriber count is shown as *Hidden*, never 0.
- The channel's own title is used, never the Google account name.
- Candidates carry no token fields; a test asserts it.

## 6. OAuth scopes

Derived from the registry. Nothing is hand-listed in `oauth.server.ts`.

| Tier | Scopes | Offered |
|---|---|---|
| Basic (first connection) | `youtube.readonly`, `openid`, `userinfo.email` | Yes |
| Read public comments | `youtube.force-ssl` | Yes, as an upgrade |
| Reply to comments | `youtube.force-ssl` | **No** — Flas has no YouTube reply code |

`youtube.force-ssl` is described by Google as *"See, edit, and permanently delete your
YouTube videos, ratings, comments and captions"* (verified 2026-09-11). It is therefore
never requested on first connection, and the comments upgrade says plainly what Google
bundles into it.

## 7. Refresh and reconnect

- **Refresh:** health checks refresh a channel's token on its authorization, under the
  authorization lease. A second worker gets `REFRESH_IN_PROGRESS` and does not call
  Google.
- **Reconnect:** Reconnect starts an authorization for that channel. If the same channel
  comes back, the existing row is rebound to the new authorization, keeping its history,
  drafts and settings, and superseded authorizations are cleared. If a different Google
  account signs in, the person lands on the picker instead of a silent rebind.
- **Disconnect:** the provider grant is revoked only when no other channel uses the same
  authorization. The channel's link to its authorization is cleared; history is kept.

## 8. Capability gating

`src/lib/social-channel-capabilities.ts` (pure). Each capability on each channel is one of:

- `available`
- `needs_permission` (an upgrade not yet turned on)
- `declined` (asked for, refused on the consent screen)
- `not_implemented`
- `not_supported`

"Missing" now means *requested but not granted*. An optional tier nobody turned on is an
upgrade, not a fault. This had to change: under the old rule, every basic-access channel
would have read *missing permission*.

Cards show *Connected — N of M enabled capabilities operational*, never a bare
*Healthy*. Generic unsupported rows are omitted; provider-specific ones (for example,
*YouTube has no private direct-message API*) are shown.

## 9. UI

- `/channels` (Social Channels):
  - summary counts, *+ Add Channel*, cards grouped by platform
  - on each card: Manage (optional access with Enable buttons), Reconnect, Disconnect
- `SocialConnectionWizard`: social channels and *Advertising & Analytics* in separate
  sections; TikTok Ads disabled.
- `ChannelPicker`: select → confirm → connected.
- Navigation: *Social Channels*. Social Hub's button now reads *Add Channel*.

Rendered and checked in a local browser; see section 17.

## 10. Automated tests

| Suite | Result |
|---|---|
| `tests/social-channels.test.mjs` (new) | 27 / 27; `MUTATION=grant_all` → 3 fail, as required |
| All unit suites | 152 / 152 |
| `supabase/verify/verify-social-authorizations.mjs` (new) | all pass; `SABOTAGE=1` → 5 fail, as required |
| 10 existing database suites | all pass with the new migration applied |
| `tsc --noEmit`, `vite build`, lint | clean (0 lint errors) |

## 11. Security tests

- Members cannot read authorization tokens, create authorizations or rewrite granted
  scopes. Checked both as declared privileges and by attempting the writes.
- A workspace cannot see another's authorizations, even by id.
- A channel cannot reference another workspace's authorization, on insert or update.
- Deleting an authorization detaches its channels; no token path remains.
- Two concurrent refreshes of one authorization call the provider once.
- `oauth_states.purpose` rejects anything but connect / reconnect / upgrade.

## 12. Remaining limitations

- Only YouTube uses the new model. Every other platform still uses the one-account flow.
- YouTube comment **replies** are not built.
- Team and channel-level permissions (Batch 2G) do not exist yet. Any workspace member
  can connect or disconnect a channel, as before.
- Failed YouTube authorizations still land on the Social Hub error banner rather than on
  `/channels`.
- Channel health uses a live Google token check (`tokeninfo`); it does not yet test each
  capability separately.
- Not verified against a real Google account: no sandbox credentials were available here.

## 13. Provider applications and reviews still required

- Google OAuth consent screen verification for the sensitive scopes
  (`youtube.readonly`, and `youtube.force-ssl` for the comments upgrade).
- YouTube API Services compliance audit, needed before raising Data API quota.

## 14. Configuration needed (names only, never values)

| Setting | Why |
|---|---|
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | Flas's Google app, or per-workspace keys under Platform app keys |
| `OAUTH_ALLOWED_ORIGINS` | The staging origin; without it every sign-in is refused |
| `SOCIAL_TOKEN_ENCRYPTION_KEYS`, `SOCIAL_TOKEN_ACTIVE_KEY_ID` | Without them connecting refuses to start (fail closed) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side writes |

Also register this redirect URI in the Google Cloud project:
`https://<staging-origin>/api/public/oauth-callback`

Test with a Google account that owns a YouTube channel. Brand Accounts are chosen on
Google's own screen.

## 15. Rollback

1. Roll back the application first (revert the Batch 2A commit). Channels created by the
   new flow hold no token of their own.
2. Run the rollback block at the bottom of `20260911100000_social_authorizations.sql`.
3. Channels connected through the new flow must then reconnect.

## 16. Readiness

**Ready for staging SMM testing: not yet.** The code is complete for 2A and its
automated gates pass, but it has never run against a real Google account. It becomes
ready the moment a staging deployment has the section 14 settings and one Google test
account completes the flow. Batch 1 is also still marked not ready for Antigravity
verification.

**Not production-ready.**

## 17. Verified in a local browser

The wizard was rendered on the local dev server through a temporary preview route, which
was deleted before commit. `/channels` itself needs a signed-in workspace, and no test
account was created.

**Platform grid**
- Capability labels come from the registry.
- Each provider's "no DM API" note appears once.
- Capabilities gated by provider review read *after provider review*.
- Social channels and *Advertising & Analytics* are separate sections.
- TikTok Ads, Threads, Google Analytics 4, and the other platforms where Flas has built
  nothing, show a disabled *Not available*.

**YouTube permission step**
- Shows the plain-language request, the *Flas will not* list, account-choice guidance and
  *Continue with Google*.
- *Advanced permission details* lists exactly `openid`, `userinfo.email` and
  `youtube.readonly`. `youtube.force-ssl` is absent.

**Defects the browser check found and fixed before commit**
1. Duplicate notes, which also caused React key collisions.
2. Raw capability keys shown as labels.
3. Plain ticks on capabilities that need provider review.
4. Connect buttons on platforms Flas cannot use.

**Console:** no application errors. One `ERR_BLOCKED_BY_CLIENT` came from a browser
extension.

**Not rendered:** the connection manager and the channel picker with real data. Both need
a signed-in workspace and a real Google authorization.
