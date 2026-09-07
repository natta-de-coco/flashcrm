// Per-platform connection instructions. Every connector card in the
// Integrations hub shows exactly what the platform requires, which permissions
// Flas asks for, and what commonly blocks a connection — so nobody is left
// guessing why Meta or Google refused a login.

import type { ConnectorId } from "./connections-catalog";

/**
 * One credential the user has to paste, with the instructions for finding it
 * sitting directly under its input.
 *
 * Telling someone "open Settings -> Numbers and add your permanent token" and
 * leaving them to it is where setup dies. Every value we ask for names the
 * exact console page it lives on, and the wizard collects it in place.
 */
export type SetupField = {
  key: string;
  label: string;
  placeholder?: string;
  /** Bullet steps rendered under the input, in order. */
  help: string[];
  /** The exact page this value is copied from. */
  link?: { label: string; url: string };
  /** Masked on screen and never rendered back after saving. */
  secret?: boolean;
};

export type SetupGuide = {
  /** What you must own before connecting. */
  requires: string[];
  /** Ordered steps the user follows. */
  steps: string[];
  /** Permissions/scopes Flas requests. */
  scopes?: string[];
  /** Frequent failure reasons and the fix. */
  gotchas?: string[];
};

/** Redirect URI every provider app must whitelist. */
export const OAUTH_REDIRECT_PATH = "/api/public/oauth-callback";

