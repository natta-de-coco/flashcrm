import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const SendSchema = z.object({
  conversationId: z.string().uuid(),
  body: z.string().min(1).max(4000),
  /**
   * The browser's own reference for this one message. A double click or a
   * retried request repeats it, and the server sends the message once.
   */
  clientRef: z.string().uuid().optional(),
});

/** The signed-in person's workspace, or the reason it cannot be read. */
async function requireTenant(context: {
  supabase: {
    rpc: (
      fn: "current_tenant_id",
    ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  };
}): Promise<string> {
  const { data: tenantId, error: tenantError } = await context.supabase.rpc("current_tenant_id");
  // A recursion/timeout failure of this lookup used to be reported as
  // "no workspace", which sent people hunting a problem that was not theirs.
  if (tenantError) throw new Error(`Could not load your workspace: ${tenantError.message}`);
  if (!tenantId) throw new Error("Your workspace is still being set up.");
  return tenantId as string;
}

/** Agent reply: stores the message and delivers it over WhatsApp when relevant. */
export const sendAgentMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SendSchema.parse(input))
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenant(context);
    const { sendConversationMessage } = await import("@/lib/wa-send.server");
    return sendConversationMessage({
      tenantId,
      userId: context.userId,
      conversationId: data.conversationId,
      body: data.body,
      clientRef: data.clientRef ?? null,
    });
  });

/**
 * What the composer shows before a reply is written: the number it would be
 * sent from, the customer's number as WhatsApp will dial it, and anything that
 * would stop the send -- decided by the same gate the send uses.
 */
export const getSendContext = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ conversationId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenant(context);
    const { describeSendContext } = await import("@/lib/wa-send.server");
    return describeSendContext(tenantId, data.conversationId);
  });

const BotSchema = z.object({ conversationId: z.string().uuid() });

/** Ask the AI assistant to draft the next reply for this conversation. */
export const draftBotReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BotSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getBotSettings, generateBotReply } = await import("@/lib/wa.server");

    const { data: tenantId, error: tenantError } = await context.supabase.rpc("current_tenant_id");
    // A recursion/timeout failure of this lookup used to be reported as
    // "no workspace", which sent people hunting a problem that was not theirs.
    if (tenantError) throw new Error(`Could not load your workspace: ${tenantError.message}`);
    if (!tenantId) throw new Error("Your workspace is still being set up.");

    const { data: conversation } = await supabaseAdmin
      .from("conversations")
      .select("id")
      .eq("id", data.conversationId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!conversation) throw new Error("Conversation not found");

    const settings = await getBotSettings(tenantId as string);
    if (!settings) throw new Error("Chatbot is not configured");
    const draft = await generateBotReply(tenantId as string, data.conversationId, settings, {
      throwOnFailure: true,
    });
    if (!draft) throw new Error("The assistant could not generate a reply right now");
    return { draft: draft.text };
  });

const RetrySchema = z.object({ eventId: z.string().uuid() });

/** Re-processes a failed WhatsApp webhook event. */
export const retryWebhookEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RetrySchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { processWaPayload, finishWebhookEvent } = await import("@/lib/monitoring.server");

    const { data: tenantId, error: tenantError } = await context.supabase.rpc("current_tenant_id");
    // A recursion/timeout failure of this lookup used to be reported as
    // "no workspace", which sent people hunting a problem that was not theirs.
    if (tenantError) throw new Error(`Could not load your workspace: ${tenantError.message}`);
    const { data: isSuperAdmin } = await context.supabase.rpc("is_super_admin");

    let query = supabaseAdmin
      .from("webhook_events")
      .select("id, payload, attempts, tenant_id")
      .eq("id", data.eventId);
    if (!isSuperAdmin) query = query.eq("tenant_id", tenantId as string);
    const { data: event, error } = await query.single();
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

const TemplateSchema = z
  .object({
    templateId: z.string().uuid(),
    conversationId: z.string().uuid().optional(),
    phone: z.string().min(6).max(24).optional(),
    variables: z.array(z.string().max(500)).max(10).default([]),
    clientRef: z.string().uuid().optional(),
  })
  .refine((value) => Boolean(value.conversationId) !== Boolean(value.phone), {
    message: "Choose a conversation or a phone number, not both.",
  });

/** Sends an approved WhatsApp template to a conversation or a saved contact's number. */
export const sendTemplateMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => TemplateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenant(context);
    const { sendTemplate } = await import("@/lib/wa-send.server");
    return sendTemplate({
      tenantId,
      userId: context.userId,
      templateId: data.templateId,
      conversationId: data.conversationId ?? null,
      phone: data.phone ?? null,
      variables: data.variables,
      clientRef: data.clientRef ?? null,
    });
  });

const TranslateSchema = z.object({
  messageId: z.string().uuid(),
  targetLanguage: z.string().min(2).max(50).default("English"),
});

/** Auto-translate a message using Flas AI and cache the result. */
export const translateMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => TranslateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { callFlashAi } = await import("@/lib/flash-ai.server");
    const { logAudit } = await import("@/lib/audit.server");

    const { data: tenantId, error: tenantError } = await context.supabase.rpc("current_tenant_id");
    // A recursion/timeout failure of this lookup used to be reported as
    // "no workspace", which sent people hunting a problem that was not theirs.
    if (tenantError) throw new Error(`Could not load your workspace: ${tenantError.message}`);
    if (!tenantId) throw new Error("Your workspace is still being set up.");

    const { data: message, error } = await supabaseAdmin
      .from("messages")
      .select("id, body, translated_body, detected_language")
      .eq("id", data.messageId)
      .eq("tenant_id", tenantId)
      .single();
    if (error || !message) throw new Error("Message not found");

    if (message.translated_body) {
      return {
        translatedBody: message.translated_body,
        detectedLanguage: message.detected_language,
      };
    }

    const system = [
      "You are a translation assistant inside Flas CRM.",
      "Detect the language of the user's message and translate it into the requested target language.",
      "Return ONLY a JSON object with two fields: 'detectedLanguage' (the original language name in English) and 'translation' (the translated text).",
      "Do not add markdown, explanations, or wrapping. Preserve the original tone and formatting as much as possible.",
    ].join(" ");

    const user = `Target language: ${data.targetLanguage}\n\nMessage:\n${message.body}`;

    let parsed: { detectedLanguage?: string; translation?: string } = {};
    try {
      const raw = await callFlashAi(system, user, {
        tenantId: tenantId as string,
        feature: "translate",
        userId: context.userId,
      });
      const cleaned = raw
        .replace(/^\s*```(?:json)?\s*/i, "")
        .replace(/\s*```\s*$/i, "")
        .trim();
      parsed = JSON.parse(cleaned) as typeof parsed;
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

    return {
      translatedBody: parsed.translation,
      detectedLanguage: parsed.detectedLanguage ?? null,
    };
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

    const { data: tenantId, error: tenantError } = await context.supabase.rpc("current_tenant_id");
    // A recursion/timeout failure of this lookup used to be reported as
    // "no workspace", which sent people hunting a problem that was not theirs.
    if (tenantError) throw new Error(`Could not load your workspace: ${tenantError.message}`);
    if (!tenantId) throw new Error("Your workspace is still being set up.");

    const { data: products, error } = await supabaseAdmin
      .from("products")
      .select("id, title, sku, price, description, images")
      .eq("tenant_id", tenantId)
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
      body: ["Here are the products you asked about:", "", ...lines].join("\n"),
      products: products.map((p) => ({ id: p.id, title: p.title, price: p.price })),
    };
  });
