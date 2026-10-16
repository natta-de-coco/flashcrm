import {
  CAPABILITY_LABELS,
  connectorDefinition,
  resolveAllCapabilities,
} from "@/lib/social-connector-definitions";

/**
 * The connection and authorization-attempt state model.
 *
 * Two lifecycles, deliberately kept apart:
 *
 *   ConnectionState — the durable status of an integration. Survives restarts,
 *                     re-authorizations and provider outages.
 *   AttemptState    — one authorization, alive for about fifteen minutes.
 *
 * Holding both on one field would mean a failed re-authorization overwrites a
 * working integration: a customer with a healthy Instagram connection loses it
 * because their second attempt went wrong. "Instagram is connected" and "your
 * last reconnect attempt was cancelled" are both true at once, and the model
 * has to be able to say so.
 *
 * This module is browser-safe on purpose — the UI needs the labels and the next
 * actions, and the transition table is the same one the database enforces, so
 * there is exactly one description of what is legal.
 */

/**
 * Scopes a connector needs for the capabilities Flas actually implements.
 *
 * Only implemented capabilities count. Asking a customer to re-authorize for a
 * permission that unlocks nothing Flas has built would be a false alarm, and
 * the old REQUIRED_PERMISSIONS table did exactly that -- it listed
 * instagram_manage_messages and video.publish, neither of which Flas requests
 * or uses.
 */
export function requiredScopesFor(platform: string): string[] {
  const def = connectorDefinition(platform);
  if (!def) return [];
  const needed = new Set<string>();
  for (const cap of resolveAllCapabilities(def)) {
    if (!cap.providerSupports || !cap.flasImplements) continue;
    for (const scope of cap.requiredScopes) {
      if (def.requestedScopes.includes(scope)) needed.add(scope);
    }
  }
  return [...needed];
}

/** requiredScopesFor() minus what the provider granted. */
export function missingScopesFor(platform: string, grantedScopes: string[]): string[] {
  const granted = new Set(grantedScopes);
  // Some providers return no scope list at all on the token response. Treat
  // that as "unknown", not "nothing granted" -- otherwise every such connector
  // permanently reports missing permissions. (Whether a connector may be called
  // verified while its scopes are unknown is decided by the caller: see
  // scopesUnknown().)
  if (granted.size === 0) return [];
  return requiredScopesFor(platform).filter((s) => !granted.has(s));
}

/**
 * True when the connector needs permissions but nobody has told us which were
 * granted. A token that works is not a token with the right permissions, so
 * this blocks "verified" rather than passing it.
 */
export function scopesUnknown(
  platform: string,
  grantedScopes: string[] | null | undefined,
): boolean {
  return requiredScopesFor(platform).length > 0 && !(grantedScopes && grantedScopes.length > 0);
}

/**
 * Features Flas has built whose use depends on the platform approving the app
 * (app review, advanced access). A live token check cannot prove these, so a
 * verified connection says so instead of implying they work.
 */
export function notProvenFor(platform: string): string[] {
  const def = connectorDefinition(platform);
  if (!def) return [];
  return resolveAllCapabilities(def)
    .filter((cap) => cap.providerSupports && cap.flasImplements && cap.reviewRequired)
    .map((cap) => CAPABILITY_LABELS[cap.key]);
}

/**
 * The platforms whose token Flas can really test today. The engine in
 * integration-health.server.ts has one probe for each id here and none for any other (a test
 * keeps the two lists equal). A connector that is not listed has no live check yet: its accounts
 * cannot be verified, and the screens say "Coming soon" instead of offering a check that cannot
 * run.
 */
export const LIVE_CHECK_PLATFORMS: readonly string[] = [
  "facebook",
  "instagram",
  "meta_ads",
  "youtube",
  "google_business",
  "google_ads",
  "google_analytics",
  "search_console",
  "linkedin",
  "tiktok",
  "twitter",
  "pinterest",
];

