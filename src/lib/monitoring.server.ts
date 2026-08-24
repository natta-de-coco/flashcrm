// Server-only helpers for webhook delivery monitoring, retries and alerts.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type WaWebhookBody = {
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: {
        metadata?: { display_phone_number?: string; phone_number_id?: string };
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

/** Creates an alert, skipping duplicates of the same unresolved title within a dedupe window. */
export async function raiseAlert(args: {
  title: string;
  message?: string | null;
  severity?: "info" | "warning" | "critical";
  source?: string;
  dedupeMinutes?: number;
}) {
  const since = new Date(Date.now() - (args.dedupeMinutes ?? 10) * 60 * 1000).toISOString();
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

type WaNumberHealth = {
  id: string;
  label: string;
  alerts_enabled: boolean;
  deliverability_min: number;
  read_rate_min: number;
};

/**
 * Evaluates the last 24h of outbound messages for one connected number and
 * raises alerts when the delivery success rate or read rate falls below the
 * thresholds configured on that number.
 */
export async function checkNumberHealth(waNumberId: string | null) {
  if (!waNumberId) return;
  const { data: raw } = await supabaseAdmin
    .from("wa_numbers")
    .select("*")
    .eq("id", waNumberId)
    .maybeSingle();
  const num = raw as WaNumberHealth | null;
  if (!num || !num.alerts_enabled) return;

  const { data: convs } = await supabaseAdmin
    .from("conversations")
    .select("id")
    .eq("wa_number_id", waNumberId);
  const convIds = (convs ?? []).map((c) => c.id);
  if (convIds.length === 0) return;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: msgs } = await supabaseAdmin
    .from("messages")
    .select("status")
    .in("conversation_id", convIds)
    .eq("direction", "outbound")
    .gte("created_at", since);

  const statuses = (msgs ?? []).map((m) => m.status);
  const total = statuses.filter((s) => ["sent", "delivered", "read", "failed"].includes(s)).length;
  if (total < 20) return; // too little traffic to judge

  const failed = statuses.filter((s) => s === "failed").length;
  const delivered = statuses.filter((s) => s === "delivered" || s === "read").length;
  const read = statuses.filter((s) => s === "read").length;

  const deliverability = (delivered / total) * 100;
  const readRate = delivered > 0 ? (read / delivered) * 100 : 0;

  if (deliverability < num.deliverability_min) {
    await raiseAlert({
      title: `Low deliverability on ${num.label}`,
      message: `${deliverability.toFixed(1)}% of ${total} messages delivered in the last 24h (threshold ${num.deliverability_min}%). ${failed} failed — check the number's quality rating and credentials in Meta.`,
      severity: "critical",
      source: "health",
      dedupeMinutes: 360,
    });
  }
  if (readRate < num.read_rate_min) {
    await raiseAlert({
      title: `Low read rate on ${num.label}`,
      message: `${readRate.toFixed(1)}% of delivered messages were read in the last 24h (threshold ${num.read_rate_min}%). Review message timing and content quality.`,
      severity: "warning",
      source: "health",
      dedupeMinutes: 360,
    });
  }
}

/**
 * Processes a WhatsApp Cloud API webhook payload: stores inbound messages,
 * runs the chatbot, delivers replies and records delivery-status callbacks.
 */
export async function processWaPayload(body: WaWebhookBody) {
  const { ingestInboundMessage, sendWhatsAppText, storeOutbound, findWaNumberByPhoneId, resolveWaCredentials } =
    await import("@/lib/wa.server");
  let handled = 0;

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const contactName = value?.contacts?.[0]?.profile?.name ?? null;
      const waNumberId = await findWaNumberByPhoneId(value?.metadata?.phone_number_id ?? null);

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
          waNumberId,
        });

        if (reply) {
          try {
            const waId = await sendWhatsAppText(from, reply, await resolveWaCredentials(waNumberId));
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
