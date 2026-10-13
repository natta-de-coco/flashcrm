/**
 * src/lib/unsubscribe.server.ts
 *
 * What happens when someone opens the unsubscribe link in a marketing email.
 *
 * Nobody is signed in here and the writes use the service role, so the link is the only proof of
 * who is asking. Four rules follow:
 *   - the link must be signed with our key and must name a company as well as an address, and
 *     only that company's records change (the same address can be a customer of several);
 *   - the withdrawal is COMPLETE: every spelling of the address in that company is withdrawn,
 *     however many rows there are. Once supabase/migrations/20261014110000_withdraw_marketing_consent.sql
 *     is applied it is also one transaction (a database function does all of it). Until then a
 *     paged, checked sequence of writes does the same job, without the single transaction;
 *   - the visitor is told "unsubscribed" only if everything worked and was read back afterwards;
 *   - the answer never repeats anything that did not come out of a verified link.
 */

import { verifyUnsubscribeToken } from "./lead-automation.server.ts";

export type UnsubscribeResult = { ok: true; email: string } | { ok: false; error: string };

export const UNSUBSCRIBE_REFUSED = "This unsubscribe link is not valid or has expired.";
export const UNSUBSCRIBE_COULD_NOT_UPDATE =
  "We could not update your preferences just now. Please try this link again in a moment.";

type Failure = { step: string; code: string };

/** Makes %, _ and \ in a value mean themselves when it is used inside an ILIKE pattern. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** The database function (it is not in the generated types, so it is called by name). */
const WITHDRAW_FUNCTION = "withdraw_marketing_consent";

/** Rows read per request. PostgREST caps a read at 1,000 by default; stay well under it. */
const PAGE_SIZE = 500;
/** Ids named in one write, so no request line becomes too long. */
const WRITE_CHUNK = 100;
/** A stop for a read that never ends (500 x 2,000 = a million candidate rows). */
const MAX_PAGES = 2000;

type Row = Record<string, unknown> & { id: string; email: string | null };
type DbError = { code?: string } | null;
type Result<T> = PromiseLike<{ data: T | null; error: DbError }>;

/** The few calls this file makes on the service client, typed loosely on purpose. */
interface Admin {
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        ilike(
          column: string,
          pattern: string,
        ): {
          order(
            column: string,
            options: { ascending: boolean },
          ): { range(from: number, to: number): Result<Row[]> };
        };
      };
    };
    update(patch: Record<string, unknown>): {
      eq(
        column: string,
        value: string,
      ): { in(column: string, values: string[]): { select(columns: string): Result<unknown[]> } };
    };
  };
  rpc(name: string, args: Record<string, unknown>): Result<unknown>;
}

/** Addresses are compared trimmed (space, tab, line breaks) and lower-cased, as the SQL does. */
const normalise = (value: string) =>
  value.replace(/^[ \t\r\n\f\v]+|[ \t\r\n\f\v]+$/g, "").toLowerCase();

/** What the function answers: how many leads, contacts and drip enrolments it changed. */
const isCounts = (data: unknown) =>
  typeof data === "object" &&
  data !== null &&
  ["leads", "contacts", "drip_enrollments"].every(
    (key) => typeof (data as Record<string, unknown>)[key] === "number",
  );

const isMissingTable = (code?: string) => code === "42P01" || code === "PGRST205";
const isMissingFunction = (code?: string) => code === "PGRST202" || code === "42883";

/** What "withdrawn" means in each table, and what to write to get there. */
const PLANS = {
  leads: {
    columns: "id, email, subscribed, consent_given",
    pending: (r: Row) => r["subscribed"] !== false || r["consent_given"] !== false,
    patch: () => ({ subscribed: false, consent_given: false }),
    tableMayBeMissing: false,
  },
  contacts: {
    columns: "id, email, consent_given",
    pending: (r: Row) => r["consent_given"] !== false,
    patch: () => ({ consent_given: false }),
    tableMayBeMissing: false,
  },
  // This table arrives with a later migration: a database without it has nothing to cancel.
  drip_enrollments: {
    columns: "id, email, status",
    pending: (r: Row) => r["status"] === "enrolled" || r["status"] === "in_progress",
    patch: () => ({ status: "unsubscribed", updated_at: new Date().toISOString() }),
    tableMayBeMissing: true,
  },
} as const;

type PlanName = keyof typeof PLANS;

/**
 * Every row of this company that is this address (any case, stray spaces), and nothing that merely
 * contains it. The company's rows that could be it are read in pages, in a stable order, until a
 * page comes back empty. The next page starts after the rows actually received, so a server that
 * sends fewer rows than were asked for cannot hide any. A read that fails is an error, never an
 * empty list.
 */
