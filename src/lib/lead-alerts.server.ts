/**
 * src/lib/lead-alerts.server.ts
 *
 * Real-time Instant Sales Lead Alert Dispatcher.
 * Notifies sales reps by WhatsApp and in-app alert whenever a new lead submits their contact info
 * or requests a quotation in the widget. Email alerts are not sent yet (this path calls no
 * sender): they are logged as not sent and never counted.
 */

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

interface TenantAlertSettingsRecord {
  lead_alerts_enabled?: boolean | null;
  alert_email_addresses?: string[] | null;
  alert_whatsapp_enabled?: boolean | null;
  alert_whatsapp_phone?: string | null;
}

interface ProfileEmailRecord {
  email?: string | null;
}

interface UntypedDbResult<T = unknown> {
  data: T | null;
  error: { message: string } | null;
}

interface UntypedDbQuery {
  select: (cols?: string) => UntypedDbQuery;
  insert: (values: unknown) => UntypedDbQuery;
  eq: (col: string, val: unknown) => UntypedDbQuery;
  in: (col: string, vals: unknown[]) => UntypedDbQuery;
  limit: (count: number) => UntypedDbQuery;
  maybeSingle: <T = unknown>() => Promise<UntypedDbResult<T>>;
  then: <T = unknown>(resolve: (val: UntypedDbResult<T>) => void) => Promise<unknown>;
}

interface UntypedDbClient {
  from: (table: string) => UntypedDbQuery;
  rpc: (fn: string, args?: unknown) => Promise<UntypedDbResult<unknown>>;
}

const db = (client: unknown): UntypedDbClient => client as unknown as UntypedDbClient;

/**
 * What a person is told when an alert was meant to be emailed and nothing was sent because no mail
 * transport is connected yet. Shown as it is, so keep it plain.
 */
const ALERT_NOT_EMAILED_REASON =
  "Email sending is not connected yet, so this alert was not emailed.";

export async function dispatchSalesLeadAlert(args: SalesLeadAlertArgs): Promise<{
  notifiedEmails: number;
  notifiedWhatsApp: boolean;
  /** Set when email alerts were due and none could be sent; says why. */
  emailNotSent?: string;
}> {
  const { tenantId, leadId, email, name, phone, sourceUrl, isQuoteRequest = false } = args;

  // 1. Fetch workspace alert configuration
  const { data: rawSettings } = await db(supabaseAdmin)
    .from("tenant_alert_settings")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle<TenantAlertSettingsRecord>();

  const settings = rawSettings;

  // If no settings exist yet, default to enabled for workspace owner
  const alertsEnabled = settings ? settings.lead_alerts_enabled : true;
  if (!alertsEnabled) {
    return { notifiedEmails: 0, notifiedWhatsApp: false };
  }

  // Resolve target email addresses
  let targetEmails: string[] = settings?.alert_email_addresses || [];
  if (targetEmails.length === 0) {
    // Fall back to workspace profile owners
    const { data: owners } = await db(supabaseAdmin)
      .from("profiles")
      .select("email")
      .eq("tenant_id", tenantId)
      .in("role", ["admin", "owner", "agent"])
      .limit(5);

    targetEmails = ((owners as ProfileEmailRecord[]) || [])
      .map((o) => o.email)
      .filter((e): e is string => Boolean(e));
  }

  const subject = isQuoteRequest
    ? `🔥 Hot Lead Alert: ${name || email} requested a quotation`
    : `⚡ New Lead Captured: ${name || email}`;

  let notifiedWhatsApp = false;

  // 2. Email alerts. Nothing in this code can send an email yet, so an alert is never recorded as
  // sent and never counted: each recipient is logged as "not sent" with the plain reason, and the
  // caller is told (emailNotSent). The in-app notification below is the alert that really goes out.
  for (const recipient of targetEmails) {
    try {
      const { error } = await db(supabaseAdmin).rpc("log_email_delivery", {
        _tenant_id: tenantId,
        _user_id: null,
        _recipient: recipient,
        _from_address: "flas@mobidigisol.com",
        _subject: subject,
        _template: "internal_sales_lead_alert",
        _provider: "platform_smtp",
        _provider_msg_id: `alert_unsent_${leadId || Date.now()}`,
        _status: "failed",
        _error: ALERT_NOT_EMAILED_REASON,
        _meta: { lead_email: email, name, sourceUrl, error: ALERT_NOT_EMAILED_REASON },
      });
      if (error) console.error("[lead-alerts] Could not record the unsent alert email");
    } catch {
      console.error("[lead-alerts] Could not record the unsent alert email");
    }

    try {
      const { error } = await db(supabaseAdmin)
        .from("lead_alerts_log")
        .insert({
          tenant_id: tenantId,
          lead_id: leadId || null,
          alert_channel: "email",
          recipient,
          subject,
          status: "failed",
          error: ALERT_NOT_EMAILED_REASON,
        });
      if (error) console.error("[lead-alerts] Could not record the unsent alert");
    } catch {
      console.error("[lead-alerts] Could not record the unsent alert");
    }
  }
  const emailNotSent = targetEmails.length > 0 ? ALERT_NOT_EMAILED_REASON : undefined;

  // 3. Dispatch WhatsApp Alert if configured
  if (settings?.alert_whatsapp_enabled && settings.alert_whatsapp_phone) {
    try {
      const { resolveWaCredentials, sendWhatsAppText } = await import("./wa.server");
      const creds = await resolveWaCredentials(tenantId);
      if (creds && creds.token && creds.phoneNumberId) {
        const waText =
          `🚨 *Flas Hot Lead Alert*\n\n` +
          `*Name:* ${name || "Visitor"}\n` +
          `*Email:* ${email}\n` +
          `*Phone:* ${phone || "N/A"}\n` +
          `*Source:* ${sourceUrl || "Website"}\n\n` +
          `Please contact this lead promptly.`;

        await sendWhatsAppText(settings.alert_whatsapp_phone, waText, creds);

        await db(supabaseAdmin)
          .from("lead_alerts_log")
          .insert({
            tenant_id: tenantId,
            lead_id: leadId || null,
            alert_channel: "whatsapp",
            recipient: settings.alert_whatsapp_phone,
            subject: "WhatsApp Alert",
            status: "sent",
          });

        notifiedWhatsApp = true;
      }
    } catch (e) {
      console.error("[lead-alerts] Failed to send WhatsApp alert:", e);
    }
  }

  // 4. In-App Notification (Database table)
  try {
    await db(supabaseAdmin)
      .from("notifications")
      .insert({
        tenant_id: tenantId,
        type: "new_lead",
        title: subject,
        message: `${name || email} submitted their contact details via website widget.`,
        link: "/marketing",
      });
  } catch (notifErr: unknown) {
    console.warn("[lead-alerts] Failed to insert in-app notification:", notifErr);
  }

  // No email alert is ever counted as sent: notifiedEmails stays 0 until a real send exists.
  return emailNotSent === undefined
    ? { notifiedEmails: 0, notifiedWhatsApp }
    : { notifiedEmails: 0, notifiedWhatsApp, emailNotSent };
}
