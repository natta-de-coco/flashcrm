# Social capability matrix

**Generated from `src/lib/social-connector-definitions.ts` — do not edit by hand.**
Regenerate with `npm run docs:capabilities`.

Generated 2026-09-11 · 19 connectors (15 API platform connectors using OAuth, 4 connected with keys or a plugin).

## How to read this

Two different things are recorded, and they must not be confused:

- **Provider** — does the platform expose an API for this at all.
- **Flas** — has Flas written the code that uses it.

A capability is only usable when both are true *and* the scope it needs is actually
requested at authorization. This document describes the static definition; what one
connected account can do right now lives in the `social_capabilities` table and can
only ever be narrower.

- `implemented` — Available
- `scope_not_requested` — Missing permission
- `not_implemented` — Not implemented yet
- `requires_provider_review` — Requires provider review
- `limited_by_account_type` — Limited by account type
- `not_supported` — Not supported by provider

## Summary

| Connector | Profile | Publishing | Read comments | Reply to comments | Read DMs | Send DMs | Read reviews | Reply to reviews | Analytics | Read ads | Manage ads | Webhooks |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Facebook Pages | yes | provider only | review | review | review | provider only | — | — | review | — | — | provider only |
| Instagram Professional | account type | provider only | review | review | provider only | provider only | — | — | review | — | — | — |
| Threads | provider only | provider only | provider only | provider only | — | — | — | — | provider only | — | — | — |
| LinkedIn Company Pages | review | provider only | provider only | provider only | — | — | — | — | review | — | — | — |
| TikTok | yes | provider only | provider only | provider only | — | — | — | — | yes | — | — | — |
| YouTube | review | provider only | review | provider only | — | — | — | — | review | — | — | — |
| X (Twitter) | yes | provider only | provider only | provider only | provider only | provider only | — | — | yes | — | — | — |
| Google Business Profile | review | provider only | — | — | — | — | review | provider only | provider only | — | — | — |
| Pinterest | yes | provider only | provider only | — | — | — | — | — | provider only | — | — | — |
| WhatsApp Business | review | — | — | — | review | review | — | — | review | — | — | review |
| Meta Ads | review | — | — | — | — | — | — | — | — | provider only | provider only | — |
| Google Ads | provider only | — | — | — | — | — | — | — | — | provider only | provider only | — |
| LinkedIn Ads | provider only | — | — | — | — | — | — | — | — | provider only | — | — |
| TikTok Ads | yes | — | — | — | — | — | — | — | — | provider only | provider only | — |
| Google Analytics 4 | provider only | — | — | — | — | — | — | — | provider only | — | — | — |
| Google Search Console | review | — | — | — | — | — | — | — | provider only | — | — | — |
| WordPress | yes | yes | — | — | — | — | — | — | — | — | — | — |
| Shopify | yes | — | — | — | — | — | — | — | — | — | — | — |
| WooCommerce | yes | — | — | — | — | — | — | — | — | — | — | — |

## Connectors

### Facebook Pages

- **ID**: `facebook` · **Category**: social · **Auth**: oauth2
- **Account types**: Facebook Page (admin access via a Business account)
- **Provider review required**: yes · **Sandbox**: yes · **Last verified**: 2026-09-08
- **Requested scopes**: `pages_show_list`, `pages_read_engagement`, `pages_read_user_content`, `pages_messaging`, `pages_manage_metadata`, `read_insights`, `pages_manage_engagement`
- **Not requested**: `pages_manage_posts`
- **Setup**: Meta app with Facebook Login for Business; Business verification for Advanced Access; The connecting user must be an admin of the Page
- **Docs**: <https://developers.facebook.com/docs/pages-api> · <https://developers.facebook.com/docs/permissions/reference/pages_manage_engagement>

