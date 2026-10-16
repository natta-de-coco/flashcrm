// Browser-safe connection status model. One place decides whether an
// integration is Connected, Needs verification, Pending review, Expired,
// Failing or Platform unavailable -- and always states the exact reason plus the
// quickest fix.
//
// "Connected" means one thing: Flas asked the platform, the platform accepted the
// token, every permission Flas needs was granted, and that result was saved
// (last_validation_success_at). Being authorized, being active, having synced
// once and having `connection_state = connected` are not evidence of that: the
// state is written at connect time, before anyone has asked the platform.
//
// Both readers of this status (the Connect accounts screen and the Integration
// Health report) build their input with statusInputFromRow() and call
// connectionStatus(), so they cannot disagree about the same account.

import {
  featuresForScopes,
  hasLiveCheck,
  missingScopesFor,
  notProvenFor,
  scopesUnknown,
} from "./connection-state";
import { connector } from "./connections-catalog";
import type { ConnectorId } from "./connections-catalog";

export type ConnectionState =
  | "connected"
  | "unverified"
  | "needs_verification"
  | "pending_review"
  | "expired"
  | "failing"
  | "provider_unavailable"
  | "not_connected";

/**
 * Why the status says what it says, as a fixed code. The English `reason` and `fix` stay as the
 * fallback (CSV, PDF, older screens); a screen that translates picks its sentence by this code
 * and fills the gaps from `params`.
 */
export type StatusReasonCode =
  | "never_connected"
  | "disconnected"
  | "revoked"
  | "refresh_failed"
  | "provider_unavailable"
  | "expired"
  | "expiring"
  | "scopes_missing"
  | "scopes_unknown"
  | "manual_token"
  | "unidentified"
  | "evidence_unavailable"
  | "not_verified"
  | "verified_not_synced"
  | "sync_stale"
  | "connected";

export type StatusParams = {
  /** ISO time of the last successful live check. */
  verified?: string | null;
  /** ISO time of the last successful sync. */
  synced?: string | null;
  /** ISO time to try again after (platform unavailable). */
  retry_at?: string | null;
  /**
   * What the platform did not grant, as plain feature names ("Read DMs"). Permission names such
   * as pages_messaging are for staff diagnostics only and never travel in a status.
   */
  missing?: string[];
  /** Features a live token check cannot prove (they depend on the platform's app review). */
  not_proven?: string[];
};

/**
 * The one thing a person should do next, chosen from the evidence on the account and nothing
 * else. Every screen names it the same way:
 *   connect         "Continue with {Platform}"   nothing is connected
 *   choose_account  "Choose account"             signed in, but no account was chosen
 *   verify          "Verify now"                 authorized, never verified
 *   reconnect       "Reconnect"                  the token was refused, a permission is missing,
 *                                                or the token was pasted by hand
 *   retry           "Retry now"                  the platform did not answer; try again
 *   coming_soon     "Coming soon"                Flas has no live check (or has not built it) for
 *                                                this connector, so there is nothing to press
 *   none                                         nothing to do
 */
export type NextAction =
  "connect" | "choose_account" | "verify" | "reconnect" | "retry" | "coming_soon" | "none";

export type ConnectionStatus = {
  state: ConnectionState;
  label: string;
  /** Precise, human reason -- never a generic "something went wrong". */
  reason: string;
  /** The single next action that resolves it, in words. */
  fix: string;
  tone: "good" | "warn" | "bad" | "muted";
  code: StatusReasonCode;
  params: StatusParams;
  /** The same next step as a fixed code, so a screen can show one button. */
  action: NextAction;
};

/** Whether the saved verification results could be read at all. */
export type EvidenceState = "ok" | "unavailable";

export type AccountLike = {
  platform: string;
  active: boolean;
  token_expires_at: string | null;
  last_synced_at: string | null;
  last_analytics_sync_at?: string | null;
  /** Scopes the provider returned on the token response. The only source of permissions. */
  granted_scopes?: string[] | null;
  external_id?: string | null;
  connect_method?: string | null;
  label?: string | null;
  /** Last live provider call that proved the token works. */
  last_validation_success_at?: string | null;
  /** Last time a live call was tried, whatever it found. */
  last_validation_attempt_at?: string | null;
  legacy_manual_connection?: boolean | null;
  /** Batch 2A: set for channels on a shared authorization. */
  authorization_id?: string | null;
  /** Batch 2A: scopes the authorization asked for and was not granted. */
  missing_scopes?: string[] | null;
  /** True when a refresh token is stored, so the access token renews itself. */
  renews?: boolean | null | undefined;
  /** The durable state model (connection-state.ts). Not evidence by itself. */
  connection_state?: string | null;
  last_error_at?: string | null;
  next_retry_at?: string | null;
  /** "unavailable": the columns that hold verification results could not be read. */
  evidence?: EvidenceState | undefined;
};

