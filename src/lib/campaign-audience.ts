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
  /**
   * `contacts.id`. What a contact's other addresses and the website leads made
   * from it point back at, so they can be recognised as one person.
   */
  id?: string | null;
  /** `leads.contact_id`: the contact the website form created from this lead, if any. */
  contact_id?: string | null;
  email?: string | null;
  phone?: string | null;
  name?: string | null;
  /** The recorded, auditable opt-in. Present on `contacts` and on `leads`. */
  consent_given?: boolean | null;
  consent_at?: string | null;
  /** `leads` only. `contacts` has no such column, so undefined = not suppressed. */
  subscribed?: boolean | null;
};

/**
 * One row of `contact_identities`: an address added to a contact on its card.
 * Adding one, or making another primary, does not touch `contacts.email` or
 * `contacts.phone`, so those columns alone are not everything a contact can be
 * reached at.
 */
export type ContactIdentityRow = {
  contact_id: string;
  kind: string;
  value: string;
  is_primary?: boolean | null;
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

/** Which kind of contact identity a channel is delivered to. */
const IDENTITY_KIND: Record<CampaignChannel, string> = { email: "email", whatsapp: "phone" };

type Member = {
  origin: "contact" | "lead";
  name: string | null;
  optedIn: boolean;
  /** Every address this record can be reached at on the channel, best first. */
  addresses: string[];
  /** Where this record sits in the union-find below. */
  node: string;
};

/**
 * Turns raw rows from the tables into the single audience a campaign has.
 *
 * A *person* is what is counted, not a row. Several rows are one person when
 * they share an address on the channel, when a lead points at the contact the
 * website form made from it (`leads.contact_id`), or when they are the same
 * contact seen through its other addresses (`identities`). Without that, one
 * person with three numbers was three recipients, and a contact whose only
 * address was added on the contact card was unreachable.
 *
 * Consent is read per record and is never borrowed across them: an address is a
 * candidate for sending only if the record it belongs to is opted in. A
 * contact's own addresses all follow the contact's consent, and which they are
 * is decided by the contact card: a contact with addresses of a kind on its card
 * is reached at those and its old column of that kind is ignored; the column is
 * its address only when the card has none of that kind, and not even then when
 * the address now sits on another contact's card.
 *
 * `rowLimit` is the ceiling the caller queried with: when a table comes back
 * full, the result is flagged `truncated` so the UI can say "at least N"
 * instead of quietly under-reporting the list. `identityRowLimit` is the same
 * for the identities, which are several per contact.
 */
export function resolveCampaignAudience(input: {
  contacts?: ConsentRow[] | null;
  leads?: ConsentRow[] | null;
  identities?: ContactIdentityRow[] | null;
  channel: CampaignChannel;
  rowLimit?: number;
  identityRowLimit?: number;
}): CampaignAudience {
  const { channel, rowLimit, identityRowLimit } = input;
  const contacts = input.contacts ?? [];
  const leads = input.leads ?? [];
  const identities = input.identities ?? [];

  const identitiesByContact = new Map<string, ContactIdentityRow[]>();
  for (const identity of identities) {
    if (identity.kind !== IDENTITY_KIND[channel]) continue;
    const list = identitiesByContact.get(identity.contact_id) ?? [];
    list.push(identity);
    identitiesByContact.set(identity.contact_id, list);
  }

  const addressOf = (value: string): string | null =>
    channelAddress(channel === "email" ? { email: value } : { phone: value }, channel);

  // Who holds each address on a contact card. Removing an address from a card
  // deletes its identity row and leaves `contacts.email` / `contacts.phone` as
  // they were, and the same address may then be added to another card, so the
  // column cannot be taken at its word about who an address belongs to.
  const cardHolders = new Map<string, Set<string>>();
  for (const [contactId, list] of identitiesByContact) {
    for (const identity of list) {
      const address = addressOf(identity.value);
      if (!address) continue;
      const holders = cardHolders.get(address) ?? new Set<string>();
      holders.add(contactId);
      cardHolders.set(address, holders);
    }
  }

  const members: Member[] = [];
  contacts.forEach((row, index) => {
    const own = identitiesByContact.get(row.id ?? "") ?? [];
    let ordered: string[];
    if (own.length > 0) {
      // A contact with addresses of this kind on its card is reached at those,
      // the one marked primary first (it is the one the card shows first). The
      // old column is not an address of theirs any more: it can be what an
      // address removed from the card left behind.
      ordered = [
        ...own.filter((identity) => identity.is_primary === true).map((i) => i.value),
        ...own.filter((identity) => identity.is_primary !== true).map((i) => i.value),
      ];
    } else {
      // Nothing of this kind on the card: the column is all there is (a contact
      // made by the Contacts page or an import has only the column), unless the
      // address has since been given to a different contact's card. Then it is
      // theirs, and consent recorded here must not follow it there.
      const raw = channel === "email" ? (row.email ?? "") : (row.phone ?? "");
      const column = addressOf(raw);
      ordered = column && !cardHolders.has(column) ? [raw] : [];
    }
    members.push({
      origin: "contact",
      name: row.name?.trim() || null,
      optedIn: isOptedIn(row),
      addresses: [...new Set(ordered.map(addressOf).filter((a): a is string => a !== null))],
      node: row.id ? `contact:${row.id}` : `contact#${index}`,
    });
  });
  leads.forEach((row, index) => {
    const address = channelAddress(row, channel);
    members.push({
      origin: "lead",
      name: row.name?.trim() || null,
      optedIn: isOptedIn(row),
      addresses: address ? [address] : [],
      node: `lead#${index}`,
    });
  });

  // Union-find: every record starts as itself and is joined to whatever it
  // shares an address with, and to the contact a lead was made from.
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let root = key;
    for (
      let next = parent.get(root);
      next !== undefined && next !== root;
      next = parent.get(root)
    ) {
      root = next;
    }
    for (let node = key; node !== root;) {
      const next = parent.get(node) as string;
      parent.set(node, root);
      node = next;
    }
    return root;
  };
  const join = (a: string, b: string) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };
  for (const member of members) {
    for (const address of member.addresses) join(member.node, `address:${address}`);
  }
  leads.forEach((row, index) => {
    if (row.contact_id) join(`lead#${index}`, `contact:${row.contact_id}`);
  });

  const people = new Map<string, Member[]>();
  for (const member of members) {
    const root = find(member.node);
    const group = people.get(root);
    if (group) group.push(member);
    else people.set(root, [member]);
  }

  const recipients: AudienceRecipient[] = [];
  let fromContacts = 0;
  let fromLeads = 0;
  let optedInUnreachable = 0;
  let withoutConsent = 0;

  for (const group of people.values()) {
    // Contacts come first in `members`, so a person recorded in both tables is
    // attributed to their contact record when that record can be reached.
    const sendable = group.find((member) => member.optedIn && member.addresses.length > 0);
    if (sendable) {
      recipients.push({
        address: sendable.addresses[0] as string,
        name: sendable.name,
        origin: sendable.origin,
      });
      if (sendable.origin === "contact") fromContacts += 1;
      else fromLeads += 1;
    } else if (group.some((member) => member.optedIn)) {
      // Consented, but there is nowhere on this channel to send to.
      optedInUnreachable += 1;
    } else if (group.some((member) => member.addresses.length > 0)) {
      // Tracked so the UI can explain *why* the audience is empty rather than
      // leaving the user staring at a zero.
      withoutConsent += 1;
    }
  }

  return {
    channel,
    recipients,
    total: recipients.length,
    fromContacts,
    fromLeads,
    optedInUnreachable,
    withoutConsent,
    truncated:
      (rowLimit != null && (contacts.length >= rowLimit || leads.length >= rowLimit)) ||
      (identityRowLimit != null && identities.length >= identityRowLimit),
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
