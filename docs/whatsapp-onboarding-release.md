# WhatsApp onboarding release — 8 October 2026

## This change

The administrator's manual number setup now checks read access to the exact phone-number ID with Meta before saving credentials. An invalid token, inaccessible number, malformed response, timeout or rate limit leaves no saved row. The displayed number comes from Meta, not the administrator's text. Provider error bodies and tokens are not relayed to the browser.

Number and template caches on Integration Settings are scoped by company; the queries and number edits/deletes also explicitly filter by company in addition to RLS. Existing encryption and server-side company-admin checks remain in place.

The success message means number access was checked, not that message delivery works. All five UI languages explain that webhook setup and send/receive testing remain necessary.

## Still required for self-service companies

This release does NOT implement Embedded Signup. WhatsApp remains a manual administrator connector. Do not advertise a working “Continue with WhatsApp” button yet.

Before implementing/enabling that flow, verify the actual FLAS Meta app's Tech Provider onboarding, approved access, live mode, Facebook Login for Business Embedded Signup configuration, allowed domains, and callback settings against Meta's current documentation. Do not ask ordinary business users for developer tokens, app secrets or app IDs.

The implementation must bind a short-lived, one-use signup session to the authenticated administrator and company; exchange the authorization code server-side; verify asset access independently of browser session events; store encrypted credentials; subscribe the selected WABA to the correct FLAS app; and verify phone registration requirements for the specific onboarding path. Coexistence, migration and history import are distinct provider capabilities, not assumed guarantees. Never silently transfer a number between companies. Add transaction/unique-constraint protection for concurrent onboarding and preserve conversation identity on reconnect.

Only report sending/receiving ready after provider checks and a controlled delivery test. Never infer WABA subscription from successful token validation. No automatic customer messages, campaigns or backfill are part of setup.

## Live acceptance checklist

Use two designated test companies with separate administrators and consenting test recipients.

1. Add each company's authorized number; verify independent defaults and no visible numbers/templates from the other company after switching sessions.
2. Denied credentials and the other company's connected number must not create or modify rows. Test staff and signed-out access too.
3. Verify the FLAS app is subscribed to the WABA, webhook signatures validate, and each inbound message routes to the matching company and number.
4. Send a controlled reply inside the service window; verify persistence and delivery evidence. Test approved templates outside the window separately.
5. Check failures and expired credentials are visible, retries do not duplicate, and a disabled number cannot send.

No live delivery or provider approval is claimed by the mocked regression tests. This change requires no migration and does not configure Meta or deploy production.
