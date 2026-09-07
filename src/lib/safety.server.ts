// Server-only send-safety gate: marketing rules, consent, routing and
// subscription checks before any WhatsApp message leaves the platform.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type SendCheck = {
  allowed: boolean;
  reasons: string[];
  contactId: string | null;
  waNumberId: string | null;
};

/**
 * Decides whether a message may be sent and explains every block.
 * Rules enforced:
 *  - the WhatsApp number must be connected and enabled
 *  - the workspace subscription must be trial/active and not suspended
 *  - template (marketing) messages require recorded opt-in consent
 *  - free-form WhatsApp replies require an inbound message within 24h
 *  - if routing rules assigned the lead to a number, sends must use that number
 */
export async function checkSendPermission(args: {
  // Required: supabaseAdmin bypasses RLS, so every lookup below is filtered by
  // this tenant. Without it a caller could pass another company's conversation,
  // contact or number id and have the gate evaluated against their data.
  tenantId: string;
  conversationId?: string | null;
  contactId?: string | null;
  waNumberId?: string | null;
  isTemplate: boolean;
}): Promise<SendCheck> {
  const reasons: string[] = [];
  let contactId = args.contactId ?? null;
  let waNumberId = args.waNumberId ?? null;
  let channel: string | null = null;

  if (!args.tenantId) {
    return {
      allowed: false,
      reasons: ["Your workspace is still being set up."],
      contactId: null,
      waNumberId: null,
    };
  }

  if (args.conversationId) {
    const { data: conv } = await supabaseAdmin
      .from("conversations")
      .select("contact_id, wa_number_id, channel")
      .eq("id", args.conversationId)
      .eq("tenant_id", args.tenantId)
      .maybeSingle();
    if (!conv) {
      return {
        allowed: false,
        reasons: ["This conversation is not available in your workspace."],
        contactId: null,
        waNumberId: null,
      };
    }
    contactId = contactId ?? conv.contact_id;
    waNumberId = waNumberId ?? conv.wa_number_id ?? null;
    channel = conv.channel;
  }

  // 1. Number must be connected & enabled
  if (waNumberId) {
    const { data: num } = await supabaseAdmin
      .from("wa_numbers")
      .select("id, label, active")
      .eq("id", waNumberId)
      .eq("tenant_id", args.tenantId)
      .maybeSingle();
    if (!num) reasons.push("The selected WhatsApp number is not connected anymore.");
    else if (!num.active)
      reasons.push(`The WhatsApp number "${num.label}" is disabled in Settings.`);
  }

  // 2. Contact + workspace subscription state
  let contact: { id: string; tenant_id: string | null; consent_given: boolean } | null = null;
  if (contactId) {
    const { data } = await supabaseAdmin
      .from("contacts")
      .select("id, tenant_id, consent_given")
      .eq("id", contactId)
      .eq("tenant_id", args.tenantId)
      .maybeSingle();
    contact = data ?? null;
  }
  if (contact?.tenant_id) {
    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("suspended, subscription_status")
      .eq("id", contact.tenant_id)
      .maybeSingle();
    if (org?.suspended) {
      reasons.push("This workspace is suspended — contact your Flas account manager.");
    } else if (org && !["trial", "active"].includes(org.subscription_status)) {
      reasons.push(
        `Subscription is ${org.subscription_status} — sending is paused until the plan is active.`,
      );
    }
  }

  if (contact) {
    if (args.isTemplate) {
      if (!contact.consent_given) {
        reasons.push(
          "No recorded opt-in consent for this contact — WhatsApp requires consent before template or marketing messages.",
        );
      }
    } else if (channel === "whatsapp" && args.conversationId) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: lastInbound } = await supabaseAdmin
        .from("messages")
        .select("id")
        .eq("conversation_id", args.conversationId)
        .eq("direction", "inbound")
        .gte("created_at", since)
        .limit(1);
      if (!lastInbound || lastInbound.length === 0) {
        reasons.push(
          "The 24-hour WhatsApp reply window has closed — send an approved template to re-open the conversation.",
        );
      }
    }

    // 3. Routing: a lead routed to a specific number must be answered from it
    const { data: lead } = await supabaseAdmin
      .from("leads")
      .select("assigned_wa_number_id")
      .eq("contact_id", contact.id)
      .not("assigned_wa_number_id", "is", null)
      .maybeSingle();
    if (lead?.assigned_wa_number_id && waNumberId && lead.assigned_wa_number_id !== waNumberId) {
      reasons.push(
        "Routing rules assign this lead to a different WhatsApp number — reply from that line.",
      );
    }
  }

  return { allowed: reasons.length === 0, reasons, contactId, waNumberId };
}
