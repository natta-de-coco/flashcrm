import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import {
  buildDocumentPdf,
  decodeInvoiceLogo,
  INVOICE_TEMPLATES,
  getInvoiceTemplate,
  BLOG_TEMPLATES,
  getBlogTemplate,
  generateTallySalesXml,
  generateQuickBooksCsv,
  generateQuickBooksIif,
  generateQuickBooksInvoiceJson,
  generateZohoInvoiceCsv,
  generateZohoInvoiceJson,
  sanitizeCsvCell,
  escapeXml,
  escapeIif,
  isSafeWordPressUrl,
  mapSavedDocumentToSync,
  computeDocumentTotals,
} from "../node_modules/.cache/flas-invoices.mjs";

export const invoiceFixture = {
  kind: "invoice",
  mode: "draft",
  doc_number: "INV-2026-00128",
  status: "draft",
  issue_date: "2026-10-05",
  due_date: "2026-11-04",
  currency: "AED",
  tax_label: "VAT",
  reference: "Security system installation",
  po_number: "PO-00824",
  payment_terms: "Net 30 days",
  subtotal: 4000,
  item_discount_total: 0,
  invoice_discount: 0,
  taxable_amount: 4000,
  tax_total: 200,
  shipping: 0,
  additional_charges: 0,
  adjustment: 0,
  grand_total: 4200,
  paid_amount: 0,
  balance: 4200,
  company: {
    legal_name: "FLAS Demo Company LLC",
    address: "Business Bay, Dubai, United Arab Emirates",
    email: "accounts@example.com",
    phone: "+971 50 000 0000",
    vat_number: "100000000000003",
  },
  customer: {
    name: "Example Customer",
    company: "Example Trading LLC",
    address: "Dubai, United Arab Emirates",
    email: "finance@example.com",
  },
  items: [
    {
      name: "IP surveillance system",
      description: "Supply, installation and commissioning",
      quantity: 4,
      unit: "units",
      unit_price: 1000,
      discount_amount: 0,
      tax_rate: 5,
      tax_amount: 200,
      line_total: 4200,
    },
  ],
  bank: {
    bank_name: "Example Bank",
    account_name: "FLAS Demo Company LLC",
    iban: "AE000000000000000000000",
    swift: "EXAMPLE",
  },
  notes: "Thank you for your business.",
  terms: "Payment is due within 30 days. Please include the invoice number with your payment.",
  template: { watermark_enabled: false },
};

test("a real company PNG is accepted and its MIME is preserved", async () => {
  const bytes = readFileSync("public/flas-logo.png");
  const result = await decodeInvoiceLogo(`data:image/png;base64,${bytes.toString("base64")}`);
  assert.equal(result.contentType, "image/png");
  assert.deepEqual(Buffer.from(result.bytes), bytes);
});
test("logo upload rejects SVG, forged PNG, oversized bytes and decompression-sized images", async () => {
  await assert.rejects(decodeInvoiceLogo("data:image/svg+xml;base64,PHN2Zz4="), /PNG or JPG/);
  await assert.rejects(decodeInvoiceLogo("data:image/png;base64,aGVsbG8="), /valid PNG/);
  await assert.rejects(
    decodeInvoiceLogo(`data:image/jpeg;base64,${Buffer.alloc(2097153).toString("base64")}`),
    /2 MB/,
  );
  const png = Buffer.from(readFileSync("public/flas-logo.png"));
  png.writeUInt32BE(100000, 16);
  await assert.rejects(
    decodeInvoiceLogo(`data:image/png;base64,${png.toString("base64")}`),
    /4096/,
  );
});
test("ordinary invoice fits one A4 page; long descriptions and terms paginate", async () => {
  const ordinary = await PDFDocument.load(await buildDocumentPdf(invoiceFixture));
  assert.equal(ordinary.getPageCount(), 1);
  assert.equal(Math.round(ordinary.getPage(0).getWidth()), 595);
  const long = await PDFDocument.load(
    await buildDocumentPdf({
      ...invoiceFixture,
      items: Array.from({ length: 35 }, (_, i) => ({
        ...invoiceFixture.items[0],
        name: `Product ${i + 1}`,
        description: "Detailed installation and support specification. ".repeat(10),
        sku: "A".repeat(100),
      })),
      terms: "Payment and warranty conditions apply to the listed products. ".repeat(80),
    }),
  );
  assert.ok(long.getPageCount() > 3);
});

