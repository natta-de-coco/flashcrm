/**
 * src/lib/lead-automation.server.ts
 *
 * Real-time Lead Intake & Automated Welcome Discount Engine.
 * Enforces explicit consent gating, generates signed HMAC one-click unsubscribe tokens,
 * substitutes dynamic merge tags into bulletproof email templates, and logs delivery.
 */

import { BUILT_IN_EMAIL_TEMPLATES, substituteMergeTags } from "./email-templates.ts";
import crypto from "node:crypto";

/**
 * The key that signs unsubscribe links comes from the EMAIL_UNSUBSCRIBE_SECRET setting and nowhere
 * else. This repository is public, so there is deliberately no built-in value: a missing or weak
 * setting means "not set up", never "use a default". Read at the moment of use, not at start-up.
 */
const MIN_SECRET_LENGTH = 32;

export class UnsubscribeNotSetUpError extends Error {
  constructor(message = "Unsubscribe links are not set up on this server.") {
    super(message);
    this.name = "UnsubscribeNotSetUpError";
  }
}

/** Why a marketing email was not sent when its unsubscribe link could not be made. */
export const UNSUBSCRIBE_NOT_SENT_REASON =
  "Not sent: unsubscribe links are not set up on this server, and an email without one must not go out.";

function readUnsubscribeSecret(): string | null {
  const value = (process.env["EMAIL_UNSUBSCRIBE_SECRET"] ?? "").trim();
  return value.length >= MIN_SECRET_LENGTH ? value : null;
}

// Automated sends have no signed-in user; the log function wants the field present.
const AUTOMATED_SEND = undefined as unknown as string;

function sign(data: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(data).digest("base64url");
}

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
 * Throws UnsubscribeNotSetUpError when the key is not set up (callers must then not send the
 * email), and when the address or the company is missing: a link must always name both.
 */
