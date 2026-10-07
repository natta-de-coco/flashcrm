// Server-only send-safety gate: marketing rules, consent, routing and
// subscription checks before any WhatsApp message leaves the platform.
//
// Everything here is read inside ONE workspace. The caller names the tenant
// from the signed-in user (or from the webhook's own number), and a
// conversation, contact or number that belongs to any other workspace is
// treated as not existing -- never read, never sent from.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { countryOption } from "@/lib/locale";
import { resolveRecipientNumber, WA_FAILURE_TEXT } from "@/lib/wa-delivery";
import { resolveSendingNumber, type SendingNumber } from "@/lib/wa.server";

/**
 * Said when the gate could not read what it decides on. Not knowing whether a
 * workspace is suspended, or which line a customer is routed to, is a reason
 * to stop -- never a reason to send.
 */
export const SEND_NOT_CHECKED_TEXT =
  "Could not check whether this message may be sent, so it was not sent. Try again.";

/** Why a send is not allowed, as a code the interface can translate. */
export type SendBlockCode =
  | "conversation_not_found"
  | "no_number"
  | "number_missing"
  | "number_disabled"
  | "number_needs_reconnect"
  | "workspace_suspended"
  | "subscription_inactive"
  | "contact_not_saved"
  | "no_consent"
  | "window_closed"
  | "routed_to_other_number"
  | "recipient_invalid"
  /** An invoice or receipt outside the 24-hour window, with no approved template for it. */
  | "no_document_template";

export type SendBlock = { code: SendBlockCode; message: string };

export type SendCheck = {
  allowed: boolean;
  /** The same blocks as text, for callers that only show them. */
  reasons: string[];
  blocks: SendBlock[];
  contactId: string | null;
  waNumberId: string | null;
  /** The business number this message would leave from, when there is one. */
  sendingNumber: SendingNumber | null;
  /** The customer's number in international form, when it could be resolved. */
  recipient: string | null;
};

/**
 * Decides whether a message may be sent and explains every block.
 * Rules enforced:
 *  - the conversation, contact and number all belong to `tenantId`
 *  - a WhatsApp number is connected, enabled and still holds its credentials
 *  - the workspace subscription is trial/active and not suspended
 *  - the customer's number is a complete international number
 *  - template (marketing) messages require recorded opt-in consent
 *  - free-form WhatsApp replies require an inbound message within 24h
 *  - if routing rules assigned the lead to a number, sends must use that number
 */
