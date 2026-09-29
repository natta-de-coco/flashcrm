// The site key for the chat widget on Flas's own marketing pages.
//
// The widget was taken off the homepage on 8 Sep because it was embedded
// without a key, so visitors typed and every message was silently rejected
// while the panel said "a team member will reply shortly". This brings it back
// as a setting rather than a hard-coded key: create a website under
// Integrations, in the platform owner's workspace, with this site's domain,
// and the widget appears. Deactivate that site and it disappears.
//
// Public on purpose. A site key is not a secret -- widget.js puts it in the
// page for anyone to read -- and it is only returned for a host the site is
// registered for.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { pickHomepageSite, type OwnerSite } from "@/lib/homepage-widget";

const HostSchema = z.object({
  host: z
    .string()
    .trim()
    .min(1)
    .max(253)
    .regex(/^[a-z0-9.-]+$/i),
});

export const getHomepageWidgetKey = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => HostSchema.parse(input))
  .handler(async ({ data }): Promise<{ siteKey: string | null }> => {
    // The widget is optional: any backend problem (including a missing server
    // key in a preview environment) hides it instead of crashing the page.
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      const { data: owners, error: ownerError } = await supabaseAdmin
        .from("profiles")
        .select("tenant_id")
        .eq("staff_role", "super_admin")
        .not("tenant_id", "is", null);
      if (ownerError) return { siteKey: null };
      const ownerTenantIds = [
        ...new Set((owners ?? []).map((o) => o.tenant_id).filter((t): t is string => Boolean(t))),
      ];
      if (ownerTenantIds.length === 0) return { siteKey: null };

      const { data: sites, error } = await supabaseAdmin
        .from("lead_sites")
        .select("site_key, domain, active, status, tenant_id, created_at")
        .in("tenant_id", ownerTenantIds);
      if (error) return { siteKey: null };

      return { siteKey: pickHomepageSite((sites ?? []) as OwnerSite[], ownerTenantIds, data.host) };
    } catch (err) {
      console.warn("homepage widget key unavailable:", err instanceof Error ? err.message : err);
      return { siteKey: null };
    }
  });
