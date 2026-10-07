// One path for a message a person sends to a customer.
//
// Every send goes through the same steps, in this order, so none of them can
// be skipped by a caller:
//   1. the conversation is read inside the sender's own workspace
//   2. the safety gate decides, and says why not
//   3. the message is saved BEFORE the provider is called, under an id the
//      same click always maps to -- so a repeat cannot be saved, and stops
//   4. the provider's answer is recorded as what it is: accepted, refused, or
//      not known
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { logAudit } from "@/lib/audit.server";
import { resolveContactByPhone } from "@/lib/contact-resolve.server";
import {
  checkSendPermission,
  SEND_NOT_CHECKED_TEXT,
  type SendBlock,
  type SendCheck,
} from "@/lib/safety.server";
import {
  WA_FAILURE_TEXT,
  WA_UNCONFIRMED_TEXT,
  type WaFailureReason,
  type WaSendOutcome,
} from "@/lib/wa-delivery";
import { renderTemplateBody } from "@/lib/wa-template-parameters";
import {
  completeOutboundDelivery,
  deliverWhatsAppTemplate,
  deliverWhatsAppText,
  findOrCreateWhatsAppConversation,
  OUTBOUND_NOT_SAVED_TEXT,
  OutboundAlreadySaved,
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
  /**
   * This message is already saved, by an earlier copy of the same request,
   * and this copy sent nothing. With `ok`, WhatsApp accepted that earlier
   * copy; without it, the earlier copy is still being sent and its own answer
   * will say how it went.
   */
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
  /**
   * This request found its message already saved and sent nothing. `state`
   * is then what happened to that saved message, not to this request.
   */
  repeated: boolean;
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
  repeated: false,
});

/**
 * The row id of a message the sender named with a reference.
 *
 * A double click, a second Enter and a request repeated after a lost response
 * all carry the same reference, so they all ask to save the same row -- and a
 * primary key admits one. The message is its own claim. There is no second
 * record that could exist without the message (a send claimed and never
 * saved), be missing while the message goes out (a guard that was down), or
 * expire before a retry arrives.
 *
 * Derived here from the workspace and the conversation as well as the
 * reference, so a reference cannot name, or collide with, a row anywhere else.
 */
