import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const PayloadSchema = z.object({
  siteKey: z.string().min(10).max(120),
  email: z.string().email().max(200),
  name: z.string().max(120).optional(),
  phone: z.string().max(32).optional(),
  sourceUrl: z.string().max(500).optional(),
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
            .select("id, platform, active")
            .eq("site_key", parsed.siteKey)
            .maybeSingle();

          if (!site || !site.active) {
            return new Response(JSON.stringify({ error: "Unknown site key" }), {
              status: 401,
              headers: corsHeaders,
            });
          }

          const email = parsed.email.toLowerCase();

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
              })
              .select("id")
              .single();
            contactId = created?.id ?? null;
          }

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
            },
            { onConflict: "email" },
          );
          if (error) throw error;

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