export const SETUP_GUIDES: Partial<Record<ConnectorId, SetupGuide>> = {
  instagram: {
    requires: [
      "An Instagram *Professional* account (Business or Creator) — personal accounts cannot be connected by any tool",
      "The Instagram account linked to a Facebook Page you administer",
    ],
    steps: [
      "In the Instagram app: Settings → Account type → Switch to professional account.",
      "Link it to your Facebook Page: Instagram Settings → Sharing to other apps → Facebook.",
      "Back in Flas press Connect — the secure Meta login opens in a new browser tab (Meta blocks embedded frames).",
      "Choose the Business, the Page and the Instagram account, then keep every permission toggle ON.",
      "Return to this tab; the card flips to Connected and Flas pulls your profile, media and insights.",
    ],
    scopes: [
      "instagram_basic",
      "instagram_manage_comments",
      "instagram_manage_messages",
      "instagram_content_publish",
      "pages_show_list",
      "pages_read_engagement",
    ],
    gotchas: [
      "Only DMs and comments received after the connection can be read — Meta does not backfill history.",
      "If you switch the Facebook Page, Instagram access is revoked and you must reconnect.",
      "Editing bio/name is not allowed by Meta's API — Flas writes the suggestions for you to paste.",
    ],
  },
  facebook: {
    requires: ["A Facebook Page (not a personal profile) with Admin access"],
    steps: [
      "Press Connect — Meta login opens in a new tab.",
      "Pick the Business Portfolio, then tick every Page you want inside Flas.",
      "Leave all permissions enabled, finish, and come back to this tab.",
    ],
    scopes: [
      "pages_show_list",
      "pages_manage_posts",
      "pages_read_engagement",
      "pages_messaging",
      "read_insights",
    ],
    gotchas: [
      "Page roles set to Editor are not enough for Messenger — you need Admin (full control).",
      "business.facebook.com will never load inside the app preview; use the new tab that opens.",
    ],
  },
  threads: {
    requires: ["A Threads profile attached to your Instagram professional account"],
    steps: [
      "Connect Instagram first.",
      "Press Connect on Threads and approve the Threads permissions in the new tab.",
    ],
    scopes: ["threads_basic", "threads_content_publish", "threads_manage_insights"],
    gotchas: ["Threads has no DM API — replies to Threads DMs must be done in the app."],
  },
  google_business: {
    requires: [
      "A verified Google Business Profile location",
      "Owner or Manager access on that location",
    ],
    steps: [
      "Confirm the location is verified at business.google.com (unverified locations return no data).",
      "Press Connect and sign in with the Google account that manages the location.",
      "Grant the Business Profile permission, then return here.",
      "Flas then syncs posts, reviews, calls and direction requests.",
    ],
    scopes: ["https://www.googleapis.com/auth/business.manage"],
    gotchas: [
      "Google's Business Profile API requires a one-time API access approval on your Google Cloud project — request it once and it covers all your locations.",
      "Reviews can be replied to, but review deletion is not offered by the API.",
    ],
  },
  youtube: {
    requires: ["A YouTube channel owned by the Google account you sign in with"],
    steps: [
      "Press Connect and choose the Google account that owns the channel.",
      "If you use a Brand Account, pick the brand identity on the Google consent screen.",
      "Approve YouTube data + upload permissions.",
    ],
    scopes: [
      "https://www.googleapis.com/auth/youtube.readonly",
      "https://www.googleapis.com/auth/youtube.force-ssl",
      "https://www.googleapis.com/auth/yt-analytics.readonly",
    ],
    gotchas: [
      "Uploads consume a large daily API quota — schedule videos rather than bulk-posting.",
    ],
  },
  tiktok: {
    requires: ["A TikTok account (Business recommended) with content posting enabled"],
    steps: [
      "Press Connect and log in to TikTok in the new tab.",
      "Approve video publishing and analytics access.",
      "Flas posts as drafts to your TikTok inbox unless you approve direct publishing.",
    ],
    scopes: ["user.info.basic", "video.list", "video.publish"],
    gotchas: [
      "TikTok has no comment or DM API for third parties — replies happen in TikTok Studio.",
      "Until your TikTok app is reviewed, only accounts you add as testers can connect.",
    ],
  },
  linkedin: {
    requires: ["A LinkedIn Company Page with Super Admin access"],
    steps: [
      "Press Connect and sign in to LinkedIn.",
      "Select the Company Page and approve posting + analytics.",
    ],
    scopes: [
      "w_member_social",
      "r_organization_social",
      "w_organization_social",
      "rw_organization_admin",
    ],
    gotchas: [
      "Personal-profile posting is limited by LinkedIn; company pages are fully supported.",
      "LinkedIn has no messaging API — DMs stay in LinkedIn.",
    ],
  },
  twitter: {
    requires: ["An X account with a developer project on at least the Basic tier for posting"],
    steps: ["Press Connect, authorise Flas on X, and return to this tab."],
    scopes: ["tweet.read", "tweet.write", "users.read", "offline.access"],
    gotchas: ["X free tier is read-limited; posting volume depends on your X plan."],
  },
  pinterest: {
    requires: ["A Pinterest business account"],
    steps: ["Press Connect, approve pins + boards + analytics access."],
    scopes: ["boards:read", "pins:read", "pins:write", "user_accounts:read"],
  },
  meta_ads: {
    requires: ["An ad account inside a Meta Business Portfolio you administer"],
    steps: [
      "Press Connect and choose the Business Portfolio.",
      "Tick the ad accounts Flas should read.",
    ],
    scopes: ["ads_read", "business_management"],
    gotchas: ["Flas reads spend and results only — it never changes budgets or pauses campaigns."],
  },
  google_ads: {
    requires: ["Access to the Google Ads account (Standard or Admin)"],
    steps: ["Press Connect, sign in with Google, approve Google Ads read access."],
    scopes: ["https://www.googleapis.com/auth/adwords"],
    gotchas: ["Manager (MCC) accounts must select the child account you want reported."],
  },
  linkedin_ads: {
    requires: ["Campaign Manager access on the LinkedIn ad account"],
    steps: ["Press Connect and approve the ads reporting permission."],
    scopes: ["r_ads", "r_ads_reporting"],
  },
  tiktok_ads: {
    requires: ["A TikTok Ads Manager account"],
    steps: ["Press Connect and approve advertiser reporting access."],
    scopes: ["ad.report", "advertiser.read"],
  },
  google_analytics: {
    requires: ["A GA4 property with at least Viewer access"],
    steps: ["Press Connect, sign in with Google, then pick the GA4 property."],
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
    gotchas: ["Universal Analytics (pre-GA4) properties no longer return data."],
  },
  search_console: {
    requires: ["A verified Search Console property for your domain"],
    steps: [
      "Verify flas.mobidigisol.com (or your own domain) in Search Console.",
      "Press Connect and approve read access.",
    ],
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
    gotchas: ["Search data lags 2–3 days — that is Google's delay, not Flas's."],
  },
  whatsapp: {
    requires: [
      "A Meta Business Portfolio",
      "A phone number not currently active on the WhatsApp consumer app",
    ],
    steps: [
      "Open Settings → Numbers in Flas and add your WhatsApp Cloud API number, Phone Number ID and permanent token.",
      "Copy the Flas webhook URL and verify token into Meta → WhatsApp → Configuration.",
      "Send a test message; it appears in the Inbox within seconds.",
    ],
    gotchas: [
      "Template messages must be approved by Meta before campaigns can use them.",
      "Business-initiated chats outside the 24-hour window require an approved template.",
    ],
  },
  wordpress: {
    requires: ["A self-hosted WordPress site where you can install plugins"],
    steps: [
      "Download the Flas plugin from Integrations, upload the ZIP in WordPress → Plugins → Add New.",
      "Activate it and paste the activation key emailed to you.",
      "The chat popup and lead forms then post straight into Flas, and blog posts publish from Content & SEO.",
    ],
    gotchas: ["WordPress.com hosted sites cannot install plugins on the free plan."],
  },
  shopify: {
    requires: ["A Shopify store with theme edit rights"],
    steps: [
      "Download the Shopify package from Integrations.",
      "Add the snippet to your theme and paste the activation key.",
      "Store visitors and orders then create leads in Flas.",
    ],
  },
  woocommerce: {
    requires: ["WooCommerce with REST API keys"],
    steps: [
      "Install the Flas WordPress plugin (it detects WooCommerce automatically).",
      "Create read-only WooCommerce REST keys and paste them into Integrations.",
    ],
  },
};