| Capability | Provider | Flas | Status | Required scopes | Note |
|---|---|---|---|---|---|
| Profile | yes | yes | Available | `pages_show_list` |  |
| Publishing | yes | no | Not implemented yet | `pages_manage_posts` | The scope is requested, but Flas has no code that creates a Facebook post. |
| Read comments | yes | yes | Requires provider review | `pages_read_engagement` |  |
| Reply to comments | yes | yes | Requires provider review | `pages_manage_engagement` | Needs Meta Advanced Access for pages_manage_engagement. Pages connected before 2026-09-10 must reconnect to grant it. |
| Read DMs | yes | yes | Requires provider review | `pages_messaging` | Messenger conversations on the Page. Requires Advanced Access to pages_messaging. |
| Send DMs | yes | no | Not implemented yet | `pages_messaging` | Messenger send is not built. Meta's 24-hour messaging window would apply. |
| Read reviews | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Reply to reviews | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Analytics | yes | yes | Requires provider review | `read_insights` | Follower counts and post engagement. Full Page Insights are not pulled. |
| Read ads | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Manage ads | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Webhooks | yes | no | Not implemented yet | `pages_manage_metadata` | Page webhooks are not subscribed. |

**Known limitations**
- Advanced Access requires Meta app review before the connector works for anyone outside your own Business.
- Conversations older than the Page's retention window are not returned.

### Instagram Professional

- **ID**: `instagram` · **Category**: social · **Auth**: oauth2
- **Account types**: Instagram Business account linked to a Facebook Page; Instagram Creator account linked to a Facebook Page
- **Provider review required**: yes · **Sandbox**: yes · **Last verified**: 2026-09-08
- **Requested scopes**: `instagram_basic`, `instagram_manage_comments`, `instagram_manage_insights`, `pages_show_list`, `pages_read_engagement`
- **Not requested**: `instagram_manage_messages`, `instagram_content_publish`
- **Setup**: Instagram account converted to Business or Creator; Linked to a Facebook Page you administer; Meta app review for Advanced Access
- **Docs**: <https://developers.facebook.com/docs/instagram-platform> · <https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login>

| Capability | Provider | Flas | Status | Required scopes | Note |
|---|---|---|---|---|---|
| Profile | yes | yes | Limited by account type | `instagram_basic` | Business or Creator accounts only. |
| Publishing | yes | no | Not implemented yet | `instagram_content_publish` | The scope is requested, but Flas has no code that creates an Instagram post. |
| Read comments | yes | yes | Requires provider review | `instagram_manage_comments` |  |
| Reply to comments | yes | yes | Requires provider review | `instagram_manage_comments` |  |
| Read DMs | yes | no | Not implemented yet | `instagram_manage_messages` | Instagram DMs need instagram_manage_messages, which Flas does not request. Distinct from Facebook Messenger. |
| Send DMs | yes | no | Not implemented yet | `instagram_manage_messages` | Not requested and not built. Distinct from Facebook Messenger. |
| Read reviews | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Reply to reviews | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Analytics | yes | yes | Requires provider review | `instagram_manage_insights` |  |
| Read ads | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Manage ads | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Webhooks | no | no | Not supported by provider | — | This provider does not offer an API for this. |

**Known limitations**
- Personal Instagram accounts cannot be connected — the API is Professional-only.
- Instagram DMs are a separate permission (instagram_manage_messages) that Flas does not request.

### Threads

- **ID**: `threads` · **Category**: social · **Auth**: oauth2
- **Account types**: Threads profile linked to an Instagram Professional account
- **Provider review required**: yes · **Sandbox**: no · **Last verified**: 2026-09-08
- **Requested scopes**: `threads_basic`, `threads_manage_insights`
- **Not requested**: `threads_manage_replies`, `threads_read_replies`, `threads_content_publish`
- **Setup**: Threads profile; Linked Instagram Professional account
- **Docs**: <https://developers.facebook.com/docs/threads>

