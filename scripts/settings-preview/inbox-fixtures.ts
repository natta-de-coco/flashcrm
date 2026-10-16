// Synthetic UI fixtures only. No real auth, database, provider or messages.
import { fixtureState, supabase as settingsDb } from "./functions";
let next = 0;
const messages: Record<string, any[]> = {};
const conversations = (scope: string) =>
  ["Maya", "Omar"].map((name, index) => ({
    id: `${scope}-chat-${index}`,
    contact_id: `contact-${index}`,
    channel: "whatsapp",
    status: "open",
    assigned_to: null,
    bot_enabled: false,
    tags: [],
    unread_count: index ? 1 : 0,
    last_message_at: new Date(Date.now() - (index ? 2 * 86400000 : 60000)).toISOString(),
    last_message_preview: index
      ? "Could you share a quotation?"
      : "Thank you. Can we arrange a demonstration?",
    contacts: {
      id: `contact-${index}`,
      name: `${name} · sample contact`,
      phone: `+97150000000${index}`,
      company: "Sample company",
      stage: "new",
    },
    wa_numbers: { label: "Demo business line", display_phone: "+971500000009" },
  }));
function rows(id: string) {
  if (!messages[id])
    messages[id] = Array.from({ length: 145 }, (_, index) => ({
      id: `${id}-message-${String(index).padStart(3, "0")}`,
      conversation_id: id,
      direction: index % 3 === 1 ? "outbound" : "inbound",
      sender: index % 3 === 1 ? "agent" : "contact",
      body:
        index === 144
          ? "Thank you. Can we arrange a demonstration?"
          : index === 141
            ? "Here is a long product address to check wrapping: https://example.test/catalog/very-long-product-code-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
            : index % 3 === 1
              ? "Yes, I can help with the product details and a quotation."
              : `Sample message ${index + 1}. Could you tell me more about the available options?`,
      // Omar is an old conversation, exercising the closed reply window.
      created_at: new Date(
        Date.now() - (145 - index) * 600000 - (id.endsWith("-chat-1") ? 2 * 86400000 : 0),
      ).toISOString(),
      status: index === 142 ? "unconfirmed" : index % 3 === 1 ? "read" : "received",
      translated_body: null,
      detected_language: null,
    }));
  return messages[id]!;
}
const channel = {
  on() {
    return channel;
  },
  subscribe(fn: (status: string) => void) {
    fn("CLOSED");
    return channel;
  },
};
export const supabase = {
  channel: () => channel,
  removeChannel: async () => {},
  from: (table: string) => {
    if (table === "billing_settings") return settingsDb.from(table);
    let filters: [string, unknown][] = [],
      limit = 1000,
      operation = "select",
      payload: any,
      older = "",
      columns = "",
      head = false;
    const run = async () => {
      if (fixtureState.fail && ["messages", "conversations"].includes(table))
        return { data: null, error: { message: "Simulated inbox load failure" } };
      const id = String(filters.find(([key]) => key === "conversation_id")?.[1] ?? "");
      let result =
        table === "conversations"
          ? conversations(fixtureState.scope)
          : table === "messages"
            ? rows(id)
            : table === "profiles"
              ? [{ id: fixtureState.scope, full_name: "Demo teammate", email: "demo@example.test" }]
              : [];
      if (operation !== "select") return { data: null, error: null };
      for (const [key, value] of filters) result = result.filter((row: any) => row[key] === value);
      if (older) {
        const match = /created_at\.lt\.([^,]+)/.exec(older);
        if (match) result = result.filter((row: any) => row.created_at < JSON.parse(match[1]!));
      }
      if (table === "messages")
        result = [...result].sort((a, b) => b.created_at.localeCompare(a.created_at));
      return {
        data: head ? null : structuredClone(result.slice(0, limit)),
        error: null,
        count: head ? result.length : undefined,
      };
    };
    const q = {
      select: (value: string, options?: any) => {
        columns = value;
        head = !!options?.head;
        return q;
      },
      eq: (key: string, value: unknown) => {
        filters.push([key, value]);
        return q;
      },
      gt: () => q,
      in: () => q,
      or: (value: string) => {
        older = value;
        return q;
      },
      order: () => q,
      limit: (value: number) => {
        limit = value;
        return q;
      },
      range: () => q,
      update: (value: any) => {
        operation = "update";
        payload = value;
        return q;
      },
      insert: (value: any) => {
        operation = "insert";
        payload = value;
        return q;
      },
      maybeSingle: async () => {
        const r = await run();
        return { ...r, data: r.data?.[0] ?? null };
      },
      then: (resolve: any, reject: any) => run().then(resolve, reject),
    };
    return q;
  },
};
export const recordAuditEvent = async () => ({ ok: true });
export const getSendContext = async () => {
  if (fixtureState.fail) throw new Error("Simulated sender check failure");
  return {
    sendingNumber: { label: "Demo business line", displayPhone: "+971500000009" },
    recipient: "+971500000000",
    blocks: [],
  };
};
export const sendAgentMessage = async ({ data }: any) => {
  if (fixtureState.fail) throw new Error("Simulated send refusal");
  const list = rows(data.conversationId);
  list.push({
    id: `preview-out-${++next}`,
    conversation_id: data.conversationId,
    direction: "outbound",
    sender: "agent",
    body: data.body,
    created_at: new Date().toISOString(),
    status: "sent",
  });
  return { state: "accepted" };
};
export const draftBotReply = async () => ({
  draft: "Thank you for your enquiry. Which product would you like more details about?",
});
export const buildCatalogMessage = async () => ({ body: "Sample product details. Preview only." });
export const sendTemplateMessage = async () => ({
  state: "blocked",
  blocks: [{ code: "preview", message: "No templates are sent in this preview." }],
});
export const translateMessage = async () => ({ detectedLanguage: "English" });
export const getSocialHub = async () => ({ accounts: [], interactions: [] });
export const sendSocialReply = async () => {
  throw new Error("No external send in preview");
};
export const suggestSocialReply = async () => ({ draft: "Preview suggestion" });
export const updateInteractionStatus = async () => ({ ok: true });
export function addIncomingPreviewMessage() {
  const id = `${fixtureState.scope}-chat-0`;
  rows(id).push({
    id: `preview-in-${++next}`,
    conversation_id: id,
    direction: "inbound",
    sender: "contact",
    body: "New sample message arrived while you were reading.",
    created_at: new Date().toISOString(),
    status: "received",
  });
}
