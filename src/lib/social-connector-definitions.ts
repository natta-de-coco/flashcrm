/**
 * The social connector capability registry — the single source of truth for
 * what each integration can do.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * STATIC DEFINITION vs OBSERVED ACCOUNT CAPABILITY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * These are two different things and must never be conflated:
 *
 *   Connector definition (this file)
 *     What the *provider* offers and what *Flas* has actually built. It is the
 *     same for every workspace, changes only when we ship code or a provider
 *     changes its API, and is therefore checked into source control where it
 *     can be reviewed and tested.
 *
 *   Connected-account capability (the `social_capabilities` table)
 *     What one specific authorized account can do *right now*, given its
 *     account type, the scopes that were actually granted, the provider's
 *     review decision and the state of its token. It is per tenant, per
 *     account, and changes without a deploy.
 *
 * The relationship is one-directional: an observed capability can only ever be
 * a subset of the static definition. An account cannot be granted a capability
 * Flas has not implemented, and `capabilityCeiling()` below exists so that rule
 * can be asserted in tests rather than assumed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY STATUS IS DERIVED, NOT DECLARED
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Each capability records facts — does the provider support it, has Flas built
 * it, which scopes does it need, does it need provider review — and the status
 * is computed from them. Hand-written statuses drift from the code they claim
 * to describe; that drift is exactly what produced "Messaging" badges on
 * connectors with no messaging API.
 *
 * Deriving it also surfaces a class of bug that is otherwise invisible: a
 * capability Flas has implemented whose scope is never requested. Facebook
 * comment replies are in that state today (see the connector below).
 *
 * Verified against official provider documentation on the dates recorded in
 * each definition's `lastVerified`. Re-verify before trusting anything here
 * for a launch decision — provider capabilities and scope names change.
 */

/**
 * Every capability is modelled separately.
 *
 * There is deliberately no broad "messaging" key. Comments, reviews and direct
 * messages are different products with different APIs, different scopes and
 * different review requirements, and collapsing them is what let Google
 * Business Profile advertise messaging it does not have.
 */
export const CAPABILITY_KEYS = [
  "profile",
  "publish",
  "comments_read",
  "comments_reply",
  "direct_messages_read",
  "direct_messages_send",
  "reviews_read",
  "reviews_reply",
  "analytics",
  "ads_read",
  "ads_manage",
  "webhooks",
] as const;

export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

/** Human labels, used wherever a capability is shown. */
export const CAPABILITY_LABELS: Record<CapabilityKey, string> = {
  profile: "Profile",
  publish: "Publishing",
  comments_read: "Read comments",
  comments_reply: "Reply to comments",
  direct_messages_read: "Read DMs",
  direct_messages_send: "Send DMs",
  reviews_read: "Read reviews",
  reviews_reply: "Reply to reviews",
  analytics: "Analytics",
  ads_read: "Read ads",
  ads_manage: "Manage ads",
  webhooks: "Webhooks",
};

export type CapabilityStatus =
  /** Provider offers it, Flas has built it, and the scope is requested. */
  | "implemented"
  /** Flas has built it, but the OAuth scope it needs is not requested — it will fail. */
  | "scope_not_requested"
  /** Provider offers it; Flas has not built it. */
  | "not_implemented"
  /** Built and scoped, but the provider must approve the app before it works. */
  | "requires_provider_review"
  /** Only available on some account types (for example a Professional account). */
  | "limited_by_account_type"
  /** The provider has no such API, or retired it. Never shown as available. */
  | "not_supported";

/** Statuses a customer can actually use today. Nothing else may render as available. */
export const USABLE_STATUSES: readonly CapabilityStatus[] = ["implemented"];

export const STATUS_LABELS: Record<CapabilityStatus, string> = {
  implemented: "Available",
  scope_not_requested: "Missing permission",
  not_implemented: "Not implemented yet",
  requires_provider_review: "Requires provider review",
  limited_by_account_type: "Limited by account type",
  not_supported: "Not supported by provider",
};

/** The declared facts about one capability on one connector. */
export type CapabilityFacts = {
  /** Does the provider expose an API for this at all? */
  providerSupports: boolean;
  /** Has Flas written the code that uses it? */
  flasImplements: boolean;
  /** Scopes the provider requires for it. Empty when the connector is not OAuth. */
  requiredScopes: readonly string[];
  /** Does the provider gate it behind an app review or partner programme? */
  reviewRequired: boolean;
  /** Only usable on certain account types. */
  accountTypeLimited?: boolean;
  /** Why, in provider-specific terms. Shown to the user; never generic. */
  note?: string;
};

export type ResolvedCapability = CapabilityFacts & {
  key: CapabilityKey;
  status: CapabilityStatus;
  /** Scopes this capability needs that the connector does not request. */
  missingScopes: string[];
};

export type ConnectorCategory = "social" | "messaging" | "ads" | "analytics" | "commerce";

export type AuthMethod =
  | "oauth2"
  | "oauth2_pkce"
  | "api_key"
  | "app_password"
  | "plugin"
  | "webhook_shared_secret";

export type ConnectorDefinition = {
  /** Stable id. Never change one — it is stored on rows and in URLs. */
  id: string;
  displayName: string;
  category: ConnectorCategory;
  /** Account types the connector works with, in the provider's own words. */
  accountTypes: readonly string[];
  authMethod: AuthMethod;
  /**
   * Scopes Flas actually asks for today, mirroring PROVIDERS in oauth.server.ts.
   * Capability `requiredScopes` are checked against this list, so a capability
   * whose scope is missing is reported rather than silently broken.
   */
  requestedScopes: readonly string[];
  /** Scopes that would unlock more, but are not requested. */
  optionalScopes: readonly string[];
  providerReviewRequired: boolean;
  sandboxAvailable: boolean;
  setupRequirements: readonly string[];
  /** Official provider documentation. At least one, always first-party. */
  docs: readonly string[];
  /** When these facts were last checked against the provider's own docs. */
  lastVerified: string;
  knownLimitations: readonly string[];
  capabilities: Readonly<Record<CapabilityKey, CapabilityFacts>>;
  /**
   * Scopes needed only to identify WHO authorized ("Signed in as"), never tied
   * to a channel capability. Requested with every authorization.
   */
  identityScopes?: readonly string[];
  /**
   * Progressive authorization (Batch 2A). The first connection asks only for
   * the `initial` tiers; everything else is an upgrade the user turns on later.
   * A tier's scopes are DERIVED from its capabilities' requiredScopes -- never
   * listed separately -- so the registry stays the only place scopes live.
   * Absent: the connector still requests all of requestedScopes at once.
   */
  authorizationTiers?: readonly AuthorizationTier[];
};

