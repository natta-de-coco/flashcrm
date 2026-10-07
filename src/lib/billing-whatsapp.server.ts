// An invoice, or the paid copy of one, sent to the customer over WhatsApp.
//
// These two used to call Meta directly: no safety gate, no consent or 24-hour
// check, no message left in the customer's conversation, and a refusal shown
// as a bare error. They now go through the same pipeline as a reply typed in
// the Inbox, by these rules:
//
//   - inside the customer's 24-hour window: an ordinary message, gated;
//   - outside it: only an approved UTILITY template of this workspace, with
//     the customer's recorded consent -- and sending one does not re-open the
//     window;
//   - neither available: nothing is sent, the reason is returned, and the
//     person is offered the PDF to send themselves. It is never quietly sent
//     some other way.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resolveContactByPhone } from "@/lib/contact-resolve.server";
import { checkSendPermission, type SendBlock, type SendCheck } from "@/lib/safety.server";
import { sendConversationMessage, sendTemplate, type SendResult } from "@/lib/wa-send.server";

/**
 * The approved template a workspace needs for each document message. A name
 * rather than a setting, so that nothing but an approved template of exactly
 * this purpose can ever be picked for it.
 */
export const DOCUMENT_TEMPLATE_NAMES = {
  invoice: "invoice_notification",
  receipt: "payment_receipt",
} as const;
export type DocumentMessage = keyof typeof DOCUMENT_TEMPLATE_NAMES;

/** {{1}} customer name, {{2}} document, {{3}} amount, {{4}} link to the PDF. */
export const DOCUMENT_TEMPLATE_VARIABLES = 4;

export const NO_DOCUMENT_TEMPLATE_TEXT =
  "This customer has not messaged in the last 24 hours, and this workspace has no approved WhatsApp template for this document yet. Download the PDF and send it yourself, or ask a company admin to add an approved utility template named invoice_notification (invoices) or payment_receipt (paid receipts).";

const CONTACT_NOT_SAVED_TEXT =
  "This customer is not saved as a contact with a WhatsApp number. Save the contact first, or download the PDF and send it yourself.";

export type DocumentSendResult = SendResult & {
  /** How it went out: as an ordinary message, as a template, or not at all. */
  via: "text" | "template" | null;
};

function notSent(blocks: SendBlock[], gate: SendCheck | null = null): DocumentSendResult {
  return {
    ok: false,
    state: "blocked",
    via: null,
    messageId: null,
    waId: null,
    deliveryError: null,
    failureReason: null,
    blockedReasons: blocks.map((b) => b.message),
    blocks,
    sendingNumber: gate?.sendingNumber
      ? { label: gate.sendingNumber.label, displayPhone: gate.sendingNumber.displayPhone }
      : null,
    recipient: gate?.recipient ?? null,
    rendered: null,
    repeated: false,
  };
}

/** The numbered placeholders a template body uses, e.g. [1, 2, 3, 4]. */
function placeholders(body: string): number[] {
  const found = new Set<number>();
  for (const match of body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) found.add(Number(match[1]));
  return [...found].sort((a, b) => a - b);
}

/**
 * This workspace's approved utility template for a document message, usable
 * from the number that would send it -- or null.
 *
 * Approved, utility, the reserved name, exactly the four variables this code
 * fills, and not tied to a different number: anything else is not "a suitable
 * template" and is not sent.
 */
