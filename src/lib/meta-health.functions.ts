import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { META_ANALYTICS_UNAVAILABLE } from "@/lib/plain-error";
import { createServerFn } from "@tanstack/react-start";

/**
 * Dashboard widget: per-number Meta sync health — credential presence, Meta API
 * reachability and quality rating. Never returns tokens or secrets.
 *
 * QA H11: this used to also ask Meta for `analytics` on the phone-number node,
 * which always answers `(#100) Tried accessing nonexisting field (analytics) on
 * node type (WhatsAppBusinessPhoneNumber)`. Meta keeps that field on the
 * WhatsApp Business Account, and no WABA id is stored anywhere in this schema
 * (wa_numbers has phone_number_id, access_token, app_secret and nothing else
 * identifying the business account), so the request could never succeed. The
 * call is gone — it cost a Graph round-trip per number per minute to produce a
 * guaranteed error — and the gap is reported once, as the permanent, explained
 * limitation it is, instead of a red "analytics missing" badge per number that
 * nobody could act on. Storing a WABA id is a schema change and a re-consent,
 * which is a larger piece of work than this fix; see the PR.
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
    if (!tenantId)
      return {
        numbers: [],
        checkedAt: new Date().toISOString(),
        metaAnalytics: { available: false, reason: META_ANALYTICS_UNAVAILABLE },
      };

    const { data: numbers } = await supabaseAdmin
      .from("wa_numbers")
      .select(
        "id, label, display_phone, phone_number_id, access_token, active, is_default, alerts_enabled",
      )
      .eq("tenant_id", tenantId as string)
      .order("created_at", { ascending: true });

    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

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
      });
    }

    return {
      numbers: results,
      checkedAt: new Date().toISOString(),
      // One honest, workspace-wide statement instead of a per-number error the
      // reader cannot act on. `available` stays in the payload so the day a
      // WABA id is stored the widget only has to flip it.
      metaAnalytics: { available: false, reason: META_ANALYTICS_UNAVAILABLE },
    };
  });
