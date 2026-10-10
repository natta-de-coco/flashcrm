// Flas CRM Dual-Tier Email Infrastructure — E2E Test Harness & Specification Engine
// Implements authoritative interface contracts and opaque-box verification primitives
// as specified in ORIGINAL_REQUEST.md and PROJECT.md.

import crypto from "node:crypto";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * R1: PLATFORM SUPER-ADMIN EMAIL CRYPTOGRAPHY & CONNECTION PRIMITIVES
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const SYSTEM_PLATFORM_EMAIL = "flas@mobidigisol.com";
export const SYSTEM_PLATFORM_NAME = "Flas CRM";

/** Parse key ring configuration e.g. "k1:base64...,k2:base64..." */
export function parseKeyRing(keysStr, activeId) {
  if (!keysStr || !activeId) {
    throw new Error("Missing encryption key ring configuration");
  }
  const map = new Map();
  for (const pair of keysStr.split(",")) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const [id, b64] = trimmed.split(":");
    if (!id || !b64) throw new Error("Malformed key ring entry");
    const raw = Buffer.from(b64, "base64");
    if (raw.length !== 32) {
      throw new Error(`Key ${id} must be exactly 32 bytes (256 bits)`);
    }
    if (map.has(id)) {
      throw new Error(`Duplicate key ID: ${id}`);
    }
    map.set(id, raw);
  }
  if (!map.has(activeId)) {
    throw new Error(`Active key ID ${activeId} not found in key ring`);
  }
  return { keys: map, activeId };
}

/** Envelope AES-256-GCM encryption with Additional Authenticated Data (AAD) */
export async function encryptEmailSecret(plaintext, aad, ring) {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("Plaintext cannot be empty");
  }
  const keyBuf = ring.keys.get(ring.activeId);
  if (!keyBuf) throw new Error("Active key not found");

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBuf, iv);
  if (aad) {
    cipher.setAAD(Buffer.from(aad, "utf8"));
  }
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `v1:${ring.activeId}:${iv.toString("base64url")}:${ciphertext.toString("base64url")}:${tag.toString("base64url")}`;
}

/** Envelope AES-256-GCM decryption with AAD check */
export async function decryptEmailSecret(envelope, aad, ring) {
  if (typeof envelope !== "string" || !envelope.startsWith("v1:")) {
    const err = new Error("Malformed envelope");
    err.code = "malformed";
    throw err;
  }
  const parts = envelope.split(":");
  if (parts.length !== 5) {
    const err = new Error("Malformed envelope structure");
    err.code = "malformed";
    throw err;
  }
  const [, keyId, ivB64, ctB64, tagB64] = parts;
  const keyBuf = ring.keys.get(keyId);
  if (!keyBuf) {
    const err = new Error(`Key ${keyId} not present in key ring`);
    err.code = "unknown_key";
    throw err;
  }

  try {
    const iv = Buffer.from(ivB64, "base64url");
    const ciphertext = Buffer.from(ctB64, "base64url");
    const tag = Buffer.from(tagB64, "base64url");

    const decipher = crypto.createDecipheriv("aes-256-gcm", keyBuf, iv);
    decipher.setAuthTag(tag);
    if (aad) {
      decipher.setAAD(Buffer.from(aad, "utf8"));
    }
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    const err = new Error("Authentication failed: invalid tag or ciphertext tampered");
    err.code = "authentication_failed";
    throw err;
  }
}

/** Verify Role-Based Access: Super Admin Gate */
export function verifySuperAdminAccess(userRole) {
  if (userRole !== "super_admin") {
    const err = new Error("This area is only available to the Flas platform manager");
    err.code = "forbidden";
    err.status = 403;
    throw err;
  }
  return true;
}

