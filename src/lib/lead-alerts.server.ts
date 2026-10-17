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
type StoredAlert = {
  notification_count: number;
  created_notification_count: number;
  email_recipient_count: number;
  diagnostics_pending: boolean;
};
const db = supabaseAdmin as unknown as {
  rpc: (
    name: string,
    args: unknown,
  ) => Promise<{
    data: StoredAlert | null;
    error: { message: string } | null;
  }>;
};
const ALERT_NOT_EMAILED_REASON =
  "Email sending is not connected yet, so this alert was not emailed.";

/** Store once per lead/recipient. A retry never fabricates external delivery. */
export async function dispatchSalesLeadAlert(args: SalesLeadAlertArgs): Promise<{
  notifiedEmails: number;
  notifiedWhatsApp: boolean;
  notifiedInApp: boolean;
  emailNotSent?: string;
  diagnosticsPending?: boolean;
}> {
  if (!args.leadId) throw new Error("A saved lead is required before its alert can be stored.");
  const body = Array.from(`${args.name || args.email} submitted their contact details.`)
    .slice(0, 1000)
    .join("");
  // Recipient selection and deduplication share a database transaction. The
  // server-only function checks lead ownership and never uses a capped profile
  // list or accepts a caller-supplied recipient from a widget.
  const { data, error } = await db.rpc("record_sales_lead_alert", {
    _tenant_id: args.tenantId,
    _lead_id: args.leadId,
    _title: args.isQuoteRequest ? "New quotation request" : "New lead captured",
    _body: body,
  });
  if (
    error ||
    !data ||
    !Number.isInteger(data.notification_count) ||
    data.notification_count < 0 ||
    !Number.isInteger(data.email_recipient_count) ||
    data.email_recipient_count < 0 ||
    typeof data.diagnostics_pending !== "boolean"
  )
    throw new Error("The lead alert could not be stored. Retrying the capture is safe.");
  if (data.diagnostics_pending)
    console.error("[lead-alerts] Unsent external diagnostics remain pending; retrying is safe.");
  return {
    notifiedEmails: 0,
    notifiedWhatsApp: false,
    notifiedInApp: data.notification_count > 0,
    ...(data.email_recipient_count ? { emailNotSent: ALERT_NOT_EMAILED_REASON } : {}),
    ...(data.diagnostics_pending ? { diagnosticsPending: true } : {}),
  };
}