const STATE_META: Record<ConnectionState, { label: string; tone: ConnectionStatus["tone"] }> = {
  connected: { label: "Connected", tone: "good" },
  unverified: { label: "Not yet verified", tone: "warn" },
  needs_verification: { label: "Needs verification", tone: "warn" },
  pending_review: { label: "Pending platform review", tone: "warn" },
  expired: { label: "Token expired", tone: "bad" },
  failing: { label: "Failing", tone: "bad" },
  provider_unavailable: { label: "Platform unavailable", tone: "warn" },
  not_connected: { label: "Not connected", tone: "muted" },
};

/** The row fields the status reads, plus the saved verification result (if it could be read). */
export type StatusRowFields = {
  platform: string;
  active: boolean;
  token_expires_at: string | null;
  last_synced_at: string | null;
  last_analytics_sync_at?: string | null | undefined;
  granted_scopes?: string[] | null | undefined;
  external_id?: string | null | undefined;
  connect_method?: string | null | undefined;
  label?: string | null | undefined;
  renews?: boolean | null | undefined;
  connection_state?: string | null | undefined;
  last_validation_success_at?: string | null | undefined;
  last_validation_attempt_at?: string | null | undefined;
  last_error_at?: string | null | undefined;
  next_retry_at?: string | null | undefined;
  legacy_manual_connection?: boolean | null | undefined;
  authorization_id?: string | null | undefined;
  missing_scopes?: string[] | null | undefined;
};

export type StatusEvidence = {
  state: EvidenceState;
  connection_state?: string | null | undefined;
  last_validation_success_at?: string | null | undefined;
  last_validation_attempt_at?: string | null | undefined;
  last_error_at?: string | null | undefined;
  next_retry_at?: string | null | undefined;
};

/**
 * The one way to turn a stored account into the input of connectionStatus(). Both readers use
 * it. When the verification results could not be read ("unavailable") any timestamp that happens
 * to be on the row is ignored: a result that cannot be confirmed as saved is not shown as saved.
 */
export function statusInputFromRow(row: StatusRowFields, evidence?: StatusEvidence): AccountLike {
  const readable = evidence ? evidence.state === "ok" : true;
  return {
    platform: row.platform,
    active: row.active,
    token_expires_at: row.token_expires_at,
    last_synced_at: row.last_synced_at,
    last_analytics_sync_at: row.last_analytics_sync_at ?? null,
    granted_scopes: row.granted_scopes ?? null,
    external_id: row.external_id ?? null,
    connect_method: row.connect_method ?? null,
    label: row.label ?? null,
    renews: row.renews ?? null,
    legacy_manual_connection: row.legacy_manual_connection ?? null,
    authorization_id: row.authorization_id ?? null,
    missing_scopes: row.missing_scopes ?? null,
    connection_state: evidence?.connection_state ?? row.connection_state ?? null,
    last_validation_success_at: readable
      ? (evidence?.last_validation_success_at ?? row.last_validation_success_at ?? null)
      : null,
    last_validation_attempt_at: readable
      ? (evidence?.last_validation_attempt_at ?? row.last_validation_attempt_at ?? null)
      : null,
    last_error_at: evidence?.last_error_at ?? row.last_error_at ?? null,
    next_retry_at: evidence?.next_retry_at ?? row.next_retry_at ?? null,
    evidence: evidence?.state ?? "ok",
  };
}

/** States that mean "no authorization is in place": nothing to verify, nothing failing. */
const NOTHING_AUTHORIZED = new Set([
  "disconnected",
  "ready_to_authorize",
  "missing_app_credentials",
]);

/**
 * The next step for a reason code. It follows the evidence only: nothing is asked of a person
 * that the account's own facts do not call for, and a connector Flas cannot test (or has not built)
 * says "Coming soon" instead of offering a check that cannot run.
 */
