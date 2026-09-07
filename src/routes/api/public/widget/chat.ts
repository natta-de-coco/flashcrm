import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const PayloadSchema = z.object({
  // 32+ chars so a session id can't be brute-forced/guessed to hijack a live
  // conversation. siteKey is required — see below for why.
  sessionId: z.string().min(32).max(80),
  siteKey: z.string().min(10).max(120),
  name: z.string().max(80).optional(),
  message: z.string().min(1).max(2000),
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

export const Route = createFileRoute("/api/public/widget/chat")({
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

        // Same generic rejection for every reason — an unknown key and a
        // valid-but-wrong-domain key used to get different messages, which
        // let a caller enumerate which site keys are real.
        const reject = () =>
          new Response(JSON.stringify({ error: "This request could not be accepted" }), {
            status: 403,
            headers: corsHeaders,
          });

        // siteKey is required (no more anonymous, tenant-less sessions — that
        // was a live cross-tenant hijack path combined with the old
        // ingestInboundMessage, and an unauthenticated AI-cost DoS on its own).
        let site: {
          tenant_id: string | null;
          status: string;
          active: boolean;
          domain: string | null;
        } | null;
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data } = await supabaseAdmin
            .from("lead_sites")
            .select("tenant_id, status, active, domain")
            .eq("site_key", parsed.siteKey)
            .maybeSingle();
          site = data;
        } catch (error) {
          console.error("[widget] site lookup failed", error);
          return new Response(JSON.stringify({ error: "Chat unavailable right now" }), {
            status: 500,
            headers: corsHeaders,
          });
        }
        if (!site?.tenant_id || !site.active || site.status !== "active") {
          return reject();
        }

        const { checkDomainPin } = await import("@/lib/domain-pin");
        if (!checkDomainPin(request, site.domain)) {
          return reject();
        }

        try {
          const { ingestInboundMessage } = await import("@/lib/wa.server");
          const { reply } = await ingestInboundMessage({
            tenantId: site.tenant_id,
            channel: "web",
            sessionId: parsed.sessionId,
            name: parsed.name ?? null,
            text: parsed.message,
          });

          return new Response(JSON.stringify({ reply }), { status: 200, headers: corsHeaders });
        } catch (error) {
          console.error("[widget] chat failed", error);
          return new Response(JSON.stringify({ error: "Chat unavailable right now" }), {
            status: 500,
            headers: corsHeaders,
          });
        }
      },
    },
  },
});