export function hasLiveCheck(platform: string): boolean {
  return LIVE_CHECK_PLATFORMS.includes(platform);
}

/**
 * The plain names of the features that need these permissions ("Read DMs"), for people who
 * should never have to read a permission's technical name. The technical names are shown only in
 * the staff diagnostics.
 */
export function featuresForScopes(platform: string, scopes: readonly string[]): string[] {
  if (scopes.length === 0) return [];
  const def = connectorDefinition(platform);
  const wanted = new Set(scopes);
  const labels = new Set<string>();
  if (def) {
    for (const cap of resolveAllCapabilities(def)) {
      if (!cap.providerSupports || !cap.flasImplements) continue;
      if (cap.requiredScopes.some((scope) => wanted.has(scope))) {
        labels.add(CAPABILITY_LABELS[cap.key]);
      }
    }
  }
  return labels.size > 0 ? [...labels] : ["Some features"];
}

export const CONNECTION_STATES = [
  "not_configured",
  "missing_app_credentials",
  "ready_to_authorize",
  "authorization_started",
  "authorization_cancelled",
  "callback_error",
  "connected",
  "scope_incomplete",
  "token_expiring",
  "refresh_failed",
  "revoked",
  "disconnected",
  "provider_unavailable",
] as const;

export type ConnectionState = (typeof CONNECTION_STATES)[number];

export const ATTEMPT_STATES = [
  "started",
  "callback_received",
  "cancelled",
  "callback_error",
  "expired",
  "completed",
] as const;

export type AttemptState = (typeof ATTEMPT_STATES)[number];

/**
 * Legal transitions, mirroring is_legal_connection_transition() in
 * 20260910100000 (the batch-1 foundation). Both exist on purpose: this one
 * produces the message a person reads, and the database one holds when something
 * writes around the application. A test asserts the two sets are identical.
 *
 * That migration may not be applied yet. The database as it is today has the older
 * trigger from 20260908100000, which is LIVE_TRANSITIONS below. A health check
 * writes only edges that BOTH accept (resolveWriteSafeState); nothing that talks
 * to the database should assume the edges of this table are accepted.
 *
 * Re-asserting the same state is always allowed; that is how a refresh which
 * changes nothing else records a heartbeat.
 *
 * Returning to `connected` from `disconnected` or `revoked` requires a fresh
 * authorization: those states lead only to `authorization_started` (via
 * `ready_to_authorize` for a deliberate disconnect).
 */
const TRANSITIONS: Readonly<Record<ConnectionState, readonly ConnectionState[]>> = {
  // "Unknown", not a stage: the column default. The first real observation of a
  // connection must be able to replace it.
  not_configured: [
    "missing_app_credentials",
    "ready_to_authorize",
    "authorization_started",
    "connected",
    "scope_incomplete",
    "token_expiring",
    "disconnected",
  ],
  missing_app_credentials: ["ready_to_authorize", "not_configured", "disconnected"],
  ready_to_authorize: [
    "authorization_started",
    "missing_app_credentials",
    "connected",
    "scope_incomplete",
    "token_expiring",
    "disconnected",
  ],
  authorization_started: [
    "authorization_cancelled",
    "callback_error",
    "scope_incomplete",
    "connected",
    "token_expiring",
    "disconnected",
  ],
  authorization_cancelled: ["authorization_started", "ready_to_authorize", "disconnected"],
  callback_error: ["authorization_started", "ready_to_authorize", "disconnected"],
  // refresh_failed is reachable from connected in this (target) model. The older
  // trigger the database has today refuses it (see LIVE_TRANSITIONS).
  connected: [
    "scope_incomplete",
    "token_expiring",
    "refresh_failed",
    "revoked",
    "disconnected",
    "provider_unavailable",
  ],

  scope_incomplete: [
    "connected",
    "token_expiring",
    "refresh_failed",
    "revoked",
    "disconnected",
    "provider_unavailable",
    "authorization_started",
  ],
  token_expiring: [
    "connected",
    "scope_incomplete",

    "refresh_failed",
    "revoked",
    "disconnected",
    "provider_unavailable",
  ],

  refresh_failed: [
    "connected",
    "token_expiring",
    "revoked",
    "disconnected",
    "provider_unavailable",
    "authorization_started",
  ],

  // A provider outage must resolve back to whatever it interrupted, and must
  // never be a route to a state that discards a token — otherwise an hour of
  // Meta 5xx would sign every customer out.
  provider_unavailable: [
    "connected",
    "token_expiring",
    "scope_incomplete",
    "refresh_failed",
    "disconnected",
  ],
  revoked: ["authorization_started", "ready_to_authorize", "disconnected"],
  disconnected: ["ready_to_authorize"],
};