export type AuthorizationTier = {
  id: string;
  /** Short name on the Manage screen: "Read public comments". */
  label: string;
  /** Plain-language request shown before the provider's consent screen. */
  purpose: string;
  capabilities: readonly CapabilityKey[];
  /** Asked for on first connection. Everything else is an upgrade. */
  initial: boolean;
  /** Provider-specific reassurance: what Flas will not do with this. */
  wontDo?: readonly string[];
  /** Provider-specific warning when the provider bundles more power into the scope than Flas uses. */
  scopeCaveat?: string;
};

/** Shorthand for a capability the provider does not offer at all. */
const unsupported = (note: string): CapabilityFacts => ({
  providerSupports: false,
  flasImplements: false,
  requiredScopes: [],
  reviewRequired: false,
  note,
});

/** Shorthand for one the provider offers and Flas has not built. */
const notBuilt = (requiredScopes: readonly string[], note: string): CapabilityFacts => ({
  providerSupports: true,
  flasImplements: false,
  requiredScopes,
  reviewRequired: false,
  note,
});

/** Every key defaults to unsupported; a connector overrides what it really has. */
function caps(overrides: Partial<Record<CapabilityKey, CapabilityFacts>>): Record<CapabilityKey, CapabilityFacts> {
  const base = {} as Record<CapabilityKey, CapabilityFacts>;
  for (const key of CAPABILITY_KEYS) {
    base[key] = unsupported("This provider does not offer an API for this.");
  }
  return { ...base, ...overrides };
}

// ═════════════════════════════════════════════════════════════════════════════
// Connector definitions
// ═════════════════════════════════════════════════════════════════════════════

