/**
 * tests/email-marketing-templates-unsub.test.mjs
 *
 * Empirical verification of:
 * 1. Open-source bulletproof responsive email templates
 * 2. Image attachment and hero image rendering
 * 3. Dynamic merge tag substitution
 * 4. Spam & deliverability preflight validation
 * 5. HMAC-SHA256 one-click unsubscribe token generation & expiry
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  BUILT_IN_EMAIL_TEMPLATES,
  substituteMergeTags,
  validateEmailMarketingHtml,
} from "../src/lib/email-templates.ts";
import {
  generateUnsubscribeToken,
  verifyUnsubscribeToken,
} from "../src/lib/lead-automation.server.ts";

describe("Email Marketing: Template Presets & Standards", () => {
  test("All 4 built-in responsive templates exist with complete metadata", () => {
    assert.equal(BUILT_IN_EMAIL_TEMPLATES.length, 4);

    const ids = BUILT_IN_EMAIL_TEMPLATES.map((t) => t.id);
    assert.deepEqual(ids, [
      "welcome_discount",
      "product_showcase",
      "flash_sale",
      "newsletter_digest",
    ]);

    for (const tpl of BUILT_IN_EMAIL_TEMPLATES) {
      assert.ok(tpl.name.length > 5, "Template must have descriptive name");
      assert.ok(tpl.subject.length > 5, "Template must have subject");
      assert.ok(tpl.htmlContent.length > 100, "Template must contain HTML body");
      assert.ok(tpl.defaultImageUrl, "Template must provide default hero image");
      assert.match(tpl.htmlContent, /\{\{unsubscribe_url\}\}/, "Template must have unsubscribe placeholder");
    }
  });

  test("Dynamic merge tags substitution replaces all placeholders", () => {
    const raw = "Hello {{name}}! Welcome to {{company}}. Your code is {{discount_code}}. Unsub: {{unsubscribe_url}}";
    const rendered = substituteMergeTags(raw, {
      name: "Fatima",
      company: "Acme UAE",
      discount_code: "SPECIAL50",
      unsubscribe_url: "https://flas.app/unsubscribe?token=xyz",
    });

    assert.equal(
      rendered,
      "Hello Fatima! Welcome to Acme UAE. Your code is SPECIAL50. Unsub: https://flas.app/unsubscribe?token=xyz"
    );
    assert.equal(rendered.includes("{{"), false, "All tags must be substituted");
  });

  test("Image attachments & hero images preserve aspect ratio and alt text", () => {
    const welcomeTpl = BUILT_IN_EMAIL_TEMPLATES.find((t) => t.id === "welcome_discount");
    assert.ok(welcomeTpl, "welcome_discount template must exist");
    const rendered = substituteMergeTags(welcomeTpl.htmlContent, {
      company: "Flas CRM",
      name: "Ahmed",
      image_url: "https://cdn.example.com/banner.png",
    });

    assert.match(rendered, /src="https:\/\/cdn\.example\.com\/banner\.png"/);
    assert.match(rendered, /alt="Flas CRM Banner"/);
    assert.match(rendered, /max-width: 600px/);
  });
});

describe("Email Marketing: Deliverability Preflight & Validation", () => {
  test("Passes clean compliant email with unsubscribe tag", () => {
    const cleanHtml = `<p>Hello world</p><a href="{{unsubscribe_url}}">Unsubscribe</a>`;
    const res = validateEmailMarketingHtml(cleanHtml);
    assert.equal(res.valid, true);
    assert.equal(res.errors.length, 0);
  });

  test("Catches missing unsubscribe link (CAN-SPAM violation)", () => {
    const nonCompliantHtml = `<div>Buy our product today at 50% discount!</div>`;
    const res = validateEmailMarketingHtml(nonCompliantHtml);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes("Missing mandatory unsubscribe link")));
  });

  test("Catches unsafe <script> tags", () => {
    const dangerousHtml = `<div>Hello</div><script>alert('pwned')</script><a href="{{unsubscribe_url}}">Unsub</a>`;
    const res = validateEmailMarketingHtml(dangerousHtml);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes("Unsafe <script> tag detected")));
  });

  test("Warns about base64 inline images due to client clipping risks", () => {
    const inlineImgHtml = `<div><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" alt="dot" /><a href="{{unsubscribe_url}}">Unsub</a></div>`;
    const res = validateEmailMarketingHtml(inlineImgHtml);
    assert.equal(res.valid, true);
    assert.ok(res.warnings.some((w) => w.includes("Inline base64 image detected")));
  });
});

describe("Email Marketing: One-Click Unsubscribe HMAC Security", () => {
  test("Generates valid HMAC signed token and verifies payload", () => {
    const token = generateUnsubscribeToken("customer@example.com", "tenant_123");
    assert.ok(token.includes("."));

    const verified = verifyUnsubscribeToken(token);
    assert.equal(verified.valid, true);
    assert.equal(verified.email, "customer@example.com");
    assert.equal(verified.tenantId, "tenant_123");
  });

  test("Refuses tampered token signature", () => {
    const token = generateUnsubscribeToken("victim@example.com", "tenant_123");
    const [data] = token.split(".");
    const forgedToken = `${data}.tampered_fake_signature`;

    const verified = verifyUnsubscribeToken(forgedToken);
    assert.equal(verified.valid, false);
    assert.equal(verified.error, "Invalid signature");
  });

  test("Refuses expired token", () => {
    // Generate token with negative TTL
    const expiredToken = generateUnsubscribeToken("expired@example.com", "tenant_123", -10);
    const verified = verifyUnsubscribeToken(expiredToken);
    assert.equal(verified.valid, false);
    assert.equal(verified.error, "Token expired");
  });
});
