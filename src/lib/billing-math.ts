/**
 * Decimal-safe money maths for the Flash billing engine.
 *
 * Every amount is converted to integer cents before arithmetic, so no invoice
 * total is ever produced by raw floating-point addition. The exact same module
 * runs in the browser (live preview) and on the server (authoritative
 * validation before anything is stored), which guarantees the preview a user
 * approves is the document that gets saved.
 */

export type DiscountType = "percent" | "fixed";

export type LineInput = {
  quantity: number;
  unit_price: number;
  discount_value?: number;
  discount_type?: DiscountType;
  tax_rate?: number;
};

export type LineTotals = {
  gross: number;
  discount_amount: number;
  net: number;
  tax_amount: number;
  line_total: number;
};

export type DocumentTotalsInput = {
  items: LineInput[];
  invoice_discount?: number;
  shipping?: number;
  additional_charges?: number;
  adjustment?: number;
  tax_inclusive?: boolean;
};

export type DocumentTotals = {
  lines: LineTotals[];
  subtotal: number;
  item_discount_total: number;
  invoice_discount: number;
  taxable_amount: number;
  tax_total: number;
  shipping: number;
  additional_charges: number;
  adjustment: number;
  grand_total: number;
};

const cents = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100);
const money = (c: number) => Math.round(c) / 100;

/** Rounds any user-supplied number to 2dp so stored values stay exact. */
export function round2(value: number): number {
  return money(cents(value));
}

export function computeDocumentTotals(input: DocumentTotalsInput): DocumentTotals {
  const inclusive = Boolean(input.tax_inclusive);

  // Pass 1 — per-line gross, item discount and net (all in cents).
  const raw = input.items.map((item) => {
    const qtyMilli = Math.round((Number.isFinite(item.quantity) ? item.quantity : 0) * 1000);
    const priceCents = cents(item.unit_price);
    const gross = Math.round((qtyMilli * priceCents) / 1000);
    const dv = Number.isFinite(item.discount_value) ? Number(item.discount_value) : 0;
    const discount =
      (item.discount_type ?? "percent") === "percent"
        ? Math.round((gross * Math.max(0, Math.min(100, dv))) / 100)
        : Math.min(gross, cents(dv));
    return {
      gross,
      discount,
      net: Math.max(0, gross - discount),
      rate: Math.max(0, Number.isFinite(item.tax_rate) ? Number(item.tax_rate) : 0),
    };
  });

  const subtotal = raw.reduce((sum, l) => sum + l.gross, 0);
  const itemDiscountTotal = raw.reduce((sum, l) => sum + l.discount, 0);
  const netSum = raw.reduce((sum, l) => sum + l.net, 0);

  // Invoice-level discount is spread proportionally so tax stays correct.
  const invoiceDiscount = Math.min(netSum, Math.max(0, cents(input.invoice_discount ?? 0)));
  const ratio = netSum > 0 ? invoiceDiscount / netSum : 0;

  // Spread the invoice discount in cents, giving the remainder to the last line
  // so the parts always add up to the discount the user typed.
  const shares = raw.map((l) => Math.round(l.net * ratio));
  const spread = shares.reduce((s, v) => s + v, 0);
  if (shares.length > 0) shares[shares.length - 1]! += invoiceDiscount - spread;

  const lines: LineTotals[] = [];
  let taxable = 0;
  let taxTotal = 0;

  raw.forEach((l, index) => {
    const adjustedNet = Math.max(0, l.net - Math.max(0, shares[index] ?? 0));

    const tax = inclusive
      ? adjustedNet - Math.round((adjustedNet * 10000) / (10000 + l.rate * 100))
      : Math.round((adjustedNet * l.rate) / 100);

    taxable += inclusive ? adjustedNet - tax : adjustedNet;
    taxTotal += tax;

    lines.push({
      gross: money(l.gross),
      discount_amount: money(l.discount),
      net: money(l.net),
      tax_amount: money(tax),
      line_total: money(l.net),
    });
  });


  const shipping = cents(input.shipping ?? 0);
  const charges = cents(input.additional_charges ?? 0);
  const adjustment = cents(input.adjustment ?? 0);
  const grand = taxable + taxTotal + shipping + charges + adjustment;

  return {
    lines,
    subtotal: money(subtotal),
    item_discount_total: money(itemDiscountTotal),
    invoice_discount: money(invoiceDiscount),
    taxable_amount: money(taxable),
    tax_total: money(taxTotal),
    shipping: money(shipping),
    additional_charges: money(charges),
    adjustment: money(adjustment),
    grand_total: money(grand),
  };
}

const CURRENCIES = ["AED", "USD", "EUR", "GBP", "SAR", "QAR", "OMR", "KWD", "BHD", "INR", "RWF", "PKR"] as const;
export const SUPPORTED_CURRENCIES: readonly string[] = CURRENCIES;

/** Business formatting: "AED 10,500.00". Currency is stored per document. */
export function formatMoney(amount: number, currency = "AED"): string {
  const value = (Number.isFinite(amount) ? amount : 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currency} ${value}`;
}

export const DOC_KIND_LABEL: Record<string, string> = {
  invoice: "Tax Invoice",
  quotation: "Quotation",
  credit_note: "Credit Note",
  proforma: "Proforma Invoice",
};

export const DOC_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Approval required",
  sent: "Sent",
  viewed: "Viewed",
  partially_paid: "Partially paid",
  paid: "Paid",
  overdue: "Overdue",
  cancelled: "Cancelled",
  refunded: "Refunded",
  accepted: "Accepted",
  rejected: "Rejected",
  expired: "Expired",
  converted: "Converted",
};
