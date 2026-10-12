// Shared lead-ingestion pipeline used by the website widget, the popup plugin,
// and the platform webhooks (WordPress / Shopify / custom). One code path keeps
// contact creation, consent capture and routing-rule assignment uniform.

export type RoutingRule = {
  id: string;
  match_field: "tag" | "source" | "platform" | "email_domain";
  match_value: string;
  wa_number_id: string;
};

/** Picks the WhatsApp number a new lead should belong to, based on active routing rules. */
export function routeLead(
  rules: RoutingRule[],
  lead: { email: string; platform: string; sourceUrl: string | null; tags: string[] },
): string | null {
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

export type IngestLeadInput = {
  /**
   * Owning company. Resolved from the site key server-side — never from the
   * request body. Without it, rows land with a NULL tenant_id and RLS hides
   * them from the company that captured the lead.
   */
  tenantId: string;
  siteId: string;
  sitePlatform: string;
  email: string;
  name?: string | null;
  phone?: string | null;
  sourceUrl?: string | null;
  consent: boolean;
  tags: string[];
};

/**
 * Creates/updates the contact + lead records, applies consent and routing
 * rules, and writes compliance audit entries. Returns nothing; throws on error.
 *
 * Every query is scoped to `input.tenantId`: this runs with the service-role
 * client (RLS bypassed) because public webhooks have no user session, so
 * tenant isolation has to be enforced here in code.
 */
export async function ingestLead(input: IngestLeadInput): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const tenantId = input.tenantId;
  if (!tenantId) throw new Error("ingestLead requires a tenantId");

  const email = input.email.toLowerCase();
  const consented = input.consent === true;
  const consentAt = consented ? new Date().toISOString() : null;

  // Contact record for the CRM pipeline — deduped within this company only.
  const { data: existingContact } = await supabaseAdmin
    .from("contacts")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("email", email)
    .maybeSingle();

  let contactId = existingContact?.id ?? null;
  if (!contactId) {
    const { data: created, error: contactError } = await supabaseAdmin
      .from("contacts")
      .insert({
        tenant_id: tenantId,
        email,
        name: input.name || email,
        phone: input.phone ?? null,
        tags: ["lead", input.sitePlatform],
        ...(consented ? { consent_given: true, consent_at: consentAt } : {}),
      })
      .select("id")
      .single();
    // A failed contact insert used to be ignored, and the lead was written
    // anyway: a lead belonging to nobody, unroutable, while the website was
    // told everything went fine. Refuse instead, so the site can send it again.
    if (contactError || !created?.id) {
      throw new Error(
        `Could not save the contact for this lead: ${contactError?.message ?? "no contact was created"}`,
      );
    }
    contactId = created.id;
  } else if (consented) {
    await supabaseAdmin
      .from("contacts")
      .update({ consent_given: true, consent_at: consentAt })
      .eq("id", contactId);
  }

  // Routing: assign the lead to the right WhatsApp number via admin-defined
  // rules belonging to this company.
  const { data: rules } = await supabaseAdmin
    .from("lead_routing_rules")
    .select("id, match_field, match_value, wa_number_id")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .order("priority", { ascending: true });

  const assignedNumber = routeLead((rules ?? []) as RoutingRule[], {
    email,
    platform: input.sitePlatform,
    sourceUrl: input.sourceUrl ?? null,
    tags: [...input.tags, input.sitePlatform],
  });

  const { error } = await supabaseAdmin.from("leads").upsert(
    {
      tenant_id: tenantId,
      email,
      name: input.name ?? null,
      phone: input.phone ?? null,
      source: input.sitePlatform,
      source_url: input.sourceUrl ?? null,
      site_id: input.siteId,
      contact_id: contactId,
      tags: input.tags,
      ...(assignedNumber ? { assigned_wa_number_id: assignedNumber } : {}),
      // Never downgrade an existing subscriber; only consent can subscribe.
      ...(consented ? { consent_given: true, consent_at: consentAt, subscribed: true } : {}),
    },
    { onConflict: "tenant_id,email" },
  );
  if (error) throw error;

  const { logAudit } = await import("@/lib/audit.server");
  if (consented) {
    await logAudit({
      action: "consent.capture",
      entityType: "lead",
      entityId: email,
      details: { siteId: input.siteId, platform: input.sitePlatform, consentAt },
    });
  }
  await logAudit({
    action: "lead.route",
    entityType: "lead",
    entityId: email,
    details: {
      siteId: input.siteId,
      platform: input.sitePlatform,
      matchedRule: Boolean(assignedNumber),
      waNumberId: assignedNumber,
    },
  });
}
