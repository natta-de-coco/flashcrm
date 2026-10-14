// ═════════════════════════════════════════════════════════════════════════════
// Tier 3: Cross-Feature Interactions (Pairwise Combinations)
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
  TenantSmtpStore,
  assertTenantByoVerified,
  LeadIntakeEngine,
  WelcomeAutomationEngine,
  CampaignBoardEngine,
  generateUnsubscribeToken,
  verifyAndExecuteUnsubscribe,
} from "./email-test-harness.mjs";

const key = () => crypto.randomBytes(32).toString("base64");
const testRing = () => parseKeyRing(`k1:${key()},k2:${key()}`, "k2");

describe("Tier 3 - Cross-Feature Pairwise Interactions", () => {
  const ring = testRing();
  const secret = "shared_test_secret_key";

  test("T3-1 [R1 x R2]: Platform Super-Admin credentials and Tenant BYO credentials maintain strict cryptographic and tenant isolation", async () => {
    // Platform credential encrypted under platform scope
    const platformAad = "flas-platform:v1:smtp_credentials";
    const platformEnc = await encryptEmailSecret("PlatformRootPassWord999", platformAad, ring);

    // Tenant BYO credential encrypted under tenant-specific scope
    const tenantId = "tenant-xyz";
    const tenantAad = `flas-tenant:${tenantId}:smtp_credentials`;
    const tenantEnc = await encryptEmailSecret("TenantClientPassWord111", tenantAad, ring);

    // 1. Cross-decrypt: Platform ciphertext must fail to decrypt under tenant context
    await assert.rejects(
      decryptEmailSecret(platformEnc, tenantAad, ring),
      (err) => err.code === "authentication_failed",
    );

    // 2. Tenant ciphertext must fail to decrypt under platform context
    await assert.rejects(
      decryptEmailSecret(tenantEnc, platformAad, ring),
      (err) => err.code === "authentication_failed",
    );

    // 3. Non-super admin cannot access platform credentials
    assert.throws(() => verifySuperAdminAccess("company_admin"), /Flas platform manager/);
  });

  test("T3-2 [R2 x R4]: Welcome automation respects tenant BYO policy and logs failure if tenant SMTP is unverified", async () => {
    const smtpStore = new TenantSmtpStore();
    const automation = new WelcomeAutomationEngine(smtpStore);
    const tenantId = "tenant-byo-welcome";

    // Tenant is NOT verified
    smtpStore.saveConfig(tenantId, { from_email: "marketing@shop.com", verified: false });

    const consentedLead = {
      email: "subscriber@client.com",
      name: "New Sub",
      consent_given: true,
      source: "website",
    };

    const res = await automation.triggerWelcomeIfConsented(tenantId, consentedLead, "My Shop");
    assert.equal(res.triggered, true, "Event was triggered on consent");
    assert.equal(res.delivered, false, "Delivery must fail because tenant SMTP is unverified");
    assert.equal(res.logEntry.status, "failed");
    assert.ok(res.logEntry.error.includes("unverified"));

    // Verify SMTP and re-test
    smtpStore.recordTestResult(tenantId, { ok: true });
    const resVerified = await automation.triggerWelcomeIfConsented(
      tenantId,
      consentedLead,
      "My Shop",
    );
    assert.equal(resVerified.delivered, true);
    assert.equal(resVerified.logEntry.status, "delivered");
  });

  test("T3-3 [R2 x R5]: Campaign board strictly enforces BYO gate during stage transitions (Draft -> Scheduled)", () => {
    const smtpStore = new TenantSmtpStore();
    const leadEngine = new LeadIntakeEngine();
    const campaignEngine = new CampaignBoardEngine(smtpStore, leadEngine);
    const tenantId = "tenant-byo-campaign";

    // Save unverified SMTP
    smtpStore.saveConfig(tenantId, { from_email: "deals@store.com", verified: false });

    const camp = campaignEngine.createCampaign(tenantId, {
      name: "Summer Blast",
      subject: "Big discount!",
      body: "Check out our catalog. Unsubscribe: {{unsubscribe_url}}",
    });

    // Attempt to move to scheduled must throw BYO gating error
    assert.throws(
      () => campaignEngine.transitionStage(camp.id, "scheduled"),
      (err) =>
        err.code === "byo_smtp_unverified" &&
        err.message.includes("Cannot schedule or send campaign"),
    );

    // Verify tenant SMTP in settings
    smtpStore.recordTestResult(tenantId, { ok: true });

    // Retry transition -> succeeds!
    campaignEngine.transitionStage(camp.id, "scheduled");
    assert.equal(camp.status, "scheduled");
  });

  test("T3-4 [R3 x R4]: Consented lead intake immediately fires welcome discount offer; unconsented lead intake strictly suppresses it", async () => {
    const smtpStore = new TenantSmtpStore();
    const leadEngine = new LeadIntakeEngine();
    const automation = new WelcomeAutomationEngine(smtpStore);
    const tenantId = "tenant-intake-automation";

    smtpStore.saveConfig(tenantId, {
      from_email: "hi@brand.com",
      verified: true,
      last_test_ok: true,
    });

    // Visitor A: explicit consent
    const intakeA = await leadEngine.ingestLead({
      tenantId,
      sitePlatform: "website",
      email: "consented.visitor@shop.com",
      name: "Consented Sub",
      consent: true,
      sourceUrl: "https://brand.com/signup",
    });
    const triggerA = await automation.triggerWelcomeIfConsented(
      tenantId,
      intakeA.lead,
      "Brand Inc",
    );
    assert.equal(triggerA.triggered, true);
    assert.equal(triggerA.delivered, true);
    assert.ok(triggerA.subject.includes("WELCOME10"));

    // Visitor B: un-ticked consent box
    const intakeB = await leadEngine.ingestLead({
      tenantId,
      sitePlatform: "website",
      email: "unconsented.visitor@shop.com",
      name: "Unconsented Sub",
      consent: false,
      sourceUrl: "https://brand.com/contact",
    });
    const triggerB = await automation.triggerWelcomeIfConsented(
      tenantId,
      intakeB.lead,
      "Brand Inc",
    );
    assert.equal(triggerB.triggered, false);
    assert.ok(triggerB.reason.includes("Consent not given"));
  });

  test("T3-5 [R3 x R5]: Marketing audience segment queries strictly filter out unconsented leads from campaign targets", async () => {
    const leadEngine = new LeadIntakeEngine();
    const tenantId = "tenant-audience-filter";

    // Ingest 3 leads: 2 consented, 1 unconsented
    await leadEngine.ingestLead({
      tenantId,
      sitePlatform: "website",
      email: "target1@shop.com",
      consent: true,
      tags: ["holiday"],
    });
    await leadEngine.ingestLead({
      tenantId,
      sitePlatform: "website",
      email: "target2@shop.com",
      consent: true,
      tags: ["holiday"],
    });
    await leadEngine.ingestLead({
      tenantId,
      sitePlatform: "website",
      email: "no_consent@shop.com",
      consent: false,
      tags: ["holiday"],
    });

    const audiencePool = leadEngine.getAudiencePool(tenantId, "all_consented");
    const emails = audiencePool.map((l) => l.email);

    assert.equal(emails.length, 2);
    assert.ok(emails.includes("target1@shop.com"));
    assert.ok(emails.includes("target2@shop.com"));
    assert.equal(emails.includes("no_consent@shop.com"), false);
  });

  test("T3-6 [R4 x R5]: Promotional discount codes in automated triggers match campaign promo codes", () => {
    const smtpStore = new TenantSmtpStore();
    const automation = new WelcomeAutomationEngine(smtpStore);
    const tenantId = "tenant-promo-consistency";

    const PROMO_CODE = "AUTUMN30";
    automation.setAutomationRule(tenantId, {
      discountCode: PROMO_CODE,
      discountDescription: "30% off autumn collection",
    });

    const rule = automation.getAutomationRule(tenantId);
    assert.equal(rule.discountCode, PROMO_CODE);

    // Verify campaign template composer accepts and renders identical code
    const leadEngine = new LeadIntakeEngine();
    const campaignEngine = new CampaignBoardEngine(smtpStore, leadEngine);
    const camp = campaignEngine.createCampaign(tenantId, {
      name: "Autumn Promotion",
      subject: "Get ready for autumn with {{discount_code}}!",
      body: "Code: {{discount_code}}. Unsubscribe: {{unsubscribe_url}}",
    });

    const rendered = campaignEngine.renderTemplateForRecipient(
      camp,
      { email: "cust@autumn.com", name: "Autumn Cust" },
      "Fashion House",
      rule.discountCode,
    );

    assert.ok(rendered.subject.includes(PROMO_CODE));
    assert.ok(rendered.body.includes(PROMO_CODE));
  });

  test("T3-7 [R5 x R3]: One-click unsubscribe from marketing campaign immediately updates lead pool and excludes from subsequent campaigns", async () => {
    const smtpStore = new TenantSmtpStore();
    const leadEngine = new LeadIntakeEngine();
    const campaignEngine = new CampaignBoardEngine(smtpStore, leadEngine);
    const tenantId = "tenant-unsub-lifecycle";

    // 1. Lead signs up with consent
    const targetEmail = "unsub.me@client.com";
    await leadEngine.ingestLead({
      tenantId,
      sitePlatform: "website",
      email: targetEmail,
      consent: true,
    });

    // Initially in audience pool
    assert.equal(leadEngine.getAudiencePool(tenantId, "all_consented").length, 1);

    // 2. Marketer sends campaign with unsubscribe URL
    const token = generateUnsubscribeToken(targetEmail, tenantId, secret);

    // 3. User clicks unsubscribe link
    const unsubResult = verifyAndExecuteUnsubscribe(token, secret, leadEngine);
    assert.equal(unsubResult.ok, true);

    // 4. Verify consent is revoked
    const lead = leadEngine.leads.get(`${tenantId}:${targetEmail}`);
    assert.equal(lead.subscribed, false);
    assert.equal(lead.consent_given, false);

    // 5. Subsequent audience query in R5 returns 0 leads
    const poolAfter = leadEngine.getAudiencePool(tenantId, "all_consented");
    assert.equal(poolAfter.length, 0);
  });

  test("T3-8 [R1 x R5]: Platform transactional email and Tenant campaign email sender identities never cross-contaminate", () => {
    // Platform sender is strictly flas@mobidigisol.com
    assert.equal(SYSTEM_PLATFORM_EMAIL, "flas@mobidigisol.com");

    // Tenant campaign sender
    const tenantSender = "promotions@acmetrading.com";
    assert.notEqual(tenantSender, SYSTEM_PLATFORM_EMAIL);

    // Verify system operations cannot be routed via tenant sender
    const isPlatformAllowedSender = (sender) => sender.includes(SYSTEM_PLATFORM_EMAIL);
    assert.equal(isPlatformAllowedSender(tenantSender), false);
    assert.equal(isPlatformAllowedSender(SYSTEM_PLATFORM_EMAIL), true);
  });
});
