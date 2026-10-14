// ═════════════════════════════════════════════════════════════════════════════
// Tier 2: Boundary, Corner & Adversarial Cases (>= 5 test cases per requirement)
// Dual-Tier Email Infrastructure in Flas CRM
// ═════════════════════════════════════════════════════════════════════════════

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  SYSTEM_PLATFORM_EMAIL,
  parseKeyRing,
  encryptEmailSecret,
  decryptEmailSecret,
  simulateSmtpHandshake,
  simulateImapHandshake,
  TenantSmtpStore,
  assertTenantByoVerified,
  generateDomainDnsGuide,
  LeadIntakeEngine,
  WelcomeAutomationEngine,
  CampaignBoardEngine,
  generateUnsubscribeToken,
  verifyAndExecuteUnsubscribe,
} from "./email-test-harness.mjs";

const key = () => crypto.randomBytes(32).toString("base64");
const testRing = () => parseKeyRing(`k1:${key()},k2:${key()}`, "k2");

// ─────────────────────────────────────────────────────────────────────────────
// R1: Platform Super-Admin Email Configuration — Boundaries & Adversarial
// ─────────────────────────────────────────────────────────────────────────────
describe("Tier 2 - R1: Platform Super-Admin Email Configuration (Boundaries)", () => {
  const ring = testRing();
  const aad = "flas-platform:v1:smtp_password";

  test("R1-T2-1: Tampered ciphertext or tag in encrypted platform credentials fails decryption", async () => {
    const original = "SuperSecretPassword123";
    const envelope = await encryptEmailSecret(original, aad, ring);
    const parts = envelope.split(":");

    // Tamper with ciphertext
    const ctBuf = Buffer.from(parts[3], "base64url");
    ctBuf[0] ^= 0xff;
    const tamperedCtEnvelope = `${parts[0]}:${parts[1]}:${parts[2]}:${ctBuf.toString("base64url")}:${parts[4]}`;

    await assert.rejects(
      decryptEmailSecret(tamperedCtEnvelope, aad, ring),
      (err) => err.code === "authentication_failed",
    );

    // Tamper with tag
    const tagBuf = Buffer.from(parts[4], "base64url");
    tagBuf[tagBuf.length - 1] ^= 0x01;
    const tamperedTagEnvelope = `${parts[0]}:${parts[1]}:${parts[2]}:${parts[3]}:${tagBuf.toString("base64url")}`;

    await assert.rejects(
      decryptEmailSecret(tamperedTagEnvelope, aad, ring),
      (err) => err.code === "authentication_failed",
    );
  });

  test("R1-T2-2: Key rotation preserves ability to decrypt records under retired keys", async () => {
    const k1 = key();
    const k2 = key();
    const k3 = key();

    // Written under k1
    const ringV1 = parseKeyRing(`k1:${k1}`, "k1");
    const secretV1 = await encryptEmailSecret("LegacySecretV1", aad, ringV1);
    assert.equal(secretV1.startsWith("v1:k1:"), true);

    // Later ring with active key k3 and k1 retained
    const ringV3 = parseKeyRing(`k1:${k1},k2:${k2},k3:${k3}`, "k3");
    const decrypted = await decryptEmailSecret(secretV1, aad, ringV3);
    assert.equal(decrypted, "LegacySecretV1");

    // New write uses k3
    const fresh = await encryptEmailSecret("FreshSecretV3", aad, ringV3);
    assert.equal(fresh.startsWith("v1:k3:"), true);
  });

  test("R1-T2-3: Unknown key ID or missing key from ring fails closed", async () => {
    const envelopeWithUnknownKey = `v1:unknownKey:${Buffer.alloc(12).toString("base64url")}:${Buffer.alloc(16).toString("base64url")}:${Buffer.alloc(16).toString("base64url")}`;

    await assert.rejects(
      decryptEmailSecret(envelopeWithUnknownKey, aad, ring),
      (err) => err.code === "unknown_key",
    );
  });

  test("R1-T2-4: Socket timeout during SMTP handshake handles network disconnect gracefully", async () => {
    const timeoutHandshake = await simulateSmtpHandshake({
      host: "timeout.mobidigisol.com",
      port: 465,
      secure: true,
      user: "flas@mobidigisol.com",
      pass: "password",
      fromEmail: SYSTEM_PLATFORM_EMAIL,
    });

    assert.equal(timeoutHandshake.ok, false);
    assert.ok(
      timeoutHandshake.error.includes("timed out") || timeoutHandshake.error.includes("ETIMEDOUT"),
    );
  });

  test("R1-T2-5: CRLF injection in sender address or host is caught before network dispatch", async () => {
    const injectionResult = await simulateSmtpHandshake({
      host: "smtp.mobidigisol.com\r\nBcc: evil@attacker.com",
      port: 587,
      secure: true,
      user: "flas@mobidigisol.com",
      pass: "password",
      fromEmail: "flas@mobidigisol.com\r\nBcc: evil@attacker.com",
    });

    assert.equal(injectionResult.ok, false);
    assert.ok(injectionResult.error.includes("CRLF injection detected"));
  });

  test("R1-T2-6: IMAP handshake validates non-standard port numbers with rejection", async () => {
    const invalidPortResult = await simulateImapHandshake({
      host: "imap.mobidigisol.com",
      port: 99999, // Invalid port
      secure: true,
      user: "flas@mobidigisol.com",
      pass: "password",
    });

    assert.equal(invalidPortResult.ok, false);
    assert.ok(invalidPortResult.error.includes("Invalid IMAP port"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R2: Strict BYO Tenant Email Marketing Settings — Boundaries & Adversarial
// ─────────────────────────────────────────────────────────────────────────────
describe("Tier 2 - R2: Strict BYO Tenant Email Marketing Settings (Boundaries)", () => {
  const store = new TenantSmtpStore();
  const ring = testRing();
  const tenantA = "tenant-a-uuid";
  const tenantB = "tenant-b-uuid";

  test("R2-T2-1: Cross-row ciphertext relocation attack (AAD mismatch) fails decryption", async () => {
    const aadA = `flas-tenant:${tenantA}:smtp_pass`;
    const aadB = `flas-tenant:${tenantB}:smtp_pass`;

    const cipherA = await encryptEmailSecret("TenantAPassword", aadA, ring);

    // Attacker copies ciphertext from Tenant A's row into Tenant B's row
    await assert.rejects(
      decryptEmailSecret(cipherA, aadB, ring),
      (err) => err.code === "authentication_failed",
      "Ciphertext bound to Tenant A must not decrypt under Tenant B context",
    );
  });

  test("R2-T2-2: Unverified tenant attempting campaign scheduling is strictly halted with error code", () => {
    const unverifiedCfg = {
      tenant_id: "tenant-unverified",
      verified: false,
      last_test_ok: false,
    };

    assert.throws(
      () => assertTenantByoVerified(unverifiedCfg),
      (err) =>
        err.code === "byo_smtp_unverified" && err.message.includes("Settings → Email Marketing"),
    );
  });

  test("R2-T2-3: Malformed domain names in SPF/DKIM DNS record generator are rejected", () => {
    for (const badDomain of [
      "not-a-domain",
      "http://domain.com",
      "domain..com",
      "domain with spaces.com",
      "",
    ]) {
      assert.throws(
        () => generateDomainDnsGuide(badDomain),
        /Invalid domain name/,
        `Domain "${badDomain}" must be rejected`,
      );
    }
  });

  test("R2-T2-4: Consecutive configuration mutations repeatedly reset verification state", () => {
    store.saveConfig(tenantA, { smtp_host: "smtp1.acme.com", verified: true });
    store.recordTestResult(tenantA, { ok: true });
    assert.equal(store.getConfig(tenantA).verified, true);

    // Mutate 1
    store.saveConfig(tenantA, { smtp_port: 465 });
    assert.equal(store.getConfig(tenantA).verified, false);

    // Re-verify
    store.recordTestResult(tenantA, { ok: true });
    assert.equal(store.getConfig(tenantA).verified, true);

    // Mutate 2
    store.saveConfig(tenantA, { smtp_user: "newuser@acme.com" });
    assert.equal(store.getConfig(tenantA).verified, false);
  });

  test("R2-T2-5: Cross-tenant data isolation: Tenant A cannot read Tenant B unmasked secrets", () => {
    store.saveConfig(tenantB, {
      from_email: "ceo@beta.com",
      smtp_pass_enc: "secret_encrypted_blob",
    });

    const safeConfig = store.getConfig(tenantB);
    assert.equal(
      safeConfig.smtp_pass_enc,
      undefined,
      "Masked return must never expose encrypted pass blob",
    );
  });

  test("R2-T2-6: Empty or whitespace credentials fail handshake preflight", async () => {
    const emptyHandshake = await simulateSmtpHandshake({
      host: "smtp.acme.com",
      port: 587,
      user: "",
      pass: "",
    });

    assert.equal(emptyHandshake.ok, false);
    assert.ok(emptyHandshake.error.includes("Missing SMTP credentials"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R3: Consent-Gated Lead Intake & Website Widget — Boundaries & Adversarial
// ─────────────────────────────────────────────────────────────────────────────
describe("Tier 2 - R3: Consent-Gated Lead Intake & Website Widget (Boundaries)", () => {
  const engine = new LeadIntakeEngine();
  const tenantId = "tenant-intake-boundary";

  test("R3-T2-1: Falsified consent values (null, undefined, 0, string 'true') do NOT grant consent", async () => {
    for (const invalidConsent of [null, undefined, 0, "true", "yes", "on", {}]) {
      const email = `test.${Date.now()}.${Math.random()}@example.com`;
      const res = await engine.ingestLead({
        tenantId,
        siteId: "site_test",
        sitePlatform: "website",
        email,
        consent: invalidConsent,
      });

      assert.equal(
        res.lead.consent_given,
        false,
        `Value ${JSON.stringify(invalidConsent)} must NOT grant consent`,
      );
      assert.equal(res.lead.subscribed, false);
      assert.equal(res.lead.consent_at, null);
    }
  });

  test("R3-T2-2: Extreme length payload in source_url is preserved without memory corruption", async () => {
    const longUrl = "https://example.com/products/view?" + "param=".repeat(200);
    const res = await engine.ingestLead({
      tenantId,
      siteId: "site_test",
      sitePlatform: "website",
      email: "long.url@example.com",
      sourceUrl: longUrl,
      consent: true,
    });

    assert.equal(res.lead.source_url, longUrl);
  });

  test("R3-T2-3: XSS script injection payloads in name and tags are stored as harmless strings", async () => {
    const xssPayload = "<script>alert('pwned')</script>";
    const res = await engine.ingestLead({
      tenantId,
      siteId: "site_test",
      sitePlatform: "website",
      email: "xss.test@example.com",
      name: xssPayload,
      tags: [xssPayload],
      consent: true,
    });

    assert.equal(res.lead.name, xssPayload);
    assert.ok(res.lead.tags.includes(xssPayload));
    // Verify it is treated as plain string without script execution
    assert.equal(typeof res.lead.name, "string");
  });

  test("R3-T2-4: Case normalization: email with mixed-case and whitespace is normalized", async () => {
    const res = await engine.ingestLead({
      tenantId,
      siteId: "site_test",
      sitePlatform: "website",
      email: "  John.DOE+Promo@Example.COM  ",
      consent: true,
    });

    assert.equal(res.lead.email, "john.doe+promo@example.com");
  });

  test("R3-T2-5: Cross-tenant isolation: identical email registered in Tenant A and Tenant B remain distinct", async () => {
    const sharedEmail = "shared.customer@global.com";
    const resA = await engine.ingestLead({
      tenantId: "tenant-a",
      sitePlatform: "website",
      email: sharedEmail,
      consent: true,
      name: "Alice in A",
    });
    const resB = await engine.ingestLead({
      tenantId: "tenant-b",
      sitePlatform: "website",
      email: sharedEmail,
      consent: false,
      name: "Alice in B",
    });

    assert.notEqual(resA.lead.id, resB.lead.id);
    assert.equal(resA.lead.consent_given, true);
    assert.equal(resB.lead.consent_given, false);
  });

  test("R3-T2-6: Deduplication handles multiple tags and preserves unique tag list", async () => {
    await engine.ingestLead({
      tenantId,
      sitePlatform: "website",
      email: "tag.merge@example.com",
      tags: ["summer", "discount"],
      consent: true,
    });
    const updated = await engine.ingestLead({
      tenantId,
      sitePlatform: "website",
      email: "tag.merge@example.com",
      tags: ["discount", "vip", "summer"],
      consent: true,
    });

    assert.deepEqual(updated.lead.tags.sort(), ["discount", "summer", "vip"].sort());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R4: Automated Welcome & Discount Offer Triggers — Boundaries & Adversarial
// ─────────────────────────────────────────────────────────────────────────────
describe("Tier 2 - R4: Automated Welcome & Discount Offer Triggers (Boundaries)", () => {
  const smtpStore = new TenantSmtpStore();
  const automation = new WelcomeAutomationEngine(smtpStore);
  const tenantId = "tenant-welcome-boundary";

  smtpStore.saveConfig(tenantId, { from_email: "promo@store.com", smtp_host: "smtp.store.com" });
  smtpStore.recordTestResult(tenantId, { ok: true });

  test("R4-T2-1: Missing lead name falls back gracefully to 'there' in merge tags", async () => {
    const leadWithoutName = {
      email: "noname@example.com",
      name: null,
      consent_given: true,
    };

    const res = await automation.triggerWelcomeIfConsented(tenantId, leadWithoutName);
    assert.equal(res.triggered, true);
    assert.ok(res.bodyText.includes("Hi there"), "Null name must fall back to 'there'");
    assert.equal(res.bodyText.includes("null"), false);
    assert.equal(res.bodyText.includes("undefined"), false);
  });

  test("R4-T2-2: Special characters and emojis in company name and lead name render safely", async () => {
    const emojiLead = {
      email: "emoji@example.com",
      name: "José 🌟 María",
      consent_given: true,
    };

    const res = await automation.triggerWelcomeIfConsented(tenantId, emojiLead, "Café & Crêpes ☕");
    assert.equal(res.triggered, true);
    assert.ok(res.bodyText.includes("José 🌟 María"));
    assert.ok(res.bodyText.includes("Café & Crêpes ☕"));
  });

  test("R4-T2-3: Disabled automation rule prevents automated email dispatch", async () => {
    automation.setAutomationRule(tenantId, { enabled: false });

    const lead = { email: "disabled@example.com", name: "Test", consent_given: true };
    const res = await automation.triggerWelcomeIfConsented(tenantId, lead);

    assert.equal(res.triggered, false);
    assert.ok(res.reason.includes("disabled"));

    // Reset back to enabled for subsequent tests
    automation.setAutomationRule(tenantId, { enabled: true });
  });

  test("R4-T2-4: Automation engine captures and logs delivery failures when SMTP fails", async () => {
    const tenantBroken = "tenant-broken-smtp";
    smtpStore.saveConfig(tenantBroken, { from_email: "broken@store.com", verified: false });

    const lead = { email: "log.failure@example.com", consent_given: true };
    const res = await automation.triggerWelcomeIfConsented(tenantBroken, lead);

    assert.equal(res.delivered, false);
    assert.equal(res.logEntry.status, "failed");
    assert.ok(res.logEntry.error.includes("unverified"));
  });

  test("R4-T2-5: Unsubscribe URL generated for welcome email contains valid signed token", async () => {
    const lead = { email: "token.test@example.com", name: "Token Test", consent_given: true };
    const res = await automation.triggerWelcomeIfConsented(tenantId, lead);

    assert.ok(res.bodyText.includes("/unsubscribe?token="));
    const tokenMatch = res.bodyText.match(/token=([A-Za-z0-9_-]+)/);
    assert.ok(tokenMatch, "Token must match base64url characters");
  });

  test("R4-T2-6: Empty discount code configuration falls back to default code WELCOME10", async () => {
    automation.setAutomationRule(tenantId, { discountCode: "" });
    const lead = { email: "fallback@example.com", consent_given: true };

    const res = await automation.triggerWelcomeIfConsented(tenantId, lead);
    assert.equal(res.discountCode, "WELCOME10");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R5: Visual Email Marketing Campaign Board & Template Composer — Boundaries
// ─────────────────────────────────────────────────────────────────────────────
describe("Tier 2 - R5: Visual Email Marketing Campaign Board & Template Composer (Boundaries)", () => {
  const smtpStore = new TenantSmtpStore();
  const leadEngine = new LeadIntakeEngine();
  const campaignEngine = new CampaignBoardEngine(smtpStore, leadEngine);
  const tenantId = "tenant-r5-boundaries";
  const secret = "super_hmac_secret_key";

  smtpStore.saveConfig(tenantId, { from_email: "promo@brand.com", smtp_host: "smtp.brand.com" });
  smtpStore.recordTestResult(tenantId, { ok: true });

  test("R5-T2-1: Tampered signature on unsubscribe token is rejected", () => {
    const validToken = generateUnsubscribeToken("victim@example.com", tenantId, secret);
    const decoded = Buffer.from(validToken, "base64url").toString("utf8");
    const parts = decoded.split("|");

    // Tamper with email in payload
    parts[0] = "attacker@example.com";
    const tamperedToken = Buffer.from(parts.join("|")).toString("base64url");

    const result = verifyAndExecuteUnsubscribe(tamperedToken, secret, leadEngine);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes("Invalid signature or token tampered"));
  });

  test("R5-T2-2: Expired unsubscribe token is rejected", () => {
    // Generate token with negative TTL (already expired)
    const expiredToken = generateUnsubscribeToken("old@example.com", tenantId, secret, -1000);

    const result = verifyAndExecuteUnsubscribe(expiredToken, secret, leadEngine);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes("expired"));
  });

  test("R5-T2-3: Cross-tenant unsubscribe attack is refused", async () => {
    const tenantOther = "tenant-other-uuid";
    await leadEngine.ingestLead({
      tenantId: tenantOther,
      sitePlatform: "website",
      email: "target@other.com",
      consent: true,
    });

    // Token generated for tenantId (attacker), attempting to act on tenantOther
    const token = generateUnsubscribeToken("target@other.com", tenantId, secret);
    verifyAndExecuteUnsubscribe(token, secret, leadEngine);

    // Lead in tenantOther must NOT be unsubscribed!
    const targetLead = leadEngine.leads.get(`${tenantOther}:target@other.com`);
    assert.equal(targetLead.subscribed, true, "Tenant A cannot revoke consent for Tenant B lead");
  });

  test("R5-T2-4: Malformed state transition on campaign board throws validation error", () => {
    const camp = campaignEngine.createCampaign(tenantId, {
      name: "State Boundary",
      subject: "Test",
      body: "Body {{unsubscribe_url}}",
    });

    assert.throws(
      () => campaignEngine.transitionStage(camp.id, "invalid_stage_xyz"),
      /Invalid stage: invalid_stage_xyz/,
    );
  });

  test("R5-T2-5: Missing campaign fields (empty subject or body) fail campaign creation", () => {
    assert.throws(
      () =>
        campaignEngine.createCampaign(tenantId, { name: "No Subject", subject: "", body: "body" }),
      /Campaign requires name, subject, and body content/,
    );
    assert.throws(
      () => campaignEngine.createCampaign(tenantId, { name: "", subject: "Subject", body: "body" }),
      /Campaign requires name, subject, and body content/,
    );
  });

  test("R5-T2-6: Dynamic merge tags safely escape or handle missing recipient parameters", () => {
    const camp = campaignEngine.createCampaign(tenantId, {
      name: "Null Checks",
      subject: "Hello {{name}}",
      body: "Company: {{company}}, discount: {{discount_code}}, unsub: {{unsubscribe_url}}",
    });

    const rendered = campaignEngine.renderTemplateForRecipient(
      camp,
      { email: "guest@example.com", name: null },
      "Cool Org",
      "DISCOUNT10",
    );

    assert.equal(rendered.subject, "Hello there");
    assert.ok(rendered.body.includes("Cool Org"));
    assert.ok(rendered.body.includes("DISCOUNT10"));
  });
});
