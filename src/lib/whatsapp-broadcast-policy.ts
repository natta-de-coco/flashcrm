/**
 * Guardrails for WhatsApp marketing. These are deliberately stricter than a
 * transport check: a valid number and an approved template do not mean a
 * person has agreed to receive marketing.
 */
export type WhatsAppMarketingCandidate = {
  consentGiven: boolean | null;
  suppressed: boolean;
  templateApproved: boolean;
  marketingMessagesInLast3Days: number;
  hasKnownOptInSource: boolean;
};

export type WhatsAppMarketingBlockReason =
  | "template_not_approved"
  | "consent_missing"
  | "opt_in_evidence_missing"
  | "unsubscribed"
  | "frequency_cap";

/**
 * The default is intentionally conservative. Workspaces may send a test
 * template to an opted-in person, but cannot repeatedly chase the same person
 * through marketing broadcasts. Transactional/support messages use their own
 * consent and 24-hour-window checks and are not counted here.
 */
export const DEFAULT_MARKETING_MESSAGES_PER_3_DAYS = 1;

export function whatsappMarketingBlockReason(
  candidate: WhatsAppMarketingCandidate,
  maxMessagesPer3Days = DEFAULT_MARKETING_MESSAGES_PER_3_DAYS,
): WhatsAppMarketingBlockReason | null {
  if (!candidate.templateApproved) return "template_not_approved";
  if (candidate.consentGiven !== true) return "consent_missing";
  if (!candidate.hasKnownOptInSource) return "opt_in_evidence_missing";
  if (candidate.suppressed) return "unsubscribed";
  if (candidate.marketingMessagesInLast3Days >= maxMessagesPer3Days) return "frequency_cap";
  return null;
}

export const WHATSAPP_MARKETING_BLOCK_COPY: Record<WhatsAppMarketingBlockReason, string> = {
  template_not_approved: "Choose an approved WhatsApp template before sending marketing messages.",
  consent_missing: "This person has no recorded WhatsApp marketing opt-in.",
  opt_in_evidence_missing: "Record where and when this person agreed to receive WhatsApp marketing first.",
  unsubscribed: "This person opted out of WhatsApp marketing and is suppressed.",
  frequency_cap: "This person already received a WhatsApp marketing message in the last 3 days.",
};
