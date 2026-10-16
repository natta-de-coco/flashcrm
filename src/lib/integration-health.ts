/// Browser-safe model + exporters for the Integration Health Report. One row per connected
// account (and one per platform that has none): current status, last error, permissions we still
// need and the exact next step, so a company can hand the report to whoever owns the platform
// account.

import { connector, CONNECTORS } from "./connections-catalog";
import type {
  ConnectionState,
  EvidenceState,
  NextAction,
  StatusParams,
  StatusReasonCode,
} from "./connection-status";

/**
 * What the last check of an account found, for the people who fix things. Sent only to Flas
 * staff (a super admin): a company's own people never receive it, because it names permissions
 * and provider answers that mean nothing to them and are not theirs to act on.
 */
export type HealthDiagnostics = {
  /** Where the last check stopped: gate, probe, refresh, save, done. */
  stage: string | null;
  /** What the platform answered, when it answered. */
  http_status: number | null;
  /** The short reference of that check. It holds no workspace, account or platform text. */
  correlation_id: string | null;
  last_attempt_at: string | null;
  /** Whether verification results can be saved in this workspace. */
  evidence_storage: "ready" | "missing";
  /** The permissions the platform granted and the ones it did not, by their technical names. */
  scopes_granted: string[];
  scopes_missing: string[];
  /** What the platform said, with anything token-shaped removed. */
  provider_message: string | null;
};

export type HealthRow = {
  platform: string;
  platform_name: string;
  group: string;
  /** The account this row is about. Null for a platform nobody has connected. */
  account_id: string | null;
  account_label: string | null;
  state: ConnectionState;
  state_label: string;
  reason: string;
  /** Which sentence `reason` is, so a screen can translate it. */
  reason_code: StatusReasonCode;
  reason_params: StatusParams;
  fix: string;
  /** The one thing to do next, as a fixed code: the screen shows one button for it. */
  action: NextAction;
  last_error: string | null;
  last_error_at: string | null;
  last_synced_at: string | null;
  /** The last time the platform accepted this account's token in a live check. */
  last_verified_at: string | null;
  token_expires_at: string | null;
  /** Technical names: Flas staff only; empty for everyone else. */
  granted_permissions: string[];
  /** The features the platform did not grant, in plain words ("Read DMs"). */
  missing_permissions: string[];
  /** Features a live token check cannot prove: they depend on the platform's app review. */
  not_proven: string[];
  retry_count: number;
  next_retry_at: string | null;
  next_step: string;
  evidence_state: EvidenceState;
  /** Flas staff only; null for everyone else. */
  diagnostics: HealthDiagnostics | null;
};

export type HealthReport = {
  organization: string;
  generated_at: string;
  totals: Record<ConnectionState, number>;
  connected: number;
  /** Every row that is neither connected nor not connected -- the rows the dialog lists. */
  needs_attention: number;
  not_connected: number;
  rows: HealthRow[];
  /** Encryption at rest for this workspace's stored credentials. Counts only. */
  credentials: { configured: boolean; plaintext: number; sealed: number };
  retries: {
    id: string;
    platform: string;
    outcome: string;
    reason: string | null;
    trigger: string;
    created_at: string;
  }[];
};

/** Rows that need a person to look at them: not connected, and not deliberately left alone. */
export function needsAttention(state: ConnectionState): boolean {
  return state !== "connected" && state !== "not_connected";
}

/**
 * What one check of one account concluded. The first three are the only "verified" outcomes:
 * the platform answered, accepted the token, and the result was saved.
 */
export type RetryOutcomeCode =
  | "healthy"
  | "recovered"
  | "refreshed"
  | "scopes_missing"
  | "scopes_unknown"
  | "provider_unavailable"
  | "rate_limited"
  | "forbidden"
  | "needs_reconnect"
  | "not_checkable"
  | "save_failed"
  | "evidence_unavailable"
  | "skipped_disconnected"
  | "not_identified"
  | "reconnect_needed"
  | "in_progress"
  | "recently_checked"
  | "not_found"
  | "failed";

