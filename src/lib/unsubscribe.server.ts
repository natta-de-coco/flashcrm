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

  await attempt("leads", () =>
    supabaseAdmin
      .from("leads")
      .update({ subscribed: false, consent_given: false })
      .eq("tenant_id", tenantId)
      .eq("email", email),
  );

  await attempt("contacts", () =>
    supabaseAdmin
      .from("contacts")
      .update({ consent_given: false })
      .eq("tenant_id", tenantId)
      .eq("email", email),
  );

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