/** Every legal edge, flattened -- for the test that compares this with SQL. */
export function allTransitions(): ReadonlyArray<readonly [ConnectionState, ConnectionState]> {
  return (Object.keys(TRANSITIONS) as ConnectionState[]).flatMap((from) =>
    TRANSITIONS[from].map((to) => [from, to] as const),
  );
}

export function isLegalTransition(from: ConnectionState, to: ConnectionState): boolean {
  if (from === to) return true;
  return TRANSITIONS[from].includes(to);
}

/**
 * The edges the database accepts TODAY: is_legal_connection_transition() as 20260908100000 defines
 * it, which is the trigger that is applied. (The batch-1 replacement, TRANSITIONS above, is not.)
 * Differences that matter to a health check: no connected -> refresh_failed, nothing leaves
 * scope_incomplete or refresh_failed for provider_unavailable, nothing leaves provider_unavailable
 * for revoked, refresh_failed or scope_incomplete, and the three authorization states have no way out.
 * A test reads the SQL and keeps this equal to it.
 */
const LIVE_TRANSITIONS: Readonly<Record<ConnectionState, readonly ConnectionState[]>> = {
  not_configured: [
    "missing_app_credentials",
    "ready_to_authorize",
    "connected",
    "scope_incomplete",
    "token_expiring",
    "disconnected",
  ],
  missing_app_credentials: ["ready_to_authorize", "not_configured"],
  ready_to_authorize: ["connected", "scope_incomplete", "missing_app_credentials"],
  authorization_started: [],
  authorization_cancelled: [],
  callback_error: [],
  connected: [
    "scope_incomplete",
    "token_expiring",
    "revoked",
    "disconnected",
    "provider_unavailable",
  ],
  scope_incomplete: ["connected", "revoked", "disconnected", "token_expiring"],
  token_expiring: [
    "connected",
    "refresh_failed",
    "revoked",
    "disconnected",
    "provider_unavailable",
  ],
  refresh_failed: ["connected", "revoked", "disconnected", "token_expiring"],
  provider_unavailable: ["connected", "token_expiring", "disconnected"],
  revoked: ["ready_to_authorize", "connected", "disconnected"],
  disconnected: ["ready_to_authorize", "connected"],
};

/** Every edge the live database accepts, flattened -- for the test that compares this with SQL. */
export function liveTransitions(): ReadonlyArray<readonly [ConnectionState, ConnectionState]> {
  return (Object.keys(LIVE_TRANSITIONS) as ConnectionState[]).flatMap((from) =>
    LIVE_TRANSITIONS[from].map((to) => [from, to] as const),
  );
}

/**
 * True when the database accepts this move whether or not the batch-1 trigger has replaced the one
 * it has today: an edge in BOTH tables. A health check writes only these, so it works before and
 * after that migration. (The older trigger also accepts revoked -> connected and
 * disconnected -> connected, which batch 1 removes; neither is ever a health check's to take.)
 */
export function isWriteSafeTransition(from: ConnectionState, to: ConnectionState): boolean {
  if (from === to) return true;
  return LIVE_TRANSITIONS[from].includes(to) && TRANSITIONS[from].includes(to);
}

