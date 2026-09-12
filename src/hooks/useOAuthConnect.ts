/*
 * Connecting a platform without asking anyone to come back.
 *
 * The old flow opened a tab with window.open(url, "_blank", "noopener") and
 * toasted "come back here when you're done". Two things were wrong with it.
 * Per the HTML specification window.open returns null whenever `noopener` is
 * set, so the handle was always null and the "Allow pop-ups" error fired on
 * every single success. And because nothing held a handle, nothing could tell
 * a finished sign-in from an abandoned one.
 *
 * What replaces it:
 *
 *   - The window is opened SYNCHRONOUSLY inside the click, at about:blank,
 *     before any await. A popup opened later — after the server function has
 *     answered — is no longer attributable to a user gesture and gets blocked.
 *   - The opener is severed by hand (popup.opener = null) immediately before
 *     the provider's URL is loaded, which gets the isolation `noopener` would
 *     have given while keeping the handle that makes the rest of this possible.
 *   - Completion is detected three ways: a BroadcastChannel ping, a
 *     localStorage fallback, and a poll of the server's own attempt record.
 *     Only the third can finish an attempt. The first two exist to make the
 *     third happen sooner, and are never believed on their own.
 */
import { startConnect } from "@/lib/connections.functions";
import { getConnectAttempt } from "@/lib/connect-attempts.functions";
import type { ConnectAttempt, ConnectionProblem } from "@/lib/connection-problem";
import {
  type ConnectPhase,
  OAUTH_ATTEMPT_STORAGE_KEY,
  OAUTH_POPUP_NAME,
  OAUTH_RETURN_CHANNEL,
  OAUTH_RETURN_STORAGE_KEY,
  connectReducer,
  decodeStoredAttempt,
  encodeStoredAttempt,
  initialConnectState,
  isAttemptId,
  isReturnPing,
  isTerminalPhase,
  isWaitingPhase,
  parseReturnPing,
  popupFeatures,
  shouldPoll,
} from "@/lib/oauth-return";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useReducer, useRef } from "react";

export type UseOAuthConnect = {
  phase: ConnectPhase;
  /** Connector id of the attempt in flight, e.g. "instagram". */
  platform: string | null;
  attemptId: string | null;
  /** The server's record, once there is an outcome. */
  attempt: ConnectAttempt | null;
  /** Why it failed, already filtered for this caller's role by the server. */
  problem: ConnectionProblem | null;
  /** Must be called directly from the click handler, not from an effect. */
  start: (platform: string) => void;
  retry: () => void;
  continueInThisTab: () => void;
  cancel: () => void;
  reset: () => void;
};

/** How often the popup handle is checked and the poll clock advanced. */
const TICK_MS = 400;

/*
 * startConnect's result is read through these rather than by property access.
 *
 * The readiness work adds `attemptId` to the ready result and `problem` to the
 * not-ready one; until it merges, neither exists. Structural reads compile
 * against both shapes, so this branch is correct before and after that change
 * instead of only afterwards.
 */
function readAttemptId(result: unknown): string | null {
  if (typeof result !== "object" || result === null) return null;
  const value = (result as Record<string, unknown>)["attemptId"];
  return isAttemptId(value) ? value : null;
}

function readProblem(result: unknown): ConnectionProblem | null {
  if (typeof result !== "object" || result === null) return null;
  const value = (result as Record<string, unknown>)["problem"];
  if (typeof value !== "object" || value === null) return null;
  const p = value as Record<string, unknown>;
  if (typeof p["code"] !== "string" || typeof p["title"] !== "string") return null;
  if (typeof p["message"] !== "string" || typeof p["nextAction"] !== "string") return null;
  return value as ConnectionProblem;
}

/** The pre-contract shape, so a refusal still reads as a problem today. */
function problemFromReason(result: unknown, platform: string): ConnectionProblem {
  const record = (typeof result === "object" && result !== null ? result : {}) as Record<
    string,
    unknown
  >;
  const reason = typeof record["reason"] === "string" ? record["reason"] : null;
  const missing = Array.isArray(record["missing"])
    ? record["missing"].filter((m): m is string => typeof m === "string")
    : [];
  return {
    code: "OAUTH_START_REFUSED",
    title: "This connection cannot start yet",
    message: reason ?? `Flas could not start the ${platform.replace(/_/g, " ")} sign-in.`,
    owner: missing.length > 0 ? "WORKSPACE_ADMIN" : "END_USER",
    severity: "blocking",
    nextAction:
      missing.length > 0
        ? "Open Connect & setup and finish this platform's one-time setup, then press Connect again."
        : "Press Connect again. If it keeps failing, contact support.",
    retryable: missing.length === 0,
    ...(missing.length > 0 ? { technical: { setting: missing.join(", ") } } : {}),
  };
}

