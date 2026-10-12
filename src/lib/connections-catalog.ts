// Browser-safe catalogue of every business platform Flas can connect to.
// Capabilities describe what each platform's official API actually allows, so
// the UI never promises a feature the API cannot deliver.

export type ConnectorGroup = "social" | "ads" | "analytics" | "commerce" | "messaging";

/** Platforms stored as rows in social_accounts. */
export const SOCIAL_ACCOUNT_PLATFORMS = [
  "instagram",
  "facebook",
  "youtube",
  "twitter",
  "linkedin",
  "tiktok",
  "google_business",
  "pinterest",
  "threads",
  "google_ads",
  "meta_ads",
  "linkedin_ads",
  "tiktok_ads",
  "google_analytics",
  "search_console",
] as const;

export type AccountPlatform = (typeof SOCIAL_ACCOUNT_PLATFORMS)[number];

/** Platforms that live in their own Flas module (own tables and screens). */
export const EXTERNAL_CONNECTORS = ["whatsapp", "wordpress", "shopify", "woocommerce"] as const;
export type ExternalConnector = (typeof EXTERNAL_CONNECTORS)[number];

export type ConnectorId = AccountPlatform | ExternalConnector;

export type Capability = "publish" | "analytics" | "messaging" | "ads" | "profile";

export type Connector = {
  id: ConnectorId;
  name: string;
  group: ConnectorGroup;
  /** Short line shown on the card. */
  blurb: string;
  /** True when Flas can run the platform's official OAuth authorization flow. */
  oauth: boolean;
  /**
   * Set when the connector cannot actually be connected yet, with the reason
   * shown in place of a Connect button. A Connect that "succeeds" and then
   * does nothing is worse than an honest "not yet".
   */
  unavailableReason?: string;
  limitedReason?: string;
  /** OAuth provider family used for the token exchange. */
  provider?: "meta" | "google" | "linkedin" | "tiktok" | "twitter" | "pinterest";
  /** Capabilities the official API supports (subject to granted permissions). */
  /** Capabilities the API does not support at all — shown as unavailable. */
  /** Where the owner manages the platform itself. */
  manageUrl: string;
  /** Handled by another Flas module instead of social_accounts. */
  internalHref?: string;
  /** Builds the public profile URL from the stored handle when possible. */
  profilePattern?: (handle: string) => string;
};

