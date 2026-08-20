import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const SendSchema = z.object({
  conversationId: z.string().uuid(),
  body: z.string().min(1).max(4000),
});

/** Agent reply: stores the message and delivers it over WhatsApp when relevant. */
export const sendAgentMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SendSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendWhatsAppText, storeOutbound } = await import("@/lib/wa.server");

    const { data: conversation, error } = await supabaseAdmin
      .from("conversations")
      .select("id, channel, contact_id")
      .eq("id", data.conversationId)
      .single();
    if (error || !conversation) throw new Error("Conversation not found");

    let waId: string | null = null;
    let deliveryError: string | null = null;

    if (conversation.channel === "whatsapp") {
      const { data: contact } = await supabaseAdmin
        .from("contacts")
        .select("phone")
        .eq("id", conversation.contact_id)
        .single();
      if (contact?.phone) {
        try {
          waId = await sendWhatsAppText(contact.phone, data.body);
        } catch (sendError) {
          deliveryError = sendError instanceof Error ? sendError.message : "Delivery failed";
        }
      } else {
        deliveryError = "This contact has no phone number";
      }
    }

    await storeOutbound(conversation.id, data.body, "agent", context.userId, waId);
    return { ok: !deliveryError, deliveryError };
  });

const BotSchema = z.object({ conversationId: z.string().uuid() });

/** Ask the AI assistant to draft the next reply for this conversation. */
export const draftBotReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BotSchema.parse(input))
  .handler(async ({ data }) => {
    const { getBotSettings, generateBotReply } = await import("@/lib/wa.server");
    const settings = await getBotSettings();
    if (!settings) throw new Error("Chatbot is not configured");
    const draft = await generateBotReply(data.conversationId, settings);
    if (!draft) throw new Error("The assistant could not generate a reply right now");
    return { draft };
  });