export function useOAuthConnect(): UseOAuthConnect {
  const [state, dispatch] = useReducer(connectReducer, undefined, initialConnectState);

  const startFn = useServerFn(startConnect);
  const lookupFn = useServerFn(getConnectAttempt);

  const popupRef = useRef<Window | null>(null);
  /** The provider URL, in memory for this page only. Never stored anywhere. */
  const authorizeUrlRef = useRef<string | null>(null);
  /** Set when "Continue in this tab" is pressed before the URL is known. */
  const continueWhenReadyRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  /** Guards against two lookups for the same due time overlapping. */
  const lookupInFlightRef = useRef(false);

  const clearStoredAttempt = useCallback(() => {
    try {
      window.sessionStorage.removeItem(OAUTH_ATTEMPT_STORAGE_KEY);
    } catch {
      /* storage disabled; resuming after a reload simply will not work */
    }
  }, []);

  const closePopup = useCallback(() => {
    const popup = popupRef.current;
    popupRef.current = null;
    try {
      if (popup && !popup.closed) popup.close();
    } catch {
      /* already gone, or navigated somewhere that refuses close() */
    }
  }, []);

  /* ── Starting ──────────────────────────────────────────────────────────── */

  const beginAuthorization = useCallback(
    async (platform: string, popup: Window | null) => {
      try {
        const result = await startFn({
          data: { platform: platform as never, origin: window.location.origin },
        });

        if (!result.ready) {
          // Nothing is going to happen in that window, so do not leave it
          // sitting on a blank page for the user to close.
          closePopup();
          dispatch({
            type: "NOT_READY",
            problem: readProblem(result) ?? problemFromReason(result, platform),
            at: Date.now(),
          });
          return;
        }

        const attemptId = readAttemptId(result);
        authorizeUrlRef.current = result.url;

        if (attemptId) {
          // The id and the platform, and nothing else. A reload mid-sign-in
          // can then pick the wait back up; a token here would outlive the
          // page and be readable by any script on the origin.
          try {
            window.sessionStorage.setItem(
              OAUTH_ATTEMPT_STORAGE_KEY,
              encodeStoredAttempt({ attemptId, platform, startedAt: Date.now() }),
            );
          } catch {
            /* resuming after a reload will not work; the flow still does */
          }
        }

        dispatch({ type: "READY", attemptId, at: Date.now() });

        if (continueWhenReadyRef.current) {
          continueWhenReadyRef.current = false;
          closePopup();
          window.location.assign(result.url);
          return;
        }

        if (popup && !popup.closed) {
          try {
            // What `noopener` would have done, done late enough to keep the
            // handle: the provider's page gets no window.opener back into Flas.
            popup.opener = null;
          } catch {
            /* some browsers make opener read-only; the navigation still stands */
          }
          // replace(), so the provider is not reachable by pressing Back to a
          // blank page inside the popup.
          popup.location.replace(result.url);
        }
      } catch (e) {
        closePopup();
        dispatch({
          type: "NOT_READY",
          problem: {
            code: "OAUTH_START_FAILED",
            title: "Flas could not start the sign-in",
            message: e instanceof Error ? e.message : "The request did not reach Flas.",
            owner: "END_USER",
            severity: "blocking",
            nextAction: "Check your connection and press Connect again.",
            retryable: true,
          },
          at: Date.now(),
        });
      }
    },
    [startFn, closePopup],
  );

  const start = useCallback(
    (platform: string) => {
      const at = Date.now();
      dispatch({ type: "START", platform, at });

      // Opened here, first, with no await in front of it. A window opened after
      // the server function resolves is no longer tied to this click, and every
      // modern browser blocks it.
      let popup: Window | null = null;
      try {
        popup = window.open(
          "about:blank",
          OAUTH_POPUP_NAME,
          popupFeatures({
            width: window.outerWidth || window.screen.width,
            height: window.outerHeight || window.screen.height,
            left: window.screenX,
            top: window.screenY,
          }),
        );
      } catch {
        popup = null;
      }
      popupRef.current = popup;
      continueWhenReadyRef.current = false;

      dispatch(popup ? { type: "POPUP_OPENED", at } : { type: "POPUP_BLOCKED", at });
      void beginAuthorization(platform, popup);
    },
    [beginAuthorization],
  );

  /* ── Controls ──────────────────────────────────────────────────────────── */

  const reset = useCallback(() => {
    closePopup();
    clearStoredAttempt();
    authorizeUrlRef.current = null;
    continueWhenReadyRef.current = false;
    dispatch({ type: "RESET", at: Date.now() });
  }, [closePopup, clearStoredAttempt]);

  const cancel = useCallback(() => {
    closePopup();
    clearStoredAttempt();
    continueWhenReadyRef.current = false;
    dispatch({ type: "CANCEL", at: Date.now() });
  }, [closePopup, clearStoredAttempt]);

  const retry = useCallback(() => {
    const platform = stateRef.current.platform;
    reset();
    if (platform) start(platform);
  }, [reset, start]);

  const continueInThisTab = useCallback(() => {
    const url = authorizeUrlRef.current;
    if (!url) {
      // startConnect has not answered yet. Remember the intent so the redirect
      // happens the moment it does, rather than doing nothing on a press.
      continueWhenReadyRef.current = true;
      return;
    }
    closePopup();
    window.location.assign(url);
  }, [closePopup]);

  /* ── Hearing about completion ──────────────────────────────────────────── */

  // A ping only ever brings the next server lookup forward. Neither channel is
  // authenticated, so neither may say what the outcome was.
  useEffect(() => {
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(OAUTH_RETURN_CHANNEL);
      channel.onmessage = (event: MessageEvent) => {
        if (!isReturnPing(event.data)) return;
        dispatch({ type: "PING", attemptId: event.data.attemptId, at: Date.now() });
      };
    } catch {
      /* no BroadcastChannel in this browser; the storage listener covers it */
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key !== OAUTH_RETURN_STORAGE_KEY) return;
      const ping = parseReturnPing(event.newValue);
      if (!ping) return;
      dispatch({ type: "PING", attemptId: ping.attemptId, at: Date.now() });
    };
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener("storage", onStorage);
      try {
        channel?.close();
      } catch {
        /* already closed */
      }
    };
  }, []);

  /* ── The clock: popup watch, grace window and polling ──────────────────── */

  useEffect(() => {
    if (!isWaitingPhase(state.phase)) return;

    const timer = window.setInterval(() => {
      const now = Date.now();
      const current = stateRef.current;

      const popup = popupRef.current;
      if (popup && popup.closed) {
        popupRef.current = null;
        dispatch({ type: "POPUP_CLOSED", at: now });
      }

      // Advances the grace window. A no-op tick returns the identical state
      // object, so this does not re-render four times a second.
      dispatch({ type: "TICK", at: now });

      if (!shouldPoll(current, now) || lookupInFlightRef.current) return;
      const attemptId = current.attemptId;
      if (!attemptId) return;

      lookupInFlightRef.current = true;
      void lookupFn({ data: { attemptId } })
        .then((attempt) => {
          dispatch({ type: "LOOKUP", attempt, at: Date.now() });
        })
        .catch(() => {
          // A refused or unreachable lookup is not an outcome — back off and
          // ask again. Only the attempt's own expiry ends the wait.
          dispatch({ type: "LOOKUP_FAILED", at: Date.now() });
        })
        .finally(() => {
          lookupInFlightRef.current = false;
        });
    }, TICK_MS);

    return () => window.clearInterval(timer);
  }, [state.phase, lookupFn]);

  /* ── Resuming after a reload ───────────────────────────────────────────── */

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.sessionStorage.getItem(OAUTH_ATTEMPT_STORAGE_KEY);
    } catch {
      return;
    }
    const attempt = decodeStoredAttempt(stored, Date.now());
    if (!attempt) {
      if (stored) clearStoredAttempt();
      return;
    }
    // RESUME is ignored by the reducer unless the machine is idle, so a reload
    // racing a live attempt cannot reach back over it.
    dispatch({ type: "RESUME", stored: attempt, at: Date.now() });
  }, [clearStoredAttempt]);

  /* ── Tidying up ────────────────────────────────────────────────────────── */

  useEffect(() => {
    if (!isTerminalPhase(state.phase)) return;
    clearStoredAttempt();
    closePopup();
  }, [state.phase, clearStoredAttempt, closePopup]);

  useEffect(() => closePopup, [closePopup]);

  return {
    phase: state.phase,
    platform: state.platform,
    attemptId: state.attemptId,
    attempt: state.attempt,
    problem: state.problem,
    start,
    retry,
    continueInThisTab,
    cancel,
    reset,
  };
}