export const CONNECTOR_DEFINITIONS: readonly ConnectorDefinition[] = [
  // ── Meta ──────────────────────────────────────────────────────────────────
  {
    id: "facebook",
    displayName: "Facebook Pages",
    category: "social",
    accountTypes: ["Facebook Page (admin access via a Business account)"],
    authMethod: "oauth2",
    requestedScopes: [
      "pages_show_list",
      "pages_read_engagement",
      "pages_manage_posts",
      "pages_messaging",
      "read_insights",
      // Required to create a comment reply. pages_read_engagement is read-only,
      // so without this replyToComment() was rejected by Meta every time.
      "pages_manage_engagement",
    ],
    optionalScopes: ["pages_manage_metadata"],
    providerReviewRequired: true,
    sandboxAvailable: true,
    setupRequirements: [
      "Meta app with Facebook Login for Business",
      "Business verification for Advanced Access",
      "The connecting user must be an admin of the Page",
    ],
    docs: [
      "https://developers.facebook.com/docs/pages-api",
      "https://developers.facebook.com/docs/permissions/reference/pages_manage_engagement",
    ],
    lastVerified: "2026-09-08",
    knownLimitations: [
      "Advanced Access requires Meta app review before the connector works for anyone outside your own Business.",
      "Conversations older than the Page's retention window are not returned.",
    ],
    identityScopes: ["public_profile"],
    // Batch 2B. pages_manage_posts is never requested: publishing is not built.
    authorizationTiers: [
      {
        id: "basic",
        label: "Pages, posts, comments and statistics",
        purpose:
          "Flas would like permission to see the Facebook Pages you choose, their posts and comments, and the Page statistics Facebook shares.",
        capabilities: ["profile", "comments_read", "analytics"],
        initial: true,
        wontDo: [
          "post, edit or delete anything on your Pages",
          "see your Facebook password",
          "read your personal profile, friends or private messages",
        ],
      },
      {
        id: "messages",
        label: "Read Messenger conversations",
        purpose: "Flas would like permission to read Messenger conversations people start with your Page.",
        capabilities: ["direct_messages_read"],
        initial: false,
        wontDo: ["send messages as your Page"],
      },
      {
        id: "replies",
        label: "Reply to comments",
        purpose: "Flas would like permission to post replies to comments on your Page, when you send one from Flas.",
        capabilities: ["comments_reply"],
        initial: false,
        wontDo: ["publish new posts", "delete comments"],
      },
      {
        id: "publishing",
        label: "Publish posts",
        purpose: "Flas would like permission to publish posts to your Page.",
        capabilities: ["publish"],
        initial: false,
      },
    ],
    capabilities: caps({
      profile: {
        providerSupports: true,
        flasImplements: true,
        requiredScopes: ["pages_show_list"],
        reviewRequired: false,
      },
      publish: notBuilt(
        ["pages_manage_posts"],
        "The scope is requested, but Flas has no code that creates a Facebook post.",
      ),
      comments_read: {
        providerSupports: true,
        flasImplements: true,
        requiredScopes: ["pages_read_engagement"],
        reviewRequired: true,
      },
      comments_reply: {
        providerSupports: true,
        flasImplements: true,
        // Verified 2026-09-08: pages_read_engagement is read-only; creating a
        // comment needs pages_manage_engagement. Requested since 2026-09-10.
        // Accounts connected before then lack the grant and must reconnect.
        requiredScopes: ["pages_manage_engagement"],
        reviewRequired: true,
        note: "Needs Meta Advanced Access for pages_manage_engagement. Pages connected before 2026-09-10 must reconnect to grant it.",
      },
      direct_messages_read: {
        providerSupports: true,
        flasImplements: true,
        requiredScopes: ["pages_messaging"],
        reviewRequired: true,
        note: "Messenger conversations on the Page. Requires Advanced Access to pages_messaging.",
      },
      direct_messages_send: notBuilt(
        ["pages_messaging"],
        "Messenger send is not built. Meta's 24-hour messaging window would apply.",
      ),
      analytics: {
        providerSupports: true,
        flasImplements: true,
        requiredScopes: ["read_insights"],
        reviewRequired: true,
        note: "Follower counts and post engagement. Full Page Insights are not pulled.",
      },
      webhooks: notBuilt(["pages_manage_metadata"], "Page webhooks are not subscribed."),
    }),
  },

  {
    id: "instagram",
    displayName: "Instagram Professional",
    category: "social",
    accountTypes: [
      "Instagram Business account linked to a Facebook Page",
      "Instagram Creator account linked to a Facebook Page",
    ],
    authMethod: "oauth2",
    requestedScopes: [
      "instagram_basic",
      "instagram_manage_comments",
      "instagram_manage_insights",
      "instagram_content_publish",
      "pages_show_list",
    ],
    optionalScopes: ["instagram_manage_messages"],
    providerReviewRequired: true,
    sandboxAvailable: true,
    setupRequirements: [
      "Instagram account converted to Business or Creator",
      "Linked to a Facebook Page you administer",
      "Meta app review for Advanced Access",
    ],
    docs: [
      "https://developers.facebook.com/docs/instagram-platform",
      "https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login",
    ],
    lastVerified: "2026-09-08",
    knownLimitations: [
      "Personal Instagram accounts cannot be connected — the API is Professional-only.",
      "Instagram DMs are a separate permission (instagram_manage_messages) that Flas does not request.",
    ],
    identityScopes: ["public_profile"],
    // Batch 2B. instagram_content_publish is never requested: publishing is not built.
    authorizationTiers: [
      {
        id: "basic",
        label: "Profile, posts and statistics",
        purpose:
          "Flas would like permission to see the Instagram professional accounts linked to your Facebook Pages, their posts, and the account statistics Instagram shares.",
        capabilities: ["profile", "analytics"],
        initial: true,
        wontDo: [
          "post, edit or delete anything on your account",
          "see your Instagram or Facebook password",
          "read your direct messages",
        ],
      },
      {
        id: "comments",
        label: "Read and reply to comments",
        purpose:
          "Flas would like permission to read comments on your posts and post the replies you send from Flas.",
        capabilities: ["comments_read", "comments_reply"],
        initial: false,
        // instagram_manage_comments covers reading AND replying; Instagram
        // does not offer a read-only comment permission.
        scopeCaveat:
          "Instagram grants reading and replying to comments as one permission. Flas replies only when you send a reply yourself.",
        wontDo: ["delete comments", "publish new posts"],
      },
      {
        id: "publishing",
        label: "Publish posts",
        purpose: "Flas would like permission to publish posts to your Instagram account.",
        capabilities: ["publish"],
        initial: false,
      },
    ],
    capabilities: caps({
      profile: {
        providerSupports: true,
        flasImplements: true,
        // pages_show_list: an Instagram professional account is reached through
        // the Facebook Page it is linked to, so listing Pages is part of it.
        requiredScopes: ["instagram_basic", "pages_show_list"],
        reviewRequired: false,
        accountTypeLimited: true,
        note: "Business or Creator accounts only.",
      },
      publish: notBuilt(
        ["instagram_content_publish"],
        "The scope is requested, but Flas has no code that creates an Instagram post.",
      ),
      comments_read: {
        providerSupports: true,
        flasImplements: true,
        requiredScopes: ["instagram_manage_comments"],
        reviewRequired: true,
      },
      comments_reply: {
        providerSupports: true,
        flasImplements: true,
        requiredScopes: ["instagram_manage_comments"],
        reviewRequired: true,
      },
      direct_messages_read: notBuilt(
        ["instagram_manage_messages"],
        "Instagram DMs need instagram_manage_messages, which Flas does not request. Distinct from Facebook Messenger.",
      ),
      direct_messages_send: notBuilt(
        ["instagram_manage_messages"],
        "Not requested and not built. Distinct from Facebook Messenger.",
      ),
      analytics: {
        providerSupports: true,
        flasImplements: true,
        requiredScopes: ["instagram_manage_insights"],
        reviewRequired: true,
      },
    }),
  },

  {
    id: "threads",
    displayName: "Threads",
    category: "social",
    accountTypes: ["Threads profile linked to an Instagram Professional account"],
    authMethod: "oauth2",
    requestedScopes: ["threads_basic", "threads_content_publish", "threads_manage_insights"],
    optionalScopes: ["threads_manage_replies", "threads_read_replies"],
    providerReviewRequired: true,
    sandboxAvailable: false,
    setupRequirements: ["Threads profile", "Linked Instagram Professional account"],
    docs: ["https://developers.facebook.com/docs/threads"],
    lastVerified: "2026-09-08",
    knownLimitations: [
      "The Threads API has no direct-message endpoint of any kind.",
      "Flas performs no Threads sync — connecting stores the account and nothing else.",
    ],
    capabilities: caps({
      profile: notBuilt(["threads_basic"], "No Threads sync is implemented."),
      publish: notBuilt(["threads_content_publish"], "Scope requested; no publish code exists."),
      comments_read: notBuilt(
        ["threads_read_replies"],
        "Threads calls these replies. The scope is not requested and no sync exists.",
      ),
      comments_reply: notBuilt(
        ["threads_manage_replies"],
        "Threads calls these replies. The scope is not requested and no code exists.",
      ),
      direct_messages_read: unsupported("Threads has no direct-message API."),
      direct_messages_send: unsupported("Threads has no direct-message API."),
      analytics: notBuilt(["threads_manage_insights"], "Scope requested; no insights sync exists."),
    }),
  },

  // ── LinkedIn ──────────────────────────────────────────────────────────────
  {
    id: "linkedin",
    displayName: "LinkedIn Company Pages",
    category: "social",
    accountTypes: ["LinkedIn Company Page (organization admin)"],
    authMethod: "oauth2",
    requestedScopes: ["r_organization_social", "w_organization_social", "rw_organization_admin"],
    optionalScopes: [],
    providerReviewRequired: true,
    sandboxAvailable: false,
    setupRequirements: [
      "LinkedIn Developer app",
      "Community Management API product approval",
      "Organization admin role on the Page",
    ],
    docs: [
      "https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview",
    ],
    lastVerified: "2026-09-08",
    knownLimitations: [
      "LinkedIn member-to-member inbox messaging is not available through these organization scopes; it requires a separate partner-only messaging product.",
      "The Community Management API product must be approved before organization scopes are granted.",
    ],
    capabilities: caps({
      profile: {
        providerSupports: true,
        flasImplements: true,
        requiredScopes: ["r_organization_social"],
        reviewRequired: true,
      },
      publish: notBuilt(["w_organization_social"], "Scope requested; no publish code exists."),
      comments_read: notBuilt(
        ["r_organization_social"],
        "Comments on organization posts are readable, but Flas syncs only posts and follower statistics.",
      ),
      comments_reply: notBuilt(["w_organization_social"], "Not built."),
      direct_messages_read: unsupported(
        "LinkedIn inbox messaging is not exposed by the organization scopes Flas requests; it needs a separate partner-only product.",
      ),
      direct_messages_send: unsupported(
        "LinkedIn inbox messaging is not exposed by the organization scopes Flas requests; it needs a separate partner-only product.",
      ),
      analytics: {
        providerSupports: true,
        flasImplements: true,
        requiredScopes: ["r_organization_social"],
        reviewRequired: true,
        note: "Follower statistics only.",
      },
    }),
  },

  // ── TikTok ────────────────────────────────────────────────────────────────
  {
    id: "tiktok",
    displayName: "TikTok",
    category: "social",
    accountTypes: ["TikTok account with Login Kit authorization"],
    authMethod: "oauth2_pkce",
    requestedScopes: ["user.info.basic", "user.info.profile", "user.info.stats", "video.list"],
    optionalScopes: ["video.publish", "video.upload", "comment.list", "comment.create"],
    providerReviewRequired: true,
    sandboxAvailable: true,
    setupRequirements: ["TikTok for Developers app", "Login Kit and Display API products approved"],
    docs: [
      "https://developers.tiktok.com/doc/login-kit-web",
      "https://developers.tiktok.com/doc/display-api-overview",
    ],
    lastVerified: "2026-09-08",
    knownLimitations: [
      "TikTok exposes no direct-message API to third-party applications.",
      "Publishing needs video.publish, which Flas does not request.",
    ],
    capabilities: caps({
      profile: {
        providerSupports: true,
        flasImplements: true,
        requiredScopes: ["user.info.basic"],
        reviewRequired: false,
      },
      publish: notBuilt(
        ["video.publish"],
        "TikTok supports publishing, but Flas requests neither video.publish nor video.upload and has no publish code.",
      ),
      comments_read: notBuilt(
        ["comment.list"],
        "TikTok exposes comments under comment.list, which Flas does not request.",
      ),
      comments_reply: notBuilt(["comment.create"], "Not requested and not built."),
      direct_messages_read: unsupported("TikTok has no direct-message API for third parties."),
      direct_messages_send: unsupported("TikTok has no direct-message API for third parties."),
      analytics: {
        providerSupports: true,
        flasImplements: true,
        requiredScopes: ["user.info.stats", "video.list"],
        reviewRequired: false,
        note: "Follower, like and video counts. Not TikTok's full analytics suite.",
      },
    }),
  },

  // ── YouTube ───────────────────────────────────────────────────────────────
  {
    id: "youtube",
    displayName: "YouTube",
    category: "social",
    accountTypes: ["YouTube channel (own or Brand Account)"],
    authMethod: "oauth2",
    requestedScopes: [
      "https://www.googleapis.com/auth/youtube.readonly",
      "https://www.googleapis.com/auth/youtube.force-ssl",
    ],
    optionalScopes: [
      "https://www.googleapis.com/auth/youtube.upload",
      "https://www.googleapis.com/auth/yt-analytics.readonly",
    ],
    providerReviewRequired: true,
    sandboxAvailable: false,
    setupRequirements: [
      "Google Cloud project with YouTube Data API v3 enabled",
      "OAuth consent screen verification for sensitive scopes",
    ],
    docs: [
      "https://developers.google.com/youtube/v3/docs",
      "https://developers.google.com/youtube/v3/guides/auth/installed-apps",
    ],
    lastVerified: "2026-09-08",
    identityScopes: ["openid", "https://www.googleapis.com/auth/userinfo.email"],
    authorizationTiers: [
      {
        id: "basic",
        label: "Channel, videos and statistics",
        purpose:
          "Flas would like permission to view your YouTube channel, its videos and the channel statistics YouTube shares, and to see which Google account you signed in with.",
        capabilities: ["profile", "analytics"],
        initial: true,
        wontDo: [
          "change or delete anything on your channel",
          "see your Google password",
          "access Gmail, Drive or other Google services",
        ],
      },
      {
        id: "comments",
        label: "Read public comments",
        purpose:
          "Flas would like permission to read the public comments on your videos so they appear in your Flas inbox.",
        capabilities: ["comments_read"],
        initial: false,
        // Verified 2026-09-11 against Google's scope list: youtube.force-ssl is
        // "See, edit, and permanently delete your YouTube videos, ratings,
        // comments and captions". It is the only scope that grants comment
        // access to an OAuth client, so the customer is told what it covers.
        scopeCaveat:
          "Google only grants comment access together with permission to edit and delete videos and comments. Flas uses it to read comments and does not edit or delete anything.",
        wontDo: ["delete or edit videos, comments or captions", "change your channel settings"],
      },
      {
        id: "replies",
        label: "Reply to comments",
        purpose: "Flas would like permission to post replies to comments on behalf of your channel.",
        capabilities: ["comments_reply"],
        initial: false,
      },
    ],
    knownLimitations: [
      "YouTube has no private direct-message API. Comments are public.",
      "Uploading needs youtube.upload, which Flas does not request.",
      "The Data API quota is shared per project and is easy to exhaust.",
    ],
    capabilities: caps({
      profile: {
        providerSupports: true,
        flasImplements: true,
        requiredScopes: ["https://www.googleapis.com/auth/youtube.readonly"],
        reviewRequired: true,
      },
      publish: notBuilt(
        ["https://www.googleapis.com/auth/youtube.upload"],
        "Video upload is supported by YouTube but Flas neither requests the scope nor implements it.",
      ),
      comments_read: {
        providerSupports: true,
        flasImplements: true,
        requiredScopes: ["https://www.googleapis.com/auth/youtube.force-ssl"],
        reviewRequired: true,
      },
      comments_reply: notBuilt(
        ["https://www.googleapis.com/auth/youtube.force-ssl"],
        "The scope allows it, but Flas has no YouTube comment-reply code — replyToComment is Meta-only.",
      ),
      direct_messages_read: unsupported("YouTube has no private direct-message API."),
      direct_messages_send: unsupported("YouTube has no private direct-message API."),
      analytics: {
        providerSupports: true,
        flasImplements: true,
        requiredScopes: ["https://www.googleapis.com/auth/youtube.readonly"],
        reviewRequired: true,
        note: "Public channel statistics. YouTube Analytics needs yt-analytics.readonly, which is not requested.",
      },
    }),
  },

  // ── X ─────────────────────────────────────────────────────────────────────
  {
    id: "twitter",
    displayName: "X (Twitter)",
    category: "social",
    accountTypes: ["X account on a plan whose API tier permits the endpoints used"],
    authMethod: "oauth2_pkce",
    requestedScopes: ["tweet.read", "tweet.write", "users.read", "offline.access"],
    optionalScopes: ["dm.read", "dm.write"],
    providerReviewRequired: false,
    sandboxAvailable: false,
    setupRequirements: ["X developer account", "Paid API tier for meaningful read volume"],
    docs: ["https://docs.x.com/x-api/introduction"],
    lastVerified: "2026-09-08",
    knownLimitations: [
      "Direct messages need dm.read and dm.write, which Flas does not request.",
      "Read volume on the free tier is too low for practical monitoring.",
    ],
    capabilities: caps({
      profile: {
        providerSupports: true,
        flasImplements: true,
        requiredScopes: ["users.read"],
        reviewRequired: false,
      },
      publish: notBuilt(
        ["tweet.write"],
        "The scope is requested, but Flas has no code that posts to X.",
      ),
      comments_read: notBuilt(
        ["tweet.read"],
        "Replies are readable, but Flas syncs only the account's own posts and their metrics.",
      ),
      comments_reply: notBuilt(["tweet.write"], "Not built."),
      direct_messages_read: notBuilt(
        ["dm.read"],
        "X supports DMs, but Flas requests neither dm.read nor dm.write and has no DM code.",
      ),
      direct_messages_send: notBuilt(["dm.write"], "Not requested and not built."),
      analytics: {
        providerSupports: true,
        flasImplements: true,
        requiredScopes: ["tweet.read"],
        reviewRequired: false,
        note: "Public post metrics only.",
      },
    }),
  },

  // ── Google Business Profile ───────────────────────────────────────────────
  {
    id: "google_business",
    displayName: "Google Business Profile",
    category: "social",
    accountTypes: ["Verified Business Profile location (owner or manager)"],
    authMethod: "oauth2",
    requestedScopes: ["https://www.googleapis.com/auth/business.manage"],
    optionalScopes: [],
    providerReviewRequired: true,
    sandboxAvailable: false,
    setupRequirements: [
      "Verified Business Profile",
      "Business Profile APIs enabled and quota approved by Google",
    ],
    docs: [
      "https://developers.google.com/my-business/reference/rest",
      "https://support.google.com/business/answer/14919056",
    ],
    lastVerified: "2026-09-08",
    knownLimitations: [
      "Google retired Business Profile chat and call history on 31 July 2024. There is no messaging API to integrate with — for anyone.",
      "Business Profile API quota must be requested from Google and is not granted automatically.",
    ],
    capabilities: caps({
      profile: {
        providerSupports: true,
        flasImplements: true,
        requiredScopes: ["https://www.googleapis.com/auth/business.manage"],
        reviewRequired: true,
      },
      publish: notBuilt(
        ["https://www.googleapis.com/auth/business.manage"],
        "Local posts are supported by Google but Flas has no code that creates one.",
      ),
      reviews_read: {
        providerSupports: true,
        flasImplements: true,
        requiredScopes: ["https://www.googleapis.com/auth/business.manage"],
        reviewRequired: true,
        note: "Reviews are pulled and shown in the social inbox.",
      },
      reviews_reply: notBuilt(
        ["https://www.googleapis.com/auth/business.manage"],
        "Google supports review replies; Flas reads reviews but has no reply code for them.",
      ),
      // Verified 2026-09-08 against Google's own notice.
      direct_messages_read: unsupported(
        "Google discontinued Business Profile chat on 31 July 2024. No messaging API exists.",
      ),
      direct_messages_send: unsupported(
        "Google discontinued Business Profile chat on 31 July 2024. No messaging API exists.",
      ),
      analytics: notBuilt(
        ["https://www.googleapis.com/auth/business.manage"],
        "Performance metrics are available from Google but are not synced.",
      ),
    }),
  },

  // ── Pinterest ─────────────────────────────────────────────────────────────
  {
    id: "pinterest",
    displayName: "Pinterest",
    category: "social",
    accountTypes: ["Pinterest business account"],
    authMethod: "oauth2",
    requestedScopes: ["boards:read", "pins:read", "pins:write", "user_accounts:read"],
    optionalScopes: [],
    providerReviewRequired: true,
    sandboxAvailable: true,
    setupRequirements: ["Pinterest developer app", "Standard access approval for production"],
    docs: ["https://developers.pinterest.com/docs/api/v5/introduction/"],
    lastVerified: "2026-09-08",
    knownLimitations: [
      "No direct-message capability is available under the scopes Flas requests.",
      "Flas performs no Pinterest content sync — connecting validates the account only.",
    ],
    capabilities: caps({
      profile: {
        providerSupports: true,
        flasImplements: true,
        requiredScopes: ["user_accounts:read"],
        reviewRequired: false,
        note: "The account is validated on connect; no content is synced.",
      },
      publish: notBuilt(["pins:write"], "Scope requested; no pin-creation code exists."),
      comments_read: notBuilt(["pins:read"], "Not built."),
      analytics: notBuilt(["user_accounts:read"], "Not built."),
      direct_messages_read: unsupported(
        "No direct-message capability under the scopes Flas requests.",
      ),
      direct_messages_send: unsupported(
        "No direct-message capability under the scopes Flas requests.",
      ),
    }),
  },

  // ── WhatsApp ──────────────────────────────────────────────────────────────
  {
    id: "whatsapp",
    displayName: "WhatsApp Business",
    category: "messaging",
    accountTypes: ["WhatsApp Business Platform phone number on a verified WABA"],
    authMethod: "api_key",
    requestedScopes: [],
    optionalScopes: [],
    providerReviewRequired: true,
    sandboxAvailable: true,
    setupRequirements: [
      "Meta Business verification",
      "A phone number not currently registered on WhatsApp",
      "Approved display name",
      "Approved message templates for business-initiated messages",
    ],
    docs: [
      "https://developers.facebook.com/docs/whatsapp/cloud-api",
      "https://business.whatsapp.com/products/platform-pricing",
    ],
    lastVerified: "2026-09-08",
    knownLimitations: [
      "Business-initiated messages outside the 24-hour customer service window require an approved template and are billed by Meta.",
      "New numbers start on a limited messaging tier that rises with quality.",
    ],
    capabilities: caps({
      profile: {
        providerSupports: true,
        flasImplements: true,
        requiredScopes: [],
        reviewRequired: true,
      },
      direct_messages_read: {
        providerSupports: true,
        flasImplements: true,
        requiredScopes: [],
        reviewRequired: true,
        note: "Inbound messages arrive by webhook with a verified signature.",
      },
      direct_messages_send: {
        providerSupports: true,
        flasImplements: true,
        requiredScopes: [],
        reviewRequired: true,
        note: "Free-form inside the 24-hour window; an approved template is required outside it.",
      },
      analytics: {
        providerSupports: true,
        flasImplements: true,
        requiredScopes: [],
        reviewRequired: true,
        note: "Delivery and read status per message.",
      },
      webhooks: {
        providerSupports: true,
        flasImplements: true,
        requiredScopes: [],
        reviewRequired: true,
        note: "X-Hub-Signature-256 is verified and the endpoint fails closed without a secret.",
      },
    }),
  },

  // ── Ads ───────────────────────────────────────────────────────────────────
  {
    id: "meta_ads",
    displayName: "Meta Ads",
    category: "ads",
    accountTypes: ["Meta ad account within a Business"],
    authMethod: "oauth2",
    requestedScopes: ["ads_read", "ads_management", "business_management"],
    optionalScopes: [],
    providerReviewRequired: true,
    sandboxAvailable: true,
    setupRequirements: ["Meta Business account", "Advanced Access to ads permissions"],
    docs: ["https://developers.facebook.com/docs/marketing-apis"],
    lastVerified: "2026-09-08",
    knownLimitations: ["Flas lists ad accounts but does not read spend or performance."],
    capabilities: caps({
      profile: {
        providerSupports: true,
        flasImplements: true,
        requiredScopes: ["business_management"],
        reviewRequired: true,
        note: "Ad accounts are listed on connect.",
      },
      ads_read: notBuilt(["ads_read"], "Scope requested; no campaign or spend reporting is built."),
      ads_manage: notBuilt(
        ["ads_management"],
        "Scope requested; Flas never creates or edits campaigns.",
      ),
    }),
  },
  {
    id: "google_ads",
    displayName: "Google Ads",
    category: "ads",
    accountTypes: ["Google Ads account"],
    authMethod: "oauth2",
    requestedScopes: ["https://www.googleapis.com/auth/adwords"],
    optionalScopes: [],
    providerReviewRequired: true,
    sandboxAvailable: true,
    setupRequirements: ["Google Ads developer token", "OAuth consent screen verification"],
    docs: ["https://developers.google.com/google-ads/api/docs/start"],
    lastVerified: "2026-09-08",
    knownLimitations: [
      "A developer token must be approved by Google before production use.",
      "No Google Ads reporting is implemented.",
    ],
    capabilities: caps({
      profile: notBuilt(["https://www.googleapis.com/auth/adwords"], "Not built."),
      ads_read: notBuilt(["https://www.googleapis.com/auth/adwords"], "Not built."),
      ads_manage: notBuilt(["https://www.googleapis.com/auth/adwords"], "Not built."),
    }),
  },
  {
    id: "linkedin_ads",
    displayName: "LinkedIn Ads",
    category: "ads",
    accountTypes: ["LinkedIn advertising account"],
    authMethod: "oauth2",
    requestedScopes: ["r_ads", "r_ads_reporting"],
    optionalScopes: ["rw_ads"],
    providerReviewRequired: true,
    sandboxAvailable: false,
    setupRequirements: ["LinkedIn Marketing API product approval"],
    docs: [
      "https://learn.microsoft.com/en-us/linkedin/marketing/integrations/marketing-integrations-overview",
    ],
    lastVerified: "2026-09-08",
    knownLimitations: [
      "Only read scopes are requested; campaign management would need rw_ads.",
      "No LinkedIn Ads reporting is implemented.",
    ],
    capabilities: caps({
      profile: notBuilt(["r_ads"], "Not built."),
      ads_read: notBuilt(["r_ads_reporting"], "Scope requested; no reporting is built."),
      ads_manage: unsupported("rw_ads is not requested, so campaign management is unavailable."),
    }),
  },
  {
    id: "tiktok_ads",
    displayName: "TikTok Ads",
    category: "ads",
    accountTypes: ["TikTok for Business advertiser account"],
    // TikTok for Business / Marketing API: a separate product from the consumer
    // Login Kit, with its own advertiser authorization. It must not reuse the
    // TikTok Login Kit flow, and requests nothing until an adapter exists.
    authMethod: "oauth2",
    requestedScopes: [],
    optionalScopes: ["advertiser.read", "advertiser.write"],
    providerReviewRequired: true,
    sandboxAvailable: true,
    setupRequirements: ["TikTok for Business account", "Marketing API access approval"],
    docs: ["https://business-api.tiktok.com/portal/docs"],
    lastVerified: "2026-09-08",
    knownLimitations: [
      "Not implemented. Connect is disabled until a TikTok for Business Marketing API adapter exists.",
    ],
    capabilities: caps({
      profile: notBuilt(["advertiser.read"], "Advertiser identity needs the Marketing API; not built."),
      ads_read: notBuilt(
        ["advertiser.read"],
        "No advertising scope is requested, so no ads data is reachable.",
      ),
      ads_manage: notBuilt(["advertiser.write"], "Not requested and not built."),
    }),
  },

  // ── Analytics ─────────────────────────────────────────────────────────────
  {
    id: "google_analytics",
    displayName: "Google Analytics 4",
    category: "analytics",
    accountTypes: ["GA4 property"],
    authMethod: "oauth2",
    requestedScopes: ["https://www.googleapis.com/auth/analytics.readonly"],
    optionalScopes: [],
    providerReviewRequired: true,
    sandboxAvailable: false,
    setupRequirements: ["GA4 property with at least Viewer access", "Data API enabled"],
    docs: ["https://developers.google.com/analytics/devguides/reporting/data/v1"],
    lastVerified: "2026-09-08",
    knownLimitations: ["No GA4 reporting is implemented; the connection is stored only."],
    capabilities: caps({
      profile: notBuilt(
        ["https://www.googleapis.com/auth/analytics.readonly"],
        "Property listing is not implemented.",
      ),
      analytics: notBuilt(
        ["https://www.googleapis.com/auth/analytics.readonly"],
        "Scope requested; no reporting is built.",
      ),
    }),
  },
  {
    id: "search_console",
    displayName: "Google Search Console",
    category: "analytics",
    accountTypes: ["Verified Search Console property"],
    authMethod: "oauth2",
    requestedScopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
    optionalScopes: [],
    providerReviewRequired: true,
    sandboxAvailable: false,
    setupRequirements: ["Verified site ownership"],
    docs: ["https://developers.google.com/webmaster-tools/v1/api_reference_index"],
    lastVerified: "2026-09-08",
    knownLimitations: ["Sites are listed on connect; no query or impression data is pulled."],
    capabilities: caps({
      profile: {
        providerSupports: true,
        flasImplements: true,
        requiredScopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
        reviewRequired: true,
        note: "Verified sites are listed on connect.",
      },
      analytics: notBuilt(
        ["https://www.googleapis.com/auth/webmasters.readonly"],
        "Search performance data is not pulled.",
      ),
    }),
  },

  // ── Website and store connectors (not OAuth platforms) ────────────────────
  {
    id: "wordpress",
    displayName: "WordPress",
    category: "commerce",
    accountTypes: ["Self-hosted WordPress site with the REST API reachable"],
    authMethod: "app_password",
    requestedScopes: [],
    optionalScopes: [],
    providerReviewRequired: false,
    sandboxAvailable: true,
    setupRequirements: ["WordPress user with publishing rights", "An application password"],
    docs: ["https://developer.wordpress.org/rest-api/"],
    lastVerified: "2026-09-08",
    knownLimitations: ["Application passwords are disabled over plain HTTP."],
    capabilities: caps({
      profile: {
        providerSupports: true,
        flasImplements: true,
        requiredScopes: [],
        reviewRequired: false,
      },
      publish: {
        providerSupports: true,
        flasImplements: true,
        requiredScopes: [],
        reviewRequired: false,
        note: "The only publishing path Flas actually implements today.",
      },
    }),
  },
  {
    id: "shopify",
    displayName: "Shopify",
    category: "commerce",
    accountTypes: ["Shopify store"],
    authMethod: "plugin",
    requestedScopes: [],
    optionalScopes: [],
    providerReviewRequired: false,
    sandboxAvailable: true,
    setupRequirements: ["Theme snippet or the downloadable package installed"],
    docs: ["https://shopify.dev/docs/api"],
    lastVerified: "2026-09-08",
    knownLimitations: [
      "Installed as a theme snippet for lead capture; no Admin API integration, so no catalogue or order sync.",
    ],
    capabilities: caps({
      profile: {
        providerSupports: true,
        flasImplements: true,
        requiredScopes: [],
        reviewRequired: false,
        note: "The store is identified by its site key.",
      },
    }),
  },
  {
    id: "woocommerce",
    displayName: "WooCommerce",
    category: "commerce",
    accountTypes: ["WooCommerce store on WordPress"],
    authMethod: "plugin",
    requestedScopes: [],
    optionalScopes: [],
    providerReviewRequired: false,
    sandboxAvailable: true,
    setupRequirements: ["The Flas WordPress plugin installed and activated"],
    docs: ["https://woocommerce.github.io/woocommerce-rest-api-docs/"],
    lastVerified: "2026-09-08",
    knownLimitations: ["Lead capture only; no product or order synchronisation is implemented."],
    capabilities: caps({
      profile: {
        providerSupports: true,
        flasImplements: true,
        requiredScopes: [],
        reviewRequired: false,
        note: "The store is identified by its site key.",
      },
    }),
  },
] as const;

