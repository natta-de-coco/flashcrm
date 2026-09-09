// Shared HTTP-based email dispatch. Serverless (Cloudflare Workers / Netlify
// Edge) forbids raw TCP sockets, so every send goes through a provider's
// HTTPS API rather than SMTP. Extracted out of tenant-smtp.functions.ts so
// server-only code paths (like plugin activation) can send real email too,
// not just the company-admin "send a test email" flow.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type EmailMessage = {
  from: string;
  to: string;
  subject: string;
  text: string;
  region?: string | undefined;
  domain?: string | undefined;
};

export type DispatchResult = { ok: boolean; providerId?: string; error?: string };

/** Dispatch a plain-text email via one of the supported HTTP providers. */
export async function dispatchEmail(
  provider: string,
  apiKey: string,
  m: EmailMessage,
): Promise<DispatchResult> {
  if (provider === "resend") {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ from: m.from, to: [m.to], subject: m.subject, text: m.text }),
    });
    const body = await r.json().catch(() => ({}) as { id?: string; message?: string });
    return r.ok
      ? { ok: true, providerId: body.id }
      : { ok: false, error: body.message ?? `Resend HTTP ${r.status}` };
  }
  if (provider === "postmark") {
    const r = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": apiKey,
      },
      body: JSON.stringify({ From: m.from, To: m.to, Subject: m.subject, TextBody: m.text }),
    });
    const body = await r.json().catch(() => ({}) as { MessageID?: string; Message?: string });
    return r.ok
      ? { ok: true, providerId: body.MessageID }
      : { ok: false, error: body.Message ?? `Postmark HTTP ${r.status}` };
  }
  if (provider === "mailgun") {
    const host = (m.region ?? "us") === "eu" ? "api.eu.mailgun.net" : "api.mailgun.net";
    if (!m.domain) return { ok: false, error: "Mailgun requires sending domain" };
    const form = new URLSearchParams();
    form.set("from", m.from);
    form.set("to", m.to);
    form.set("subject", m.subject);
    form.set("text", m.text);
    const r = await fetch(`https://${host}/v3/${encodeURIComponent(m.domain)}/messages`, {
      method: "POST",
      headers: { Authorization: `Basic ${btoa(`api:${apiKey}`)}` },
      body: form,
    });
    const body = await r.json().catch(() => ({}) as { id?: string; message?: string });
    return r.ok
      ? { ok: true, providerId: body.id }
      : { ok: false, error: body.message ?? `Mailgun HTTP ${r.status}` };
  }
  if (provider === "sendgrid") {
    const r = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: m.to }] }],
        from: { email: m.from.replace(/^.*<(.+)>$/, "$1"), name: m.from.replace(/\s*<.*$/, "") },
        subject: m.subject,
        content: [{ type: "text/plain", value: m.text }],
      }),
    });
    const providerId = r.headers.get("x-message-id");
    if (r.ok) return providerId ? { ok: true, providerId } : { ok: true };
    const txt = await r.text().catch(() => "");
    return { ok: false, error: `SendGrid HTTP ${r.status}: ${txt.slice(0, 200)}` };
  }
  return {
    ok: false,
    error: `Provider ${provider} not implemented — add a dispatcher in email-dispatch.server.ts`,
  };
}

/**
 * Sends a real email on behalf of a tenant, using that tenant's configured
 * provider if they've set one up, otherwise the platform-wide fallback
 * (PLATFORM_EMAIL_PROVIDER / PLATFORM_EMAIL_API_KEY / PLATFORM_EMAIL_FROM env
 * vars). Returns ok:false with a clear reason instead of silently pretending
 * to have sent something — the previous version of this code path only ever
 * called console.info and always claimed success.
 */
export async function sendTenantEmail(
  tenantId: string,
  message: { to: string; subject: string; text: string },
): Promise<DispatchResult> {
  const { data: config } = await supabaseAdmin
    .from("tenant_smtp_config")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  let provider = config?.provider ?? "platform";
  let apiKey: string | null = null;
  let from = config?.from_email ?? null;
  const fromName = config?.from_name ?? null;
  const region = config?.region ?? undefined;
  const domain = config?.domain ?? undefined;

  if (config && provider !== "platform") {
    const { data: key } = await supabaseAdmin.rpc("get_tenant_smtp_api_key", {
      _tenant_id: tenantId,
    });
    apiKey = (key as string | null) ?? null;
  }

  if (!apiKey) {
    // Fall back to the platform-wide provider, if one has been configured.
    provider = process.env["PLATFORM_EMAIL_PROVIDER"] ?? "";
    apiKey = process.env["PLATFORM_EMAIL_API_KEY"] ?? null;
    from = from ?? process.env["PLATFORM_EMAIL_FROM"] ?? null;
  }

  if (!apiKey || !provider || !from) {
    const result: DispatchResult = {
      ok: false,
      error:
        "No email provider is configured for this workspace or the platform (set PLATFORM_EMAIL_PROVIDER / PLATFORM_EMAIL_API_KEY / PLATFORM_EMAIL_FROM, or have the company configure Settings → Email).",
    };
    await logEmailAttempt(tenantId, message, provider || "none", result);
    return result;
  }

  const fromHeader = fromName ? `${fromName} <${from}>` : from;
  const result = await dispatchEmail(provider, apiKey, {
    from: fromHeader,
    to: message.to,
    subject: message.subject,
    text: message.text,
    region,
    domain,
  });
  await logEmailAttempt(tenantId, message, provider, result);
  return result;
}

async function logEmailAttempt(
  tenantId: string,
  message: { to: string; subject: string },
  provider: string,
  result: DispatchResult,
) {
  try {
    await supabaseAdmin.rpc("log_email_delivery", {
      _tenant_id: tenantId,
      _user_id: null,
      _recipient: message.to,
      _from_address: process.env["PLATFORM_EMAIL_FROM"] ?? "",
      _subject: message.subject,
      _template: "plugin_activation",
      _provider: provider,
      _provider_msg_id: result.providerId ?? null,
      _status: result.ok ? "sent" : "failed",
      _error: result.error ?? null,
      _meta: {},
    } as never);
  } catch (e) {
    console.error("[email] failed to log delivery attempt", e);
  }
}
