// Who a marketing campaign is allowed to go to — the one place that decides it.
//
// Defect H8 (QA, 26 Sep 2026): the Flas AI campaign writer told the user there
// were "no opted-in contacts" while the workspace's only contact was badged
// "Consented · 9/26/2026" on the Contacts page. Consent lives on two unrelated
// tables — `contacts` (added 20260820134904, consent columns 20260822142456)
// and `leads` (added 20260821133211) — and the writer's audience summary only
// ever read `leads`. Recording consent the normal CRM way, on a contact, made
// that person invisible to marketing.
//
// The same code also disagreed with itself about what consent *is*:
//   - `leads.subscribed` defaults to true (migration 20260821133211) and no
//     code path in this repo ever sets it false, so `consent_given ||
//     subscribed` counted every lead as consented.
//   - the campaigns card counted plain `subscribed` as "recipients", so a lead
//     who never ticked the box was still a recipient.
// Here `consent_given` is the only authority — it is the column the consent
// audit entry in leads.server.ts is written against — and `subscribed` is
// honoured only as what it can actually be: an unsubscribe suppression flag.
//
// Pure on purpose: both the count shown in the UI and the audience the campaign
// writer is told about come through this function, so the two cannot drift.

export type CampaignChannel = "email" | "whatsapp";

/**
 * The shape both tables have in common. Fields absent from one table are
 * optional rather than nullable, because "the column does not exist here" and
 * "the column is null" have to mean the same thing: no suppression, no address.
 */
export type ConsentRow = {
  email?: string | null;
  phone?: string | null;
  name?: string | null;
  /** The recorded, auditable opt-in. Present on `contacts` and on `leads`. */
  consent_given?: boolean | null;
  consent_at?: string | null;
  /** `leads` only. `contacts` has no such column, so undefined = not suppressed. */
  subscribed?: boolean | null;
};

export type AudienceRecipient = {
  /** The address this person would be reached at — also the de-duplication key. */
  address: string;
  name: string | null;
  /** Which table this person was found in first; `contacts` wins a tie. */
  origin: "contact" | "lead";
};

export type CampaignAudience = {
  channel: CampaignChannel;
  /** Exactly the people a sender could deliver this campaign to, de-duplicated. */
  recipients: AudienceRecipient[];
  /** `recipients.length`, kept as a field so callers never re-derive it. */
  total: number;
  fromContacts: number;
  fromLeads: number;
  /** Consented, but holding no address for this channel — undeliverable, not excluded by choice. */
  optedInUnreachable: number;
  /** Reachable on this channel but with no recorded consent. Must never be sent to. */
  withoutConsent: number;
  /** A table hit the query row limit, so `total` is a floor rather than the exact figure. */
  truncated: boolean;
};

/**
 * The opt-in test. `consent_given` must be explicitly true — a missing or null
 * value is not consent — and an explicit `subscribed: false` suppresses a
 * person who consented earlier and has since unsubscribed.
 */
export function isOptedIn(row: ConsentRow): boolean {
  if (row.consent_given !== true) return false;
  return row.subscribed !== false;
}

/** Digits only, so "+971 50 963 0506" and "00971509630506" are one person. */
function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "").replace(/^00/, "");
}

/**
 * The address a campaign on `channel` would actually be delivered to, or null
 * when this person cannot be reached that way. `contacts.email` is nullable and
 * WhatsApp needs a number, so consent alone does not make someone a recipient.
 */
export function channelAddress(row: ConsentRow, channel: CampaignChannel): string | null {
  if (channel === "email") {
    const email = (row.email ?? "").trim().toLowerCase();
    // Cheap sanity check only — a real address validator belongs at capture time.
    return email.includes("@") ? email : null;
  }
  const phone = normalizePhone((row.phone ?? "").trim());
  return phone.length >= 6 ? phone : null;
}

/**
 * Turns raw rows from both tables into the single audience a campaign has.
 *
 * `rowLimit` is the ceiling the caller queried with: when a table comes back
 * full, the result is flagged `truncated` so the UI can say "at least N"
 * instead of quietly under-reporting the list.
 */
