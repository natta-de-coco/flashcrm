import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const PayloadSchema = z.object({
  sessionId: z.string().min(6).max(80),
  siteKey: z.string().min(10).max(120).optional(),
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

        if (parsed.siteKey) {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: site } = await supabaseAdmin
            .from("lead_sites")
            .select("status, active")
            .eq("site_key", parsed.siteKey)
            .maybeSingle();
          if (!site || !site.active || site.status !== "active") {
            return new Response(
              JSON.stringify({ error: "This site is not activated yet" }),
              { status: 403, headers: corsHeaders },
            );
          }
        }

        try {
          const { ingestInboundMessage } = await import("@/lib/wa.server");
          const { reply } = await ingestInboundMessage({
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
