// Server-only KPI engine: measures the metrics the Business Advisor cares about
// (response time, conversion, lead velocity, read rate, social backlog) against
// the targets a workspace has set, and raises alerts when a target is missed.
import type { SupabaseClient } from "@supabase/supabase-js";
import { gatherMessagingAnalytics } from "./flash-ai.server";
import { getDashboardOverviewData } from "./dashboard.server";

export type KpiMetricKey =
  | "response_minutes"
  | "read_rate"
  | "conversion_rate"
  | "lead_velocity"
  | "social_pending"
  | "unread_backlog";

export type KpiDefinition = {
  metric: KpiMetricKey;
  label: string;
  unit: string;
  direction: "higher" | "lower";
  hint: string;
};

export const KPI_DEFINITIONS: KpiDefinition[] = [
  {
    metric: "response_minutes",
    label: "First response time",
    unit: "min",
    direction: "lower",
    hint: "Average minutes before a human or bot answers a new inbound chat (30 days).",
  },
  {
    metric: "read_rate",
    label: "Read rate",
    unit: "%",
    direction: "higher",
    hint: "Share of outbound WhatsApp messages that were read (30 days).",
  },
  {
    metric: "conversion_rate",
    label: "Lead conversion",
    unit: "%",
    direction: "higher",
    hint: "Share of contacts that reached the Won stage.",
  },
  {
    metric: "lead_velocity",
    label: "Lead velocity",
    unit: "leads/week",
    direction: "higher",
    hint: "New leads captured in the last 7 days.",
  },
  {
    metric: "social_pending",
    label: "Social replies waiting",
    unit: "items",
    direction: "lower",
    hint: "Comments and DMs still open across connected social accounts.",
  },
  {
    metric: "unread_backlog",
    label: "Unread chats",
    unit: "chats",
    direction: "lower",
    hint: "Conversations with unread inbound messages right now.",
  },
];

export type KpiMeasurement = KpiDefinition & { value: number | null };

/** Measures every supported KPI from live tenant data. */
export async function measureKpis(supabase: SupabaseClient): Promise<KpiMeasurement[]> {
  const [overview, messaging, contacts, leads] = await Promise.all([
    getDashboardOverviewData(supabase).catch(() => null),
    gatherMessagingAnalytics(supabase as never, 30).catch(() => null),
    supabase
      .from("contacts")
      .select("id, stage")
      .limit(5000)
      .then((r) => r.data ?? []),
    supabase
      .from("leads")
      .select("id, created_at")
      .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .limit(5000)
      .then((r) => r.data ?? []),
  ]);

  const outbound = messaging?.totals.outbound ?? 0;
  const readRate = outbound > 0 ? Math.round(((messaging?.totals.read ?? 0) / outbound) * 100) : null;

  const contactRows = contacts as Array<{ stage: string }>;
  const won = contactRows.filter((c) => c.stage === "won").length;
  const conversion = contactRows.length > 0 ? Math.round((won / contactRows.length) * 100) : null;

  const values: Record<KpiMetricKey, number | null> = {
    response_minutes: messaging?.avgFirstResponseMinutes ?? null,
    read_rate: readRate,
    conversion_rate: conversion,
    lead_velocity: leads.length,
    social_pending: overview?.social.pendingTotal ?? null,
    unread_backlog: overview?.stats.unread ?? null,
  };

  return KPI_DEFINITIONS.map((d) => ({ ...d, value: values[d.metric] }));
}

export type KpiTargetRow = {
  id: string;
  metric: string;
  label: string;
  target_value: number;
  unit: string;
  direction: string;
  source: string;
  note: string | null;
  active: boolean;
  last_value: number | null;
  last_checked_at: string | null;
};

export type KpiStatus = {
  target: KpiTargetRow;
  value: number | null;
  missed: boolean;
  /** How far off target, in the metric's unit (0 when on target). */
  gap: number;
  hint: string;
};

function missedTarget(direction: string, value: number, target: number): boolean {
  return direction === "lower" ? value > target : value < target;
}

/**
 * Compares live measurements to the workspace's targets, records the reading on
 * each target and opens an alert for any newly missed target (deduped for 12h).
 */
export async function evaluateKpiTargets(supabase: SupabaseClient): Promise<{
  statuses: KpiStatus[];
  newAlerts: number;
}> {
  const [{ data: targets }, measurements] = await Promise.all([
    supabase
      .from("kpi_targets")
      .select(
        "id, metric, label, target_value, unit, direction, source, note, active, last_value, last_checked_at",
      )
      .eq("active", true),
    measureKpis(supabase),
  ]);

  const rows = (targets ?? []) as unknown as KpiTargetRow[];
  if (rows.length === 0) return { statuses: [], newAlerts: 0 };

  const byMetric = new Map(measurements.map((m) => [m.metric as string, m]));
  const since = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  const { data: recentAlerts } = await supabase
    .from("kpi_alerts")
    .select("metric, created_at, resolved")
    .gte("created_at", since);
  const alerted = new Set(
    ((recentAlerts ?? []) as Array<{ metric: string; resolved: boolean }>)
      .filter((a) => !a.resolved)
      .map((a) => a.metric),
  );

  const statuses: KpiStatus[] = [];
  const alertsToInsert: Array<Record<string, unknown>> = [];
  const nowIso = new Date().toISOString();

  for (const target of rows) {
    const measurement = byMetric.get(target.metric);
    const value = measurement?.value ?? null;
    const numericTarget = Number(target.target_value);
    const missed = value != null && missedTarget(target.direction, value, numericTarget);
    const gap = missed && value != null ? Math.abs(Math.round((value - numericTarget) * 10) / 10) : 0;

    statuses.push({
      target,
      value,
      missed,
      gap,
      hint: measurement?.hint ?? "",
    });

    await supabase
      .from("kpi_targets")
      .update({ last_value: value, last_checked_at: nowIso })
      .eq("id", target.id);

    if (missed && value != null && !alerted.has(target.metric)) {
      const worseBy = numericTarget === 0 ? 100 : (gap / Math.abs(numericTarget)) * 100;
      alertsToInsert.push({
        target_id: target.id,
        metric: target.metric,
        label: target.label,
        value,
        target_value: numericTarget,
        severity: worseBy >= 40 ? "critical" : "warning",
        message:
          `${target.label} is ${value}${target.unit} vs a target of ` +
          `${numericTarget}${target.unit} (${target.direction === "lower" ? "over" : "under"} by ${gap}${target.unit}).`,
      });
    }
  }

  if (alertsToInsert.length > 0) {
    await supabase.from("kpi_alerts").insert(alertsToInsert as never);
  }

  return { statuses, newAlerts: alertsToInsert.length };
}
