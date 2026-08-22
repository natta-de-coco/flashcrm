import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { API_SCOPES } from "@/lib/api-scopes";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

type Client = SupabaseClient<Database>;

async function requireAdmin(supabase: Client, userId: string) {
  const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (!isAdmin) throw new Error("Only admins can manage API keys");
}

async function callerTenantId(supabase: Client, userId: string): Promise<string | null> {
  const { data } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", userId)
    .maybeSingle();
  return data?.tenant_id ?? null;
}

/** Lists this workspace's API keys (never includes the secret). */
export const listApiKeys = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("api_keys")
      .select("id, name, prefix, scopes, last_used_at, revoked_at, created_at")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

const CreateSchema = z.object({
  name: z.string().min(2).max(60),
  scopes: z.array(z.enum(API_SCOPES)).min(1, "Pick at least one permission"),
});

/** Creates an API key. The raw key is returned once and never stored. */
export const createApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    const { generateApiKey } = await import("@/lib/api-keys.server");
    const { logAudit } = await import("@/lib/audit.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const tenantId = await callerTenantId(context.supabase, context.userId);
    const key = generateApiKey();
    const { data: row, error } = await supabaseAdmin
      .from("api_keys")
      .insert({
        tenant_id: tenantId,
        name: data.name,
        prefix: key.prefix,
        key_hash: key.hash,
        scopes: data.scopes,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw error;

    await logAudit({
      action: "api_key.create",
      tenantId,
      actorId: context.userId,
      entityType: "api_key",
      entityId: row.id,
      details: { name: data.name, scopes: data.scopes },
    });
    return { id: row.id, rawKey: key.raw };
  });

const RevokeSchema = z.object({ keyId: z.string().uuid() });

/** Revokes an API key immediately. */
export const revokeApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RevokeSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    const { logAudit } = await import("@/lib/audit.server");

    const { error } = await context.supabase
      .from("api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.keyId)
      .is("revoked_at", null);
    if (error) throw error;

    await logAudit({
      action: "api_key.revoke",
      tenantId: await callerTenantId(context.supabase, context.userId),
      actorId: context.userId,
      entityType: "api_key",
      entityId: data.keyId,
    });
    return { ok: true };
  });
