// Integration Error Engine — turns a raw provider failure into something a
// business owner can act on WITHOUT throwing away what a developer needs.
//
// Two rules drive this file:
//   1. Never lose the provider's own error code. "Something went wrong" is
//      useless for debugging Meta; code 190 subcode 460 tells you the user
//      changed their password and the token is dead.
//   2. Never persist a secret. Tokens appear in provider error strings and
//      in the URLs those strings quote, so everything is redacted on the way
//      in, not on the way out.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createHash } from "crypto";

export type ErrorSeverity = "info" | "warning" | "action_required" | "critical" | "system_failure";

export type NormalizedError = {
  httpStatus: number | null;
  providerCode: string | null;
  providerSubcode: string | null;
  providerType: string | null;
  /** Provider's own text, redacted. Safe to store and show under "technical details". */
  providerMessage: string | null;
  friendlyTitle: string;
  friendlyMessage: string;
  likelyCause: string | null;
  recommendedFix: string | null;
  severity: ErrorSeverity;
  retryable: boolean;
  apiVersion: string | null;
};

/* ------------------------------------------------------------------ */
/* Redaction                                                           */
/* ------------------------------------------------------------------ */

const SECRET_PATTERNS: RegExp[] = [
  /access_token=[^&\s"']+/gi,
  /client_secret=[^&\s"']+/gi,
  /refresh_token=[^&\s"']+/gi,
  // The PKCE verifier is the second half of a code exchange: with an
  // intercepted authorization code it is enough to obtain a token.
  /code_verifier=[^&\s"']+/gi,
  // An authorization code is short-lived but exchangeable: anyone who reads
  // one out of a log before the real callback lands can trade it for a token.
  /\bcode=[^&\s"']{8,}/gi,
  // The state value is no longer stored, but it can still appear in an echoed
  // request URL, and it is the other half of a callback replay.
  /\bstate=[^&\s"']{16,}/gi,
  // The value class includes / + = ~ deliberately. It previously stopped at
  // [A-Za-z0-9._-], which meant a Google refresh token -- they begin "1//" --
  // did not match and passed through redaction intact.
  /(["']?(?:access_token|client_secret|refresh_token|app_secret|api_key|password|code_verifier)["']?\s*[:=]\s*)["']?[A-Za-z0-9._~+/=-]{8,}["']?/gi,
  /Bearer\s+[A-Za-z0-9._-]{8,}/gi,
  // Meta long-lived tokens are long opaque strings prefixed EAA...
  /\bEAA[A-Za-z0-9]{20,}\b/g,
];

/** Strips anything token-shaped out of provider text before it is stored. */
export function redactSecrets(input: string | null | undefined): string | null {
  if (!input) return null;
  let out = String(input);
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, "[redacted]");
  return out.slice(0, 2000);
}

/** Last 4 characters only, for the admin-facing token panel (§20). */
export function tokenHint(token: string | null | undefined): string {
  if (!token || token.length < 4) return "••••";
  return `••••••••${token.slice(-4)}`;
}

/* ------------------------------------------------------------------ */
/* Provider-specific extraction                                        */
/* ------------------------------------------------------------------ */

type RawProviderBody = {
  error?: {
    message?: string;
    type?: string;
    code?: number | string;
    error_subcode?: number | string;
    error_user_msg?: string;
    status?: number | string;
  };
  error_description?: string;
  errors?: Array<{ message?: string; errorCode?: string; code?: string | number }>;
  detail?: string;
  title?: string;
  message?: string;
};

/**
 * Pulls the provider's own code/subcode/type out of whatever shape that
 * provider uses. Meta, Google, LinkedIn, TikTok and X all differ here.
 */
function extractProviderFields(
  platform: string,
  body: RawProviderBody | null,
): { code: string | null; subcode: string | null; type: string | null; message: string | null } {
  if (!body) return { code: null, subcode: null, type: null, message: null };

  // Meta (Facebook / Instagram / WhatsApp) — the richest error shape.
  if (body.error && (body.error.code !== undefined || body.error.type)) {
    return {
      code: body.error.code != null ? String(body.error.code) : null,
      subcode: body.error.error_subcode != null ? String(body.error.error_subcode) : null,
      type: body.error.type ?? null,
      // error_user_msg is Meta's own end-user-safe wording when present.
      message: body.error.error_user_msg ?? body.error.message ?? null,
    };
  }
  // Google — { error: { message, status } } or { error_description }
  if (body.error?.message || body.error_description) {
    return {
      code: body.error?.status != null ? String(body.error.status) : null,
      subcode: null,
      type: null,
      message: body.error?.message ?? body.error_description ?? null,
    };
  }
  // LinkedIn — { message, status, serviceErrorCode }
  // TikTok — { error: { code, message } } handled above; X — { detail, title }
  if (body.detail || body.title) {
    return { code: null, subcode: null, type: body.title ?? null, message: body.detail ?? null };
  }
  if (Array.isArray(body.errors) && body.errors.length > 0) {
    const first = body.errors[0]!;
    return {
      code:
        first.errorCode != null
          ? String(first.errorCode)
          : first.code != null
            ? String(first.code)
            : null,
      subcode: null,
      type: null,
      message: first.message ?? null,
    };
  }
  return { code: null, subcode: null, type: null, message: body.message ?? null };
}

/* ------------------------------------------------------------------ */
/* Meta-specific code meanings                                         */
/* ------------------------------------------------------------------ */

/** Meta reuses HTTP 400 for almost everything, so the real meaning lives in
 *  code/subcode. These are the ones that actually change what the user does. */
function metaCodeMeaning(
  code: string | null,
  subcode: string | null,
): Partial<NormalizedError> | null {
  if (code === "190") {
    if (subcode === "460") {
      return {
        friendlyTitle: "Sign-in expired",
        friendlyMessage:
          "The password on the connected account changed, so the old authorization is no longer valid.",
        likelyCause: "Account password was changed or the session was invalidated.",
        recommendedFix: "Reconnect the account.",
        severity: "action_required",
        retryable: false,
      };
    }
    if (subcode === "463") {
      return {
        friendlyTitle: "Authorization expired",
        friendlyMessage: "The access this account granted has run out and needs renewing.",
        likelyCause: "Token passed its expiry date.",
        recommendedFix: "Reconnect the account to issue a fresh authorization.",
        severity: "action_required",
        retryable: false,
      };
    }
    if (subcode === "458" || subcode === "459") {
      return {
        friendlyTitle: "Access was removed",
        friendlyMessage: "Someone removed this app's access from the connected account.",
        likelyCause: "The app was revoked in the platform's own settings.",
        recommendedFix: "Reconnect and approve access again.",
        severity: "action_required",
        retryable: false,
      };
    }
    return {
      friendlyTitle: "Authorization no longer valid",
      friendlyMessage: "The platform rejected the stored authorization for this account.",
      recommendedFix: "Reconnect the account.",
      severity: "action_required",
      retryable: false,
    };
  }
  if (code === "200" || code === "10" || code === "3") {
    return {
      friendlyTitle: "Permission missing",
      friendlyMessage: "The account is connected, but this specific action was not approved.",
      likelyCause:
        "The required permission was declined during sign-in, or needs platform app review.",
      recommendedFix: "Reconnect and approve the requested permissions.",
      severity: "action_required",
      retryable: false,
    };
  }
  if (code === "4" || code === "17" || code === "32" || code === "613") {
    return {
      friendlyTitle: "Platform rate limit reached",
      friendlyMessage:
        "The platform is temporarily limiting how often we can call it. Nothing is broken.",
      recommendedFix: "No action needed — this retries automatically.",
      severity: "warning",
      retryable: true,
    };
  }
  if (code === "100") {
    return {
      friendlyTitle: "Requested item not found",
      friendlyMessage: "The page, account or item this integration points at could not be read.",
      likelyCause: "It was deleted, renamed, or this login lost access to it.",
      recommendedFix: "Reconnect and re-select the correct page or account.",
      severity: "action_required",
      retryable: false,
    };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* HTTP-level fallback mapping (§27)                                   */
/* ------------------------------------------------------------------ */

function httpMeaning(status: number | null): Partial<NormalizedError> {
  if (status === 401) {
    return {
      friendlyTitle: "Connection authorization expired",
      friendlyMessage: "This account can no longer be accessed with the stored sign-in.",
      recommendedFix: "Reconnect the account.",
      severity: "action_required",
      retryable: false,
    };
  }
  if (status === 403) {
    return {
      friendlyTitle: "Permission missing",
      friendlyMessage: "The account is connected, but this action was not approved for it.",
      recommendedFix: "Reconnect and approve the requested permissions.",
      severity: "action_required",
      retryable: false,
    };
  }
  if (status === 404) {
    return {
      friendlyTitle: "Connected item not found",
      friendlyMessage:
        "The page or account previously connected may have been removed, or access to it was lost.",
      recommendedFix: "Reconnect and select the correct page or account.",
      severity: "action_required",
      retryable: false,
    };
  }
  if (status === 429) {
    return {
      friendlyTitle: "Platform rate limit reached",
      friendlyMessage: "The platform is temporarily limiting requests. This resolves on its own.",
      recommendedFix: "No action needed — this retries automatically.",
      severity: "warning",
      retryable: true,
    };
  }
  if (status != null && status >= 500) {
    return {
      friendlyTitle: "Platform temporarily unavailable",
      friendlyMessage: "The platform returned a server error. This account is still connected.",
      recommendedFix: "No action needed — this retries automatically.",
      severity: "warning",
      retryable: true,
    };
  }
  if (status === 408) {
    return {
      friendlyTitle: "Platform did not respond in time",
      friendlyMessage: "The request timed out before the platform answered.",
      recommendedFix: "No action needed — this retries automatically.",
      severity: "warning",
      retryable: true,
    };
  }
  return {
    friendlyTitle: "Integration problem",
    friendlyMessage: "The platform rejected a request from this integration.",
    recommendedFix: "Run a connection test for details.",
    severity: "warning",
    retryable: false,
  };
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Normalizes a provider failure. Provider-specific meaning wins over the
 * generic HTTP mapping, because Meta returning 400 with code 190 is an
 * expired login — not a "bad request".
 */
export function normalizeProviderError(args: {
  platform: string;
  httpStatus?: number | null;
  body?: unknown;
  thrown?: unknown;
  apiVersion?: string | null;
}): NormalizedError {
  const { platform, apiVersion = null } = args;
  const httpStatus = args.httpStatus ?? null;

  // A thrown network error never reached the provider at all.
  if (args.thrown && httpStatus == null) {
    const message = args.thrown instanceof Error ? args.thrown.message : String(args.thrown);
    return {
      httpStatus: null,
      providerCode: null,
      providerSubcode: null,
      providerType: "network",
      providerMessage: redactSecrets(message),
      friendlyTitle: "Could not reach the platform",
      friendlyMessage: "The request never completed — this is usually a temporary network problem.",
      likelyCause: "Network failure or platform outage.",
      recommendedFix: "No action needed — this retries automatically.",
      severity: "warning",
      retryable: true,
      apiVersion,
    };
  }

  const body = (
    typeof args.body === "object" && args.body !== null ? args.body : null
  ) as RawProviderBody | null;
  const provider = extractProviderFields(platform, body);

  const base = httpMeaning(httpStatus);
  const specific =
    platform === "facebook" || platform === "instagram" || platform === "whatsapp"
      ? metaCodeMeaning(provider.code, provider.subcode)
      : null;

  const merged = { ...base, ...(specific ?? {}) };

  return {
    httpStatus,
    providerCode: provider.code,
    providerSubcode: provider.subcode,
    providerType: provider.type,
    providerMessage: redactSecrets(provider.message),
    friendlyTitle: merged.friendlyTitle ?? "Integration problem",
    friendlyMessage:
      merged.friendlyMessage ?? "The platform rejected a request from this integration.",
    likelyCause: merged.likelyCause ?? null,
    recommendedFix: merged.recommendedFix ?? null,
    severity: merged.severity ?? "warning",
    retryable: merged.retryable ?? false,
    apiVersion,
  };
}

/** Groups identical failures so 37 occurrences are one row with a count. */
function fingerprintOf(args: {
  platform: string;
  accountId: string | null;
  feature: string | null;
  httpStatus: number | null;
  providerCode: string | null;
  providerSubcode: string | null;
}): string {
  const raw = [
    args.platform,
    args.accountId ?? "-",
    args.feature ?? "-",
    args.httpStatus ?? "-",
    args.providerCode ?? "-",
    args.providerSubcode ?? "-",
  ].join("|");
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

/**
 * Records a normalized error, deduplicated by fingerprint. Never throws —
 * failing to log an error must not break the operation that hit it.
 */
export async function recordIntegrationError(args: {
  tenantId: string;
  accountId?: string | null;
  platform: string;
  feature?: string | null;
  operation?: string | null;
  error: NormalizedError;
}): Promise<void> {
  try {
    const fingerprint = fingerprintOf({
      platform: args.platform,
      accountId: args.accountId ?? null,
      feature: args.feature ?? null,
      httpStatus: args.error.httpStatus,
      providerCode: args.error.providerCode,
      providerSubcode: args.error.providerSubcode,
    });
    await supabaseAdmin.rpc("record_integration_error", {
      _tenant_id: args.tenantId,
      _account_id: args.accountId ?? null,
      _platform: args.platform,
      _feature: args.feature ?? null,
      _operation: args.operation ?? null,
      _http_status: args.error.httpStatus,
      _provider_code: args.error.providerCode,
      _provider_subcode: args.error.providerSubcode,
      _provider_type: args.error.providerType,
      _provider_message: args.error.providerMessage,
      _friendly_title: args.error.friendlyTitle,
      _friendly_message: args.error.friendlyMessage,
      _likely_cause: args.error.likelyCause,
      _recommended_fix: args.error.recommendedFix,
      _severity: args.error.severity,
      _retryable: args.error.retryable,
      _api_version: args.error.apiVersion,
      _fingerprint: fingerprint,
    } as never);
  } catch (loggingError) {
    console.error("[integration-errors] failed to record", loggingError);
  }
}
