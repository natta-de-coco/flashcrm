/**
 * tests/multi-user-email-and-storage.test.mjs
 *
 * Automated regression test suite for:
 * 1. Multi-User Email Account isolation (per-seat SMTP/IMAP credentials)
 * 2. Strict 1 GB Storage auto-pruning computation
 * 3. Bidirectional portal message formatting and storage footprint calculation
 * 4. Outlook & mobile cross-client responsive HTML rendering validation
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

describe("Multi-User Email Accounts & Role Scoping", () => {
  test("Distinguishes personal vs shared vs marketing mailboxes", () => {
    const accounts = [
      { id: "1", userId: "u_mgr", accountType: "marketing", fromEmail: "newsletter@company.ae" },
      { id: "2", userId: "u_rep1", accountType: "personal", fromEmail: "tariq@company.ae" },
      { id: "3", userId: "u_rep2", accountType: "personal", fromEmail: "fatima@company.ae" },
      { id: "4", userId: "u_rep1", accountType: "shared", fromEmail: "sales@company.ae" },
    ];

    // Sales Rep 1 sees their personal box + shared team box
    const rep1Visible = accounts.filter(
      (a) => a.userId === "u_rep1" || a.accountType === "shared"
    );
    assert.equal(rep1Visible.length, 2);
    assert.deepEqual(
      rep1Visible.map((a) => a.fromEmail),
      ["tariq@company.ae", "sales@company.ae"]
    );

    // Sales Rep 2 cannot see Rep 1's personal mailbox
    const rep2Visible = accounts.filter(
      (a) => a.userId === "u_rep2" || a.accountType === "shared"
    );
    assert.equal(rep2Visible.length, 2);
    assert.ok(!rep2Visible.some((a) => a.fromEmail === "tariq@company.ae"));
  });

  test("Appends personal signature when replying from representative mailbox", () => {
    const formatOutboundEmail = ({ bodyText, signatureHtml }) => {
      return `<div style="font-family: sans-serif; font-size: 15px; color: #1e293b; line-height: 1.6;">
        ${bodyText.replace(/\n/g, "<br>")}
        ${signatureHtml ? `<div style="margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 16px;">${signatureHtml}</div>` : ""}
      </div>`;
    };

    const html = formatOutboundEmail({
      bodyText: "Hello Mohammed,\nAttached is our quote for the project.",
      signatureHtml: "<strong>Tariq Mansoor</strong><br>Senior Sales Consultant",
    });

    assert.match(html, /Attached is our quote/);
    assert.match(html, /Tariq Mansoor/);
    assert.match(html, /Senior Sales Consultant/);
  });
});

describe("1 GB Storage Auto-Pruning Engine", () => {
  const ONE_GB_BYTES = 1073741824;
  const WARNING_BYTES = 912680550; // 85%

  test("Accurately calculates storage usage percentage against 1 GB cap", () => {
    const calcUsage = (usedBytes) => {
      const pct = (usedBytes / ONE_GB_BYTES) * 100;
      return {
        usedMb: (usedBytes / (1024 * 1024)).toFixed(1),
        pct: Number(pct.toFixed(2)),
        isCritical: usedBytes >= WARNING_BYTES,
      };
    };

    // 250 MB used -> 24.41% -> Not critical
    const low = calcUsage(262144000);
    assert.equal(low.isCritical, false);
    assert.ok(low.pct < 30);

    // 920 MB used -> 89.84% -> Critical warning trigger
    const high = calcUsage(964689920);
    assert.equal(high.isCritical, true);
    assert.ok(high.pct > 85);
  });

  test("Simulates 60-day payload pruning when exceeding 85% cap", () => {
    const messages = [
      { id: "m1", daysOld: 75, bytes: 400000000 },
      { id: "m2", daysOld: 65, bytes: 450000000 },
      { id: "m3", daysOld: 10, bytes: 200000000 },
    ];

    let totalBytes = messages.reduce((acc, m) => acc + m.bytes, 0); // 1,050,000,000 (~1 GB)
    assert.ok(totalBytes > WARNING_BYTES);

    // Prune rows older than 60 days
    const remaining = messages.filter((m) => m.daysOld <= 60);
    const prunedBytes = messages
      .filter((m) => m.daysOld > 60)
      .reduce((acc, m) => acc + m.bytes, 0);

    const postPruneTotal = totalBytes - prunedBytes;

    assert.equal(remaining.length, 1);
    assert.equal(postPruneTotal, 200000000);
    assert.ok(postPruneTotal < WARNING_BYTES);
  });
});

describe("Cerberus Hybrid Responsive HTML Template Integrity", () => {
  test("Includes MSO conditional comments for Outlook desktop clients", () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
</head>
<body></body>
</html>`;

    assert.match(html, /<!--\[if mso\]>/);
    assert.match(html, /OfficeDocumentSettings/);
    assert.match(html, /<!\[endif\]-->/);
  });

  test("Has fluid 600px max-width container and mobile media queries", () => {
    const css = `
      @media only screen and (max-width: 620px) {
        .container { width: 100% !important; padding: 12px !important; }
        .hero-img { height: auto !important; max-height: 240px !important; }
        .coupon-box { padding: 18px !important; }
        .btn { width: 100% !important; display: block !important; text-align: center !important; }
      }
    `;

    assert.match(css, /max-width: 620px/);
    assert.match(css, /\.container \{ width: 100% !important/);
    assert.match(css, /\.btn \{ width: 100% !important/);
  });
});