async function readAddress(
  admin: Admin,
  table: PlanName,
  tenantId: string,
  email: string,
): Promise<{ rows: Row[]; error: DbError }> {
  const pattern = `%${escapeLikePattern(email)}%`;
  const rows: Row[] = [];
  let received = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await admin
      .from(table)
      .select(PLANS[table].columns)
      .eq("tenant_id", tenantId)
      .ilike("email", pattern)
      .order("id", { ascending: true })
      .range(received, received + PAGE_SIZE - 1);
    if (error) return { rows: [], error };
    if (!Array.isArray(data)) return { rows: [], error: { code: "bad_answer" } };
    if (data.length === 0) return { rows, error: null };
    received += data.length;
    for (const r of data) {
      if (typeof r.email === "string" && normalise(r.email) === email) rows.push(r);
    }
  }
  return { rows: [], error: { code: "too_many_pages" } };
}

/**
 * The same withdrawal without the database function: read every spelling, change the ones still
 * consenting (by id, in small groups, checking each group changed what it was asked to), then read
 * again and confirm none of them is still consenting. Any failed step or leftover is a failure.
 */
async function withdrawWithoutFunction(
  admin: Admin,
  table: PlanName,
  tenantId: string,
  email: string,
): Promise<DbError> {
  const plan = PLANS[table];

  const before = await readAddress(admin, table, tenantId, email);
  if (before.error) {
    return plan.tableMayBeMissing && isMissingTable(before.error.code) ? null : before.error;
  }

  const ids = before.rows.filter(plan.pending).map((r) => r.id);
  for (let i = 0; i < ids.length; i += WRITE_CHUNK) {
    const chunk = ids.slice(i, i + WRITE_CHUNK);
    const changed = await admin
      .from(table)
      .update(plan.patch())
      .eq("tenant_id", tenantId)
      .in("id", chunk)
      .select("id");
    if (changed.error) {
      // Rows were just read, so the table is there; one dropped since has no enrolments left.
      return plan.tableMayBeMissing && isMissingTable(changed.error.code) ? null : changed.error;
    }
    if ((changed.data ?? []).length < chunk.length) return { code: "not_all_changed" };
  }

  const after = await readAddress(admin, table, tenantId, email);
  if (after.error) return after.error;
  if (after.rows.some(plan.pending)) return { code: "still_consenting" };
  return null;
}

export async function applyUnsubscribe(token: string): Promise<UnsubscribeResult> {
  const checked = verifyUnsubscribeToken(token);

  if (checked.notSetUp) {
    // Not the visitor's fault and not something to explain to the public: log it for the
    // operator and ask the visitor to come back to the same link.
    console.error("[unsubscribe] A link was opened but unsubscribe links are not set up");
    return { ok: false, error: UNSUBSCRIBE_COULD_NOT_UPDATE };
  }
  if (!checked.valid || !checked.email || !checked.tenantId) {
    return { ok: false, error: UNSUBSCRIBE_REFUSED };
  }

  const email = checked.email.toLowerCase().trim();
  const tenantId = checked.tenantId;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as unknown as Admin;

  const failures: Failure[] = [];
  const note = (step: string, code?: string) => failures.push({ step, code: code ?? "error" });

  // The whole job is one database function: one transaction, so all of it happens or none of it.
  let functionIsMissing = false;
  try {
    const { data, error } = await admin.rpc(WITHDRAW_FUNCTION, {
      _tenant_id: tenantId,
      _email: email,
    });
    if (error) {
      // Only "that function is not there (yet)" leads to the fallback. Any other refusal is
      // reported as it is: working around a function that exists but said no would hide it.
      if (isMissingFunction(error.code)) functionIsMissing = true;
      else note(WITHDRAW_FUNCTION, error.code);
    } else if (!isCounts(data)) {
      // A success that cannot be read is not a success.
      note(WITHDRAW_FUNCTION, "bad_answer");
    }
  } catch (thrown) {
    note(WITHDRAW_FUNCTION, (thrown as { code?: string } | null)?.code ?? "threw");
  }

  if (functionIsMissing) {
    // The SQL has not been applied yet. All three withdrawals are attempted even if one fails, so
    // as much consent as possible is withdrawn; the answer is "done" only when none failed.
    // Every step is safe to repeat.
    for (const table of Object.keys(PLANS) as PlanName[]) {
      try {
        const error = await withdrawWithoutFunction(admin, table, tenantId, email);
        if (error) note(table, error.code);
      } catch (thrown) {
        note(table, (thrown as { code?: string } | null)?.code ?? "threw");
      }
    }
  }

  if (failures.length > 0) {
    // The address is left out of the log on purpose.
    console.error("[unsubscribe] Could not withdraw consent", { company: tenantId, failures });
    return { ok: false, error: UNSUBSCRIBE_COULD_NOT_UPDATE };
  }

  return { ok: true, email };
}