test("invoice templates palette provides 5 verified themes with fallback", async () => {
  assert.equal(INVOICE_TEMPLATES.length, 5);
  const ids = INVOICE_TEMPLATES.map((t) => t.id);
  assert.deepEqual(ids, [
    "modern-emerald",
    "corporate-navy",
    "executive-slate",
    "clean-minimal",
    "bold-crimson",
  ]);

  const emerald = getInvoiceTemplate("modern-emerald");
  assert.equal(emerald.primary_color, "#0F5132");
  assert.equal(emerald.accent_color, "#16A34A");

  const navy = getInvoiceTemplate("corporate-navy");
  assert.equal(navy.primary_color, "#1E3A8A");
  assert.equal(navy.accent_color, "#3B82F6");

  // Fallback to default modern-emerald
  assert.equal(getInvoiceTemplate(null).id, "modern-emerald");
  assert.equal(getInvoiceTemplate("non-existent-theme").id, "modern-emerald");

  // PDF generation with corporate-navy styling succeeds
  const navyPdfBytes = await buildDocumentPdf({
    ...invoiceFixture,
    template: {
      primary_color: navy.primary_color,
      accent_color: navy.accent_color,
      watermark_enabled: false,
    },
  });
  const navyDoc = await PDFDocument.load(navyPdfBytes);
  assert.equal(navyDoc.getPageCount(), 1);
});

test("blog templates provide 6 structured SEO blueprints", () => {
  assert.equal(BLOG_TEMPLATES.length, 6);
  const howTo = getBlogTemplate("how-to");
  assert.ok(howTo);
  assert.equal(howTo.intent, "informational");
  assert.ok(howTo.defaultFaq.length >= 2);
  assert.ok(howTo.generateHtml("CRM", "Tech", "FLAS").includes("<p"));

  const comparison = getBlogTemplate("comparison");
  assert.ok(comparison);
  assert.equal(comparison.intent, "commercial");
  assert.ok(comparison.defaultFaq.length >= 2);
});

test("accounting sync exports valid Tally Prime XML Sales Voucher", () => {
  const syncDoc = {
    id: "doc-1",
    doc_number: "INV-2026-00128",
    issue_date: "2026-10-05",
    due_date: "2026-11-04",
    currency: "AED",
    subtotal: 4000,
    tax_total: 200,
    grand_total: 4200,
    customer_snapshot: {
      name: "Example Customer",
      company: "Example Trading LLC",
      address: "Dubai, UAE",
      vat_number: "100000000000003",
    },
  };

  const syncItems = [
    {
      name: "IP surveillance system",
      quantity: 4,
      unit_price: 1000,
      tax_rate: 5,
      tax_amount: 200,
      line_total: 4200,
    },
  ];

  const xml = generateTallySalesXml(syncDoc, syncItems, {
    companyName: "FLAS Demo Company LLC",
    salesLedger: "General Sales",
    taxLedger: "VAT Output 5%",
  });

  assert.match(xml, /<ENVELOPE>/);
  assert.match(xml, /<TALLYREQUEST>Import Data<\/TALLYREQUEST>/);
  assert.match(xml, /<VOUCHER VCHTYPE="Sales"/);
  assert.match(xml, /<DATE>20261005<\/DATE>/);
  assert.match(xml, /<VOUCHERNUMBER>INV-2026-00128<\/VOUCHERNUMBER>/);
  assert.match(xml, /<PARTYLEDGERNAME>Example Trading LLC<\/PARTYLEDGERNAME>/);
  assert.match(xml, /<LEDGERNAME>General Sales<\/LEDGERNAME>/);
  assert.match(xml, /<LEDGERNAME>VAT Output 5%<\/LEDGERNAME>/);
});

