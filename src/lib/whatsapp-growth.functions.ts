import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";

/** Real, tenant-scoped WhatsApp growth groups for the marketing workspace. */
export const getWhatsAppGrowthSegments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [
      { data: contacts, error: contactsError },
      { data: conversations, error: conversationsError },
    ] = await Promise.all([
      context.supabase
        .from("contacts")
        .select("id, consent_given, phone, stage, last_message_at")
        .eq("consent_given", true)
        .not("phone", "is", null)
        .limit(2000),
      context.supabase
        .from("conversations")
        .select("id, contact_id")
        .eq("channel", "whatsapp")
        .limit(2000),
    ]);
    if (contactsError) throw contactsError;
    if (conversationsError) throw conversationsError;

    const conversationIds = (conversations ?? []).map((conversation) => conversation.id);
    const { data: messages, error: messagesError } = conversationIds.length
      ? await context.supabase
          .from("messages")
          .select("conversation_id, direction, created_at")
          .in("conversation_id", conversationIds)
          .order("created_at", { ascending: false })
          .limit(5000)
      : { data: [], error: null };
    if (messagesError) throw messagesError;

    const { buildWhatsAppGrowthSegments } = await import("@/lib/whatsapp-growth-segments");
    return buildWhatsAppGrowthSegments(
      (contacts ?? []).map((contact) => ({
        id: contact.id,
        consentGiven: contact.consent_given,
        hasPhone: Boolean(contact.phone),
        stage: contact.stage,
        lastMessageAt: contact.last_message_at,
      })),
      (conversations ?? []).map((conversation) => ({
        id: conversation.id,
        contactId: conversation.contact_id,
      })),
      (messages ?? []).map((message) => ({
        conversationId: message.conversation_id,
        direction: message.direction,
        createdAt: message.created_at,
      })),
    );
  });
