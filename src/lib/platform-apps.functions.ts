// Per-workspace platform app keys. Every company pastes its own App ID and
// Secret once per platform family; after that each social account, ad account
// or analytics property connects with a single click.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ProviderSchema = z.enum(["meta", "google", "linkedin", "tiktok", "twitter", "pinterest"]);

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
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", context.userId)
      .maybeSingle();
    const tenantId = profile?.tenant_id;
    if (!tenantId) throw new Error("Your workspace is still being set up — try again in a moment.");

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
    const { error } = await context.supabase
      .from("platform_apps")
      .delete()
      .eq("provider", data.provider);
    if (error) throw error;
    return { ok: true };
  });
