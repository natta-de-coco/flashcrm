/*
 * Pure "why can this not be saved yet" helpers, shared by the forms that use
 * them and asserted directly by tests.
 *
 * They live here rather than in the route files for the reason social-schema.ts
 * exists: a route module imports the whole UI tree and cannot be bundled for a
 * plain node test. These rules are the difference between a form that refuses
 * bad input and one that stores it, so they are worth testing on their own.
 *
 * Each returns a sentence to show the customer, or null when the form is
 * valid. One function per form, so the button state and the message on screen
 * can never disagree.
 */

export type ProductForm = {
  title: string;
  sku: string;
  price: string;
  description: string;
  image: string;
};

/**
 * `min="0"` on a number input is only a native hint, and a React-controlled
 * field never enforces it: typing -10 left Add product enabled and stored a
 * negative price, which then flows into quotes and invoices.
 */
export function productFormError(form: ProductForm): string | null {
  if (!form.title.trim()) return "Give the product a title.";
  if (form.price.trim()) {
    const price = Number(form.price);
    if (!Number.isFinite(price)) return "Price must be a number.";
    if (price < 0) return "Price cannot be negative.";
  }
  if (form.image.trim() && !/^https?:\/\//i.test(form.image.trim())) {
    return "Image URL must start with http:// or https://";
  }
  return null;
}

/**
 * A draft post needs something in it. Save draft was gated only on the request
 * being in flight, so pressing it on an untouched form stored an empty row that
 * listed as "Untitled post". Scheduling bypassed the same check entirely.
 */
export function contentDraftBlocker(form: { title: string; body: string }): string | null {
  if (!form.title.trim() && !form.body.trim()) {
    return "Add a title or body to save a draft.";
  }
  return null;
}

/**
 * Deliberately far weaker than finaliseBlocker: an unfinished quotation is a
 * legitimate thing to keep, and the UI says so. This only stops a document with
 * nothing in it at all, which was saveable and produced a blank 0.00 entry.
 */
export function salesDraftBlocker(state: {
  customer: { name: string; company: string };
  items: { name?: string | null; description?: string | null }[];
}): string | null {
  const named = state.customer.name.trim() || state.customer.company.trim();
  // Both fields, because the line-item input labelled "Description shown on the
  // PDF" writes `name`. `description` is only ever set by picking a catalogue
  // product, so testing it alone treats every hand-typed line as empty.
  const anyLine = state.items.some((i) => lineText(i).length > 0);
  if (!named && !anyLine) {
    return "Add a customer or a line item before saving a draft.";
  }
  return null;
}

/** The text a line actually shows on the document, from whichever field holds it. */
export function lineText(item: { name?: string | null; description?: string | null }): string {
  return ((item.name ?? "").trim() || (item.description ?? "").trim()).trim();
}

export type InvoiceLine = {
  name?: string | null;
  description?: string | null;
  quantity: number | string;
  unit_price: number | string;
  discount_value?: number | string;
  tax_rate?: number | string;
};

/**
 * Why a document cannot be finalised, looking only at its lines.
 *
 * The negative case is not cosmetic. lineTotals floors a line at 0 while
 * previewTotals accumulates the raw gross, so a quantity of -2 at 100 shows the
 * line as 0.00 and silently takes 200 off the grand total — a wrong number sent
 * to a customer, with nothing on screen to suggest it.
 */
export function invoiceLineBlocker(items: InvoiceLine[]): string | null {
  const num = (v: number | string | undefined) => Number(v ?? 0);
  for (const [index, item] of items.entries()) {
    const where = lineText(item) || `line ${index + 1}`;
    if (num(item.quantity) < 0) return `Quantity cannot be negative on ${where}.`;
    if (num(item.unit_price) < 0) return `Price cannot be negative on ${where}.`;
    if (num(item.discount_value) < 0) return `Discount cannot be negative on ${where}.`;
    if (num(item.tax_rate) < 0) return `Tax rate cannot be negative on ${where}.`;
    if (!Number.isFinite(num(item.quantity)) || !Number.isFinite(num(item.unit_price))) {
      return `${where} has a value that is not a number.`;
    }
  }
  return null;
}

/** Totals that must never be negative on a document. */
export function documentChargeBlocker(doc: {
  invoice_discount?: number | string;
  shipping?: number | string;
  additional_charges?: number | string;
}): string | null {
  const num = (v: number | string | undefined) => Number(v ?? 0);
  if (num(doc.invoice_discount) < 0) return "The invoice discount cannot be negative.";
  if (num(doc.shipping) < 0) return "Shipping cannot be negative.";
  if (num(doc.additional_charges) < 0) return "Other charges cannot be negative.";
  return null;
}

/** What the platform calls its two credential fields, and whether the id is optional. */
export type PlatformFields = {
  idLabel: string;
  tokenLabel: string;
  /** TikTok resolves the account from the token, so its id really is optional. */
  idOptional?: boolean | undefined;
};

/**
 * Save was gated on the display name alone, so an empty token saved an account
 * that appeared connected and failed on first sync, with nothing on screen
 * explaining why. The server enforces this too — see social-schema.ts — because
 * the endpoint is callable without the form.
 */
export function manualSocialFormError(
  form: { label: string; externalId: string; accessToken: string },
  meta: PlatformFields,
): string | null {
  if (form.label.trim().length < 2) return "Give this account a display name.";
  if (!form.accessToken.trim()) return `${meta.tokenLabel} is required.`;
  if (!meta.idOptional && !form.externalId.trim()) return `${meta.idLabel} is required.`;
  return null;
}
