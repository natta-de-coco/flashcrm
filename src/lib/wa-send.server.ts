// One path for a message a person sends to a customer.
//
// Every send goes through the same steps, in this order, so none of them can
// be skipped by a caller:
//   1. the conversation is read inside the sender's own workspace
//   2. the safety gate decides, and says why not
//   3. the same click is recognised and sent once
//   4. the message is saved BEFORE the provider is called
//   5. the provider's answer is recorded as what it is: accepted, refused, or
//      not known
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { logAudit } from "@/lib/audit.server";
import { resolveContactByPhone } from "@/lib/contact-resolve.server";
import { checkSendPermission, type SendBlock, type SendCheck } from "@/lib/safety.server";
import type { WaFailureReason, WaSendOutcome } from "@/lib/wa-delivery";
import { renderTemplateBody } from "@/lib/wa-template-parameters";
import {
  completeOutboundDelivery,
  deliverWhatsAppTemplate,
  deliverWhatsAppText,
  findOrCreateWhatsAppConversation,
  resolveSendingNumber,
  storeOutbound,
  type WaCredentials,
} from "@/lib/wa.server";

export type SendState =
  /** WhatsApp accepted it and gave it an id. Not the same as delivered. */
  | "accepted"
  /** A website-chat reply: saved, and shown to the visitor by the widget. */
  | "stored"
  /** WhatsApp answered and refused it. The customer received nothing. */
  | "rejected"
  /** WhatsApp did not answer. The customer may or may not have received it. */
  | "unconfirmed"
  /** The safety gate stopped it. Nothing was saved or sent. */
  | "blocked"
  /** The same click arrived twice; this copy did nothing. */
  | "duplicate";

export type SendResult = {
  /** True only when the message is on its way. */
  ok: boolean;
  state: SendState;
  messageId: string | null;
  waId: string | null;
  /** Why it was not accepted, in English. The interface translates by `failureReason`. */
  deliveryError: string | null;
  failureReason: WaFailureReason | "unconfirmed" | null;
  blockedReasons: string[];
  blocks: SendBlock[];
  /** The business number it was (or would be) sent from. */
  sendingNumber: { label: string; displayPhone: string | null } | null;
  /** The customer's number in international form. */
  recipient: string | null;
  /** A template's text as the customer sees it. */
  rendered: string | null;
};

const base = (gate: SendCheck | null): Omit<SendResult, "ok" | "state"> => ({
  messageId: null,
  waId: null,
  deliveryError: null,
  failureReason: null,
  blockedReasons: [],
  blocks: [],
  sendingNumber: gate?.sendingNumber
    ? { label: gate.sendingNumber.label, displayPhone: gate.sendingNumber.displayPhone }
    : null,
  recipient: gate?.recipient ?? null,
  rendered: null,
});

const SEND_CLAIM = "outbound:send";

/**
 * True the first time a workspace sends `clientRef`, false for a repeat.
 *
 * A double click, a second Enter, or a request the browser retried all carry
 * the same reference. Disabling the button stops none of those reliably; the
 * unique key in the database does, because only one insert can win.
 */
async function claimSendOnce(tenantId: string, clientRef?: string | null): Promise<boolean> {
  if (!clientRef) return true;
  const { error } = await supabaseAdmin
    .from("webhook_dedup")
    .insert({ event_source: SEND_CLAIM, event_id: `${tenantId}:${clientRef}` });
  if (!error) return true;
  if (error.code === "23505") return false;
  // Not being able to record the claim must not stop a person replying to a
  // customer. The send goes ahead; only the duplicate guard is lost.
  console.error("[whatsapp] could not record send for deduplication", error.code ?? "");
  return true;
}

/** Undoes claimSendOnce when nothing was saved, so the same click can be tried again. */
async function releaseSend(tenantId: string, clientRef?: string | null): Promise<void> {
  if (!clientRef) return;
  const { error } = await supabaseAdmin
    .from("webhook_dedup")
    .delete()
    .eq("event_source", SEND_CLAIM)
    .eq("event_id", `${tenantId}:${clientRef}`);
  if (error) console.error("[whatsapp] could not release send claim", error.code ?? "");
}

async function blocked(
  gate: SendCheck,
  audit: { actorId: string; entityType: string; entityId: string; details?: object },
): Promise<SendResult> {
  await logAudit({
    action: "message.blocked",
    actorId: audit.actorId,
    entityType: audit.entityType,
    entityId: audit.entityId,
    details: { ...audit.details, reasons: gate.reasons, codes: gate.blocks.map((b) => b.code) },
  });
  return {
    ...base(gate),
    ok: false,
    state: "blocked",
    blockedReasons: gate.reasons,
    blocks: gate.blocks,
  };
}