export function resolveCampaignAudience(input: {
  contacts?: ConsentRow[] | null;
  leads?: ConsentRow[] | null;
  channel: CampaignChannel;
  rowLimit?: number;
}): CampaignAudience {
  const { channel, rowLimit } = input;
  const seen = new Set<string>();
  const recipients: AudienceRecipient[] = [];
  const unconsented = new Set<string>();
  let fromContacts = 0;
  let fromLeads = 0;
  let optedInUnreachable = 0;

  const consider = (rows: ConsentRow[] | null | undefined, origin: "contact" | "lead") => {
    for (const row of rows ?? []) {
      const address = channelAddress(row, channel);
      if (!isOptedIn(row)) {
        // Tracked so the UI can explain *why* the audience is empty rather than
        // leaving the user staring at a zero.
        if (address) unconsented.add(address);
        continue;
      }
      if (!address) {
        optedInUnreachable += 1;
        continue;
      }
      if (seen.has(address)) continue;
      seen.add(address);
      recipients.push({ address, name: row.name?.trim() || null, origin });
      if (origin === "contact") fromContacts += 1;
      else fromLeads += 1;
    }
  };

  // Contacts first: a person recorded in both tables (leads.contact_id links
  // them) is one recipient, attributed to their contact record.
  consider(input.contacts, "contact");
  consider(input.leads, "lead");

  return {
    channel,
    recipients,
    total: recipients.length,
    fromContacts,
    fromLeads,
    optedInUnreachable,
    // Someone who consented on one table and not the other is still sendable,
    // so they must not also be counted as missing consent.
    withoutConsent: [...unconsented].filter((address) => !seen.has(address)).length,
    truncated:
      rowLimit != null &&
      ((input.contacts?.length ?? 0) >= rowLimit || (input.leads?.length ?? 0) >= rowLimit),
  };
}

const CHANNEL_NOUN: Record<CampaignChannel, string> = {
  email: "email address",
  whatsapp: "WhatsApp number",
};

/**
 * Why this audience cannot be written to, in words a user can act on, or null
 * when it can. Returning a reason is what stops the writer inventing a refusal:
 * the empty-audience case is decided here, in code, from real rows.
 */
export function audienceBlockedReason(audience: CampaignAudience): string | null {
  if (audience.total > 0) return null;
  const noun = CHANNEL_NOUN[audience.channel];
  if (audience.optedInUnreachable > 0) {
    return `${audience.optedInUnreachable} ${audience.optedInUnreachable === 1 ? "person has" : "people have"} given consent, but none of them has a ${noun} on file — add one, or switch the channel.`;
  }
  if (audience.withoutConsent > 0) {
    return `No one has consented yet. ${audience.withoutConsent} ${audience.withoutConsent === 1 ? "person is" : "people are"} reachable by ${audience.channel === "email" ? "email" : "WhatsApp"}, but consent has not been recorded for any of them — record it on the Contacts page, or capture it with the website form.`;
  }
  return `There is nobody to send to yet: no lead or contact in this workspace has both a recorded consent and a ${noun}.`;
}

/** The audience, as one factual line for the AI writer's prompt. */
export function describeAudience(audience: CampaignAudience): string {
  const parts = [
    `${audience.truncated ? "at least " : ""}${audience.total} opted-in ${audience.channel === "email" ? "email" : "WhatsApp"} ${audience.total === 1 ? "recipient" : "recipients"}`,
    `${audience.fromContacts} from CRM contacts`,
    `${audience.fromLeads} from website leads`,
  ];
  if (audience.optedInUnreachable > 0) {
    parts.push(`${audience.optedInUnreachable} consented but unreachable on this channel`);
  }
  if (audience.withoutConsent > 0) {
    parts.push(`${audience.withoutConsent} excluded for having no recorded consent`);
  }
  return parts.join("; ");
}
