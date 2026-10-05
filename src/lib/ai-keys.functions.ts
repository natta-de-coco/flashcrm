// Bring-your-own AI provider keys.
//
// flash-ai.server.ts has resolved a tenant's own key through the
// get_tenant_ai_key RPC for a while, and the landing page advertises the
// feature — but nothing ever wrote a key, because there was no screen. This is
// that screen's server half.
//
// Writes go through the service role on purpose. 20260903010000 revoked
// SELECT on ai_provider_keys from `authenticated` and re-granted it column by
// column without api_key, so the browser can list which providers are
// configured but never read a secret. Replacements use a server-side update,
// preserving the previous key if saving its replacement fails.
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Only providers flash-ai.server.ts can actually call. */
const ProviderSchema = z.enum(["openai", "anthropic", "google"]);

export const AI_PROVIDERS = [
  {
    id: "openai" as const,
    name: "OpenAI",
    hint: "Starts with sk-… Create one at platform.openai.com → API keys.",
    keysUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "anthropic" as const,
    name: "Anthropic (Claude)",
    hint: "Starts with sk-ant-… Create one at console.anthropic.com → API keys.",
    keysUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "google" as const,
    name: "Google (Gemini)",
    hint: "Starts with AIza… Create one at aistudio.google.com → Get API key.",
    keysUrl: "https://aistudio.google.com/app/apikey",
  },
];

async function requireCompanyAdmin(context: {
  supabase: import("@supabase/supabase-js").SupabaseClient;
  userId: string;
}): Promise<string> {
  const { data } = await context.supabase
    .from("profiles")
    .select("tenant_id, staff_role")
    .eq("id", context.userId)
    .maybeSingle();
  if (!data?.tenant_id) throw new Error("Your workspace is still being set up.");
  if (!["company_admin", "super_admin"].includes(data.staff_role)) {
    throw new Error("Only company admins can manage AI keys");
  }
  return data.tenant_id as string;
}

/** Which providers this workspace has configured. Never returns a key. */
export const listAiKeys = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("ai_provider_keys")
      .select("id, provider, label, active, created_at")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

export const getAiResilience = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tenantId = await requireCompanyAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc(
      "get_tenant_ai_resilience" as never,
      { _tenant_id: tenantId } as never,
    );
    return { available: !error, enabled: !error && data === true };
  });

export const setAiResilience = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ enabled: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    const tenantId = await requireCompanyAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.rpc(
      "set_tenant_ai_resilience" as never,
      { _tenant_id: tenantId, _enabled: data.enabled } as never,
    );
    if (error)
      throw new Error(
        "AI backup storage is not ready. Ask a platform admin to apply the AI settings migration.",
      );
    const { logAudit } = await import("@/lib/audit.server");
    await logAudit({
      action: "ai.backup_changed",
      tenantId,
      actorId: context.userId,
      entityType: "ai_settings",
      entityId: tenantId,
      details: { enabled: data.enabled },
    });
    return { ok: true };
  });

export const checkAiProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ provider: z.enum(["openai", "anthropic", "google", "platform"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const tenantId = await requireCompanyAdmin(context);
    const { testAiProvider } = await import("@/lib/flash-ai.server");
    try {
      await testAiProvider(tenantId, data.provider);
      return {
        ok: true,
        message: "Test passed: the provider generated a reply.",
        testedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "The connection test failed.",
        testedAt: new Date().toISOString(),
      };
    }
  });

export const saveAiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        provider: ProviderSchema,
        apiKey: z.string().trim().min(20).max(400),
        label: z.string().trim().max(80).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const tenantId = await requireCompanyAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { sealSecret } = await import("@/lib/secret-box.server");
    const sealed = await sealSecret(data.apiKey);
    if (!sealed) throw new Error("The AI key could not be encrypted. Nothing was changed.");
    // Keep the working key if its replacement cannot be saved. The previous
    // delete-then-insert lost it on an insert failure.
    const { data: existing, error: lookupError } = await supabaseAdmin
      .from("ai_provider_keys")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("provider", data.provider)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lookupError) throw new Error("Could not load the saved AI key. Nothing was changed.");
    const values = {
      tenant_id: tenantId,
      provider: data.provider,
      api_key: sealed,
      label: data.label ?? AI_PROVIDERS.find((p) => p.id === data.provider)?.name ?? data.provider,
      active: true,
      created_by: context.userId,
      created_at: new Date().toISOString(),
    };
    const { error } = existing
      ? await supabaseAdmin
          .from("ai_provider_keys")
          .update(values)
          .eq("id", existing.id)
          .eq("tenant_id", tenantId)
      : await supabaseAdmin.from("ai_provider_keys").insert(values);
    if (error) throw error;

    const { logAudit } = await import("@/lib/audit.server");
    await logAudit({
      action: "ai.key_saved",
      tenantId,
      actorId: context.userId,
      entityType: "ai_provider_key",
      entityId: data.provider,
      details: {},
    });
    return { ok: true };
  });

export const deleteAiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ provider: ProviderSchema }).parse(input))
  .handler(async ({ data, context }) => {
    const tenantId = await requireCompanyAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("ai_provider_keys")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("provider", data.provider);
    if (error) throw error;

    const { logAudit } = await import("@/lib/audit.server");
    await logAudit({
      action: "ai.key_removed",
      tenantId,
      actorId: context.userId,
      entityType: "ai_provider_key",
      entityId: data.provider,
      details: {},
    });
    return { ok: true };
  });
