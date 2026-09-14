// Browser-side error capture for Flas: uncaught errors, unhandled promise
// rejections, failed server actions and blank-screen incidents. Everything is
// forwarded to our own error store (same role as Sentry) together with the
// route, session id and — when signed in — the user and their company.

import { reportErrorEvent } from "@/lib/telemetry.functions";

export type ErrorKind =
  "frontend" | "server_action" | "blank_screen" | "network" | "error_boundary";

const SESSION_KEY = "flas.telemetry.session";
const MAX_PER_SESSION = 40;
const DEDUPE_WINDOW_MS = 10_000;

let sent = 0;
const recent = new Map<string, number>();

export function telemetrySessionId(): string {
  if (typeof window === "undefined") return "ssr";
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    window.sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return "no-storage";
  }
}

function describe(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message || error.name, ...(error.stack ? { stack: error.stack } : {}) };
  }
  if (error instanceof Response) {
    return { message: `HTTP ${error.status}${error.url ? ` at ${error.url}` : ""}` };
  }
  if (typeof error === "string") return { message: error };
  try {
    return { message: JSON.stringify(error).slice(0, 500) };
  } catch {
    return { message: String(error) };
  }
}

/** Navigation commonly aborts in-flight route/server-function fetches. These
 * are control flow, not incidents, and should not drown real failures. */
export function isAbortLikeError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (error instanceof Error) {
    const text = `${error.name} ${error.message}`.toLowerCase();
    return (
      text.includes("aborterror") ||
      text.includes("the operation was aborted") ||
      text.includes("signal is aborted") ||
      text.includes("request was aborted") ||
      text.includes("navigation aborted")
    );
  }
  return false;
}

/** Reports one incident. Never throws and never blocks the UI. */
export function captureError(
  error: unknown,
  options: {
    kind?: ErrorKind;
    severity?: "error" | "warning" | "info";
    context?: Record<string, unknown>;
  } = {},
) {
  if (typeof window === "undefined" || isAbortLikeError(error)) return;
  const { message, stack } = describe(error);
  if (!message) return;

  const key = `${options.kind ?? "frontend"}:${message}`.slice(0, 200);
  const now = Date.now();
  const last = recent.get(key);
  if (last && now - last < DEDUPE_WINDOW_MS) return;
  recent.set(key, now);
  if (sent >= MAX_PER_SESSION) return;
  sent += 1;

  void reportErrorEvent({
    data: {
      kind: options.kind ?? "frontend",
      severity: options.severity ?? "error",
      message: message.slice(0, 1000),
      stack: stack?.slice(0, 6000),
      route: window.location.pathname,
      url: window.location.href,
      userAgent: navigator.userAgent.slice(0, 400),
      sessionId: telemetrySessionId(),
      context: options.context ?? {},
    },
  }).catch(() => {
    /* telemetry must never surface its own failure to the user */
  });
}

let installed = false;

/**
 * Installs global listeners once. Also watches for blank-screen incidents:
 * if the app shell renders nothing for several seconds we record it, because
 * that is exactly the failure users report as "the page is just white".
 */
export function installTelemetry() {
  if (typeof window === "undefined" || installed) return;
  installed = true;

  window.addEventListener("error", (event) => {
    const err = (event as ErrorEvent).error ?? (event as ErrorEvent).message;
    if (isAbortLikeError(err)) {
      event.preventDefault();
      return;
    }
    captureError(err, {
      kind: "frontend",
      context: {
        filename: (event as ErrorEvent).filename,
        line: (event as ErrorEvent).lineno,
      },
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = (event as PromiseRejectionEvent).reason;
    if (isAbortLikeError(reason)) {
      event.preventDefault();
      return;
    }
    captureError(reason, { kind: "frontend" });
  });

  installServerActionWatcher();
  installBlankScreenWatcher();
}

/** Flags non-OK responses from server actions so failed RPCs are visible. */
function installServerActionWatcher() {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    try {
      const response = await originalFetch(input as RequestInfo, init);
      if (!response.ok && isServerAction(url)) {
        captureError(`Server action failed with HTTP ${response.status}`, {
          kind: "server_action",
          context: { operation: "server_fetch", url: shortUrl(url), status: response.status },
        });
      }
      return response;
    } catch (error) {
      if (!isAbortLikeError(error) && isServerAction(url)) {
        captureError(error, {
          kind: "network",
          context: { operation: "server_fetch", url: shortUrl(url) },
        });
      }
      throw error;
    }
  };
}

function isServerAction(url: string): boolean {
  return url.includes("_serverFn") || url.includes("/api/");
}

function shortUrl(url: string): string {
  try {
    return new URL(url, window.location.origin).pathname.slice(0, 200);
  } catch {
    return url.slice(0, 200);
  }
}

function installBlankScreenWatcher() {
  const check = () => {
    const root = document.body;
    const text = (root?.innerText ?? "").trim();
    const nodes = root?.querySelectorAll("main, [data-app-shell], header, nav").length ?? 0;
    if (text.length < 12 && nodes === 0) {
      captureError("Blank screen: app shell rendered no visible content", {
        kind: "blank_screen",
        context: { readyState: document.readyState },
      });
    }
  };
  window.setTimeout(check, 6000);
}
