/*
 * The Connection Center's shared vocabulary: what is wrong, who has to fix it,
 * and what they should do next.
 *
 * One set of types for the server readiness engine, the OAuth return flow and
 * every screen that shows a connection problem, so a failure reads the same
 * wherever it surfaces. Browser-safe: no server imports.
 *
 * Rules for anything built on these types:
 * - title, message, nextAction and userMessage are plain English a customer
 *   can act on. No environment variable names, scope ids or API jargon.
 * - technical.setting may name a server setting (e.g. OAUTH_ALLOWED_ORIGINS)
 *   and is only ever shown to administrators -- forAudience() strips it.
 * - No field may carry a secret, access or refresh token, encryption key, PKCE
 *   verifier or authorization code. App and client ids appear only masked.
 */

/** Who has to act for the problem to go away. */
export type ProblemOwner = "FLAS_ADMIN" | "WORKSPACE_ADMIN" | "END_USER" | "PROVIDER";

export type ProblemSeverity = "blocking" | "warning" | "info";

export type ConnectionProblem = {
  /** Stable machine code, e.g. "OAUTH_ORIGIN_MISSING". Tests and logs key on it. */
  code: string;
  /** Short plain-language headline. */
  title: string;
  /** One or two plain-language sentences: what happened. */
  message: string;
  owner: ProblemOwner;
  severity: ProblemSeverity;
  /** What the owner should do next, as an instruction. */
  nextAction: string;
  /** What someone who cannot fix it is told instead. forAudience() falls back to a default. */
  userMessage?: string | undefined;
  /** An official page that helps the owner fix it. */
  url?: string | undefined;
  /** Link text naming the page, e.g. "Open Meta App Dashboard". Never "Platform settings". */
  urlLabel?: string | undefined;
  /** True when trying again can succeed without anyone changing anything. */
  retryable?: boolean | undefined;
  /** A value the owner has to paste somewhere, e.g. the redirect URI. Never secret. */
  copyValue?: string | undefined;
  copyLabel?: string | undefined;
  /** Administrator-only detail: setting names, masked ids, HTTP status. Never secrets. */
  technical?: { setting?: string | undefined; detail?: string | undefined } | undefined;
};

export type Audience = "admin" | "user";

const ADMIN_OWNED: ReadonlySet<ProblemOwner> = new Set(["FLAS_ADMIN", "WORKSPACE_ADMIN"]);

/**
 * The problem as a given reader should see it.
 *
 * Administrators get everything. Anyone else never sees technical detail, and
 * when the fix belongs to an administrator they are told that plainly --
 * "temporarily unavailable, an administrator needs to finish setup" -- instead
 * of being handed a setting name and a console link they cannot use.
 */
export function forAudience(problem: ConnectionProblem, audience: Audience): ConnectionProblem {
  if (audience === "admin") return problem;
  const { technical: _technical, ...visible } = problem;
  if (!ADMIN_OWNED.has(problem.owner)) return visible;
  return {
    ...visible,
    title: "Administrator setup needed",
    message:
      problem.userMessage ??
      "This connection is temporarily unavailable because Flas needs administrator setup.",
    nextAction:
      problem.owner === "WORKSPACE_ADMIN"
        ? "Ask your workspace administrator to finish setting this up."
        : "Ask your Flas administrator to finish setting this up.",
    url: undefined,
    urlLabel: undefined,
    copyValue: undefined,
    copyLabel: undefined,
  };
}

/** "12••••89": enough to recognise an app id, never the whole value. */
export function maskId(id: string | null | undefined): string | null {
  if (!id) return null;
  const trimmed = id.trim();
  if (trimmed.length <= 6) return "••••";
  return `${trimmed.slice(0, 2)}••••${trimmed.slice(-2)}`;
}

/** Overall state of one provider, or of one connection attempt. */
export type ReadinessState =
  | "READY"
  | "NEEDS_CONFIGURATION"
  | "NEEDS_PROVIDER_CONFIGURATION"
  | "NEEDS_PROVIDER_REVIEW"
  | "NEEDS_RECONNECT"
  | "PARTIAL_PERMISSION"
  | "PROVIDER_ERROR"
  | "FLAS_CONFIGURATION_ERROR";