export function nextActionFor(code: StatusReasonCode, platform: string | undefined): NextAction {
  const meta = platform ? connector(platform) : undefined;
  // Without a platform (no account) we cannot know; assume it can be connected.
  const built = platform ? Boolean(meta?.oauth) && !meta?.unavailableReason : true;
  const checkable = platform ? hasLiveCheck(platform) : true;
  switch (code) {
    case "never_connected":
    case "disconnected":
      return built ? "connect" : "coming_soon";
    case "unidentified":
      return "choose_account";
    case "not_verified":
    case "evidence_unavailable":
    case "sync_stale":
      return checkable ? "verify" : "coming_soon";
    case "scopes_missing":
    case "scopes_unknown":
    case "manual_token":
    case "revoked":
    case "refresh_failed":
    case "expired":
    case "expiring":
      return "reconnect";
    case "provider_unavailable":
      return "retry";
    case "verified_not_synced":
    case "connected":
      return "none";
  }
}

export function connectionStatus(account: AccountLike | undefined): ConnectionStatus {
  const platformName = (account && connector(account.platform)?.name) || "The platform";
  const build = (
    state: ConnectionState,
    code: StatusReasonCode,
    reason: string,
    fix: string,
    params: StatusParams = {},
    label?: string,
  ): ConnectionStatus => ({
    state,
    code,
    reason,
    fix,
    params,
    action: nextActionFor(code, account?.platform),
    ...STATE_META[state],
    ...(label ? { label } : {}),
  });
  const when = (iso: string) => new Date(iso).toLocaleString();

  if (!account) {
    return build(
      "not_connected",
      "never_connected",
      "Flas has never received an access token for this platform.",
      "Press Connect and follow the guided wizard — it takes about two minutes.",
    );
  }

  const state = account.connection_state ?? null;

  // Someone disconnected it on purpose (or it was never authorized). That is not a failure, and
  // it must not read as "the platform refused the stored access".
  if (state !== null && NOTHING_AUTHORIZED.has(state)) {
    if (state === "disconnected") {
      return build(
        "not_connected",
        "disconnected",
        "Someone in this workspace disconnected this account on purpose.",
        "Connect it again whenever you need it.",
        {},
        "Disconnected",
      );
    }
    return build(
      "not_connected",
      "never_connected",
      "Flas has never received an access token for this platform.",
      "Press Connect and follow the guided wizard — it takes about two minutes.",
    );
  }

  if (state === "refresh_failed") {
    return build(
      "failing",
      "refresh_failed",
      "The platform did not accept the stored sign-in the last time Flas checked it.",
      "Press Retry now. If it still fails, reconnect the account.",
    );
  }
  if (state === "revoked" || !account.active) {
    return build(
      "failing",
      "revoked",
      "The platform revoked or refused the stored access — usually because the account owner removed Flas, changed the linked Page, or a password reset invalidated the session.",
      "Reconnect the account. Nothing else is lost: your history stays in Flas.",
    );
  }

  // The platform is down or limiting requests. The connection itself was not touched, so this is
  // not a failure and reconnecting would not help.
  if (state === "provider_unavailable") {
    return build(
      "provider_unavailable",
      "provider_unavailable",
      `${platformName} is not answering or is limiting requests. Your connection has not been changed.`,
      account.next_retry_at
        ? `Nothing to do now. Press Retry now after ${when(account.next_retry_at)}.`
        : "Nothing to do now. Press Retry now in a few minutes.",
      { retry_at: account.next_retry_at ?? null },
    );
  }

  // A token that renews itself expires by design -- a Google access token
  // lasts an hour. Its date is not a problem to show: every such connection
  // read "expires in less than three days" or "Token expired" from the moment
  // it was made. A refresh that actually fails marks the connection failing.
  const expiry =
    !account.renews && account.token_expires_at
      ? new Date(account.token_expires_at).getTime()
      : null;
  if (expiry && expiry < Date.now()) {
    return build(
      "expired",
      "expired",
      `The access token expired on ${new Date(expiry).toLocaleDateString()}. Platforms expire tokens on a fixed schedule; this is normal.`,
      "Press Reconnect — one approval screen and syncing resumes.",
    );
  }
  if (expiry && expiry - Date.now() < 1000 * 60 * 60 * 24 * 3) {
    return build(
      "needs_verification",
      "expiring",
      `The access token expires on ${new Date(expiry).toLocaleDateString()} (less than three days).`,
      "Reconnect now so scheduled posts and inbox sync are not interrupted.",
    );
  }

  // Reads granted_scopes -- the scopes the provider actually returned. (`permissions` holds the
  // capability keys Flas enabled, never provider scopes, and is not read here.)
  //
  // missingScopesFor() derives from the connector registry and counts only
  // capabilities Flas has actually implemented, so a customer is never asked
  // to re-authorize for a permission that unlocks nothing.
  {
    // Channels on an authorization are judged against what was asked for; an
    // optional tier nobody turned on is an upgrade, not a missing permission.
    const missing = account.authorization_id
      ? (account.missing_scopes ?? [])
      : missingScopesFor(account.platform, account.granted_scopes ?? []);
    if (missing.length > 0) {
      // Said in features ("Read DMs"), not in permission names: those are for staff diagnostics.
      const features = featuresForScopes(account.platform, missing);
      return build(
        "needs_verification",
        "scopes_missing",
        `Connected, but ${platformName} did not grant what these features need: ${features.join(", ")}. They stay switched off.`,
        "Reconnect and leave every permission toggle ON on the platform's consent screen.",
        { missing: features },
      );
    }
    // The platform has not said which permissions this token holds, and the connector needs some.
    // A working token is not proof the right permissions are on it.
    if (!account.authorization_id && scopesUnknown(account.platform, account.granted_scopes)) {
      return build(
        "unverified",
        "scopes_unknown",
        `${platformName} accepts the token but did not list its permissions, so Flas cannot confirm them.`,
        "Reconnect and keep every permission switched on.",
      );
    }
  }

  // "Healthy" needs a live provider check that succeeded. A recent sync proves the database was
  // written, not that the token works, and a pasted token was never checked by anyone.
  if (account.legacy_manual_connection || account.connect_method === "manual") {
    return build(
      "unverified",
      "manual_token",
      "Added with a pasted token before Batch 1, and never verified against the platform.",
      "Reconnect it through Connect & setup so Flas can verify it.",
    );
  }

  // No account was chosen yet (a Meta login waiting for its Page, a sign-in waiting for its
  // account). Nothing identifies what a check would be checking.
  if (account.external_id !== undefined && !account.external_id) {
    return build(
      "unverified",
      "unidentified",
      "This sign-in is saved, but no account was chosen yet.",
      "Choose which account to connect.",
    );
  }

  // The results of checks could not be read or saved: say so, never guess green.
  if (account.evidence === "unavailable") {
    return build(
      "unverified",
      "evidence_unavailable",
      "Flas cannot save verification results for this workspace yet, so this account cannot be marked verified.",
      "Ask Flas support to finish the database update, then press Verify now.",
    );
  }

  if (!account.last_validation_success_at) {
    return build(
      "unverified",
      "not_verified",
      `Authorized, but Flas has not yet confirmed with ${platformName} that the token works.`,
      `Press Verify now. Flas asks ${platformName} once and changes nothing else.`,
    );
  }

  if (!account.last_synced_at) {
    return build(
      "pending_review",
      "verified_not_synced",
      `Verified ${when(account.last_validation_success_at)}, but the first sync has not finished.`,
      "Press Sync now. If it stays empty, the platform app may still be in review or development mode.",
      { verified: account.last_validation_success_at },
    );
  }

  const staleFor = Date.now() - new Date(account.last_synced_at).getTime();
  if (staleFor > 1000 * 60 * 60 * 24 * 7) {
    return build(
      "failing",
      "sync_stale",
      `No successful sync for ${Math.round(staleFor / (1000 * 60 * 60 * 24))} days — the platform is rejecting requests or rate-limiting the app.`,
      "Open the logs below for the exact platform error, then reconnect if it mentions permissions or tokens.",
    );
  }

  return build(
    "connected",
    "connected",
    `Verified ${when(account.last_validation_success_at)}. ${platformName} accepted the token and every permission Flas needs was granted. Last synced ${when(account.last_synced_at)}.`,
    "Nothing to do.",
    {
      verified: account.last_validation_success_at,
      synced: account.last_synced_at,
      not_proven: notProvenFor(account.platform),
    },
  );
}