/**
 * Saves a WhatsApp message, hands it to the provider, and records the answer.
 * The gate has already allowed it.
 */
async function sendThroughWhatsApp(args: {
  tenantId: string;
  userId: string;
  conversationId: string;
  /** The conversation has no number yet, so it takes the one used here. */
  bindNumber: boolean;
  storedBody: string;
  clientRef: string | null;
  gate: SendCheck;
  deliver: (to: string, creds: WaCredentials, messageRef: string) => Promise<WaSendOutcome>;
}): Promise<SendResult> {
  const { tenantId, userId, conversationId, gate, clientRef } = args;
  const result = base(gate);

  if (!(await claimSendOnce(tenantId, clientRef))) {
    return { ...result, ok: true, state: "duplicate" };
  }

  // Credentials are read again here rather than carried out of the gate, so a
  // secret only ever exists in the function that uses it.
  const sender = await resolveSendingNumber(tenantId, gate.waNumberId);
  if (!sender.ok || !gate.recipient) {
    await releaseSend(tenantId, clientRef);
    const message = sender.ok ? "This contact has no phone number." : sender.message;
    return {
      ...result,
      ok: false,
      state: "blocked",
      blockedReasons: [message],
      blocks: [{ code: sender.ok ? "recipient_invalid" : sender.code, message }],
    };
  }

  // Write before calling Meta. A provider success followed by a failed
  // database insert is worse than a visible failed message: the business has
  // sent something it can no longer audit in FLAS.
  let messageId: string;
  try {
    messageId = await storeOutbound(
      tenantId,
      conversationId,
      args.storedBody,
      "agent",
      userId,
      null,
      "sending",
    );
  } catch (error) {
    // Nothing was saved and nothing was sent: the same click may try again.
    await releaseSend(tenantId, clientRef);
    throw error;
  }

  const outcome = await args.deliver(gate.recipient.replace(/^\+/, ""), sender.creds, messageId);
  const waId = outcome.state === "accepted" ? outcome.waMessageId : null;
  const status =
    outcome.state === "accepted" ? "sent" : outcome.state === "rejected" ? "failed" : "unconfirmed";
  try {
    await completeOutboundDelivery(messageId, waId, status, tenantId);
  } catch (error) {
    // The provider has already answered; failing the request now would tell
    // the sender "error" for a message the customer may be reading, and invite
    // a second copy. The row stays "sending" and the delivery receipt, which
    // carries this message's own reference, moves it on.
    console.error("[whatsapp] could not record the provider's answer", error);
  }

  if (args.bindNumber && gate.waNumberId) {
    await supabaseAdmin
      .from("conversations")
      .update({ wa_number_id: gate.waNumberId })
      .eq("id", conversationId)
      .eq("tenant_id", tenantId)
      .is("wa_number_id", null);
  }

  return {
    ...result,
    ok: outcome.state === "accepted",
    state: outcome.state,
    messageId,
    waId,
    deliveryError: outcome.state === "accepted" ? null : outcome.message,
    failureReason:
      outcome.state === "rejected"
        ? outcome.reason
        : outcome.state === "unconfirmed"
          ? "unconfirmed"
          : null,
  };
}

/** A person's reply in a conversation: WhatsApp, or the website chat. */
export async function sendConversationMessage(args: {
  tenantId: string;
  userId: string;
  conversationId: string;
  body: string;
  clientRef?: string | null;
}): Promise<SendResult> {
  const { tenantId, userId, clientRef } = args;
  const { data: conversation } = await supabaseAdmin
    .from("conversations")
    .select("id, channel, contact_id, wa_number_id")
    .eq("id", args.conversationId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!conversation) throw new Error("Conversation not found");

  const gate = await checkSendPermission({
    tenantId,
    conversationId: conversation.id,
    isTemplate: false,
  });
  if (!gate.allowed) {
    return blocked(gate, {
      actorId: userId,
      entityType: "conversation",
      entityId: conversation.id,
    });
  }

  let result: SendResult;
  if (conversation.channel === "whatsapp") {
    result = await sendThroughWhatsApp({
      tenantId,
      userId,
      conversationId: conversation.id,
      bindNumber: !conversation.wa_number_id,
      storedBody: args.body,
      clientRef: clientRef ?? null,
      gate,
      deliver: (to, creds, ref) => deliverWhatsAppText(to, args.body, creds, ref),
    });
  } else if (!(await claimSendOnce(tenantId, clientRef))) {
    result = { ...base(gate), ok: true, state: "duplicate" };
  } else {
    try {
      const messageId = await storeOutbound(tenantId, conversation.id, args.body, "agent", userId);
      result = { ...base(gate), ok: true, state: "stored", messageId };
    } catch (error) {
      await releaseSend(tenantId, clientRef);
      throw error;
    }
  }

  if (result.state !== "duplicate" && result.state !== "blocked") {
    await logAudit({
      action: "message.send",
      actorId: userId,
      entityType: "conversation",
      entityId: conversation.id,
      details: {
        channel: conversation.channel,
        // What the provider said, not a claim about the customer's phone.
        outcome: result.state,
        reason: result.failureReason,
      },
    });
  }
  return result;
}

