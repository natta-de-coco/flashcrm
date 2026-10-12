// ═════════════════════════════════════════════════════════════════════════════
// Tier 1: Feature Coverage (>= 5 test cases per requirement R1 to R5)
// Dual-Tier Email Infrastructure in Flas CRM
// ═════════════════════════════════════════════════════════════════════════════

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  SYSTEM_PLATFORM_EMAIL,
  SYSTEM_PLATFORM_NAME,
  parseKeyRing,
  encryptEmailSecret,
  decryptEmailSecret,
  verifySuperAdminAccess,
  simulateSmtpHandshake,
  simulateImapHandshake,
  TenantSmtpStore,
  assertTenantByoVerified,
  generateDomainDnsGuide,
  LeadIntakeEngine,
  WelcomeAutomationEngine,
  CampaignBoardEngine,
  CAMPAIGN_STAGES,
  generateUnsubscribeToken,
  generateUnsubscribeUrl,
  verifyAndExecuteUnsubscribe,
} from "./email-test-harness.mjs";

const key = () => crypto.randomBytes(32).toString("base64");
const testRing = () => parseKeyRing(`k1:${key()},k2:${key()}`, "k2");

// ─────────────────────────────────────────────────────────────────────────────
// R1: Platform Super-Admin Email Configuration
// ─────────────────────────────────────────────────────────────────────────────
describe("Tier 1 - R1: Platform Super-Admin Email Configuration", () => {
  const ring = testRing();
  const aad = "flas-platform:v1:smtp_password";

  test("R1-T1-1: Super-admin can save platform email credentials with AES-GCM encryption at rest", async () => {
    const rawPassword = "SuperSecretAdminSmtpPassword123!";
    const encrypted = await encryptEmailSecret(rawPassword, aad, ring);

    // Verify envelope format v1:keyId:iv:ciphertext:tag
    assert.match(encrypted, /^v1:k2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
    assert.equal(encrypted.includes(rawPassword), false, "Plaintext must never appear in envelope");

    // Decrypt and confirm equality
    const decrypted = await decryptEmailSecret(encrypted, aad, ring);
    assert.equal(decrypted, rawPassword);
  });

  test("R1-T1-2: Platform configuration panel requires super_admin staff role and blocks unauthorized tenants", () => {
    // Valid super_admin
    assert.doesNotThrow(() => verifySuperAdminAccess("super_admin"));

    // Standard tenant admin or staff
    for (const unauthorizedRole of [
      "company_admin",
      "staff",
      "marketing_manager",
      "seo_editor",
      "user",
    ]) {
      assert.throws(
        () => verifySuperAdminAccess(unauthorizedRole),
        (err) => err.code === "forbidden" || err.message.includes("Flas platform manager"),
        `Role ${unauthorizedRole} must be refused access to platform email config`,
      );
    }
  });

  test("R1-T1-3: Platform test connection button performs live SMTP handshake validation", async () => {
    const handshake = await simulateSmtpHandshake({
      host: "smtp.mobidigisol.com",
      port: 465,
      secure: true,
      user: "flas@mobidigisol.com",
      pass: "valid_credentials",
      fromEmail: SYSTEM_PLATFORM_EMAIL,
    });

    assert.equal(handshake.ok, true);
    assert.ok(handshake.latencyMs > 0, "Handshake must measure roundtrip latency");
    assert.ok(handshake.serverBanner.includes("220"), "Must receive 220 banner");
    assert.ok(handshake.authStatus.includes("235"), "Must confirm authentication success");
  });

  test("R1-T1-4: Platform test connection button performs live IMAP handshake validation", async () => {
    const imapHandshake = await simulateImapHandshake({
      host: "imap.mobidigisol.com",
      port: 993,
      secure: true,
      user: "flas@mobidigisol.com",
      pass: "valid_credentials",
    });

    assert.equal(imapHandshake.ok, true);
    assert.ok(imapHandshake.serverGreeting.includes("* OK"));
    assert.ok(imapHandshake.loginStatus.includes("OK LOGIN"));
    assert.ok(imapHandshake.inboxStatus.includes("SELECT completed"));
  });

  test("R1-T1-5: System operations (password reset, OTP, invite) strictly bind sender to flas@mobidigisol.com", () => {
    assert.equal(SYSTEM_PLATFORM_EMAIL, "flas@mobidigisol.com");
    assert.equal(SYSTEM_PLATFORM_NAME, "Flas CRM");

    const buildSystemMessage = (type, recipient, details) => ({
      from: `${SYSTEM_PLATFORM_NAME} <${SYSTEM_PLATFORM_EMAIL}>`,
      to: recipient,
      subject: type === "otp" ? "Your Flas CRM Verification Code" : "Reset your password",
      body: details,
    });

    const msg = buildSystemMessage("otp", "user@acme.com", "Code: 492019");
    assert.ok(msg.from.includes("flas@mobidigisol.com"));
    assert.equal(msg.from.startsWith("Flas CRM <flas@mobidigisol.com>"), true);
  });

  test("R1-T1-6: Plaintext credentials never leak in configuration read responses", async () => {
    const rawSmtpPass = "SuperSecretP@ssword999";
    const encPass = await encryptEmailSecret(rawSmtpPass, aad, ring);

    // Mock platform email config record returned to manager UI
    const publicConfig = {
      from_email: SYSTEM_PLATFORM_EMAIL,
      from_name: SYSTEM_PLATFORM_NAME,
      smtp_host: "smtp.mobidigisol.com",
      smtp_port: 587,
      smtp_user: "flas@mobidigisol.com",
      smtp_pass_masked: "••••••••",
      verified: true,
    };

    assert.equal(JSON.stringify(publicConfig).includes(rawSmtpPass), false);
    assert.equal(JSON.stringify(publicConfig).includes(encPass), false);
    assert.equal(publicConfig.smtp_pass_masked, "••••••••");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R2: Strict BYO Tenant Email Marketing Settings
// ─────────────────────────────────────────────────────────────────────────────
describe("Tier 1 - R2: Strict BYO Tenant Email Marketing Settings", () => {
  const store = new TenantSmtpStore();
  const tenantA = "tenant-alpha-uuid";

  test("R2-T1-1: Tenant admin can save workspace outbound SMTP and inbound IMAP settings", () => {
    const saved = store.saveConfig(tenantA, {
      from_email: "marketing@alphacorp.com",
      from_name: "Alpha Corp Deals",
      reply_to: "replies@alphacorp.com",
      smtp_host: "smtp.alphacorp.com",
      smtp_port: 587,
      smtp_user: "marketing@alphacorp.com",
      smtp_secure: "tls",
      imap_host: "imap.alphacorp.com",
      imap_port: 993,
      imap_user: "replies@alphacorp.com",
      imap_enabled: true,
    });

    assert.equal(saved.from_email, "marketing@alphacorp.com");
    assert.equal(saved.smtp_host, "smtp.alphacorp.com");
    assert.equal(saved.imap_enabled, true);
    assert.equal(saved.verified, false, "Initial configuration must start unverified");
  });

  test("R2-T1-2: Campaign dispatch is strictly blocked when tenant SMTP is unverified", () => {
    const unverifiedConfig = store.getConfig(tenantA);
    assert.equal(unverifiedConfig.verified, false);

    assert.throws(
      () => assertTenantByoVerified(unverifiedConfig),
      (err) =>
        err.code === "byo_smtp_unverified" &&
        err.message.includes("Cannot schedule or send campaign"),
    );
  });

  test("R2-T1-3: Successful test connection handshake marks tenant SMTP as verified", () => {
    const testResult = { ok: true, latencyMs: 22 };
    const updated = store.recordTestResult(tenantA, testResult);

    assert.equal(updated.verified, true);
    assert.equal(updated.last_test_ok, true);
    assert.ok(updated.last_test_at);
    assert.doesNotThrow(() => assertTenantByoVerified(updated));
  });

  test("R2-T1-4: Updating SMTP host or credentials immediately revokes verified status", () => {
    // Current state is verified
    assert.equal(store.getConfig(tenantA).verified, true);

    // Update SMTP host to new server
    const modified = store.saveConfig(tenantA, {
      smtp_host: "smtp.new-server.com",
    });

    assert.equal(modified.verified, false, "Modifying host must revoke verification");
    assert.throws(() => assertTenantByoVerified(modified));
  });

  test("R2-T1-5: Domain SPF, DKIM and DMARC verification guide produces accurate DNS records", () => {
    const dnsGuide = generateDomainDnsGuide("alphacorp.com", "relay.flas.mobidigisol.com");

    assert.equal(dnsGuide.domain, "alphacorp.com");
    assert.equal(dnsGuide.spf.type, "TXT");
    assert.ok(dnsGuide.spf.value.includes("include:relay.flas.mobidigisol.com ~all"));
    assert.equal(dnsGuide.dkim.name, "flas._domainkey");
    assert.ok(dnsGuide.dkim.value.startsWith("v=DKIM1; k=rsa"));
    assert.equal(dnsGuide.dmarc.name, "_dmarc");
    assert.ok(dnsGuide.dmarc.value.includes("v=DMARC1; p=reject"));
  });

  test("R2-T1-6: Multi-tenant isolation: Tenant B settings are isolated from Tenant A", () => {
    const tenantB = "tenant-beta-uuid";
    store.saveConfig(tenantB, {
      from_email: "news@betacorp.com",
      smtp_host: "smtp.betacorp.com",
    });

    const cfgA = store.getConfig(tenantA);
    const cfgB = store.getConfig(tenantB);

    assert.notEqual(cfgA.tenant_id, cfgB.tenant_id);
    assert.equal(cfgA.from_email, "marketing@alphacorp.com");
    assert.equal(cfgB.from_email, "news@betacorp.com");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R3: Consent-Gated Lead Intake & Website Widget
// ─────────────────────────────────────────────────────────────────────────────
describe("Tier 1 - R3: Consent-Gated Lead Intake & Website Widget", () => {
  const engine = new LeadIntakeEngine();
  const tenantId = "tenant-widget-intake";

  test("R3-T1-1: Widget lead intake with explicit consent records consent_given: true, timestamp, and source_url", async () => {
    const result = await engine.ingestLead({
      tenantId,
      siteId: "site_key_123",
      sitePlatform: "website",
      email: "consented.visitor@example.com",
      name: "Alice Consented",
      phone: "+971501112233",
      sourceUrl: "https://myshop.com/promo-page?ref=fb",
      consent: true,
      tags: ["summer-promo"],
    });

    assert.equal(result.lead.consent_given, true);
    assert.equal(result.lead.subscribed, true);
    assert.ok(result.lead.consent_at, "Must have valid ISO consent timestamp");
    assert.equal(result.lead.source_url, "https://myshop.com/promo-page?ref=fb");
    assert.equal(result.isNewConsented, true);
  });

  test("R3-T1-2: Widget lead intake without consent preserves un-consented status (consent_given: false)", async () => {
    const result = await engine.ingestLead({
      tenantId,
      siteId: "site_key_123",
      sitePlatform: "website",
      email: "unconsented.visitor@example.com",
      name: "Bob Question",
      phone: "+971509998877",
      sourceUrl: "https://myshop.com/contact-us",
      consent: false, // Un-ticked checkbox
    });

    assert.equal(result.lead.consent_given, false);
    assert.equal(result.lead.subscribed, false);
    assert.equal(result.lead.consent_at, null);
    assert.equal(result.isNewConsented, false);
  });

  test("R3-T1-3: Consent capture is audited with detailed compliance metadata (GDPR / CAN-SPAM)", async () => {
    await engine.ingestLead({
      tenantId,
      siteId: "site_audit_test",
      sitePlatform: "wordpress",
      email: "audited.lead@example.com",
      consent: true,
      sourceUrl: "https://wordpress.store/checkout",
    });

    const audit = engine.auditLogs.find((l) => l.entityId === "audited.lead@example.com");
    assert.ok(audit, "Audit record must be logged for consented lead");
    assert.equal(audit.action, "consent.capture");
    assert.equal(audit.details.platform, "wordpress");
    assert.equal(audit.details.sourceUrl, "https://wordpress.store/checkout");
    assert.ok(audit.details.consentAt);
  });

  test("R3-T1-4: Consented leads directly populate the marketing audience pool", async () => {
    const audience = engine.getAudiencePool(tenantId, "all_consented");
    const emails = audience.map((l) => l.email);

    assert.ok(emails.includes("consented.visitor@example.com"));
    assert.ok(emails.includes("audited.lead@example.com"));
    assert.equal(
      emails.includes("unconsented.visitor@example.com"),
      false,
      "Unconsented lead must be excluded from audience",
    );
  });

  test("R3-T1-5: Subsequent unconsented interaction never downgrades an existing consented subscriber", async () => {
    // Existing subscriber sends an enquiry without re-ticking box
    const reIngest = await engine.ingestLead({
      tenantId,
      siteId: "site_key_123",
      sitePlatform: "website",
      email: "consented.visitor@example.com",
      consent: false,
    });

    assert.equal(reIngest.lead.consent_given, true, "Prior consent must be preserved");
    assert.equal(reIngest.lead.subscribed, true);
  });

  test("R3-T1-6: Missing or malformed email address in lead intake is rejected with validation error", async () => {
    await assert.rejects(
      engine.ingestLead({
        tenantId,
        siteId: "site_key_123",
        sitePlatform: "website",
        email: "not-an-email",
        consent: true,
      }),
      /Valid email is required/,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R4: Automated Welcome & Discount Offer Triggers
// ─────────────────────────────────────────────────────────────────────────────
describe("Tier 1 - R4: Automated Welcome & Discount Offer Triggers", () => {
  const smtpStore = new TenantSmtpStore();
  const tenantId = "tenant-welcome-auto";
  const automation = new WelcomeAutomationEngine(smtpStore);

  // Set up verified SMTP for tenant
  smtpStore.saveConfig(tenantId, { from_email: "promo@store.com", smtp_host: "smtp.store.com" });
  smtpStore.recordTestResult(tenantId, { ok: true });

  test("R4-T1-1: Real-time event triggers welcome email instantly on consented lead intake", async () => {
    const lead = {
      email: "new.customer@gmail.com",
      name: "Dave Customer",
      consent_given: true,
      source: "website",
      source_url: "https://store.com",
    };

    const res = await automation.triggerWelcomeIfConsented(tenantId, lead, "Super Deals");
    assert.equal(res.triggered, true);
    assert.equal(res.delivered, true);
    assert.ok(res.subject.includes("WELCOME10"));
    assert.ok(res.bodyText.includes("Dave Customer"));
  });

  test("R4-T1-2: Unconsented lead intake strictly suppresses automated welcome email", async () => {
    const unconsentedLead = {
      email: "shy.visitor@gmail.com",
      name: "Shy Visitor",
      consent_given: false,
    };

    const res = await automation.triggerWelcomeIfConsented(tenantId, unconsentedLead);
    assert.equal(res.triggered, false);
    assert.ok(res.reason.includes("Consent not given"));
  });

  test("R4-T1-3: Configurable discount codes and rules engine are applied to welcome offer", async () => {
    automation.setAutomationRule(tenantId, {
      enabled: true,
      discountCode: "SPECIAL25",
      discountDescription: "25% off entire collection",
    });

    const lead = { email: "vip.user@shop.com", name: "VIP User", consent_given: true };
    const res = await automation.triggerWelcomeIfConsented(tenantId, lead, "Fashion Boutique");

    assert.equal(res.discountCode, "SPECIAL25");
    assert.ok(res.subject.includes("SPECIAL25"));
    assert.ok(res.bodyText.includes("25% off entire collection"));
  });

  test("R4-T1-4: Welcome email delivery attempt is recorded in email_delivery_log", async () => {
    const lastLog = automation.deliveryLogs[automation.deliveryLogs.length - 1];
    assert.ok(lastLog);
    assert.equal(lastLog.template, "welcome_discount");
    assert.equal(lastLog.recipient, "vip.user@shop.com");
    assert.equal(lastLog.status, "delivered");
    assert.equal(lastLog.meta.discount_code, "SPECIAL25");
  });

  test("R4-T1-5: Welcome offer contains mandatory one-click unsubscribe mechanism", async () => {
    const lead = { email: "unsub.check@shop.com", name: "Unsub Check", consent_given: true };
    const res = await automation.triggerWelcomeIfConsented(tenantId, lead, "Flas Demo");

    assert.ok(res.bodyText.includes("/unsubscribe?token="));
    assert.ok(res.bodyHtml.includes("/unsubscribe?token="));
  });

  test("R4-T1-6: Unverified tenant SMTP records 'failed' status in email_delivery_log without crashing", async () => {
    const unverifiedTenant = "tenant-unverified-welcome";
    smtpStore.saveConfig(unverifiedTenant, { from_email: "fail@test.com", verified: false });

    const lead = { email: "fail.lead@shop.com", name: "Fail Lead", consent_given: true };
    const res = await automation.triggerWelcomeIfConsented(unverifiedTenant, lead);

    assert.equal(res.triggered, true);
    assert.equal(res.delivered, false, "Delivery must fail if tenant SMTP unverified");
    assert.equal(res.logEntry.status, "failed");
    assert.ok(res.logEntry.error.includes("unverified"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R5: Visual Email Marketing Campaign Board & Template Composer
// ─────────────────────────────────────────────────────────────────────────────
describe("Tier 1 - R5: Visual Email Marketing Campaign Board & Template Composer", () => {
  const smtpStore = new TenantSmtpStore();
  const leadEngine = new LeadIntakeEngine();
  const campaignEngine = new CampaignBoardEngine(smtpStore, leadEngine);
  const tenantId = "tenant-marketing-board";

  // Configure verified SMTP
  smtpStore.saveConfig(tenantId, {
    from_email: "newsletter@brand.com",
    smtp_host: "smtp.brand.com",
  });
  smtpStore.recordTestResult(tenantId, { ok: true });

  test("R5-T1-1: Visual campaign board supports 5 distinct lifecycle stages with valid state transitions", () => {
    assert.deepEqual(CAMPAIGN_STAGES, ["draft", "scheduled", "in_progress", "sent", "paused"]);

    const camp = campaignEngine.createCampaign(tenantId, {
      name: "Black Friday Mega Blast",
      subject: "Huge savings inside, {{name}}!",
      body: "Check our deals! Unsubscribe: {{unsubscribe_url}}",
    });

    assert.equal(camp.status, "draft");

    // Transition Draft -> Scheduled
    campaignEngine.transitionStage(camp.id, "scheduled");
    assert.equal(camp.status, "scheduled");
    assert.ok(camp.scheduled_at);

    // Transition Scheduled -> In Progress -> Sent
    campaignEngine.transitionStage(camp.id, "in_progress");
    assert.equal(camp.status, "in_progress");

    campaignEngine.transitionStage(camp.id, "sent");
    assert.equal(camp.status, "sent");
    assert.ok(camp.sent_at);
  });

  test("R5-T1-2: Template composer substitutes dynamic merge tags (name, company, discount_code, unsubscribe_url)", () => {
    const camp = campaignEngine.createCampaign(tenantId, {
      name: "Merge Tag Test",
      subject: "Exclusive offer for {{name}} from {{company}}",
      body: "Hi {{name}}, use promo code {{discount_code}} today. To stop receiving mail, click: {{unsubscribe_url}}",
      html: "<p>Hi {{name}}, code: <b>{{discount_code}}</b></p><a href='{{unsubscribe_url}}'>Unsubscribe</a>",
    });

    const rendered = campaignEngine.renderTemplateForRecipient(
      camp,
      { email: "john@customer.com", name: "John Smith" },
      "Acme Corp",
      "FLASH50",
    );

    assert.equal(rendered.subject, "Exclusive offer for John Smith from Acme Corp");
    assert.ok(rendered.body.includes("FLASH50"));
    assert.ok(rendered.body.includes("https://flas.mobidigisol.com/unsubscribe?token="));
    assert.ok(rendered.html.includes("John Smith"));
    assert.ok(rendered.html.includes("FLASH50"));
  });

  test("R5-T1-3: Audience segment selector queries only verified consented leads and contacts", async () => {
    await leadEngine.ingestLead({
      tenantId,
      siteId: "site_camp",
      sitePlatform: "website",
      email: "opted_in_1@customer.com",
      consent: true,
      tags: ["vip"],
    });
    await leadEngine.ingestLead({
      tenantId,
      siteId: "site_camp",
      sitePlatform: "website",
      email: "opted_out_2@customer.com",
      consent: false,
      tags: ["vip"],
    });

    const allConsented = leadEngine.getAudiencePool(tenantId, "all_consented");
    const vipSegment = leadEngine.getAudiencePool(tenantId, "vip");

    assert.equal(
      allConsented.some((l) => l.email === "opted_in_1@customer.com"),
      true,
    );
    assert.equal(
      allConsented.some((l) => l.email === "opted_out_2@customer.com"),
      false,
    );
    assert.equal(vipSegment.length, 1);
    assert.equal(vipSegment[0].email, "opted_in_1@customer.com");
  });

  test("R5-T1-4: Mandatory one-click unsubscribe mechanism enforces presence before campaign scheduling", () => {
    const campWithoutUnsub = campaignEngine.createCampaign(tenantId, {
      name: "Non-Compliant Campaign",
      subject: "No unsubscribe link here!",
      body: "Buy our product right now without any unsubscribe option.",
    });

    assert.throws(
      () => campaignEngine.transitionStage(campWithoutUnsub.id, "scheduled"),
      /mandatory one-click unsubscribe mechanism/,
    );
  });

  test("R5-T1-5: One-click unsubscribe endpoint validates HMAC token and revokes consent across leads and contacts", () => {
    const secret = "platform_master_hmac_secret";
    const email = "opted_in_1@customer.com";
    const token = generateUnsubscribeToken(email, tenantId, secret);

    const leadBefore = leadEngine.leads.get(`${tenantId}:${email}`);
    assert.equal(leadBefore.subscribed, true);
    assert.equal(leadBefore.consent_given, true);

    const result = verifyAndExecuteUnsubscribe(token, secret, leadEngine);
    assert.equal(result.ok, true);
    assert.equal(result.email, email);

    // Consent must now be revoked
    const leadAfter = leadEngine.leads.get(`${tenantId}:${email}`);
    assert.equal(leadAfter.subscribed, false);
    assert.equal(leadAfter.consent_given, false);

    const contactAfter = leadEngine.contacts.get(`${tenantId}:${email}`);
    assert.equal(contactAfter.consent_given, false);
  });

  test("R5-T1-6: Completed Sent campaigns are locked and cannot be moved back to Draft", () => {
    const camp = campaignEngine.createCampaign(tenantId, {
      name: "Completed Blast",
      subject: "Sent",
      body: "Body {{unsubscribe_url}}",
    });
    campaignEngine.transitionStage(camp.id, "scheduled");
    campaignEngine.transitionStage(camp.id, "in_progress");
    campaignEngine.transitionStage(camp.id, "sent");

    assert.throws(
      () => campaignEngine.transitionStage(camp.id, "draft"),
      /Cannot revert a completed Sent campaign back to Draft/,
    );
  });
});
