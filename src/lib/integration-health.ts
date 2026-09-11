// Browser-safe model + exporters for the Integration Health Report. One row per
// supported platform: current status, last error, permissions we still need and
// the exact next retry step, so a company can hand the report to whoever owns
// the platform account.

import { jsPDF } from "jspdf";
import { connector, CONNECTORS } from "./connections-catalog";
import type { ConnectionState } from "./connection-status";

export type HealthRow = {
  platform: string;
  platform_name: string;
  group: string;
  account_label: string | null;
  state: ConnectionState;
  state_label: string;
  reason: string;
  fix: string;
  last_error: string | null;
  last_error_at: string | null;
  last_synced_at: string | null;
  token_expires_at: string | null;
  granted_permissions: string[];
  missing_permissions: string[];
  retry_count: number;
  next_retry_at: string | null;
  next_step: string;
};

export type HealthReport = {
  organization: string;
  generated_at: string;
  totals: Record<ConnectionState, number>;
  connected: number;
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
    "Last synced",
    "Token expires",
    "Granted permissions",
    "Missing permissions",
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
        row.last_synced_at,
        row.token_expires_at,
        row.granted_permissions,
        row.missing_permissions,
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

export function downloadHealthReportPdf(report: HealthReport) {
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
