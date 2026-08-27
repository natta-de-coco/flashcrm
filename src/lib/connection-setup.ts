// Per-platform connection instructions. Every connector card in the
// Integrations hub shows exactly what the platform requires, which permissions
// Flas asks for, and what commonly blocks a connection — so nobody is left
// guessing why Meta or Google refused a login.

import type { ConnectorId } from "./connections-catalog";

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
    gotchas: ["Uploads consume a large daily API quota — schedule videos rather than bulk-posting."],
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
    scopes: ["w_member_social", "r_organization_social", "w_organization_social", "rw_organization_admin"],
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