test("accounting sync exports valid QuickBooks and Zoho formats", () => {
  const syncDoc = {
    id: "doc-1",
    doc_number: "INV-2026-00128",
    issue_date: "2026-10-05",
    due_date: "2026-11-04",
    currency: "AED",
    subtotal: 4000,
    tax_total: 200,
    grand_total: 4200,
    customer_snapshot: {
      name: "Example Customer",
      company: "Example Trading LLC",
      email: "finance@example.com",
    },
  };

  const syncItems = [
    {
      name: "IP surveillance system",
      description: "Installation and setup",
      quantity: 4,
      unit_price: 1000,
      tax_rate: 5,
      tax_amount: 200,
      line_total: 4200,
    },
  ];

  // QuickBooks CSV
  const qbCsv = generateQuickBooksCsv(syncDoc, syncItems);
  assert.match(qbCsv, /^\*InvoiceNo,\*Customer,\*InvoiceDate,\*DueDate/);
  assert.match(qbCsv, /INV-2026-00128/);
  assert.match(qbCsv, /Example Trading LLC/);

  // QuickBooks IIF
  const qbIif = generateQuickBooksIif(syncDoc, syncItems);
  assert.match(qbIif, /!TRNS/);
  assert.match(qbIif, /!SPL/);
  assert.match(qbIif, /!ENDTRNS/);

  // QuickBooks JSON
  const qbJson = JSON.parse(generateQuickBooksInvoiceJson(syncDoc, syncItems));
  assert.equal(qbJson.DocNumber, "INV-2026-00128");
  assert.equal(qbJson.CustomerRef.value, "Example Trading LLC");
  assert.equal(qbJson.Line.length, 1);

  // Zoho Books CSV
  const zohoCsv = generateZohoInvoiceCsv(syncDoc, syncItems);
  assert.match(zohoCsv, /^Invoice Number,Customer Name,Invoice Date,/);
  assert.match(zohoCsv, /INV-2026-00128/);
  assert.match(zohoCsv, /Example Trading LLC/);

  // Zoho Books JSON
  const zohoJson = JSON.parse(generateZohoInvoiceJson(syncDoc, syncItems));
  assert.equal(zohoJson.invoice_number, "INV-2026-00128");
  assert.equal(zohoJson.customer_name, "Example Trading LLC");
  assert.equal(zohoJson.line_items.length, 1);
});

test("accounting sync balances journal entries exactly across net lines, tax, shipping, charges and adjustments", () => {
  const syncDoc = {
    id: "doc-balanced-1",
    doc_number: "INV-2026-00999",
    issue_date: "2026-10-10",
    due_date: "2026-11-10",
    currency: "AED",
    subtotal: 1000,
    tax_total: 50,
    shipping: 40,
    additional_charges: 15,
    adjustment: -5,
    grand_total: 1100,
    customer_snapshot: {
      name: "Balanced Customer",
      company: "Balanced Global FZE",
    },
  };

  const syncItems = [
    {
      name: "Industrial Switch",
      quantity: 2,
      unit_price: 500,
      discount_amount: 0,
      tax_rate: 5,
      tax_amount: 50,
      line_total: 1050,
    },
  ];

  // 1. Tally XML
  const xml = generateTallySalesXml(syncDoc, syncItems);
  assert.match(xml, /<AMOUNT>1100.00<\/AMOUNT>/);
  assert.match(xml, /<AMOUNT>-1000.00<\/AMOUNT>/);
  assert.match(xml, /<AMOUNT>-50.00<\/AMOUNT>/);
  assert.match(xml, /<LEDGERNAME>Shipping Income<\/LEDGERNAME>/);
  assert.match(xml, /<AMOUNT>-40.00<\/AMOUNT>/);
  assert.match(xml, /<LEDGERNAME>Additional Charges<\/LEDGERNAME>/);
  assert.match(xml, /<AMOUNT>-15.00<\/AMOUNT>/);
  assert.match(xml, /<LEDGERNAME>Round Off<\/LEDGERNAME>/);

  // 2. QuickBooks IIF
  const iif = generateQuickBooksIif(syncDoc, syncItems);
  const splLines = iif.split("\n").filter((l) => l.startsWith("SPL\t"));
  const trnsLine = iif.split("\n").find((l) => l.startsWith("TRNS\t"));
  assert.ok(trnsLine);
  const trnsAmount = parseFloat(trnsLine.split("\t")[6]);
  assert.equal(trnsAmount, 1100);

  const splTotal = splLines.reduce((acc, l) => acc + parseFloat(l.split("\t")[6]), 0);
  assert.equal(Math.round((trnsAmount + splTotal) * 100) / 100, 0);
});