| Capability | Provider | Flas | Status | Required scopes | Note |
|---|---|---|---|---|---|
| Profile | yes | no | Not implemented yet | `threads_basic` | No Threads sync is implemented. |
| Publishing | yes | no | Not implemented yet | `threads_content_publish` | Scope requested; no publish code exists. |
| Read comments | yes | no | Not implemented yet | `threads_read_replies` | Threads calls these replies. The scope is not requested and no sync exists. |
| Reply to comments | yes | no | Not implemented yet | `threads_manage_replies` | Threads calls these replies. The scope is not requested and no code exists. |
| Read DMs | no | no | Not supported by provider | — | Threads has no direct-message API. |
| Send DMs | no | no | Not supported by provider | — | Threads has no direct-message API. |
| Read reviews | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Reply to reviews | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Analytics | yes | no | Not implemented yet | `threads_manage_insights` | Scope requested; no insights sync exists. |
| Read ads | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Manage ads | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Webhooks | no | no | Not supported by provider | — | This provider does not offer an API for this. |

**Known limitations**
- The Threads API has no direct-message endpoint of any kind.
- Flas performs no Threads sync — connecting stores the account and nothing else.

### LinkedIn Company Pages

- **ID**: `linkedin` · **Category**: social · **Auth**: oauth2
- **Account types**: LinkedIn Company Page (organization admin)
- **Provider review required**: yes · **Sandbox**: no · **Last verified**: 2026-09-08
- **Requested scopes**: `r_organization_social`, `rw_organization_admin`
- **Not requested**: `w_organization_social`
- **Setup**: LinkedIn Developer app; Community Management API product approval; Organization admin role on the Page
- **Docs**: <https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview>

| Capability | Provider | Flas | Status | Required scopes | Note |
|---|---|---|---|---|---|
| Profile | yes | yes | Requires provider review | `r_organization_social` |  |
| Publishing | yes | no | Not implemented yet | `w_organization_social` | Scope requested; no publish code exists. |
| Read comments | yes | no | Not implemented yet | `r_organization_social` | Comments on organization posts are readable, but Flas syncs only posts and follower statistics. |
| Reply to comments | yes | no | Not implemented yet | `w_organization_social` | Not built. |
| Read DMs | no | no | Not supported by provider | — | LinkedIn inbox messaging is not exposed by the organization scopes Flas requests; it needs a separate partner-only product. |
| Send DMs | no | no | Not supported by provider | — | LinkedIn inbox messaging is not exposed by the organization scopes Flas requests; it needs a separate partner-only product. |
| Read reviews | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Reply to reviews | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Analytics | yes | yes | Requires provider review | `r_organization_social` | Follower statistics only. |
| Read ads | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Manage ads | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Webhooks | no | no | Not supported by provider | — | This provider does not offer an API for this. |

**Known limitations**
- LinkedIn member-to-member inbox messaging is not available through these organization scopes; it requires a separate partner-only messaging product.
- The Community Management API product must be approved before organization scopes are granted.

### TikTok

- **ID**: `tiktok` · **Category**: social · **Auth**: oauth2_pkce
- **Account types**: TikTok account with Login Kit authorization
- **Provider review required**: yes · **Sandbox**: yes · **Last verified**: 2026-09-08
- **Requested scopes**: `user.info.basic`, `user.info.profile`, `user.info.stats`, `video.list`
- **Not requested**: `video.publish`, `video.upload`, `comment.list`, `comment.create`
- **Setup**: TikTok for Developers app; Login Kit and Display API products approved
- **Docs**: <https://developers.tiktok.com/doc/login-kit-web> · <https://developers.tiktok.com/doc/display-api-overview>

| Capability | Provider | Flas | Status | Required scopes | Note |
|---|---|---|---|---|---|
| Profile | yes | yes | Available | `user.info.basic` |  |
| Publishing | yes | no | Not implemented yet | `video.publish` | TikTok supports publishing, but Flas requests neither video.publish nor video.upload and has no publish code. |
| Read comments | yes | no | Not implemented yet | `comment.list` | TikTok exposes comments under comment.list, which Flas does not request. |
| Reply to comments | yes | no | Not implemented yet | `comment.create` | Not requested and not built. |
| Read DMs | no | no | Not supported by provider | — | TikTok has no direct-message API for third parties. |
| Send DMs | no | no | Not supported by provider | — | TikTok has no direct-message API for third parties. |
| Read reviews | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Reply to reviews | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Analytics | yes | yes | Available | `user.info.stats`, `video.list` | Follower, like and video counts. Not TikTok's full analytics suite. |
| Read ads | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Manage ads | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Webhooks | no | no | Not supported by provider | — | This provider does not offer an API for this. |

