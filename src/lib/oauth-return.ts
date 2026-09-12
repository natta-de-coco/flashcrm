/*
 * Coming back from a provider's consent screen, without asking anyone to "come
 * back here" themselves.
 *
 * The old flow opened the provider in a new tab and told the user to return by
 * hand. Nothing watched the tab, so a cancelled login, an expired state and a
 * successful connection all looked identical from the Integrations page: the
 * user was simply left there.
 *
 * This module is the browser-safe half of the replacement. It holds no React,
 * no DOM handles and no clock of its own -- every transition is a pure function
 * of the previous state, an event, and the `at` timestamp the caller supplies.
 * That is what makes the rules below testable rather than merely intended.
 *
 * THE ONE SECURITY RULE THIS FILE ENCODES
 *
 * A completion ping (BroadcastChannel or storage event) is a hint, never proof.
 * A ping can only ever set `nextPollAt` -- it can never move the machine to a
 * finished phase. Anything that can be written by another tab, including one a
 * hostile page opened, must not be able to tell Flas that a connection
 * succeeded. The server attempt record is the only thing that finishes an
 * attempt, and it is read through a tenant- and user-scoped lookup.
 */
import type { ConnectAttempt, ConnectionProblem } from "@/lib/connection-problem";

/* ═══════════════════════════════════════════════════════════════════════════
 * Phases
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Where one Connect click has got to, from the browser's point of view.
 *
 * A superset of the server's ConnectAttemptPhase: the four extra values
 * describe the popup itself, which the server knows nothing about.
 */
export type ConnectPhase =
  | "idle"
  | "opening"
  | "waiting"
  | "popup_blocked"
  | "popup_closed"
  | "completed"
  | "needs_target"
  | "cancelled"
  | "failed"
  | "expired";

const TERMINAL_PHASES: ReadonlySet<ConnectPhase> = new Set([
  "completed",
  "needs_target",
  "cancelled",
  "failed",
  "expired",
]);

const WAITING_PHASES: ReadonlySet<ConnectPhase> = new Set([
  "opening",
  "waiting",
  "popup_blocked",
  "popup_closed",
]);

/** True once the attempt is over, whatever the outcome. */
export function isTerminalPhase(phase: ConnectPhase): boolean {
  return TERMINAL_PHASES.has(phase);
}

/** True while the waiting dialog should be on screen. */
export function isWaitingPhase(phase: ConnectPhase): boolean {
  return WAITING_PHASES.has(phase);
}

