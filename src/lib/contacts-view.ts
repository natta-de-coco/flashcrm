// The arithmetic and list-assembly behind the contacts board and the contact
// detail dialog. Pure on purpose: the dialog and the board are React, which this
// repo has no renderer for in tests, so everything that can be got wrong lives
// here instead and is covered by tests/contacts-view.test.mjs.

/** A row of `contact_identities` as `getContactDetail` returns it. */
export type IdentityRow = {
  id: string;
  kind: string;
  value: string;
  label: string | null;
  is_primary: boolean;
  branch_id: string | null;
};

/** The legacy single-phone/single-email columns still carried on `contacts`. */
export type ContactPrimaries = {
  phone?: string | null;
  email?: string | null;
};

/**
 * One line in the "Numbers & emails" list.
 *
 * `id` is null for a line that came from `contacts.phone` / `contacts.email`
 * rather than from an identity row. There is nothing to delete or re-flag in
 * that case, so the dialog hides those controls — the alternative would be
 * buttons that cannot work.
 */
export type ReachLine = {
  id: string | null;
  kind: "phone" | "email";
  value: string;
  label: string | null;
  isPrimary: boolean;
  branchId: string | null;
  /** True when the line is synthesised from the contact row itself. */
  fromContactRow: boolean;
};

/**
 * Canonical form of a phone number or email, mirroring the SQL
 * `public.normalize_contact_identity` in
 * supabase/migrations/20260910120000_contact_identities_and_branches.sql.
 *
 * It exists here only to answer "is this contact-row value already listed as an
 * identity?" so the same number is not shown twice in slightly different
 * spellings. Matching that decides *whose* number this is still belongs to the
 * database — see src/lib/contact-resolve.server.ts — and this must never become
 * a second source of truth for it. Kept deliberately in step with the SQL,
 * including the quirk that a number without a leading "+" normalises to bare
 * digits.
 */
export function normalizeIdentityValue(kind: string, value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "";
  if (kind === "phone") {
    const digits = trimmed.replace(/[^0-9]/g, "");
    return trimmed.startsWith("+") ? `+${digits}` : digits;
  }
  return trimmed.toLowerCase();
}

/**
 * The lines to show under "Numbers & emails", identities plus anything only the
 * contact row knows.
 *
 * H12: a contact said "Nothing recorded yet" while plainly holding
 * +971509630506. `contact_identities` is backfilled by its migration, but the
 * New contact form and the CSV import both write `contacts.phone` / `.email`
 * and nothing else, so every contact created through the UI since then has a
 * number the dialog could not see. The row's own phone and email are folded in
 * here, marked primary, rather than being backfilled by a migration that would
 * go stale again the next time something writes only `contacts`.
 *
 * A contact-row value already covered by an identity is dropped, compared on
 * the canonical form so "+971 50 963 0506" does not appear twice next to
 * "+971509630506".
 */
export function reachLines(contact: ContactPrimaries, identities: IdentityRow[]): ReachLine[] {
  const lines: ReachLine[] = identities
    .filter((row) => row.kind === "phone" || row.kind === "email")
    .map((row) => ({
      id: row.id,
      kind: row.kind as "phone" | "email",
      value: row.value,
      label: row.label,
      isPrimary: row.is_primary,
      branchId: row.branch_id,
      fromContactRow: false,
    }));

  const seen = new Set(
    lines.map((line) => `${line.kind}:${normalizeIdentityValue(line.kind, line.value)}`),
  );

  for (const kind of ["phone", "email"] as const) {
    const raw = (kind === "phone" ? contact.phone : contact.email) ?? "";
    const value = raw.trim();
    if (!value) continue;
    const key = `${kind}:${normalizeIdentityValue(kind, value)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Ahead of the identity rows: it is the number on the contact record, so
    // it is the one the user expects to read first.
    lines.unshift({
      id: null,
      kind,
      value,
      label: "Primary — on the contact record",
      isPrimary: true,
      branchId: null,
      fromContactRow: true,
    });
  }

  return lines;
}

/** "3 numbers · 1 email", for the collapsed summary on a contact card. */
export function reachSummary(lines: ReachLine[]): string {
  const phones = lines.filter((line) => line.kind === "phone").length;
  const emails = lines.filter((line) => line.kind === "email").length;
  const parts: string[] = [];
  if (phones > 0) parts.push(`${phones} ${phones === 1 ? "number" : "numbers"}`);
  if (emails > 0) parts.push(`${emails} ${emails === 1 ? "email" : "emails"}`);
  return parts.join(" · ");
}

/** Just enough of a contact to total a pipeline column. */
export type StageMember = { stage?: string | null; value?: number | string | null };

/**
 * Count and money total for one pipeline stage.
 *
 * L1: the board showed a count per column and nothing else, so "how much is
 * sitting in Negotiation?" meant adding the cards up by eye. `value` is read
 * through Number() because it arrives from Postgres `numeric`, which
 * supabase-js hands back as a string once it is large enough, and NaN would
 * silently poison the whole column total.
 */
export function stageTotal(
  contacts: StageMember[],
  stage: string,
): { count: number; total: number } {
  let count = 0;
  let total = 0;
  for (const contact of contacts) {
    if (contact.stage !== stage) continue;
    count += 1;
    const amount = Number(contact.value ?? 0);
    if (Number.isFinite(amount)) total += amount;
  }
  return { count, total };
}

/**
 * Money as the workspace's currency, or a plain number when the currency code
 * is one Intl does not know.
 *
 * Whole units only: a pipeline column total reading "AED 12,400" is the point,
 * and ".00" on every card is noise. The try/catch is not defensive padding —
 * `organizations.currency` is free text from onboarding, and one bad code would
 * otherwise throw inside render and blank the whole board.
 */
export function formatStageMoney(amount: number, currency: string | null | undefined): string {
  const code = (currency || "USD").toUpperCase();
  try {
    return amount.toLocaleString(undefined, {
      style: "currency",
      currency: code,
      maximumFractionDigits: 0,
    });
  } catch {
    return `${code} ${Math.round(amount).toLocaleString()}`;
  }
}

/**
 * Deep link to one conversation in the shared inbox.
 *
 * H13 asked for a way from a contact to their WhatsApp thread. It is a link to
 * the existing /inbox route rather than a second message composer inside the
 * dialog: one send path, one audit trail, one set of consent checks.
 */
export function inboxConversationHref(conversationId: string): string {
  return `/inbox?conversation=${encodeURIComponent(conversationId)}`;
}
