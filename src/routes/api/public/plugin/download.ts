import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const QuerySchema = z.object({ siteKey: z.string().min(10).max(120) });

export const Route = createFileRoute("/api/public/plugin/download")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const parsed = QuerySchema.safeParse({ siteKey: url.searchParams.get("siteKey") ?? "" });
        if (!parsed.success) {
          return new Response("Missing site key", { status: 400 });
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { buildWordPressPlugin } = await import("@/lib/wordpress-plugin.server");

          const { data: site } = await supabaseAdmin
            .from("lead_sites")
            .select("site_key, active, popup_greeting")
            .eq("site_key", parsed.data.siteKey)
            .maybeSingle();

          if (!site || !site.active) {
            return new Response("Unknown site key", { status: 404 });
          }

          const zip = buildWordPressPlugin({
            origin: url.origin,
            siteKey: site.site_key,
            greeting: site.popup_greeting ?? "Hi! How can we help?",
          });

          return new Response(zip as unknown as BodyInit, {
            status: 200,
            headers: {
              "Content-Type": "application/zip",
              "Content-Disposition": 'attachment; filename="flas-crm-wordpress.zip"',
              "Cache-Control": "no-store",
            },
          });
        } catch (error) {
          console.error("[plugin] download failed", error);
          return new Response("Could not build the plugin right now", { status: 500 });
        }
      },
    },
  },
});
