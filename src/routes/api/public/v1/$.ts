import { createFileRoute } from "@tanstack/react-router";

const SAFE_COLUMNS: Record<string, string> = {
  leads: "id, name, email, phone, source, status, lead_score, tags, subscribed, consent_given, consent_at, created_at",
  contacts:
    "id, name, phone, email, company, tags, stage, value, consent_given, consent_at, last_message_at, created_at",
  conversations:
    "id, contact_id, channel, status, unread_count, last_message_at, last_message_preview, tags, created_at",
  numbers: "id, label, display_phone, phone_number_id, is_default, active, created_at",
};

const SCOPE_FOR: Record<string, string> = {
  leads: "leads:read",
  contacts: "contacts:read",
  conversations: "conversations:read",
  numbers: "numbers:read",
};

const TABLE_FOR: Record<string, string> = {
  leads: "leads",
  contacts: "contacts",
  conversations: "conversations",
  numbers: "wa_numbers",
};

/**
 * External tenant API. Companies call this with their own API key and only
 * ever see their own workspace's data. Example:
 *   GET /api/public/v1/leads   Authorization: Bearer flas_...
 */
export const Route = createFileRoute("/api/public/v1/$")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const resource = (params._splat ?? "").replace(/\/+$/, "");
        const scope = SCOPE_FOR[resource];
        if (!scope) {
          return Response.json(
            { error: "Unknown resource. Try leads, contacts, conversations or numbers." },
            { status: 404 },
          );
        }

        const { authenticateApiKey } = await import("@/lib/api-keys.server");
        const auth = await authenticateApiKey(request);
        if (!auth) {
          return Response.json({ error: "Missing or revoked API key" }, { status: 401 });
        }
        if (!auth.scopes.includes(scope)) {
          return Response.json(
            { error: `This key does not have the "${scope}" permission` },
            { status: 403 },
          );
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { logAudit } = await import("@/lib/audit.server");

        const table = TABLE_FOR[resource];
        let query = supabaseAdmin
          .from(table as never)
          .select(SAFE_COLUMNS[resource])
          .order("created_at", { ascending: false })
          .limit(500);
        // numbers are workspace-wide (no tenant column yet); the rest are tenant-scoped
        if (table !== "wa_numbers") {
          query = auth.tenantId
            ? (query as { eq: (c: string, v: string) => typeof query }).eq("tenant_id", auth.tenantId)
            : (query as { is: (c: string, v: null) => typeof query }).is("tenant_id", null);
        }

        const { data, error } = await query;
        if (error) {
          console.error(`[v1] ${resource} query failed`, error);
          return Response.json({ error: "Query failed" }, { status: 500 });
        }

        await logAudit({
          action: "api.access",
          tenantId: auth.tenantId,
          actorLabel: `api-key:${auth.keyId}`,
          entityType: resource,
          details: { rows: (data as unknown[] | null)?.length ?? 0 },
        });

        return Response.json({ data });
      },
    },
  },
});