/** Short labels a customer can read, for badges. */
export const READINESS_LABELS: Readonly<Record<ReadinessState, string>> = {
  READY: "Ready",
  NEEDS_CONFIGURATION: "Setup needed",
  NEEDS_PROVIDER_CONFIGURATION: "Provider setup needed",
  NEEDS_PROVIDER_REVIEW: "Provider approval needed",
  NEEDS_RECONNECT: "Reconnect needed",
  PARTIAL_PERMISSION: "Limited permissions",
  PROVIDER_ERROR: "Provider problem",
  FLAS_CONFIGURATION_ERROR: "Flas setup problem",
};

/** The OAuth provider families, as oauth.server.ts keys them. */
export type OAuthProviderId = "meta" | "google" | "linkedin" | "tiktok" | "twitter" | "pinterest";

export const PROVIDER_NAMES: Readonly<Record<OAuthProviderId, string>> = {
  meta: "Meta",
  google: "Google",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  twitter: "X",
  pinterest: "Pinterest",
};

/**
 * Everything an administrator needs to know about one provider's setup.
 * Presence flags and masked values only -- never a secret or a token.
 */
export type ProviderReadiness = {
  provider: OAuthProviderId;
  name: string;
  state: ReadinessState;
  /** App id and secret are both available from some source. */
  configured: boolean;
  credentialSource: "workspace" | "shared" | "none";
  appIdPresent: boolean;
  appIdMasked: string | null;
  secretPresent: boolean;
  allowedOriginConfigured: boolean;
  publicAppUrlConfigured: boolean;
  /** The exact callback address to register with the provider. */
  redirectUri: string | null;
  encryptionConfigured: boolean;
  databaseReady: boolean;
  oauthStateReady: boolean;
  providerConfigPresent: boolean;
  reviewRequired: boolean;
  reviewStatus: "not_required" | "required" | "unknown";
  lastCredentialTest: string | null;
  lastCredentialTestStatus: "passed" | "failed" | "never";
  /** Connector ids this provider serves, e.g. ["facebook", "instagram", "meta_ads"]. */
  connectors: string[];
  blockingIssues: ConnectionProblem[];
  warnings: ConnectionProblem[];
  nextActions: string[];
};

/** What a non-administrator is told about one provider: can I connect, and if not, why. */
export type ProviderAvailability = {
  provider: OAuthProviderId;
  name: string;
  state: ReadinessState;
  available: boolean;
  /** Already passed through forAudience() for the caller. */
  problem: ConnectionProblem | null;
};

/** Where one Connect click has got to. The server is the source of truth. */
export type ConnectAttemptPhase =
  "pending" | "completed" | "needs_target" | "cancelled" | "failed" | "expired";

export type ConnectAttempt = {
  attemptId: string;
  platform: string;
  phase: ConnectAttemptPhase;
  /** The connection the attempt created or updated, once there is one. */
  accountId: string | null;
  problem: ConnectionProblem | null;
  updatedAt: string;
};

/** One thing a login can connect: a Page, channel, organization, location, property or ad account. */
export type ConnectableAsset = {
  id: string;
  name: string;
  /** Secondary line: handle, address, account name or external id. */
  secondary?: string | null | undefined;
  /** "Facebook Page", "Instagram professional account", "YouTube channel"... */
  kind?: string | null | undefined;
  avatarUrl?: string | null | undefined;
  eligible: boolean;
  /** Why an ineligible asset cannot be chosen, in plain language. */
  disabledReason?: string | null | undefined;
  alreadyConnected?: boolean | undefined;
};

/** How much a connector actually does in Flas today. */
export type AvailabilityTier =
  | "AVAILABLE_NOW"
  | "AVAILABLE_AFTER_PROVIDER_REVIEW"
  | "LIMITED"
  | "COMING_SOON"
  | "NOT_SUPPORTED_BY_PROVIDER";
