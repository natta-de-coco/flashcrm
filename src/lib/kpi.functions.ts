import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const METRICS = [
  "response_minutes",
  "read_rate",
  "conversion_rate",
  "lead_velocity",
  "social_pending",
  "unread_backlog",
] as const;

const SaveSchema = z.object({
  targets: z
    .array(
      z.object({
        metric: z.enum(METRICS),
        target_value: z.number().min(0).max(100000),
        note: z.string().max(300).nullable().default(null),
        active: z.boolean().default(true),
      }),
    )
    .min(1)
    .max(12),
  source: z.enum(["manual", "advisor"]).default("manual"),
});

/** Live KPI readings, the saved targets and the open alerts for this workspace. */
export const getKpiOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { KPI_DEFINITIONS, measureKpis } = await import("@/lib/kpi.server");
    const [measurements, targets, alerts] = await Promise.all([
      measureKpis(context.supabase),
      context.supabase
        .from("kpi_targets")
        .select(
          "id, metric, label, target_value, unit, direction, source, note, active, last_value, last_checked_at",
        ),
      context.supabase
        .from("kpi_alerts")
        .select("id, metric, label, value, target_value, severity, message, resolved, created_at")
        .order("created_at", { ascending: false })
        .limit(30),
    ]);

    return {
      definitions: KPI_DEFINITIONS,
      measurements,
      targets: targets.data ?? [],
      alerts: alerts.data ?? [],
    };
  });

/** Saves or updates targets (used by the manual editor and the advisor import). */
export const saveKpiTargets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SaveSchema.parse(input))
  .handler(async ({ context, data }) => {
    const { KPI_DEFINITIONS } = await import("@/lib/kpi.server");
    const { data: tenantId } = await context.supabase.rpc("current_tenant_id");
    if (!tenantId) throw new Error("No workspace found for this account.");

    const rows = data.targets.map((t) => {
      const def = KPI_DEFINITIONS.find((d) => d.metric === t.metric)!;
      return {
        tenant_id: tenantId as string,
        metric: t.metric,
        label: def.label,
        unit: def.unit,
        direction: def.direction,
        target_value: t.target_value,
        note: t.note,
        active: t.active,
        source: data.source,
      };
    });

    const { error } = await context.supabase
      .from("kpi_targets")
      .upsert(rows as never, { onConflict: "tenant_id,metric" });
    if (error) throw new Error(error.message);

    const { logAudit } = await import("@/lib/audit.server");
    await logAudit({
      action: "kpi.targets_saved",
      actorId: context.userId,
      entityType: "kpi_target",
      details: { count: rows.length, source: data.source },
    });

    return { ok: true, saved: rows.length };
  });

export const deleteKpiTarget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("kpi_targets").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Measures every target now and opens alerts for the missed ones. */
export const runKpiCheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { evaluateKpiTargets } = await import("@/lib/kpi.server");
    const result = await evaluateKpiTargets(context.supabase);

    if (result.newAlerts > 0) {
      const { logAudit } = await import("@/lib/audit.server");
      await logAudit({
        action: "kpi.alerts_raised",
        actorId: context.userId,
        entityType: "kpi_alert",
        details: { count: result.newAlerts },
      });
    }
    return {
      statuses: result.statuses,
      newAlerts: result.newAlerts,
      checkedAt: new Date().toISOString(),
    };
  });

export const resolveKpiAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("kpi_alerts")
      .update({ resolved: true })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Asks the advisor to turn its live view of the business into concrete numeric
 * targets for the metrics Flas can actually measure, then saves them.
 */
export const generateKpiTargetsFromAdvisor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { proposeKpiTargets } = await import("@/lib/advisor.server");
    const proposals = await proposeKpiTargets(context.supabase);

    const { data: tenantId } = await context.supabase.rpc("current_tenant_id");
    if (!tenantId) throw new Error("No workspace found for this account.");

    const { KPI_DEFINITIONS } = await import("@/lib/kpi.server");
    const rows = proposals.map((p) => {
      const def = KPI_DEFINITIONS.find((d) => d.metric === p.metric)!;
      return {
        tenant_id: tenantId as string,
        metric: p.metric,
        label: def.label,
        unit: def.unit,
        direction: def.direction,
        target_value: p.target_value,
        note: p.rationale,
        active: true,
        source: "advisor",
      };
    });

    if (rows.length > 0) {
      const { error } = await context.supabase
        .from("kpi_targets")
        .upsert(rows as never, { onConflict: "tenant_id,metric" });
      if (error) throw new Error(error.message);
    }

    return { proposals, saved: rows.length };
  });
