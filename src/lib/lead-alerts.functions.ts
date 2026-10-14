/**
 * src/lib/lead-alerts.functions.ts
 *
 * Server functions for Sales Lead Alert Settings.
 */

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerFn } from "@tanstack/react-start";
import { LeadAlertPreferencesSchema } from "./lead-alert-settings";
import { isCompanyManager } from "./permissions";

type Client = SupabaseClient<Database>;

async function resolveTenant(supabase: Client, userId: string): Promise<string> {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("tenant_id, staff_role")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!isCompanyManager(profile?.staff_role))
    throw new Error("Only a company admin can manage lead alert preferences.");
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

interface TenantAlertSettingsRecord {
  lead_alerts_enabled?: boolean | null;
  alert_email_addresses?: string[] | null;
  alert_whatsapp_enabled?: boolean | null;
  alert_whatsapp_phone?: string | null;
}

interface UntypedDbResult<T = unknown> {
  data: T | null;
  error: { message: string } | null;
}

interface UntypedDbQuery {
  select: (cols?: string) => UntypedDbQuery;
  upsert: (values: unknown, opts?: unknown) => UntypedDbQuery;
  eq: (col: string, val: unknown) => UntypedDbQuery;
  maybeSingle: <T = unknown>() => Promise<UntypedDbResult<T>>;
  then: <T = unknown>(resolve: (val: UntypedDbResult<T>) => void) => Promise<unknown>;
}

interface UntypedDbClient {
  from: (table: string) => UntypedDbQuery;
}

const db = (client: unknown): UntypedDbClient => client as unknown as UntypedDbClient;

export const getLeadAlertSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LeadAlertSettingsData> => {
    const tenantId = await resolveTenant(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data, error } = await db(supabaseAdmin)
      .from("tenant_alert_settings")
      .select("*")
      .eq("tenant_id", tenantId)
      .maybeSingle<TenantAlertSettingsRecord>();

    if (error) throw new Error(error.message);
    return {
      leadAlertsEnabled: data?.lead_alerts_enabled ?? true,
      alertEmailAddresses: data?.alert_email_addresses ?? [],
      alertWhatsappEnabled: data?.alert_whatsapp_enabled ?? false,
      alertWhatsappPhone: data?.alert_whatsapp_phone ?? null,
    };
  });

export const saveLeadAlertSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => LeadAlertPreferencesSchema.parse(input))
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

    const { error } = await db(supabaseAdmin)
      .from("tenant_alert_settings")
      .upsert(payload, { onConflict: "tenant_id" });

    if (error) throw new Error(error.message);

    return { ok: true };
  });