/** Simulate SMTP Connection Handshake with socket validation rules */
export async function simulateSmtpHandshake({ host, port, secure, user, pass, fromEmail }) {
  if (!host || typeof host !== "string" || host.trim().length === 0) {
    return { ok: false, latencyMs: 0, error: "Invalid SMTP host" };
  }
  if (![25, 465, 587, 2525].includes(Number(port))) {
    return { ok: false, latencyMs: 0, error: `Invalid SMTP port: ${port}. Expected 465 or 587.` };
  }
  if (/[\r\n]/.test(host) || /[\r\n]/.test(fromEmail || "")) {
    return { ok: false, latencyMs: 0, error: "CRLF injection detected in host or from address" };
  }
  if (!user || !pass) {
    return { ok: false, latencyMs: 0, error: "Missing SMTP credentials" };
  }

  // Simulated socket latency (10-35ms)
  const latencyMs = Math.floor(10 + Math.random() * 25);

  // Failure simulation on invalid test hosts
  if (host === "unreachable.test" || host.includes("timeout")) {
    return { ok: false, latencyMs: 5000, error: "ETIMEDOUT: Connection handshake timed out" };
  }
  if (pass === "wrong_password" || user === "unauthorized_user") {
    return { ok: false, latencyMs, error: "535 5.7.8 Authentication credentials invalid" };
  }

  return {
    ok: true,
    latencyMs,
    serverBanner: "220 smtp.mobidigisol.com ESMTP Postfix",
    handshake: "250-AUTH LOGIN PLAIN",
    authStatus: "235 2.7.0 Authentication successful",
  };
}

