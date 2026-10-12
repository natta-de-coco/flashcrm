// ═════════════════════════════════════════════════════════════════════════════
// Tier 4: Real-World Application Scenarios (End-to-End User Workflows)
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
  generateUnsubscribeToken,
  generateUnsubscribeUrl,
  verifyAndExecuteUnsubscribe,
} from "./email-test-harness.mjs";

const key = () => crypto.randomBytes(32).toString("base64");
const testRing = () => parseKeyRing(`k1:${key()},k2:${key()}`, "k2");

describe("Tier 4 - Real-World Application Scenarios", () => {
  const ring = testRing();
  const secret = "platform_master_scenario_secret";

  test("Scenario 1: Super-Admin Platform Setup & System Transactional Email Dispatch", async () => {
    // 1. Super-admin authenticates and accesses platform email configuration panel
    const userRole = "super_admin";
    assert.doesNotThrow(() => verifySuperAdminAccess(userRole));

    // 2. Configure platform SMTP & IMAP credentials
    const platformPassword = "PlatformSmtpPassword2026!";
    const aad = "flas-platform:v1:smtp_password";
    const encryptedPassword = await encryptEmailSecret(platformPassword, aad, ring);
    assert.ok(encryptedPassword.startsWith("v1:"));

    // 3. Super-admin executes "Test Connection" handshake button
    const smtpTest = await simulateSmtpHandshake({
      host: "smtp.mobidigisol.com",
      port: 465,
      secure: true,
      user: SYSTEM_PLATFORM_EMAIL,
      pass: platformPassword,
      fromEmail: SYSTEM_PLATFORM_EMAIL,
    });
    assert.equal(smtpTest.ok, true);
    assert.ok(smtpTest.latencyMs < 500);

    const imapTest = await simulateImapHandshake({
      host: "imap.mobidigisol.com",
      port: 993,
      secure: true,
      user: SYSTEM_PLATFORM_EMAIL,
      pass: platformPassword,
    });
    assert.equal(imapTest.ok, true);

    // 4. System transactional email (Password Reset OTP) is dispatched from flas@mobidigisol.com
    const recipient = "manager@tenantcompany.com";
    const otpCode = "839201";
    const platformEmailPayload = {
      from: `${SYSTEM_PLATFORM_NAME} <${SYSTEM_PLATFORM_EMAIL}>`,
      to: recipient,
      subject: "Flas CRM — Security Verification Code",
      text: `Your verification code is ${otpCode}. Valid for 10 minutes.`,
    };

    assert.equal(platformEmailPayload.from, "Flas CRM <flas@mobidigisol.com>");
    assert.ok(platformEmailPayload.text.includes(otpCode));
  });

  test("Scenario 2: Tenant Workspace Onboarding, BYO SMTP Configuration & DNS Verification", () => {
    const smtpStore = new TenantSmtpStore();
    const tenantId = "tenant-scenario-onboarding";

    // 1. Workspace admin navigates to /settings -> Email Marketing Setup card
    const initialConfig = smtpStore.getConfig(tenantId);
    assert.equal(initialConfig.verified, false);

    // 2. Admin enters outbound SMTP credentials and sender identity
    const domain = "northlinetrading.com";
    smtpStore.saveConfig(tenantId, {
      from_email: `deals@${domain}`,
      from_name: "Northline Deals",
      reply_to: `support@${domain}`,
      smtp_host: `smtp.${domain}`,
      smtp_port: 587,
      smtp_user: `deals@${domain}`,
      smtp_secure: "tls",
    });

    // 3. System renders SPF / DKIM DNS verification guide
    const dnsGuide = generateDomainDnsGuide(domain);
    assert.equal(dnsGuide.domain, domain);
    assert.ok(dnsGuide.spf.value.includes("include:relay.flas.mobidigisol.com"));
    assert.equal(dnsGuide.dkim.name, "flas._domainkey");

    // 4. Admin clicks "Test Connection"
    const testResult = { ok: true, latencyMs: 34 };
    const verifiedConfig = smtpStore.recordTestResult(tenantId, testResult);

    assert.equal(verifiedConfig.verified, true);
    assert.equal(verifiedConfig.last_test_ok, true);
    assert.doesNotThrow(() => assertTenantByoVerified(verifiedConfig));
  });

  test("Scenario 3: Website Visitor Full Funnel: Widget Chat -> Consented Intake -> Instant Welcome Discount", async () => {
    const smtpStore = new TenantSmtpStore();
    const leadEngine = new LeadIntakeEngine();
    const automation = new WelcomeAutomationEngine(smtpStore);
    const tenantId = "tenant-scenario-funnel";

    // Setup verified tenant SMTP
    smtpStore.saveConfig(tenantId, { from_email: "hello@store.com", smtp_host: "smtp.store.com" });
    smtpStore.recordTestResult(tenantId, { ok: true });

    // 1. Visitor visits site and opens widget.js
    const visitorPayload = {
      tenantId,
      siteId: "site_prod_999",
      sitePlatform: "website",
      email: "emma.watson@gmail.com",
      name: "Emma Watson",
      phone: "+971501234567",
      sourceUrl: "https://store.com/landing?campaign=autumn",
      consent: true, // Explicit un-ticked checkbox ticked by user
      tags: ["autumn-collection"],
    };

    // 2. Intake endpoint processes visitor
    const { lead, isNewConsented } = await leadEngine.ingestLead(visitorPayload);
    assert.equal(lead.consent_given, true);
    assert.equal(lead.subscribed, true);
    assert.equal(lead.source_url, visitorPayload.sourceUrl);
    assert.equal(isNewConsented, true);

    // 3. Real-time event triggers welcome discount email
    const autoResult = await automation.triggerWelcomeIfConsented(tenantId, lead, "Trendy Wear");
    assert.equal(autoResult.triggered, true);
    assert.equal(autoResult.delivered, true);
    assert.equal(autoResult.discountCode, "WELCOME10");
    assert.ok(autoResult.bodyText.includes("Emma Watson"));
    assert.ok(autoResult.bodyText.includes("Trendy Wear"));
    assert.ok(autoResult.bodyText.includes("/unsubscribe?token="));

    // 4. Audit & delivery logging confirmed
    assert.equal(autoResult.logEntry.template, "welcome_discount");
    assert.equal(autoResult.logEntry.status, "delivered");
    assert.equal(autoResult.logEntry.recipient, "emma.watson@gmail.com");

    // 5. Lead is immediately indexed in marketing audience pool
    const pool = leadEngine.getAudiencePool(tenantId, "all_consented");
    assert.equal(
      pool.some((l) => l.email === "emma.watson@gmail.com"),
      true,
    );
  });

  test("Scenario 4: Privacy-Conscious Visitor: Widget Chat -> No Consent -> No Marketing Emails", async () => {
    const smtpStore = new TenantSmtpStore();
    const leadEngine = new LeadIntakeEngine();
    const automation = new WelcomeAutomationEngine(smtpStore);
    const tenantId = "tenant-scenario-privacy";

    smtpStore.saveConfig(tenantId, { from_email: "support@gadgets.com" });
    smtpStore.recordTestResult(tenantId, { ok: true });

    // Visitor asks a technical question without opting into marketing
    const visitorPayload = {
      tenantId,
      siteId: "site_prod_888",
      sitePlatform: "website",
      email: "private.buyer@protonmail.com",
      name: "Private Buyer",
      phone: "+971509876543",
      sourceUrl: "https://gadgets.com/product/laptop",
      consent: false, // Box left UN-TICKED
      tags: ["tech-support"],
    };

    // 1. Ingestion succeeds for CRM support record
    const { lead } = await leadEngine.ingestLead(visitorPayload);
    assert.equal(lead.consent_given, false);
    assert.equal(lead.subscribed, false);
    assert.equal(lead.consent_at, null);

    // 2. Automation engine evaluates lead and strictly withholds welcome email
    const autoResult = await automation.triggerWelcomeIfConsented(tenantId, lead, "Gadget World");
    assert.equal(autoResult.triggered, false);
    assert.ok(autoResult.reason.includes("Consent not given"));

    // 3. Verify ZERO welcome emails logged for this recipient
    const logs = automation.deliveryLogs.filter(
      (l) => l.recipient === "private.buyer@protonmail.com",
    );
    assert.equal(logs.length, 0);

    // 4. Verify excluded from marketing audience
    const pool = leadEngine.getAudiencePool(tenantId, "all_consented");
    assert.equal(
      pool.some((l) => l.email === "private.buyer@protonmail.com"),
      false,
    );
  });

  test("Scenario 5: Marketing Manager Campaign Creation: Segment Selection -> Merge Tag Composition -> Scheduling & Dispatch", async () => {
    const smtpStore = new TenantSmtpStore();
    const leadEngine = new LeadIntakeEngine();
    const campaignEngine = new CampaignBoardEngine(smtpStore, leadEngine);
    const tenantId = "tenant-scenario-campaign";

    // Verified tenant SMTP
    smtpStore.saveConfig(tenantId, {
      from_email: "newsletter@brand.com",
      smtp_host: "smtp.brand.com",
    });
    smtpStore.recordTestResult(tenantId, { ok: true });

    // Seed 3 consented audience leads
    for (let i = 1; i <= 3; i++) {
      await leadEngine.ingestLead({
        tenantId,
        sitePlatform: "website",
        email: `subscriber${i}@brand.com`,
        name: `Subscriber ${i}`,
        consent: true,
      });
    }

    // 1. Marketer creates campaign in Draft
    const camp = campaignEngine.createCampaign(tenantId, {
      name: "Holiday Super Sale",
      subject: "Exclusive Holiday Discount for {{name}}",
      body: "Hi {{name}},\n\nEnjoy {{discount_code}} off at {{company}}!\n\nUnsubscribe: {{unsubscribe_url}}",
      html: "<p>Hi {{name}},</p><p>Use code: {{discount_code}}</p><a href='{{unsubscribe_url}}'>Unsubscribe</a>",
      audienceTag: "all_consented",
    });
    assert.equal(camp.status, "draft");

    // 2. Select audience segment and count recipients
    const recipients = leadEngine.getAudiencePool(tenantId, camp.audience_tag);
    assert.equal(recipients.length, 3);
    camp.recipients_count = recipients.length;

    // 3. Schedule campaign -> transitions to 'scheduled'
    campaignEngine.transitionStage(camp.id, "scheduled");
    assert.equal(camp.status, "scheduled");

    // 4. Dispatch campaign -> transitions to 'in_progress' -> 'sent'
    campaignEngine.transitionStage(camp.id, "in_progress");
    assert.equal(camp.status, "in_progress");

    // Render individual email for each recipient
    const renderedEmails = recipients.map((r) =>
      campaignEngine.renderTemplateForRecipient(camp, r, "Brand Co", "HOLIDAY50"),
    );

    assert.equal(renderedEmails.length, 3);
    assert.ok(renderedEmails[0].subject.includes("Subscriber 1"));
    assert.ok(renderedEmails[1].body.includes("HOLIDAY50"));
    assert.ok(renderedEmails[2].body.includes("Brand Co"));
    assert.ok(renderedEmails[0].body.includes("/unsubscribe?token="));

    campaignEngine.transitionStage(camp.id, "sent");
    assert.equal(camp.status, "sent");
    assert.ok(camp.sent_at);
  });

  test("Scenario 6: Lead Consent Revocation via One-Click Unsubscribe & Complete Suppression Across Subsequent Campaigns", async () => {
    const smtpStore = new TenantSmtpStore();
    const leadEngine = new LeadIntakeEngine();
    const campaignEngine = new CampaignBoardEngine(smtpStore, leadEngine);
    const tenantId = "tenant-scenario-unsub";

    smtpStore.saveConfig(tenantId, { from_email: "promos@store.com" });
    smtpStore.recordTestResult(tenantId, { ok: true });

    // 1. Lead signs up
    const email = "churned.user@consumer.com";
    await leadEngine.ingestLead({
      tenantId,
      sitePlatform: "website",
      email,
      name: "Churned User",
      consent: true,
    });
    assert.equal(leadEngine.getAudiencePool(tenantId, "all_consented").length, 1);

    // 2. User clicks unsubscribe link in email
    const unsubUrl = generateUnsubscribeUrl(email, tenantId, secret);
    const urlObj = new URL(unsubUrl);
    const token = urlObj.searchParams.get("token");

    // 3. Public /unsubscribe endpoint processes request
    const execution = verifyAndExecuteUnsubscribe(token, secret, leadEngine);
    assert.equal(execution.ok, true);
    assert.equal(execution.email, email);

    // 4. Lead record reflects revocation
    const lead = leadEngine.leads.get(`${tenantId}:${email}`);
    assert.equal(lead.subscribed, false);
    assert.equal(lead.consent_given, false);

    // Audit log records consent.revoked
    const auditRevoke = leadEngine.auditLogs.find(
      (l) => l.action === "consent.revoked" && l.entityId === email,
    );
    assert.ok(auditRevoke);

    // 5. Subsequent campaign created: recipient is NOT in audience
    const audienceNext = leadEngine.getAudiencePool(tenantId, "all_consented");
    assert.equal(audienceNext.length, 0);
  });

  test("Scenario 7: Adversarial Penetration Test: Direct API bypass attempt to schedule campaign without verified SMTP & cross-tenant token tampering", async () => {
    const smtpStore = new TenantSmtpStore();
    const leadEngine = new LeadIntakeEngine();
    const campaignEngine = new CampaignBoardEngine(smtpStore, leadEngine);
    const attackerTenant = "tenant-attacker";
    const victimTenant = "tenant-victim";

    // 1. Attacker tries to bypass UI and call transitionStage directly without verified SMTP
    smtpStore.saveConfig(attackerTenant, { from_email: "spammer@evil.com", verified: false });
    const spamCamp = campaignEngine.createCampaign(attackerTenant, {
      name: "Spam Campaign",
      subject: "Buy Now",
      body: "Spam message {{unsubscribe_url}}",
    });

    assert.throws(
      () => campaignEngine.transitionStage(spamCamp.id, "scheduled"),
      (err) => err.code === "byo_smtp_unverified",
      "System must block API bypass attempt to schedule campaign without verified SMTP",
    );

    // 2. Attacker forges an unsubscribe token for victim tenant lead
    await leadEngine.ingestLead({
      tenantId: victimTenant,
      sitePlatform: "website",
      email: "victim@company.com",
      consent: true,
    });

    // Attacker signs with different key
    const forgedToken = generateUnsubscribeToken(
      "victim@company.com",
      victimTenant,
      "wrong_attacker_secret",
    );
    const attackResult = verifyAndExecuteUnsubscribe(forgedToken, secret, leadEngine);

    assert.equal(attackResult.ok, false);
    assert.ok(attackResult.error.includes("Invalid signature"));

    // Victim lead remains untouched
    const victimLead = leadEngine.leads.get(`${victimTenant}:victim@company.com`);
    assert.equal(victimLead.subscribed, true);
    assert.equal(victimLead.consent_given, true);
  });
});