test("accounting sync balances 100 AED invoice with 10 AED document discount in QuickBooks IIF and Tally XML", () => {
  // Codex reproducer: 100 AED invoice with 10 AED overall discount
  const syncDoc = {
    id: "doc-codex-discount-1",
    doc_number: "INV-2026-00301",
    issue_date: "2026-10-13",
    due_date: "2026-11-13",
    currency: "AED",
    subtotal: 100,
    invoice_discount: 10,
    taxable_amount: 90,
    tax_total: 0,
    shipping: 0,
    additional_charges: 0,
    adjustment: 0,
    grand_total: 90,
    customer_snapshot: {
      name: "Codex Reviewer",
      company: "Codex Testing FZE",
    },
  };

  const syncItems = [
    {
      name: "Consulting Service",
      quantity: 1,
      unit_price: 100,
      tax_rate: 0,
      tax_amount: 0,
      line_total: 100,
    },
  ];

  // 1. QuickBooks IIF must balance to exactly 0.00
  const iif = generateQuickBooksIif(syncDoc, syncItems);
  const splLines = iif.split("\n").filter((l) => l.startsWith("SPL\t"));
  const trnsLine = iif.split("\n").find((l) => l.startsWith("TRNS\t"));
  assert.ok(trnsLine);
  const trnsAmount = parseFloat(trnsLine.split("\t")[6]);
  assert.equal(trnsAmount, 90);

  // Split line for Discounts Given must be present and have +10.00 debit
  const discountSpl = splLines.find((l) => l.split("\t")[4] === "Discounts Given");
  assert.ok(discountSpl, "QuickBooks IIF must contain a split line for Discounts Given");
  assert.equal(parseFloat(discountSpl.split("\t")[6]), 10);

  const splTotal = splLines.reduce((acc, l) => acc + parseFloat(l.split("\t")[6]), 0);
  assert.equal(
    Math.round((trnsAmount + splTotal) * 100) / 100,
    0,
    "QuickBooks IIF sum of TRNS and SPL amounts must be exactly zero",
  );

  // 2. Tally Prime XML must balance debits and credits
  const xml = generateTallySalesXml(syncDoc, syncItems);
  assert.match(
    xml,
    /<LEDGERNAME>Codex Testing FZE<\/LEDGERNAME>[\s\S]*?<ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE>[\s\S]*?<AMOUNT>90\.00<\/AMOUNT>/,
  );
  assert.match(
    xml,
    /<LEDGERNAME>Discounts Given<\/LEDGERNAME>[\s\S]*?<ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE>[\s\S]*?<AMOUNT>10\.00<\/AMOUNT>/,
  );
  assert.match(xml, /<AMOUNT>-100\.00<\/AMOUNT>/);

  // 3. QuickBooks JSON must contain DiscountLineDetail
  const qbJson = JSON.parse(generateQuickBooksInvoiceJson(syncDoc, syncItems));
  const discountLine = qbJson.Line.find((l) => l.DetailType === "DiscountLineDetail");
  assert.ok(discountLine, "QuickBooks JSON must include DiscountLineDetail");
  assert.equal(discountLine.Amount, 10);
});

