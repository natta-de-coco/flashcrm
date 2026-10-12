// Server-only helpers for webhook delivery monitoring, retries and alerts.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  evidenceOfReceipt,
  evidenceOfSend,
  failureReasonForCode,
  mediaOf,
  providerStatus,
  receiptTime,
  statusesThatMayBecome,
  WA_FAILURE_TEXT,
} from "@/lib/wa-delivery";

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
          image?: { id?: string; caption?: string; mime_type?: string; sha256?: string };
          audio?: { id?: string; mime_type?: string; sha256?: string };
          video?: { id?: string; caption?: string; mime_type?: string; sha256?: string };
          document?: {
            id?: string;
            caption?: string;
            filename?: string;
            mime_type?: string;
            sha256?: string;
          };
          sticker?: { id?: string; mime_type?: string; sha256?: string };
          location?: { latitude?: number; longitude?: number; name?: string; address?: string };
          interactive?: {
            type?: string;
            button_reply?: { id?: string; title?: string };
            list_reply?: { id?: string; title?: string; description?: string };
          };
          button?: { text?: string; payload?: string };
        }>;
        statuses?: Array<{
          id?: string;
          status?: string;
          /** When it happened, in unix seconds, by Meta's clock. */
          timestamp?: string;
          /** FLAS's own message id, echoed back because the send carried it. */
          biz_opaque_callback_data?: string;
          errors?: Array<{ code?: number; title?: string; message?: string }>;
        }>;
      };
    }>;
  }>;
};

/**
 * Creates an alert, skipping duplicates of the same unresolved title within a
 * dedupe window. Returns true when a new alert row was actually inserted.
 */
export async function raiseAlert(args: {
  title: string;
  message?: string | null;
  severity?: "info" | "warning" | "critical";
  source?: string;
  dedupeMinutes?: number;
}): Promise<boolean> {
  const since = new Date(Date.now() - (args.dedupeMinutes ?? 10) * 60 * 1000).toISOString();
  const { data: existing } = await supabaseAdmin
    .from("system_alerts")
    .select("id")
    .eq("title", args.title)
    .eq("resolved", false)
    .gte("created_at", since)
    .maybeSingle();
  if (existing) return false;

  await supabaseAdmin.from("system_alerts").insert({
    title: args.title,
    message: args.message ?? null,
    severity: args.severity ?? "warning",
    source: args.source ?? "webhook",
  });
  return true;
}