**Known limitations**
- TikTok exposes no direct-message API to third-party applications.
- Publishing needs video.publish, which Flas does not request.

### YouTube

- **ID**: `youtube` · **Category**: social · **Auth**: oauth2
- **Account types**: YouTube channel (own or Brand Account)
- **Provider review required**: yes · **Sandbox**: no · **Last verified**: 2026-09-08
- **Requested scopes**: `https://www.googleapis.com/auth/youtube.readonly`, `https://www.googleapis.com/auth/youtube.force-ssl`
- **Not requested**: `https://www.googleapis.com/auth/youtube.upload`, `https://www.googleapis.com/auth/yt-analytics.readonly`
- **Setup**: Google Cloud project with YouTube Data API v3 enabled; OAuth consent screen verification for sensitive scopes
- **Docs**: <https://developers.google.com/youtube/v3/docs> · <https://developers.google.com/youtube/v3/guides/auth/installed-apps>

| Capability | Provider | Flas | Status | Required scopes | Note |
|---|---|---|---|---|---|
| Profile | yes | yes | Requires provider review | `https://www.googleapis.com/auth/youtube.readonly` |  |
| Publishing | yes | no | Not implemented yet | `https://www.googleapis.com/auth/youtube.upload` | Video upload is supported by YouTube but Flas neither requests the scope nor implements it. |
| Read comments | yes | yes | Requires provider review | `https://www.googleapis.com/auth/youtube.force-ssl` |  |
| Reply to comments | yes | no | Not implemented yet | `https://www.googleapis.com/auth/youtube.force-ssl` | The scope allows it, but Flas has no YouTube comment-reply code — replyToComment is Meta-only. |
| Read DMs | no | no | Not supported by provider | — | YouTube has no private direct-message API. |
| Send DMs | no | no | Not supported by provider | — | YouTube has no private direct-message API. |
| Read reviews | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Reply to reviews | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Analytics | yes | yes | Requires provider review | `https://www.googleapis.com/auth/youtube.readonly` | Public channel statistics. YouTube Analytics needs yt-analytics.readonly, which is not requested. |
| Read ads | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Manage ads | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Webhooks | no | no | Not supported by provider | — | This provider does not offer an API for this. |

**Known limitations**
- YouTube has no private direct-message API. Comments are public.
- Uploading needs youtube.upload, which Flas does not request.
- The Data API quota is shared per project and is easy to exhaust.

### X (Twitter)

- **ID**: `twitter` · **Category**: social · **Auth**: oauth2_pkce
- **Account types**: X account on a plan whose API tier permits the endpoints used
- **Provider review required**: no · **Sandbox**: no · **Last verified**: 2026-09-08
- **Requested scopes**: `tweet.read`, `users.read`, `offline.access`
- **Not requested**: `dm.read`, `dm.write`, `tweet.write`
- **Setup**: X developer account; Paid API tier for meaningful read volume
- **Docs**: <https://docs.x.com/x-api/introduction>

| Capability | Provider | Flas | Status | Required scopes | Note |
|---|---|---|---|---|---|
| Profile | yes | yes | Available | `users.read` |  |
| Publishing | yes | no | Not implemented yet | `tweet.write` | The scope is requested, but Flas has no code that posts to X. |
| Read comments | yes | no | Not implemented yet | `tweet.read` | Replies are readable, but Flas syncs only the account's own posts and their metrics. |
| Reply to comments | yes | no | Not implemented yet | `tweet.write` | Not built. |
| Read DMs | yes | no | Not implemented yet | `dm.read` | X supports DMs, but Flas requests neither dm.read nor dm.write and has no DM code. |
| Send DMs | yes | no | Not implemented yet | `dm.write` | Not requested and not built. |
| Read reviews | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Reply to reviews | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Analytics | yes | yes | Available | `tweet.read` | Public post metrics only. |
| Read ads | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Manage ads | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Webhooks | no | no | Not supported by provider | — | This provider does not offer an API for this. |