/** The server's phase, widened to the browser's. `pending` is still waiting. */
export function phaseFromAttempt(attempt: ConnectAttempt): ConnectPhase {
  return attempt.phase === "pending" ? "waiting" : attempt.phase;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Timing
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * How long the grace poll runs after the popup disappears.
 *
 * Closing the window and the callback finishing are a race the popup usually
 * wins: the completion page calls window.close() as its last act, so `closed`
 * flips before the last poll would have run. Declaring "you closed it" at that
 * moment would report a successful connection as an abandoned one.
 */
export const GRACE_POLL_MS = 2500;

/** Poll backoff, in ms, indexed by how many polls this wait has already made. */
const POLL_SCHEDULE = [2000, 2000, 2500, 3000, 4000, 6000, 8000, 10000] as const;

export function pollDelay(polls: number): number {
  if (polls < 0) return POLL_SCHEDULE[0];
  return POLL_SCHEDULE[Math.min(polls, POLL_SCHEDULE.length - 1)] ?? 10000;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * The machine
 * ═══════════════════════════════════════════════════════════════════════════ */

export type ConnectMachineState = {
  phase: ConnectPhase;
  platform: string | null;
  /** The oauth_states row id. Never a token, a code or a state value. */
  attemptId: string | null;
  attempt: ConnectAttempt | null;
  problem: ConnectionProblem | null;
  /** Polls issued during this wait, for the backoff. */
  polls: number;
  /** Epoch ms the next server lookup is due. null means "do not poll". */
  nextPollAt: number | null;
  popupClosedAt: number | null;
  /** While set, the popup is gone but the grace poll has not run out. */
  graceUntil: number | null;
  lastPingAt: number | null;
  /** True when this wait was rebuilt from storage after a reload. */
  resumed: boolean;
};

export type ConnectMachineEvent =
  /** The Connect button was pressed. */
  | { type: "START"; platform: string; at: number }
  /** A popup window handle was obtained synchronously inside the click. */
  | { type: "POPUP_OPENED"; at: number }
  /** window.open returned nothing: the browser refused. */
  | { type: "POPUP_BLOCKED"; at: number }
  /** startConnect said go, and (once READINESS lands) named the attempt. */
  | { type: "READY"; attemptId: string | null; at: number }
  /** startConnect refused, with the reason as a problem. */
  | { type: "NOT_READY"; problem: ConnectionProblem | null; at: number }
  /** An untrusted completion hint from another tab. */
  | { type: "PING"; attemptId: string | null; at: number }
  | { type: "POPUP_CLOSED"; at: number }
  /** The server answered. This is the only thing that can finish an attempt. */
  | { type: "LOOKUP"; attempt: ConnectAttempt; at: number }
  /** The lookup could not be made or was refused. Not an outcome. */
  | { type: "LOOKUP_FAILED"; at: number }
  | { type: "TICK"; at: number }
  | { type: "CANCEL"; at: number }
  | { type: "RESET"; at: number }
  /** A reload found an attempt id in sessionStorage. */
  | { type: "RESUME"; stored: StoredAttempt; at: number };

export function initialConnectState(): ConnectMachineState {
  return {
    phase: "idle",
    platform: null,
    attemptId: null,
    attempt: null,
    problem: null,
    polls: 0,
    nextPollAt: null,
    popupClosedAt: null,
    graceUntil: null,
    lastPingAt: null,
    resumed: false,
  };
}

/** Schedules the next poll, or stops polling when there is nothing to poll. */
function scheduleNextPoll(state: ConnectMachineState, at: number): ConnectMachineState {
  if (!state.attemptId) return { ...state, nextPollAt: null };
  return { ...state, polls: state.polls + 1, nextPollAt: at + pollDelay(state.polls) };
}

/**
 * The whole return flow, as one total function.
 *
 * Every branch returns a complete state, and an event that does not apply to
 * the current phase returns the state untouched rather than throwing -- a late
 * popup-closed tick arriving after a successful lookup is ordinary, not a bug.
 */
export function connectReducer(
  state: ConnectMachineState,
  event: ConnectMachineEvent,
): ConnectMachineState {
  switch (event.type) {
    case "START":
      return { ...initialConnectState(), phase: "opening", platform: event.platform };

    case "POPUP_OPENED":
      // Nothing to record: the handle lives in the hook, and the phase stays
      // "opening" until startConnect says whether there is anywhere to send it.
      return state;

    case "POPUP_BLOCKED":
      if (state.phase !== "opening") return state;
      return { ...state, phase: "popup_blocked" };

    case "READY": {
      // A blocked popup still gets its attempt id: the user may yet press
      // "Continue in this tab", and the id is what lets the return be matched
      // to this click afterwards.
      if (state.phase === "popup_blocked") {
        return { ...state, attemptId: event.attemptId ?? state.attemptId };
      }
      if (state.phase !== "opening") return state;
      const next: ConnectMachineState = {
        ...state,
        phase: "waiting",
        attemptId: event.attemptId ?? null,
        polls: 0,
        nextPollAt: null,
      };
      return event.attemptId ? { ...next, nextPollAt: event.at + pollDelay(0) } : next;
    }

    case "NOT_READY":
      if (isTerminalPhase(state.phase)) return state;
      return {
        ...state,
        phase: "failed",
        problem: event.problem,
        nextPollAt: null,
        graceUntil: null,
      };

    case "PING": {
      // A ping NEVER completes an attempt. All it may do is bring the next
      // server lookup forward, and -- when this tab never learned its own
      // attempt id -- offer one to look up. The lookup is tenant- and
      // user-scoped on the server, so an id from a hostile tab resolves to
      // "not found" rather than to someone else's connection.
      if (!isWaitingPhase(state.phase)) return state;
      const attemptId = state.attemptId ?? event.attemptId ?? null;
      return {
        ...state,
        attemptId,
        lastPingAt: event.at,
        nextPollAt: attemptId ? event.at : null,
      };
    }

    case "POPUP_CLOSED": {
      if (!isWaitingPhase(state.phase) || state.popupClosedAt !== null) return state;
      // Still "waiting": the callback may be mid-flight. Poll at once, and
      // again until the grace window runs out.
      return {
        ...state,
        phase: state.phase === "opening" ? "waiting" : state.phase,
        popupClosedAt: event.at,
        graceUntil: event.at + GRACE_POLL_MS,
        nextPollAt: state.attemptId ? event.at : null,
      };
    }

    case "LOOKUP": {
      // The server is the source of truth, and it outranks everything -- a
      // completion that lands after the window closed still wins, including
      // from "popup_closed".
      if (isTerminalPhase(state.phase)) return state;
      const phase = phaseFromAttempt(event.attempt);
      if (phase !== "waiting") {
        return {
          ...state,
          phase,
          attempt: event.attempt,
          problem: event.attempt.problem,
          nextPollAt: null,
          graceUntil: null,
        };
      }
      // Still pending. If the popup is gone and its grace has run out, stop
      // waiting on a window that no longer exists.
      if (state.graceUntil !== null && event.at >= state.graceUntil) {
        return { ...state, phase: "popup_closed", nextPollAt: null, graceUntil: null };
      }
      return scheduleNextPoll(state, event.at);
    }

    case "LOOKUP_FAILED": {
      // A refused or unreachable lookup is not an outcome. Back off and retry;
      // the expiry in the attempt record ends the wait if nothing else does.
      if (!isWaitingPhase(state.phase)) return state;
      if (state.graceUntil !== null && event.at >= state.graceUntil) {
        return { ...state, phase: "popup_closed", nextPollAt: null, graceUntil: null };
      }
      return scheduleNextPoll(state, event.at);
    }

    case "TICK": {
      if (!isWaitingPhase(state.phase)) return state;
      if (state.graceUntil !== null && event.at >= state.graceUntil) {
        return { ...state, phase: "popup_closed", nextPollAt: null, graceUntil: null };
      }
      return state;
    }

    case "CANCEL":
      if (isTerminalPhase(state.phase)) return state;
      return { ...state, phase: "cancelled", nextPollAt: null, graceUntil: null };

    case "RESET":
      return initialConnectState();

    case "RESUME": {
      // Only ever from a standing start. A reload that races a live attempt
      // must not reach back over a wait already in progress, or over an
      // outcome the user is currently reading.
      if (state.phase !== "idle") return state;
      return {
        ...initialConnectState(),
        phase: "waiting",
        platform: event.stored.platform,
        attemptId: event.stored.attemptId,
        nextPollAt: event.at,
        resumed: true,
      };
    }

    default:
      return state;
  }
}

/** True when the caller should issue a server lookup now. */
export function shouldPoll(state: ConnectMachineState, now: number): boolean {
  if (!state.attemptId) return false;
  if (!isWaitingPhase(state.phase)) return false;
  return state.nextPollAt !== null && now >= state.nextPollAt;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Cross-window signalling
 *
 * Both channels carry the same payload, and neither is trusted. They exist
 * only so the waiting tab finds out in milliseconds instead of on its next
 * two-second poll.
 * ═══════════════════════════════════════════════════════════════════════════ */

export const OAUTH_RETURN_CHANNEL = "flas-oauth-return";
/** Written then removed; the "storage" event is the signal, not the value. */
export const OAUTH_RETURN_STORAGE_KEY = "flas.oauth.return";
/** sessionStorage: the attempt id alone, so a reload can resume the wait. */
export const OAUTH_ATTEMPT_STORAGE_KEY = "flas.oauth.attempt";

export const OAUTH_PING_TYPE = "flas-oauth-complete";

export type OAuthReturnPing = {
  type: typeof OAUTH_PING_TYPE;
  /** May be null: a callback that could not consume its state has no attempt. */
  attemptId: string | null;
  at: number;
};

export function makeReturnPing(attemptId: string | null, at: number): OAuthReturnPing {
  return { type: OAUTH_PING_TYPE, attemptId: attemptId ?? null, at };
}

/** Structural check. Anything that is not exactly this shape is discarded. */
export function isReturnPing(value: unknown): value is OAuthReturnPing {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v["type"] !== OAUTH_PING_TYPE) return false;
  const id = v["attemptId"];
  if (id !== null && typeof id !== "string") return false;
  // An id that is not a uuid is dropped here rather than sent to the server.
  if (typeof id === "string" && !isAttemptId(id)) return false;
  return typeof v["at"] === "number";
}

/** Parses the storage-event fallback payload. Never throws. */
export function parseReturnPing(raw: string | null | undefined): OAuthReturnPing | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isReturnPing(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Attempt ids are oauth_states row ids: uuids, and nothing else. */
export function isAttemptId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Resuming after a reload
 *
 * Only the attempt id and the platform are kept. There is deliberately no
 * place here for a token, a code, a state value or a provider URL.
 * ═══════════════════════════════════════════════════════════════════════════ */

export type StoredAttempt = { attemptId: string; platform: string; startedAt: number };

export function encodeStoredAttempt(stored: StoredAttempt): string {
  return JSON.stringify({
    attemptId: stored.attemptId,
    platform: stored.platform,
    startedAt: stored.startedAt,
  });
}

/** An attempt older than this is stale: oauth_states rows live 15 minutes. */
const STORED_ATTEMPT_TTL_MS = 15 * 60 * 1000;

export function decodeStoredAttempt(
  raw: string | null | undefined,
  now: number,
): StoredAttempt | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const v = parsed as Record<string, unknown>;
    const attemptId = v["attemptId"];
    const platform = v["platform"];
    const startedAt = v["startedAt"];
    if (!isAttemptId(attemptId)) return null;
    if (typeof platform !== "string" || !platform) return null;
    if (typeof startedAt !== "number") return null;
    if (now - startedAt > STORED_ATTEMPT_TTL_MS) return null;
    return { attemptId, platform, startedAt };
  } catch {
    return null;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * The callback's redirect contract
 *
 * The provider sends the browser to /api/public/oauth-callback, which finishes
 * the exchange and then redirects to a page on Flas's own origin. That URL is
 * the one thing in this flow that is written into the address bar, the browser
 * history and every referer header downstream of it -- so it carries an
 * opaque attempt id and an outcome word, and nothing else that could ever be
 * a credential.
 * ═══════════════════════════════════════════════════════════════════════════ */

export const OAUTH_COMPLETE_PATH = "/oauth/complete";

export type OAuthOutcomeCode =
  "connected" | "select_target" | "blocked" | "error" | "cancelled" | "expired";

export type OAuthCompleteParams = {
  outcome: OAuthOutcomeCode;
  /** The oauth_states row id, when the callback managed to identify one. */
  attemptId?: string | null | undefined;
  platform?: string | null | undefined;
  /** The pending social_accounts row, for the "choose a target" outcome. */
  accountId?: string | null | undefined;
  /** Plain-English headline for a blocked authorization. Never technical. */
  reason?: string | null | undefined;
  detail?: string | null | undefined;
  /** A provider help page. Only ever an https URL we produced. */
  help?: string | null | undefined;
  /** One of the sanitized failure codes, e.g. "token_exchange_failed". */
  code?: string | null | undefined;
};

/**
 * Values that must never reach a URL Flas generates.
 *
 * Deliberately blunt. A provider error message quite often quotes the request
 * back, and the request carried the token -- so the defence cannot be "we only
 * put safe things in here", it has to be a filter that runs on the way out.
 */
const SECRET_MARKERS = [
  "access_token",
  "refresh_token",
  "client_secret",
  "code_verifier",
  "authorization:",
  "bearer ",
];

/** Long unbroken credential-shaped runs: Meta EAA…, Google ya29.…, JWTs. */
const SECRET_SHAPES = [
  /\bEAA[A-Za-z0-9]{12,}/,
  /\bya29\.[\w-]{10,}/,
  /\b[\w-]{12,}\.[\w-]{12,}\.[\w-]{12,}\b/,
];

export function looksLikeSecret(value: string): boolean {
  const low = value.toLowerCase();
  if (SECRET_MARKERS.some((m) => low.includes(m))) return true;
  if (SECRET_SHAPES.some((re) => re.test(value))) return true;
  // A long unbroken token-ish run with no spaces is not prose.
  return /[A-Za-z0-9_-]{40,}/.test(value);
}

/** Drops anything credential-shaped and trims to something a URL can carry. */
function safeText(value: string | null | undefined, limit: number): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (looksLikeSecret(trimmed)) return null;
  return trimmed.slice(0, limit);
}

/**
 * Builds the callback's redirect target: the popup completion page, with an
 * allowlisted, scrubbed query string.
 *
 * Returns a path and query only -- the caller prefixes its own validated
 * origin, so this can never become an open redirect.
 */
export function buildCompleteRedirect(params: OAuthCompleteParams): string {
  const search = new URLSearchParams();
  search.set("outcome", params.outcome);
  if (isAttemptId(params.attemptId)) search.set("attempt", params.attemptId);
  const platform = safeText(params.platform, 40);
  if (platform) search.set("platform", platform);
  if (isAttemptId(params.accountId)) search.set("account", params.accountId);
  const reason = safeText(params.reason, 160);
  if (reason) search.set("reason", reason);
  const detail = safeText(params.detail, 300);
  if (detail) search.set("detail", detail);
  const code = safeText(params.code, 60);
  if (code) search.set("code", code);
  const help = safeText(params.help, 300);
  // Only an absolute https help page, so a malformed one cannot become a
  // relative link back into the app.
  if (help && /^https:\/\//i.test(help)) search.set("help", help);
  return `${OAUTH_COMPLETE_PATH}?${search.toString()}`;
}

/** Reads back what buildCompleteRedirect wrote. Unknown params are ignored. */
export function readCompleteParams(search: URLSearchParams): OAuthCompleteParams {
  const outcomeRaw = search.get("outcome");
  const outcome: OAuthOutcomeCode = (
    ["connected", "select_target", "blocked", "error", "cancelled", "expired"] as const
  ).includes(outcomeRaw as OAuthOutcomeCode)
    ? (outcomeRaw as OAuthOutcomeCode)
    : "error";
  const attempt = search.get("attempt");
  const account = search.get("account");
  return {
    outcome,
    attemptId: isAttemptId(attempt) ? attempt : null,
    platform: search.get("platform"),
    accountId: isAttemptId(account) ? account : null,
    reason: search.get("reason"),
    detail: search.get("detail"),
    help: search.get("help"),
    code: search.get("code"),
  };
}

/**
 * The old `/social?connected=…` vocabulary, rebuilt from an outcome.
 *
 * The full-page fallback -- a browser that refused the popup, or a provider
 * that replaced the whole tab -- lands on the Connection Center and has to show
 * the same result screens. Emitting the legacy parameter names means the
 * existing ConnectionOutcome renders it unchanged, and every `/social?…` link
 * already in the wild keeps working.
 */
export function legacyOutcomeSearch(params: OAuthCompleteParams): Record<string, string> {
  const out: Record<string, string> = {};
  const platform = params.platform ?? "";
  switch (params.outcome) {
    case "connected":
      if (platform) out["connected"] = platform;
      break;
    case "select_target":
      if (platform) out["connected"] = platform;
      // "1" is what older callbacks sent when they had no row id to give.
      out["select_target"] = params.accountId ?? "1";
      break;
    case "blocked":
      out["connect_blocked"] = platform || "this platform";
      if (params.reason) out["connect_reason"] = params.reason;
      if (params.detail) out["connect_detail"] = params.detail;
      if (params.help) out["connect_help"] = params.help;
      break;
    case "cancelled":
      out["connect_cancelled"] = platform || "1";
      break;
    case "expired":
      out["connect_expired"] = platform || "1";
      break;
    case "error":
      out["connect_error"] = params.code || params.reason || "connect_failed";
      if (platform) out["platform"] = platform;
      break;
  }
  if (isAttemptId(params.attemptId)) out["connect_attempt"] = params.attemptId;
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Marking the outcome on the attempt row, without a schema change
 *
 * oauth_states has attempt_state and attempt_reason and nothing else to hold a
 * result. Adding a column for the pending account id would mean a migration on
 * a table three other things already write to, for one nullable uuid -- so the
 * markers are encoded into the front of attempt_reason instead, as documented
 * `key=value;` segments, and the human sentence follows them.
 *
 *   "account=7f3c…-…; The account was connected"
 *   "target=7f3c…-…; Authorized; waiting for the customer to choose a Page"
 *   "code=token_exchange_failed; Token exchange failed for meta (HTTP 400)."
 *
 * Only these three keys are ever read. Anything else in the leading segments is
 * ignored, so an older row -- or a reason that happens to contain an equals
 * sign -- decodes to itself with no markers, which is exactly right.
 * ═══════════════════════════════════════════════════════════════════════════ */

export type AttemptMarkers = {
  /** The social_accounts row this attempt created, when there is one. */
  accountId: string | null;
  /** Set when the account exists but the customer still has to choose. */
  targetAccountId: string | null;
  /** The sanitized failure code, for mapping to a ConnectionProblem. */
  code: string | null;
  /** What is left once the markers are removed: the sentence for a human. */
  reason: string;
};

const MARKER_KEYS = ["account", "target", "code"] as const;
/** attempt_reason is written with .slice(0, 300); keep the markers inside it. */
export const ATTEMPT_REASON_LIMIT = 300;

export function encodeAttemptReason(markers: {
  accountId?: string | null | undefined;
  targetAccountId?: string | null | undefined;
  code?: string | null | undefined;
  reason: string;
}): string {
  const parts: string[] = [];
  if (isAttemptId(markers.targetAccountId)) parts.push(`target=${markers.targetAccountId}`);
  else if (isAttemptId(markers.accountId)) parts.push(`account=${markers.accountId}`);
  if (markers.code && /^[a-z0-9_]{1,60}$/.test(markers.code)) parts.push(`code=${markers.code}`);
  const prefix = parts.length ? `${parts.join("; ")}; ` : "";
  // The sentence is what gets truncated, never the markers -- a cut-off uuid
  // would decode to a different row, or to none.
  const room = Math.max(0, ATTEMPT_REASON_LIMIT - prefix.length);
  return `${prefix}${markers.reason.slice(0, room)}`;
}

export function decodeAttemptReason(raw: string | null | undefined): AttemptMarkers {
  const markers: AttemptMarkers = {
    accountId: null,
    targetAccountId: null,
    code: null,
    reason: raw?.trim() ?? "",
  };
  if (!raw) return markers;

  let rest = raw;
  for (;;) {
    const match = /^\s*([a-z]+)=([^;]*)(?:;\s*|$)/.exec(rest);
    if (!match) break;
    const key = match[1] ?? "";
    const value = (match[2] ?? "").trim();
    if (!(MARKER_KEYS as readonly string[]).includes(key)) break;
    if (key === "account" && isAttemptId(value)) markers.accountId = value;
    else if (key === "target" && isAttemptId(value)) markers.targetAccountId = value;
    else if (key === "code" && /^[a-z0-9_]{1,60}$/.test(value)) markers.code = value;
    else break; // a malformed marker stops parsing; the rest stays prose
    rest = rest.slice(match[0].length);
  }
  markers.reason = rest.trim();
  return markers;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * The popup itself
 * ═══════════════════════════════════════════════════════════════════════════ */

/** The window name. Reusing it means a second click replaces the first popup. */
export const OAUTH_POPUP_NAME = "flas-oauth";

export const POPUP_WIDTH = 620;
export const POPUP_HEIGHT = 760;

/**
 * Popup features, centred on the screen the app is on.
 *
 * "popup" is what tells a modern browser this is a genuine user-initiated
 * window rather than a tab to be folded into the background -- and, unlike the
 * previous flow, there is deliberately no "noopener": with it set, window.open
 * returns null by specification, so the code could never sever the opener
 * itself, never navigate the window, and never notice it closing. The opener is
 * severed a moment later instead, before the provider's URL is loaded.
 */
export function popupFeatures(screen?: {
  width: number;
  height: number;
  left?: number;
  top?: number;
}): string {
  const w = POPUP_WIDTH;
  const h = POPUP_HEIGHT;
  const baseLeft = screen?.left ?? 0;
  const baseTop = screen?.top ?? 0;
  const left = Math.max(0, Math.round(baseLeft + ((screen?.width ?? w) - w) / 2));
  const top = Math.max(0, Math.round(baseTop + ((screen?.height ?? h) - h) / 3));
  return `popup=1,width=${w},height=${h},left=${left},top=${top},resizable=1,scrollbars=1`;
}