/** Per-platform verification checklist and the errors people actually hit. */
export type Troubleshooting = {
  /** Ticks the user can confirm themselves before blaming Flas. */
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
      "The Instagram account is not also connected inside another tool that revoked Flas.",
    ],
    errors: [
      {
        error: "business.facebook.com refused to connect / ERR_BLOCKED_BY_RESPONSE",
        means:
          "Meta blocks its login inside embedded frames — this is a Meta security header, not a Flas fault.",
        fix: "Use the Connect button: Flas opens Meta in a new browser tab where the login works normally.",
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
        means: "The account owner changed their password or removed Flas in Meta settings.",
        fix: "Reconnect once — Flas keeps all previous conversations and stats.",
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
      "Instagram is connected in Flas first.",
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
        fix: "Request Content Posting API access in the TikTok developer portal; until then Flas saves posts as drafts.",
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
      "Uploads permission granted if you plan to publish from Flas.",
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
        fix: "Upgrade the X plan, or keep Flas read-only for that account.",
      },
    ],
    reviewTimeline: "No review — access follows your paid X API tier immediately.",
  },
  pinterest: {
    checklist: [
      "The Pinterest account is a business account.",
      "The app has standard access approved.",
    ],
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
      "The Flas webhook URL and verify token are saved in Meta → WhatsApp → Configuration.",
      "The messages webhook field is subscribed.",
      "Message templates you use are Approved in Meta.",
    ],
    errors: [
      {
        error: "(#131047) Re-engagement message",
        means: "You are messaging outside the 24-hour customer service window.",
        fix: "Send an approved template instead of free text — Flas blocks this automatically and tells you why.",
      },
      {
        error: "(#132000) Template param count mismatch",
        means: "The template variables you filled do not match the approved template.",
        fix: "Open the template manager in Settings and match the variable count exactly.",
      },
      {
        error: "Webhook verification failed",
        means: "The verify token in Meta does not match the one in Flas.",
        fix: "Copy the token from Settings → Numbers again, no spaces, and re-verify.",
      },
    ],
    reviewTimeline:
      "Business verification: 1–5 business days. Template approval: minutes to 24 hours per template.",
  },
  wordpress: {
    checklist: [
      "Plugin uploaded and activated in WordPress → Plugins.",
      "Activation key pasted and shown as Active in Flas.",
      "Site reachable over HTTPS (self-signed certificates fail).",
      "A security plugin is not blocking outbound REST requests.",
    ],
    errors: [
      {
        error: "Invalid signature",
        means: "The site key and secret pair do not match, usually after regenerating the key.",
        fix: "Regenerate the key in Flas and paste both values into the plugin settings again.",
      },
      {
        error: "Leads not arriving",
        means: "Caching or a firewall is blocking the webhook call.",
        fix: "Exclude the Flas endpoint from caching and allow outbound POST to flas.mobidigisol.com.",
      },
    ],
    reviewTimeline: "No review — the plugin works the moment the activation key is accepted.",
  },
  shopify: {
    checklist: [
      "Snippet added to the theme and saved.",
      "Activation key pasted in Flas.",
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
      "Flas WordPress plugin installed (it detects WooCommerce automatically).",
      "Read-only WooCommerce REST keys pasted into Flas.",
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
    checklist: [
      "It is a GA4 property (not Universal Analytics).",
      "You have at least Viewer access.",
    ],
    errors: [
      {
        error: "User does not have sufficient permissions for this property",
        means: "The signed-in Google account lacks access to the GA4 property.",
        fix: "Grant Viewer access in GA4 admin, then reconnect.",
      },
    ],
  },
  search_console: {
    checklist: [
      "The domain property is verified in Search Console.",
      "You are Owner or Full user.",
    ],
    errors: [
      {
        error: "User does not have sufficient permission for site",
        means: "The property is verified under a different Google account.",
        fix: "Add your account as Full user in Search Console settings, then reconnect.",
      },
    ],
    reviewTimeline: "Search data always lags 2–3 days — that is Google's delay, not Flas's.",
  },
};

export function troubleshooting(id: string): Troubleshooting | undefined {
  return TROUBLESHOOTING[id as ConnectorId];
}
