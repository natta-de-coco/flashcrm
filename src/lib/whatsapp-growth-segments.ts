export type WhatsAppGrowthContact = {
  id: string;
  consentGiven: boolean;
  hasPhone: boolean;
  stage: string;
  lastMessageAt: string | null;
};

export type WhatsAppGrowthConversation = { id: string; contactId: string };
export type WhatsAppGrowthMessage = {
  conversationId: string;
  direction: "inbound" | "outbound";
  createdAt: string;
};

export type WhatsAppGrowthSegment = {
  id: "recent_repliers" | "quiet_opted_in" | "past_customers" | "awaiting_reply";
  title: string;
  description: string;
  count: number;
  audienceHint: string;
};

/**
 * Builds transparent audience counts from CRM events. It never infers consent
 * from a reply and never includes a contact without a reachable phone number.
 */
export function buildWhatsAppGrowthSegments(
  contacts: WhatsAppGrowthContact[],
  conversations: WhatsAppGrowthConversation[],
  messages: WhatsAppGrowthMessage[],
  now = new Date(),
): WhatsAppGrowthSegment[] {
  const contactForConversation = new Map(conversations.map((c) => [c.id, c.contactId]));
  const messagesByContact = new Map<string, WhatsAppGrowthMessage[]>();
  for (const message of messages) {
    const contactId = contactForConversation.get(message.conversationId);
    if (!contactId) continue;
    const list = messagesByContact.get(contactId) ?? [];
    list.push(message);
    messagesByContact.set(contactId, list);
  }
  const eligible = contacts.filter((contact) => contact.consentGiven && contact.hasPhone);
  const withinDays = (date: string, days: number) =>
    new Date(date).getTime() >= now.getTime() - days * 86_400_000;
  const olderThanDays = (date: string | null, days: number) =>
    !!date && new Date(date).getTime() < now.getTime() - days * 86_400_000;

  const recentRepliers = eligible.filter((contact) =>
    (messagesByContact.get(contact.id) ?? []).some(
      (message) => message.direction === "inbound" && withinDays(message.createdAt, 7),
    ),
  ).length;
  const quiet = eligible.filter((contact) => olderThanDays(contact.lastMessageAt, 7)).length;
  const pastCustomers = eligible.filter((contact) => contact.stage === "won").length;
  const awaitingReply = eligible.filter((contact) => {
    const latest = [...(messagesByContact.get(contact.id) ?? [])].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )[0];
    return !!latest && latest.direction === "outbound" && olderThanDays(latest.createdAt, 3);
  }).length;

  return [
    { id: "recent_repliers", title: "Recent repliers", description: "Opted-in people who replied in the last 7 days.", count: recentRepliers, audienceHint: "Opted-in people who replied in the last 7 days" },
    { id: "quiet_opted_in", title: "Quiet leads", description: "Opted-in contacts with no message activity for 7+ days.", count: quiet, audienceHint: "Opted-in contacts who have been quiet for at least 7 days" },
    { id: "past_customers", title: "Past customers", description: "Opted-in contacts marked as won customers.", count: pastCustomers, audienceHint: "Opted-in past customers" },
    { id: "awaiting_reply", title: "Awaiting a reply", description: "Opted-in contacts whose latest message from your team is 3+ days old.", count: awaitingReply, audienceHint: "Opted-in contacts waiting for a reply after our last message" },
  ];
}
