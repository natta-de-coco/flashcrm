# FLAS company integration onboarding

This is the operating guide for connecting A to Z and future customer companies. It separates the work FLAS performs once for its shared provider apps from the short flow a normal company user follows.

Normal users should only see:

1. **Add integration**
2. Choose the provider
3. **Continue with provider**
4. Approve access in the provider
5. Choose the Page, channel, location or account
6. **Connected**

They must not be asked for app IDs, app secrets, tokens, scopes, callback URLs or developer-console settings. FLAS keeps shared provider credentials in the server secret store. A separate company-owned app is an advanced administrator option only: **Integrations → Advanced admin settings → Use your own developer app**, which also shows that company the callback to register in its own app.

## What FLAS must prepare once

These are platform-owner tasks. Do not repeat them for every customer company.

### Public application and security

- Keep `https://flas.mobidigisol.com` live with working privacy, terms and data-deletion pages.
- Register the exact OAuth callback `https://flas.mobidigisol.com/api/public/oauth-callback` in every shared provider app.
- Keep provider secrets and `TOKEN_ENCRYPTION_KEYS` in the server secret store. Never put them in browser variables, screenshots, tickets or chat.
- Keep OAuth allowed origins explicit. Production and staging callbacks are separate exact URLs.
- Apply all repository migrations in timestamp order and require `integration_oauth_storage_ready()` to pass before offering OAuth.
- Keep OAuth state single-use, short-lived and tenant-bound. Store tokens encrypted and revalidate every selected asset on the server.
- Complete provider review, business verification and quota approval for the shared FLAS apps. A successful redirect proves only that login started; it does not prove API access.

### Shared provider gates

| Provider                | One-time FLAS platform work                                                                                                                                                                                                                                                             |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Facebook and Instagram  | Verify the FLAS Meta business/app, register the domain and callback, configure Facebook Login for Business, and obtain Advanced Access for every permission FLAS actually uses. Keep the app in Live mode only when review requirements are met.                                        |
| Google and YouTube      | Configure the OAuth consent screen and callback. Enable YouTube Data API separately from the Business Profile APIs. Complete Google verification for requested sensitive scopes when required.                                                                                          |
| Google Business Profile | Enable My Business Account Management API and My Business Business Information API. The shared Cloud project must receive GBP API access and a non-zero quota. The applying Google account must manage a verified, active Business Profile that has been verified for at least 60 days. |
| LinkedIn                | Add the callback and obtain the Community Management product/permissions needed by the implemented Company Page features.                                                                                                                                                               |
| TikTok                  | Configure Login Kit/Display API and obtain approval only for the scopes FLAS uses. Publishing remains unavailable in FLAS.                                                                                                                                                              |
| X                       | Configure OAuth and confirm that the developer plan permits the endpoints FLAS uses. Publishing and DMs remain unavailable in FLAS.                                                                                                                                                     |
| Pinterest               | Configure OAuth for profile connection. Pin sync, publishing and analytics remain unavailable in FLAS.                                                                                                                                                                                  |
| WhatsApp                | Configure Meta business verification, webhook routing and signature verification. The current product does not yet have Embedded Signup, so onboarding a new customer-owned number still needs an authorized FLAS administrator.                                                        |

## Add a customer company

Create the company workspace first. Confirm the company administrator belongs only to that tenant and can access **Integrations**. Do not copy another company's social-account rows, bot settings, API keys, WhatsApp number or OAuth state.

Before the call, ask the company to have the correct provider administrator available. Ask for roles and asset names, not secrets.

| Provider                | What the company must already control                                                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Facebook                | A Facebook Page and a person with full Page/business access.                                                                                    |
| Instagram               | A Professional account linked to a Facebook Page the signing-in person administers.                                                             |
| Google Business Profile | A verified location and an Owner or Manager Google account. Shared FLAS GBP API approval must already be complete.                              |
| YouTube                 | The Google or Brand Account that owns the channel.                                                                                              |
| LinkedIn                | A person with the Page role accepted by the approved FLAS LinkedIn product.                                                                     |
| TikTok                  | The account that will grant profile/video read access.                                                                                          |
| X                       | The account that will grant the implemented profile/post read access.                                                                           |
| Pinterest               | The account that will grant profile access.                                                                                                     |
| WhatsApp                | A verified Meta business, an approved display name and a phone number eligible for WhatsApp Business Platform. Current setup is admin-assisted. |

Then use the same customer flow for every OAuth provider:

1. Sign in to the correct FLAS company workspace.
2. Open **Integrations** and select **Add integration**.
3. Select the provider. If the card says **Available soon**, FLAS's own setup for that provider is incomplete: stop, and have a FLAS super admin open **Admin diagnostics** from a FLAS staff account (company users never see diagnostics). Do not ask the customer for app credentials.
4. Select **Continue with provider** and sign in with the provider account that controls the business asset.
5. Approve the permissions shown by the provider. If the provider refuses a permission, record the provider's reason and keep the connector limited.
6. Back in FLAS, choose the exact Page, professional Instagram account, channel, location, Company Page or other asset.
7. Confirm FLAS shows the asset's real name and a connected state.
8. Run the provider-specific acceptance check below.

