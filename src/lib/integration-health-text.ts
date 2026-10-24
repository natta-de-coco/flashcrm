// Which sentence a status or a check's outcome is, as a translation key plus the values that fill
// it. Browser-safe and free of React, so a test can prove that every code the server can send has a
// sentence in all five languages with every blank filled.
//
// The server sends a fixed code (reason_code, outcome) plus plain values; the words are chosen
// here. Where there is no entry the screen falls back to the English the server also sent, so a new
// code can never print a key or leave a blank.
import { connector } from "./connections-catalog";
import type { MessageKey } from "./i18n";
import type { StatusReasonCode } from "./connection-status";
import {
  ONLY_ADMIN_MESSAGE,
  summariseOutcomes,
  type HealthRow,
  type RetryOutcomeCode,
  type RetryResult,
} from "./integration-health";

export type Described = { key: MessageKey; values: Record<string, string | number> };

export { ONLY_ADMIN_MESSAGE };

/** How a time is written on this screen; the screen passes its language's formatter. */
export type Format = { time: (iso: string) => string };

const REASON: Partial<Record<StatusReasonCode, MessageKey>> = {
  not_verified: "healthReportDialog.reasonNotVerified",
  refresh_failed: "healthReportDialog.reasonRefreshFailed",
  evidence_unavailable: "healthReportDialog.reasonEvidenceUnavailable",
  evidence_unreadable: "healthReportDialog.reasonEvidenceUnreadable",
  scopes_unknown: "healthReportDialog.reasonScopesUnknown",
  scopes_missing: "healthReportDialog.reasonScopesMissing",
  connected: "healthReportDialog.reasonConnected",
  verified_not_synced: "healthReportDialog.reasonVerifiedNotSynced",
  disconnected: "healthReportDialog.reasonDisconnected",
  provider_unavailable: "healthReportDialog.reasonProviderUnavailable",
  unidentified: "healthReportDialog.reasonUnidentified",
};

const FIX: Partial<Record<StatusReasonCode, MessageKey>> = {
  not_verified: "healthReportDialog.fixNotVerified",
  refresh_failed: "healthReportDialog.fixReconnect",
  evidence_unavailable: "healthReportDialog.fixEvidenceUnavailable",
  evidence_unreadable: "healthReportDialog.fixEvidenceUnreadable",
  scopes_unknown: "healthReportDialog.fixKeepPermissions",
  scopes_missing: "healthReportDialog.fixKeepPermissions",
  verified_not_synced: "healthReportDialog.fixVerifiedNotSynced",
  disconnected: "healthReportDialog.fixDisconnected",
  provider_unavailable: "healthReportDialog.fixProviderUnavailable",
  unidentified: "healthReportDialog.fixUnidentified",
};

type RowFacts = Pick<
  HealthRow,
  "platform" | "platform_name" | "reason_code" | "reason_params" | "state" | "action"
>;

function blanks(row: RowFacts, format: Format): Record<string, string | number> {
  const p = row.reason_params;
  return {
    Platform: row.platform_name,
    verified: p.verified ? format.time(p.verified) : "",
    synced: p.synced ? format.time(p.synced) : "",
    time: p.retry_at ? format.time(p.retry_at) : "",
    features: (p.missing ?? []).join(", "),
  };
}

/** The sentence that says why an account is in the state it is in, or null to use the server's English. */
export function describeReason(row: RowFacts, format: Format): Described | null {
  const key = REASON[row.reason_code];
  return key ? { key, values: blanks(row, format) } : null;
}

/** The sentence that says what to do about it, or null. */
export function describeFix(row: RowFacts, format: Format): Described | null {
  const key = FIX[row.reason_code];
  if (!key) return null;
  // With a time to try again, say so; without one, say "in a few minutes".
  if (row.reason_code === "provider_unavailable" && !row.reason_params.retry_at) {
    return { key: "healthReportDialog.fixProviderUnavailableSoon", values: {} };
  }
  return { key, values: blanks(row, format) };
}

/** What a connected account's check does not prove, or null when it does not apply. */
export function describeNotProven(row: RowFacts & { not_proven: string[] }): Described | null {
  if (row.state !== "connected" || row.not_proven.length === 0) return null;
  return {
    key: "healthReportDialog.connectedNotProven",
    values: { Platform: row.platform_name, features: row.not_proven.join(", ") },
  };
}

/** The label of the status badge, in words for the states that are new. */
export function describeLabel(row: RowFacts): MessageKey | null {
  if (row.reason_code === "disconnected") return "healthReportDialog.labelDisconnected";
  if (row.state === "unverified") return "healthReportDialog.labelUnverified";
  if (row.state === "provider_unavailable") return "healthReportDialog.labelProviderUnavailable";
  return null;
}

/** "Facebook" for every Meta product and "Google" for every Google one, as on the Connect cards. */
export function signInName(platform: string): string {
  const meta = connector(platform);
  if (meta?.provider === "meta") return "Facebook";
  if (meta?.provider === "google") return "Google";
  return meta?.name ?? platform;
}

