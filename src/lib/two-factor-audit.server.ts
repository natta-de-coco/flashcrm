// The audit entry written when somebody turns two-factor on through the app.
//
// Why it exists: enrolling a factor needs only a password-level session, and
// Auth ends every other password-level session of that account when the first
// code is verified. So a person who has only the password of an account WITHOUT
// two-factor can enrol their own phone, and the real owner's next sign-in ends
// at a code prompt they cannot pass. Auth does the enrolling, so this cannot be
// stopped from here. What can be done is to make it visible: the company's
// admins read the audit log, so an entry that says two-factor was turned on for
// an address is something they can ask the owner about.
//
// What it covers and does not: it is written when the enrolment is done in the
// app's own security card. Someone who calls Auth's API directly with the
// publishable key (which is in the browser bundle) leaves no entry. Catching
// that needs a database trigger on auth.mfa_factors, which is a migration and is
// a follow-up.
//
// What makes the entry true: it is not written because the browser says so. The
// server asks Auth for the account's factors with the caller's own token and
// writes only when a verified authenticator app became verified in the last ten
// minutes, once per factor. A browser that calls this over and over, or for an
// account that has had two-factor for months, adds nothing.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { newlyVerifiedFactor } from "./two-factor";

/** The audit action. The company's admins see it as "Two-step sign-in was turned on". */
export const TWO_FACTOR_ENABLED = "mfa.enabled";

const NOT_RECORDED = "The change was not recorded in the audit log";

export type RecordedTwoFactor = { recorded: true } | { recorded: false; why: string };

/**
 * Writes the entry if (and only if) this account has a verified authenticator
 * app that became verified just now and has no entry yet. Throws, rather than
 * saying "nothing to do", when it could not find out or could not write.
 */
export async function recordNewTwoFactor({
  userId,
  token,
  supabase,
  admin,
  now = Date.now(),
}: {
  userId: string;
  token: string | undefined;
  /** A client for the Auth service (only `auth.getUser` is used). */
  supabase: Pick<SupabaseClient<Database>, "auth">;
  /** The service-role client: company users may not write the audit log themselves. */
  admin: Pick<SupabaseClient<Database>, "from">;
  now?: number;
}): Promise<RecordedTwoFactor> {
  if (!token) throw new Error(`${NOT_RECORDED}: no sign-in token on the request.`);

  // Ask Auth, with the caller's own token, who they are and what factors they have.
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    throw new Error(`${NOT_RECORDED}: Auth could not be asked.`);
  }
  if (data.user.id !== userId) {
    throw new Error(`${NOT_RECORDED}: Auth described a different account.`);
  }

  const factor = newlyVerifiedFactor(data.user.factors, now);
  if (!factor) return { recorded: false, why: "nothing was turned on just now" };

  // Once per factor. If this cannot be read the entry is written anyway: a
  // repeated line is harmless, a missing one hides the change.
  const existing = await admin
    .from("audit_log")
    .select("id")
    .eq("action", TWO_FACTOR_ENABLED)
    .eq("entity_id", factor.id)
    .limit(1);
  if (!existing.error && (existing.data?.length ?? 0) > 0) {
    return { recorded: false, why: "already recorded" };
  }

  // The company the entry belongs to is the caller's own: read from their
  // profile, never taken from the request.
  const profile = await admin
    .from("profiles")
    .select("tenant_id, email")
    .eq("id", userId)
    .maybeSingle();
  if (profile.error) {
    throw new Error(`${NOT_RECORDED}: the account's company could not be read.`);
  }
  const email = profile.data?.email ?? data.user.email ?? null;

  const inserted = await admin.from("audit_log").insert({
    tenant_id: profile.data?.tenant_id ?? null,
    actor_id: userId,
    // The audit log shows this beside the action: the address the change is for.
    actor_label: email,
    action: TWO_FACTOR_ENABLED,
    entity_type: "mfa_factor",
    entity_id: factor.id,
    details: { email, factor_type: "totp" },
  });
  if (inserted.error) throw new Error(`${NOT_RECORDED}: the database refused it.`);
  return { recorded: true };
}
