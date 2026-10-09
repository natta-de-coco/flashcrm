import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const RequestSchema = z.object({
  siteKey: z.string().min(10).max(120),
  domain: z.string().max(300).optional(),
  adminEmail: z.string().email().max(200).optional(),
  platform: z.string().max(40).optional(),
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

export const Route = createFileRoute("/api/public/plugin/activate")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      /** Plugin activation hook: registers the site and puts it in "pending" until the email link is used. */
      POST: async ({ request }) => {
        let parsed;
        try {
          parsed = RequestSchema.parse(await request.json());
        } catch {
          return new Response(JSON.stringify({ error: "Invalid payload" }), {
            status: 400,
            headers: corsHeaders,
          });
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { requestSiteActivation } = await import("@/lib/plugin-activation.server");
          const { siteHostname } = await import("@/lib/domain-pin");

          const { data: site } = await supabaseAdmin
            .from("lead_sites")
            .select("id, status, active")
            .eq("site_key", parsed.siteKey)
            .maybeSingle();

          if (!site || !site.active) {
            return new Response(
              JSON.stringify({ status: "unknown", message: "Unknown site key" }),
              { status: 401, headers: corsHeaders },
            );
          }

          const result = await requestSiteActivation({
            siteId: site.id,
            origin: new URL(request.url).origin,
            // The plugin reports its full address (home_url()); the pin is
            // checked against the host name, so that is what is stored. An
            // address that cannot be read is dropped, not stored.
            domain: siteHostname(parsed.domain),
            adminEmail: parsed.adminEmail ?? null,
            platform: parsed.platform ?? "wordpress",
          });

          return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders });
        } catch (error) {
          console.error("[plugin] activation request failed", error);
          return new Response(JSON.stringify({ error: "Activation unavailable right now" }), {
            status: 500,
            headers: corsHeaders,
          });
        }
      },

      /** Email activation link. */
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("token") ?? "";
        // Everything below is a value someone else typed (a site name, a
        // provider's message), printed into hand-written HTML.
        const { escapeHtml } = await import("@/lib/html-escape");
        const html = (rawTitle: string, rawMessage: string, ok: boolean) => {
          const title = escapeHtml(rawTitle);
          const message = escapeHtml(rawMessage);
          return new Response(
            `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${title}</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#062E24;color:#fff;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif">
<main style="max-width:440px;padding:36px;background:rgba(255,255,255,.06);border-radius:18px;text-align:center">
<h1 style="margin:0 0 10px;font-size:22px">${ok ? "Site activated" : title}</h1>
<p style="margin:0;font-size:14px;line-height:1.6;opacity:.85">${message}</p>
</main></body></html>`,
            { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
          );
        };

        if (token.length < 20)
          return html("Invalid link", "This activation link is not valid.", false);

        try {
          const { activateSiteByToken } = await import("@/lib/plugin-activation.server");
          const result = await activateSiteByToken(token);
          return html(
            result.ok ? "Site activated" : "Activation failed",
            result.message,
            result.ok,
          );
        } catch (error) {
          console.error("[plugin] activation failed", error);
          return html("Activation failed", "Please try again in a moment.", false);
        }
      },
    },
  },
});
