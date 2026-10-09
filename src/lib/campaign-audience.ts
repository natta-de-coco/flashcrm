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
  /**
   * Reachable on this channel but not to be sent to: no recorded consent, or the
   * person unsubscribed (see `resolveCampaignAudience`). Never counted in `total`.
   */
  withoutConsent: number;
  /** A table hit the query row limit, so `total` is a floor rather than the exact figure. */
  truncated: boolean;
};

/**
 * The rows both figures are worked out from: the audience of a campaign and the
 * count of opted-in people the AI is told. They take the same input and the
 * same limits, so they are the same people.
 */
export type AudienceInput = {
  contacts?: ConsentRow[] | null;
  leads?: ConsentRow[] | null;
  identities?: ContactIdentityRow[] | null;
  /** The ceiling the caller read `contacts` and `leads` with; a full table is then a floor. */
  rowLimit?: number;
  /** The same for `identities`, which are several per contact. */
  identityRowLimit?: number;
};

/**
 * The opt-in test for one record. `consent_given` must be explicitly true — a
 * missing or null value is not consent — and an explicit `subscribed: false`
 * suppresses a person who consented earlier and has since unsubscribed. What an
 * unsubscribe means for the *other* records of the same person is decided in
 * `resolveCampaignAudience`, which sees all the records.
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

const ALL_CHANNELS: CampaignChannel[] = ["email", "whatsapp"];

/** One address of one kind, as a string two records can be compared by. */
const addressKey = (channel: CampaignChannel, address: string) =>
  `${IDENTITY_KIND[channel]}:${address}`;

/** The address in `value`, read as `channel`'s kind, or null when it is not one. */
const parseAddress = (value: string | null | undefined, channel: CampaignChannel) =>
  channelAddress(
    channel === "email" ? { email: value ?? null } : { phone: value ?? null },
    channel,
  );

type Held = { channel: CampaignChannel; address: string; key: string };

type Member = {
  origin: "contact" | "lead";
  name: string | null;
  /**
   * Opted in, and not taken out by an unsubscribe: either of this record's own
   * or of another record of the same person (see `groupPeople`).
   */
  optedIn: boolean;
  /** Every address this record has, best first, before any unsubscribe is applied. */
  held: Held[];
  /** The addresses a message may go to: `held` less the ones an unsubscribe covers. */
  usable: Held[];
  /** Where this record sits in the union-find below. */
  node: string;
};

/**
 * Sorts every record into the *people* they are. A person is what is counted,
 * not a row. Several rows are one person when they share an address, when a
 * lead points at the contact the website form made from it
 * (`leads.contact_id`), or when they are the same contact seen through its
 * other addresses. Without that, one person with three numbers was three
 * recipients, and a contact whose only address was added on the contact card
 * was unreachable.
 *
 * Which addresses are a contact's own is decided by its card
 * (`contact_identities`), not by the old `contacts.email` / `contacts.phone`
 * columns: removing an address from a card deletes its identity row and leaves
 * the column behind, and the same address can then be added to another card.
 *   - a contact with addresses of a kind on its card is reached at those, and
 *     its column of that kind is ignored;
 *   - the column is its address only when the card has none of that kind (a
 *     contact made by the Contacts page or an import has only the column), and
 *     not even then when that address now sits on a different contact's card;
 *   - a contact left with no address of a kind is unreachable that way.
 *
 * Consent is read per record and is never borrowed across them: an address is a
 * candidate for sending only if the record it belongs to is opted in.
 *
 * An unsubscribe counts for the person, not only for the row it is written on.
 * A lead with `subscribed: false` covers (a) its own email and phone, on
 * whichever record holds them and in whatever letter case, and (b) the contact
 * it points at, at every address that contact has, and the other leads that
 * point at that contact. This only ever removes people: it never makes anyone a
 * recipient. A person it removes is still counted among those excluded.
 */