test("accounting sync balances document discounts alongside tax, shipping, additional charges, and rounding in both directions", () => {
  // Scenario A: 100 AED subtotal, 10 AED discount, 5% tax (4.50), 15 shipping, 5 charges, -0.50 adjustment => 114.00 grand_total
  const syncDocA = {
    id: "doc-complex-1",
    doc_number: "INV-2026-00302",
    issue_date: "2026-10-13",
    due_date: "2026-11-13",
    currency: "AED",
    tax_label: "VAT",
    subtotal: 100,
    invoice_discount: 10,
    taxable_amount: 90,
    tax_total: 4.5,
    shipping: 15,
    additional_charges: 5,
    adjustment: -0.5,
    grand_total: 114,
    customer_snapshot: {
      name: "Complex Customer",
      company: "Complex Enterprises LLC",
    },
  };

  const syncItemsA = [
    {
      name: "Network Hardware",
      quantity: 1,
      unit_price: 100,
      tax_rate: 5,
      tax_amount: 4.5,
      line_total: 104.5,
    },
  ];

  // QuickBooks IIF check
  const iifA = generateQuickBooksIif(syncDocA, syncItemsA, {
    discountLedger: "Sales Discounts",
    roundOffLedger: "Rounding Account",
  });
  const splLinesA = iifA.split("\n").filter((l) => l.startsWith("SPL\t"));
  const trnsLineA = iifA.split("\n").find((l) => l.startsWith("TRNS\t"));
  assert.ok(trnsLineA);
  const trnsAmountA = parseFloat(trnsLineA.split("\t")[6]);
  assert.equal(trnsAmountA, 114);
  const splTotalA = splLinesA.reduce((acc, l) => acc + parseFloat(l.split("\t")[6]), 0);
  assert.equal(
    Math.round((trnsAmountA + splTotalA) * 100) / 100,
    0,
    "QuickBooks IIF complex invoice with discount, tax, charges, rounding must balance to 0",
  );

  // Tally XML check
  const xmlA = generateTallySalesXml(syncDocA, syncItemsA, {
    discountLedger: "Sales Discounts",
    roundOffLedger: "Rounding Account",
  });
  assert.match(
    xmlA,
    /<LEDGERNAME>Sales Discounts<\/LEDGERNAME>[\s\S]*?<ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE>[\s\S]*?<AMOUNT>10\.00<\/AMOUNT>/,
  );
  assert.match(
    xmlA,
    /<LEDGERNAME>Rounding Account<\/LEDGERNAME>[\s\S]*?<ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE>[\s\S]*?<AMOUNT>0\.50<\/AMOUNT>/,
  );
  assert.doesNotMatch(
    xmlA,
    /<AMOUNT>--/,
    "Tally XML amounts must never contain malformed double minus",
  );

  // Scenario B: Positive rounding adjustment (+0.50 => 115.00 grand_total)
  const syncDocB = {
    ...syncDocA,
    doc_number: "INV-2026-00303",
    adjustment: 0.5,
    grand_total: 115,
  };
  const iifB = generateQuickBooksIif(syncDocB, syncItemsA);
  const splLinesB = iifB.split("\n").filter((l) => l.startsWith("SPL\t"));
  const trnsLineB = iifB.split("\n").find((l) => l.startsWith("TRNS\t"));
  assert.ok(trnsLineB);
  const trnsAmountB = parseFloat(trnsLineB.split("\t")[6]);
  assert.equal(trnsAmountB, 115);
  const splTotalB = splLinesB.reduce((acc, l) => acc + parseFloat(l.split("\t")[6]), 0);
  assert.equal(
    Math.round((trnsAmountB + splTotalB) * 100) / 100,
    0,
    "QuickBooks IIF with positive rounding must balance to 0",
  );

  const xmlB = generateTallySalesXml(syncDocB, syncItemsA);
  assert.match(
    xmlB,
    /<LEDGERNAME>Round Off<\/LEDGERNAME>[\s\S]*?<ISDEEMEDPOSITIVE>No<\/ISDEEMEDPOSITIVE>[\s\S]*?<AMOUNT>-0\.50<\/AMOUNT>/,
  );
  assert.doesNotMatch(xmlB, /<AMOUNT>--/);
});

