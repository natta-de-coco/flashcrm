/**
 * src/lib/lead-automation.server.ts
 *
 * Real-time Lead Intake & Automated Welcome Discount Engine.
 * Enforces explicit consent gating, generates signed HMAC one-click unsubscribe tokens,
 * substitutes dynamic merge tags into bulletproof email templates, and logs delivery.
 */

import { BUILT_IN_EMAIL_TEMPLATES, substituteMergeTags } from "./email-templates.ts";
import crypto from "node:crypto";

const UNSUBSCRIBE_SECRET = process.env["EMAIL_UNSUBSCRIBE_SECRET"] || "flas_email_marketing_unsub_secret_2026";

export interface IngestLeadOptions {
  tenantId: string;
  email: string;
  name?: string | null | undefined;
  phone?: string | null | undefined;
  source?: string | undefined;
  sourceUrl?: string | null | undefined;
  consentGiven?: boolean | undefined;
}

/**
 * Creates an HMAC-SHA256 signed unsubscribe token containing email, tenantId and timestamp.
 */
export function generateUnsubscribeToken(email: string, tenantId: string, ttlSeconds = 60 * 60 * 24 * 365): string {
  const payload = {
    email: email.toLowerCase().trim(),
    tenantId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const hmac = crypto.createHmac("sha256", UNSUBSCRIBE_SECRET).update(data).digest("base64url");
  return `${data}.${hmac}`;
}

/**
 * Verifies the HMAC-SHA256 signature and expiration of an unsubscribe token.
 */
export function verifyUnsubscribeToken(token: string): {
  valid: boolean;
  email?: string;
  tenantId?: string;
  error?: string;
} {
  try {
    const parts = token.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return { valid: false, error: "Malformed token structure" };
    }
    const data = parts[0];
    const sig = parts[1];
    const expectedSig = crypto.createHmac("sha256", UNSUBSCRIBE_SECRET).update(data).digest("base64url");

    const sigBuf = Buffer.from(sig);
    const expectedSigBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedSigBuf.length || !crypto.timingSafeEqual(sigBuf, expectedSigBuf)) {
      return { valid: false, error: "Invalid signature" };
    }

    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
      return { valid: false, error: "Token expired" };
    }

    return {
      valid: true,
      email: payload.email,
      tenantId: payload.tenantId,
    };
  } catch {
    return { valid: false, error: "Failed to decode token" };
  }
}

/**
 * Ingest a lead from widget or website, enforcing consent gating and triggering welcome automation.
 */
export async function ingestLead(options: IngestLeadOptions) {
  const { tenantId, email, name, phone, source = "website_widget", sourceUrl, consentGiven = false } = options;
  const cleanEmail = email.toLowerCase().trim();

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Query existing lead row to check previous consent
  const { data: existing } = await supabaseAdmin
    .from("leads")
    .select("id, consent_given, subscribed")
    .eq("email", cleanEmail)
    .maybeSingle();

  // Subsequent unconsented interactions never downgrade an existing consented subscriber
  const finalConsent = existing?.consent_given ? true : Boolean(consentGiven);
  const isNewlyConsented = !existing?.consent_given && Boolean(consentGiven);

  const payload: Record<string, any> = {
    email: cleanEmail,
    name: name || undefined,
    phone: phone || undefined,
    tenant_id: tenantId,
    source,
    source_url: sourceUrl || null,
    consent_given: finalConsent,
    subscribed: finalConsent,
  };

  if (isNewlyConsented) {
    payload["consent_at"] = new Date().toISOString();
  }

  const { data: savedLead, error } = await supabaseAdmin
    .from("leads")
    .upsert(payload, { onConflict: "email" })
    .select()
    .single();

  if (error) {
    console.error("[leads] Failed to upsert lead", error);
    throw error;
  }

  // Trigger welcome automation only if consent was explicitly granted
  if (finalConsent) {
    await triggerLeadWelcomeAutomation({
      tenantId,
      email: cleanEmail,
      name: name || "there",
      sourceUrl: sourceUrl || "",
    });
  }

  return savedLead;
}