If a person closes or denies consent, FLAS should show a failed or cancelled attempt and save no half-connected account. If the same asset is reconnected, FLAS must update the existing tenant/platform/external-ID row rather than create a duplicate.

## Provider acceptance checks

### Facebook

- Confirm the chosen Page appears in FLAS.
- Read a real Page post/comment and basic insights.
- Test a comment reply only where the screen says it is supported.
- Do not promise Page publishing, outbound Messenger replies or a full Messenger bot; those flows are unfinished.

### Instagram

- Confirm the chosen professional account is the one linked to the selected Facebook Page.
- Read media, comments and implemented insights.
- Test comment replies where supported.
- Do not promise Instagram DMs or publishing; they are not implemented.

### Google Business Profile

- Confirm both Business Profile APIs are enabled and Account Management API quota is greater than zero.
- Connect with a Google account that is Owner or Manager of a verified location.
- Select the exact location returned by Google.
- Read the implemented profile/review data.
- Google retired Business Profile chat; FLAS cannot provide GBP messaging.

If Google returns HTTP 429 while listing accounts and the project quota is `0`, OAuth succeeded but Google has not approved the shared FLAS Cloud project. Retrying login will not fix it.

For a new GBP API application:

1. The applying Google account must manage the business profile.
2. Complete the **Get verified** flow. Google chooses the available method, which may include video, phone/text, email, live video or mail.
3. Google says verification review can take up to five business days and occasionally longer.
4. Keep the profile active and verified for at least 60 days.
5. Reopen Google's **Application for Basic API Access** using the same Google account and the shared FLAS Cloud project number.
6. After Google grants access, confirm the Account Management API quota is no longer zero.
7. Reconnect in FLAS and select the location.

### YouTube

- Confirm YouTube Data API is enabled for the shared Google project.
- Choose the Google or Brand Account that owns the channel.
- Select the exact channel returned by Google and read its videos/comments/public counts.
- Uploads and comment replies are not implemented in FLAS.

### LinkedIn

- Confirm the user administers the intended Company Page and the FLAS app has the required approved product.
- Select the Company Page returned by LinkedIn and test the implemented read/analytics paths.
- Do not promise publishing.

### TikTok, X and Pinterest

- Connect the intended account and verify only the capabilities listed in the FLAS capability matrix.
- Leave unavailable actions visibly limited or coming soon.
- Provider plan, review and quota can still block a correctly configured OAuth flow.

### WhatsApp

WhatsApp is separate from Facebook and Instagram OAuth. Do not use the Page picker to connect a phone number.

Until Embedded Signup is built, an authorized FLAS administrator must:

1. Confirm the customer owns an eligible number and verified Meta business/WABA.
2. Add the number to the correct tenant only.
3. Store the permanent token and app secret through the encrypted server-side path.
4. Register `https://flas.mobidigisol.com/api/public/whatsapp/webhook` and use the configured verify token.
5. Subscribe the correct WABA/number and confirm webhook signature checks pass.
6. Receive a real inbound message, send a reply inside Meta's allowed window and verify delivery status.
7. Test an approved template for a business-initiated message.
8. Confirm a duplicate webhook does not create a duplicate conversation/message and another tenant cannot see or send from the number.

Never claim WhatsApp is ready merely because a token was saved or a card turned green.

## Company handover record

Keep this record for every company without copying secrets into it:

- Company/workspace name and tenant ID
- FLAS company administrator
- Provider and selected asset name
- Provider asset ID only when operationally necessary
- Date connected and person who performed the provider consent
- Capabilities tested successfully
- Known limitations shown to the company
- Review/quota blockers and their owner
- Reconnect test date
- Webhook test date for WhatsApp
- Final result: **Working**, **Limited**, **Waiting for provider**, or **Coming soon**

## Two-company isolation test

Before onboarding company number two, and after any OAuth, token, picker or webhook change:

1. Use two staging workspaces with different administrators and different provider assets.
2. Connect one asset in each workspace.
3. Verify each workspace lists only its own connection, content, contacts, conversations and logs.
4. Attempt to submit the other workspace's pending connection ID and asset ID; FLAS must reject both.
5. Reconnect both assets and confirm there is still one row per tenant/platform/external ID.
6. Revoke one provider grant and confirm only that workspace changes state.
7. For WhatsApp, send to each number and confirm tenant routing, signature validation and duplicate delivery handling.

## Status language

- **Available**: FLAS has the server-side prerequisites required to start OAuth. It does not mean the provider will grant consent, review or quota.
- **Available soon**: what a company sees while FLAS's own setup for that provider is incomplete (shared app keys, callback origin, token encryption or OAuth storage). The company is told there is nothing it needs to do; FLAS staff see the exact reason in **Admin diagnostics**.
- **Working**: a real asset completed login, selection and the implemented acceptance check.
- **Limited**: connection works, but only the capabilities clearly listed in FLAS are implemented or approved.
- **Waiting for provider**: configuration is correct but provider review, verification or quota is still outstanding.
- **Coming soon**: the end-to-end connector or requested capability is not implemented. Do not expose credential forms as a substitute.

No integration can honestly be guaranteed before the provider approves the shared FLAS app and a real customer asset passes the acceptance check. The purpose of this process is to make every blocker visible, owned and repeatable instead of sending normal users into developer settings.