/** An approved template, to a conversation or to a saved contact's number. */
export async function sendTemplate(args: {
  tenantId: string;
  userId: string;
  templateId: string;
  conversationId?: string | null;
  phone?: string | null;
  variables: string[];
  clientRef?: string | null;
}): Promise<SendResult> {
  const { tenantId, userId, clientRef } = args;
  const { data: template, error } = await supabaseAdmin
    .from("wa_templates")
    .select("*")
    .eq("id", args.templateId)
    .eq("tenant_id", tenantId)
    .single();
  if (error || !template) throw new Error("Template not found");
  if (template.status !== "approved") throw new Error("Only approved templates can be sent");
  const rendered = renderTemplateBody(template.body, args.variables);

  let conversationId = args.conversationId ?? null;
  let bindNumber = false;
  let gate: SendCheck;
  if (conversationId) {
    const { data: conv } = await supabaseAdmin
      .from("conversations")
      .select("id, channel, wa_number_id")
      .eq("id", conversationId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!conv) throw new Error("Conversation not found");
    if (conv.channel !== "whatsapp") throw new Error("Choose a WhatsApp conversation");
    bindNumber = !conv.wa_number_id;
    gate = await checkSendPermission({ tenantId, conversationId, isTemplate: true });
  } else {
    if (!args.phone) throw new Error("No WhatsApp number available for this recipient");
    // Through the shared resolver, so a contact saved as "+971 50 123 4567"
    // is found when the number is typed as "971501234567". An unknown number
    // has no recorded consent, and the gate refuses it.
    const resolved = await resolveContactByPhone(tenantId, args.phone);
    gate = await checkSendPermission({
      tenantId,
      contactId: resolved?.contactId ?? null,
      recipientPhone: args.phone,
      isTemplate: true,
    });
  }

  const auditTarget = {
    actorId: userId,
    entityType: conversationId ? "conversation" : "phone",
    entityId: conversationId ?? args.phone ?? "",
    details: { template: template.name },
  };
  if (!gate.allowed) return blocked(gate, auditTarget);

  if (!conversationId) {
    // A template to a number used to leave no message behind it -- only an
    // audit line. It belongs in that customer's conversation like any other.
    const opened = await findOrCreateWhatsAppConversation(
      tenantId,
      gate.contactId as string,
      gate.waNumberId,
    );
    conversationId = opened.id;
    bindNumber = !opened.wa_number_id;
  }

  const result = await sendThroughWhatsApp({
    tenantId,
    userId,
    conversationId,
    bindNumber,
    storedBody: rendered,
    clientRef: clientRef ?? null,
    gate,
    deliver: (to, creds, ref) =>
      deliverWhatsAppTemplate(to, template.name, template.language, args.variables, creds, ref),
  });

  if (result.state !== "duplicate" && result.state !== "blocked") {
    await logAudit({
      action: "message.template_send",
      actorId: userId,
      entityType: auditTarget.entityType,
      entityId: auditTarget.entityId,
      details: {
        template: template.name,
        waId: result.waId,
        outcome: result.state,
        reason: result.failureReason,
      },
    });
  }
  return { ...result, rendered: result.state === "blocked" ? null : rendered };
}

/**
 * What the composer needs to know before anyone types: which number a reply
 * would leave from, who it would reach, and anything that would stop it.
 * The same gate the send itself uses, so the two cannot disagree.
 */
export async function describeSendContext(tenantId: string, conversationId: string) {
  const gate = await checkSendPermission({ tenantId, conversationId, isTemplate: false });
  return {
    sendingNumber: gate.sendingNumber
      ? { label: gate.sendingNumber.label, displayPhone: gate.sendingNumber.displayPhone }
      : null,
    recipient: gate.recipient,
    blocks: gate.blocks,
  };
}