/**
 * The state a health check writes when the observation's own state may not be reachable.
 *
 * If the database accepts the observed state from here, that is it. If not, the account STAYS
 * where it is: never a stand-in state that says something untrue (a refused sign-in is not "token
 * expiring"). The saved evidence carries the rest -- a refusal withdraws the proof, so the account
 * can no longer read as verified. The one exception is a state that says the opposite of what the
 * platform just said, which is left by the one neutral step the database offers:
 *   provider_unavailable ("not answering") after the platform DID answer -> connected if the token
 *     worked, else token_expiring;
 *   refresh_failed ("sign-in failed") after the token worked -> connected.
 * (Whether the account then reads as fully connected is decided by its saved evidence, never by
 * this state.)
 */
export function resolveWriteSafeState(
  from: ConnectionState,
  proposed: ConnectionState,
  validated: boolean,
): ConnectionState {
  if (isWriteSafeTransition(from, proposed)) return proposed;
  if (from === "provider_unavailable") return validated ? "connected" : "token_expiring";
  if (from === "refresh_failed" && validated) return "connected";
  return from;
}

/**
 * The state a health check should write, given where the connection is now.
 *
 * A health check makes one observation. If that observation's natural state is
 * not reachable from the current one -- a 401 while the row is marked
 * provider_unavailable, say -- writing it is rejected by the database trigger,
 * and the whole update goes with it: the error, the retry count and the
 * backoff are all lost. This picks the closest legal state instead, and never
 * moves a connection to `connected` by any route but a legal one, so a health
 * check cannot silently reconnect something a customer disconnected.
 */
export function resolveHealthState(
  from: ConnectionState,
  proposed: ConnectionState,
): ConnectionState {
  if (isLegalTransition(from, proposed)) return proposed;
  if (proposed !== "connected") {
    for (const fallback of ["refresh_failed", "token_expiring"] as const) {
      if (isLegalTransition(from, fallback)) return fallback;
    }
  }
  return from;
}

/** What one health check concluded, as a fixed code. */
export type HealthCode =
  | "healthy"
  | "scope_incomplete"
  | "rate_limited"
  | "provider_unavailable"
  | "revoked"
  | "refresh_failed";

type Observed = {
  reason: string;
  httpStatus?: number | null | undefined;
  providerCode?: string | null | undefined;
  unreachable?: boolean | undefined;
};

/**
 * The provider told us what happened (a status, a code, or "no answer")? Then that is what
 * decides. The reason text is read only when it did not -- scraping a number out of a sentence
 * was the old way, and Meta's own sentences often carry no number at all.
 */
const wasTold = (o: Observed): boolean =>
  (o.httpStatus ?? null) !== null || (o.providerCode ?? null) !== null || o.unreachable === true;

function isRateLimited(o: Observed): boolean {
  if (!wasTold(o)) return /\b429\b|rate[ -]?limit|too many requests/i.test(o.reason);
  return o.httpStatus === 429 || ["4", "17", "32", "613"].includes(String(o.providerCode ?? ""));
}

function isUnavailable(o: Observed): boolean {
  if (!wasTold(o)) {
    return /\b5\d\d\b|timed? ?out|ETIMEDOUT|ECONNRESET|temporarily unavailable|unreachable/i.test(
      o.reason,
    );
  }
  const status = o.httpStatus ?? null;
  return o.unreachable === true || status === 408 || (status !== null && status >= 500);
}

function isUnauthorized(o: Observed): boolean {
  if (!wasTold(o)) return /revok|invalid[_ ]grant|reauthori|\b190\b|\b401\b/i.test(o.reason);
  return o.httpStatus === 401 || String(o.providerCode ?? "") === "190";
}

