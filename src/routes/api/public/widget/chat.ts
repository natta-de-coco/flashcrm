import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const PayloadSchema = z.object({
  // 32+ chars so a session id can't be brute-forced/guessed to hijack a live
  // conversation. siteKey is required — see below for why.
  sessionId: z.string().min(32).max(80),
  siteKey: z.string().min(10).max(120),
  name: z.string().max(80).optional(),
  message: z.string().min(1).max(2000),

  // Identity, collected by the widget before the first message. The product
  // has always claimed the widget captures a WhatsApp number and email before
  // chatting; until now the endpoint had nowhere to put either.
  email: z.string().email().max(320).optional(),
  phone: z.string().trim().min(6).max(32).optional(),

  // Consent to marketing is deliberately its own field, not implied by
  // starting a chat. Someone asking a question has not agreed to receive
  // campaigns, and treating those as the same thing is what earns blocks.
  marketingConsent: z.boolean().optional(),
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

        // A chat costs an AI call and database writes, and nobody signed in
        // for it, so the two ways to abuse it are both capped.
        const { widgetChatAllowed } = await import("@/lib/public-limits.server");
        const limit = await widgetChatAllowed({
          tenantId: site.tenant_id,
          sessionId: parsed.sessionId,
        });
        if (!limit.ok) {
          return new Response(JSON.stringify({ error: limit.error }), {
            status: limit.status,
            headers: { ...corsHeaders, "retry-after": String(limit.retryAfterSeconds) },
          });
        }

        try {
          const { ingestInboundMessage } = await import("@/lib/wa.server");
          const { reply, contactId, contactCreated } = await ingestInboundMessage({
            tenantId: site.tenant_id,
            channel: "web",
            sessionId: parsed.sessionId,
            name: parsed.name ?? null,
            phone: parsed.phone ?? null,
            text: parsed.message,
          });

          // Attach the rest of the identity to the contact this chat created.
          //
          // It used to be written to whichever contact had this phone number in
          // this workspace, which meant a visitor who typed somebody else's
          // number could replace that person's email address and record
          // marketing consent in their name. Nobody signs in to a widget, so a
          // typed-in number proves nothing: details are only filled in for a
          // contact this chat itself created, and a claim about an existing
          // contact is recorded for the team to look at instead of applied.
          if (parsed.email || parsed.marketingConsent) {
            const { logAudit } = await import("@/lib/audit.server");
            const claim = {
              sessionId: parsed.sessionId,
              siteKey: parsed.siteKey.slice(0, 6),
              hasEmail: Boolean(parsed.email),
              marketingConsent: parsed.marketingConsent === true,
            };
            if (contactId && contactCreated) {
              try {
                const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
                const patch: {
                  email?: string;
                  consent_given?: boolean;
                  consent_at?: string;
                } = {};
                if (parsed.email) patch.email = parsed.email;
                if (parsed.marketingConsent) {
                  patch.consent_given = true;
                  patch.consent_at = new Date().toISOString();
                }
                await supabaseAdmin
                  .from("contacts")
                  .update(patch)
                  .eq("tenant_id", site.tenant_id)
                  .eq("id", contactId);
                if (parsed.marketingConsent) {
                  // Consent has to be evidenced, not just stored.
                  await logAudit({
                    action: "consent.capture",
                    tenantId: site.tenant_id,
                    entityType: "contact",
                    entityId: contactId,
                    details: { ...claim, source: "website widget" },
                  });
                }
              } catch (error) {
                // The message is already delivered; failing to annotate the
                // contact must not turn that into an error for the visitor.
                console.error("[widget] could not record identity", error);
              }
            } else {
              await logAudit({
                action: "widget.identity_claim_ignored",
                tenantId: site.tenant_id,
                entityType: "contact",
                entityId: contactId ?? parsed.sessionId,
                details: {
                  ...claim,
                  reason: "the contact already existed, so the widget may not change it",
                },
              });
            }
          }

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
