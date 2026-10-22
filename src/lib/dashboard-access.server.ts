import type { SupabaseClient } from "@supabase/supabase-js";
import { canOpen, isCompanyManager } from "./permissions";

/**
 * Home is available to every known role, but its customer overview and AI brief
 * are not. Read the authenticated caller's profile rather than trusting a role
 * or workspace supplied by the browser. The aggregation still uses this same
 * caller's RLS-scoped client after this additional role check.
 */
export async function requireDashboardAccess(
  supabase: SupabaseClient,
  userId: string,
  purpose: "overview" | "advisor" | "meta" = "overview",
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
    !canOpen(role, "/contacts") ||
    (purpose === "advisor" && !canOpen(role, "/advisor")) ||
    (purpose === "meta" && !isCompanyManager(role))
  ) {
    throw new Error("Your role cannot view customer activity or generate a workspace brief.");
  }
  return { tenantId, role };
}

/**
 * The caller's staff role for visibility shaping (which modules an overview
 * includes), not an access gate. Falls back to the most limited role when
 * the profile cannot be read, so a lookup failure hides data rather than
 * widening it.
 */
export async function callerStaffRole(supabase: SupabaseClient, userId: string): Promise<string> {
  const { data } = await supabase
    .from("profiles")
    .select("staff_role")
    .eq("id", userId)
    .maybeSingle();
  return typeof data?.staff_role === "string" ? data.staff_role : "staff";
}
