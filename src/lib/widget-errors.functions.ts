import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const WidgetErrorSchema = z.object({
  widget: z.string().max(80),
  endpoint: z.string().max(120),
  message: z.string().max(500),
  stack: z.string().max(2000).optional(),
});

/**
 * Lightweight widget error logger. The browser reports which dashboard widget
 * failed and why; we echo it to the server log (visible in function logs) and
 * persist it to the audit log so the manager portal can review failures.
 * Never throws back at the caller — logging must not break the dashboard.
 */
export const reportWidgetError = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => WidgetErrorSchema.parse(input))
  .handler(async ({ data, context }) => {
    try {
      console.error(
        `[widget-error] widget=${data.widget} endpoint=${data.endpoint} message=${data.message}`,
        data.stack ?? "",
      );
      const { logAudit } = await import("@/lib/audit.server");
      const { data: profile } = await context.supabase
        .from("profiles")
        .select("tenant_id, email, full_name")
        .eq("id", context.userId)
        .maybeSingle();
      await logAudit({
        action: "widget.error",
        tenantId: profile?.tenant_id ?? null,
        actorId: context.userId,
        actorLabel: profile?.full_name ?? profile?.email ?? null,
        entityType: "dashboard_widget",
        entityId: data.widget,
        details: {
          endpoint: data.endpoint,
          message: data.message,
          ...(data.stack ? { stack: data.stack } : {}),
        },
      });
    } catch (error) {
      console.error("[widget-error] failed to record", error);
    }
    return { ok: true };
  });