function groupPeople(input: AudienceInput, channels: CampaignChannel[]): Member[][] {
  const contacts = input.contacts ?? [];
  const leads = input.leads ?? [];
  const identities = input.identities ?? [];

  const cardOf = new Map<string, ContactIdentityRow[]>();
  const onACard = new Set<string>();
  for (const identity of identities) {
    const channel = channels.find((c) => IDENTITY_KIND[c] === identity.kind);
    if (!channel) continue;
    const slot = `${identity.kind}|${identity.contact_id}`;
    const list = cardOf.get(slot) ?? [];
    list.push(identity);
    cardOf.set(slot, list);
    const address = parseAddress(identity.value, channel);
    if (address) onACard.add(addressKey(channel, address));
  }

  // The raw values a contact is reached at on one channel, best first. The one
  // marked primary is the one the card shows first, so it is the one used.
  const contactValues = (row: ConsentRow, channel: CampaignChannel): string[] => {
    const own = cardOf.get(`${IDENTITY_KIND[channel]}|${row.id ?? ""}`) ?? [];
    if (own.length > 0) {
      return [
        ...own.filter((identity) => identity.is_primary === true).map((i) => i.value),
        ...own.filter((identity) => identity.is_primary !== true).map((i) => i.value),
      ];
    }
    const raw = (channel === "email" ? row.email : row.phone) ?? "";
    const address = parseAddress(raw, channel);
    // With nothing of this kind on its card the column is all there is, unless
    // the address has since been given to a card — and, the contact having no
    // card address of this kind, that card is someone else's.
    return address && !onACard.has(addressKey(channel, address)) ? [raw] : [];
  };

  const heldBy = (values: Array<[CampaignChannel, string]>): Held[] => {
    const seen = new Set<string>();
    const held: Held[] = [];
    for (const [channel, value] of values) {
      const address = parseAddress(value, channel);
      if (!address) continue;
      const key = addressKey(channel, address);
      if (seen.has(key)) continue;
      seen.add(key);
      held.push({ channel, address, key });
    }
    return held;
  };

  // Who has unsubscribed, as addresses and as the contacts they point at.
  const unsubscribedAddresses = new Set<string>();
  const unsubscribedContacts = new Set<string>();
  for (const lead of leads) {
    if (lead.subscribed !== false) continue;
    for (const channel of ALL_CHANNELS) {
      const address = channelAddress(lead, channel);
      if (address) unsubscribedAddresses.add(addressKey(channel, address));
    }
    if (lead.contact_id) unsubscribedContacts.add(lead.contact_id);
  }

  const member = (
    origin: Member["origin"],
    row: ConsentRow,
    held: Held[],
    node: string,
    unsubscribedPerson: boolean,
  ): Member => {
    const usable = unsubscribedPerson
      ? []
      : held.filter((address) => !unsubscribedAddresses.has(address.key));
    return {
      origin,
      name: row.name?.trim() || null,
      // Having addresses and every one of them covered by an unsubscribe is the
      // same as having unsubscribed; having none is just being unreachable.
      optedIn: isOptedIn(row) && !unsubscribedPerson && (held.length === 0 || usable.length > 0),
      held,
      usable,
      node,
    };
  };

  const members: Member[] = [];
  contacts.forEach((row, index) => {
    members.push(
      member(
        "contact",
        row,
        heldBy(
          channels.flatMap((c) =>
            contactValues(row, c).map((v): [CampaignChannel, string] => [c, v]),
          ),
        ),
        row.id ? `contact:${row.id}` : `contact#${index}`,
        row.id != null && unsubscribedContacts.has(row.id),
      ),
    );
  });
  leads.forEach((row, index) => {
    members.push(
      member(
        "lead",
        row,
        heldBy(
          channels.map((c): [CampaignChannel, string] => [
            c,
            (c === "email" ? row.email : row.phone) ?? "",
          ]),
        ),
        `lead#${index}`,
        row.contact_id != null && unsubscribedContacts.has(row.contact_id),
      ),
    );
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
  // Joined on every address a record has, covered by an unsubscribe or not: the
  // unsubscribing lead and the contact at the same address are one person.
  for (const one of members) {
    for (const address of one.held) join(one.node, `address:${address.key}`);
  }
  leads.forEach((row, index) => {
    if (row.contact_id) join(`lead#${index}`, `contact:${row.contact_id}`);
  });

  const people = new Map<string, Member[]>();
  for (const one of members) {
    const root = find(one.node);
    const group = people.get(root);
    if (group) group.push(one);
    else people.set(root, [one]);
  }
  return [...people.values()];
}

const reachedCeiling = (input: AudienceInput): boolean =>
  (input.rowLimit != null &&
    ((input.contacts ?? []).length >= input.rowLimit ||
      (input.leads ?? []).length >= input.rowLimit)) ||
  (input.identityRowLimit != null && (input.identities ?? []).length >= input.identityRowLimit);

/**
 * Turns raw rows from the tables into the single audience a campaign has: who
 * can be sent to on `channel`, and, counted separately and never in the total,
 * who is consented but has nowhere to be reached and who is left out (no
 * recorded consent, or unsubscribed). How rows become people, and whose
 * addresses are whose, is described at `groupPeople`.
 *
 * `rowLimit` is the ceiling the caller queried with: when a table comes back
 * full, the result is flagged `truncated` so the UI can say "at least N"
 * instead of quietly under-reporting the list. `identityRowLimit` is the same
 * for the identities, which are several per contact.
 */
export function resolveCampaignAudience(
  input: AudienceInput & { channel: CampaignChannel },
): CampaignAudience {
  const { channel } = input;
  const recipients: AudienceRecipient[] = [];
  let fromContacts = 0;
  let fromLeads = 0;
  let optedInUnreachable = 0;
  let withoutConsent = 0;

  for (const group of groupPeople(input, [channel])) {
    // Contacts come first in `members`, so a person recorded in both tables is
    // attributed to their contact record when that record can be reached.
    const sendable = group.find((one) => one.optedIn && one.usable.length > 0);
    if (sendable) {
      recipients.push({
        address: (sendable.usable[0] as Held).address,
        name: sendable.name,
        origin: sendable.origin,
      });
      if (sendable.origin === "contact") fromContacts += 1;
      else fromLeads += 1;
    } else if (group.some((one) => one.optedIn)) {
      // Consented, but there is nowhere on this channel to send to.
      optedInUnreachable += 1;
    } else if (group.some((one) => one.held.length > 0)) {
      // Tracked so the UI can explain *why* the audience is empty rather than
      // leaving the user staring at a zero. A person an unsubscribe took out of
      // the audience is one of these: reachable, and not to be sent to.
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
    truncated: reachedCeiling(input),
  };
}

/**
 * How many different people are opted in, on either channel and whether or not
 * there is an address to reach them at: the figure the AI is told. It is the
 * same sorting of rows into people as the audience, over both channels at once,
 * so the page and the AI cannot count one workspace's people two ways.
 */
export function countOptedInPeople(input: AudienceInput): { people: number; truncated: boolean } {
  const people = groupPeople(input, ALL_CHANNELS).filter((group) =>
    group.some((one) => one.optedIn),
  ).length;
  return { people, truncated: reachedCeiling(input) };
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
    parts.push(
      `${audience.withoutConsent} excluded for having no recorded consent or having unsubscribed`,
    );
  }
  return parts.join("; ");
}