// ═════════════════════════════════════════════════════════════════════════════
// Derived helpers — every consumer reads through these
// ═════════════════════════════════════════════════════════════════════════════

export function connectorDefinition(id: string): ConnectorDefinition | undefined {
  return CONNECTOR_DEFINITIONS.find((c) => c.id === id);
}

/**
 * Turns declared facts into a status.
 *
 * Order matters. "The provider does not offer it" outranks everything, then
 * "we have not built it", then "we built it but never ask for the permission" —
 * that last one is a real and otherwise silent failure mode, and putting it
 * ahead of the review check means it cannot hide behind "pending review".
 */
export function resolveCapability(
  connector: ConnectorDefinition,
  key: CapabilityKey,
): ResolvedCapability {
  const facts = connector.capabilities[key];
  const requested = new Set<string>(connector.requestedScopes);
  const missingScopes = facts.requiredScopes.filter((s) => !requested.has(s));

  let status: CapabilityStatus;
  if (!facts.providerSupports) status = "not_supported";
  else if (!facts.flasImplements) status = "not_implemented";
  else if (missingScopes.length > 0) status = "scope_not_requested";
  else if (facts.accountTypeLimited) status = "limited_by_account_type";
  else if (facts.reviewRequired) status = "requires_provider_review";
  else status = "implemented";

  return { ...facts, key, status, missingScopes };
}