/**
 * Turns one health-check observation into the state to write.
 *
 * Pure, so every rule below is tested without a provider or a database:
 *   - validated, all scopes     -> connected
 *   - validated, scopes missing -> scope_incomplete, never fully healthy
 *   - 429 / rate limit          -> stays logically connected, retry later
 *   - 5xx / timeout             -> provider_unavailable; never revoked
 *   - 401 / invalid_grant / 190 -> revoked, switched off, no refresh loop
 *   - anything else             -> refresh_failed, token kept, retry later
 * and the result always goes through resolveHealthState(), so it is a state
 * the database will accept from where the connection is now.
 *
 * 403 is not treated as revoked: it usually means one permission is missing,
 * not that the whole grant is gone.
 */
export function classifyHealthObservation(o: {
  from: ConnectionState;
  validated: boolean;
  missingScopes: number;
  reason: string;
  /** What the provider answered. When given it decides; the reason text is only the fallback. */
  httpStatus?: number | null;
  /** The provider's own error code (Meta: 190 = token no longer valid, 4/17/32/613 = rate limit). */
  providerCode?: string | null;
  /** The request never got an answer (network error, timeout). */
  unreachable?: boolean;
  /**
   * Resolve the state against the edges the database accepts both today and after batch 1
   * (resolveWriteSafeState), instead of against the batch-1 table alone. A caller that is going to
   * WRITE the state must set this.
   */
  writeSafe?: boolean;
}): { code: HealthCode; state: ConnectionState; active: boolean } {
  let code: HealthCode;
  let proposed: ConnectionState;
  if (o.validated && o.missingScopes > 0) {
    code = "scope_incomplete";
    proposed = "scope_incomplete";
  } else if (o.validated) {
    code = "healthy";
    proposed = "connected";
  } else if (isRateLimited(o)) {
    code = "rate_limited";
    proposed = isUsable(o.from) ? o.from : "provider_unavailable";
  } else if (isUnavailable(o)) {
    code = "provider_unavailable";
    proposed = "provider_unavailable";
  } else if (isUnauthorized(o)) {
    code = "revoked";
    proposed = "revoked";
  } else {
    code = "refresh_failed";
    proposed = "refresh_failed";
  }
  const state = o.writeSafe
    ? resolveWriteSafeState(o.from, proposed, o.validated)
    : resolveHealthState(o.from, proposed);
  // An observation that could not legally become revoked (an outage in
  // progress) is reported as a refresh failure, and the connection stays on.
  if (code === "revoked" && state !== "revoked") code = "refresh_failed";
  const active = state !== "revoked" && state !== "disconnected";
  return { code, state, active };
}

/** Every state reachable from here, for tests and for the manager portal. */
export function allowedNextStates(from: ConnectionState): readonly ConnectionState[] {
  return TRANSITIONS[from];
}

/** True when the connection can currently do work. */
export function isUsable(state: ConnectionState): boolean {
  return state === "connected" || state === "scope_incomplete" || state === "token_expiring";
}

/**
 * What each state means and what to do about it.
 *
 * `actionOwner` matters more than it looks: a provider outage is not the
 * customer's problem to fix, and telling them to reconnect during one produces
 * support tickets and pointless re-authorizations.
 */
export type StatePresentation = {
  label: string;
  description: string;
  nextAction: string | null;
  actionOwner: "customer" | "flas" | "provider" | "none";
  tone: "ok" | "warn" | "bad" | "neutral";
};

