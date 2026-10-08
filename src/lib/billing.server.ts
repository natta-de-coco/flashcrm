/**
 * Server-only billing engine.
 *
 * All money is recomputed here from raw item inputs before anything is stored,
 * so a manipulated browser payload can never dictate an invoice total. PDFs are
 * generated with pdf-lib, hashed, and stored in the private `invoices` bucket.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeDocumentTotals, round2 } from "./billing-math";
import { buildDocumentPdf, type InvoicePdfInput, type PdfItem } from "./invoice-pdf.server";

export type DocKind = "invoice" | "quotation" | "credit_note" | "proforma";

// Deliberately loose: this helper is called with both the RLS-scoped client
// and the admin client, whose generic parameters differ. Narrowing this to
// Record<string, unknown> does not describe either of them and cascades ~200
// type errors through every caller.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>;

export type ItemInput = {
  product_id?: string | null;
  name: string;
  sku?: string | null;
  description?: string | null;
  image?: string | null;
  quantity: number;
  unit?: string | null;
  unit_price: number;
  discount_value?: number;
  discount_type?: "percent" | "fixed";
  tax_rate?: number;
  serial_number?: string | null;
  warranty?: string | null;
  service_period?: string | null;
  notes?: string | null;
};

export async function requireTenantId(supabase: AnyClient): Promise<string> {
  const { data, error } = await supabase.rpc("current_tenant_id");
  if (error) throw new Error(`Could not load your workspace: ${error.message}`);
  if (!data) throw new Error("No workspace found for this account.");
  return data as string;
}

/** Reads workspace billing settings, creating sensible defaults on first use. */
export async function ensureBillingSettings(supabase: AnyClient, tenantId: string) {
  const { data } = await supabase
    .from("billing_settings")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (data) {
    const { data: profile } = await supabase
      .from("business_profiles")
      .select("tax_registration_number")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    return { ...data, tax_registration_number: profile?.tax_registration_number };
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", tenantId)
    .maybeSingle();
  const { data: profile } = await supabase
    .from("business_profiles")
    .select("business_name, city, country, contact_details, website_url, tax_registration_number")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const { data: created } = await supabase
    .from("billing_settings")
    .insert({
      tenant_id: tenantId,
      legal_name: profile?.business_name ?? org?.name ?? null,
      trade_name: profile?.business_name ?? org?.name ?? null,
      country: profile?.country ?? null,
      address: profile?.city ?? null,
      website: profile?.website_url ?? null,
    })
    .select("*")
    .maybeSingle();
  return created ? { ...created, tax_registration_number: profile?.tax_registration_number } : null;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped billing row shapes
   (settings, documents, bank, templates). Typing them properly means changing
   the invoice PDF pipeline, which is outside the social Batch 1 scope. Same
   convention as social.server.ts. */

/** Company snapshot frozen onto every document at finalization time. */
export function companySnapshot(
  settings: any,
  logoUrl?: string | null,
) {
  return {
    legal_name: settings?.legal_name ?? null,
    trade_name: settings?.trade_name ?? null,
    address: settings?.address ?? null,
    country: settings?.country ?? null,
    phone: settings?.phone ?? null,
    email: settings?.email ?? null,
    website: settings?.website ?? null,
    vat_number: settings?.vat_number ?? null,
    registration_number: settings?.registration_number ?? null,
    tax_registration_number: settings?.tax_registration_number ?? null,
    logo_url: logoUrl ?? settings?.logo_url ?? null,
    signatory_name: settings?.signatory_name ?? null,
    signatory_position: settings?.signatory_position ?? null,
  };
}

export type DocumentPayload = {
  id?: string | null;
  kind: DocKind;
  contact_id?: string | null;
  customer_snapshot?: Record<string, unknown> | null;
  template_id?: string | null;
  bank_account_id?: string | null;
  salesperson_id?: string | null;
  quotation_id?: string | null;
  original_invoice_id?: string | null;
  issue_date: string;
  due_date?: string | null;
  valid_until?: string | null;
  currency: string;
  payment_terms?: string | null;
  reference?: string | null;
  po_number?: string | null;
  tax_inclusive?: boolean;
  tax_label?: string;
  invoice_discount?: number;
  shipping?: number;
  additional_charges?: number;
  adjustment?: number;
  notes?: string | null;
  terms?: string | null;
  custom_fields?: Record<string, string>;
  items: ItemInput[];
};

/** Authoritative save for a draft document: recomputes every figure. */
export async function saveDraftDocument(
  supabase: AnyClient,
  userId: string,
  payload: DocumentPayload,
) {
  const tenantId = await requireTenantId(supabase);
  const settings = await ensureBillingSettings(supabase, tenantId);

  if (payload.id) {
    const { data: existing } = await supabase
      .from("sales_documents")
      .select("id, finalized_at, tenant_id")
      .eq("id", payload.id)
      .maybeSingle();
    if (!existing) throw new Error("Document not found.");
    if (existing.finalized_at) {
      throw new Error(
        "This document is finalized. Create a revision, credit note or cancellation instead.",
      );
    }
  }

  const totals = computeDocumentTotals({
    items: payload.items.map((item) => ({
      quantity: item.quantity,
      unit_price: item.unit_price,
      discount_value: item.discount_value ?? 0,
      discount_type: item.discount_type ?? "percent",
      tax_rate: settings?.tax_enabled === false ? 0 : (item.tax_rate ?? 0),
    })),
    invoice_discount: payload.invoice_discount ?? 0,
    shipping: payload.shipping ?? 0,
    additional_charges: payload.additional_charges ?? 0,
    adjustment: payload.adjustment ?? 0,
    tax_inclusive: payload.tax_inclusive ?? false,
  });

  const customerSnapshot =
    payload.customer_snapshot ?? (await buildCustomerSnapshot(supabase, payload.contact_id));

  const row = {
    tenant_id: tenantId,
    kind: payload.kind,
    contact_id: payload.contact_id ?? null,
    template_id: payload.template_id ?? null,
    bank_account_id: payload.bank_account_id ?? null,
    salesperson_id: payload.salesperson_id ?? userId,
    quotation_id: payload.quotation_id ?? null,
    original_invoice_id: payload.original_invoice_id ?? null,
    issue_date: payload.issue_date,
    due_date: payload.due_date ?? null,
    valid_until: payload.valid_until ?? null,
    currency: payload.currency,
    payment_terms: payload.payment_terms ?? null,
    reference: payload.reference ?? null,
    po_number: payload.po_number ?? null,
    tax_inclusive: Boolean(payload.tax_inclusive),
    tax_label: payload.tax_label ?? settings?.tax_label ?? "VAT",
    subtotal: totals.subtotal,
    item_discount_total: totals.item_discount_total,
    invoice_discount: totals.invoice_discount,
    taxable_amount: totals.taxable_amount,
    tax_total: totals.tax_total,
    shipping: totals.shipping,
    additional_charges: totals.additional_charges,
    adjustment: totals.adjustment,
    grand_total: totals.grand_total,
    balance: totals.grand_total,
    notes: payload.notes ?? null,
    terms: payload.terms ?? null,
    customer_snapshot: customerSnapshot,
    company_snapshot: companySnapshot(settings),
    custom_fields: payload.custom_fields ?? {},
    created_by: userId,
  };

  let documentId = payload.id ?? null;
  if (documentId) {
    const { error } = await supabase.from("sales_documents").update(row).eq("id", documentId);
    if (error) throw new Error(error.message);
  } else {
    const docNumber = await allocateNumber(tenantId, payload.kind);
    const { data, error } = await supabase
      .from("sales_documents")
      .insert({ ...row, doc_number: docNumber, status: "draft" })
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    documentId = data?.id as string;
    await logActivity(supabase, tenantId, documentId, "created", userId, { doc_number: docNumber });
  }

  // Items are rewritten wholesale; snapshots keep history immune to catalog
  // edits. Done atomically via one RPC — a separate delete() then insert()
  // could leave an invoice with zero items if anything failed in between.
  const rows = payload.items.map((item, index) => ({
    product_id: item.product_id ?? null,
    position: index,
    name_snapshot: item.name,
    sku_snapshot: item.sku ?? null,
    description_snapshot: item.description ?? null,
    image_snapshot: item.image ?? null,
    quantity: round2(item.quantity),
    unit: item.unit ?? "pcs",
    unit_price: round2(item.unit_price),
    discount_value: round2(item.discount_value ?? 0),
    discount_type: item.discount_type ?? "percent",
    discount_amount: totals.lines[index]?.discount_amount ?? 0,
    tax_rate: settings?.tax_enabled === false ? 0 : round2(item.tax_rate ?? 0),
    tax_amount: totals.lines[index]?.tax_amount ?? 0,
    line_total: totals.lines[index]?.line_total ?? 0,
    serial_number: item.serial_number ?? null,
    warranty: item.warranty ?? null,
    service_period: item.service_period ?? null,
    notes: item.notes ?? null,
  }));
  const { error: itemsError } = await supabase.rpc("replace_sales_document_items", {
    _document_id: documentId as string,
    _tenant_id: tenantId,
    _items: rows as never,
  });
  if (itemsError) throw new Error(itemsError.message);

  return { id: documentId as string, totals };
}

export async function buildCustomerSnapshot(supabase: AnyClient, contactId?: string | null) {
  if (!contactId) return {};
  const { data } = await supabase
    .from("contacts")
    .select("name, company, email, phone, notes")
    .eq("id", contactId)
    .maybeSingle();
  return {
    name: data?.name ?? null,
    company: data?.company ?? null,
    email: data?.email ?? null,
    phone: data?.phone ?? null,
    address: null,
    shipping_address: null,
    vat_number: null,
  };
}

/** Allocates a unique, gap-free number using the database sequence. */
export async function allocateNumber(tenantId: string, docType: string): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("next_document_number", {
    _tenant_id: tenantId,
    _doc_type: docType,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function logActivity(
  supabase: AnyClient,
  tenantId: string,
  documentId: string | null,
  event: string,
  actorId?: string | null,
  details: Record<string, unknown> = {},
  paymentId?: string | null,
) {
  await supabase.from("document_activity").insert({
    tenant_id: tenantId,
    document_id: documentId,
    payment_id: paymentId ?? null,
    event,
    actor_id: actorId ?? null,
    details,
  });
}

function token(bytes = 24) {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(data: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", data as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function loadDocumentBundle(supabase: AnyClient, documentId: string) {
  const [
    { data: doc },
    { data: items },
    { data: allocations },
    { data: activity },
    { data: files },
  ] = await Promise.all([
    supabase.from("sales_documents").select("*").eq("id", documentId).maybeSingle(),
    supabase
      .from("sales_document_items")
      .select("*")
      .eq("document_id", documentId)
      .order("position"),
    supabase
      .from("payment_allocations")
      .select(
        "id, amount, created_at, payments(id, receipt_number, amount, paid_at, method, reference, bank, notes, recorded_by)",
      )
      .eq("document_id", documentId),
    supabase
      .from("document_activity")
      .select("id, event, actor_label, details, created_at")
      .eq("document_id", documentId)
      .order("created_at", { ascending: false })
      .limit(80),
    supabase
      .from("document_files")
      .select("id, kind, storage_path, file_hash, version, created_at")
      .eq("document_id", documentId)
      .order("created_at", { ascending: false }),
  ]);
  if (!doc) throw new Error("Document not found.");
  return {
    doc,
    items: items ?? [],
    allocations: allocations ?? [],
    activity: activity ?? [],
    files: files ?? [],
  };
}

function toPdfInput(
  doc: any,
  items: any[],
  settings: any,
  bank: any,
  template: any,
  mode: "draft" | "final" | "cancelled",
  verificationUrl: string | null,
): InvoicePdfInput {
  const company = doc.company_snapshot ?? {};
  const customer = doc.customer_snapshot ?? {};
  const pdfItems: PdfItem[] = items.map((item) => ({
    name: item.name_snapshot,
    description: item.description_snapshot,
    sku: item.sku_snapshot,
    quantity: Number(item.quantity),
    unit: item.unit,
    unit_price: Number(item.unit_price),
    discount_amount: Number(item.discount_amount),
    tax_rate: Number(item.tax_rate),
    tax_amount: Number(item.tax_amount),
    line_total: Number(item.line_total),
    serial_number: item.serial_number,
    warranty: item.warranty,
    service_period: item.service_period,
  }));

  return {
    kind: doc.kind,
    mode,
    doc_number: doc.doc_number,
    status: doc.status,
    issue_date: doc.issue_date,
    due_date: doc.due_date,
    valid_until: doc.valid_until,
    currency: doc.currency,
    tax_label: doc.tax_label ?? "VAT",
    reference: doc.reference,
    po_number: doc.po_number,
    payment_terms: doc.payment_terms,
    subtotal: Number(doc.subtotal),
    item_discount_total: Number(doc.item_discount_total),
    invoice_discount: Number(doc.invoice_discount),
    taxable_amount: Number(doc.taxable_amount),
    tax_total: Number(doc.tax_total),
    shipping: Number(doc.shipping),
    additional_charges: Number(doc.additional_charges),
    adjustment: Number(doc.adjustment),
    grand_total: Number(doc.grand_total),
    paid_amount: Number(doc.paid_amount),
    balance: Number(doc.balance),
    notes: doc.notes,
    terms: doc.terms,
    items: pdfItems,
    company: {
      legal_name: company.legal_name ?? settings?.legal_name,
      trade_name: company.trade_name ?? settings?.trade_name,
      address: company.address ?? settings?.address,
      country: company.country ?? settings?.country,
      phone: company.phone ?? settings?.phone,
      email: company.email ?? settings?.email,
      website: company.website ?? settings?.website,
      vat_number: company.vat_number ?? settings?.vat_number,
      registration_number: company.registration_number ?? settings?.registration_number,
      tax_registration_number: company.tax_registration_number ?? settings?.tax_registration_number,
      logo_url: company.logo_url ?? settings?.logo_url,
      signatory_name: company.signatory_name ?? settings?.signatory_name,
      signatory_position: company.signatory_position ?? settings?.signatory_position,
    },
    customer: {
      name: customer.name,
      company: customer.company,
      address: customer.address,
      shipping_address: customer.shipping_address,
      email: customer.email,
      phone: customer.phone,
      vat_number: customer.vat_number,
    },
    bank: bank
      ? {
          bank_name: bank.bank_name,
          account_name: bank.account_name,
          account_number: bank.account_number,
          iban: bank.iban,
          swift: bank.swift,
          branch: bank.branch,
        }
      : null,
    verification_id: doc.verification_id,
    verification_url: verificationUrl,
    custom_fields: (doc.custom_fields ?? {}) as Record<string, string>,
    branding: settings?.show_flash_branding !== false,
    template: {
      primary_color: template?.primary_color,
      accent_color: template?.accent_color,
      watermark_enabled: settings?.watermark_enabled !== false,
      watermark_opacity: Number(settings?.watermark_opacity ?? 0.06),
      watermark_scale: Number(settings?.watermark_scale ?? 0.55),
    },
  };
}

export async function renderDocumentPdf(
  supabase: AnyClient,
  documentId: string,
  opts: { forceDraft?: boolean; baseUrl?: string | undefined } = {},
) {
  const { doc, items } = await loadDocumentBundle(supabase, documentId);
  const settings = await ensureBillingSettings(supabase, doc.tenant_id);
  const [{ data: bank }, { data: template }] = await Promise.all([
    doc.bank_account_id
      ? supabase.from("bank_accounts").select("*").eq("id", doc.bank_account_id).maybeSingle()
      : supabase
          .from("bank_accounts")
          .select("*")
          .eq("tenant_id", doc.tenant_id)
          .eq("is_default", true)
          .maybeSingle(),
    doc.template_id
      ? supabase.from("invoice_templates").select("*").eq("id", doc.template_id).maybeSingle()
      : supabase
          .from("invoice_templates")
          .select("*")
          .eq("tenant_id", doc.tenant_id)
          .eq("is_default", true)
          .maybeSingle(),
  ]);

  const mode: "draft" | "final" | "cancelled" =
    doc.status === "cancelled"
      ? "cancelled"
      : !doc.finalized_at || opts.forceDraft
        ? "draft"
        : "final";

  const verificationUrl =
    doc.verification_token && settings?.show_qr_verification !== false
      ? `${opts.baseUrl ?? "https://flas.mobidigisol.com"}/verify/${doc.verification_token}`
      : null;

  const bytes = await buildDocumentPdf(
    toPdfInput(doc, items, settings, bank, template, mode, verificationUrl),
  );
  return { bytes, doc, hash: await sha256(bytes) };
}

/** Locks financial values, mints verification data and stores the final PDF. */
export async function finalizeDocument(
  supabase: AnyClient,
  userId: string,
  documentId: string,
  baseUrl?: string,
) {
  const tenantId = await requireTenantId(supabase);
  const { doc, items } = await loadDocumentBundle(supabase, documentId);
  if (doc.tenant_id !== tenantId) throw new Error("Document not found.");
  if (doc.finalized_at) throw new Error("This document is already finalized.");
  if (!items.length) throw new Error("Add at least one line item before finalizing.");
  const customerName = doc.customer_snapshot?.name;
  if (!doc.contact_id && typeof customerName !== "string") {
    throw new Error("Select a customer before finalizing.");
  }

  const settings = await ensureBillingSettings(supabase, tenantId);
  const verificationId = `FL-${doc.kind === "invoice" ? "INV" : doc.kind === "quotation" ? "QUO" : "DOC"}-${doc.doc_number}`;

  const { error: lockError } = await supabase
    .from("sales_documents")
    .update({
      finalized_at: new Date().toISOString(),
      finalized_by: userId,
      status: doc.kind === "quotation" ? "sent" : "sent",
      verification_id: verificationId,
      verification_token: doc.verification_token ?? token(20),
      share_token: doc.share_token ?? token(24),
      company_snapshot: companySnapshot(
        settings,
        doc.company_snapshot?.logo_url,
      ),
    })
    .eq("id", documentId);
  if (lockError) throw new Error(lockError.message);

  const { bytes, hash, doc: fresh } = await renderDocumentPdf(supabase, documentId, { baseUrl });
  const path = storagePath(tenantId, fresh);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.storage
    .from("invoices")
    .upload(path, bytes as unknown as Uint8Array, { contentType: "application/pdf", upsert: true });

  await supabase.from("sales_documents").update({ pdf_hash: hash }).eq("id", documentId);
  await supabase.from("document_files").insert({
    tenant_id: tenantId,
    document_id: documentId,
    kind: `${fresh.kind}_pdf`,
    storage_path: path,
    file_hash: hash,
    version: fresh.version,
    byte_size: bytes.byteLength,
    created_by: userId,
  });
  await supabase.from("document_versions").insert({
    tenant_id: tenantId,
    document_id: documentId,
    version: fresh.version,
    snapshot: { document: fresh, items },
    pdf_hash: hash,
    finalized_at: new Date().toISOString(),
    finalized_by: userId,
  });
  await logActivity(supabase, tenantId, documentId, "finalized", userId, {
    verification_id: verificationId,
    pdf_hash: hash,
  });

  return { id: documentId, verification_id: verificationId, pdf_hash: hash, storage_path: path };
}

export function storagePath(tenantId: string, doc: any) {
  const date = new Date((doc.issue_date as string | number | Date | undefined) ?? Date.now());
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${tenantId}/${doc.kind}s/${year}/${month}/${doc.doc_number}-v${doc.version}.pdf`;
}

/**
 * True when `dateStr` (a plain YYYY-MM-DD date, e.g. a due_date) is strictly
 * before "today" as measured in the tenant's own timezone — not the
 * server's. A prior version compared against `new Date().toDateString()`,
 * which is the server's local date; on a UTC-hosted server that flips an
 * invoice to "overdue" several hours early or late for every tenant not
 * also in UTC.
 */
async function isPastInTenantTimezone(
  supabase: AnyClient,
  tenantId: string,
  dateStr: string,
): Promise<boolean> {
  let timeZone = "UTC";
  try {
    const { data: org } = await supabase
      .from("organizations")
      .select("timezone")
      .eq("id", tenantId)
      .maybeSingle();
    if (org?.timezone) timeZone = org.timezone;
  } catch {
    // fall back to UTC
  }
  let todayInTz: string;
  try {
    todayInTz = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    todayInTz = new Date().toISOString().slice(0, 10);
  }
  // Both are YYYY-MM-DD — lexicographic comparison is correct for ISO dates.
  return dateStr.slice(0, 10) < todayInTz;
}

/** Recomputes paid/balance/status from the payment ledger — never overwritten blindly. */
export async function refreshPaymentState(supabase: AnyClient, documentId: string) {
  const { data: doc } = await supabase
    .from("sales_documents")
    .select("id, tenant_id, grand_total, due_date, status, kind, finalized_at")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc) return null;
  const { data: allocations } = await supabase
    .from("payment_allocations")
    .select("amount")
    .eq("document_id", documentId);
  const paid = round2(
    (allocations ?? []).reduce(
      (sum, a: { amount: number | string | null | undefined }) => sum + Number(a.amount),
      0,
    ),
  );
  const total = Number(doc.grand_total);
  const balance = round2(total - paid);

  let status = doc.status as string;
  if (status !== "cancelled" && status !== "refunded") {
    if (paid <= 0) {
      const overdue = doc.due_date
        ? await isPastInTenantTimezone(supabase, doc.tenant_id, doc.due_date)
        : false;
      status = overdue && doc.finalized_at ? "overdue" : status === "draft" ? "draft" : status;
    } else if (balance > 0) {
      status = "partially_paid";
    } else {
      status = "paid";
    }
  }

  await supabase
    .from("sales_documents")
    .update({ paid_amount: paid, balance, status })
    .eq("id", documentId);
  return { paid, balance, status };
}
