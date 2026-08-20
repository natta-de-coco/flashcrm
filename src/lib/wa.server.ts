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

export async function getBotSettings(): Promise<BotSettings | null> {
  const { data } = await supabaseAdmin.from("bot_settings").select("*").eq("id", true).maybeSingle();
  return (data as BotSettings) ?? null;
}

export async function sendWhatsAppText(to: string, body: string) {
  const token = process.env["WHATSAPP_ACCESS_TOKEN"];
  const phoneNumberId = process.env["WHATSAPP_PHONE_NUMBER_ID"];
  if (!token || !phoneNumberId) {
    throw new Error(
      "WhatsApp is not configured yet. Add WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID.",
    );
  }

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
  channel: "whatsapp" | "web";
  phone?: string | null;
  sessionId?: string | null;
  name?: string | null;
  text: string;
  waMessageId?: string | null;
};

/**
 * Stores an inbound customer message (creating the contact + conversation when
 * needed) and returns the bot reply that was generated and stored, if any.
 */
export async function ingestInboundMessage(args: IngestArgs) {
  const { channel, phone, sessionId, name, text, waMessageId } = args;

  // 1. Contact
  let contactId: string | null = null;
  if (phone) {
    const { data: existing } = await supabaseAdmin
      .from("contacts")
      .select("id")
      .eq("phone", phone)
      .maybeSingle();
    if (existing) {
      contactId = existing.id;
      if (name) await supabaseAdmin.from("contacts").update({ name }).eq("id", existing.id);
    } else {
      const { data: created, error } = await supabaseAdmin
        .from("contacts")
        .insert({ phone, name: name || phone })
        .select("id")
        .single();
      if (error) throw error;
      contactId = created.id;
    }
  }

  // 2. Conversation
  let conversation: { id: string; bot_enabled: boolean } | null = null;
  if (channel === "web" && sessionId) {
    const { data } = await supabaseAdmin
      .from("conversations")
      .select("id, bot_enabled, contact_id")
      .eq("web_session_id", sessionId)
      .maybeSingle();
    if (data) conversation = data;
    if (!conversation) {
      if (!contactId) {
        const { data: created, error } = await supabaseAdmin
          .from("contacts")
          .insert({ name: name || "Website visitor" })
          .select("id")
          .single();
        if (error) throw error;
        contactId = created.id;
      }
      const { data: created, error } = await supabaseAdmin
        .from("conversations")
        .insert({ contact_id: contactId, channel: "web", web_session_id: sessionId })
        .select("id, bot_enabled")
        .single();
      if (error) throw error;
      conversation = created;
    }
  } else {
    const { data } = await supabaseAdmin
      .from("conversations")
      .select("id, bot_enabled")
      .eq("contact_id", contactId!)
      .eq("channel", "whatsapp")
      .maybeSingle();
    if (data) conversation = data;
    if (!conversation) {
      const { data: created, error } = await supabaseAdmin
        .from("conversations")
        .insert({ contact_id: contactId!, channel: "whatsapp" })
        .select("id, bot_enabled")
        .single();
      if (error) throw error;
      conversation = created;
    }
  }

  // 3. Inbound message
  await supabaseAdmin.from("messages").insert({
    conversation_id: conversation.id,
    direction: "inbound",
    sender: "contact",
    body: text,
    wa_message_id: waMessageId ?? null,
  });

  const { data: convRow } = await supabaseAdmin
    .from("conversations")
    .select("unread_count")
    .eq("id", conversation.id)
    .single();

  await supabaseAdmin
    .from("conversations")
    .update({
      last_message_at: new Date().toISOString(),
      last_message_preview: text.slice(0, 140),
      status: "open",
      unread_count: (convRow?.unread_count ?? 0) + 1,
    })
    .eq("id", conversation.id);

  if (contactId) {
    await supabaseAdmin
      .from("contacts")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", contactId);
  }

  // 4. Bot reply / handoff
  const settings = await getBotSettings();
  if (!settings || !settings.enabled || !conversation.bot_enabled) {
    return { conversationId: conversation.id, reply: null as string | null };
  }

  if (needsHumanHandoff(text, settings.handoff_keywords ?? [])) {
    await supabaseAdmin
      .from("conversations")
      .update({ bot_enabled: false, status: "pending" })
      .eq("id", conversation.id);
    const handoff = "Thanks — I'm connecting you with a member of our team right now.";
    await storeOutbound(conversation.id, handoff, "bot");
    return { conversationId: conversation.id, reply: handoff };
  }

  const reply = await generateBotReply(conversation.id, settings);
  if (!reply) return { conversationId: conversation.id, reply: null };

  await storeOutbound(conversation.id, reply, "bot");
  return { conversationId: conversation.id, reply };
}

export async function storeOutbound(
  conversationId: string,
  body: string,
  sender: "bot" | "agent",
  senderId?: string | null,
  waMessageId?: string | null,
) {
  await supabaseAdmin.from("messages").insert({
    conversation_id: conversationId,
    direction: "outbound",
    sender,
    sender_id: senderId ?? null,
    body,
    wa_message_id: waMessageId ?? null,
  });
  await supabaseAdmin
    .from("conversations")
    .update({
      last_message_at: new Date().toISOString(),
      last_message_preview: body.slice(0, 140),
    })
    .eq("id", conversationId);
}