export function setupGuide(id: string): SetupGuide | undefined {
  return SETUP_GUIDES[id as ConnectorId];
}

/**
 * App-level keys belong to an OAuth provider family rather than one channel:
 * a single Meta app serves Facebook, Instagram, Threads and Meta Ads. Entering
 * them from any of those sets up all of them, which the wizard says out loud
 * so it does not look like repeated work.
 */
const PROVIDER_FIELDS: Record<string, SetupField[]> = {
  meta: [
    {
      key: "clientId",
      label: "App ID",
      placeholder: "e.g. 1234567890123456",
      help: [
        "Sign in to the Meta Developer console and open your app, or create one of type Business.",
        "Go to App settings then Basic.",
        "Copy the App ID at the top and paste it below.",
      ],
      link: { label: "Meta Developer console", url: "https://developers.facebook.com/apps" },
    },
    {
      key: "clientSecret",
      label: "App Secret",
      help: [
        "On the same App settings then Basic page, find App Secret.",
        "Press Show, confirm your password, then copy the value.",
      ],
      link: { label: "Meta Developer console", url: "https://developers.facebook.com/apps" },
      secret: true,
    },
  ],
  google: [
    {
      key: "clientId",
      label: "Client ID",
      placeholder: "...apps.googleusercontent.com",
      help: [
        "Open Google Cloud Console, then APIs and Services, then Credentials.",
        "Create an OAuth client ID of type Web application, or open your existing one.",
        "Copy the Client ID.",
      ],
      link: {
        label: "Google Cloud credentials",
        url: "https://console.cloud.google.com/apis/credentials",
      },
    },
    {
      key: "clientSecret",
      label: "Client secret",
      help: [
        "On the same OAuth client, copy the Client secret.",
        "If it is hidden, use the download or reset icon to reveal it.",
      ],
      link: {
        label: "Google Cloud credentials",
        url: "https://console.cloud.google.com/apis/credentials",
      },
      secret: true,
    },
  ],
  linkedin: [
    {
      key: "clientId",
      label: "Client ID",
      help: [
        "Open the LinkedIn developer portal and select your app.",
        "Go to the Auth tab.",
        "Copy the Client ID.",
      ],
      link: { label: "LinkedIn developer apps", url: "https://www.linkedin.com/developers/apps" },
    },
    {
      key: "clientSecret",
      label: "Client Secret",
      help: ["On the same Auth tab, copy the Primary Client Secret."],
      link: { label: "LinkedIn developer apps", url: "https://www.linkedin.com/developers/apps" },
      secret: true,
    },
  ],
  tiktok: [
    {
      key: "clientId",
      label: "Client key",
      help: [
        "Open the TikTok for Developers console and select your app.",
        "Under Basic information, copy the Client key.",
      ],
      link: { label: "TikTok developer apps", url: "https://developers.tiktok.com/apps" },
    },
    {
      key: "clientSecret",
      label: "Client secret",
      help: ["On the same page, copy the Client secret."],
      link: { label: "TikTok developer apps", url: "https://developers.tiktok.com/apps" },
      secret: true,
    },
  ],
  twitter: [
    {
      key: "clientId",
      label: "Client ID",
      help: [
        "Open the X developer portal, then your project, then your app.",
        "Open Keys and tokens, then OAuth 2.0 Client ID and Client Secret.",
        "Copy the Client ID.",
      ],
      link: { label: "X developer portal", url: "https://developer.x.com/en/portal/dashboard" },
    },
    {
      key: "clientSecret",
      label: "Client Secret",
      help: [
        "On the same screen copy the Client Secret.",
        "X shows it once. Regenerate it if you did not save it.",
      ],
      link: { label: "X developer portal", url: "https://developer.x.com/en/portal/dashboard" },
      secret: true,
    },
  ],
  pinterest: [
    {
      key: "clientId",
      label: "App ID",
      help: ["Open the Pinterest developer console and select your app.", "Copy the App ID."],
      link: { label: "Pinterest developer apps", url: "https://developers.pinterest.com/apps" },
    },
    {
      key: "clientSecret",
      label: "App secret",
      help: ["On the same app page, copy the App secret."],
      link: { label: "Pinterest developer apps", url: "https://developers.pinterest.com/apps" },
      secret: true,
    },
  ],
};