test("accounting sync balances across real saved invoice math and sales mapper for all 6 fixtures", () => {
  const runFixture = (name, input) => {
    // 1. Authoritative saved billing math calculation
    const totals = computeDocumentTotals(input);

    const doc = {
      id: `doc-${name}`,
      doc_number: `INV-2026-${name}`,
      kind: "invoice",
      issue_date: "2026-10-17",
      due_date: "2026-11-17",
      currency: "AED",
      tax_label: "VAT",
      subtotal: totals.subtotal,
      taxable_amount: totals.taxable_amount,
      tax_total: totals.tax_total,
      grand_total: totals.grand_total,
      paid_amount: 0,
      balance: totals.grand_total,
      shipping: totals.shipping,
      additional_charges: totals.additional_charges,
      adjustment: totals.adjustment,
      invoice_discount: totals.invoice_discount,
      tax_inclusive: Boolean(input.tax_inclusive),
      customer_snapshot: {
        name: "Test Customer",
        company: "Test Fixture Corp",
      },
    };

    const rawItems = input.items.map((it, idx) => ({
      name_snapshot: `Item ${idx + 1}`,
      quantity: it.quantity,
      unit_price: it.unit_price,
      discount_amount: totals.lines[idx].discount_amount,
      tax_rate: it.tax_rate ?? 0,
      tax_amount: totals.lines[idx].tax_amount,
      line_total: totals.lines[idx].line_total,
    }));

    // 2. Real Sales workspace mapper
    const { doc: syncDoc, items: syncItems } = mapSavedDocumentToSync(doc, rawItems);

    // 3. QuickBooks IIF verification
    const iif = generateQuickBooksIif(syncDoc, syncItems);
    const splLines = iif.split("\n").filter((l) => l.startsWith("SPL\t"));
    const trnsLine = iif.split("\n").find((l) => l.startsWith("TRNS\t"));
    assert.ok(trnsLine, `[${name}] Missing TRNS line in IIF`);
    const trnsAmount = parseFloat(trnsLine.split("\t")[6]);
    assert.equal(trnsAmount, totals.grand_total, `[${name}] TRNS amount must equal grand_total`);

    const splSum = splLines.reduce((sum, l) => sum + parseFloat(l.split("\t")[6]), 0);
    const iifVariance = Math.round((trnsAmount + splSum) * 100) / 100;
    assert.equal(iifVariance, 0, `[${name}] QuickBooks IIF variance must be 0.00, got ${iifVariance}`);

    // 4. Tally Prime XML verification
    const xml = generateTallySalesXml(syncDoc, syncItems);
    assert.doesNotMatch(xml, /<AMOUNT>--/, `[${name}] Tally XML must not contain double minus`);
    const entryRegex =
      /<(?:LEDGERENTRIES|ALLINVENTORYENTRIES)\.LIST>[\s\S]*?<ISDEEMEDPOSITIVE>(Yes|No)<\/ISDEEMEDPOSITIVE>[\s\S]*?<AMOUNT>(-?[\d\.]+)<\/AMOUNT>[\s\S]*?<\/(?:LEDGERENTRIES|ALLINVENTORYENTRIES)\.LIST>/g;
    let tallyDebits = 0;
    let tallyCredits = 0;
    let match;
    while ((match = entryRegex.exec(xml)) !== null) {
      const isPositive = match[1] === "Yes";
      const amt = Math.abs(parseFloat(match[2]));
      if (isPositive) tallyDebits += amt;
      else tallyCredits += amt;
    }
    const tallyVariance = Math.round((tallyDebits - tallyCredits) * 100) / 100;
    assert.equal(tallyVariance, 0, `[${name}] Tally XML variance must be 0.00, got ${tallyVariance}`);
  };

  // Fixture 1: Exclusive tax without discount (100 AED item, 5% tax => 105 grand total)
  runFixture("1-exclusive-tax", {
    items: [{ quantity: 1, unit_price: 100, tax_rate: 5 }],
  });

  // Fixture 2: Exclusive tax with document discount (100 AED item, 10 discount, 4.50 tax => 94.50 grand total)
  runFixture("2-exclusive-discount", {
    items: [{ quantity: 1, unit_price: 100, tax_rate: 5 }],
    invoice_discount: 10,
  });

  // Fixture 3: Tax inclusive without discount (105 AED item inclusive of 5% tax => 105 grand total)
  runFixture("3-inclusive-tax", {
    items: [{ quantity: 1, unit_price: 105, tax_rate: 5 }],
    tax_inclusive: true,
  });

  // Fixture 4: Tax inclusive with document discount (105 AED item inclusive of 5% tax, 10 discount => 95 grand total)
  runFixture("4-inclusive-discount", {
    items: [{ quantity: 1, unit_price: 105, tax_rate: 5 }],
    invoice_discount: 10,
    tax_inclusive: true,
  });

  // Fixture 5: Mixed tax items (Item 1: 5% tax, Item 2: 0% tax, Item 3: 5% tax with line discount)
  runFixture("5-mixed-tax", {
    items: [
      { quantity: 2, unit_price: 50, tax_rate: 5 },
      { quantity: 1, unit_price: 75, tax_rate: 0 },
      { quantity: 3, unit_price: 20, tax_rate: 5, discount_value: 10, discount_type: "fixed" },
    ],
    invoice_discount: 15,
  });

  // Fixture 6: Full document charges & positive/negative rounding
  runFixture("6-charges-negative-round", {
    items: [{ quantity: 2, unit_price: 60, tax_rate: 5, discount_value: 10, discount_type: "fixed" }],
    invoice_discount: 10,
    shipping: 25,
    additional_charges: 12.5,
    adjustment: -0.35,
  });

  runFixture("6-charges-positive-round", {
    items: [{ quantity: 1, unit_price: 200, tax_rate: 5 }],
    invoice_discount: 20,
    shipping: 30,
    additional_charges: 10,
    adjustment: 0.45,
  });
});

