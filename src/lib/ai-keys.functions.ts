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
// configured but never read a secret. The same migration granted only INSERT
// and DELETE — there is no UPDATE — which is why replacing a key is delete +
// insert rather than an upsert. (An upsert would fail anyway: ON CONFLICT DO
// UPDATE SET api_key = excluded.api_key counts as a read of api_key, exactly
// the trap that broke saving Meta credentials.)
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

    // One active key per provider. Replace rather than accumulate, so it is
    // always obvious which key is paying.
    await supabaseAdmin
      .from("ai_provider_keys")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("provider", data.provider);

    const { error } = await supabaseAdmin.from("ai_provider_keys").insert({
      tenant_id: tenantId,
      provider: data.provider,
      api_key: data.apiKey,
      label: data.label ?? AI_PROVIDERS.find((p) => p.id === data.provider)?.name ?? data.provider,
      active: true,
      created_by: context.userId,
    });
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
