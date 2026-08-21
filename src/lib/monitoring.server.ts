// Server-only helpers for webhook delivery monitoring, retries and alerts.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type WaWebhookBody = {
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: {
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
        messages?: Array<{
          id?: string;
          from?: string;
          type?: string;
          text?: { body?: string };
        }>;
        statuses?: Array<{
          id?: string;
          status?: string;
          errors?: Array<{ title?: string; message?: string }>;
        }>;
      };
    }>;
  }>;
};

/** Creates an alert, skipping duplicates of the same unresolved title within 10 minutes. */
export async function raiseAlert(args: {
  title: string;
  message?: string | null;
  severity?: "info" | "warning" | "critical";
  source?: string;
}) {
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: existing } = await supabaseAdmin
    .from("system_alerts")
    .select("id")
    .eq("title", args.title)
    .eq("resolved", false)
    .gte("created_at", since)
    .maybeSingle();
  if (existing) return;

  await supabaseAdmin.from("system_alerts").insert({
    title: args.title,
    message: args.message ?? null,
    severity: args.severity ?? "warning",
    source: args.source ?? "webhook",
  });
}

export async function logWebhookEvent(args: {
  source?: string;
  eventType: string;
  payload: unknown;
  waMessageId?: string | null;
}) {
  const { data } = await supabaseAdmin
    .from("webhook_events")
    .insert({
      source: args.source ?? "whatsapp",
      event_type: args.eventType,
      payload: (args.payload ?? {}) as never,
      wa_message_id: args.waMessageId ?? null,
      status: "received",
    })
    .select("id")
    .single();
  return data?.id ?? null;
}

export async function finishWebhookEvent(
  id: string | null,
  outcome: { ok: boolean; error?: string | null; durationMs?: number; retry?: boolean },
) {
  if (!id) return;
  await supabaseAdmin
    .from("webhook_events")
    .update({
      status: outcome.ok ? "processed" : "failed",
      error: outcome.error ?? null,
      processed_at: new Date().toISOString(),
      duration_ms: outcome.durationMs ?? null,
      ...(outcome.retry ? { last_retry_at: new Date().toISOString() } : {}),
    })
    .eq("id", id);
}

/**
 * Processes a WhatsApp Cloud API webhook payload: stores inbound messages,
 * runs the chatbot, delivers replies and records delivery-status callbacks.
 */
export async function processWaPayload(body: WaWebhookBody) {
  const { ingestInboundMessage, sendWhatsAppText, storeOutbound } = await import("@/lib/wa.server");
  let handled = 0;

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const contactName = value?.contacts?.[0]?.profile?.name ?? null;

      for (const status of value?.statuses ?? []) {
        if (!status.id) continue;
        handled += 1;
        await supabaseAdmin
          .from("messages")
          .update({ status: status.status ?? "unknown" })
          .eq("wa_message_id", status.id);
        if (status.status === "failed") {
          const detail = status.errors?.[0]?.message ?? status.errors?.[0]?.title ?? null;
          await raiseAlert({
            title: "WhatsApp message delivery failed",
            message: detail,
            severity: "warning",
            source: "delivery",
          });
        }
      }

      for (const message of value?.messages ?? []) {
        const text = message.text?.body;
        const from = message.from;
        if (!text || !from) continue;
        handled += 1;

        const { conversationId, reply } = await ingestInboundMessage({
          channel: "whatsapp",
          phone: from,
          name: contactName,
          text,
          waMessageId: message.id ?? null,
        });

        if (reply) {
          try {
            const waId = await sendWhatsAppText(from, reply);
            if (waId) {
              await supabaseAdmin
                .from("messages")
                .update({ wa_message_id: waId })
                .eq("conversation_id", conversationId)
                .is("wa_message_id", null)
                .eq("body", reply);
            }
          } catch (sendError) {
            const detail = sendError instanceof Error ? sendError.message : "Delivery failed";
            await storeOutbound(
              conversationId,
              "(delivery failed — check WhatsApp credentials)",
              "bot",
            );
            await raiseAlert({
              title: "WhatsApp reply could not be delivered",
              message: detail,
              severity: "critical",
              source: "delivery",
            });
            throw sendError;
          }
        }
      }
    }
  }

  return handled;
}
