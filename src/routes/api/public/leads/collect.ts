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

type RoutingRule = {
  id: string;
  match_field: "tag" | "source" | "platform" | "email_domain";
  match_value: string;
  wa_number_id: string;
};

/** Picks the WhatsApp number a new lead should belong to, based on active routing rules. */
async function routeLead(
  rules: RoutingRule[],
  lead: { email: string; platform: string; sourceUrl: string | null; tags: string[] },
): Promise<string | null> {
  const emailDomain = lead.email.split("@")[1]?.toLowerCase() ?? "";
  const haystackTags = lead.tags.map((t) => t.toLowerCase());
  const sourceUrl = (lead.sourceUrl ?? "").toLowerCase();

  for (const rule of rules) {
    const value = rule.match_value.toLowerCase();
    switch (rule.match_field) {
      case "tag":
        if (haystackTags.includes(value)) return rule.wa_number_id;
        break;
      case "platform":
      case "source":
        if (lead.platform.toLowerCase() === value || sourceUrl.includes(value)) {
          return rule.wa_number_id;
        }
        break;
      case "email_domain":
        if (emailDomain === value) return rule.wa_number_id;
        break;
    }
  }
  return null;
}

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
            .select("id, platform, active, status, domain")
            .eq("site_key", parsed.siteKey)
            .maybeSingle();

          if (!site || !site.active) {
            return new Response(JSON.stringify({ error: "Unknown site key" }), {
              status: 401,
              headers: corsHeaders,
            });
          }

          // The site key is embedded in public pages, so also pin it to the
          // registered domain: requests from other origins are rejected.
          if (site.domain) {
            const origin = request.headers.get("origin") ?? request.headers.get("referer") ?? "";
            if (origin && !origin.toLowerCase().includes(site.domain.toLowerCase())) {
              return new Response(JSON.stringify({ error: "This key is not allowed here" }), {
                status: 403,
                headers: corsHeaders,
              });
            }
          }

          const email = parsed.email.toLowerCase();
          const consented = parsed.consent === true;
          const consentAt = consented ? new Date().toISOString() : null;

          // Contact record for the CRM pipeline
          const { data: existingContact } = await supabaseAdmin
            .from("contacts")
            .select("id")
            .eq("email", email)
            .maybeSingle();

          let contactId = existingContact?.id ?? null;
          if (!contactId) {
            const { data: created } = await supabaseAdmin
              .from("contacts")
              .insert({
                email,
                name: parsed.name || email,
                phone: parsed.phone ?? null,
                tags: ["lead", site.platform],
                ...(consented ? { consent_given: true, consent_at: consentAt } : {}),
              })
              .select("id")
              .single();
            contactId = created?.id ?? null;
          } else if (consented) {
            await supabaseAdmin
              .from("contacts")
              .update({ consent_given: true, consent_at: consentAt })
              .eq("id", contactId);
          }

          // Routing: assign the lead to the right WhatsApp number via admin-defined rules
          const { data: rules } = await supabaseAdmin
            .from("lead_routing_rules")
            .select("id, match_field, match_value, wa_number_id")
            .eq("active", true)
            .order("priority", { ascending: true });

          const assignedNumber = await routeLead((rules ?? []) as RoutingRule[], {
            email,
            platform: site.platform,
            sourceUrl: parsed.sourceUrl ?? null,
            tags: [...(parsed.tags ?? []), site.platform],
          });

          const { error } = await supabaseAdmin.from("leads").upsert(
            {
              email,
              name: parsed.name ?? null,
              phone: parsed.phone ?? null,
              source: site.platform,
              source_url: parsed.sourceUrl ?? null,
              site_id: site.id,
              contact_id: contactId,
              tags: parsed.tags ?? [],
              ...(assignedNumber ? { assigned_wa_number_id: assignedNumber } : {}),
              // Never downgrade an existing subscriber; only consent can subscribe.
              ...(consented
                ? { consent_given: true, consent_at: consentAt, subscribed: true }
                : {}),
            },
            { onConflict: "email" },
          );
          if (error) throw error;

          const { logAudit } = await import("@/lib/audit.server");
          if (consented) {
            await logAudit({
              action: "consent.capture",
              entityType: "lead",
              entityId: email,
              details: { siteId: site.id, platform: site.platform, consentAt },
            });
          }
          await logAudit({
            action: "lead.route",
            entityType: "lead",
            entityId: email,
            details: {
              siteId: site.id,
              platform: site.platform,
              matchedRule: Boolean(assignedNumber),
              waNumberId: assignedNumber,
            },
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