test("PDF generation strips template_id and internal metadata from custom fields", async () => {
  const pdfBytes = await buildDocumentPdf({
    ...invoiceFixture,
    custom_fields: {
      template_id: "modern-emerald",
      stripe_invoice_id: "in_stripe_secret_123",
      stripe_subscription_id: "sub_stripe_secret_456",
      provider: "stripe",
      is_subscription_receipt: "true",
      customer_po: "PO-LEGAL-789",
    },
  });
  const pdfDoc = await PDFDocument.load(pdfBytes);
  assert.equal(pdfDoc.getPageCount(), 1);
  const pdfText = new TextDecoder().decode(pdfBytes);
  assert.equal(pdfText.includes("template_id:"), false, "template_id must not leak into PDF text");
  assert.equal(pdfText.includes("stripe_invoice_id"), false, "stripe_invoice_id must not leak into PDF text");
});

test("WordPress SSRF guard rejects IPv4-mapped loopback/private IPv6 and cloud metadata", () => {
  assert.equal(isSafeWordPressUrl("http://[::ffff:127.0.0.1]/wp-json"), false);
  assert.equal(isSafeWordPressUrl("http://[::ffff:7f00:1]/wp-json"), false);
  assert.equal(isSafeWordPressUrl("http://[::ffff:10.0.0.1]/wp-json"), false);
  assert.equal(isSafeWordPressUrl("http://[::ffff:172.16.0.1]/wp-json"), false);
  assert.equal(isSafeWordPressUrl("http://[::ffff:192.168.1.1]/wp-json"), false);
  assert.equal(isSafeWordPressUrl("http://[::ffff:169.254.169.254]/wp-json"), false);
  assert.equal(isSafeWordPressUrl("http://[::127.0.0.1]/wp-json"), false);

  assert.equal(isSafeWordPressUrl("http://127.0.0.1/wp-json"), false);
  assert.equal(isSafeWordPressUrl("http://169.254.169.254/latest/meta-data"), false);
  assert.equal(isSafeWordPressUrl("http://metadata.google.internal/"), false);
  assert.equal(isSafeWordPressUrl("http://localhost:8080/"), false);
  assert.equal(isSafeWordPressUrl("http://[::1]/"), false);
  assert.equal(isSafeWordPressUrl("http://[fe80::1]/"), false);
  assert.equal(isSafeWordPressUrl("http://[fc00::1]/"), false);

  assert.equal(isSafeWordPressUrl("https://example.com/wp-json"), true);
  assert.equal(isSafeWordPressUrl("https://my-blog.wordpress.com"), true);
});

test("CSV formula injection protection and delimiter sanitization", () => {
  // Untrusted formula injections are prepended with single quote
  assert.equal(sanitizeCsvCell("=SUM(A1:B10)"), "'=SUM(A1:B10)");
  assert.equal(sanitizeCsvCell("@cmd"), "'@cmd");
  assert.equal(sanitizeCsvCell("+Phone 971"), "'+Phone 971");
  assert.equal(sanitizeCsvCell("-something"), "'-something");
  assert.equal(sanitizeCsvCell("\tmalicious"), "'\tmalicious");

  // Legitimate numbers and negative balances are preserved as numbers
  assert.equal(sanitizeCsvCell(1250.5), "1250.5");
  assert.equal(sanitizeCsvCell(-50), "-50");
  assert.equal(sanitizeCsvCell("-50.00"), "-50.00");
  assert.equal(sanitizeCsvCell("+100"), "+100");
  assert.equal(sanitizeCsvCell(0), "0");

  // Commas and quotes are properly wrapped
  assert.equal(sanitizeCsvCell("Acme, Inc."), '"Acme, Inc."');
  assert.equal(sanitizeCsvCell('Item "Pro"'), '"Item ""Pro"""');

  // XML control characters are stripped
  const maliciousXml = "Clean\x00Name\x08With\x1FControl & <Chars>";
  const escapedXml = escapeXml(maliciousXml);
  assert.equal(escapedXml, "CleanNameWithControl &amp; &lt;Chars&gt;");

  // IIF tabs and newlines are sanitized into spaces
  const badIif = "Invoice\tItem\r\nMultiLine";
  assert.equal(escapeIif(badIif), "Invoice Item MultiLine");
});

