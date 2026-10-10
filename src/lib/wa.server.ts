// Server-only helpers for WhatsApp Cloud API + the AI chatbot.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const GRAPH_VERSION = "v21.0";

export type BotSettings = {
  enabled: boolean;
  bot_name: string;
  greeting: string;
  instructions: string;
  model: string;
  handoff_keywords: string[];
};

/**
 * Whether a bot has enough configuration to answer a customer.
 *
 * Both bot tables default `enabled` to true, so a workspace created five
 * minutes ago starts auto-replying to real customers with no business
 * knowledge, no greeting and no handoff keywords — answering from the model's
 * general knowledge, which is how a chatbot invents a delivery policy or a
 * price.
 *
 * Gating on configuration rather than flipping the column default fixes it for
 * workspaces that already exist, not only for new ones, and needs no migration.
 * The flag still means "the owner wants a bot"; this decides whether there is
 * yet a bot worth running. A handoff keyword list is deliberately not required
 * — needsHumanHandoff already has sensible built-in behaviour.
 */
export function botIsConfigured(settings: BotSettings): boolean {
  const instructions = (settings.instructions ?? "").trim();
  const greeting = (settings.greeting ?? "").trim();
  // Instructions are what ground it in the business. Without them the reply is
  // whatever the model imagines, so this is the one that must be present.
  return instructions.length >= 20 && greeting.length > 0;
}

/**
 * Per-tenant bot settings. Falls back to the platform-wide `bot_settings`
 * singleton's values (never its identity) only when a tenant has no row of
 * its own yet, so existing single-tenant behavior doesn't regress on day one.
 */
export async function getBotSettings(tenantId: string): Promise<BotSettings | null> {
  const { data } = await supabaseAdmin
    .from("tenant_bot_settings")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (data) return data as BotSettings;

  const { data: fallback } = await supabaseAdmin
    .from("bot_settings")
    .select("*")
    .eq("id", true)
    .maybeSingle();
  return (fallback as BotSettings) ?? null;
}

export type WaCredentials = { token: string; phoneNumberId: string };

/**
 * Resolves the credentials for a connected WhatsApp number, scoped to the
 * calling tenant. Every branch filters by tenant_id — a number belonging to
 * another tenant is never returned, even by id.
 */
export async function resolveWaCredentials(
  tenantId: string,
  waNumberId?: string | null,
): Promise<WaCredentials> {
  if (waNumberId) {
    const { data } = await supabaseAdmin
      .from("wa_numbers")
      .select("access_token, phone_number_id, active")
      .eq("id", waNumberId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (data && data.active) {
      return { token: data.access_token, phoneNumberId: data.phone_number_id };
    }
  } else {
    const { data } = await supabaseAdmin
      .from("wa_numbers")
      .select("access_token, phone_number_id")
      .eq("tenant_id", tenantId)
      .eq("is_default", true)
      .eq("active", true)
      .maybeSingle();
    if (data) return { token: data.access_token, phoneNumberId: data.phone_number_id };
  }

  const token = process.env["WHATSAPP_ACCESS_TOKEN"];
  const phoneNumberId = process.env["WHATSAPP_PHONE_NUMBER_ID"];
  if (!token || !phoneNumberId) {
    throw new Error(
      "WhatsApp is not configured yet. Connect a number in Settings or add WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID.",
    );
  }
  return { token, phoneNumberId };
}

/** Finds the connected wa_numbers row matching a webhook's phone_number_id, and which tenant owns it. */
export async function findWaNumberByPhoneId(
  phoneNumberId?: string | null,
): Promise<{ id: string; tenantId: string } | null> {
  if (!phoneNumberId) return null;
  const { data } = await supabaseAdmin
    .from("wa_numbers")
    .select("id, tenant_id")
    .eq("phone_number_id", phoneNumberId)
    .eq("active", true)
    .maybeSingle();
  if (!data?.tenant_id) return null;
  return { id: data.id, tenantId: data.tenant_id };
}

export async function sendWhatsAppText(to: string, body: string, creds: WaCredentials) {
  const { token, phoneNumberId } = creds;

  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body },
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`[whatsapp] send failed [${res.status}]: ${text}`);
    throw new Error(`WhatsApp send failed [${res.status}]: ${text}`);
  }
  try {
    const json = JSON.parse(text) as { messages?: Array<{ id?: string }> };
    return json.messages?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

type HistoryRow = { sender: string; body: string };

export async function generateBotReply(
  conversationId: string,
  settings: BotSettings,
): Promise<string | null> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) {
    console.error("[bot] Missing LOVABLE_API_KEY");
    return null;
  }

  const { data: history } = await supabaseAdmin
    .from("messages")
    .select("sender, body")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(30);

  const messages = [
    {
      role: "system",
      content: `${settings.instructions}\n\nYour name is ${settings.bot_name}. Keep replies under 700 characters and suitable for WhatsApp. If the customer asks for a human, apologises about a serious complaint, or you are unsure, reply briefly and say a team member will take over.`,
    },
    ...((history ?? []) as HistoryRow[]).map((m) => ({
      role: m.sender === "contact" ? "user" : "assistant",
      content: m.body,
    })),
  ];

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      "Lovable-API-Key": key,
    },
    body: JSON.stringify({ model: settings.model, messages }),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    console.error(`[bot] AI gateway failed [${res.status}]: ${errorBody}`);
    return null;
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json.choices?.[0]?.message?.content?.trim() || null;
}