export const CONNECTORS: Connector[] = [
  {
    id: "facebook",
    limitedReason: "Publishing and sending Messenger replies are not available yet.",
    name: "Facebook",
    group: "social",
    blurb: "Read Page posts, comments, Messenger and basic insights.",
    oauth: true,
    provider: "meta",
    manageUrl: "https://business.facebook.com/latest/home",
    profilePattern: (h) => `https://facebook.com/${h}`,
  },
  {
    id: "instagram",
    limitedReason:
      "Publishing and Instagram DMs are not available yet. A professional account linked to a Facebook Page is required.",
    name: "Instagram",
    group: "social",
    blurb: "Professional account posts, comments and insights.",
    oauth: true,
    provider: "meta",
    manageUrl: "https://business.facebook.com/latest/instagram_content",
    profilePattern: (h) => `https://instagram.com/${h}`,
  },
  {
    id: "linkedin",
    limitedReason:
      "Reading and analytics depend on approved LinkedIn access. Publishing is not available yet.",
    name: "LinkedIn",
    group: "social",
    blurb: "Company page posts and follower/impression analytics.",
    oauth: true,
    provider: "linkedin",
    manageUrl: "https://www.linkedin.com/company/me/",
    profilePattern: (h) => `https://www.linkedin.com/company/${h}/`,
  },
  {
    id: "tiktok",
    name: "TikTok",
    group: "social",
    blurb: "Connect your TikTok profile.",
    limitedReason: "Profile and video metrics. Video publishing is not implemented in FLAS yet.",
    oauth: true,
    provider: "tiktok",
    manageUrl: "https://www.tiktok.com/tiktokstudio",
    profilePattern: (h) => `https://www.tiktok.com/@${h}`,
  },
  {
    id: "youtube",
    limitedReason:
      "Read videos, comments and public statistics. Uploading and comment replies are not available yet.",
    name: "YouTube",
    group: "social",
    blurb: "Channel videos, comments and channel statistics.",
    oauth: true,
    provider: "google",
    // Comments are not messaging. YouTube exposes no direct-message API to
    // businesses, and the setup wizard requests no messaging scope, so the
    // card was promising an inbox that could never fill.
    manageUrl: "https://studio.youtube.com",
    profilePattern: (h) => `https://youtube.com/${h.startsWith("@") ? h : `channel/${h}`}`,
  },
  {
    id: "twitter",
    limitedReason: "Read posts and public metrics. Publishing and DMs are not available yet.",
    name: "X / Twitter",
    group: "social",
    blurb: "Posts and public post metrics.",
    oauth: true,
    provider: "twitter",
    manageUrl: "https://x.com/home",
    profilePattern: (h) => `https://x.com/${h.replace("@", "")}`,
  },
  {
    id: "google_business",
    name: "Google Business Profile",
    group: "social",
    blurb: "Local posts, reviews, calls and direction requests.",
    oauth: true,
    provider: "google",
    // Google shut down Business Profile chat and Business Messages on
    // 31 July 2024, so messaging is not merely unimplemented here — it no
    // longer exists on Google's side for anyone.
    // https://support.google.com/business/answer/14919056
    manageUrl: "https://business.google.com/dashboard",
  },
  {
    id: "pinterest",
    limitedReason:
      "Profile connection only. Pin sync, publishing and analytics are not available yet.",
    name: "Pinterest",
    group: "social",
    blurb: "Connect your Pinterest profile.",
    oauth: true,
    provider: "pinterest",
    manageUrl: "https://www.pinterest.com/business/hub/",
    profilePattern: (h) => `https://www.pinterest.com/${h}/`,
  },
  {
    id: "threads",
    name: "Threads",
    group: "social",
    blurb: "Threads posts and post insights.",
    oauth: true,
    unavailableReason:
      "Threads uses its own login and its own app keys, separate from Facebook's. Flas does not support that login yet.",
    provider: "meta",
    manageUrl: "https://www.threads.net",
    profilePattern: (h) => `https://www.threads.net/@${h.replace("@", "")}`,
  },
  {
    id: "whatsapp",
    unavailableReason:
      "Simple WhatsApp onboarding is coming soon. Existing connected numbers keep working.",
    name: "WhatsApp Business",
    group: "messaging",
    blurb: "Numbers, templates, chatbot and conversations.",
    oauth: false,
    manageUrl: "https://business.facebook.com/wa/manage/",
    // Embedded Signup is a separate integration, not the Pages OAuth flow.
  },
  {
    id: "meta_ads",
    name: "Meta Ads",
    group: "ads",
    blurb: "Campaign spend, CPL, creative fatigue signals.",
    oauth: true,
    provider: "meta",
    manageUrl: "https://adsmanager.facebook.com",
  },
  {
    id: "google_ads",
    name: "Google Ads",
    group: "ads",
    blurb: "Search spend, conversions and search terms.",
    oauth: true,
    unavailableReason:
      "Google Ads needs a Google Ads developer token, and Flas does not read ad data yet.",
    provider: "google",
    manageUrl: "https://ads.google.com",
  },
  {
    id: "linkedin_ads",
    name: "LinkedIn Ads",
    group: "ads",
    blurb: "B2B campaign performance and lead gen forms.",
    oauth: true,
    unavailableReason:
      "LinkedIn Ads needs LinkedIn's Advertising API approval, and Flas does not read ad data yet. Connecting it would also sign out your LinkedIn Page connection.",
    provider: "linkedin",
    manageUrl: "https://www.linkedin.com/campaignmanager/",
  },
  {
    id: "tiktok_ads",
    name: "TikTok Ads",
    group: "ads",
    blurb: "Campaign spend and creative performance.",
    oauth: true,
    unavailableReason:
      "TikTok Ads needs TikTok's advertising API, which has its own login and developer approval. Flas does not support it yet.",
    provider: "tiktok",
    manageUrl: "https://ads.tiktok.com",
  },
  {
    id: "google_analytics",
    name: "Google Analytics",
    group: "analytics",
    blurb: "Sessions, sources, conversions and landing pages.",
    oauth: true,
    provider: "google",
    manageUrl: "https://analytics.google.com",
  },
  {
    id: "search_console",
    name: "Google Search Console",
    group: "analytics",
    blurb: "Impressions, clicks, positions and query data.",
    oauth: true,
    provider: "google",
    manageUrl: "https://search.google.com/search-console",
  },
  {
    id: "wordpress",
    name: "WordPress",
    group: "commerce",
    blurb: "Lead plugin, blog sync and SEO publishing.",
    oauth: false,
    manageUrl: "https://wordpress.org/support/",
    internalHref: "/seo-blog",
  },
  {
    id: "shopify",
    unavailableReason: "Guided Shopify onboarding is coming soon.",
    name: "Shopify",
    group: "commerce",
    blurb: "Store widget, products and order-driven leads.",
    oauth: false,
    manageUrl: "https://admin.shopify.com",
    internalHref: "/connect",
  },
  {
    id: "woocommerce",
    unavailableReason: "Guided WooCommerce onboarding is coming soon.",
    name: "WooCommerce",
    group: "commerce",
    blurb: "Store leads and product catalogue sync.",
    oauth: false,
    manageUrl: "https://woocommerce.com/document/woocommerce-rest-api/",
    internalHref: "/connect",
  },
];

export function connector(id: string): Connector | undefined {
  return CONNECTORS.find((c) => c.id === id);
}

export const CAPABILITY_LABEL: Record<Capability, string> = {
  publish: "Publishing",
  analytics: "Analytics",
  messaging: "Messaging",
  ads: "Advertising",
  profile: "Profile editing",
};

export const GROUP_LABEL: Record<ConnectorGroup, string> = {
  social: "Social platforms",
  messaging: "Messaging",
  ads: "Advertising",
  analytics: "Website & search data",
  commerce: "Website & stores",
};
