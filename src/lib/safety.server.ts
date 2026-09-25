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
  conversationId?: string | null;
  contactId?: string | null;
  waNumberId?: string | null;
  isTemplate: boolean;
}): Promise<SendCheck> {
  const reasons: string[] = [];
  let contactId = args.contactId ?? null;
  let waNumberId = args.waNumberId ?? null;
  let channel: string | null = null;

  if (args.conversationId) {
    const { data: conv } = await supabaseAdmin
      .from("conversations")
      .select("contact_id, wa_number_id, channel")
      .eq("id", args.conversationId)
      .maybeSingle();
    if (conv) {
      contactId = contactId ?? conv.contact_id;
      waNumberId = waNumberId ?? conv.wa_number_id ?? null;
      channel = conv.channel;
    }
  }

  // 1. Number must be connected & enabled
  if (waNumberId) {
    const { data: num } = await supabaseAdmin
      .from("wa_numbers")
      .select("id, label, active")
      .eq("id", waNumberId)
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

  // A template sent to a raw phone number that belongs to no contact used to
  // pass every check: the consent rule lived inside "if (contact)", so having
  // no contact meant having nothing to check. WhatsApp requires recorded
  // opt-in for template and marketing messages, so no contact is a block, not
  // a free pass.
  if (args.isTemplate && !contact) {
    reasons.push(
      "This number is not saved as a contact with recorded opt-in consent — WhatsApp requires consent before a template message.",
    );
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

    // 3. Routing: a lead routed to a specific number must be answered from it.
    //
    // Scoped to the contact's own workspace, and limited to one row: a contact
    // with two routed leads (one per email they have used) made maybeSingle()
    // fail, and the failure was ignored -- so the rule quietly stopped applying
    // for exactly the busiest customers. Oldest lead wins, because that is the
    // routing decision the team has been working to.
    let leadQuery = supabaseAdmin
      .from("leads")
      .select("assigned_wa_number_id")
      .eq("contact_id", contact.id);
    // A contact with no workspace is a broken row, not a reason to read another
    // workspace's leads -- but an empty string is not a uuid, so the filter is
    // added only when there is a workspace to filter by.
    if (contact.tenant_id) leadQuery = leadQuery.eq("tenant_id", contact.tenant_id);
    const { data: lead, error: leadError } = await leadQuery
      .not("assigned_wa_number_id", "is", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (leadError) {
      console.error("[safety] could not read lead routing", leadError.message);
    }
    if (lead?.assigned_wa_number_id && waNumberId && lead.assigned_wa_number_id !== waNumberId) {
      reasons.push(
        "Routing rules assign this lead to a different WhatsApp number — reply from that line.",
      );
    }
  }

  return { allowed: reasons.length === 0, reasons, contactId, waNumberId };
}
