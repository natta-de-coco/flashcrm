// WordPress → CRM lead webhook. The plugin POSTs form submissions here with an
// HMAC-SHA256 signature (hex) in X-Flas-Signature over the raw body.
import { createFileRoute } from "@tanstack/react-router";
import {
  json,
  receivePlatformLead,
  resolveSite,
  siteLeadSchema,
  verifyHmac,
} from "@/lib/site-webhooks.server";

export const Route = createFileRoute("/api/public/webhooks/wordpress")({
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

        // Claiming the delivery, the site's limit, saving the lead and giving the
        // claim back if any of that fails all happen in one place.
        return receivePlatformLead({ site, platform: "wordpress", rawBody, payload });
      },
    },
  },
});
