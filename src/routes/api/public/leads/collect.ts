import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const PayloadSchema = z.object({
  siteKey: z.string().min(10).max(120),
  email: z.string().email().max(200),
  name: z.string().max(120).optional(),
  phone: z.string().max(32).optional(),
  sourceUrl: z.string().max(500).optional(),
  consent: z.boolean().optional(),
  tags: z.array(z.string().max(40)).max(10).optional(),
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

export const Route = createFileRoute("/api/public/leads/collect")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      POST: async ({ request }) => {
        let parsed;
        try {
          parsed = PayloadSchema.parse(await request.json());
        } catch {
          return new Response(JSON.stringify({ error: "Invalid payload" }), {
            status: 400,
            headers: corsHeaders,
          });
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const { data: site } = await supabaseAdmin
            .from("lead_sites")
            .select("id, tenant_id, platform, active, status, domain")
            .eq("site_key", parsed.siteKey)
            .maybeSingle();

          // A single generic response for every rejection reason (unknown
          // key, inactive, wrong domain) — returning a different status/
          // message per reason let an attacker use the response itself to
          // enumerate which site keys are real.
          const reject = () =>
            new Response(JSON.stringify({ error: "This request could not be accepted" }), {
              status: 403,
              headers: corsHeaders,
            });

          // `active` is the kill switch; `status` is the activation state machine
          // (pending -> active -> revoked). A site only collects once activated.
          if (!site || !site.active || site.status !== "active" || !site.tenant_id) {
            return reject();
          }

          // The site key is embedded in public pages, so also pin it to the
          // registered domain: requests from other origins are rejected.
          // (Exact-suffix match, not substring — evil-acme.com used to pass
          // as acme.com, and a missing Origin/Referer header used to skip
          // this check entirely instead of failing it.)
          const { checkDomainPin } = await import("@/lib/domain-pin");
          if (!checkDomainPin(request, site.domain)) {
            return reject();
          }

          const { ingestLead } = await import("@/lib/leads.server");
          await ingestLead({
            tenantId: site.tenant_id,
            siteId: site.id,
            sitePlatform: site.platform,
            email: parsed.email,
            name: parsed.name ?? null,
            phone: parsed.phone ?? null,
            sourceUrl: parsed.sourceUrl ?? null,
            consent: parsed.consent === true,
            tags: parsed.tags ?? [],
          });

          return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
        } catch (error) {
          console.error("[leads] collect failed", error);
          return new Response(JSON.stringify({ error: "Could not save that right now" }), {
            status: 500,
            headers: corsHeaders,
          });
        }
      },
    },
  },
});
