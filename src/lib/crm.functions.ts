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
    const { sendWhatsAppText, storeOutbound, resolveWaCredentials } = await import("@/lib/wa.server");

    const { data: conversation, error } = await supabaseAdmin
      .from("conversations")
      .select("id, channel, contact_id, wa_number_id")
      .eq("id", data.conversationId)
      .single();
    if (error || !conversation) throw new Error("Conversation not found");

    // Compliance gate: consent, 24h window, routing rules, subscription.
    const { checkSendPermission } = await import("@/lib/safety.server");
    const { logAudit } = await import("@/lib/audit.server");
    const safety = await checkSendPermission({
      conversationId: conversation.id,
      isTemplate: false,
    });
    if (!safety.allowed) {
      await logAudit({
        action: "message.blocked",
        actorId: context.userId,
        entityType: "conversation",
        entityId: conversation.id,
        details: { reasons: safety.reasons },
      });
      return { ok: false, deliveryError: null, blockedReasons: safety.reasons };
    }

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
          waId = await sendWhatsAppText(
            contact.phone,
            data.body,
            await resolveWaCredentials(conversation.wa_number_id),
          );
        } catch (sendError) {
          deliveryError = sendError instanceof Error ? sendError.message : "Delivery failed";
        }
      } else {
        deliveryError = "This contact has no phone number";
      }
    }

    await storeOutbound(conversation.id, data.body, "agent", context.userId, waId);
    await logAudit({
      action: "message.send",
      actorId: context.userId,
      entityType: "conversation",
      entityId: conversation.id,
      details: { channel: conversation.channel, delivered: !deliveryError },
    });
    return { ok: !deliveryError, deliveryError, blockedReasons: [] as string[] };
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

const RetrySchema = z.object({ eventId: z.string().uuid() });

/** Re-processes a failed WhatsApp webhook event. */
export const retryWebhookEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RetrySchema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { processWaPayload, finishWebhookEvent } = await import("@/lib/monitoring.server");

    const { data: event, error } = await supabaseAdmin
      .from("webhook_events")
      .select("id, payload, attempts")
      .eq("id", data.eventId)
      .single();
    if (error || !event) throw new Error("Webhook event not found");

    await supabaseAdmin
      .from("webhook_events")
      .update({ attempts: (event.attempts ?? 1) + 1, last_retry_at: new Date().toISOString() })
      .eq("id", event.id);

    const startedAt = Date.now();
    try {
      await processWaPayload(event.payload as never);
      await finishWebhookEvent(event.id, {
        ok: true,
        durationMs: Date.now() - startedAt,
        retry: true,
      });
      return { ok: true, error: null as string | null };
    } catch (retryError) {
      const detail = retryError instanceof Error ? retryError.message : "Retry failed";
      await finishWebhookEvent(event.id, {
        ok: false,
        error: detail,
        durationMs: Date.now() - startedAt,
        retry: true,
      });
      return { ok: false, error: detail };
    }
  });

const TemplateSchema = z.object({
  templateId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  phone: z.string().min(6).max(24).optional(),
  variables: z.array(z.string().max(500)).max(10).default([]),
});

