// Staff alerts use the same persisted, idempotent and policy-checked path as Inbox.
// There is no arbitrary-phone send here and no automatic new contact creation.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resolveContactByPhone } from "./contact-resolve.server";
import { substituteStaffAlertTags } from "./staff-alert-template";
import { sendConversationMessage } from "./wa-send.server";
import { logAudit } from "./audit.server";

export async function sendStaffAlert(args: {
  tenantId: string;
  userId: string;
  staffId: string;
  clientRef: string;
  template: string;
  lead: {
    customerName?: string | null;
    customerPhone?: string | null;
    customerRequirements?: string | null;
  };
}) {
  const blocked = async (error: string) => {
    await logAudit({
      tenantId: args.tenantId,
      actorId: args.userId,
      action: "staff_alert.blocked",
      entityType: "staff_routing",
      entityId: args.staffId,
      details: { outcome: "blocked" },
    });
    return {
      ok: false,
      state: "blocked" as const,
      error,
      messageId: null as string | null,
    };
  };
  const { data: actor, error: actorError } = await supabaseAdmin
    .from("profiles")
    .select("id, tenant_id, staff_role")
    .eq("id", args.userId)
    .eq("tenant_id", args.tenantId)
    .maybeSingle();
  if (actorError || !actor || !["company_admin", "super_admin"].includes(actor.staff_role))
    return blocked("A company admin must set up staff alerts.");
  const { data: staff, error } = await supabaseAdmin
    .from("tenant_staff_routing_numbers")
    .select("id, phone, department, notify_on_lead, is_active")
    .eq("tenant_id", args.tenantId)
    .eq("id", args.staffId)
    .maybeSingle();
  if (error || !staff || !staff.is_active || !staff.notify_on_lead)
    return blocked("Choose an active, opted-in staff recipient from this workspace.");
  const contact = await resolveContactByPhone(args.tenantId, staff.phone);
  if (!contact)
    return blocked("This staff number needs a saved contact and a WhatsApp conversation first.");
  const { data: savedContact, error: contactError } = await supabaseAdmin
    .from("contacts")
    .select("id, consent_given")
    .eq("id", contact.contactId)
    .eq("tenant_id", args.tenantId)
    .maybeSingle();
  if (contactError || !savedContact?.consent_given)
    return blocked("Record this colleague's opt-in consent before sending staff alerts.");
  const { data: conversation, error: conversationError } = await supabaseAdmin
    .from("conversations")
    .select("id")
    .eq("tenant_id", args.tenantId)
    .eq("contact_id", contact.contactId)
    .eq("channel", "whatsapp")
    .maybeSingle();
  if (conversationError || !conversation)
    return blocked(
      "Ask this colleague to message your connected WhatsApp number first. Alerts use the current 24-hour reply window.",
    );
  const { data: business, error: businessError } = await supabaseAdmin
    .from("organizations")
    .select("name")
    .eq("id", args.tenantId)
    .single();
  if (businessError || !business)
    return blocked("Could not check the workspace. Nothing was sent.");
  const body = substituteStaffAlertTags(args.template, {
    ...args.lead,
    department: staff.department,
    companyName: business.name,
    timestamp: new Date().toISOString(),
  });
  const result = await sendConversationMessage({
    tenantId: args.tenantId,
    userId: args.userId,
    conversationId: conversation.id,
    body,
    clientRef: args.clientRef,
    expectedRecipient: staff.phone,
  });
  await logAudit({
    tenantId: args.tenantId,
    actorId: args.userId,
    action: "staff_alert.result",
    entityType: "staff_routing",
    entityId: args.staffId,
    details: { outcome: result.state, messageId: result.messageId },
  });
  return {
    ok: result.ok,
    state: result.state,
    messageId: result.messageId,
    error:
      result.deliveryError ||
      result.blockedReasons.join(" ") ||
      (result.ok
        ? ""
        : "The send is already in progress. Check the staff conversation before retrying."),
  };
}