/** What a check returns. Everything past `reason` is new; older callers read only the first three. */
export type RetryResult = {
  platform: string;
  outcome: RetryOutcomeCode;
  /** English, with anything token-shaped removed. */
  reason: string;
  account_id?: string;
  /** Where the check stopped. */
  stage?: string;
  /** The status the account has now, built from the saved row. */
  status?: {
    state: ConnectionState;
    label: string;
    code: StatusReasonCode;
    params: StatusParams;
    reason: string;
    fix: string;
    action: NextAction;
  };
  saved_at?: string | null;
  /** Short reference of this check; quote it to support. */
  correlation_id?: string;
  http_status?: number | null;
  /** False when the retry log entry could not be written. Never makes a check fail. */
  log_saved?: boolean;
  /** Values the screen needs to fill the sentence for this outcome. */
  params?: { permissions?: string[]; retry_at?: string | null };
};

/**
 * The English sentence for one outcome. It is what gets stored and exported; the screens
 * translate by outcome code and fill the same blanks, so the two always say the same thing.
 * `platform` is the platform's display name. None of these promise an automatic check: nothing
 * scheduled runs one.
 */
export function describeOutcome(
  outcome: RetryOutcomeCode,
  p: {
    platform: string;
    httpStatus?: number | null | undefined;
    features?: string[] | undefined;
    retryAt?: string | null | undefined;
    reference?: string | undefined;
  },
): string {
  const at = p.retryAt ? new Date(p.retryAt).toLocaleString() : "a few minutes from now";
  const ref = p.reference ?? "";
  switch (outcome) {
    case "healthy":
    case "recovered":
    case "refreshed":
      return `Verified. ${p.platform} accepted the token and Flas saved the result.`;
    case "scopes_missing":
      return `The token works, but ${p.platform} did not grant: ${(p.features ?? []).join(", ")}. Reconnect and keep every permission switched on.`;
    case "scopes_unknown":
      return `${p.platform} accepts the token but did not list its permissions, so Flas cannot confirm them. Reconnect and keep every permission switched on.`;
    case "provider_unavailable":
      return p.httpStatus
        ? `${p.platform} did not answer (HTTP ${p.httpStatus}). Nothing was changed and the account was not marked verified. Try again after ${at}.`
        : `${p.platform} did not answer. Nothing was changed and the account was not marked verified. Try again after ${at}.`;
    case "rate_limited":
      return `${p.platform} is limiting requests right now. Nothing was changed. Try again in a few minutes.`;
    case "needs_reconnect":
      return `${p.platform} no longer accepts this token. Reconnect the account.`;
    case "forbidden":
      return `${p.platform} refused the check (HTTP 403). A permission is probably missing. Reconnect and keep every permission switched on.`;
    case "not_checkable":
      return `Flas has no live check for ${p.platform} yet, so it cannot verify this account.`;
    case "save_failed":
      return `The check ran, but Flas could not save the result, so nothing was marked verified. Reference ${ref}.`;
    case "evidence_unavailable":
      return `${p.platform} accepted the token, but this workspace cannot store verification results yet. Reference ${ref}.`;
    case "skipped_disconnected":
      return "This account was disconnected on purpose. Connect it again to use it.";
    case "in_progress":
      return "Another check for this account is already running. Try again in a minute.";
    case "recently_checked":
      return "Checked a moment ago. Showing the saved result.";
    case "reconnect_needed":
      return "This account was added with a pasted token. Reconnect it so Flas can verify it.";
    case "not_identified":
      return "This sign-in is saved, but no account was chosen yet. Choose which account to connect.";
    case "not_found":
      return "That account was not found in this workspace.";
    case "failed":
      return ref
        ? `The check could not finish, so nothing was changed. Reference ${ref}.`
        : "The check could not finish, so nothing was changed.";
  }
}

const VERIFIED_OUTCOMES: readonly RetryOutcomeCode[] = ["healthy", "recovered", "refreshed"];
/** Outcomes where nothing was asked of the platform, so there is nothing to say went wrong. */
const NOT_CHECKED_OUTCOMES: readonly RetryOutcomeCode[] = [
  "not_checkable",
  "skipped_disconnected",
  "not_identified",
  "reconnect_needed",
  "in_progress",
  "recently_checked",
  "not_found",
];

export function isVerifiedOutcome(outcome: RetryOutcomeCode): boolean {
  return VERIFIED_OUTCOMES.includes(outcome);
}