/**
 * WhatsApp is the one channel with no OAuth flow at all. Meta issues a
 * permanent token per phone number instead, so these values belong to the
 * account rather than to an app.
 */
const WHATSAPP_FIELDS: SetupField[] = [
  {
    key: "label",
    label: "Name for this number",
    placeholder: "e.g. Sales line",
    help: ["Only used inside Flas, so your team can tell numbers apart."],
  },
  {
    key: "display_phone",
    label: "Phone number",
    placeholder: "+971 50 963 0506",
    help: ["The number as customers see it. Shown on conversations in the inbox."],
  },
  {
    key: "phone_number_id",
    label: "Phone Number ID",
    placeholder: "e.g. 109876543210987",
    help: [
      "Sign in to Meta Business and open WhatsApp, then API setup.",
      "Find the number you want in the From dropdown.",
      "Copy the Phone number ID shown beneath it, not the phone number itself.",
    ],
    link: { label: "WhatsApp API setup", url: "https://business.facebook.com/wa/manage/home" },
  },
  {
    key: "access_token",
    label: "Permanent Access Token",
    help: [
      "In Meta Business Settings open Users, then System users.",
      "Add a system user with Admin access, then press Generate new token.",
      "Select your app and tick whatsapp_business_messaging and whatsapp_business_management.",
      "Set the expiry to Never, generate, and copy the token. Meta shows it only once.",
    ],
    link: {
      label: "Meta Business system users",
      url: "https://business.facebook.com/settings/system-users",
    },
    secret: true,
  },
  {
    key: "app_secret",
    label: "App Secret",
    help: [
      "Open the Meta Developer console, then your app, then App settings, then Basic.",
      "Press Show next to App Secret and copy it.",
      "Flas verifies every inbound webhook against this. Without it, incoming messages are rejected.",
    ],
    link: { label: "Meta Developer console", url: "https://developers.facebook.com/apps" },
    secret: true,
  },
];

export type CredentialSpec = {
  /** "provider" keys are shared across a family; "account" keys belong to one connection. */
  scope: "provider" | "account";
  provider?: string;
  /** Other channels the same keys unlock, so entering them reads as progress. */
  alsoUnlocks?: string[];
  fields: SetupField[];
};

/** What this channel needs typed in before it can connect, if anything. */
export function credentialSpec(
  id: string,
  opts: { provider?: string | null; siblings?: string[] } = {},
): CredentialSpec | undefined {
  if (id === "whatsapp") return { scope: "account", fields: WHATSAPP_FIELDS };
  const provider = opts.provider ?? undefined;
  if (!provider) return undefined;
  const fields = PROVIDER_FIELDS[provider];
  if (!fields) return undefined;
  return {
    scope: "provider",
    provider,
    ...(opts.siblings?.length ? { alsoUnlocks: opts.siblings } : {}),
    fields,
  };
}
