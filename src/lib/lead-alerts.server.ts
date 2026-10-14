import { supabaseAdmin } from "@/integrations/supabase/client.server";
export interface SalesLeadAlertArgs {
  tenantId: string;
  leadId?: string | null;
  email: string;
  name?: string | null;
  phone?: string | null;
  sourceUrl?: string | null;
  isQuoteRequest?: boolean;
}
interface Settings {
  lead_alerts_enabled?: boolean | null;
  alert_email_addresses?: string[] | null;
  alert_whatsapp_enabled?: boolean | null;
  alert_whatsapp_phone?: string | null;
}
type Result<T> = { data: T | null; error: { message: string } | null };
interface Query extends PromiseLike<Result<unknown>> {
  select: (columns: string) => Query;
  eq: (column: string, value: unknown) => Query;
  in: (column: string, values: string[]) => Query;
  limit: (count: number) => Query;
  insert: (values: unknown) => Query;
  maybeSingle: <T>() => Promise<Result<T>>;
}
const db = supabaseAdmin as unknown as { from: (table: string) => Query };

/** Store an in-app notification. Never fabricate external delivery evidence. */
export async function dispatchSalesLeadAlert(
  args: SalesLeadAlertArgs,
): Promise<{ notifiedEmails: number; notifiedWhatsApp: boolean; notifiedInApp: boolean }> {
  const { data: settings, error: settingsError } = await db
    .from("tenant_alert_settings")
    .select("*")
    .eq("tenant_id", args.tenantId)
    .maybeSingle<Settings>();
  if (settingsError) throw new Error("Lead alert settings could not be read; no alerts were sent.");
  if (settings?.lead_alerts_enabled === false)
    return { notifiedEmails: 0, notifiedWhatsApp: false, notifiedInApp: false };
  const { data: profileData, error: profileError } = await db
    .from("profiles")
    .select("id, email, staff_role")
    .eq("tenant_id", args.tenantId)
    .in("staff_role", ["company_admin", "super_admin", "marketing_manager", "staff"])
    .limit(100);
  if (profileError) throw new Error("Lead notification recipients could not be read.");
  const profiles = (profileData ?? []) as {
    id: string;
    email: string | null;
    staff_role: string;
  }[];
  const configuredEmails = [...new Set(settings?.alert_email_addresses ?? [])];
  const managers = profiles.filter((profile) =>
    ["company_admin", "super_admin"].includes(profile.staff_role),
  );
  const recipients = profiles.filter(
    (profile) =>
      managers.includes(profile) ||
      (!!profile.email && configuredEmails.includes(profile.email.toLowerCase())),
  );
  const emails = configuredEmails.length
    ? configuredEmails
    : managers.map((profile) => profile.email).filter((email): email is string => !!email);
  const subject = args.isQuoteRequest ? "New quotation request" : "New lead captured";
  const failures = emails.map((recipient) => ({
    tenant_id: args.tenantId,
    lead_id: args.leadId ?? null,
    alert_channel: "email",
    recipient,
    subject,
    status: "failed",
    error: "FLAS_EMAIL_ALERT_TRANSPORT_UNAVAILABLE",
  }));
  if (settings?.alert_whatsapp_enabled && settings.alert_whatsapp_phone)
    failures.push({
      tenant_id: args.tenantId,
      lead_id: args.leadId ?? null,
      alert_channel: "whatsapp",
      recipient: settings.alert_whatsapp_phone,
      subject,
      status: "failed",
      error: "FLAS_WHATSAPP_ALERT_PIPELINE_UNAVAILABLE",
    });
  if (failures.length) {
    const { error } = await db.from("lead_alerts_log").insert(failures);
    if (error)
      throw new Error(
        "Lead alert setup failures could not be recorded; no external alerts were sent.",
      );
  }
  // Real email transport and approved WhatsApp utility templates/pipeline are
  // separate work. Do not call a raw WA sender or log a provider receipt here.
  if (!recipients.length)
    return { notifiedEmails: 0, notifiedWhatsApp: false, notifiedInApp: false };
  const body = Array.from(`${args.name || args.email} submitted their contact details.`)
    .slice(0, 1000)
    .join("");
  const { error } = await db
    .from("workspace_notifications")
    .insert(
      recipients.map((profile) => ({
        tenant_id: args.tenantId,
        recipient_user_id: profile.id,
        lead_id: args.leadId ?? null,
        title: subject,
        body,
      })),
    );
  if (error) throw new Error("The in-app lead notifications could not be saved.");
  return { notifiedEmails: 0, notifiedWhatsApp: false, notifiedInApp: true };
}