export async function checkSendPermission(args: {
  tenantId: string;
  conversationId?: string | null;
  contactId?: string | null;
  waNumberId?: string | null;
  /** A number typed by the sender, when there is no saved conversation. */
  recipientPhone?: string | null;
  isTemplate: boolean;
}): Promise<SendCheck> {
  const { tenantId } = args;
  const blocks: SendBlock[] = [];
  const block = (code: SendBlockCode, message: string) => blocks.push({ code, message });
  const finish = (extra: Partial<SendCheck> = {}): SendCheck => ({
    allowed: blocks.length === 0,
    reasons: blocks.map((b) => b.message),
    blocks,
    contactId: null,
    waNumberId: null,
    sendingNumber: null,
    recipient: null,
    ...extra,
  });

  if (!tenantId) {
    block("conversation_not_found", "Your workspace is not available.");
    return finish();
  }

  let contactId = args.contactId ?? null;
  let waNumberId = args.waNumberId ?? null;
  let channel: string | null = null;

  if (args.conversationId) {
    const { data: conv } = await supabaseAdmin
      .from("conversations")
      .select("contact_id, wa_number_id, channel")
      .eq("id", args.conversationId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!conv) {
      // Another workspace's conversation is indistinguishable from none.
      block("conversation_not_found", "Conversation not found.");
      return finish();
    }
    contactId = contactId ?? conv.contact_id;
    waNumberId = waNumberId ?? conv.wa_number_id ?? null;
    channel = conv.channel;
  }

  // The line routing chose for this customer, if it chose one. Read before
  // the sending number is picked: a send that names no conversation and no
  // line follows the routing decision. It used to take the workspace default
  // first and was then refused for not being the routed line -- with no way
  // to choose the right one.
  let routedLine: string | null = null;
  if (contactId) {
    // Limited to one row: a contact with two routed leads (one per email they
    // have used) made maybeSingle() fail. Oldest lead wins, because that is
    // the routing decision the team has been working to.
    const { data: lead, error: leadError } = await supabaseAdmin
      .from("leads")
      .select("assigned_wa_number_id")
      .eq("contact_id", contactId)
      .eq("tenant_id", tenantId)
      .not("assigned_wa_number_id", "is", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (leadError) throw new Error(SEND_NOT_CHECKED_TEXT);
    routedLine = lead?.assigned_wa_number_id ?? null;
  }
  if (!args.conversationId && !waNumberId && routedLine) waNumberId = routedLine;

  // Only WhatsApp leaves through a business number. A website chat reply is
  // stored and shown in the widget; it has no number to check.
  const overWhatsApp = args.isTemplate || channel === "whatsapp" || (!channel && !!waNumberId);

  // 1. The number this would be sent from.
  let sendingNumber: SendingNumber | null = null;
  if (overWhatsApp) {
    const resolved = await resolveSendingNumber(tenantId, waNumberId);
    if (resolved.ok) {
      sendingNumber = resolved.number;
      waNumberId = resolved.number.id;
    } else {
      block(resolved.code, resolved.message);
    }
  }

  // 2. Workspace subscription state.
  const { data: org, error: orgError } = await supabaseAdmin
    .from("organizations")
    .select("suspended, subscription_status, country")
    .eq("id", tenantId)
    .maybeSingle();
  // An unreadable workspace used to look like one with nothing wrong with it.
  if (orgError) throw new Error(SEND_NOT_CHECKED_TEXT);
  if (org?.suspended) {
    block(
      "workspace_suspended",
      "This workspace is suspended — contact your Flas account manager.",
    );
  } else if (org && !["trial", "active"].includes(org.subscription_status)) {
    block(
      "subscription_inactive",
      `Subscription is ${org.subscription_status} — sending is paused until the plan is active.`,
    );
  }

  // 3. The contact, in this workspace only.
  let contact: {
    id: string;
    tenant_id: string | null;
    consent_given: boolean;
    phone: string | null;
  } | null = null;
  if (contactId) {
    const { data, error: contactError } = await supabaseAdmin
      .from("contacts")
      .select("id, tenant_id, consent_given, phone")
      .eq("id", contactId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (contactError) throw new Error(SEND_NOT_CHECKED_TEXT);
    contact = data ?? null;
  }

  // A template sent to a raw phone number that belongs to no contact used to
  // pass every check: the consent rule lived inside "if (contact)", so having
  // no contact meant having nothing to check. WhatsApp requires recorded
  // opt-in for template and marketing messages, so no contact is a block, not
  // a free pass.
  if (args.isTemplate && !contact) {
    block(
      "contact_not_saved",
      "This number is not saved as a contact with recorded opt-in consent — WhatsApp requires consent before a template message.",
    );
  }

  // 4. Who it would reach. The number is resolved once, here, so the gate and
  // the send agree on it and the sender can be shown the international form.
  let recipient: string | null = null;
  if (overWhatsApp) {
    const callingCode = countryOption(org?.country)?.callingCode ?? null;
    const resolved = resolveRecipientNumber(args.recipientPhone ?? contact?.phone, callingCode);
    if (resolved.ok) recipient = resolved.international;
    else if (contact || args.recipientPhone) block("recipient_invalid", resolved.reason);
  }

  if (contact) {
    if (args.isTemplate) {
      if (!contact.consent_given) {
        block(
          "no_consent",
          "No recorded opt-in consent for this contact — WhatsApp requires consent before template or marketing messages.",
        );
      }
    } else if (channel === "whatsapp" && args.conversationId) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: lastInbound } = await supabaseAdmin
        .from("messages")
        .select("id")
        .eq("conversation_id", args.conversationId)
        .eq("tenant_id", tenantId)
        .eq("direction", "inbound")
        .gte("created_at", since)
        .limit(1);
      if (!lastInbound || lastInbound.length === 0) {
        // The same sentence the provider's own refusal is given, so the gate
        // and Meta are never described two different ways.
        block("window_closed", WA_FAILURE_TEXT.window_closed);
      }
    }

    // 5. Routing: a lead routed to a specific number must be answered from it.
    if (routedLine && waNumberId && routedLine !== waNumberId) {
      block(
        "routed_to_other_number",
        "Routing rules assign this lead to a different WhatsApp number — reply from that line.",
      );
    }
  }

  return finish({ contactId, waNumberId, sendingNumber, recipient });
}