export async function logWebhookEvent(args: {
  source?: string;
  eventType: string;
  payload: unknown;
  waMessageId?: string | null;
  tenantId?: string | null;
}) {
  const { data } = await supabaseAdmin
    .from("webhook_events")
    .insert({
      source: args.source ?? "whatsapp",
      event_type: args.eventType,
      payload: (args.payload ?? {}) as never,
      wa_message_id: args.waMessageId ?? null,
      status: "received",
      tenant_id: args.tenantId ?? null,
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
  deliverability_min: number | null;
  read_rate_min: number | null;
};

type EffectiveThresholds = {
  deliverabilityMin: number;
  readRateMin: number;
  tenantId: string | null;
  source: "number" | "plan";
};

/**
 * Resolves the alert thresholds for a number: per-number overrides win; when a
 * threshold is blank the default for the company's subscription plan applies
 * (falling back to the platform-wide "default" row).
 */
async function resolveThresholds(num: WaNumberHealth): Promise<EffectiveThresholds> {
  if (num.deliverability_min != null && num.read_rate_min != null) {
    return {
      deliverabilityMin: num.deliverability_min,
      readRateMin: num.read_rate_min,
      tenantId: null,
      source: "number",
    };
  }

  // Find the company using this number via a conversation's contact.
  const { data: conv } = await supabaseAdmin
    .from("conversations")
    .select("contacts(tenant_id)")
    .eq("wa_number_id", num.id)
    .limit(1)
    .maybeSingle();
  const tenantId = ((conv as { contacts?: { tenant_id?: string | null } | null } | null)?.contacts
    ?.tenant_id ?? null) as string | null;

  let plan = "default";
  if (tenantId) {
    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("plan")
      .eq("id", tenantId)
      .maybeSingle();
    if (org?.plan) plan = org.plan;
  }

  const { data: rows } = await supabaseAdmin
    .from("plan_thresholds")
    .select("plan, deliverability_min, read_rate_min")
    .in("plan", [plan, "default"]);
  const row = rows?.find((r) => r.plan === plan) ?? rows?.find((r) => r.plan === "default");

  return {
    deliverabilityMin: Number(row?.deliverability_min ?? 95),
    readRateMin: Number(row?.read_rate_min ?? 60),
    tenantId,
    source: "plan",
  };
}

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
  const thresholds = await resolveThresholds(num);
  const basis = thresholds.source === "plan" ? "plan default" : "number override";

  if (deliverability < thresholds.deliverabilityMin) {
    await raiseAlert({
      title: `Low deliverability on ${num.label}`,
      message: `${deliverability.toFixed(1)}% of ${total} messages delivered in the last 24h (${basis} threshold ${thresholds.deliverabilityMin}%). ${failed} failed — check the number's quality rating and credentials in Meta.`,
      severity: "critical",
      source: "health",
      dedupeMinutes: 360,
    });
  }
  if (readRate < thresholds.readRateMin) {
    await raiseAlert({
      title: `Low read rate on ${num.label}`,
      message: `${readRate.toFixed(1)}% of delivered messages were read in the last 24h (${basis} threshold ${thresholds.readRateMin}%). Review message timing and content quality.`,
      severity: "warning",
      source: "health",
      dedupeMinutes: 360,
    });
  }
}

type WaEntry = NonNullable<WaWebhookBody["entry"]>[number];
type WaChange = NonNullable<WaEntry["changes"]>[number];
type WaValue = NonNullable<WaChange["value"]>;
type WaMessage = NonNullable<WaValue["messages"]>[number];

/**
 * Builds a readable body for any inbound message type. Previously only
 * `text` messages were stored at all — images/audio/video/documents/
 * locations/button and list replies were silently dropped (message.text?.body
 * was undefined, so the whole message was skipped). This at least keeps the
 * conversation thread accurate; it does not yet download and re-host the
 * actual media binary (Meta's media ids need a separate authenticated fetch
 * that expires quickly — a real "save it to our own storage" pipeline is a
 * bigger follow-up, not attempted here).
 */
function extractMessageBody(message: WaMessage): string | null {
  if (message.text?.body) return message.text.body;
  if (message.image) return message.image.caption ? `📷 ${message.image.caption}` : "📷 Photo";
  if (message.video) return message.video.caption ? `🎥 ${message.video.caption}` : "🎥 Video";
  if (message.audio) return "🎤 Voice/audio message";
  if (message.sticker) return "🩹 Sticker";
  if (message.document) {
    return message.document.caption
      ? `📄 ${message.document.caption} (${message.document.filename ?? "file"})`
      : `📄 ${message.document.filename ?? "Document"}`;
  }
  if (message.location) {
    const { latitude, longitude, name, address } = message.location;
    const where =
      name ||
      address ||
      (latitude != null && longitude != null ? `${latitude}, ${longitude}` : null);
    return `📍 Location${where ? `: ${where}` : ""}`;
  }
  if (message.interactive?.button_reply)
    return message.interactive.button_reply.title ?? "(button reply)";
  if (message.interactive?.list_reply)
    return message.interactive.list_reply.title ?? "(list reply)";
  if (message.button) return message.button.text ?? "(button reply)";
  return null;
}

/** Returns true the FIRST time this (source, id) pair is seen; false on every
 *  retry. Backs webhook idempotency — Meta redelivers on any non-2xx or slow
 *  response, and previously nothing stopped a retry from re-sending replies
 *  or re-raising alerts. */
async function claimWebhookEventOnce(source: string, eventId: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from("webhook_dedup")
    .insert({ event_source: source, event_id: eventId });
  if (!error) return true;
  // Unique-violation (23505) means we've already processed this id.
  if (error.code === "23505") return false;
  // Any other failure used to read as "already processed" too, so one
  // transient database error silently lost a customer's message for good.
  // Carry on instead: ingestInboundMessage refuses a WhatsApp message id it
  // has already stored, so a retry still cannot be answered twice.
  console.error("[webhook] could not record event for deduplication", source, error.code ?? "");
  return true;
}

/** Undoes claimWebhookEventOnce when the work it guarded did not finish, so a
 *  retry of the event can do that work instead of skipping it. */
async function releaseWebhookEvent(source: string, eventId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("webhook_dedup")
    .delete()
    .eq("event_source", source)
    .eq("event_id", eventId);
  if (error) console.error("[webhook] could not release event", source, error.code ?? "");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a receipt did to the message it names. */
type ReceiptEffect =
  /** The message moved to the reported status. */
  | "applied"
  /** The message is already at or past it: a repeat, or a receipt that came late. */
  | "stale"
  /** No message of this workspace matches. There is nothing to record. */
  | "unmatched";

const RECEIPT_NOT_SAVED = "Could not record a WhatsApp delivery receipt in the CRM.";

/**
 * Records what Meta reports for one outbound message, inside one workspace.
 *
 * Receipts arrive late, twice and out of order. The update only matches a row
 * whose current status is earlier than the incoming one, in a single
 * statement, so a late "sent" can never overwrite "read" and "failed" can
 * never overwrite a message already reported delivered -- even when two
 * receipts are processed at the same moment.
 *
 * A message whose send was never confirmed has no provider id to match. Its
 * receipt still carries the reference FLAS sent with it, so the row is found
 * by that, inside the same workspace, and given its provider id here.
 *
 * A read or write the database refused is thrown, never swallowed: "nothing to
 * change" and "could not change it" are different answers, and only the first
 * may be forgotten.
 */
async function applyDeliveryStatus(
  tenantId: string,
  waMessageId: string,
  incoming: "sent" | "delivered" | "read" | "failed",
  messageRef?: string | null,
): Promise<{ effect: ReceiptEffect; messageIds: string[] }> {
  const none: string[] = [];
  const allowedFrom = statusesThatMayBecome(incoming);
  const { data: matched, error: readError } = await supabaseAdmin
    .from("messages")
    .select("id")
    .eq("wa_message_id", waMessageId)
    .eq("tenant_id", tenantId)
    .limit(1);
  if (readError) throw new Error(RECEIPT_NOT_SAVED);
  if (matched && matched.length > 0) {
    const { data: moved, error } = await supabaseAdmin
      .from("messages")
      .update({ status: incoming })
      .eq("wa_message_id", waMessageId)
      .eq("tenant_id", tenantId)
      .in("status", allowedFrom)
      .select("id");
    if (error) throw new Error(RECEIPT_NOT_SAVED);
    return moved && moved.length > 0
      ? { effect: "applied", messageIds: moved.map((m) => m.id) }
      : { effect: "stale", messageIds: none };
  }
  if (!messageRef || !UUID.test(messageRef)) return { effect: "unmatched", messageIds: none };
  const { data: moved, error } = await supabaseAdmin
    .from("messages")
    .update({ status: incoming, wa_message_id: waMessageId })
    .eq("id", messageRef)
    .eq("tenant_id", tenantId)
    .eq("direction", "outbound")
    .is("wa_message_id", null)
    .in("status", allowedFrom)
    .select("id");
  if (error) throw new Error(RECEIPT_NOT_SAVED);
  if (moved && moved.length > 0) {
    return { effect: "applied", messageIds: moved.map((m) => m.id) };
  }
  // Nothing moved: either the referenced message is already settled, or the
  // reference names nothing in this workspace.
  const { data: known, error: knownError } = await supabaseAdmin
    .from("messages")
    .select("id")
    .eq("id", messageRef)
    .eq("tenant_id", tenantId)
    .limit(1);
  if (knownError) throw new Error(RECEIPT_NOT_SAVED);
  return { effect: known && known.length > 0 ? "stale" : "unmatched", messageIds: none };
}

/**
 * Processes a WhatsApp Cloud API webhook payload: stores inbound messages,
 * runs the chatbot, delivers replies and records delivery-status callbacks.
 * Every message/status is attributed to the tenant that owns the destination
 * phone_number_id — a payload for a number we don't recognize is dropped
 * rather than guessed at.
 */
export async function processWaPayload(body: WaWebhookBody) {
  const {
    completeOutboundDelivery,
    deliverWhatsAppText,
    ingestInboundMessage,
    recordMessageEvidence,
    storeOutbound,
    findWaNumberByPhoneId,
    resolveWaCredentials,
  } = await import("@/lib/wa.server");
  let handled = 0;
  /** The first receipt that could not be saved. Thrown once everything else is done. */
  let receiptError: unknown = null;

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const contactName = value?.contacts?.[0]?.profile?.name ?? null;
      const waNumber = await findWaNumberByPhoneId(value?.metadata?.phone_number_id ?? null);

      if (!waNumber) {
        // Unknown/unlinked number — there is no tenant to attribute this to.
        // Drop it rather than guess (guessing is exactly the S1 bug).
        if ((value?.messages?.length ?? 0) > 0 || (value?.statuses?.length ?? 0) > 0) {
          await raiseAlert({
            title: "WhatsApp webhook for an unrecognized number",
            message: `phone_number_id ${value?.metadata?.phone_number_id ?? "unknown"} does not match any connected wa_numbers row.`,
            severity: "warning",
            source: "webhook",
          });
        }
        continue;
      }
      const { id: waNumberId, tenantId } = waNumber;

      for (const status of value?.statuses ?? []) {
        if (!status.id) continue;
        // Only the four statuses Meta documents are ever written. Anything
        // else used to be stored verbatim, so an unfamiliar word could become
        // a message's status.
        const incoming = providerStatus(status.status);
        if (!incoming) continue;
        // Saved first, and never marked as seen beforehand. A receipt used to
        // be recorded as processed before its status was written, so one
        // refused write lost it for good: every later copy was discarded as a
        // repeat. Nothing needs marking -- the guarded update happens once by
        // itself. The first copy moves the message; a repeat finds nothing
        // left to move.
        let effect: ReceiptEffect;
        let moved: string[];
        try {
          ({ effect, messageIds: moved } = await applyDeliveryStatus(
            tenantId,
            status.id,
            incoming,
            status.biz_opaque_callback_data,
          ));
        } catch (error) {
          // The rest of this delivery is still worth saving. The event is
          // failed at the end, so it shows in Monitoring, and retrying it
          // applies this receipt.
          receiptError ??= error;
          continue;
        }
        if (effect === "stale") continue;
        if (effect === "applied") {
          handled += 1;
          // When it happened and, for a failure, why -- on the message itself,
          // and only for the receipt that actually moved it.
          const evidence = evidenceOfReceipt(
            incoming,
            receiptTime(status.timestamp),
            status.errors?.[0]?.code,
          );
          for (const id of moved) await recordMessageEvidence(tenantId, id, evidence);
        }
        // A failure is announced once: by the message's own change of status,
        // or, when FLAS holds no message for it, by this claim on the alert.
        if (
          incoming === "failed" &&
          (effect === "applied" ||
            (await claimWebhookEventOnce("whatsapp:status", status.id + ":failed")))
        ) {
          const reason = failureReasonForCode(status.errors?.[0]?.code);
          await raiseAlert({
            title: "WhatsApp message delivery failed",
            message: WA_FAILURE_TEXT[reason],
            severity: "warning",
            source: "delivery",
          });
        }
      }
      if ((value?.statuses?.length ?? 0) > 0) {
        await checkNumberHealth(waNumberId);
      }

      for (const message of value?.messages ?? []) {
        const text = extractMessageBody(message);
        const from = message.from;
        if (!text || !from || !message.id) continue;
        if (!(await claimWebhookEventOnce("whatsapp:message", message.id))) continue;
        handled += 1;

        let ingested: Awaited<ReturnType<typeof ingestInboundMessage>>;
        try {
          ingested = await ingestInboundMessage({
            tenantId,
            channel: "whatsapp",
            phone: from,
            name: contactName,
            text,
            waMessageId: message.id,
            waNumberId,
            media: mediaOf(message),
          });
        } catch (error) {
          // Retrying this event (Monitoring -> Retry) used to skip the message
          // as "already processed", mark the event fixed, and lose it for good.
          // A retry cannot answer twice: ingestInboundMessage recognizes a
          // message it already stored.
          await releaseWebhookEvent("whatsapp:message", message.id);
          throw error;
        }
        const { conversationId, reply, replyMessageId } = ingested;

        if (reply) {
          // The reply was stored as "sending" before this call. What Meta
          // answers decides what the thread says: accepted, refused, or not
          // known. It is never sent twice -- a retry of this event finds the
          // inbound message already stored and stops before reaching here.
          let outcome: Awaited<ReturnType<typeof deliverWhatsAppText>>;
          try {
            outcome = await deliverWhatsAppText(
              from,
              reply,
              await resolveWaCredentials(tenantId, waNumberId),
              replyMessageId,
            );
          } catch (credentialError) {
            // No usable number: nothing was handed to Meta.
            outcome = {
              state: "rejected",
              reason: "credentials",
              message:
                credentialError instanceof Error ? credentialError.message : "Delivery failed",
              providerCode: null,
            };
          }
          if (replyMessageId) {
            await completeOutboundDelivery(
              replyMessageId,
              outcome.state === "accepted" ? outcome.waMessageId : null,
              outcome.state === "accepted"
                ? "sent"
                : outcome.state === "rejected"
                  ? "failed"
                  : "unconfirmed",
              tenantId,
            );
            await recordMessageEvidence(
              tenantId,
              replyMessageId,
              evidenceOfSend(outcome, new Date().toISOString()),
            );
          }
          if (outcome.state !== "accepted") {
            // The reply's own row now says it did not go (or may not have).
            // The line under it carries the actual reason, where it used to
            // blame credentials whatever had happened.
            const noticeId = await storeOutbound(
              tenantId,
              conversationId,
              outcome.state === "rejected"
                ? `(Not delivered: ${outcome.message})`
                : `(${outcome.message})`,
              "bot",
              null,
              null,
              outcome.state === "rejected" ? "failed" : "unconfirmed",
            );
            // A note for the team, written by FLAS: never sent to the customer.
            await recordMessageEvidence(tenantId, noticeId, { origin: "system" });
            await raiseAlert({
              title:
                outcome.state === "rejected"
                  ? "WhatsApp reply could not be delivered"
                  : "WhatsApp did not confirm a reply",
              message: outcome.message,
              severity: outcome.state === "rejected" ? "critical" : "warning",
              source: "delivery",
            });
            // The event itself is not failed. It used to be, for a refusal,
            // which put a Retry button on it in Monitoring -- and that retry
            // could do nothing: the customer's message is already saved, so it
            // is skipped, and the event was then marked processed as if the
            // reply had gone. The refusal is on the reply's own row, in the
            // note under it, and in the alert above.
          }
        }
      }
    }
  }

  if (receiptError) throw receiptError;
  return handled;
}