/** One line of truth for a batch of checks: how many passed, how many need attention, how many were not checked. */
export function summariseOutcomes(results: ReadonlyArray<Pick<RetryResult, "outcome">>): {
  checked: number;
  verified: number;
  attention: number;
  skipped: number;
} {
  let verified = 0;
  let skipped = 0;
  for (const r of results) {
    if (isVerifiedOutcome(r.outcome)) verified += 1;
    else if (NOT_CHECKED_OUTCOMES.includes(r.outcome)) skipped += 1;
  }
  return {
    checked: results.length,
    verified,
    skipped,
    attention: results.length - verified - skipped,
  };
}

export const ALL_PLATFORM_IDS = CONNECTORS.map((c) => c.id);

export function platformName(id: string): string {
  return connector(id)?.name ?? id.replace(/_/g, " ");
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : Array.isArray(value) ? value.join(" | ") : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function healthReportCsv(report: HealthReport): string {
  const header = [
    "Platform",
    "Account",
    "Status",
    "Reason",
    "Recommended fix",
    "Last error",
    "Last error at",
    "Last verified",
    "Last synced",
    "Token expires",
    "Granted permissions",
    "Missing permissions",
    "Not proven by this check",
    "Retries",
    "Next retry",
    "Next step",
  ];
  const lines = [header.map(csvCell).join(",")];
  for (const row of report.rows) {
    lines.push(
      [
        row.platform_name,
        row.account_label,
        row.state_label,
        row.reason,
        row.fix,
        row.last_error,
        row.last_error_at,
        row.last_verified_at,
        row.last_synced_at,
        row.token_expires_at,
        row.granted_permissions,
        row.missing_permissions,
        row.not_proven,
        row.retry_count,
        row.next_retry_at,
        row.next_step,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n");
}

export function downloadHealthReportCsv(report: HealthReport) {
  const blob = new Blob([healthReportCsv(report)], { type: "text/csv;charset=utf-8" });
  triggerDownload(blob, `integration-health-${stamp(report)}.csv`);
}

function stamp(report: HealthReport): string {
  return report.generated_at.slice(0, 10);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const MARGIN = 40;
const BRAND: [number, number, number] = [16, 94, 62];

export async function downloadHealthReportPdf(report: HealthReport): Promise<void> {
  // Loaded on click, not with the page: jsPDF and its html2canvas dependency
  // are ~600 kB, and almost every visit never exports a PDF.
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const maxWidth = pageWidth - MARGIN * 2;
  let y = MARGIN;

  const space = (needed: number) => {
    if (y + needed > pageHeight - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }
  };

  const text = (value: string, size: number, style: "normal" | "bold" = "normal") => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(40);
    const lines = doc.splitTextToSize(value, maxWidth) as string[];
    space(lines.length * (size + 3));
    doc.text(lines, MARGIN, y);
    y += lines.length * (size + 3);
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(BRAND[0], BRAND[1], BRAND[2]);
  doc.text("Integration Health Report", MARGIN, y);
  y += 22;
  text(`${report.organization} — generated ${new Date(report.generated_at).toLocaleString()}`, 10);
  y += 6;
  text(
    `${report.connected} connected · ${report.needs_attention} need attention · ${report.not_connected} not connected`,
    11,
    "bold",
  );
  y += 10;

  for (const row of report.rows) {
    space(90);
    doc.setDrawColor(225);
    doc.line(MARGIN, y, pageWidth - MARGIN, y);
    y += 14;
    text(`${row.platform_name} — ${row.state_label}`, 12, "bold");
    if (row.account_label) text(`Account: ${row.account_label}`, 9);
    text(`Status: ${row.reason}`, 9);
    text(`Fix: ${row.fix}`, 9);
    if (row.last_error) text(`Last error: ${row.last_error}`, 9);
    if (row.missing_permissions.length) {
      text(`Missing permissions: ${row.missing_permissions.join(", ")}`, 9);
    }
    if (row.last_verified_at && row.not_proven.length) {
      text(`Not proven by this check: ${row.not_proven.join(", ")}`, 9);
    }
    text(`Next step: ${row.next_step}`, 9);
    y += 6;
  }

  if (report.retries.length) {
    space(60);
    y += 10;
    text("Recent automatic retries", 12, "bold");
    for (const r of report.retries.slice(0, 12)) {
      text(
        `${new Date(r.created_at).toLocaleString()} · ${platformName(r.platform)} · ${r.outcome}${
          r.reason ? ` — ${r.reason}` : ""
        }`,
        9,
      );
    }
  }

  doc.save(`integration-health-${stamp(report)}.pdf`);
}