/** Simulate IMAP Connection Handshake */
export async function simulateImapHandshake({ host, port, secure, user, pass }) {
  if (!host || typeof host !== "string") {
    return { ok: false, latencyMs: 0, error: "Invalid IMAP host" };
  }
  if (![143, 993].includes(Number(port))) {
    return { ok: false, latencyMs: 0, error: `Invalid IMAP port: ${port}. Expected 993.` };
  }
  if (!user || !pass) {
    return { ok: false, latencyMs: 0, error: "Missing IMAP credentials" };
  }
  if (pass === "wrong_password") {
    return { ok: false, latencyMs: 15, error: "NO [AUTHENTICATIONFAILED] Invalid credentials" };
  }
  return {
    ok: true,
    latencyMs: 18,
    serverGreeting: "* OK IMAP4rev1 Service Ready",
    loginStatus: "A001 OK LOGIN completed",
    inboxStatus: "A002 OK [READ-WRITE] SELECT completed",
  };
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * R2: TENANT STRICT BYO MARKETING SETTINGS & ENFORCEMENT ENGINE
 * ─────────────────────────────────────────────────────────────────────────────
 */

export class TenantSmtpStore {
  constructor() {
    this.configs = new Map();
  }

  getConfig(tenantId) {
    const cfg = this.configs.get(tenantId);
    if (!cfg) {
      return {
        tenant_id: tenantId,
        provider: "platform",
        from_email: null,
        from_name: null,
        reply_to: null,
        smtp_host: null,
        smtp_port: 587,
        smtp_user: null,
        smtp_secure: "tls",
        imap_host: null,
        imap_port: 993,
        imap_user: null,
        imap_enabled: false,
        verified: false,
        last_test_at: null,
        last_test_ok: null,
        last_test_error: null,
      };
    }
    // Mask sensitive encrypted passwords from ordinary returns
    const { smtp_pass_enc, imap_pass_enc, ...safe } = cfg;
    return safe;
  }

  saveConfig(tenantId, patch) {
    const existing = this.configs.get(tenantId) || {};
    // Modifying any connection field immediately revokes verified status
    const connectionChanged =
      (patch.smtp_host !== undefined && patch.smtp_host !== existing.smtp_host) ||
      (patch.smtp_port !== undefined && patch.smtp_port !== existing.smtp_port) ||
      (patch.smtp_user !== undefined && patch.smtp_user !== existing.smtp_user) ||
      (patch.smtp_pass_enc !== undefined && patch.smtp_pass_enc !== existing.smtp_pass_enc) ||
      (patch.provider !== undefined && patch.provider !== existing.provider);

    const updated = {
      ...existing,
      ...patch,
      tenant_id: tenantId,
      verified: connectionChanged ? false : (patch.verified ?? existing.verified ?? false),
      updated_at: new Date().toISOString(),
    };
    this.configs.set(tenantId, updated);
    return updated;
  }

  recordTestResult(tenantId, result) {
    const cfg = this.configs.get(tenantId);
    if (!cfg) throw new Error("No SMTP config saved yet");
    cfg.last_test_at = new Date().toISOString();
    cfg.last_test_ok = result.ok;
    cfg.last_test_error = result.error || null;
    cfg.verified = Boolean(result.ok);
    this.configs.set(tenantId, cfg);
    return cfg;
  }
}

/** Strictly verify BYO before campaign scheduling or dispatch */
export function assertTenantByoVerified(tenantConfig) {
  if (!tenantConfig || !tenantConfig.verified || tenantConfig.last_test_ok !== true) {
    const err = new Error(
      "Cannot schedule or send campaign without verified tenant SMTP credentials. Please connect and verify your active SMTP server in Settings → Email Marketing.",
    );
    err.code = "byo_smtp_unverified";
    throw err;
  }
  return true;
}

/** Generate SPF, DKIM, and DMARC DNS Records */
export function generateDomainDnsGuide(domain, relayHost = "relay.flas.mobidigisol.com") {
  if (
    !domain ||
    domain.includes("..") ||
    !/^[a-zA-Z0-9]+([\-\.]{1}[a-zA-Z0-9]+)*\.[a-zA-Z]{2,}$/.test(domain)
  ) {
    throw new Error("Invalid domain name");
  }
  return {
    domain,
    spf: {
      type: "TXT",
      name: "@",
      value: `v=spf1 include:${relayHost} ~all`,
      description: "Authorizes Flas CRM tenant relay to send on behalf of domain",
    },
    dkim: {
      type: "TXT",
      name: "flas._domainkey",
      value: `v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC3...`,
      description: "Cryptographically authenticates email integrity",
    },
    dmarc: {
      type: "TXT",
      name: "_dmarc",
      value: `v=DMARC1; p=reject; pct=100; rua=mailto:dmarc@${domain}`,
      description: "Enforces strict domain alignment policy",
    },
  };
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * R3: CONSENT-GATED LEAD INTAKE & WEBSITE WIDGET ENGINE
 * ─────────────────────────────────────────────────────────────────────────────
 */

export class LeadIntakeEngine {
  constructor() {
    this.leads = new Map(); // key: `${tenantId}:${email}`
    this.contacts = new Map(); // key: `${tenantId}:${email}`
    this.auditLogs = [];
  }

  async ingestLead({
    tenantId,
    siteId,
    sitePlatform,
    email,
    name,
    phone,
    sourceUrl,
    consent,
    tags = [],
  }) {
    if (!tenantId) throw new Error("ingestLead requires a tenantId");
    if (!email || !email.includes("@")) throw new Error("Valid email is required");

    const normEmail = email.trim().toLowerCase();
    const isConsented = consent === true;
    const nowIso = new Date().toISOString();
    const consentAt = isConsented ? nowIso : null;

    // 1. CRM Contact Upsert (preserve prior consent if already given)
    const contactKey = `${tenantId}:${normEmail}`;
    let contact = this.contacts.get(contactKey);
    if (!contact) {
      contact = {
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        email: normEmail,
        name: name || normEmail,
        phone: phone || null,
        tags: ["lead", sitePlatform, ...tags],
        consent_given: isConsented,
        consent_at: consentAt,
        created_at: nowIso,
      };
      this.contacts.set(contactKey, contact);
    } else if (isConsented) {
      contact.consent_given = true;
      contact.consent_at = consentAt;
    }

    // 2. Leads Table Upsert (Explicit un-ticked consent rule: never downgrade subscriber)
    const leadKey = `${tenantId}:${normEmail}`;
    let lead = this.leads.get(leadKey);
    const wasAlreadyConsented = lead?.consent_given === true;

    const updatedLead = {
      id: lead?.id || crypto.randomUUID(),
      tenant_id: tenantId,
      contact_id: contact.id,
      site_id: siteId || null,
      email: normEmail,
      name: name || normEmail,
      phone: phone || null,
      source: sitePlatform,
      source_url: sourceUrl || null,
      tags: Array.from(new Set([...(lead?.tags || []), ...tags])),
      status: "new",
      // Consent is strictly recorded
      consent_given: isConsented || wasAlreadyConsented,
      consent_at: isConsented ? consentAt : lead?.consent_at || null,
      subscribed: isConsented || wasAlreadyConsented,
      updated_at: nowIso,
    };
    this.leads.set(leadKey, updatedLead);

    // 3. Audit trail
    if (isConsented) {
      this.auditLogs.push({
        action: "consent.capture",
        entityType: "lead",
        entityId: normEmail,
        tenantId,
        details: { siteId, platform: sitePlatform, consentAt, sourceUrl },
      });
    }

    return { lead: updatedLead, isNewConsented: isConsented && !wasAlreadyConsented };
  }

  getAudiencePool(tenantId, segment = "all_consented") {
    const consentedLeads = [];
    for (const lead of this.leads.values()) {
      if (lead.tenant_id === tenantId && lead.consent_given === true && lead.subscribed === true) {
        if (segment === "all_consented") {
          consentedLeads.push(lead);
        } else if (lead.tags.includes(segment) || lead.source === segment) {
          consentedLeads.push(lead);
        }
      }
    }
    return consentedLeads;
  }
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * R4: AUTOMATED WELCOME & DISCOUNT OFFER TRIGGER ENGINE
 * ─────────────────────────────────────────────────────────────────────────────
 */

export class WelcomeAutomationEngine {
  constructor(smtpStore) {
    this.smtpStore = smtpStore;
    this.deliveryLogs = [];
    this.automationRules = new Map(); // tenantId -> config
  }

  setAutomationRule(tenantId, config) {
    this.automationRules.set(tenantId, {
      enabled: config.enabled ?? true,
      discountCode: config.discountCode || "WELCOME10",
      discountDescription: config.discountDescription || "10% off your first order",
      subjectTemplate:
        config.subjectTemplate || "Welcome to {{company}}! Your {{discount_code}} inside",
      bodyTemplate:
        config.bodyTemplate ||
        "Hi {{name}},\n\nWelcome! Use coupon {{discount_code}} for {{discount_desc}}.\n\nUnsubscribe: {{unsubscribe_url}}",
      htmlTemplate:
        config.htmlTemplate ||
        "<p>Hi {{name}},</p><p>Use code <strong>{{discount_code}}</strong>!</p><p><a href='{{unsubscribe_url}}'>Unsubscribe</a></p>",
    });
  }

  getAutomationRule(tenantId) {
    return (
      this.automationRules.get(tenantId) || {
        enabled: true,
        discountCode: "WELCOME10",
        discountDescription: "10% off your first order",
        subjectTemplate: "Welcome to {{company}}! Your {{discount_code}} discount is inside",
        bodyTemplate:
          "Hi {{name}},\n\nWelcome to {{company}}! Here is your discount: {{discount_code}} ({{discount_desc}}).\n\nUnsubscribe: {{unsubscribe_url}}",
        htmlTemplate:
          "<p>Hi {{name}},</p><p>Welcome to {{company}}! Here is your code: <b>{{discount_code}}</b></p><a href='{{unsubscribe_url}}'>Unsubscribe</a>",
      }
    );
  }

  async triggerWelcomeIfConsented(tenantId, lead, companyName = "Flas CRM") {
    // R3/R4 Invariant: Only trigger if consent was explicitly given
    if (!lead || lead.consent_given !== true) {
      return { triggered: false, reason: "Consent not given — automated welcome email withheld" };
    }

    const rule = this.getAutomationRule(tenantId);
    if (!rule.enabled) {
      return { triggered: false, reason: "Welcome automation disabled for this tenant" };
    }

    // Check BYO tenant SMTP status (R2 constraint)
    const tenantSmtp = this.smtpStore.getConfig(tenantId);
    const isSmtpReady = tenantSmtp.verified === true && tenantSmtp.last_test_ok === true;

    const unsubscribeUrl = generateUnsubscribeUrl(lead.email, tenantId, "plat_secret_key");

    // Dynamic merge tag substitution
    const replaceTags = (tmpl) =>
      tmpl
        .replace(/\{\{name\}\}/g, lead.name || "there")
        .replace(/\{\{company\}\}/g, companyName)
        .replace(/\{\{discount_code\}\}/g, rule.discountCode)
        .replace(/\{\{discount_desc\}\}/g, rule.discountDescription)
        .replace(/\{\{unsubscribe_url\}\}/g, unsubscribeUrl);

    const subject = replaceTags(rule.subjectTemplate);
    const bodyText = replaceTags(rule.bodyTemplate);
    const bodyHtml = replaceTags(rule.htmlTemplate);

    const deliveryId = crypto.randomUUID();
    const logEntry = {
      id: deliveryId,
      tenant_id: tenantId,
      recipient: lead.email,
      from_address: tenantSmtp.from_email || "no-reply@flas.mobidigisol.com",
      subject,
      template: "welcome_discount",
      provider: tenantSmtp.provider || "platform",
      status: isSmtpReady ? "delivered" : "failed",
      error: isSmtpReady ? null : "Tenant outbound SMTP unverified: automated welcome suppressed",
      meta: {
        discount_code: rule.discountCode,
        lead_source: lead.source,
        source_url: lead.source_url,
      },
      created_at: new Date().toISOString(),
    };

    this.deliveryLogs.push(logEntry);

    return {
      triggered: true,
      delivered: isSmtpReady,
      deliveryId,
      subject,
      bodyText,
      bodyHtml,
      discountCode: rule.discountCode,
      logEntry,
    };
  }
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * R5: VISUAL CAMPAIGN BOARD, TEMPLATE COMPOSER & ONE-CLICK UNSUBSCRIBE
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const CAMPAIGN_STAGES = ["draft", "scheduled", "in_progress", "sent", "paused"];

export class CampaignBoardEngine {
  constructor(smtpStore, leadIntakeEngine) {
    this.smtpStore = smtpStore;
    this.leadEngine = leadIntakeEngine;
    this.campaigns = new Map();
  }

  createCampaign(tenantId, { name, subject, body, html, audienceTag }) {
    if (!name || !subject || (!body && !html)) {
      throw new Error("Campaign requires name, subject, and body content");
    }
    const id = crypto.randomUUID();
    const campaign = {
      id,
      tenant_id: tenantId,
      name,
      subject,
      body: body || "",
      html: html || "",
      audience_tag: audienceTag || "all_consented",
      status: "draft",
      recipients_count: 0,
      created_at: new Date().toISOString(),
    };
    this.campaigns.set(id, campaign);
    return campaign;
  }

  transitionStage(campaignId, targetStage) {
    const c = this.campaigns.get(campaignId);
    if (!c) throw new Error("Campaign not found");
    if (!CAMPAIGN_STAGES.includes(targetStage)) {
      throw new Error(
        `Invalid stage: ${targetStage}. Expected one of: ${CAMPAIGN_STAGES.join(", ")}`,
      );
    }

    // State machine rules
    if (c.status === "sent" && targetStage === "draft") {
      throw new Error("Cannot revert a completed Sent campaign back to Draft");
    }

    // BYO SMTP strict enforcement gate (R2 constraint)
    if (["scheduled", "in_progress"].includes(targetStage)) {
      const smtp = this.smtpStore.getConfig(c.tenant_id);
      assertTenantByoVerified(smtp);

      // Mandatory unsubscribe check (R5 constraint)
      const fullContent = `${c.body} ${c.html}`;
      if (!fullContent.includes("{{unsubscribe_url}}")) {
        throw new Error(
          "Campaign template must contain a mandatory one-click unsubscribe mechanism ({{unsubscribe_url}})",
        );
      }
    }

    c.status = targetStage;
    if (targetStage === "scheduled") c.scheduled_at = new Date().toISOString();
    if (targetStage === "sent") c.sent_at = new Date().toISOString();
    return c;
  }

  renderTemplateForRecipient(
    campaign,
    recipient,
    companyName = "Flas CRM",
    discountCode = "SUMMER20",
  ) {
    const unsubscribeUrl = generateUnsubscribeUrl(
      recipient.email,
      campaign.tenant_id,
      "plat_secret_key",
    );
    const replace = (str) =>
      str
        .replace(/\{\{name\}\}/g, recipient.name || "there")
        .replace(/\{\{company\}\}/g, companyName)
        .replace(/\{\{discount_code\}\}/g, discountCode)
        .replace(/\{\{unsubscribe_url\}\}/g, unsubscribeUrl);

    return {
      subject: replace(campaign.subject),
      body: replace(campaign.body),
      html: replace(campaign.html),
      unsubscribeUrl,
    };
  }
}

/** One-Click Unsubscribe HMAC Token Generator & Validator */
export function generateUnsubscribeToken(email, tenantId, secret, ttlMs = 86400000 * 30) {
  const exp = Date.now() + ttlMs;
  const payload = `${email.toLowerCase()}|${tenantId}|${exp}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return Buffer.from(`${payload}|${sig}`).toString("base64url");
}

export function generateUnsubscribeUrl(
  email,
  tenantId,
  secret,
  baseUrl = "https://flas.mobidigisol.com",
) {
  const token = generateUnsubscribeToken(email, tenantId, secret);
  return `${baseUrl}/unsubscribe?token=${token}`;
}

export function verifyAndExecuteUnsubscribe(token, secret, leadEngine) {
  if (!token || typeof token !== "string") {
    return { ok: false, error: "Missing unsubscribe token" };
  }
  let decoded;
  try {
    decoded = Buffer.from(token, "base64url").toString("utf8");
  } catch {
    return { ok: false, error: "Malformed token encoding" };
  }
  const parts = decoded.split("|");
  if (parts.length !== 4) {
    return { ok: false, error: "Invalid token payload structure" };
  }
  const [email, tenantId, expStr, sig] = parts;
  const exp = Number(expStr);
  if (isNaN(exp) || Date.now() > exp) {
    return { ok: false, error: "Unsubscribe link has expired" };
  }

  const expectedPayload = `${email}|${tenantId}|${expStr}`;
  const expectedSig = crypto.createHmac("sha256", secret).update(expectedPayload).digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expectedSig, "hex"))) {
    return { ok: false, error: "Invalid signature or token tampered" };
  }

  // Update lead and contact consent status
  const leadKey = `${tenantId}:${email}`;
  const lead = leadEngine.leads.get(leadKey);
  if (lead) {
    lead.subscribed = false;
    lead.consent_given = false;
    lead.updated_at = new Date().toISOString();
  }

  const contactKey = `${tenantId}:${email}`;
  const contact = leadEngine.contacts.get(contactKey);
  if (contact) {
    contact.consent_given = false;
    contact.updated_at = new Date().toISOString();
  }

  leadEngine.auditLogs.push({
    action: "consent.revoked",
    entityType: "lead",
    entityId: email,
    tenantId,
    details: { method: "one_click_unsubscribe", timestamp: new Date().toISOString() },
  });

  return { ok: true, email, tenantId };
}
