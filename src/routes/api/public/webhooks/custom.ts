// Custom-site → CRM lead webhook. Any website can POST leads here with the
// site's key + HMAC-SHA256 signature (hex) — same contract as the WordPress
// endpoint, tagged with source "custom".
import { createFileRoute } from "@tanstack/react-router";
import {
  ingestPlatformLead,
  json,
  resolveSite,
  siteLeadSchema,
  verifyHmac,
} from "@/lib/site-webhooks.server";

export const Route = createFileRoute("/api/public/webhooks/custom")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text();
        const siteKey = request.headers.get("x-flash-site-key") ?? "";
        const signature = request.headers.get("x-flash-signature") ?? "";
        if (!siteKey || !signature) return json({ error: "Missing credentials" }, 401);

        const { site, error } = await resolveSite(siteKey, request);
        if (!site) return json({ error }, 403);

        if (!verifyHmac(rawBody, site.webhook_secret, signature, "hex")) {
          return json({ error: "Invalid signature" }, 401);
        }

        let payload;
        try {
          payload = siteLeadSchema.parse(JSON.parse(rawBody));
        } catch {
          return json({ error: "Invalid payload" }, 400);
        }

        try {
          await ingestPlatformLead(site, "custom", payload);
          return json({ ok: true });
        } catch (e) {
          console.error("[webhook:custom]", e);
          return json({ error: "Could not process lead" }, 500);
        }
      },
    },
  },
});
