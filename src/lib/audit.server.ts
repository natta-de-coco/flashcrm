// Server-only, append-only compliance audit log.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";

export type AuditEntry = {
  action: string;
  tenantId?: string | null;
  actorId?: string | null;
  actorLabel?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  details?: Record<string, unknown>;
};

/**
 * Records a compliance event (consent capture, routing decision, number
 * assignment, import/export, message send…). Never throws — auditing must
 * not break the business action it records.
 */
export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    await supabaseAdmin.from("audit_log").insert({
      tenant_id: entry.tenantId ?? null,
      actor_id: entry.actorId ?? null,
      actor_label: entry.actorLabel ?? null,
      action: entry.action,
      entity_type: entry.entityType ?? null,
      entity_id: entry.entityId ?? null,
      details: (entry.details ?? {}) as unknown as Json,
    });
  } catch (error) {
    console.error("[audit] failed to record", entry.action, error);
  }
}
