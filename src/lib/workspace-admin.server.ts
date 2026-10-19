import type { Database } from "@/integrations/supabase/types";
import { ONLY_ADMIN_MESSAGE } from "@/lib/integration-health";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The caller's workspace, for an action that is then carried out with the service role (asking the
 * platforms, writing what they say, sealing stored credentials, saving or disconnecting a channel).
 * Only an admin may do that: the screen hides the button from everyone else, but a hidden button is
 * not an authorization control.
 *
 * "Admin" is the database's own rule, is_tenant_admin(): an admin by the staff role on the profile
 * OR by the older user_roles table. The screen's `isAdmin` (useAuth) reads that older table, so
 * everyone it shows the button to is let in here. (A company admin by staff role alone is let in
 * by the server but is not shown the button until useAuth asks the same question.) The look-up
 * runs as the caller, and a failed look-up lets nobody in.
 *
 * This is the same rule the "Admins manage social accounts" row-level-security policy applies to a
 * write made as the caller. The browser role no longer has any INSERT or UPDATE on social_accounts
 * (20261020100000), so the writes that policy used to decide now run here, after this check, with
 * the workspace this returns written into the statement.
 */
export async function adminCaller(
  supabase: SupabaseClient<Database>,
  userId: string,
  refusal: string = ONLY_ADMIN_MESSAGE,
): Promise<{ tenantId: string; staff: boolean }> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id, staff_role")
    .eq("id", userId)
    .maybeSingle();
  if (!profile?.tenant_id) {
    throw new Error("Your workspace is still being set up — try again in a moment.");
  }
  const { data: isAdmin, error } = await supabase.rpc("is_tenant_admin");
  if (error) throw new Error("Flas could not check your role just now. Try again in a moment.");
  if (isAdmin !== true) throw new Error(refusal);
  return { tenantId: profile.tenant_id, staff: profile.staff_role === "super_admin" };
}
