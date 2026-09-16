# Social onboarding: release evidence and remaining admin steps

Status: 2026-09-16. Engineering changes are for a review branch, not a production release. No provider-console credentials were created or rotated, no hosted migrations were applied, and no production deploy was performed.

## What this change provides

- Add Integration → choose provider → Continue with provider → choose the accessible Page/channel/account → connected. OAuth uses the same browser tab and returns to `/connect` with the correct pending account selected.
- Shared FLAS app credentials remain server-side. Regular members do not see credential forms, callback URLs, scopes or developer setup. Workspace-owned apps are an explicit advanced admin option.
- Readiness and the actual authorization handler share checks for credentials, allowed return origin, public origin, encryption and OAuth storage/migration guards. `Available` means the local prerequisites to begin OAuth pass. It does **not** certify app review, redirect registration, consent completion or provider API access. Admin diagnostics list every discovered blocker; provider-console checks remain explicitly unverified.
- Explicit Page/Instagram, YouTube channel, GBP location, LinkedIn organization, GA4 property and Meta ad-account selection. Lists paginate, fail on incomplete provider responses and revalidate selection server-side against the authorized tenant/account. YouTube lists channels accessible to the current grant; it does not promise access to every Brand Account.
- Reconnection preserves the existing tenant/platform/external-ID row, history and an existing refresh token if the provider omits a replacement. New OAuth credentials cannot be stored without encryption.
- WhatsApp number lookup cannot fall back to an unbound shared number. Encrypted number tokens can be read. Webhook signatures are checked for every routed number in a batch.
- WhatsApp/website AI replies use the workspace's instructions, latest 30 messages and a bounded snapshot of up to 50 catalog products. Instructions favor warm, short, casual replies in the customer's language, without claiming to be human or inventing prices, currency, stock, delivery promises or completed orders. Missing/invalid AI responses and handoff requests pause the bot and mark the conversation pending for the team.

## What is still limited

| Connector | Current scope and remaining work |
| --- | --- |
| Facebook | Page selection, read posts/comments/Messenger, comment replies and basic insights exist. Publishing, outbound Messenger replies and a real-time Messenger bot/webhook flow are not finished. Test the granted permissions with a real Page. |
| Instagram | Facebook Login path for a professional account linked to a Page; account/media/comments/insights and comment replies. Instagram DMs and publishing are not implemented. The WhatsApp chatbot is not an Instagram chatbot. |
| WhatsApp | Existing registered numbers have inbox/webhook/text/template paths. Simple Embedded Signup, WABA/number selection and customer-owned business onboarding are not implemented and remain Coming soon. CRM catalog grounding is not Meta catalog synchronization, product-message sending or a checkout/order integration. |
| YouTube | Explicit channel selection, read videos/comments/public counts. No upload or comment replies. |
| Google Business Profile | Explicit location selection; API access approval and location permissions still require a real project/account test. No GBP messaging. |
| LinkedIn | Organization selection and implemented read/analytics paths require approved Community Management access. No publishing. |
| TikTok | Profile and video metrics through Login Kit/Display API. No publishing. |
| X | Profile/post reads and public metrics; actual access/quota depends on the configured developer account. No publishing or DMs. |
| Pinterest | Profile connection only. Pin sync, publishing and analytics remain unavailable. |
| Threads, Shopify, WooCommerce | Unfinished login/connectors remain Coming soon. |

Chatbot limitations: live model wording and JSON output must be exercised against the configured AI gateway; automated tests use controlled replies. Catalog retrieval is a capped snapshot rather than semantic search. Business-hours scheduling is disabled and marked coming soon. The customer chatbot currently uses the shared Lovable gateway, not the separate internal-agent BYO AI flow. Existing legacy WhatsApp admin entry/rotation paths still need migration to encrypted server-only writes before any broader WhatsApp onboarding launch; accepting encrypted tokens on read does not retroactively encrypt old rows.

## Staging setup: admin only

