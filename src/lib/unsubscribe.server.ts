/**
 * src/lib/unsubscribe.server.ts
 *
 * What happens when someone opens the unsubscribe link in a marketing email.
 *
 * Nobody is signed in here and the writes use the service role, so the link is the only proof of
 * who is asking. Three rules follow:
 *   - the link must be signed with our key and must name a company as well as an address, and
 *     only that company's records change (the same address can be a customer of several);
 *   - every write is checked, and the visitor is told "unsubscribed" only if all of them worked;
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

  // All three withdrawals are attempted even if one fails, so as much consent as possible is
  // withdrawn; the answer is "done" only when none failed. Every step is safe to repeat.
  const failures: Failure[] = [];
  const attempt = async (
    step: string,
    run: () => PromiseLike<{ error: { code?: string } | null }>,
  ) => {
    try {
      const { error } = await run();
      if (error) failures.push({ step, code: error.code ?? "error" });
    } catch (thrown) {
      failures.push({ step, code: (thrown as { code?: string } | null)?.code ?? "threw" });
    }
  };

  // Addresses are stored as they were typed or imported (mixed case, a stray space), and the link
  // carries the plain lower-case form, so an exact match would silently miss them. The company's
  // rows that could be this address are found first (case-insensitive, with %, _ and \ meaning
  // themselves), narrowed to the ones that are this address once trimmed and lower-cased, and then
  // exactly those rows are changed. "Unsubscribed" is only said if every one of them changed.
  const withdraw = async (table: "leads" | "contacts", patch: Record<string, boolean>) => {
    const found = await supabaseAdmin
      .from(table)
      .select("id, email")
      .eq("tenant_id", tenantId)
      .ilike("email", `%${escapeLikePattern(email)}%`);
    if (found.error) return { error: found.error };

    const ids = ((found.data ?? []) as { id: string; email: string | null }[])
      .filter((r) => typeof r.email === "string" && r.email.trim().toLowerCase() === email)
      .map((r) => r.id);
    if (ids.length === 0) return { error: null };

    const changed = await supabaseAdmin
      .from(table)
      .update(patch as never)
      .eq("tenant_id", tenantId)
      .in("id", ids)
      .select("id");
    if (changed.error) return { error: changed.error };
    if ((changed.data ?? []).length < ids.length) return { error: { code: "not_all_changed" } };
    return { error: null };
  };

  await attempt("leads", () => withdraw("leads", { subscribed: false, consent_given: false }));
  await attempt("contacts", () => withdraw("contacts", { consent_given: false }));

  await attempt("drip_enrollments", async () => {
    const { cancelDripEnrollmentsForEmail } = await import("./drip-automation.server.ts");
    await cancelDripEnrollmentsForEmail(tenantId, email);
    return { error: null };
  });

  if (failures.length > 0) {
    // The address is left out of the log on purpose.
    console.error("[unsubscribe] Could not withdraw consent", { company: tenantId, failures });
    return { ok: false, error: UNSUBSCRIBE_COULD_NOT_UPDATE };
  }

  return { ok: true, email };
}
