export type ProviderSetupLink = {
  id: "apps" | "credentials" | "permissions" | "review" | "docs" | "api";
  label: string;
  url: string;
  description: string;
};

export type ProviderSetupInfo = {
  provider: "meta" | "google" | "linkedin" | "tiktok" | "twitter" | "pinterest";
  displayName: string;
  ownerTask: string;
  connectionTask: string;
  links: readonly ProviderSetupLink[];
};

/**
 * Exact first-party destinations for the one-time provider-app setup.
 *
 * Keep these separate from a customer's OAuth connection. The owner/admin
 * configures the provider app once; an SMM operator should normally only need
 * the provider consent screen afterwards.
 */
export const PROVIDER_SETUP: Readonly<Record<ProviderSetupInfo["provider"], ProviderSetupInfo>> = {
  meta: {
    provider: "meta",
    displayName: "Meta",
    ownerTask: "Create or open the Meta app, copy the App ID/Secret, configure the redirect URI, and request Advanced Access for the permissions Flas actually uses.",
    connectionTask: "Sign in with Facebook, approve every permission shown, then choose the Business/Page/Instagram account you want to connect.",
    links: [
      {
        id: "apps",
        label: "Open Meta Apps",
        url: "https://developers.facebook.com/apps/",
        description: "Create the Meta app or open the existing Business app.",
      },
      {
        id: "permissions",
        label: "Meta permissions reference",
        url: "https://developers.facebook.com/docs/permissions/",
        description: "Check what each requested Facebook/Instagram permission allows.",
      },
      {
        id: "review",
        label: "Meta App Review",
        url: "https://developers.facebook.com/docs/app-review/",
        description: "Prepare Advanced Access / App Review for permissions used outside your own Business.",
      },
      {
        id: "docs",
        label: "Facebook Login for Business",
        url: "https://developers.facebook.com/docs/facebook-login/facebook-login-for-business/",
        description: "Official setup guidance for business authorization flows.",
      },
    ],
  },
  google: {
    provider: "google",
    displayName: "Google",
    ownerTask: "Select the Google Cloud project, configure the OAuth consent screen, create a Web OAuth client, enable the required APIs, and add the exact Flas redirect URI.",
    connectionTask: "Choose the Google account that owns/manages the asset, approve the requested scopes, then select the channel/property/location inside Flas.",
    links: [
      {
        id: "credentials",
        label: "OAuth credentials",
        url: "https://console.cloud.google.com/apis/credentials",
        description: "Create/open the Web OAuth Client ID and copy the Client ID + Client Secret.",
      },
      {
        id: "permissions",
        label: "OAuth consent screen",
        url: "https://console.cloud.google.com/auth/overview",
        description: "Configure branding, audience, test users and data-access scopes.",
      },
      {
        id: "api",
        label: "API Library",
        url: "https://console.cloud.google.com/apis/library",
        description: "Enable YouTube, Business Profile, Google Ads, Analytics or Search Console APIs as needed.",
      },
      {
        id: "docs",
        label: "Google OAuth guidance",
        url: "https://developers.google.com/identity/protocols/oauth2",
        description: "Official OAuth 2.0 documentation and consent/security guidance.",
      },
    ],
  },
  linkedin: {
    provider: "linkedin",
    displayName: "LinkedIn",
    ownerTask: "Create/open the LinkedIn app, associate it with the company Page, copy the Client ID/Secret, configure redirect URLs, then request the products your use case needs.",
    connectionTask: "Sign in with a Page admin account, approve the available permissions, and choose the organization/account Flas should use.",
    links: [
      {
        id: "apps",
        label: "LinkedIn My Apps",
        url: "https://www.linkedin.com/developers/apps",
        description: "Create/open the app and find Auth, Products and app credentials.",
      },
      {
        id: "permissions",
        label: "LinkedIn API access",
        url: "https://www.linkedin.com/help/linkedin/answer/a526048",
        description: "Official explanation of self-service and reviewed API products.",
      },
      {
        id: "review",
        label: "App verification guide",
        url: "https://www.linkedin.com/help/linkedin/answer/a1665329",
        description: "Verify the app association with the LinkedIn Page when required.",
      },
      {
        id: "docs",
        label: "LinkedIn Developers",
        url: "https://learn.microsoft.com/linkedin/",
        description: "Official LinkedIn API documentation.",
      },
    ],
  },
  tiktok: {
    provider: "tiktok",
    displayName: "TikTok",
    ownerTask: "Create/open the TikTok developer app, add Login Kit / required products, configure the redirect URI and request approval for the scopes Flas actually needs.",
    connectionTask: "Sign in to TikTok and grant the requested scopes. TikTok can allow a user to grant only a subset, so Flas must verify what was actually granted.",
    links: [
      {
        id: "apps",
        label: "TikTok Manage Apps",
        url: "https://developers.tiktok.com/apps/",
        description: "Open the developer app and find the Client key + Client secret.",
      },
      {
        id: "permissions",
        label: "TikTok scopes",
        url: "https://developers.tiktok.com/doc/scopes-overview/",
        description: "See available scopes and add the ones required by Flas features.",
      },
      {
        id: "review",
        label: "TikTok app review",
        url: "https://developers.tiktok.com/doc/getting-started-faq/",
        description: "Review requirements and production-status guidance.",
      },
      {
        id: "docs",
        label: "TikTok Login Kit",
        url: "https://developers.tiktok.com/doc/login-kit-overview/",
        description: "Official OAuth/Login Kit workflow.",
      },
    ],
  },
  twitter: {
    provider: "twitter",
    displayName: "X",
    ownerTask: "Open the X developer project/app, configure OAuth 2.0 user authentication, add the callback URL, choose the required app permissions, and copy the OAuth client credentials.",
    connectionTask: "Authorize Flas with the X account. Flas should only advertise capabilities covered by both the app access tier and the scopes actually granted.",
    links: [
      {
        id: "apps",
        label: "X Developer Portal",
        url: "https://developer.x.com/en/portal/dashboard",
        description: "Open the project/app and its Keys, tokens and user-authentication settings.",
      },
      {
        id: "permissions",
        label: "X OAuth 2.0",
        url: "https://developer.x.com/en/docs/authentication/oauth-2-0/authorization-code",
        description: "Official Authorization Code + PKCE guidance and scope behavior.",
      },
      {
        id: "docs",
        label: "X API documentation",
        url: "https://developer.x.com/en/docs",
        description: "Check endpoint availability and plan/rate-limit requirements.",
      },
    ],
  },
  pinterest: {
    provider: "pinterest",
    displayName: "Pinterest",
    ownerTask: "Create/open the Pinterest developer app, copy the App ID/secret, configure the exact redirect URI, choose scopes and request the access tier needed by the product.",
    connectionTask: "Authorize the Pinterest business account and grant the requested scopes, then choose the boards/account Flas should use.",
    links: [
      {
        id: "apps",
        label: "Pinterest My Apps",
        url: "https://developers.pinterest.com/apps/",
        description: "Create/open the app and find its App ID, secret and redirect URI configuration.",
      },
      {
        id: "permissions",
        label: "Pinterest OAuth & scopes",
        url: "https://developers.pinterest.com/docs/getting-started/set-up-authentication-and-authorization/",
        description: "Official OAuth, scopes, token refresh and sandbox instructions.",
      },
      {
        id: "review",
        label: "Pinterest app setup",
        url: "https://developers.pinterest.com/docs/getting-started/connect-app/",
        description: "Official app registration, redirect URI and access-tier setup.",
      },
    ],
  },
};

export function providerSetup(provider: string | null | undefined): ProviderSetupInfo | undefined {
  if (!provider) return undefined;
  return PROVIDER_SETUP[provider as ProviderSetupInfo["provider"]];
}
