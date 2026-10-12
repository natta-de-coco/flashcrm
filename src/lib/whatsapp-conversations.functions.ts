import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Opens a tenant-owned conversation. This never sends a message. */
export const openContactWhatsApp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ contactId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: conversationId, error } = await context.supabase.rpc("open_contact_whatsapp", {
      p_contact_id: data.contactId,
    });
    if (error) {
      if (error.code === "PGRST202" || error.code === "42883") {
        throw new Error(
          "WhatsApp conversation setup is awaiting a database update. Ask your administrator to finish setup.",
        );
      }
      throw new Error(error.message);
    }
    if (!conversationId)
      throw new Error("Could not open the WhatsApp conversation. Please try again.");
    return { conversationId };
  });
