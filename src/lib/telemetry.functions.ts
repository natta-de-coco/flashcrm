// Server functions for the Flas error monitor. Reporting is intentionally open
// (the browser must be able to report a crash even when the session is gone),
// but reading incidents is strictly scoped: a company sees only its own, and
// the platform owner sees everything.
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";

const ReportSchema = z.object({
  kind: z.string().max(40).default("frontend"),
  severity: z.enum(["error", "warning", "info"]).default("error"),
  message: z.string().min(1).max(2000),
  stack: z.string().max(8000).optional(),
  route: z.string().max(400).optional(),
  url: z.string().max(1000).optional(),
  userAgent: z.string().max(400).optional(),
  sessionId: z.string().max(120).optional(),
  context: z.record(z.string(), z.unknown()).default({}),
});

export const reportErrorEvent = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => ReportSchema.parse(input))
  .handler(async ({ data }) => {
    const { recordErrorEvent, identifyBearer } = await import("@/lib/telemetry.server");
    const who = await identifyBearer(getRequestHeader("authorization"));
    await recordErrorEvent({
      kind: data.kind,
      severity: data.severity,
      message: data.message,
      stack: data.stack ?? null,
      route: data.route ?? null,
      url: data.url ?? null,
      userAgent: data.userAgent ?? null,
      sessionId: data.sessionId ?? null,
      tenantId: who.tenantId,
      userId: who.userId,
      userEmail: who.email,
      context: data.context,
    });
    return { ok: true };
  });

/** Incidents for the signed-in company (RLS keeps this tenant-scoped). */
export const getErrorEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("error_events")
      .select(
        "id, kind, severity, message, route, url, session_id, user_email, created_at, context, stack",
      )
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    const rows = data ?? [];
    const byKind: Record<string, number> = {};
    for (const row of rows) byKind[row.kind] = (byKind[row.kind] ?? 0) + 1;
    return { events: rows, byKind, total: rows.length };
  });
