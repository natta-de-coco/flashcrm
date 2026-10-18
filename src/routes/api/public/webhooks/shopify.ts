// Shopify → CRM lead webhook. Accepts Shopify's native HMAC header
// (X-Shopify-Hmac-Sha256, base64) so stores can point a native webhook at us,
// plus the same X-Flas-Signature scheme used by the theme snippet.
import { createFileRoute } from "@tanstack/react-router";
import {
  json,
  receivePlatformLead,
  resolveSite,
  siteLeadSchema,
  verifyHmac,
} from "@/lib/site-webhooks.server";

export const Route = createFileRoute("/api/public/webhooks/shopify")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text();
        const siteKey =
          request.headers.get("x-flash-site-key") ??
          new URL(request.url).searchParams.get("site") ??
          "";
        if (!siteKey) return json({ error: "Missing site key" }, 401);

        const { site, error } = await resolveSite(siteKey, request);
        if (!site) return json({ error }, 403);

        const shopifyHmac = request.headers.get("x-shopify-hmac-sha256");
        const flashSig = request.headers.get("x-flash-signature");
        const verified = shopifyHmac
          ? verifyHmac(rawBody, site.webhook_secret, shopifyHmac, "base64")
          : flashSig
            ? verifyHmac(rawBody, site.webhook_secret, flashSig, "hex")
            : false;
        if (!verified) return json({ error: "Invalid signature" }, 401);

        let payload;
        try {
          payload = siteLeadSchema.parse(JSON.parse(rawBody));
        } catch {
          return json({ error: "Invalid payload" }, 400);
        }

        // Claiming the delivery, the site's limit, saving the lead and giving the
        // claim back if any of that fails all happen in one place.
        return receivePlatformLead({ site, platform: "shopify", rawBody, payload });
      },
    },
  },
});
