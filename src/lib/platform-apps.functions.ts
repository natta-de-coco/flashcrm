// Per-workspace platform app keys. Every company pastes its own App ID and
// Secret once per platform family; after that each social account, ad account
// or analytics property connects with a single click.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ProviderSchema = z.enum(["meta", "google", "linkedin", "tiktok", "twitter", "pinterest"]);

/** Platform OAuth app credentials are workspace-wide secrets — only admins
 *  should be able to write or delete them, not every staff member. */
async function requireCompanyAdmin(context: {
  supabase: import("@supabase/supabase-js").SupabaseClient;
  userId: string;
}) {
  const { data } = await context.supabase
    .from("profiles")
    .select("tenant_id, staff_role")
    .eq("id", context.userId)
    .maybeSingle();
  if (!data?.tenant_id)
    throw new Error("Your workspace is still being set up — try again in a moment.");
  if (!["company_admin", "super_admin"].includes(data.staff_role)) {
    throw new Error("Only company admins can manage connected app credentials");
  }
  return data.tenant_id as string;
}

export const listPlatformApps = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("platform_apps")
      .select("id, provider, client_id, label, updated_at");
    if (error) throw error;
    // Secrets never travel back to the browser — only a "configured" marker.
    return (data ?? []).map((row) => ({
      id: row.id,
      provider: row.provider,
      client_id_hint: row.client_id.length > 6 ? `…${row.client_id.slice(-6)}` : "set",
      label: row.label,
      updated_at: row.updated_at,
    }));
  });

export const savePlatformApp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        provider: ProviderSchema,
        clientId: z.string().trim().min(4).max(200),
        clientSecret: z.string().trim().min(8).max(400),
        label: z.string().trim().max(120).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const tenantId = await requireCompanyAdmin(context);

    const { error } = await context.supabase.from("platform_apps").upsert(
      {
        tenant_id: tenantId,
        provider: data.provider,
        client_id: data.clientId,
        client_secret: data.clientSecret,
        label: data.label ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,provider" },
    );
    if (error) throw error;

    const { logAudit } = await import("@/lib/audit.server");
    await logAudit({
      action: "connection.platform_app_saved",
      tenantId,
      actorId: context.userId,
      entityType: "platform_app",
      entityId: data.provider,
    });
    return { ok: true };
  });

export const deletePlatformApp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ provider: ProviderSchema }).parse(input))
  .handler(async ({ data, context }) => {
    await requireCompanyAdmin(context);
    const { error } = await context.supabase
      .from("platform_apps")
      .delete()
      .eq("provider", data.provider);
    if (error) throw error;
    return { ok: true };
  });
