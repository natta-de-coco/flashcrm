/**
 * src/lib/unsubscribe.server.ts
 *
 * What happens when someone opens the unsubscribe link in a marketing email.
 */

import { verifyUnsubscribeToken } from "./lead-automation.server.ts";

export type UnsubscribeResult = { ok: true; email: string } | { ok: false; error: string };

export async function applyUnsubscribe(token: string): Promise<UnsubscribeResult> {
  const res = verifyUnsubscribeToken(token);
  if (!res.valid || !res.email) {
    return { ok: false, error: res.error || "Invalid or expired unsubscribe link" };
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Revoke marketing consent in leads
  await supabaseAdmin
    .from("leads")
    .update({
      subscribed: false,
      consent_given: false,
    })
    .eq("email", res.email.toLowerCase().trim());

  // Revoke marketing consent in contacts
  if (res.tenantId) {
    await supabaseAdmin
      .from("contacts")
      .update({
        consent_given: false,
      })
      .eq("tenant_id", res.tenantId)
      .eq("email", res.email.toLowerCase().trim());

    const { cancelDripEnrollmentsForEmail } = await import("./drip-automation.server.ts");
    await cancelDripEnrollmentsForEmail(res.tenantId, res.email);
  }

  return {
    ok: true,
    email: res.email,
  };
}