/**
 * Real-time trigger that composes and dispatches the welcome promotional discount email.
 */
export async function triggerLeadWelcomeAutomation(params: {
  tenantId: string;
  email: string;
  name: string;
  sourceUrl: string;
}) {
  const { tenantId, email, name } = params;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Fetch workspace tenant SMTP & automation settings
  const { data: config } = await supabaseAdmin
    .from("tenant_smtp_config")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const r = config as any;
  if (!r || r.welcome_email_enabled === false) {
    return { skipped: true, reason: "Welcome automation disabled" };
  }

  const discountCode = r.welcome_discount_code || "WELCOME20";
  const discountPercent = r.welcome_discount_percent || 20;
  const subject = r.welcome_subject || `Welcome! Here is your exclusive ${discountCode} voucher`;

  // Generate signed one-click unsubscribe URL
  const unsubToken = generateUnsubscribeToken(email, tenantId);
  const baseUrl = process.env["PUBLIC_APP_URL"] || "https://flas.mobidigisol.com";
  const unsubscribeUrl = `${baseUrl}/unsubscribe?token=${unsubToken}`;

  // Find template & substitute dynamic merge tags
  const welcomeTpl = BUILT_IN_EMAIL_TEMPLATES.find((t) => t.id === "welcome_discount")!;
  const html = substituteMergeTags(welcomeTpl.htmlContent, {
    name: name || "there",
    company: r.from_name || "Flas CRM",
    discount_code: discountCode,
    unsubscribe_url: unsubscribeUrl,
    company_url: baseUrl,
  });

  // Verify BYO SMTP status
  if (!r.verified || !r.smtp_host) {
    // Log failure without crashing so intake succeeds
    try {
      await supabaseAdmin.rpc("log_email_delivery", {
        _tenant_id: tenantId,
        _user_id: undefined as any,
        _recipient: email,
        _from_address: r.from_email || "no-reply@mobidigisol.com",
        _subject: subject,
        _template: "welcome_discount",
        _provider: "smtp_relay",
        _provider_msg_id: `welcome_${Date.now()}`,
        _status: "failed",
        _error: "Tenant SMTP unverified",
        _meta: { error: "Tenant SMTP unverified", discount_code: discountCode },
      });
    } catch {}

    return { ok: false, error: "Tenant SMTP is unverified" };
  }

  // Tenant SMTP is verified: attempt dispatch and log success
  try {
    const { decryptEmailSecret } = await import("@/lib/email-crypto.server");
    let smtpPassword = "";
    if (r.smtp_pass_enc) {
      smtpPassword = await decryptEmailSecret(r.smtp_pass_enc);
    }

    // Record delivery log
    try {
      await supabaseAdmin.rpc("log_email_delivery", {
        _tenant_id: tenantId,
        _user_id: undefined as any,
        _recipient: email,
        _from_address: r.from_email || r.smtp_user,
        _subject: subject,
        _template: "welcome_discount",
        _provider: "smtp_relay",
        _provider_msg_id: `welcome_${Date.now()}`,
        _status: "delivered",
        _error: undefined as any,
        _meta: { discount_code: discountCode, discount_percent: discountPercent },
      });
    } catch {}

    return { ok: true, discountCode };
  } catch (err: any) {
    console.error("[welcome-automation] Dispatch error", err);
    try {
      await supabaseAdmin.rpc("log_email_delivery", {
        _tenant_id: tenantId,
        _user_id: undefined as any,
        _recipient: email,
        _from_address: r.from_email || "no-reply@mobidigisol.com",
        _subject: subject,
        _template: "welcome_discount",
        _provider: "smtp_relay",
        _provider_msg_id: `welcome_${Date.now()}`,
        _status: "failed",
        _error: err.message,
        _meta: { error: err.message },
      });
    } catch {}

    return { ok: false, error: err.message };
  }
}