1. Identify the **staging** Lovable deployment and Supabase project. Do not assume `flas.mobidigisol.com` or the repository's project ID is staging. Neither a confirmed staging URL nor an authenticated staging/provider-console session was available during this work.
2. Take a staging database backup and review/apply all pending repository migrations in timestamp order. This includes the OAuth hash/state/tenant/grant migrations, channel-identity unique index and `20260914170000_integration_storage_readiness.sql`. Do not apply only the last migration to an older schema. The preflight intentionally blocks older/unsafe storage. Check `integration_oauth_storage_ready()` using the service role; it must return true and must not be callable by browser roles.
3. Configure existing credentials through the deployment's secret store, never through chat or public frontend variables. Set `PUBLIC_APP_URL` to the exact staging HTTPS origin and `OAUTH_ALLOWED_ORIGINS` to an explicit comma-separated allowlist. Set `TOKEN_ENCRYPTION_KEYS` to the deployment's approved AES-256 keyring (32-byte keys encoded as base64, `keyId:key` entries). Preserve older keys until all corresponding ciphertext has been migrated; do not rotate during a connection test.
4. Set provider keys only on the server:

   | Family | Server settings |
   | --- | --- |
   | Meta | `META_APP_ID`, `META_APP_SECRET`; optional `META_LOGIN_CONFIG_ID` belonging to that same shared app |
   | Google | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` |
   | LinkedIn | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` |
   | TikTok | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` |
   | X | `X_CLIENT_ID`, `X_CLIENT_SECRET` |
   | Pinterest | `PINTEREST_APP_ID`, `PINTEREST_APP_SECRET` |

5. In each authorized provider console, register exactly `https://<staging-host>/api/public/oauth-callback`. Match the app type, configured product and permissions to `src/lib/social-connector-definitions.ts`. Use test users/assets while the app is in development. Credential presence cannot establish approved access or a correctly registered redirect.
6. Meta: verify the existing FLAS app's Facebook Login configuration, HTTPS/domain settings, privacy/data-deletion settings and review/access for the requested permissions. Facebook uses Page listing/read/engagement/Messenger/insights permissions recorded in the registry. Instagram uses `instagram_basic`, `instagram_manage_comments`, `instagram_manage_insights`, `pages_show_list`, `pages_read_engagement`. Confirm the user controls the Page and its linked professional Instagram account. If using `META_LOGIN_CONFIG_ID`, ensure its configuration grants the intended permissions; the code does not send a conflicting scope list alongside it.
7. Google: enable YouTube Data API and/or the appropriate Business Profile APIs for the existing project, configure its OAuth consent audience/test users, and complete required verification/access approval. LinkedIn needs the approved Community Management product. TikTok needs Login Kit/Display API. X and Pinterest need usable application access for their respective endpoints. Do not mark any of these reviewed based solely on a successful URL redirect.
8. Existing WhatsApp testing requires a tenant-bound, active `wa_numbers` record, an authorized token and the matching app secret; encrypted values need the same keyring as the app. Configure `WHATSAPP_APP_SECRET` only as the shared-app signature secret, `WHATSAPP_VERIFY_TOKEN` for verification, and subscribe the authorized app to the correct business/number. Callback: `https://<staging-host>/api/public/whatsapp/webhook`. Environment-only access-token/phone-number fallbacks are intentionally no longer used. Unknown/inactive numbers are rejected. Embedded Signup must be built and reviewed separately; do not use the Facebook Page picker for WhatsApp.
9. Configure the existing `LOVABLE_API_KEY` server-side and verify credits/model access. Set tenant-specific chatbot instructions and greeting. A legacy global `bot_settings` singleton is no longer inherited by unrelated workspaces. If an older workspace relied on that row, copy only its own business settings into its tenant row through an authorized admin workflow.

## Required live acceptance before claiming readiness

Use two staging workspaces with distinct accounts and at least one non-admin member.

- A member can begin a configured connection without seeing app keys, tokens, callbacks or scopes. An unconfigured provider is disabled; an admin can see all missing prerequisites.
- Meta success, denied consent, closed/abandoned flow, revoked permission, no Pages, no linked professional Instagram, multiple Pages and a later discovery-page failure all end in an accurate state. No failure is shown as connected.
- Choose an asset, reconnect the same asset and confirm one stable account ID and intact history. Repeat with a different asset and a second workspace. Cross-workspace pending IDs and asset IDs must be rejected.
- Reload while selection is pending; Finish connecting resumes the correct picker. Replayed/expired/tampered OAuth state must not exchange credentials. Verify encrypted stored credentials without printing them.
- Read an actual Facebook/Instagram post/comment, reply where implemented and verify the result in the provider UI. Check reconnect after revocation. This does not test unimplemented DMs/publishing.
- WhatsApp: receive an actual customer message, deliver a reply, observe its delivery status, test an approved template under the provider's messaging rules, reject a bad signature/unknown number/mixed-app batch, and verify tenant routing. Verify retries and duplicate delivery handling with real webhook events.
- Ask the bot about a known product, a missing product, currency, stock, delivery, refund and a human. Verify no invented facts, conversational wording, last-message context and that handoff actually stops subsequent automatic replies. Repeat in the customer's language and test gateway failure/timeout. Team queue placement is not a guarantee a staff member is online.

## Evidence

Local automated checks exercise code behavior with provider/database doubles. Disposable PostgreSQL checks cover migration compilation, OAuth single-use/replay/expiry, tenant isolation and preflight tampering. These are not hosted staging evidence. A first fresh-database migration run succeeded; the historical baseline contains 22 migrations that are not designed to rerun, while the pending security migrations reran successfully. After integrating the later upstream migrations, the local PostgreSQL rerun was blocked by the Windows sandbox runtime (uv_os_get_passwd). The CI database job now checks the combined migration sequence, OAuth state security and social tenant isolation. Its result is a separate release gate.

Official references: [Meta Instagram with Facebook Login](https://www.postman.com/meta/instagram/folder/9cgqucg/instagram-api-with-facebook-login), [YouTube channels.list](https://developers.google.com/youtube/v3/docs/channels/list), [GBP accounts.list](https://developers.google.com/my-business/reference/accountmanagement/rest/v1/accounts/list), [LinkedIn organization access](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-access-control-by-role), [Lovable AI](https://docs.lovable.dev/features/ai). Provider behavior and approval state require live verification for the actual FLAS apps.