export function resolveAllCapabilities(connector: ConnectorDefinition): ResolvedCapability[] {
  return CAPABILITY_KEYS.map((k) => resolveCapability(connector, k));
}

/**
 * Connectors that use the Batch 2A authorization/channel model: one stored
 * authorization, channels discovered from it and chosen by the user. Others
 * still use the one-account-per-platform flow until their batch migrates them.
 */
export const CHANNEL_MODEL_CONNECTORS: readonly string[] = ["youtube", "facebook", "instagram"];

/**
 * Connectors whose single sign-in also discovers channels of a sibling
 * platform. One Meta login finds both Facebook Pages and the Instagram
 * professional accounts linked to them, so neither needs a second login.
 */
export const DISCOVERY_FAMILY: Readonly<Record<string, readonly string[]>> = {
  facebook: ["facebook", "instagram"],
  instagram: ["facebook", "instagram"],
  youtube: ["youtube"],
};

export function usesChannelModel(connectorId: string): boolean {
  return CHANNEL_MODEL_CONNECTORS.includes(connectorId);
}

/** A tier can be offered only if every capability in it works in Flas today. */
export function tierAvailability(
  connector: ConnectorDefinition,
  tier: AuthorizationTier,
): { offerable: boolean; reason: string | null } {
  for (const key of tier.capabilities) {
    const facts = connector.capabilities[key];
    if (!facts.providerSupports) return { offerable: false, reason: facts.note ?? "Not offered by this provider." };
    if (!facts.flasImplements) return { offerable: false, reason: "Not available in Flas yet." };
  }
  return { offerable: true, reason: null };
}

