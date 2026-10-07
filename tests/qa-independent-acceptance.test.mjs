import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

describe("QA Matrix Item 4: Invoice PDF & Arabic Character Support", () => {
  it("proves that safe() in invoice-pdf.server.ts strips all Arabic unicode characters", () => {
    const source = readFileSync(
      new URL("../src/lib/invoice-pdf.server.ts", import.meta.url),
      "utf8",
    );
    // Locate the safe() function definition
    assert.ok(
      source.includes("replace(/[^\\u0000-\\u00FF]/g"),
      "safe() strips non-Latin-1 characters",
    );

    // Simulate the regex used in invoice-pdf.server.ts
    const sanitize = (text) =>
      String(text ?? "")
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2013\u2014]/g, "-")
        .replace(/\u00A0/g, " ")
        .replace(/[^\u0000-\u00FF]/g, "");

    const arabicCompanyName = "شركة النور للتجارة";
    const arabicCustomer = "مؤسسة الأمل";
    const arabicDescription = "كاميرات مراقبة وحلول أمنية";

    // Expected under current implementation: all Arabic glyphs are stripped away, leaving only whitespace
    assert.equal(
      sanitize(arabicCompanyName).trim(),
      "",
      "Arabic company name stripped to whitespace",
    );
    assert.equal(
      sanitize(arabicCustomer).trim(),
      "",
      "Arabic customer name stripped to whitespace",
    );
    assert.equal(
      sanitize(arabicDescription).trim(),
      "",
      "Arabic product description stripped to whitespace",
    );
  });

  it("proves StandardFonts does not include Unicode / Arabic font support", () => {
    const source = readFileSync(
      new URL("../src/lib/invoice-pdf.server.ts", import.meta.url),
      "utf8",
    );
    assert.ok(source.includes("StandardFonts.Helvetica"));
    assert.ok(source.includes("StandardFonts.HelveticaBold"));
    // StandardFonts only support WinAnsi / Latin-1 encoding, confirming lack of Arabic font embedding
    assert.equal(
      source.includes("fontkit"),
      false,
      "fontkit is not imported for custom unicode TTF/OTF fonts",
    );
  });
});

describe("QA Matrix Item 5: Invoicing Blocker Localization", () => {
  it("proves finaliseBlocker returns hardcoded English strings instead of translation keys", () => {
    const source = readFileSync(
      new URL("../src/routes/_authenticated/sales.tsx", import.meta.url),
      "utf8",
    );
    assert.ok(
      source.includes('return "Add a customer name or company before finalising.";'),
      "finaliseBlocker contains hardcoded English customer blocker",
    );
    assert.ok(
      source.includes(
        'return "Add at least one line with a description and a quantity above zero.";',
      ),
      "finaliseBlocker contains hardcoded English items blocker",
    );
    assert.ok(
      source.includes('return "The total is zero — check the prices before finalising.";'),
      "finaliseBlocker contains hardcoded English zero total blocker",
    );
  });
});

describe("QA Matrix Item 6: Campaign Background Dispatch Worker", () => {
  it("proves queueCampaign marks campaign as scheduled without background daemon", () => {
    const source = readFileSync(
      new URL("../src/routes/_authenticated/marketing.tsx", import.meta.url),
      "utf8",
    );
    assert.ok(
      source.includes('update({ status: "scheduled", scheduled_at: new Date().toISOString() })'),
      "queueCampaign updates status to scheduled",
    );
    assert.ok(
      source.includes("sendingIsNotAutomatedYet") || source.includes("sending is not automated"),
      "UI documents that sending is not automated",
    );
  });
});

describe("QA Matrix Item 2: WhatsApp Media Attachments in Inbound Webhook", () => {
  it("proves incoming media attachments are represented as text tags and not persisted binaries", () => {
    const source = readFileSync(
      new URL("../src/lib/monitoring.server.ts", import.meta.url),
      "utf8",
    );
    assert.ok(
      source.includes("extractMessageBody"),
      "extractMessageBody parses incoming WhatsApp message types",
    );
    assert.ok(
      source.includes("does not yet download and re-host"),
      "documents unpersisted media binary limitation",
    );
  });
});
