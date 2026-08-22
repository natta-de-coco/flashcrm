import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Client-initiated audit events (exports/imports and inbox actions that happen
// through the browser client). Server-side events use logAudit directly.
const CLIENT_ACTIONS = [
  "contacts.export",
  "contacts.import",
  "conversations.export",
  "transcript.export",
  "conversation.assign",
  "conversation.tag",
  "conversation.status",
  "reminder.create",
] as const;

const EventSchema = z.object({
  action: z.enum(CLIENT_ACTIONS),
  entityType: z.string().max(60).optional(),
  entityId: z.string().max(120).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

/** Records a user action in the append-only audit log. */
export const recordAuditEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => EventSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { logAudit } = await import("@/lib/audit.server");
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("tenant_id, email, full_name")
      .eq("id", context.userId)
      .maybeSingle();

    await logAudit({
      action: data.action,
      tenantId: profile?.tenant_id ?? null,
      actorId: context.userId,
      actorLabel: profile?.full_name ?? profile?.email ?? null,
      entityType: data.entityType ?? null,
      entityId: data.entityId ?? null,
      details: data.details ?? {},
    });
    return { ok: true };
  });

/** Reads this workspace's audit log, newest first. */
export const listAuditLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ limit: z.number().int().min(1).max(500).default(200) }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("audit_log")
      .select("id, action, actor_label, entity_type, entity_id, details, created_at")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw error;
    return rows ?? [];
  });