/** The scopes one tier needs, derived from its capabilities. */
export function tierScopes(connector: ConnectorDefinition, tier: AuthorizationTier): string[] {
  const out = new Set<string>();
  for (const key of tier.capabilities) {
    for (const scope of connector.capabilities[key].requiredScopes) out.add(scope);
  }
  return [...out];
}

/**
 * The exact scope list for an authorization asking for these tiers. Identity
 * scopes are always included; unofferable tiers are refused, not quietly
 * dropped, so a caller cannot request a permission for code that does not exist.
 */
export function scopesForTiers(connector: ConnectorDefinition, tierIds: readonly string[]): string[] {
  const tiers = connector.authorizationTiers ?? [];
  const out = new Set<string>(connector.identityScopes ?? []);
  for (const id of tierIds) {
    const tier = tiers.find((t) => t.id === id);
    if (!tier) throw new Error(`Unknown authorization tier "${id}" for ${connector.id}.`);
    if (!tierAvailability(connector, tier).offerable) {
      throw new Error(`Tier "${id}" for ${connector.id} cannot be requested: it is not available.`);
    }
    for (const scope of tierScopes(connector, tier)) out.add(scope);
  }
  return [...out];
}

/** Tier ids a first connection asks for. */
export function initialTierIds(connector: ConnectorDefinition): string[] {
  return (connector.authorizationTiers ?? [])
    .filter((t) => t.initial && tierAvailability(connector, t).offerable)
    .map((t) => t.id);
}

