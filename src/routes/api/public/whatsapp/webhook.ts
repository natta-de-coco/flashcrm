import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import type { WaWebhookBody } from "@/lib/monitoring.server";

/**
 * Verifies Meta's X-Hub-Signature-256 header against the app secret of the
 * connected number the payload targets (or the WHATSAPP_APP_SECRET env
 * fallback). Returns true when verification passes or when no secret is
 * configured yet (with a console warning, so existing setups keep working).
 */
async function verifySignature(raw: string, body: WaWebhookBody, header: string | null) {
  const phoneNumberId = body.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;

  let secret: string | null = null;
  if (phoneNumberId) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("wa_numbers")
      .select("app_secret")
      .eq("phone_number_id", phoneNumberId)
      .maybeSingle();
    secret = data?.app_secret ?? null;
  }
  if (!secret) secret = process.env["WHATSAPP_APP_SECRET"] ?? null;

  if (!secret) {
    console.warn("[whatsapp] no app secret configured — webhook signature not enforced");
    return { ok: true as const, enforced: false };
  }
  if (!header || !header.startsWith("sha256=")) return { ok: false as const, enforced: true };

  const expected = `sha256=${createHmac("sha256", secret).update(raw, "utf8").digest("hex")}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  const ok = a.length === b.length && timingSafeEqual(a, b);
  return { ok, enforced: true };
}

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

        // Reject spoofed payloads before anything is stored or processed.
        const signature = await verifySignature(
          raw,
          body,
          request.headers.get("x-hub-signature-256"),
        );
        if (!signature.ok) {
          const id = await logWebhookEvent({ eventType: "rejected", payload: body });
          await finishWebhookEvent(id, { ok: false, error: "Signature verification failed" });
          await raiseAlert({
            title: "Rejected a WhatsApp webhook with an invalid signature",
            message:
              "A payload failed X-Hub-Signature-256 verification and was discarded. Check that the Meta app secret matches the connected number.",
            severity: "critical",
          });
          const { logAudit } = await import("@/lib/audit.server");
          await logAudit({ action: "webhook.signature_rejected", entityType: "webhook_event" });
          return new Response("Invalid signature", { status: 401 });
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
