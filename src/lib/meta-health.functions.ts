import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";

/**
 * Dashboard widget: per-number Meta sync health — credential presence, Meta API
 * reachability, quality rating, and whether Meta analytics data is available.
 * Never returns tokens or secrets.
 */
export const getMetaSyncHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // supabaseAdmin bypasses RLS. Without this filter any signed-in user of
    // any tenant got the health of every WhatsApp number on the platform --
    // labels, phone numbers, quality ratings and 24h message volumes for
    // every other company. Fail closed rather than falling back to "all".
    const { data: tenantId } = await context.supabase.rpc("current_tenant_id");
    if (!tenantId) return { numbers: [], checkedAt: new Date().toISOString() };

    const { data: numbers } = await supabaseAdmin
      .from("wa_numbers")
      .select(
        "id, label, display_phone, phone_number_id, access_token, active, is_default, alerts_enabled",
      )
      .eq("tenant_id", tenantId as string)
      .order("created_at", { ascending: true });

    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const end = Math.floor(Date.now() / 1000);
    const start = end - 7 * 24 * 60 * 60;

    const results = [];
    for (const n of numbers ?? []) {
      const { data: convs } = await supabaseAdmin
        .from("conversations")
        .select("id")
        .eq("tenant_id", tenantId as string)
        .eq("wa_number_id", n.id);
      const convIds = (convs ?? []).map((c) => c.id);

      let messages24h = 0;
      if (convIds.length > 0) {
        const { count } = await supabaseAdmin
          .from("messages")
          .select("id", { count: "exact", head: true })
          .in("conversation_id", convIds)
          .gte("created_at", dayAgo);
        messages24h = count ?? 0;
      }

      let apiOk = false;
      let apiError: string | null = null;
      let qualityRating: string | null = null;
      let analyticsOk = false;
      let analyticsSent7d = 0;

      // Stored tokens may be encrypted; sending the stored value as-is sent
      // ciphertext to Meta. Opened here, and sent as a header rather than in
      // the URL.
      let token: string | null = null;
      if (n.active && n.access_token && n.phone_number_id) {
        try {
          const { openSecret } = await import("@/lib/secret-box.server");
          token = await openSecret(n.access_token);
        } catch {
          apiError = "The stored access token could not be read. Reconnect this number.";
        }
      }

      if (token) {
        const auth = { headers: { Authorization: `Bearer ${token}` } };
        try {
          const res = await fetch(
            `https://graph.facebook.com/v21.0/${n.phone_number_id}` +
              `?fields=verified_name,quality_rating`,
            auth,
          );
          const json = (await res.json()) as {
            quality_rating?: string;
            error?: { message?: string };
          };
          if (res.ok) {
            apiOk = true;
            qualityRating = json.quality_rating ?? null;
          } else {
            apiError = json.error?.message ?? `Meta API error ${res.status}`;
          }
        } catch (e) {
          apiError = e instanceof Error ? e.message : "Meta API unreachable";
        }

        if (apiOk) {
          try {
            const res = await fetch(
              `https://graph.facebook.com/v21.0/${n.phone_number_id}` +
                `?fields=analytics.start(${start}).end(${end}).granularity(DAY)`,
              auth,
            );
            const json = (await res.json()) as {
              analytics?: { data_points?: Array<{ sent?: number }> };
            };
            if (res.ok && json.analytics) {
              analyticsOk = true;
              for (const p of json.analytics.data_points ?? []) {
                analyticsSent7d += p.sent ?? 0;
              }
            }
          } catch {
            analyticsOk = false;
          }
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
        conversations: convIds.length,
        messages24h,
        apiOk,
        apiError,
        qualityRating,
        analyticsOk,
        analyticsMissing: apiOk && !analyticsOk,
        analyticsSent7d,
      });
    }

    return { numbers: results, checkedAt: new Date().toISOString() };
  });
