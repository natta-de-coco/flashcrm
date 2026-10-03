/** Safe, explainable audience selection for WhatsApp re-engagement campaigns. */
export type ReengagementContact = {
  id: string;
  name: string | null;
  phone: string | null;
  consent_given: boolean | null;
  last_message_at: string | null;
  stage: "new" | "qualified" | "proposal" | "negotiation" | "won" | "lost";
};

export type InactiveRecipient = {
  contactId: string;
  name: string | null;
  phone: string;
  inactiveDays: number;
};

/**
 * Returns only people who can lawfully receive a re-engagement template.
 * Lost contacts are intentionally excluded: a "lost" sale is not permission
 * to keep messaging someone. Contacts without a known last interaction are
 * also excluded until an agent reviews their source and consent history.
 */
export function selectInactiveWhatsAppRecipients(
  contacts: ReengagementContact[],
  inactiveForDays: number,
  now = new Date(),
): InactiveRecipient[] {
  const cutoff = now.getTime() - inactiveForDays * 24 * 60 * 60 * 1000;
  return contacts.flatMap((contact) => {
    const phone = (contact.phone ?? "").replace(/\D/g, "");
    const lastMessageAt = contact.last_message_at ? new Date(contact.last_message_at).getTime() : NaN;
    if (
      contact.consent_given !== true ||
      contact.stage === "lost" ||
      phone.length < 6 ||
      !Number.isFinite(lastMessageAt) ||
      lastMessageAt > cutoff
    ) {
      return [];
    }
    return [{
      contactId: contact.id,
      name: contact.name,
      phone: `+${phone}`,
      inactiveDays: Math.floor((now.getTime() - lastMessageAt) / 86_400_000),
    }];
  });
}
