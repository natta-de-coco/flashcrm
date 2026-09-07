/**
 * Server-side PDF engine for Flas CRM business documents.
 *
 * Real vector PDFs are produced with pdf-lib — never a screenshot and never a
 * browser print. Everything (logo watermark, QR verification, page numbering)
 * is drawn into the page content stream, so the watermark cannot simply be
 * selected and deleted in a PDF viewer, and no editable form fields exist.
 */
import {
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import qrcode from "qrcode-generator";

export type PdfItem = {
  name: string;
  description?: string | null;
  sku?: string | null;
  quantity: number;
  unit?: string | null;
  unit_price: number;
  discount_amount: number;
  tax_rate: number;
  tax_amount: number;
  line_total: number;
  serial_number?: string | null;
  warranty?: string | null;
  service_period?: string | null;
};

export type PdfCompany = {
  legal_name?: string | null;
  trade_name?: string | null;
  address?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  vat_number?: string | null;
  registration_number?: string | null;
  logo_url?: string | null;
  signatory_name?: string | null;
  signatory_position?: string | null;
};

export type PdfCustomer = {
  name?: string | null;
  company?: string | null;
  address?: string | null;
  shipping_address?: string | null;
  email?: string | null;
  phone?: string | null;
  vat_number?: string | null;
};

export type PdfBank = {
  bank_name?: string | null;
  account_name?: string | null;
  account_number?: string | null;
  iban?: string | null;
  swift?: string | null;
  branch?: string | null;
};

export type InvoicePdfInput = {
  kind: "invoice" | "quotation" | "credit_note" | "proforma";
  mode: "draft" | "final" | "cancelled";
  doc_number: string;
  status: string;
  issue_date: string;
  due_date?: string | null;
  valid_until?: string | null;
  currency: string;
  tax_label: string;
  reference?: string | null;
  po_number?: string | null;
  payment_terms?: string | null;
  subtotal: number;
  item_discount_total: number;
  invoice_discount: number;
  taxable_amount: number;
  tax_total: number;
  shipping: number;
  additional_charges: number;
  adjustment: number;
  grand_total: number;
  paid_amount: number;
  balance: number;
  notes?: string | null;
  terms?: string | null;
  items: PdfItem[];
  company: PdfCompany;
  customer: PdfCustomer;
  bank?: PdfBank | null;
  verification_id?: string | null;
  verification_url?: string | null;
  custom_fields?: Record<string, string> | null;
  branding?: boolean;
  template?: {
    primary_color?: string;
    accent_color?: string;
    watermark_enabled?: boolean;
    watermark_opacity?: number;
    watermark_scale?: number;
  } | null;
};

const A4 = { width: 595.28, height: 841.89 };
const M = 42; // page margin

function hex(color: string | undefined, fallback: [number, number, number]) {
  const value = (color ?? "").replace("#", "");
  if (value.length !== 6) return rgb(fallback[0], fallback[1], fallback[2]);
  const n = Number.parseInt(value, 16);
  if (Number.isNaN(n)) return rgb(fallback[0], fallback[1], fallback[2]);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Latin-1 safe text (StandardFonts cannot encode arbitrary unicode). */
function safe(text: unknown): string {
  return (
    String(text ?? "")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014]/g, "-")
      .replace(/\u00A0/g, " ")
      // eslint-disable-next-line no-control-regex
      .replace(/[^\u0000-\u00FF]/g, "")
  );
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = safe(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function money(amount: number, currency: string) {
  return `${currency} ${(Number.isFinite(amount) ? amount : 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function dateLabel(value?: string | null) {
  if (!value) return "-";
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return safe(value);
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Rejects obvious SSRF targets before we ever fetch a customer-supplied
 * logo_url: non-http(s) schemes, loopback/link-local/private-range IP
 * literals (including the 169.254.169.254 cloud metadata address), and
 * localhost-ish hostnames. This is a literal-value check, not DNS-rebinding
 * protection — a public hostname that later resolves to a private IP isn't
 * caught here, since that needs runtime DNS control this edge runtime
 * doesn't expose via plain fetch().
 */
function isSafeImageUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;

  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  if (host === "metadata.google.internal") return false;

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 127) return false; // loopback
    if (a === 10) return false; // RFC1918
    if (a === 172 && b >= 16 && b <= 31) return false; // RFC1918
    if (a === 192 && b === 168) return false; // RFC1918
    if (a === 169 && b === 254) return false; // link-local, incl. cloud metadata
    if (a === 0) return false;
  }
  if (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd"))
    return false;

  return true;
}

async function fetchImage(pdf: PDFDocument, url?: string | null): Promise<PDFImage | null> {
  if (!url || !isSafeImageUrl(url)) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { signal: controller.signal, redirect: "error" }).finally(() =>
      clearTimeout(timeout),
    );
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const type = res.headers.get("content-type") ?? "";
    if (type.includes("png") || url.toLowerCase().endsWith(".png"))
      return await pdf.embedPng(bytes);
    return await pdf.embedJpg(bytes);
  } catch {
    return null;
  }
}

const TITLES: Record<InvoicePdfInput["kind"], string> = {
  invoice: "TAX INVOICE",
  quotation: "QUOTATION",
  credit_note: "CREDIT NOTE",
  proforma: "PROFORMA INVOICE",
};

export async function buildDocumentPdf(input: InvoicePdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${TITLES[input.kind]} ${input.doc_number}`);
  pdf.setProducer("Flas CRM");
  pdf.setCreator("Flas CRM");

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const primary = hex(input.template?.primary_color, [0.06, 0.32, 0.19]);
  const accent = hex(input.template?.accent_color, [0.09, 0.64, 0.29]);
  const ink = rgb(0.11, 0.13, 0.16);
  const muted = rgb(0.42, 0.45, 0.5);
  const hairline = rgb(0.88, 0.9, 0.92);

  const logo = await fetchImage(pdf, input.company.logo_url);
  const qr = input.verification_url ? qrModules(input.verification_url) : null;

  const contentWidth = A4.width - M * 2;
  const pages: PDFPage[] = [];

  const newPage = () => {
    const page = pdf.addPage([A4.width, A4.height]);
    pages.push(page);
    drawWatermark(page);
    return page;
  };

  function drawWatermark(page: PDFPage) {
    if (input.mode === "draft" || input.mode === "cancelled") {
      const label = input.mode === "draft" ? "DRAFT" : "CANCELLED";
      const size = input.mode === "draft" ? 110 : 84;
      const width = bold.widthOfTextAtSize(label, size);
      page.drawText(label, {
        x: A4.width / 2 - (width / 2) * 0.72,
        y: A4.height / 2 - 120,
        size,
        font: bold,
        color: rgb(0.85, 0.2, 0.2),
        opacity: 0.12,
        rotate: degrees(38),
      });
      return;
    }
    if (input.template?.watermark_enabled === false || !logo) return;
    const scale = Math.min(0.9, Math.max(0.2, input.template?.watermark_scale ?? 0.55));
    const targetWidth = A4.width * scale;
    const dims = logo.scale(targetWidth / logo.width);
    page.drawImage(logo, {
      x: (A4.width - dims.width) / 2,
      y: (A4.height - dims.height) / 2,
      width: dims.width,
      height: dims.height,
      opacity: Math.min(0.2, Math.max(0.01, input.template?.watermark_opacity ?? 0.06)),
    });
  }

  let page = newPage();
  let y = A4.height - M;

  // ---------- header ----------
  const companyName = safe(input.company.trade_name || input.company.legal_name || "Your Company");
  if (logo) {
    const dims = logo.scale(Math.min(64 / logo.height, 150 / logo.width));
    page.drawImage(logo, { x: M, y: y - dims.height, width: dims.width, height: dims.height });
    y -= dims.height + 10;
  }
  const headerTop = y;
  page.drawText(companyName, { x: M, y, size: 14, font: bold, color: primary });
  y -= 15;
  const companyLines = [
    input.company.legal_name && input.company.legal_name !== companyName
      ? input.company.legal_name
      : null,
    input.company.address,
    input.company.country,
    input.company.phone ? `Tel: ${input.company.phone}` : null,
    input.company.email,
    input.company.website,
    input.company.vat_number ? `TRN / VAT: ${input.company.vat_number}` : null,
    input.company.registration_number ? `Reg. No: ${input.company.registration_number}` : null,
  ].filter(Boolean) as string[];
  for (const line of companyLines) {
    for (const part of wrap(line, font, 8.5, contentWidth * 0.45)) {
      page.drawText(part, { x: M, y, size: 8.5, font, color: muted });
      y -= 11;
    }
  }

  // Document title + meta block, right aligned.
  const title = TITLES[input.kind];
  const titleSize = 22;
  const titleWidth = bold.widthOfTextAtSize(title, titleSize);
  page.drawText(title, {
    x: A4.width - M - titleWidth,
    y: headerTop - 4,
    size: titleSize,
    font: bold,
    color: primary,
  });

  let metaY = headerTop - 30;
  const meta: [string, string][] = [
    ["Number", input.doc_number],
    ["Date", dateLabel(input.issue_date)],
  ];
  if (input.kind === "quotation") meta.push(["Valid until", dateLabel(input.valid_until)]);
  else meta.push(["Due date", dateLabel(input.due_date)]);
  meta.push(["Currency", input.currency]);
  if (input.po_number) meta.push(["PO number", input.po_number]);
  if (input.reference) meta.push(["Reference", input.reference]);
  if (input.payment_terms) meta.push(["Terms", input.payment_terms]);
  meta.push(["Status", input.mode === "draft" ? "Draft" : safe(input.status).replace(/_/g, " ")]);

  for (const [label, value] of meta) {
    const text = safe(value);
    const valueWidth = font.widthOfTextAtSize(text, 9);
    page.drawText(`${label}`, { x: A4.width - M - 190, y: metaY, size: 8.5, font, color: muted });
    page.drawText(text, {
      x: A4.width - M - valueWidth,
      y: metaY,
      size: 9,
      font: bold,
      color: ink,
    });
    metaY -= 13;
  }

  y = Math.min(y, metaY) - 14;
  page.drawLine({
    start: { x: M, y },
    end: { x: A4.width - M, y },
    thickness: 1,
    color: hairline,
  });
  y -= 20;

  // ---------- bill to / ship to ----------
  const colW = (contentWidth - 20) / 2;
  const billTop = y;
  page.drawText("BILL TO", { x: M, y, size: 8, font: bold, color: accent });
  let by = y - 14;
  const billLines = [
    input.customer.name,
    input.customer.company,
    input.customer.address,
    input.customer.phone,
    input.customer.email,
    input.customer.vat_number ? `TRN / VAT: ${input.customer.vat_number}` : null,
  ].filter(Boolean) as string[];
  billLines.forEach((line, index) => {
    for (const part of wrap(line, index === 0 ? bold : font, index === 0 ? 10.5 : 9, colW)) {
      page.drawText(part, {
        x: M,
        y: by,
        size: index === 0 ? 10.5 : 9,
        font: index === 0 ? bold : font,
        color: index === 0 ? ink : muted,
      });
      by -= index === 0 ? 14 : 11.5;
    }
  });

  let sy = billTop;
  if (input.customer.shipping_address) {
    page.drawText("SHIP TO", { x: M + colW + 20, y: sy, size: 8, font: bold, color: accent });
    sy -= 14;
    for (const part of wrap(input.customer.shipping_address, font, 9, colW)) {
      page.drawText(part, { x: M + colW + 20, y: sy, size: 9, font, color: muted });
      sy -= 11.5;
    }
  }
  const customFields = Object.entries(input.custom_fields ?? {}).filter(([, v]) => v);
  if (customFields.length) {
    if (!input.customer.shipping_address) sy -= 0;
    for (const [key, value] of customFields) {
      page.drawText(`${safe(key)}: ${safe(value)}`, {
        x: M + colW + 20,
        y: sy,
        size: 9,
        font,
        color: muted,
      });
      sy -= 11.5;
    }
  }

  y = Math.min(by, sy) - 18;

  // ---------- item table ----------
  const cols = {
    desc: M,
    qty: M + contentWidth * 0.52,
    price: M + contentWidth * 0.64,
    disc: M + contentWidth * 0.76,
    tax: M + contentWidth * 0.85,
    total: A4.width - M,
  };

  const drawTableHeader = (atY: number) => {
    page.drawRectangle({
      x: M,
      y: atY - 4,
      width: contentWidth,
      height: 20,
      color: primary,
      opacity: 0.08,
    });
    page.drawText("DESCRIPTION", {
      x: cols.desc + 6,
      y: atY + 2,
      size: 8,
      font: bold,
      color: primary,
    });
    right("QTY", cols.price - 12, atY + 2, 8, bold, primary);
    right("RATE", cols.disc - 12, atY + 2, 8, bold, primary);
    right("DISC", cols.tax - 8, atY + 2, 8, bold, primary);
    right(safe(input.tax_label).toUpperCase(), cols.total - 78, atY + 2, 8, bold, primary);
    right("AMOUNT", cols.total - 6, atY + 2, 8, bold, primary);
    return atY - 12;
  };

  function right(text: string, x: number, atY: number, size: number, f: PDFFont, color = ink) {
    const t = safe(text);
    page.drawText(t, { x: x - f.widthOfTextAtSize(t, size), y: atY, size, font: f, color });
  }

  y = drawTableHeader(y);

  const BOTTOM_LIMIT = M + 96;
  for (const item of input.items) {
    const descLines = wrap(item.name, bold, 9.5, contentWidth * 0.5 - 8);
    const extra: string[] = [];
    if (item.description) extra.push(...wrap(item.description, font, 8.3, contentWidth * 0.5 - 8));
    const details = [
      item.sku ? `SKU ${item.sku}` : null,
      item.serial_number ? `S/N ${item.serial_number}` : null,
      item.warranty ? `Warranty: ${item.warranty}` : null,
      item.service_period ? `Period: ${item.service_period}` : null,
    ].filter(Boolean) as string[];
    if (details.length) extra.push(...wrap(details.join("  •  "), font, 8, contentWidth * 0.5 - 8));

    const rowHeight = Math.max(20, descLines.length * 12 + extra.length * 10 + 8);

    // Keep a line item whole: never split it across pages.
    if (y - rowHeight < BOTTOM_LIMIT) {
      page = newPage();
      y = A4.height - M;
      y = drawTableHeader(y);
    }

    let ly = y - 2;
    for (const line of descLines) {
      page.drawText(line, { x: cols.desc + 6, y: ly, size: 9.5, font: bold, color: ink });
      ly -= 12;
    }
    for (const line of extra) {
      page.drawText(line, { x: cols.desc + 6, y: ly, size: 8.3, font, color: muted });
      ly -= 10;
    }

    const qtyLabel = `${trimNumber(item.quantity)}${item.unit ? ` ${item.unit}` : ""}`;
    right(qtyLabel, cols.price - 12, y - 2, 9, font);
    right(
      money(item.unit_price, input.currency).replace(`${input.currency} `, ""),
      cols.disc - 12,
      y - 2,
      9,
      font,
    );
    right(
      item.discount_amount ? trimNumber(item.discount_amount) : "-",
      cols.tax - 8,
      y - 2,
      9,
      font,
    );
    right(item.tax_rate ? `${trimNumber(item.tax_rate)}%` : "-", cols.total - 78, y - 2, 9, font);
    right(
      money(item.line_total, input.currency).replace(`${input.currency} `, ""),
      cols.total - 6,
      y - 2,
      9.5,
      bold,
    );

    y -= rowHeight;
    page.drawLine({
      start: { x: M, y: y + 6 },
      end: { x: A4.width - M, y: y + 6 },
      thickness: 0.5,
      color: hairline,
    });
  }

  // ---------- totals ----------
  const totals: [string, string, boolean][] = [
    ["Subtotal", money(input.subtotal, input.currency), false],
  ];
  if (input.item_discount_total)
    totals.push(["Item discounts", `- ${money(input.item_discount_total, input.currency)}`, false]);
  if (input.invoice_discount)
    totals.push(["Invoice discount", `- ${money(input.invoice_discount, input.currency)}`, false]);
  totals.push([`Taxable amount`, money(input.taxable_amount, input.currency), false]);
  totals.push([safe(input.tax_label), money(input.tax_total, input.currency), false]);
  if (input.shipping) totals.push(["Shipping", money(input.shipping, input.currency), false]);
  if (input.additional_charges)
    totals.push(["Additional charges", money(input.additional_charges, input.currency), false]);
  if (input.adjustment) totals.push(["Adjustment", money(input.adjustment, input.currency), false]);
  totals.push(["Grand total", money(input.grand_total, input.currency), true]);
  if (input.kind !== "quotation") {
    totals.push(["Amount paid", money(input.paid_amount, input.currency), false]);
    totals.push(["Balance due", money(input.balance, input.currency), true]);
  }

  const totalsHeight = totals.length * 15 + 18;
  if (y - totalsHeight < BOTTOM_LIMIT) {
    page = newPage();
    y = A4.height - M;
  }

  const boxX = A4.width - M - 250;
  y -= 10;
  for (const [label, value, strong] of totals) {
    if (strong) {
      page.drawRectangle({
        x: boxX - 8,
        y: y - 4,
        width: 258,
        height: 18,
        color: primary,
        opacity: 0.09,
      });
    }
    page.drawText(safe(label), {
      x: boxX,
      y,
      size: strong ? 10 : 9,
      font: strong ? bold : font,
      color: strong ? primary : muted,
    });
    right(
      value,
      cols.total - 6,
      y,
      strong ? 11 : 9.5,
      strong ? bold : font,
      strong ? primary : ink,
    );
    y -= strong ? 19 : 15;
  }

  // ---------- bank, terms, signature ----------
  y -= 12;
  const blockTop = y;
  let leftY = y;
  if (input.bank?.bank_name) {
    page.drawText("PAYMENT DETAILS", { x: M, y: leftY, size: 8, font: bold, color: accent });
    leftY -= 13;
    const bankLines = [
      input.bank.bank_name,
      input.bank.account_name ? `Account: ${input.bank.account_name}` : null,
      input.bank.account_number ? `A/C No: ${input.bank.account_number}` : null,
      input.bank.iban ? `IBAN: ${input.bank.iban}` : null,
      input.bank.swift ? `SWIFT: ${input.bank.swift}` : null,
      input.bank.branch ? `Branch: ${input.bank.branch}` : null,
    ].filter(Boolean) as string[];
    for (const line of bankLines) {
      page.drawText(safe(line), { x: M, y: leftY, size: 8.5, font, color: muted });
      leftY -= 11;
    }
  }
  if (input.notes) {
    leftY -= 6;
    page.drawText("NOTES", { x: M, y: leftY, size: 8, font: bold, color: accent });
    leftY -= 12;
    for (const line of wrap(input.notes, font, 8.5, contentWidth * 0.55)) {
      page.drawText(line, { x: M, y: leftY, size: 8.5, font, color: muted });
      leftY -= 11;
    }
  }
  if (input.terms) {
    leftY -= 6;
    page.drawText("TERMS & CONDITIONS", { x: M, y: leftY, size: 8, font: bold, color: accent });
    leftY -= 12;
    for (const line of wrap(input.terms, font, 8, contentWidth * 0.55)) {
      page.drawText(line, { x: M, y: leftY, size: 8, font, color: muted });
      leftY -= 10;
    }
  }

  // Signature block, right side.
  let rightY = blockTop;
  if (input.company.signatory_name) {
    page.drawText("AUTHORISED SIGNATORY", {
      x: A4.width - M - 170,
      y: rightY,
      size: 8,
      font: bold,
      color: accent,
    });
    rightY -= 46;
    page.drawLine({
      start: { x: A4.width - M - 170, y: rightY + 8 },
      end: { x: A4.width - M, y: rightY + 8 },
      thickness: 0.6,
      color: hairline,
    });
    page.drawText(safe(input.company.signatory_name), {
      x: A4.width - M - 170,
      y: rightY - 4,
      size: 9.5,
      font: bold,
      color: ink,
    });
    if (input.company.signatory_position) {
      page.drawText(safe(input.company.signatory_position), {
        x: A4.width - M - 170,
        y: rightY - 16,
        size: 8.5,
        font,
        color: muted,
      });
    }
  }

  // ---------- footer on every page ----------
  const total = pages.length;
  pages.forEach((p, index) => {
    p.drawLine({
      start: { x: M, y: M + 46 },
      end: { x: A4.width - M, y: M + 46 },
      thickness: 0.5,
      color: hairline,
    });
    const footerLines = [
      [input.company.website, input.company.email, input.company.phone]
        .filter(Boolean)
        .join("  •  "),
      input.company.vat_number ? `TRN / VAT: ${input.company.vat_number}` : "",
      input.verification_id ? `Verification ID: ${input.verification_id}` : "",
    ].filter(Boolean) as string[];
    let fy = M + 34;
    for (const line of footerLines) {
      p.drawText(safe(line), { x: M, y: fy, size: 7.5, font, color: muted });
      fy -= 9.5;
    }
    if (input.branding !== false) {
      p.drawText("Generated securely by Flas CRM", { x: M, y: M + 4, size: 7, font, color: muted });
    }
    const pageLabel = `Page ${index + 1} of ${total}`;
    p.drawText(pageLabel, {
      x: A4.width - M - font.widthOfTextAtSize(pageLabel, 7.5),
      y: M + 4,
      size: 7.5,
      font,
      color: muted,
    });
    if (qr) drawQr(p, qr, A4.width - M - 56, M + 14, 52, ink);
  });

  return await pdf.save({ useObjectStreams: false });
}

function trimNumber(value: number) {
  const n = Number.isFinite(value) ? value : 0;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** QR is rendered as vector squares so it stays crisp at any print size. */
function qrModules(text: string): boolean[][] {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  const grid: boolean[][] = [];
  for (let row = 0; row < count; row += 1) {
    const line: boolean[] = [];
    for (let col = 0; col < count; col += 1) line.push(qr.isDark(row, col));
    grid.push(line);
  }
  return grid;
}

function drawQr(
  page: PDFPage,
  grid: boolean[][],
  x: number,
  y: number,
  size: number,
  color: ReturnType<typeof rgb>,
) {
  const count = grid.length;
  const cell = size / count;
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (!grid[row]![col]) continue;
      page.drawRectangle({
        x: x + col * cell,
        y: y + size - (row + 1) * cell,
        width: cell,
        height: cell,
        color,
      });
    }
  }
}