**Known limitations**
- Direct messages need dm.read and dm.write, which Flas does not request.
- Read volume on the free tier is too low for practical monitoring.

### Google Business Profile

- **ID**: `google_business` · **Category**: social · **Auth**: oauth2
- **Account types**: Verified Business Profile location (owner or manager)
- **Provider review required**: yes · **Sandbox**: no · **Last verified**: 2026-09-08
- **Requested scopes**: `https://www.googleapis.com/auth/business.manage`
- **Setup**: Verified Business Profile; Business Profile APIs enabled and quota approved by Google
- **Docs**: <https://developers.google.com/my-business/reference/rest> · <https://support.google.com/business/answer/14919056>

| Capability | Provider | Flas | Status | Required scopes | Note |
|---|---|---|---|---|---|
| Profile | yes | yes | Requires provider review | `https://www.googleapis.com/auth/business.manage` |  |
| Publishing | yes | no | Not implemented yet | `https://www.googleapis.com/auth/business.manage` | Local posts are supported by Google but Flas has no code that creates one. |
| Read comments | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Reply to comments | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Read DMs | no | no | Not supported by provider | — | Google discontinued Business Profile chat on 31 July 2024. No messaging API exists. |
| Send DMs | no | no | Not supported by provider | — | Google discontinued Business Profile chat on 31 July 2024. No messaging API exists. |
| Read reviews | yes | yes | Requires provider review | `https://www.googleapis.com/auth/business.manage` | Reviews are pulled and shown in the social inbox. |
| Reply to reviews | yes | no | Not implemented yet | `https://www.googleapis.com/auth/business.manage` | Google supports review replies; Flas reads reviews but has no reply code for them. |
| Analytics | yes | no | Not implemented yet | `https://www.googleapis.com/auth/business.manage` | Performance metrics are available from Google but are not synced. |
| Read ads | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Manage ads | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Webhooks | no | no | Not supported by provider | — | This provider does not offer an API for this. |

**Known limitations**
- Google retired Business Profile chat and call history on 31 July 2024. There is no messaging API to integrate with — for anyone.
- Business Profile API quota must be requested from Google and is not granted automatically.

### Pinterest

- **ID**: `pinterest` · **Category**: social · **Auth**: oauth2
- **Account types**: Pinterest business account
- **Provider review required**: yes · **Sandbox**: yes · **Last verified**: 2026-09-08
- **Requested scopes**: `boards:read`, `pins:read`, `user_accounts:read`
- **Not requested**: `pins:write`
- **Setup**: Pinterest developer app; Standard access approval for production
- **Docs**: <https://developers.pinterest.com/docs/api/v5/introduction/>

| Capability | Provider | Flas | Status | Required scopes | Note |
|---|---|---|---|---|---|
| Profile | yes | yes | Available | `user_accounts:read` | The account is validated on connect; no content is synced. |
| Publishing | yes | no | Not implemented yet | `pins:write` | Scope requested; no pin-creation code exists. |
| Read comments | yes | no | Not implemented yet | `pins:read` | Not built. |
| Reply to comments | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Read DMs | no | no | Not supported by provider | — | No direct-message capability under the scopes Flas requests. |
| Send DMs | no | no | Not supported by provider | — | No direct-message capability under the scopes Flas requests. |
| Read reviews | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Reply to reviews | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Analytics | yes | no | Not implemented yet | `user_accounts:read` | Not built. |
| Read ads | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Manage ads | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Webhooks | no | no | Not supported by provider | — | This provider does not offer an API for this. |