async function messageIdFor(
  tenantId: string,
  conversationId: string,
  clientRef?: string | null,
): Promise<string | null> {
  if (!clientRef) return null;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`flas:outbound:${tenantId}:${conversationId}:${clientRef}`),
  );
  const bytes = new Uint8Array(digest).slice(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x80; // version 8: an application-defined UUID
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 9562 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

/**
 * The saved message a reference already names in this conversation, if any.
 * Throws when that cannot be read: not knowing whether a send is a repeat is a
 * reason to stop, never a reason to send.
 */
async function savedCopy(
  tenantId: string,
  conversationId: string,
  messageId: string,
): Promise<SavedCopy | null> {
  const { data, error } = await supabaseAdmin
    .from("messages")
    .select("id, wa_message_id, status, created_at")
    .eq("id", messageId)
    .eq("tenant_id", tenantId)
    .eq("conversation_id", conversationId)
    .maybeSingle();
  if (error) throw new Error(OUTBOUND_NOT_SAVED_TEXT);
  return data
    ? {
        id: data.id,
        waId: data.wa_message_id ?? null,
        status: data.status,
        createdAt: data.created_at,
      }
    : null;
}

type SavedCopy = { id: string; waId: string | null; status: string; createdAt: string };

/** A send is settled within seconds; one still "sending" after this never had its answer recorded. */
const SENDING_GOES_STALE_MS = 2 * 60 * 1000;

/**
 * What a repeat is told: what happened to the message that is already saved.
 *
 * "It is already saved" is not "it was sent". The first copy may have been
 * refused, or never answered -- and a repeat that said "fine" for those
 * cleared the composer without a word, and let an invoice be marked sent that
 * WhatsApp had turned down.
 */
function duplicateOf(copy: SavedCopy, gate: SendCheck | null): SendResult {
  const shared = { ...base(gate), repeated: true, messageId: copy.id, waId: copy.waId };
  if (["sent", "delivered", "read"].includes(copy.status)) {
    return { ...shared, ok: true, state: "duplicate" };
  }
  if (copy.status === "failed") {
    // Why it was refused was told to the first copy; here it is only known that it was.
    return {
      ...shared,
      ok: false,
      state: "rejected",
      failureReason: "unknown",
      deliveryError: WA_FAILURE_TEXT.unknown,
    };
  }
  const age = Date.now() - new Date(copy.createdAt).getTime();
  if (copy.status === "sending" && !(age > SENDING_GOES_STALE_MS)) {
    // The first copy is still on its way to WhatsApp, and will answer for itself.
    return { ...shared, ok: false, state: "duplicate" };
  }
  return {
    ...shared,
    ok: false,
    state: "unconfirmed",
    failureReason: "unconfirmed",
    deliveryError: WA_UNCONFIRMED_TEXT,
  };
}

/** The contact's WhatsApp conversation in this workspace, if they have one. */
async function whatsappConversationOf(tenantId: string, contactId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("conversations")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("contact_id", contactId)
    .eq("channel", "whatsapp")
    .maybeSingle();
  if (error) throw new Error(SEND_NOT_CHECKED_TEXT);
  return data?.id ?? null;
}

/**
 * Answers a repeat before anything else is decided. A message that is already
 * saved stays sent whatever the gate would say now, and is not judged twice.
 */
async function repeatOf(
  tenantId: string,
  conversationId: string,
  clientRef?: string | null,
): Promise<SendResult | null> {
  const id = await messageIdFor(tenantId, conversationId, clientRef);
  const copy = id ? await savedCopy(tenantId, conversationId, id) : null;
  return copy ? duplicateOf(copy, null) : null;
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

  // Credentials are read again here rather than carried out of the gate, so a
  // secret only ever exists in the function that uses it.
  const sender = await resolveSendingNumber(tenantId, gate.waNumberId);
  if (!sender.ok || !gate.recipient) {
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
  //
  // The save is also the duplicate guard. Two copies of one click ask for the
  // same row and only one insert can win; the other finds the message already
  // there and never reaches the provider. If the save fails for any other
  // reason, nothing was saved and nothing is sent: the error says so, and the
  // same reference can be tried again.
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
      await messageIdFor(tenantId, conversationId, clientRef),
    );
  } catch (error) {
    if (!(error instanceof OutboundAlreadySaved)) throw error;
    const copy = await savedCopy(tenantId, conversationId, error.messageId);
    if (!copy) throw new Error(OUTBOUND_NOT_SAVED_TEXT);
    return duplicateOf(copy, gate);
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

  const repeat = await repeatOf(tenantId, conversation.id, clientRef);
  if (repeat) return repeat;

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
  } else {
    try {
      const messageId = await storeOutbound(
        tenantId,
        conversation.id,
        args.body,
        "agent",
        userId,
        null,
        "sent",
        await messageIdFor(tenantId, conversation.id, clientRef),
      );
      result = { ...base(gate), ok: true, state: "stored", messageId };
    } catch (error) {
      if (!(error instanceof OutboundAlreadySaved)) throw error;
      const copy = await savedCopy(tenantId, conversation.id, error.messageId);
      if (!copy) throw new Error(OUTBOUND_NOT_SAVED_TEXT);
      result = duplicateOf(copy, gate);
    }
  }

  if (!result.repeated && result.state !== "blocked") {
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
  let gate: SendCheck | null = null;
  if (!conversationId) {
    if (!args.phone) throw new Error("No WhatsApp number available for this recipient");
    // Through the shared resolver, so a contact saved as "+971 50 123 4567"
    // is found when the number is typed as "971501234567". An unknown number
    // has no recorded consent, and the gate refuses it.
    const resolved = await resolveContactByPhone(tenantId, args.phone);
    // A customer who already has a WhatsApp conversation is answered in it,
    // from the line it is bound to. Sending "to the number" used to pick the
    // workspace's default line and then file the message in that conversation
    // -- a customer who talks to one line got a message from another.
    const existing = resolved ? await whatsappConversationOf(tenantId, resolved.contactId) : null;
    if (existing) {
      conversationId = existing;
    } else {
      gate = await checkSendPermission({
        tenantId,
        contactId: resolved?.contactId ?? null,
        recipientPhone: args.phone,
        isTemplate: true,
      });
    }
  }
  if (conversationId) {
    const { data: conv } = await supabaseAdmin
      .from("conversations")
      .select("id, channel, wa_number_id")
      .eq("id", conversationId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!conv) throw new Error("Conversation not found");
    if (conv.channel !== "whatsapp") throw new Error("Choose a WhatsApp conversation");
    const repeat = await repeatOf(tenantId, conv.id, clientRef);
    if (repeat) return { ...repeat, rendered };
    bindNumber = !conv.wa_number_id;
    gate = await checkSendPermission({ tenantId, conversationId, isTemplate: true });
  }
  if (!gate) throw new Error("Conversation not found");

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

  if (!result.repeated && result.state !== "blocked") {
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