/**
 * Capabilities safe to advertise on a connector card.
 *
 * Anything a customer cannot use today is excluded — the point of the registry
 * is that a badge cannot appear for something that does not work.
 */
export function advertisableCapabilities(connector: ConnectorDefinition): ResolvedCapability[] {
  return resolveAllCapabilities(connector).filter((c) =>
    USABLE_STATUSES.includes(c.status),
  );
}

/**
 * The ceiling an observed account capability may not exceed.
 *
 * `social_capabilities` rows are written from what a provider actually granted
 * a specific account. They can be narrower than this — a user may decline a
 * permission — but never wider: Flas cannot use an API it has not written.
 */
export function capabilityCeiling(connectorId: string): Set<CapabilityKey> {
  const def = connectorDefinition(connectorId);
  if (!def) return new Set();
  return new Set(
    CAPABILITY_KEYS.filter((k) => def.capabilities[k].providerSupports && def.capabilities[k].flasImplements),
  );
}

/** Connectors that authenticate through OAuth — the ones a health report can check. */
export const OAUTH_CONNECTORS = CONNECTOR_DEFINITIONS.filter(
  (c) => c.authMethod === "oauth2" || c.authMethod === "oauth2_pkce",
);

/** Connectors set up with keys, an app password or a plugin instead of a login. */
export const NON_OAUTH_CONNECTORS = CONNECTOR_DEFINITIONS.filter(
  (c) => !(c.authMethod === "oauth2" || c.authMethod === "oauth2_pkce"),
);

/** Counts shown in the UI, derived rather than typed by hand. */
export const CONNECTOR_COUNTS = {
  total: CONNECTOR_DEFINITIONS.length,
  oauthPlatforms: OAUTH_CONNECTORS.length,
  keyedOrPlugin: NON_OAUTH_CONNECTORS.length,
} as const;
