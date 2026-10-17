import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { META_ANALYTICS_UNAVAILABLE } from "@/lib/plain-error";
import { requireDashboardAccess } from "./dashboard-access.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerFn } from "@tanstack/react-start";

type HealthDependencies = {
  loadAdmin?: () => Promise<SupabaseClient>;
  openSecret?: (stored: string) => Promise<string | null>;
  fetch?: typeof fetch;
};

/** Authorize before service-role reads or provider calls; tests drive this actual handler core. */
export async function getMetaSyncHealthData(
  context: { supabase: SupabaseClient; userId: string },
  dependencies: HealthDependencies = {},
) {
  const { tenantId } = await requireDashboardAccess(context.supabase, context.userId, "meta");
  const supabaseAdmin = dependencies.loadAdmin
    ? await dependencies.loadAdmin()
    : (await import("@/integrations/supabase/client.server")).supabaseAdmin;
  const unavailable = (error: { message?: string } | null, what: string): never => {
    console.error("[meta-health] database read failed", what, error?.message ?? "missing result");
    throw new Error("WhatsApp health could not be checked right now. Please try again.");
  };
  const exactCount = (
    result: { count: number | null; error: { message?: string } | null },
    what: string,
  ) => {
    if (
      result.error ||
      typeof result.count !== "number" ||
      !Number.isInteger(result.count) ||
      result.count < 0
    )
      return unavailable(result.error, what);
    return result.count;
  };
  const numbersResult = await supabaseAdmin
    .from("wa_numbers")
    .select(
      "id, label, display_phone, phone_number_id, access_token, active, is_default, alerts_enabled",
    )
    .eq("tenant_id", tenantId as string)
    .order("created_at", { ascending: true });
  if (numbersResult.error || !numbersResult.data) unavailable(numbersResult.error, "numbers");
  const numbers = numbersResult.data ?? unavailable(numbersResult.error, "numbers");

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const results = [];
  for (const n of numbers) {
    // Exact joined counts avoid a URL containing every conversation ID and are
    // independent of PostgREST's row cap. Both tables stay in the caller's tenant.
    const [conversationsResult, messagesResult] = await Promise.all([
      supabaseAdmin
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId as string)
        .eq("wa_number_id", n.id),
      supabaseAdmin
        .from("messages")
        .select("id, conversations!inner(tenant_id, wa_number_id)", { count: "exact", head: true })
        .eq("tenant_id", tenantId as string)
        .eq("conversations.tenant_id", tenantId as string)
        .eq("conversations.wa_number_id", n.id)
        .gte("created_at", dayAgo),
    ]);
    const conversations = exactCount(conversationsResult, "conversations");
    const messages24h = exactCount(messagesResult, "messages");
    let apiOk = false;
    let apiError: string | null = null;
    let qualityRating: string | null = null;
    let token: string | null = null;
    if (n.active && n.access_token && n.phone_number_id) {
      try {
        const openSecret =
          dependencies.openSecret ?? (await import("./secret-box.server")).openSecret;
        token = await openSecret(n.access_token);
        if (!token) apiError = "The stored access token could not be read. Reconnect this number.";
      } catch {
        apiError = "The stored access token could not be read. Reconnect this number.";
      }
    }
    if (token) {
      try {
        const res = await (dependencies.fetch ?? fetch)(
          "https://graph.facebook.com/v21.0/" +
            encodeURIComponent(n.phone_number_id) +
            "?fields=verified_name,quality_rating",
          { headers: { Authorization: "Bearer " + token }, signal: AbortSignal.timeout(10_000) },
        );
        const json = (await res.json()) as { quality_rating?: string };
        if (res.ok) {
          apiOk = true;
          qualityRating = json.quality_rating ?? null;
        } else
          apiError =
            "Meta API check failed (HTTP " + res.status + "). Reconnect or check Alerts & health.";
      } catch {
        apiError = "Meta API could not be reached. Try again later.";
      }
    }
    results.push({
      id: n.id,
      label: n.label,
      displayPhone: n.display_phone,
      active: n.active,
      isDefault: n.is_default,
      alertsEnabled: n.alerts_enabled,
      credentialsPresent: Boolean(n.access_token && n.phone_number_id),
      conversations,
      messages24h,
      apiOk,
      apiError,
      qualityRating,
    });
  }
  return {
    numbers: results,
    checkedAt: new Date().toISOString(),
    metaAnalytics: { available: false, reason: META_ANALYTICS_UNAVAILABLE },
  };
}
export const getMetaSyncHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => getMetaSyncHealthData(context));
