// Workspace region, currency and language. Every company using Flas sets its
// own country, so amounts, dates, AI replies and the compliance rules we
// enforce all follow that company — never another one's settings.
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { COUNTRIES, CURRENCIES, LANGUAGES, regionForCountry } from "@/lib/locale";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const RegionSchema = z.object({
  country: z.enum(COUNTRIES.map((c) => c.code) as [string, ...string[]]),
  currency: z.enum(CURRENCIES.map((c) => c.code) as [string, ...string[]]),
  locale: z.enum(LANGUAGES.map((l) => l.code) as [string, ...string[]]),
  timezone: z.string().min(1).max(64),
});

export const getWorkspaceRegion = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("tenant_id, staff_role")
      .eq("id", context.userId)
      .maybeSingle();
    if (!profile?.tenant_id) return null;
    const { data } = await context.supabase
      .from("organizations")
      .select("id, name, country, currency, locale, timezone, compliance_region")
      .eq("id", profile.tenant_id)
      .maybeSingle();
    return data ? { ...data, staff_role: profile.staff_role } : null;
  });

export const saveWorkspaceRegion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RegionSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("tenant_id, staff_role")
      .eq("id", context.userId)
      .maybeSingle();
    if (!profile?.tenant_id) throw new Error("Your workspace is still being set up.");
    // The real staff_role enum is company_admin/marketing_manager/staff/seo_editor/
    // super_admin — "owner"/"admin" never exist as values, so this check locked
    // out every real company admin from ever changing region/currency.
    if (!["company_admin", "super_admin"].includes(profile.staff_role ?? "")) {
      throw new Error("Only a company admin can change regional settings.");
    }

    const { error } = await context.supabase
      .from("organizations")
      .update({
        country: data.country,
        currency: data.currency,
        locale: data.locale,
        timezone: data.timezone,
        compliance_region: regionForCountry(data.country),
      })
      .eq("id", profile.tenant_id);
    if (error) throw error;

    const { logAudit } = await import("@/lib/audit.server");
    await logAudit({
      action: "workspace.region_updated",
      tenantId: profile.tenant_id,
      actorId: context.userId,
      entityType: "organization",
      entityId: profile.tenant_id,
      details: data as never,
    });
    return { ok: true, region: regionForCountry(data.country) };
  });