async function documentTemplate(
  tenantId: string,
  kind: DocumentMessage,
  waNumberId: string | null,
): Promise<{ id: string } | null> {
  const { data, error } = await supabaseAdmin
    .from("wa_templates")
    .select("id, language, category, body, wa_number_id")
    .eq("tenant_id", tenantId)
    .eq("name", DOCUMENT_TEMPLATE_NAMES[kind])
    .eq("status", "approved");
  if (error) throw new Error("Could not read this workspace's WhatsApp templates.");
  const wanted = Array.from({ length: DOCUMENT_TEMPLATE_VARIABLES }, (_, i) => i + 1).join(",");
  const suitable = (data ?? []).filter(
    (t) =>
      (t.category ?? "").toLowerCase() === "utility" &&
      placeholders(t.body ?? "").join(",") === wanted &&
      (!t.wa_number_id || !waNumberId || t.wa_number_id === waNumberId),
  );
  // One per language may be approved. English first, then by language code,
  // so the choice is the same every time.
  suitable.sort(
    (a, b) =>
      Number(b.language.startsWith("en")) - Number(a.language.startsWith("en")) ||
      a.language.localeCompare(b.language),
  );
  return suitable[0] ? { id: suitable[0].id } : null;
}

export async function sendDocumentOverWhatsApp(args: {
  tenantId: string;
  userId: string;
  kind: DocumentMessage;
  /** The contact the document is for, when it has one. */
  contactId: string | null;
  /** The number on the document, used to find the contact when it has none. */
  phone: string | null;
  /** What is sent inside the 24-hour window. */
  text: string;
  /** What fills the template outside it: name, document, amount, link. */
  templateVariables: string[];
  clientRef?: string | null;
}): Promise<DocumentSendResult> {
  const { tenantId, userId, clientRef } = args;

  // 1. Who. A document message goes to a saved contact of this workspace, in
  //    that contact's own conversation -- never to a bare number.
  const contactId =
    args.contactId ?? (await resolveContactByPhone(tenantId, args.phone))?.contactId ?? null;
  if (!contactId) return notSent([{ code: "contact_not_saved", message: CONTACT_NOT_SAVED_TEXT }]);
  const { data: contact, error: contactError } = await supabaseAdmin
    .from("contacts")
    .select("id, phone")
    .eq("id", contactId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (contactError) throw new Error("Could not read this customer's contact.");
  if (!contact?.phone) {
    return notSent([{ code: "contact_not_saved", message: CONTACT_NOT_SAVED_TEXT }]);
  }

  const { data: conversation, error: conversationError } = await supabaseAdmin
    .from("conversations")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("contact_id", contact.id)
    .eq("channel", "whatsapp")
    .maybeSingle();
  if (conversationError) throw new Error("Could not read this customer's conversation.");

  // 2. Inside the 24-hour window an ordinary message is allowed.
  if (conversation) {
    const gate = await checkSendPermission({
      tenantId,
      conversationId: conversation.id,
      isTemplate: false,
    });
    const onlyTheWindow =
      gate.blocks.length > 0 && gate.blocks.every((b) => b.code === "window_closed");
    if (!onlyTheWindow) {
      // Allowed, or stopped by something no template gets around: either way
      // the pipeline gives the answer, and records it.
      const sent = await sendConversationMessage({
        tenantId,
        userId,
        conversationId: conversation.id,
        body: args.text,
        clientRef: clientRef ?? null,
      });
      return { ...sent, via: sent.state === "blocked" ? null : "text" };
    }
  }

  // 3. Outside it, only an approved template -- and the gate for templates
  //    (consent, plan, the sending number) is asked first, so a missing
  //    template is never the reason given for a send that could not go anyway.
  const target = conversation
    ? { conversationId: conversation.id }
    : { contactId: contact.id, recipientPhone: contact.phone };
  const gate = await checkSendPermission({ tenantId, ...target, isTemplate: true });
  if (!gate.allowed) return notSent(gate.blocks, gate);

  const template = await documentTemplate(tenantId, args.kind, gate.waNumberId);
  if (!template) {
    return notSent([{ code: "no_document_template", message: NO_DOCUMENT_TEMPLATE_TEXT }], gate);
  }
  const sent = await sendTemplate({
    tenantId,
    userId,
    templateId: template.id,
    ...(conversation ? { conversationId: conversation.id } : { phone: contact.phone }),
    variables: args.templateVariables,
    clientRef: clientRef ?? null,
  });
  return { ...sent, via: sent.state === "blocked" ? null : "template" };
}
