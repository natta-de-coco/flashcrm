// Browser-safe connection status model. One place decides whether an
// integration is Connected, Needs verification, Pending review, Expired or
// Failing — and always states the exact reason plus the quickest fix.

import type { Capability, ConnectorId } from "./connections-catalog";

export type ConnectionState =
  | "connected"
  | "needs_verification"
  | "pending_review"
  | "expired"
  | "failing"
  | "not_connected";

export type ConnectionStatus = {
  state: ConnectionState;
  label: string;
  /** Precise, human reason — never a generic "something went wrong". */
  reason: string;
  /** The single next action that resolves it. */
  fix: string;
  tone: "good" | "warn" | "bad" | "muted";
};

export type AccountLike = {
  platform: string;
  active: boolean;
  token_expires_at: string | null;
  last_synced_at: string | null;
  last_analytics_sync_at?: string | null;
  permissions?: string[] | null;
  external_id?: string | null;
  connect_method?: string | null;
  label?: string | null;
};

const STATE_META: Record<ConnectionState, { label: string; tone: ConnectionStatus["tone"] }> = {
  connected: { label: "Connected", tone: "good" },
  needs_verification: { label: "Needs verification", tone: "warn" },
  pending_review: { label: "Pending platform review", tone: "warn" },
  expired: { label: "Token expired", tone: "bad" },
  failing: { label: "Failing", tone: "bad" },
  not_connected: { label: "Not connected", tone: "muted" },
};

/** Permissions Flash needs before a capability actually works. */
export const REQUIRED_PERMISSIONS: Partial<Record<ConnectorId, Partial<Record<Capability, string[]>>>> = {
  instagram: {
    messaging: ["instagram_manage_messages"],
    publish: ["instagram_content_publish"],
    analytics: ["instagram_basic"],
  },
  facebook: {
    messaging: ["pages_messaging"],
    publish: ["pages_manage_posts"],
    analytics: ["read_insights", "pages_read_engagement"],
  },
  google_business: { analytics: ["https://www.googleapis.com/auth/business.manage"] },
  youtube: { publish: ["https://www.googleapis.com/auth/youtube.force-ssl"] },
  tiktok: { publish: ["video.publish"] },
  linkedin: { publish: ["w_organization_social"] },
};

export function connectionStatus(account: AccountLike | undefined): ConnectionStatus {
  const build = (state: ConnectionState, reason: string, fix: string): ConnectionStatus => ({
    state,
    reason,
    fix,
    ...STATE_META[state],
  });

  if (!account) {
    return build(
      "not_connected",
      "Flash has never received an access token for this platform.",
      "Press Connect and follow the guided wizard — it takes about two minutes.",
    );
  }

  if (!account.active) {
    return build(
      "failing",
      "The platform revoked or refused the stored access — usually because the account owner removed Flash, changed the linked Page, or a password reset invalidated the session.",
      "Reconnect the account. Nothing else is lost: your history stays in Flash.",
    );
  }

  const expiry = account.token_expires_at ? new Date(account.token_expires_at).getTime() : null;
  if (expiry && expiry < Date.now()) {
    return build(
      "expired",
      `The access token expired on ${new Date(expiry).toLocaleDateString()}. Platforms expire tokens on a fixed schedule; this is normal.`,
      "Press Reconnect — one approval screen and syncing resumes.",
    );
  }
  if (expiry && expiry - Date.now() < 1000 * 60 * 60 * 24 * 3) {
    return build(
      "needs_verification",
      `The access token expires on ${new Date(expiry).toLocaleDateString()} (less than three days).`,
      "Reconnect now so scheduled posts and inbox sync are not interrupted.",
    );
  }

  const permissions = account.permissions ?? [];
  const required = REQUIRED_PERMISSIONS[account.platform as ConnectorId];
  if (required && permissions.length > 0) {
    const missing = Object.values(required)
      .flat()
      .filter((scope): scope is string => Boolean(scope) && !permissions.includes(scope));
    if (missing.length > 0) {
      return build(
        "needs_verification",
        `Connected, but these permissions were not granted: ${missing.join(", ")}. Features that depend on them stay switched off.`,
        "Reconnect and leave every permission toggle ON on the platform's consent screen.",
      );
    }
  }

  if (!account.last_synced_at) {
    return build(
      "pending_review",
      "Authorisation succeeded but the platform has not returned data yet — typical while an app is in development mode or awaiting API access approval.",
      "Submit your platform app for review (or add yourself as a tester) and press Sync now.",
    );
  }

  const staleFor = Date.now() - new Date(account.last_synced_at).getTime();
  if (staleFor > 1000 * 60 * 60 * 24 * 7) {
    return build(
      "failing",
      `No successful sync for ${Math.round(staleFor / (1000 * 60 * 60 * 24))} days — the platform is rejecting requests or rate-limiting the app.`,
      "Open the logs below for the exact platform error, then reconnect if it mentions permissions or tokens.",
    );
  }

  return build(
    "connected",
    `Healthy — last synced ${new Date(account.last_synced_at).toLocaleString()}.`,
    "Nothing to do. Run a Flash Account Scan any time for growth suggestions.",
  );
}

