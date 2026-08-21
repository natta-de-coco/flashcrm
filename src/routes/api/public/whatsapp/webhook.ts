import { createFileRoute } from "@tanstack/react-router";
import type { WaWebhookBody } from "@/lib/monitoring.server";

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
          await supabaseAdmin.from("wa_config").update({ webhook_verified: true }).eq("id", true);
          return new Response(challenge, { status: 200 });
        }
        return new Response("Forbidden", { status: 403 });
      },

      POST: async ({ request }) => {
        const { logWebhookEvent, finishWebhookEvent, processWaPayload, raiseAlert } = await import(
          "@/lib/monitoring.server"
        );

        const raw = await request.text();
        let body: WaWebhookBody;
        try {
          body = JSON.parse(raw) as WaWebhookBody;
        } catch {
          const id = await logWebhookEvent({ eventType: "invalid", payload: { raw: raw.slice(0, 2000) } });
          await finishWebhookEvent(id, { ok: false, error: "Payload was not valid JSON" });
          await raiseAlert({
            title: "WhatsApp webhook sent an invalid payload",
            message: "The request body could not be parsed as JSON.",
            severity: "warning",
          });
          return new Response("Bad request", { status: 400 });
        }

        const eventType = body.entry?.[0]?.changes?.[0]?.value?.statuses?.length
          ? "status"
          : "message";
        const waMessageId =
          body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id ??
          body.entry?.[0]?.changes?.[0]?.value?.statuses?.[0]?.id ??
          null;

        const eventId = await logWebhookEvent({ eventType, payload: body, waMessageId });
        const startedAt = Date.now();

        try {
          await processWaPayload(body);
          await finishWebhookEvent(eventId, { ok: true, durationMs: Date.now() - startedAt });
        } catch (error) {
          const detail = error instanceof Error ? error.message : "Unknown processing error";
          console.error("[whatsapp] webhook processing failed", error);
          await finishWebhookEvent(eventId, {
            ok: false,
            error: detail,
            durationMs: Date.now() - startedAt,
          });
          await raiseAlert({
            title: "WhatsApp webhook event failed",
            message: detail,
            severity: "critical",
          });
        }

        // Always 200 so Meta does not retry endlessly — retries happen from the app.
        return new Response("EVENT_RECEIVED", { status: 200 });
      },
    },
  },
});