/** Sends an approved WhatsApp template to a conversation or a raw phone number. */
export const sendTemplateMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => TemplateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendWhatsAppTemplate, storeOutbound, resolveWaCredentials } = await import(
      "@/lib/wa.server"
    );

    const { data: template, error } = await supabaseAdmin
      .from("wa_templates")
      .select("*")
      .eq("id", data.templateId)
      .single();
    if (error || !template) throw new Error("Template not found");
    if (template.status !== "approved") throw new Error("Only approved templates can be sent");

    let phone = data.phone ?? null;
    let conversationId = data.conversationId ?? null;
    let waNumberId: string | null = null;

    if (conversationId) {
      const { data: conv } = await supabaseAdmin
        .from("conversations")
        .select("contact_id, wa_number_id")
        .eq("id", conversationId)
        .single();
      if (conv) {
        waNumberId = conv.wa_number_id ?? null;
        if (!phone) {
          const { data: contact } = await supabaseAdmin
            .from("contacts")
            .select("phone")
            .eq("id", conv.contact_id)
            .single();
          phone = contact?.phone ?? null;
        }
      }
    }
    if (!phone) throw new Error("No WhatsApp number available for this recipient");

    // Compliance gate: template sends require recorded opt-in consent, an
    // active number, the correct routed line and an active subscription.
    const { checkSendPermission } = await import("@/lib/safety.server");
    const { logAudit } = await import("@/lib/audit.server");
    let contactId: string | null = null;
    if (!conversationId) {
      const { data: byPhone } = await supabaseAdmin
        .from("contacts")
        .select("id")
        .eq("phone", phone)
        .maybeSingle();
      contactId = byPhone?.id ?? null;
    }
    const safety = await checkSendPermission({
      conversationId,
      contactId,
      waNumberId,
      isTemplate: true,
    });
    if (!safety.allowed) {
      await logAudit({
        action: "message.blocked",
        actorId: context.userId,
        entityType: conversationId ? "conversation" : "phone",
        entityId: conversationId ?? phone,
        details: { template: template.name, reasons: safety.reasons },
      });
      return { ok: false, waId: null, rendered: null, blockedReasons: safety.reasons };
    }

    const waId = await sendWhatsAppTemplate(
      phone,
      template.name,
      template.language,
      data.variables,
      await resolveWaCredentials(waNumberId),
    );

    let rendered = template.body;
    data.variables.forEach((value, index) => {
      rendered = rendered.replaceAll(`{{${index + 1}}}`, value);
    });

    if (conversationId) {
      await storeOutbound(conversationId, rendered, "agent", context.userId, waId);
    }
    await logAudit({
      action: "message.template_send",
      actorId: context.userId,
      entityType: conversationId ? "conversation" : "phone",
      entityId: conversationId ?? phone,
      details: { template: template.name, waId },
    });

  return { ok: true, waId, rendered, blockedReasons: [] as string[] };
});

const TranslateSchema = z.object({
  messageId: z.string().uuid(),
  targetLanguage: z.string().min(2).max(50).default("English"),
});

/** Auto-translate a message using Flash AI and cache the result. */
export const translateMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => TranslateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { callFlashAi } = await import("@/lib/flash-ai.server");
    const { logAudit } = await import("@/lib/audit.server");

    const { data: message, error } = await supabaseAdmin
      .from("messages")
      .select("id, body, translated_body, detected_language")
      .eq("id", data.messageId)
      .single();
    if (error || !message) throw new Error("Message not found");

    if (message.translated_body) {
      return { translatedBody: message.translated_body, detectedLanguage: message.detected_language };
    }

    const system = [
      "You are a translation assistant inside Flash CRM.",
      "Detect the language of the user's message and translate it into the requested target language.",
      "Return ONLY a JSON object with two fields: 'detectedLanguage' (the original language name in English) and 'translation' (the translated text).",
      "Do not add markdown, explanations, or wrapping. Preserve the original tone and formatting as much as possible.",
    ].join(" ");

    const user = `Target language: ${data.targetLanguage}\n\nMessage:\n${message.body}`;

    let parsed: { detectedLanguage?: string; translation?: string } = {};
    try {
      const raw = await callFlashAi(system, user);
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      throw new Error("Translation failed — the AI did not return valid JSON. Try again.");
    }

    if (!parsed.translation) {
      throw new Error("Translation failed — no translation returned.");
    }

    await supabaseAdmin
      .from("messages")
      .update({
        translated_body: parsed.translation,
        detected_language: parsed.detectedLanguage ?? null,
      })
      .eq("id", message.id);

    await logAudit({
      action: "message.translate",
      actorId: context.userId,
      entityType: "message",
      entityId: message.id,
      details: { targetLanguage: data.targetLanguage, detectedLanguage: parsed.detectedLanguage },
    });

    return { translatedBody: parsed.translation, detectedLanguage: parsed.detectedLanguage ?? null };
  });

const CatalogSchema = z.object({
  productIds: z.array(z.string().uuid()).min(1).max(5),
});

/** Build a WhatsApp-friendly product message from the catalog. */
export const buildCatalogMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CatalogSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: products, error } = await supabaseAdmin
      .from("products")
      .select("id, title, sku, price, description, images")
      .in("id", data.productIds);
    if (error) throw new Error("Could not load products");
    if (!products?.length) throw new Error("No products selected");

    const lines = products.map((p) => {
      const price = p.price != null ? `$${Number(p.price).toFixed(2)}` : "Price on request";
      const sku = p.sku ? `SKU: ${p.sku}\n` : "";
      const desc = p.description ? `${p.description}\n` : "";
      const image = p.images?.[0] ? `\n${p.images[0]}` : "";
      return `*${p.title}*\n${sku}${desc}Price: ${price}${image}`;
    });

    return {
      body: [`Here are the products you asked about:", ""`, ...lines].join("\n"),
      products: products.map((p) => ({ id: p.id, title: p.title, price: p.price })),
    };
  });