export const CONNECTION_STATE_INFO: Readonly<Record<ConnectionState, StatePresentation>> = {
  not_configured: {
    label: "Not set up",
    description: "This platform has not been connected in this workspace.",
    nextAction: "Connect it in Connect accounts.",
    actionOwner: "customer",
    tone: "neutral",
  },
  missing_app_credentials: {
    label: "Needs app keys",
    description:
      "This connector needs your own platform app credentials before authorization can start.",
    nextAction: "Add the App ID and secret under Connect accounts.",
    actionOwner: "customer",
    tone: "warn",
  },
  ready_to_authorize: {
    label: "Ready to connect",
    description: "Credentials are in place. Nobody has authorized an account yet.",
    nextAction: "Press Connect and complete the provider's consent screen.",
    actionOwner: "customer",
    tone: "neutral",
  },
  authorization_started: {
    label: "Authorizing",
    description: "The provider's consent screen was opened and Flas is waiting for it to return.",
    nextAction: "Finish the consent screen. It expires after 15 minutes.",
    actionOwner: "customer",
    tone: "neutral",
  },
  authorization_cancelled: {
    label: "Authorization not completed",
    description:
      "The consent screen was closed, declined, or left until it expired. Nothing was saved.",
    nextAction: "Press Connect to try again.",
    actionOwner: "customer",
    tone: "neutral",
  },
  callback_error: {
    label: "Authorization failed",
    description:
      "The provider returned to Flas but the token exchange failed — usually a wrong app secret or an unregistered callback URL.",
    nextAction: "Check the app keys and callback URL, then press Connect again.",
    actionOwner: "customer",
    tone: "bad",
  },
  connected: {
    label: "Connected",
    description: "Authorized, in date, and every permission it needs was granted.",
    nextAction: null,
    actionOwner: "none",
    tone: "ok",
  },
  scope_incomplete: {
    label: "Missing permission",
    description:
      "The account is authorized, but a permission one of its features needs was not granted.",
    nextAction: "Reconnect and leave every permission enabled on the consent screen.",
    actionOwner: "customer",
    tone: "warn",
  },
  token_expiring: {
    label: "Token expiring",
    description: "The access token is close to expiry, or has just passed it.",
    nextAction: "Flas will refresh it automatically. Reconnect if that keeps failing.",
    actionOwner: "flas",
    tone: "warn",
  },
  refresh_failed: {
    label: "Refresh failed",
    description: "The token could not be renewed. A retry is scheduled.",
    nextAction: "If the next retry also fails, reconnect the account.",
    actionOwner: "flas",
    tone: "bad",
  },
  revoked: {
    label: "Access revoked",
    description:
      "The provider says the authorization is gone — usually a password change, a removed app, or an admin revoking access.",
    nextAction: "Reconnect the account.",
    actionOwner: "customer",
    tone: "bad",
  },
  disconnected: {
    label: "Disconnected",
    description: "Someone in this workspace disconnected it deliberately.",
    nextAction: "Connect it again whenever you need it.",
    actionOwner: "customer",
    tone: "neutral",
  },
  provider_unavailable: {
    label: "Provider unavailable",
    description:
      "The platform is returning errors or rate limiting us. The connection itself is fine.",
    // Deliberately no customer action. Reconnecting does not help a provider
    // outage, and suggesting it turns their downtime into our support load.
    nextAction: null,
    actionOwner: "provider",
    tone: "warn",
  },
};

export const ATTEMPT_STATE_INFO: Readonly<Record<AttemptState, { label: string; note: string }>> = {
  started: { label: "In progress", note: "The consent screen was opened." },
  callback_received: {
    label: "Finishing",
    note: "The provider replied; Flas is completing setup.",
  },
  cancelled: { label: "Cancelled", note: "The provider or the person declined the request." },
  callback_error: { label: "Failed", note: "The provider replied but the exchange failed." },
  expired: {
    label: "Abandoned",
    note: "The consent screen was never completed and the request timed out.",
  },
  completed: { label: "Completed", note: "The account was connected." },
};

/**
 * Derives an attempt's state without needing the sweep to have run.
 *
 * The sweep marks rows and keeps the table small, but correctness cannot
 * depend on it: `purge_expired_oauth_states()` existed for weeks and was never
 * called once, which is exactly how abandoned attempts stayed "started"
 * forever. Anything that reads an attempt reads it through here.
 */
export function effectiveAttemptState(row: {
  attempt_state: string;
  used_at: string | null;
  expires_at: string;
}): AttemptState {
  const stored = row.attempt_state as AttemptState;
  if (stored === "started" && !row.used_at && new Date(row.expires_at).getTime() < Date.now()) {
    return "expired";
  }
  return stored;
}