**Known limitations**
- No direct-message capability is available under the scopes Flas requests.
- Flas performs no Pinterest content sync — connecting validates the account only.

### WhatsApp Business

- **ID**: `whatsapp` · **Category**: messaging · **Auth**: api_key
- **Account types**: WhatsApp Business Platform phone number on a verified WABA
- **Provider review required**: yes · **Sandbox**: yes · **Last verified**: 2026-09-08
- **Requested scopes**: none (not OAuth)
- **Setup**: Meta Business verification; A phone number not currently registered on WhatsApp; Approved display name; Approved message templates for business-initiated messages
- **Docs**: <https://developers.facebook.com/docs/whatsapp/cloud-api> · <https://business.whatsapp.com/products/platform-pricing>

| Capability | Provider | Flas | Status | Required scopes | Note |
|---|---|---|---|---|---|
| Profile | yes | yes | Requires provider review | — |  |
| Publishing | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Read comments | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Reply to comments | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Read DMs | yes | yes | Requires provider review | — | Inbound messages arrive by webhook with a verified signature. |
| Send DMs | yes | yes | Requires provider review | — | Free-form inside the 24-hour window; an approved template is required outside it. |
| Read reviews | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Reply to reviews | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Analytics | yes | yes | Requires provider review | — | Delivery and read status per message. |
| Read ads | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Manage ads | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Webhooks | yes | yes | Requires provider review | — | X-Hub-Signature-256 is verified and the endpoint fails closed without a secret. |

**Known limitations**
- Business-initiated messages outside the 24-hour customer service window require an approved template and are billed by Meta.
- New numbers start on a limited messaging tier that rises with quality.

### Meta Ads

- **ID**: `meta_ads` · **Category**: ads · **Auth**: oauth2
- **Account types**: Meta ad account within a Business
- **Provider review required**: yes · **Sandbox**: yes · **Last verified**: 2026-09-08
- **Requested scopes**: `ads_read`, `business_management`
- **Not requested**: `ads_management`
- **Setup**: Meta Business account; Advanced Access to ads permissions
- **Docs**: <https://developers.facebook.com/docs/marketing-apis>

| Capability | Provider | Flas | Status | Required scopes | Note |
|---|---|---|---|---|---|
| Profile | yes | yes | Requires provider review | `business_management` | Ad accounts are listed on connect. |
| Publishing | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Read comments | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Reply to comments | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Read DMs | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Send DMs | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Read reviews | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Reply to reviews | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Analytics | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Read ads | yes | no | Not implemented yet | `ads_read` | Scope requested; no campaign or spend reporting is built. |
| Manage ads | yes | no | Not implemented yet | `ads_management` | Scope requested; Flas never creates or edits campaigns. |
| Webhooks | no | no | Not supported by provider | — | This provider does not offer an API for this. |

**Known limitations**
- Flas lists ad accounts but does not read spend or performance.

### Google Ads

- **ID**: `google_ads` · **Category**: ads · **Auth**: oauth2
- **Account types**: Google Ads account
- **Provider review required**: yes · **Sandbox**: yes · **Last verified**: 2026-09-08
- **Requested scopes**: `https://www.googleapis.com/auth/adwords`
- **Setup**: Google Ads developer token; OAuth consent screen verification
- **Docs**: <https://developers.google.com/google-ads/api/docs/start>

| Capability | Provider | Flas | Status | Required scopes | Note |
|---|---|---|---|---|---|
| Profile | yes | no | Not implemented yet | `https://www.googleapis.com/auth/adwords` | Not built. |
| Publishing | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Read comments | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Reply to comments | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Read DMs | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Send DMs | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Read reviews | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Reply to reviews | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Analytics | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Read ads | yes | no | Not implemented yet | `https://www.googleapis.com/auth/adwords` | Not built. |
| Manage ads | yes | no | Not implemented yet | `https://www.googleapis.com/auth/adwords` | Not built. |
| Webhooks | no | no | Not supported by provider | — | This provider does not offer an API for this. |

