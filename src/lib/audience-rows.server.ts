// The rows an audience is worked out from, read one way for everyone who needs
// them: the campaign page and the campaign writer (campaign-audience.server.ts)
// and the figures the AI is told (flash-ai.server.ts). Reading them in two
// places is how the two came to disagree about how many people there are.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConsentRow, ContactIdentityRow } from "./campaign-audience";

/** Same ceiling gatherAudienceSegments uses. A full page sets `truncated`. */
export const AUDIENCE_ROW_LIMIT = 2000;

/**
 * The same ceiling for `contact_identities`, which holds several rows per
 * contact. Reaching it also sets `truncated`.
 */
export const AUDIENCE_IDENTITY_LIMIT = 10_000;

/**
 * Rows asked for per request. A request returns at most the project's "max
 * rows" setting (1,000 by default) however large a `.limit()` it asks for, and
 * says nothing when rows were left behind, so a bigger single read would stop
 * there without anyone being told.
 */
const PAGE_SIZE = 1000;

/**
 * Reads up to `ceiling` rows of a table, a page at a time, in a stable order.
 * A failed read throws: it is never an empty table.
 *
 * Pages follow one another by `id`, each asking for the rows after the last one
 * seen, rather than by position: a row added or removed between two requests
 * moves every position after it and would repeat or skip a row, and a late page
 * by offset costs the database more the further it goes. The exact count is
 * asked of the first request only, since it is the same on every page.
 */
export async function readRows<T>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  ceiling: number,
): Promise<T[]> {
  const rows: T[] = [];
  let total: number | null = null;
  let after: string | null = null;
  while (rows.length < ceiling) {
    const asked = Math.min(PAGE_SIZE, ceiling - rows.length);
    const first = rows.length === 0;
    const query = supabase.from(table).select(columns, first ? { count: "exact" } : {});
    const { data, error, count } = await (after === null ? query : query.gt("id", after))
      .order("id", { ascending: true })
      .limit(asked);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as unknown as T[];
    if (first) total = count;
    rows.push(...page);
    // The response, not the request, says how much there is: stop at the
    // reported total, or at a page that came back short or empty.
    if (page.length === 0) break;
    if (total != null ? rows.length >= total : page.length < asked) break;
    const lastId = (page[page.length - 1] as { id?: string | null }).id;
    if (lastId == null) throw new Error(`Could not read ${table}: a row came back without an id.`);
    after = lastId;
  }
  return rows;
}

/**
 * Every table an audience is made of, read together. Throws when any of the
 * reads fails: a refused or failed read is not an empty table, and an audience
 * made from half the data is worse than none.
 */
export async function readAudienceRows(
  supabase: SupabaseClient,
  limits: { rowLimit?: number; identityLimit?: number } = {},
): Promise<{
  contacts: ConsentRow[];
  leads: ConsentRow[];
  identities: ContactIdentityRow[];
}> {
  const rowLimit = limits.rowLimit ?? AUDIENCE_ROW_LIMIT;
  const identityLimit = limits.identityLimit ?? AUDIENCE_IDENTITY_LIMIT;
  const [contacts, leads, identities] = await Promise.all([
    readRows<ConsentRow>(supabase, "contacts", "id, name, email, phone, consent_given", rowLimit),
    // `subscribed` exists on leads only, and is read as a suppression flag.
    // `contact_id` ties a website lead to the contact made from it.
    readRows<ConsentRow>(
      supabase,
      "leads",
      "id, contact_id, name, email, phone, consent_given, subscribed",
      rowLimit,
    ),
    // An address added on the contact card lives here and is not copied to
    // `contacts.email` / `contacts.phone`.
    readRows<ContactIdentityRow>(
      supabase,
      "contact_identities",
      "id, contact_id, kind, value, is_primary",
      identityLimit,
    ),
  ]);
  return { contacts, leads, identities };
}
