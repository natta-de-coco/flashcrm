import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

type Client = SupabaseClient<Database>;
type OrgUpdate = Database["public"]["Tables"]["organizations"]["Update"];

/** Throws unless the signed-in user is a Flas platform super admin. */
async function requireSuperAdmin(supabase: Client, userId: string): Promise<void> {
  const { data } = await supabase
    .from("profiles")
    .select("staff_role")
    .eq("id", userId)
    .maybeSingle();
  if (data?.staff_role !== "super_admin") {
    throw new Error("This area is only available to the Flas platform manager");
  }
}

/** True when the signed-in user manages the whole platform (all companies). */
export const isSuperAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("profiles")
      .select("staff_role")
      .eq("id", context.userId)
      .maybeSingle();
    return { superAdmin: data?.staff_role === "super_admin" };
  });

/** Manager portal: every company on the platform with usage stats. */
export const listCompanies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: orgs, error } = await supabaseAdmin
      .from("organizations")
      .select(
        "id, name, slug, plan, subscription_status, subscription_renews_at, suspended, created_at",
      )
      .order("created_at", { ascending: false });
    if (error) throw error;

    const companies = await Promise.all(
      (orgs ?? []).map(async (org) => {
        const count = async (table: string) => {
          const q = supabaseAdmin
            .from(table as never)
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", org.id);
          return (await q).count ?? 0;
        };
        const [users, contacts, leads, conversations, numbers] = await Promise.all([
          count("profiles"),
          count("contacts"),
          count("leads"),
          count("conversations"),
          (async () => {
            const { count: c } = await supabaseAdmin
              .from("wa_numbers")
              .select("id", { count: "exact", head: true });
            return c ?? 0;
          })(),
        ]);
        return { ...org, users, contacts, leads, conversations, numbers };
      }),
    );
    return companies;
  });

const StatusSchema = z.object({
  organizationId: z.string().uuid(),
  subscriptionStatus: z.enum(["trial", "active", "past_due", "canceled"]).optional(),
  suspended: z.boolean().optional(),
});

/** Manager portal: activate, suspend or cancel a company's subscription. */
export const updateCompanyStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => StatusSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { logAudit } = await import("@/lib/audit.server");

    const patch: OrgUpdate = {};
    if (data.subscriptionStatus) {
      patch["subscription_status"] = data.subscriptionStatus;
      if (data.subscriptionStatus === "active") {
        patch["subscription_renews_at"] = new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000,
        ).toISOString();
      }
    }
    if (typeof data.suspended === "boolean") patch["suspended"] = data.suspended;
    if (Object.keys(patch).length === 0) throw new Error("Nothing to update");

    const { error } = await supabaseAdmin
      .from("organizations")
      .update(patch)
      .eq("id", data.organizationId);
    if (error) throw error;

    await logAudit({
      action: "company.subscription_update",
      tenantId: data.organizationId,
      actorId: context.userId,
      entityType: "organization",
      entityId: data.organizationId,
      details: patch,
    });
    return { ok: true };
  });