**Known limitations**
- A developer token must be approved by Google before production use.
- No Google Ads reporting is implemented.

### LinkedIn Ads

- **ID**: `linkedin_ads` · **Category**: ads · **Auth**: oauth2
- **Account types**: LinkedIn advertising account
- **Provider review required**: yes · **Sandbox**: no · **Last verified**: 2026-09-08
- **Requested scopes**: `r_ads`, `r_ads_reporting`
- **Not requested**: `rw_ads`
- **Setup**: LinkedIn Marketing API product approval
- **Docs**: <https://learn.microsoft.com/en-us/linkedin/marketing/integrations/marketing-integrations-overview>

| Capability | Provider | Flas | Status | Required scopes | Note |
|---|---|---|---|---|---|
| Profile | yes | no | Not implemented yet | `r_ads` | Not built. |
| Publishing | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Read comments | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Reply to comments | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Read DMs | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Send DMs | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Read reviews | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Reply to reviews | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Analytics | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Read ads | yes | no | Not implemented yet | `r_ads_reporting` | Scope requested; no reporting is built. |
| Manage ads | no | no | Not supported by provider | — | rw_ads is not requested, so campaign management is unavailable. |
| Webhooks | no | no | Not supported by provider | — | This provider does not offer an API for this. |

**Known limitations**
- Only read scopes are requested; campaign management would need rw_ads.
- No LinkedIn Ads reporting is implemented.

### TikTok Ads

- **ID**: `tiktok_ads` · **Category**: ads · **Auth**: oauth2_pkce
- **Account types**: TikTok for Business advertiser account
- **Provider review required**: yes · **Sandbox**: yes · **Last verified**: 2026-09-08
- **Requested scopes**: `user.info.basic`
- **Not requested**: `advertiser.read`, `advertiser.write`
- **Setup**: TikTok for Business account; Marketing API access approval
- **Docs**: <https://business-api.tiktok.com/portal/docs>

| Capability | Provider | Flas | Status | Required scopes | Note |
|---|---|---|---|---|---|
| Profile | yes | yes | Available | `user.info.basic` |  |
| Publishing | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Read comments | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Reply to comments | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Read DMs | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Send DMs | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Read reviews | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Reply to reviews | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Analytics | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Read ads | yes | no | Not implemented yet | `advertiser.read` | No advertising scope is requested, so no ads data is reachable. |
| Manage ads | yes | no | Not implemented yet | `advertiser.write` | Not requested and not built. |
| Webhooks | no | no | Not supported by provider | — | This provider does not offer an API for this. |

**Known limitations**
- Only user.info.basic is requested — no advertising scope at all, so no ads data can be read.

### Google Analytics 4

- **ID**: `google_analytics` · **Category**: analytics · **Auth**: oauth2
- **Account types**: GA4 property
- **Provider review required**: yes · **Sandbox**: no · **Last verified**: 2026-09-08
- **Requested scopes**: `https://www.googleapis.com/auth/analytics.readonly`
- **Setup**: GA4 property with at least Viewer access; Data API enabled
- **Docs**: <https://developers.google.com/analytics/devguides/reporting/data/v1>

| Capability | Provider | Flas | Status | Required scopes | Note |
|---|---|---|---|---|---|
| Profile | yes | no | Not implemented yet | `https://www.googleapis.com/auth/analytics.readonly` | Property listing is not implemented. |
| Publishing | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Read comments | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Reply to comments | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Read DMs | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Send DMs | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Read reviews | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Reply to reviews | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Analytics | yes | no | Not implemented yet | `https://www.googleapis.com/auth/analytics.readonly` | Scope requested; no reporting is built. |
| Read ads | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Manage ads | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Webhooks | no | no | Not supported by provider | — | This provider does not offer an API for this. |

**Known limitations**
- No GA4 reporting is implemented; the connection is stored only.

### Google Search Console

