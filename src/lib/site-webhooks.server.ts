// Shared pipeline for platform webhooks (WordPress, Shopify, custom sites).
// Every event is HMAC-SHA256 verified against the site's secret, then routed
// into the lead engine so contacts/leads, consent and assignment stay uniform.
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";
import { hostMatchesPin } from "@/lib/domain-pin";

export const siteLeadSchema = z.object({
  name: z.string().max(200).optional(),
  email: z.string().email().max(320).optional(),
  phone: z.string().max(40).optional(),
  message: z.string().max(4000).optional(),
  tags: z.array(z.string().max(60)).max(20).optional(),
  consent: z.boolean().optional(),
  source_url: z.string().url().max(2048).optional(),
  custom_fields: z.record(z.string(), z.unknown()).optional(),
});

export type SiteLeadPayload = z.infer<typeof siteLeadSchema>;

export function verifyHmac(
  rawBody: string,
  secret: string,
  signature: string,
  digest: "hex" | "base64",
): boolean {
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest(digest);
  const a = Buffer.from(signature.trim());
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function getOrigin(req: Request): string | null {
  return req.headers.get("origin") ?? req.headers.get("referer");
}

export function extractHost(req: Request): string | null {
  const origin = getOrigin(req);
  if (!origin) return null;
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
}

/** Loads an active site by key and enforces domain pinning when a domain is set. */
export async function resolveSite(siteKey: string, req: Request) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: site } = await supabaseAdmin
    .from("lead_sites")
    .select("*")
    .eq("site_key", siteKey)
    .eq("active", true)
    .maybeSingle();
  if (!site) return { site: null as null, error: "Unknown or inactive site" };

  if (site.domain) {
    const host = extractHost(req);
    // Shopify calls come from the shop domain server-side (no Origin header) —
    // when there's no origin to check, the HMAC signature is the auth.
    if (host && !hostMatchesPin(host, site.domain)) {
      return { site: null as null, error: "Domain not allowed for this site key" };
    }
  }
  return { site, error: null as string | null };
}

export type LeadSite = {
  id: string;
  tenant_id: string | null;
  name: string;
  platform: string;
  domain: string | null;
  webhook_secret: string;
  active: boolean;
};

/** Feeds a verified platform lead into the shared lead engine. */
export async function ingestPlatformLead(
  site: LeadSite,
  platform: string,
  payload: SiteLeadPayload,
) {
  if (!payload.email) {
    throw new Error("Platform leads require an email address");
  }
  if (!site.tenant_id) {
    throw new Error("This site is not linked to a workspace yet");
  }
  const { ingestLead } = await import("@/lib/leads.server");

  await ingestLead({
    tenantId: site.tenant_id,
    siteId: site.id,
    sitePlatform: platform,
    email: payload.email,
    name: payload.name ?? null,
    phone: payload.phone ?? null,
    sourceUrl: payload.source_url ?? null,
    consent: payload.consent ?? false,
    tags: payload.tags ?? [],
  });

  const { logAudit } = await import("@/lib/audit.server");
  await logAudit({
    action: "webhook.platform_lead",
    entityType: "lead_site",
    entityId: site.id,
    details: {
      platform,
      siteName: site.name,
      hasPhone: Boolean(payload.phone),
      messageLen: payload.message?.length ?? 0,
      customFieldKeys: Object.keys(payload.custom_fields ?? {}),
    },
  });
  return { ok: true };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/**
 * The checks that come after "is this signature valid?" and before the lead is
 * written. A signature proves a body was produced by someone holding the
 * secret; it does not prove this is the first time that body has arrived, so a
 * captured request could be sent again and again. Each delivery is therefore
 * remembered once, and a site cannot write leads without limit.
 */
export async function acceptPlatformEvent(args: {
  site: LeadSite;
  platform: string;
  rawBody: string;
  request: Request;
}): Promise<{ ok: true } | { ok: false; response: Response }> {
  const { webhookEventId, firstTimeSeen, leadIntakeAllowed } =
    await import("@/lib/public-limits.server");

  const eventId = webhookEventId(args.rawBody, args.request);
  if (!(await firstTimeSeen(`site:${args.platform}:${args.site.id}`, eventId))) {
    // Answer 200 so the provider stops retrying, but do the work only once.
    return { ok: false, response: json({ ok: true, duplicate: true }) };
  }

  if (args.site.tenant_id) {
    const limit = await leadIntakeAllowed({
      tenantId: args.site.tenant_id,
      siteId: args.site.id,
    });
    if (!limit.ok) {
      return {
        ok: false,
        response: json({ error: limit.error }, 429, {
          "retry-after": String(limit.retryAfterSeconds),
        }),
      };
    }
  }

  return { ok: true };
}