test("accounting sync cleanly distinguishes quotations/estimates from finalized sales invoices", () => {
  const quoteDoc = {
    id: "quote-1",
    doc_number: "QT-2026-00042",
    kind: "quotation",
    issue_date: "2026-10-06",
    due_date: "2026-11-05",
    currency: "AED",
    subtotal: 5000,
    tax_total: 250,
    grand_total: 5250,
    customer_snapshot: {
      name: "Ahmed Al Mansoori",
      company: "Apex Innovations",
    },
    notes: "Quotation valid for 30 days",
  };

  const quoteItems = [
    {
      name: "CCTV Setup",
      description: "Complete 8-camera setup",
      quantity: 1,
      unit_price: 5000,
      line_total: 5000,
    },
  ];

  // 1. Tally Prime XML: uses Quotation voucher type and ISINVOICE=No
  const tallyXml = generateTallySalesXml(quoteDoc, quoteItems);
  assert.match(tallyXml, /<VOUCHER VCHTYPE="Quotation"/);
  assert.match(tallyXml, /<VOUCHERTYPENAME>Quotation<\/VOUCHERTYPENAME>/);
  assert.match(tallyXml, /<ISINVOICE>No<\/ISINVOICE>/);

  // 2. QuickBooks Online CSV: uses *EstimateNo and *EstimateDate headers
  const qbCsv = generateQuickBooksCsv(quoteDoc, quoteItems);
  assert.match(qbCsv, /^\*EstimateNo,\*Customer,\*EstimateDate,\*ExpirationDate/);
  assert.match(qbCsv, /QT-2026-00042/);

  // 3. QuickBooks IIF: uses ESTIMATE transaction type
  const qbIif = generateQuickBooksIif(quoteDoc, quoteItems);
  assert.match(qbIif, /TRNS\t\tESTIMATE\t/);
  assert.match(qbIif, /SPL\t\tESTIMATE\t/);

  // 4. Zoho Books CSV: uses Estimate Number and Estimate Date headers
  const zohoCsv = generateZohoInvoiceCsv(quoteDoc, quoteItems);
  assert.match(zohoCsv, /^Estimate Number,Customer Name,Estimate Date,Expiry Date,/);
  assert.match(zohoCsv, /QT-2026-00042/);

  // 5. Zoho Books JSON: uses estimate_number and expiry_date payload
  const zohoJson = JSON.parse(generateZohoInvoiceJson(quoteDoc, quoteItems));
  assert.equal(zohoJson.estimate_number, "QT-2026-00042");
  assert.equal(zohoJson.expiry_date, "2026-11-05");
  assert.equal(zohoJson.invoice_number, undefined);

  // 6. QuickBooks JSON: uses ExpirationDate instead of DueDate
  const qbJson = JSON.parse(generateQuickBooksInvoiceJson(quoteDoc, quoteItems));
  assert.equal(qbJson.ExpirationDate, "2026-11-05");
  assert.equal(qbJson.DueDate, undefined);
});

test("WordPress site connection enforces SSRF validation", () => {
  // Rejects non-http(s)
  assert.equal(isSafeWordPressUrl("ftp://example.com"), false);
  assert.equal(isSafeWordPressUrl("file:///etc/passwd"), false);
  assert.equal(isSafeWordPressUrl("javascript:alert(1)"), false);

  // Rejects loopback & internal
  assert.equal(isSafeWordPressUrl("http://localhost"), false);
  assert.equal(isSafeWordPressUrl("http://localhost:8080/wp"), false);
  assert.equal(isSafeWordPressUrl("http://site.localhost"), false);
  assert.equal(isSafeWordPressUrl("http://127.0.0.1"), false);
  assert.equal(isSafeWordPressUrl("http://127.0.0.1:3000"), false);
  assert.equal(isSafeWordPressUrl("http://[::1]"), false);

  // Rejects cloud metadata
  assert.equal(isSafeWordPressUrl("http://169.254.169.254"), false);
  assert.equal(isSafeWordPressUrl("http://169.254.169.254/latest/meta-data"), false);
  assert.equal(isSafeWordPressUrl("http://metadata.google.internal"), false);

  // Rejects RFC1918 private ranges
  assert.equal(isSafeWordPressUrl("http://10.0.0.1"), false);
  assert.equal(isSafeWordPressUrl("http://172.16.0.1"), false);
  assert.equal(isSafeWordPressUrl("http://192.168.1.1"), false);

  // Allows legitimate public domains
  assert.equal(isSafeWordPressUrl("https://myblog.example.com"), true);
  assert.equal(isSafeWordPressUrl("https://wp.mobidigisol.com"), true);
  assert.equal(isSafeWordPressUrl("http://atozsecurityequipment.com"), true);
});
