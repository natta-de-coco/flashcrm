import type { SupabaseClient } from "@supabase/supabase-js";
import { canOpen } from "./permissions";

/**
 * Home is available to every known role, but its customer overview and AI brief
 * are not. Read the authenticated caller's profile rather than trusting a role
 * or workspace supplied by the browser. The aggregation still uses this same
 * caller's RLS-scoped client after this additional role check.
 */
export async function requireDashboardAccess(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ tenantId: string; role: string }> {
  if (!userId) throw new Error("Sign in again to view your workspace overview.");

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("staff_role, tenant_id")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("[dashboard] access check failed", error.message);
    throw new Error("We could not check your workspace access. Please try again.");
  }
  const role = profile?.staff_role;
  const tenantId = profile?.tenant_id;
  if (
    typeof role !== "string" ||
    typeof tenantId !== "string" ||
    !tenantId ||
    !canOpen(role, "/inbox") ||
    !canOpen(role, "/contacts")
  ) {
    throw new Error("Your role cannot view customer activity or generate a workspace brief.");
  }
  return { tenantId, role };
}
