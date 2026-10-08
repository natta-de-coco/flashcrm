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