export function needsHumanHandoff(text: string, keywords: string[]) {
  const lower = text.toLowerCase();
  return keywords.some((k) => k.trim() && lower.includes(k.trim().toLowerCase()));
}

type IngestArgs = {
  /**
   * Required. Derived by the caller from something the sender can't forge:
   * the widget's siteKey -> lead_sites.tenant_id, or the webhook's
   * phone_number_id -> wa_numbers.tenant_id. Never accept this from the
   * request body itself.
   */
  tenantId: string;
  channel: "whatsapp" | "web";
  phone?: string | null;
  sessionId?: string | null;
  name?: string | null;
  text: string;
  waMessageId?: string | null;
  waNumberId?: string | null;
};

/**
 * Stores an inbound customer message (creating the contact + conversation when
 * needed) and returns the bot reply that was generated and stored, if any.
 * Every read/write below is scoped to `tenantId` — this is the fix for the
 * cross-tenant message-routing ship-blocker (two tenants sharing a contact's
 * phone number used to collide into the same contact/conversation/history).
 */
export async function ingestInboundMessage(args: IngestArgs) {
  const { tenantId, channel, phone, sessionId, name, text, waMessageId, waNumberId } = args;
  if (!tenantId) throw new Error("ingestInboundMessage: tenantId is required");

  // 1. Contact — matched by phone WITHIN this tenant only.
  let contactId: string | null = null;
  if (phone) {
    const { data: existing } = await supabaseAdmin
      .from("contacts")
      .select("id")
      .eq("phone", phone)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (existing) {
      contactId = existing.id;
      if (name) await supabaseAdmin.from("contacts").update({ name }).eq("id", existing.id);
    } else {
      const { data: created, error } = await supabaseAdmin
        .from("contacts")
        .insert({ phone, name: name || phone, tenant_id: tenantId })
        .select("id")
        .single();
      if (error) throw error;
      contactId = created.id;
    }
  }

  // 2. Conversation
  let conversation: { id: string; bot_enabled: boolean; wa_number_id?: string | null } | null =
    null;
  if (channel === "web" && sessionId) {
    const { data } = await supabaseAdmin
      .from("conversations")
      .select("id, bot_enabled, contact_id")
      .eq("web_session_id", sessionId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (data) conversation = data;
    if (!conversation) {
      if (!contactId) {
        const { data: created, error } = await supabaseAdmin
          .from("contacts")
          .insert({ name: name || "Website visitor", tenant_id: tenantId })
          .select("id")
          .single();
        if (error) throw error;
        contactId = created.id;
      }
      const { data: created, error } = await supabaseAdmin
        .from("conversations")
        .insert({
          contact_id: contactId,
          channel: "web",
          web_session_id: sessionId,
          tenant_id: tenantId,
        })
        .select("id, bot_enabled")
        .single();
      if (error) throw error;
      conversation = created;

      try {
        const { assignConversationToNextAgent } = await import("./chat-assignment.server");
        await assignConversationToNextAgent(tenantId, created.id);
      } catch (assignErr) {
        console.error("[chat-assignment] Auto-assignment error:", assignErr);
      }
    }
  } else {
    const { data } = await supabaseAdmin
      .from("conversations")
      .select("id, bot_enabled, wa_number_id")
      .eq("contact_id", contactId!)
      .eq("channel", "whatsapp")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (data) conversation = data;
    if (conversation && waNumberId && !conversation.wa_number_id) {
      await supabaseAdmin
        .from("conversations")
        .update({ wa_number_id: waNumberId })
        .eq("id", conversation.id);
    }
    if (!conversation) {
      const { data: created, error } = await supabaseAdmin
        .from("conversations")
        .insert({
          contact_id: contactId!,
          channel: "whatsapp",
          wa_number_id: waNumberId ?? null,
          tenant_id: tenantId,
        })
        .select("id, bot_enabled")
        .single();
      if (error) throw error;
      conversation = created;

      try {
        const { assignConversationToNextAgent } = await import("./chat-assignment.server");
        await assignConversationToNextAgent(tenantId, created.id);
      } catch (assignErr) {
        console.error("[chat-assignment] Auto-assignment error:", assignErr);
      }
    }
  }

  // 3. Inbound message
  await supabaseAdmin.from("messages").insert({
    conversation_id: conversation.id,
    direction: "inbound",
    sender: "contact",
    body: text,
    wa_message_id: waMessageId ?? null,
    tenant_id: tenantId,
  });

  // Atomic increment — a read-then-write here would drop a count under
  // concurrent inbound messages on a busy conversation.
  await supabaseAdmin.rpc("increment_unread_count", { _conversation_id: conversation.id });
  await supabaseAdmin
    .from("conversations")
    .update({
      last_message_at: new Date().toISOString(),
      last_message_preview: text.slice(0, 140),
      status: "open",
    })
    .eq("id", conversation.id);

  if (contactId) {
    await supabaseAdmin
      .from("contacts")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", contactId);
  }

  // 4. Bot reply / handoff
  const settings = await getBotSettings(tenantId);
  if (!settings || !settings.enabled || !conversation.bot_enabled || !botIsConfigured(settings)) {
    return {
      conversationId: conversation.id,
      reply: null as string | null,
      replyMessageId: null as string | null,
    };
  }

  if (needsHumanHandoff(text, settings.handoff_keywords ?? [])) {
    await supabaseAdmin
      .from("conversations")
      .update({ bot_enabled: false, status: "pending" })
      .eq("id", conversation.id);
    const handoff = "Thanks — I'm connecting you with a member of our team right now.";
    const replyMessageId = await storeOutbound(tenantId, conversation.id, handoff, "bot");
    return { conversationId: conversation.id, reply: handoff, replyMessageId };
  }

  const reply = await generateBotReply(conversation.id, settings);
  if (!reply) return { conversationId: conversation.id, reply: null, replyMessageId: null };

  const replyMessageId = await storeOutbound(tenantId, conversation.id, reply, "bot");
  return { conversationId: conversation.id, reply, replyMessageId };
}

/** Returns the id of the inserted message row, so callers can later attach a
 *  wa_message_id by primary key instead of matching on message body text
 *  (matching by text let two concurrent identical canned replies tag the
 *  wrong row's delivery status). */
export async function storeOutbound(
  tenantId: string,
  conversationId: string,
  body: string,
  sender: "bot" | "agent",
  senderId?: string | null,
  waMessageId?: string | null,
): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("messages")
    .insert({
      conversation_id: conversationId,
      direction: "outbound",
      sender,
      sender_id: senderId ?? null,
      body,
      wa_message_id: waMessageId ?? null,
      tenant_id: tenantId,
    })
    .select("id")
    .single();
  await supabaseAdmin
    .from("conversations")
    .update({
      last_message_at: new Date().toISOString(),
      last_message_preview: body.slice(0, 140),
    })
    .eq("id", conversationId);
  return data?.id ?? null;
}

/** Sends an approved WhatsApp message template. */
export async function sendWhatsAppTemplate(
  to: string,
  name: string,
  language: string,
  variables: string[] = [],
  creds: WaCredentials,
) {
  const { token, phoneNumberId } = creds;

  const components = variables.length
    ? [{ type: "body", parameters: variables.map((text) => ({ type: "text", text })) }]
    : [];

  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: { name, language: { code: language }, components },
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`[whatsapp] template send failed [${res.status}]: ${text}`);
    throw new Error(`WhatsApp template send failed [${res.status}]: ${text}`);
  }
  try {
    const json = JSON.parse(text) as { messages?: Array<{ id?: string }> };
    return json.messages?.[0]?.id ?? null;
  } catch {
    return null;
  }
}