/** Per-platform verification checklist and the errors people actually hit. */
export type Troubleshooting = {
  /** Ticks the user can confirm themselves before blaming Flash. */
  checklist: string[];
  /** Exact provider error text → what it means → the fix. */
  errors: { error: string; means: string; fix: string }[];
  /** How long the platform's app review usually takes. */
  reviewTimeline?: string;
};

export const TROUBLESHOOTING: Partial<Record<ConnectorId, Troubleshooting>> = {
  instagram: {
    checklist: [
      "Instagram account type is Professional (Business or Creator), not personal.",
      "The Instagram account is linked to a Facebook Page you administer.",
      "You are an Admin (full control) of that Page, not an Editor.",
      "Every permission toggle stayed ON during the Meta login.",
      "The Instagram account is not also connected inside another tool that revoked Flash.",
    ],
    errors: [
      {
        error: "business.facebook.com refused to connect / ERR_BLOCKED_BY_RESPONSE",
        means: "Meta blocks its login inside embedded frames — this is a Meta security header, not a Flash fault.",
        fix: "Use the Connect button: Flash opens Meta in a new browser tab where the login works normally.",
      },
      {
        error: "(#200) Requires instagram_manage_messages permission",
        means: "The DM permission was skipped or later revoked on the consent screen.",
        fix: "Reconnect and keep all toggles ON. Messaging then appears in the Social Inbox.",
      },
      {
        error: "Unsupported get request / object does not exist",
        means: "The Instagram account is still personal, or the Page link was removed.",
        fix: "Switch to a Professional account and relink the Page, then reconnect.",
      },
      {
        error: "Error validating access token: session invalidated",
        means: "The account owner changed their password or removed Flash in Meta settings.",
        fix: "Reconnect once — Flash keeps all previous conversations and stats.",
      },
    ],
    reviewTimeline:
      "Advanced Access for Instagram messaging/publishing: 2–7 business days after Meta App Review submission. Development mode works instantly for accounts you add as testers.",
  },
  facebook: {
    checklist: [
      "You have Admin (full control) of the Page in Meta Business Suite.",
      "The Page belongs to a Business Portfolio you selected during login.",
      "Page is published, not unpublished or restricted.",
      "Messenger permissions were granted if you want DMs in the inbox.",
    ],
    errors: [
      {
        error: "(#210) This Page does not have an associated business",
        means: "The Page is not inside a Business Portfolio.",
        fix: "Add the Page to a Business Portfolio in Meta Business Suite, then reconnect.",
      },
      {
        error: "(#190) Insufficient permission for Messenger",
        means: "You hold an Editor role rather than Admin.",
        fix: "Ask an Admin to raise your role to full control, then reconnect.",
      },
    ],
    reviewTimeline: "Pages permissions in Advanced Access: 2–7 business days via Meta App Review.",
  },
  threads: {
    checklist: [
      "Instagram is connected in Flash first.",
      "A Threads profile exists on that Instagram account.",
    ],
    errors: [
      {
        error: "No Threads account found",
        means: "The Threads profile was never created for that Instagram handle.",
        fix: "Open Threads once on your phone with that Instagram account, then reconnect.",
      },
    ],
    reviewTimeline: "Threads API access is granted with the Meta app review, same 2–7 day window.",
  },
  tiktok: {
    checklist: [
      "The TikTok account is a Business account (recommended for publishing).",
      "Your TikTok app is either live or you added this account as a tester.",
      "Content posting permission was approved for the app.",
    ],
    errors: [
      {
        error: "scope_not_authorized",
        means: "video.publish was not approved for your TikTok app yet.",
        fix: "Request Content Posting API access in the TikTok developer portal; until then Flash saves posts as drafts.",
      },
      {
        error: "user not in tester list",
        means: "The app is in sandbox and this account is not a tester.",
        fix: "Add the account under Sandbox → Target users, then reconnect.",
      },
    ],
    reviewTimeline:
      "TikTok app review for Content Posting API: usually 3–10 business days; audit of unaudited clients can add a week.",
  },
  google_business: {
    checklist: [
      "The location is verified at business.google.com (unverified returns no data).",
      "You are Owner or Manager of that location.",
      "Business Profile APIs are enabled on the Google Cloud project.",
      "The one-time Business Profile API access request was approved.",
    ],
    errors: [
      {
        error: "Request had insufficient authentication scopes",
        means: "business.manage was not granted during the Google consent screen.",
        fix: "Reconnect and tick the Business Profile permission.",
      },
      {
        error: "The caller does not have permission",
        means: "The Google account signed in is not a Manager/Owner of the location.",
        fix: "Sign in with the account that manages the location, or get Manager access first.",
      },
      {
        error: "PERMISSION_DENIED: Business Profile API has not been used in project…",
        means: "The API is not enabled or the access request is still pending.",
        fix: "Enable the API and submit the standard access request form — approval is per Google Cloud project, once.",
      },
    ],
    reviewTimeline:
      "Google Business Profile API access request: typically 3–5 business days, and it covers every location you manage afterwards.",
  },
  youtube: {
    checklist: [
      "You signed in with the Google account that owns the channel (pick the Brand Account if you use one).",
      "YouTube Data API v3 is enabled on the Google Cloud project.",
      "Uploads permission granted if you plan to publish from Flash.",
    ],
    errors: [
      {
        error: "quotaExceeded",
        means: "The daily API quota is used up — uploads are expensive.",
        fix: "Schedule videos across days or request a quota increase in Google Cloud.",
      },
      {
        error: "youtubeSignupRequired",
        means: "The Google account has no channel attached.",
        fix: "Create the channel or reconnect choosing the correct Brand Account.",
      },
    ],
    reviewTimeline:
      "Google OAuth verification for sensitive YouTube scopes: 2–6 weeks if you publish publicly; internal/testing use is immediate.",
  },
  linkedin: {
    checklist: [
      "You are Super Admin of the LinkedIn Company Page.",
      "Your LinkedIn app has the Community Management product approved.",
    ],
    errors: [
      {
        error: "ACCESS_DENIED: Not enough permissions to access resource",
        means: "The Community Management API product is not approved for your app.",
        fix: "Request the product in the LinkedIn developer portal and reconnect once approved.",
      },
    ],
    reviewTimeline: "LinkedIn Community Management product review: 1–4 weeks.",
  },
  twitter: {
    checklist: [
      "Your X developer project is on a tier that allows posting (Basic or higher).",
      "The app has Read and Write permissions, and OAuth 2.0 is enabled.",
    ],
    errors: [
      {
        error: "403 You currently have access to a subset of X API V2 endpoints",
        means: "The free tier does not allow this endpoint.",
        fix: "Upgrade the X plan, or keep Flash read-only for that account.",
      },
    ],
    reviewTimeline: "No review — access follows your paid X API tier immediately.",
  },
  pinterest: {
    checklist: ["The Pinterest account is a business account.", "The app has standard access approved."],
    errors: [
      {
        error: "You are not permitted to access this endpoint",
        means: "The Pinterest app is still on trial access.",
        fix: "Apply for standard access in the Pinterest developer portal.",
      },
    ],
    reviewTimeline: "Pinterest standard access review: 3–10 business days.",
  },
  whatsapp: {
    checklist: [
      "The number is registered on WhatsApp Cloud API, not the consumer app.",
      "Phone Number ID and a permanent token are saved in Settings → Numbers.",
      "The Flash webhook URL and verify token are saved in Meta → WhatsApp → Configuration.",
      "The messages webhook field is subscribed.",
      "Message templates you use are Approved in Meta.",
    ],
    errors: [
      {
        error: "(#131047) Re-engagement message",
        means: "You are messaging outside the 24-hour customer service window.",
        fix: "Send an approved template instead of free text — Flash blocks this automatically and tells you why.",
      },
      {
        error: "(#132000) Template param count mismatch",
        means: "The template variables you filled do not match the approved template.",
        fix: "Open the template manager in Settings and match the variable count exactly.",
      },
      {
        error: "Webhook verification failed",
        means: "The verify token in Meta does not match the one in Flash.",
        fix: "Copy the token from Settings → Numbers again, no spaces, and re-verify.",
      },
    ],
    reviewTimeline:
      "Business verification: 1–5 business days. Template approval: minutes to 24 hours per template.",
  },
  wordpress: {
    checklist: [
      "Plugin uploaded and activated in WordPress → Plugins.",
      "Activation key pasted and shown as Active in Flash.",
      "Site reachable over HTTPS (self-signed certificates fail).",
      "A security plugin is not blocking outbound REST requests.",
    ],
    errors: [
      {
        error: "Invalid signature",
        means: "The site key and secret pair do not match, usually after regenerating the key.",
        fix: "Regenerate the key in Flash and paste both values into the plugin settings again.",
      },
      {
        error: "Leads not arriving",
        means: "Caching or a firewall is blocking the webhook call.",
        fix: "Exclude the Flash endpoint from caching and allow outbound POST to flas.mobidigisol.com.",
      },
    ],
    reviewTimeline: "No review — the plugin works the moment the activation key is accepted.",
  },
  shopify: {
    checklist: [
      "Snippet added to the theme and saved.",
      "Activation key pasted in Flash.",
      "Theme not overridden by a newer published theme.",
    ],
    errors: [
      {
        error: "Popup not showing",
        means: "The snippet sits in an unpublished theme.",
        fix: "Add the snippet to the live theme, or re-add it after a theme update.",
      },
    ],
    reviewTimeline: "No review needed for theme snippets.",
  },
  woocommerce: {
    checklist: [
      "Flash WordPress plugin installed (it detects WooCommerce automatically).",
      "Read-only WooCommerce REST keys pasted into Flash.",
    ],
    errors: [
      {
        error: "woocommerce_rest_authentication_error",
        means: "The REST key pair is wrong or the site rewrites Authorization headers.",
        fix: "Recreate read-only keys and, on nginx, allow the Authorization header through.",
      },
    ],
  },
  meta_ads: {
    checklist: [
      "The ad account sits inside a Business Portfolio you administer.",
      "ads_read was granted on the consent screen.",
    ],
    errors: [
      {
        error: "(#272) This Ads API request is not allowed",
        means: "The ad account was not ticked during login.",
        fix: "Reconnect and select the ad account explicitly.",
      },
    ],
    reviewTimeline: "Standard Access to the Marketing API is instant for your own ad accounts.",
  },
  google_ads: {
    checklist: [
      "You have Standard or Admin access to the Google Ads account.",
      "A developer token is approved for the Google Ads API.",
      "For manager accounts, the child account is selected.",
    ],
    errors: [
      {
        error: "DEVELOPER_TOKEN_NOT_APPROVED",
        means: "The developer token is still in test mode.",
        fix: "Apply for Basic Access to the Google Ads API in the API Center.",
      },
      {
        error: "USER_PERMISSION_DENIED",
        means: "The signed-in Google account cannot see that customer ID.",
        fix: "Use the account with Standard access, or select the correct child account.",
      },
    ],
    reviewTimeline: "Google Ads API Basic Access: 1–3 business days.",
  },
  google_analytics: {
    checklist: ["It is a GA4 property (not Universal Analytics).", "You have at least Viewer access."],
    errors: [
      {
        error: "User does not have sufficient permissions for this property",
        means: "The signed-in Google account lacks access to the GA4 property.",
        fix: "Grant Viewer access in GA4 admin, then reconnect.",
      },
    ],
  },
  search_console: {
    checklist: ["The domain property is verified in Search Console.", "You are Owner or Full user."],
    errors: [
      {
        error: "User does not have sufficient permission for site",
        means: "The property is verified under a different Google account.",
        fix: "Add your account as Full user in Search Console settings, then reconnect.",
      },
    ],
    reviewTimeline: "Search data always lags 2–3 days — that is Google's delay, not Flash's.",
  },
};

export function troubleshooting(id: string): Troubleshooting | undefined {
  return TROUBLESHOOTING[id as ConnectorId];
}
