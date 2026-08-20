import { createFileRoute } from "@tanstack/react-router";

type WaWebhookBody = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
        messages?: Array<{
          id?: string;
          from?: string;
          type?: string;
          text?: { body?: string };
        }>;
      };
    }>;
  }>;
};

export const Route = createFileRoute("/api/public/whatsapp/webhook")({
  server: {
    handlers: {
      // Meta verification handshake
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge");
        const expected = process.env["WHATSAPP_VERIFY_TOKEN"];

        if (mode === "subscribe" && expected && token === expected && challenge) {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          await supabaseAdmin
            .from("wa_config")
            .update({ webhook_verified: true })
            .eq("id", true);
          return new Response(challenge, { status: 200 });
        }
        return new Response("Forbidden", { status: 403 });
      },

      POST: async ({ request }) => {
        let body: WaWebhookBody;
        try {
          body = (await request.json()) as WaWebhookBody;
        } catch {
          return new Response("Bad request", { status: 400 });
        }

        const { ingestInboundMessage, sendWhatsAppText, storeOutbound } = await import(
          "@/lib/wa.server"
        );

        for (const entry of body.entry ?? []) {
          for (const change of entry.changes ?? []) {
            const value = change.value;
            const contactName = value?.contacts?.[0]?.profile?.name ?? null;
            for (const message of value?.messages ?? []) {
              const text = message.text?.body;
              const from = message.from;
              if (!text || !from) continue;

              try {
                const { conversationId, reply } = await ingestInboundMessage({
                  channel: "whatsapp",
                  phone: from,
                  name: contactName,
                  text,
                  waMessageId: message.id ?? null,
                });

                if (reply) {
                  try {
                    const waId = await sendWhatsAppText(from, reply);
                    if (waId) {
                      const { supabaseAdmin } = await import(
                        "@/integrations/supabase/client.server"
                      );
                      await supabaseAdmin
                        .from("messages")
                        .update({ wa_message_id: waId })
                        .eq("conversation_id", conversationId)
                        .is("wa_message_id", null)
                        .eq("body", reply);
                    }
                  } catch (sendError) {
                    console.error("[whatsapp] reply send failed", sendError);
                    await storeOutbound(
                      conversationId,
                      "(delivery failed — check WhatsApp credentials)",
                      "bot",
                    );
                  }
                }
              } catch (error) {
                console.error("[whatsapp] ingest failed", error);
              }
            }
          }
        }

        // Always 200 so Meta does not retry endlessly.
        return new Response("EVENT_RECEIVED", { status: 200 });
      },
    },
  },
});