- **ID**: `search_console` · **Category**: analytics · **Auth**: oauth2
- **Account types**: Verified Search Console property
- **Provider review required**: yes · **Sandbox**: no · **Last verified**: 2026-09-08
- **Requested scopes**: `https://www.googleapis.com/auth/webmasters.readonly`
- **Setup**: Verified site ownership
- **Docs**: <https://developers.google.com/webmaster-tools/v1/api_reference_index>

| Capability | Provider | Flas | Status | Required scopes | Note |
|---|---|---|---|---|---|
| Profile | yes | yes | Requires provider review | `https://www.googleapis.com/auth/webmasters.readonly` | Verified sites are listed on connect. |
| Publishing | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Read comments | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Reply to comments | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Read DMs | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Send DMs | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Read reviews | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Reply to reviews | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Analytics | yes | no | Not implemented yet | `https://www.googleapis.com/auth/webmasters.readonly` | Search performance data is not pulled. |
| Read ads | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Manage ads | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Webhooks | no | no | Not supported by provider | — | This provider does not offer an API for this. |

**Known limitations**
- Sites are listed on connect; no query or impression data is pulled.

### WordPress

- **ID**: `wordpress` · **Category**: commerce · **Auth**: app_password
- **Account types**: Self-hosted WordPress site with the REST API reachable
- **Provider review required**: no · **Sandbox**: yes · **Last verified**: 2026-09-08
- **Requested scopes**: none (not OAuth)
- **Setup**: WordPress user with publishing rights; An application password
- **Docs**: <https://developer.wordpress.org/rest-api/>

| Capability | Provider | Flas | Status | Required scopes | Note |
|---|---|---|---|---|---|
| Profile | yes | yes | Available | — |  |
| Publishing | yes | yes | Available | — | The only publishing path Flas actually implements today. |
| Read comments | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Reply to comments | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Read DMs | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Send DMs | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Read reviews | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Reply to reviews | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Analytics | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Read ads | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Manage ads | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Webhooks | no | no | Not supported by provider | — | This provider does not offer an API for this. |

**Known limitations**
- Application passwords are disabled over plain HTTP.

### Shopify

- **ID**: `shopify` · **Category**: commerce · **Auth**: plugin
- **Account types**: Shopify store
- **Provider review required**: no · **Sandbox**: yes · **Last verified**: 2026-09-08
- **Requested scopes**: none (not OAuth)
- **Setup**: Theme snippet or the downloadable package installed
- **Docs**: <https://shopify.dev/docs/api>

| Capability | Provider | Flas | Status | Required scopes | Note |
|---|---|---|---|---|---|
| Profile | yes | yes | Available | — | The store is identified by its site key. |
| Publishing | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Read comments | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Reply to comments | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Read DMs | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Send DMs | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Read reviews | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Reply to reviews | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Analytics | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Read ads | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Manage ads | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Webhooks | no | no | Not supported by provider | — | This provider does not offer an API for this. |

**Known limitations**
- Installed as a theme snippet for lead capture; no Admin API integration, so no catalogue or order sync.

### WooCommerce

- **ID**: `woocommerce` · **Category**: commerce · **Auth**: plugin
- **Account types**: WooCommerce store on WordPress
- **Provider review required**: no · **Sandbox**: yes · **Last verified**: 2026-09-08
- **Requested scopes**: none (not OAuth)
- **Setup**: The Flas WordPress plugin installed and activated
- **Docs**: <https://woocommerce.github.io/woocommerce-rest-api-docs/>

| Capability | Provider | Flas | Status | Required scopes | Note |
|---|---|---|---|---|---|
| Profile | yes | yes | Available | — | The store is identified by its site key. |
| Publishing | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Read comments | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Reply to comments | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Read DMs | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Send DMs | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Read reviews | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Reply to reviews | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Analytics | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Read ads | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Manage ads | no | no | Not supported by provider | — | This provider does not offer an API for this. |
| Webhooks | no | no | Not supported by provider | — | This provider does not offer an API for this. |

**Known limitations**
- Lead capture only; no product or order synchronisation is implemented.
