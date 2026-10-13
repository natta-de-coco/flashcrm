/**
 * src/lib/lead-automation.server.ts
 *
 * Real-time Lead Intake & Automated Welcome Discount Engine.
 * Enforces explicit consent gating, generates signed HMAC one-click unsubscribe tokens, and
 * records welcome emails truthfully: this path calls no sender, so nothing is sent and nothing
 * is logged as sent or delivered.
 */

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

/**
 * What a person is told when mail was asked to go out and nothing was sent because no mail
 * transport is connected yet. Shown as it is, so keep it plain.
 */
export const EMAIL_NOT_CONNECTED_REASON =
  "Email sending is not connected yet, so nothing was sent.";

function readUnsubscribeSecret(): string | null {
  const value = (process.env["EMAIL_UNSUBSCRIBE_SECRET"] ?? "").trim();
  return value.length >= MIN_SECRET_LENGTH ? value : null;
}

function sign(data: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(data).digest("base64url");
}

/**
 * Why a marketing email cannot go out right now. The welcome, drip and campaign paths call no
 * sender, so there is always a reason: either unsubscribe links are not set up (an email
 * without one must never go out) or, when they are, sending itself is not connected. Pass the
 * recipient to also check that a link can be made for them. Callers must refuse, record the
 * email as not sent and leave any progress marker where it is.
 *
 * For whoever connects sending: src/lib/email-dispatch.server.ts already has HTTP senders
 * (Resend, Postmark, Mailgun, via sendTenantEmail), used by plugin activation. What is missing
 * is that these marketing paths do not call one. The code that was removed from them
 * decrypted each company's SMTP password and could not run on the serverless host, so connect
 * them to those HTTP senders, and then change this function and the callers together: a path
 * may record "sent" only after the provider accepted the message, and may move a drip
 * enrolment or a campaign on only after that.
 */
export function whyMarketingEmailCannotBeSent(link?: { email: string; tenantId: string }): string {
  if (!readUnsubscribeSecret()) return UNSUBSCRIBE_NOT_SENT_REASON;
  if (link) {
    try {
      generateUnsubscribeToken(link.email, link.tenantId);
    } catch {
      return UNSUBSCRIBE_NOT_SENT_REASON;
    }
  }
  return EMAIL_NOT_CONNECTED_REASON;
}

/**
 * Writes the delivery-log row for an email that was not sent. The status is always "failed" with
 * the reason: "sent" needs a send, and "delivered" needs a receipt from a provider, and nothing
 * here has either. A log that cannot be written is reported on the server console (without the
 * address) and never changes the answer the caller gives.
 */
export async function recordEmailNotSent(entry: {
  tag: string;
  tenantId: string;
  recipient: string;
  fromAddress: string;
  subject: string;
  template: string;
  provider: string;
  providerMsgId: string;
  reason: string;
  meta: Record<string, unknown>;
}): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.rpc("log_email_delivery", {
      _tenant_id: entry.tenantId,
      _user_id: null,
      _recipient: entry.recipient,
      _from_address: entry.fromAddress,
      _subject: entry.subject,
      _template: entry.template,
      _provider: entry.provider,
      _provider_msg_id: entry.providerMsgId,
      _status: "failed",
      _error: entry.reason,
      _meta: { ...entry.meta, error: entry.reason },
    } as never);
    if (error) console.error(`[${entry.tag}] Could not record the unsent email`);
  } catch {
    console.error(`[${entry.tag}] Could not record the unsent email`);
  }
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
    // Every link we make carries a number for when it stops working. One without it (or with
    // 0, or with text) is not one of ours, so it is refused rather than treated as for ever.
    if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
      return { valid: false, error: "Link has no expiry" };
    }
    if (Math.floor(Date.now() / 1000) > payload.exp) {
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

  // Query this company's existing lead row to check previous consent. Another company holding
  // the same address is a different person's record: its consent is not ours to read, and its
  // row is not ours to change. If the lookup fails the capture stops: carrying on would treat an
  // existing consented subscriber as new.
  const { data: existing, error: lookupError } = await supabaseAdmin
    .from("leads")
    .select("id, consent_given, subscribed")
    .eq("tenant_id", tenantId)
    .eq("email", cleanEmail)
    .maybeSingle();
  if (lookupError) {
    console.error("[leads] Failed to look up existing lead", lookupError);
    throw lookupError;
  }

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
    .upsert(payload as never, { onConflict: "tenant_id,email" })
    .select()
    .single();

  if (error) {
    console.error("[leads] Failed to upsert lead", error);
    throw error;
  }

  // Trigger welcome automation only if consent was explicitly granted
  if (finalConsent) {
    // The lead is already saved: whatever happens to the welcome email, capturing it succeeded.
    try {
      await triggerLeadWelcomeAutomation({
        tenantId,
        email: cleanEmail,
        name: name || "there",
        sourceUrl: sourceUrl || "",
      });
    } catch {
      console.error("[welcome-automation] The welcome email step failed; the lead was kept");
    }

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
 * Real-time trigger for the welcome discount email. This path calls no sender, so it never
 * sends: it records the email as not sent and returns the reason (ok: false).
 */
export async function triggerLeadWelcomeAutomation(params: {
  tenantId: string;
  email: string;
  name: string;
  sourceUrl: string;
}) {
  const { tenantId, email } = params;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Fetch workspace tenant SMTP & automation settings
  const { data: config } = await supabaseAdmin
    .from("tenant_smtp_config")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  interface TenantSmtpConfigRow {
    from_email?: string | null;
    smtp_host?: string | null;
    smtp_user?: string | null;
    verified?: boolean | null;
    welcome_email_enabled?: boolean | null;
    welcome_discount_code?: string | null;
    welcome_subject?: string | null;
  }
  const r = config as TenantSmtpConfigRow | null;
  if (!r || r.welcome_email_enabled === false) {
    return { skipped: true, reason: "Welcome automation disabled" };
  }

  const discountCode = r.welcome_discount_code || "WELCOME20";
  const subject = r.welcome_subject || `Welcome! Here is your exclusive ${discountCode} voucher`;

  // Nothing in this code can send a message yet, so the welcome email is never sent and never
  // recorded as sent or delivered. It is logged as not sent with the plain reason, and the caller
  // (lead capture) carries on: the lead was already saved. A marketing email also never goes out
  // without a working unsubscribe link, so a missing link is reported as the reason first.
  const reason = whyMarketingEmailCannotBeSent({ email, tenantId });
  await recordEmailNotSent({
    tag: "welcome-automation",
    tenantId,
    recipient: email,
    fromAddress: r.from_email || r.smtp_user || "no-reply@mobidigisol.com",
    subject,
    template: "welcome_discount",
    provider: "smtp_relay",
    providerMsgId: `welcome_unsent_${Date.now()}`,
    reason,
    meta: { discount_code: discountCode, smtp_verified: Boolean(r.verified && r.smtp_host) },
  });
  return { ok: false, error: reason };
}