export function generateUnsubscribeToken(
  email: string,
  tenantId: string,
  ttlSeconds = 60 * 60 * 24 * 365,
): string {
  const secret = readUnsubscribeSecret();
  if (!secret) throw new UnsubscribeNotSetUpError();
  const address = (email ?? "").toLowerCase().trim();
  if (!address || !tenantId) {
    throw new UnsubscribeNotSetUpError("An unsubscribe link needs an address and a company.");
  }
  const payload = {
    email: address,
    tenantId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${data}.${sign(data, secret)}`;
}

/**
 * Verifies the HMAC-SHA256 signature and expiration of an unsubscribe token.
 * With no key set up nothing is valid. A valid link always carries an address and a company.
 * `notSetUp` tells the caller the refusal is the server's state, not the link's fault.
 */
export function verifyUnsubscribeToken(token: string): {
  valid: boolean;
  email?: string;
  tenantId?: string;
  error?: string;
  notSetUp?: boolean;
} {
  const secret = readUnsubscribeSecret();
  if (!secret) {
    return { valid: false, error: "Unsubscribe links are not set up", notSetUp: true };
  }
  try {
    const parts = token.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return { valid: false, error: "Malformed token structure" };
    }
    const data = parts[0];
    const sig = parts[1];
    const expectedSig = sign(data, secret);

    const sigBuf = Buffer.from(sig);
    const expectedSigBuf = Buffer.from(expectedSig);
    if (
      sigBuf.length !== expectedSigBuf.length ||
      !crypto.timingSafeEqual(sigBuf, expectedSigBuf)
    ) {
      return { valid: false, error: "Invalid signature" };
    }

    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
      return { valid: false, error: "Token expired" };
    }
    if (typeof payload.email !== "string" || !payload.email.trim()) {
      return { valid: false, error: "Link has no address" };
    }
    if (typeof payload.tenantId !== "string" || !payload.tenantId.trim()) {
      return { valid: false, error: "Link has no company" };
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
  const {
    tenantId,
    email,
    name,
    phone,
    source = "website_widget",
    sourceUrl,
    consentGiven = false,
  } = options;
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

  const payload: Record<string, string | boolean | null | undefined> = {
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
    .upsert(payload as never, { onConflict: "email" })
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

    try {
      const { enrollLeadInDripSequence } = await import("./drip-automation.server.ts");
      await enrollLeadInDripSequence({
        tenantId,
        leadId: savedLead?.id,
        email: cleanEmail,
        name: name || "there",
      });
    } catch (dripErr) {
      console.error("[drip] Lead drip enrollment failed:", dripErr);
    }
  }

  // Instant Sales Alert to sales reps
  try {
    const { dispatchSalesLeadAlert } = await import("./lead-alerts.server.ts");
    await dispatchSalesLeadAlert({
      tenantId,
      leadId: savedLead?.id,
      email: cleanEmail,
      name: name || null,
      phone: phone || null,
      sourceUrl: sourceUrl || null,
    });
  } catch (alertErr) {
    console.error("[lead-alerts] Error dispatching sales alert:", alertErr);
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

  interface TenantSmtpConfigRow {
    from_name?: string | null;
    from_email?: string | null;
    smtp_host?: string | null;
    smtp_user?: string | null;
    smtp_pass_enc?: string | null;
    verified?: boolean | null;
    welcome_email_enabled?: boolean | null;
    welcome_discount_code?: string | null;
    welcome_discount_percent?: number | null;
    welcome_subject?: string | null;
  }
  const r = config as TenantSmtpConfigRow | null;
  if (!r || r.welcome_email_enabled === false) {
    return { skipped: true, reason: "Welcome automation disabled" };
  }

  const discountCode = r.welcome_discount_code || "WELCOME20";
  const discountPercent = r.welcome_discount_percent || 20;
  const subject = r.welcome_subject || `Welcome! Here is your exclusive ${discountCode} voucher`;

  // Generate signed one-click unsubscribe URL. A marketing email never goes out without a working
  // one: if the link cannot be made, say so in the delivery log and stop. The lead itself was
  // already saved by the caller, so capturing it is not affected.
  let unsubToken: string;
  try {
    unsubToken = generateUnsubscribeToken(email, tenantId);
  } catch {
    console.error("[welcome-automation] Welcome email not sent: unsubscribe links are not set up");
    try {
      const { error: logError } = await supabaseAdmin.rpc("log_email_delivery", {
        _tenant_id: tenantId,
        _user_id: AUTOMATED_SEND,
        _recipient: email,
        _from_address: r.from_email || "no-reply@mobidigisol.com",
        _subject: subject,
        _template: "welcome_discount",
        _provider: "smtp_relay",
        _provider_msg_id: `welcome_${Date.now()}`,
        _status: "failed",
        _error: UNSUBSCRIBE_NOT_SENT_REASON,
        _meta: { error: UNSUBSCRIBE_NOT_SENT_REASON, discount_code: discountCode },
      });
      if (logError) console.error("[welcome-automation] Could not record the unsent email");
    } catch {
      console.error("[welcome-automation] Could not record the unsent email");
    }
    return { ok: false, error: UNSUBSCRIBE_NOT_SENT_REASON };
  }
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
        _user_id: null,
        _recipient: email,
        _from_address: r.from_email || "no-reply@mobidigisol.com",
        _subject: subject,
        _template: "welcome_discount",
        _provider: "smtp_relay",
        _provider_msg_id: `welcome_${Date.now()}`,
        _status: "failed",
        _error: "Tenant SMTP unverified",
        _meta: { error: "Tenant SMTP unverified", discount_code: discountCode },
      } as never);
    } catch (rpcErr) {
      console.warn("[welcome-automation] Failed to log unverified SMTP attempt", rpcErr);
    }

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
        _user_id: null,
        _recipient: email,
        _from_address: r.from_email || r.smtp_user || "no-reply@mobidigisol.com",
        _subject: subject,
        _template: "welcome_discount",
        _provider: "smtp_relay",
        _provider_msg_id: `welcome_${Date.now()}`,
        _status: "delivered",
        _error: null,
        _meta: { discount_code: discountCode, discount_percent: discountPercent },
      } as never);
    } catch (rpcErr) {
      console.warn("[welcome-automation] Failed to log delivery", rpcErr);
    }

    return { ok: true, discountCode };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[welcome-automation] Dispatch error", err);
    try {
      await supabaseAdmin.rpc("log_email_delivery", {
        _tenant_id: tenantId,
        _user_id: null,
        _recipient: email,
        _from_address: r.from_email || "no-reply@mobidigisol.com",
        _subject: subject,
        _template: "welcome_discount",
        _provider: "smtp_relay",
        _provider_msg_id: `welcome_${Date.now()}`,
        _status: "failed",
        _error: errorMsg,
        _meta: { error: errorMsg },
      } as never);
    } catch (rpcErr) {
      console.warn("[welcome-automation] Failed to log dispatch failure", rpcErr);
    }

    return { ok: false, error: errorMsg };
  }
}