/** The one button of a row, or null when there is nothing to press. */
export function describeAction(row: RowFacts): Described | null {
  switch (row.action) {
    case "connect":
      return {
        key: "healthReportDialog.continueWith",
        values: { Platform: signInName(row.platform) },
      };
    case "choose_account":
      return { key: "healthReportDialog.chooseAccount", values: {} };
    case "verify":
      return { key: "healthReportDialog.verifyNow", values: {} };
    case "reconnect":
      return { key: "healthReportDialog.reconnect", values: {} };
    case "retry":
      return { key: "healthReportDialog.retryNow", values: {} };
    case "coming_soon":
      return { key: "healthReportDialog.comingSoon", values: {} };
    case "none":
      return null;
  }
}

/** What happened to one account when it was checked, as sentences to print one after the other. */
export function describeResult(result: RetryResult, format: Format): Described[] {
  const Platform = connector(result.platform)?.name ?? result.platform;
  const id = result.correlation_id ?? "";
  const time = result.params?.retry_at ? format.time(result.params.retry_at) : "";
  switch (result.outcome) {
    case "healthy":
    case "recovered":
    case "refreshed":
      return [{ key: "healthReportDialog.outcomeVerified", values: { Platform } }];
    case "scopes_missing":
      return [
        {
          key: "healthReportDialog.outcomeScopesMissing",
          values: { Platform, permissions: (result.params?.permissions ?? []).join(", ") },
        },
      ];
    case "scopes_unknown":
      return [
        { key: "healthReportDialog.reasonScopesUnknown", values: { Platform } },
        { key: "healthReportDialog.fixKeepPermissions", values: {} },
      ];
    case "provider_unavailable":
      return [
        result.http_status
          ? {
              key: "healthReportDialog.outcomeUnavailableStatus",
              values: { Platform, status: result.http_status, time },
            }
          : { key: "healthReportDialog.outcomeUnavailable", values: { Platform, time } },
      ];
    case "rate_limited":
      return [{ key: "healthReportDialog.outcomeRateLimited", values: { Platform } }];
    case "needs_reconnect":
      return [{ key: "healthReportDialog.outcomeNeedsReconnect", values: { Platform } }];
    case "forbidden":
      return [{ key: "healthReportDialog.outcomeForbidden", values: { Platform } }];
    case "not_checkable":
      return [{ key: "healthReportDialog.outcomeNotCheckable", values: { Platform } }];
    case "save_failed":
      return [{ key: "healthReportDialog.outcomeSaveFailed", values: { id } }];
    case "evidence_unavailable":
      return [{ key: "healthReportDialog.outcomeEvidenceUnavailable", values: { Platform, id } }];
    case "skipped_disconnected":
      return [{ key: "healthReportDialog.outcomeSkippedDisconnected", values: {} }];
    case "no_sign_in":
      return [{ key: "healthReportDialog.outcomeNoSignIn", values: {} }];
    case "in_progress":
      return [{ key: "healthReportDialog.outcomeInProgress", values: {} }];
    case "recently_checked":
      return [{ key: "healthReportDialog.outcomeRecentlyChecked", values: {} }];
    case "waiting_to_retry":
      return [{ key: "healthReportDialog.outcomeWaiting", values: { Platform, time } }];
    case "changed_while_checking":
      return [{ key: "healthReportDialog.outcomeChanged", values: {} }];
    case "reconnect_needed":
      return [{ key: "healthReportDialog.outcomeReconnectNeeded", values: {} }];
    case "not_identified":
      return [
        { key: "healthReportDialog.reasonUnidentified", values: {} },
        { key: "healthReportDialog.fixUnidentified", values: {} },
      ];
    case "not_found":
      return [{ key: "healthReportDialog.outcomeNotFound", values: {} }];
    case "failed":
      return [{ key: "healthReportDialog.outcomeFailed", values: { id } }];
  }
}

export type CheckToast = {
  /** success = verified, warning = something needs attention, info = nothing was asked of a platform */
  kind: "success" | "warning" | "info";
  parts: Described[];
};

/**
 * What to tell the person after pressing a check. One account: what happened to it. Several: how many
 * were verified, how many need attention and how many were not checked. Nothing at all to check:
 * exactly that -- never "every connection is healthy", which nothing here has established.
 */
export function describeChecks(results: readonly RetryResult[], format: Format): CheckToast {
  if (results.length === 0) {
    return { kind: "info", parts: [{ key: "healthReportDialog.nothingNeededCheck", values: {} }] };
  }
  const summary = summariseOutcomes(results);
  if (results.length === 1 && results[0]) {
    return {
      kind: summary.verified === 1 ? "success" : summary.attention === 1 ? "warning" : "info",
      parts: describeResult(results[0], format),
    };
  }
  return {
    kind: summary.attention > 0 ? "warning" : summary.verified > 0 ? "success" : "info",
    parts: [
      {
        key: "healthReportDialog.checkedSummary",
        values: {
          n: summary.checked,
          verified: summary.verified,
          attention: summary.attention,
          skipped: summary.skipped,
        },
      },
    ],
  };
}

/** Every outcome code, for the test that proves each one has a sentence. */
export const ALL_OUTCOMES: readonly RetryOutcomeCode[] = [
  "healthy",
  "recovered",
  "refreshed",
  "scopes_missing",
  "scopes_unknown",
  "provider_unavailable",
  "rate_limited",
  "forbidden",
  "needs_reconnect",
  "not_checkable",
  "save_failed",
  "evidence_unavailable",
  "skipped_disconnected",
  "no_sign_in",
  "not_identified",
  "reconnect_needed",
  "in_progress",
  "recently_checked",
  "waiting_to_retry",
  "changed_while_checking",
  "not_found",
  "failed",
];
