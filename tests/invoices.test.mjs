import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { buildDocumentPdf, decodeInvoiceLogo } from "../node_modules/.cache/flas-invoices.mjs";

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
