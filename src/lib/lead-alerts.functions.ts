/**
 * src/lib/lead-alerts.functions.ts
 *
 * Server functions for Sales Lead Alert Settings.
 */

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

type Client = SupabaseClient<Database>;

async function resolveTenant(supabase: Client, userId: string): Promise<string> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", userId)
    .maybeSingle();

  if (!profile?.tenant_id) {
    throw new Error("No active workspace found for this user account");
  }

  return profile.tenant_id;
}

export interface LeadAlertSettingsData {
  leadAlertsEnabled: boolean;
  alertEmailAddresses: string[];
  alertWhatsappEnabled: boolean;
  alertWhatsappPhone: string | null;
}

export const getLeadAlertSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LeadAlertSettingsData> => {
    const tenantId = await resolveTenant(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data } = await (supabaseAdmin as any)
      .from("tenant_alert_settings")
      .select("*")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    return {
      leadAlertsEnabled: data?.lead_alerts_enabled ?? true,
      alertEmailAddresses: data?.alert_email_addresses ?? [],
      alertWhatsappEnabled: data?.alert_whatsapp_enabled ?? false,
      alertWhatsappPhone: data?.alert_whatsapp_phone ?? null,
    };
  });

const SaveLeadAlertSchema = z.object({
  leadAlertsEnabled: z.boolean(),
  alertEmailAddresses: z.array(z.string().email()),
  alertWhatsappEnabled: z.boolean(),
  alertWhatsappPhone: z.string().nullable().optional(),
});

export const saveLeadAlertSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SaveLeadAlertSchema.parse(input))
  .handler(async ({ data, context }) => {
    const tenantId = await resolveTenant(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const payload = {
      tenant_id: tenantId,
      lead_alerts_enabled: data.leadAlertsEnabled,
      alert_email_addresses: data.alertEmailAddresses,
      alert_whatsapp_enabled: data.alertWhatsappEnabled,
      alert_whatsapp_phone: data.alertWhatsappPhone || null,
      updated_at: new Date().toISOString(),
    };

    const { error } = await (supabaseAdmin as any)
      .from("tenant_alert_settings")
      .upsert(payload, { onConflict: "tenant_id" });

    if (error) throw new Error(error.message);

    return { ok: true };
  });
