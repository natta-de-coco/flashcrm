// Sales documents (quotations, invoices, credit notes) — everything the /sales
// screen calls. Money is always recomputed server-side in billing.server.ts.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ItemSchema = z.object({
  product_id: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(300),
  sku: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  quantity: z.number().min(0).max(1_000_000),
  unit: z.string().trim().max(40).nullable().optional(),
  unit_price: z.number().min(0).max(100_000_000),
  discount_value: z.number().min(0).max(100_000_000).optional(),
  discount_type: z.enum(["percent", "fixed"]).optional(),
  tax_rate: z.number().min(0).max(100).optional(),
  serial_number: z.string().trim().max(120).nullable().optional(),
  warranty: z.string().trim().max(200).nullable().optional(),
  service_period: z.string().trim().max(200).nullable().optional(),
});

const DocSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  kind: z.enum(["quotation", "invoice", "credit_note", "proforma"]),
  contact_id: z.string().uuid().nullable().optional(),
  customer_snapshot: z
    .object({
      name: z.string().trim().max(200).nullable().optional(),
      company: z.string().trim().max(200).nullable().optional(),
      email: z.string().trim().max(200).nullable().optional(),
      phone: z.string().trim().max(60).nullable().optional(),
      address: z.string().trim().max(500).nullable().optional(),
      vat_number: z.string().trim().max(80).nullable().optional(),
    })
    .nullable()
    .optional(),
  bank_account_id: z.string().uuid().nullable().optional(),
  quotation_id: z.string().uuid().nullable().optional(),
  issue_date: z.string().min(8).max(30),
  due_date: z.string().max(30).nullable().optional(),
  valid_until: z.string().max(30).nullable().optional(),
  currency: z.string().trim().min(2).max(6),
  payment_terms: z.string().trim().max(300).nullable().optional(),
  reference: z.string().trim().max(200).nullable().optional(),
  po_number: z.string().trim().max(120).nullable().optional(),
  invoice_discount: z.number().min(0).optional(),
  shipping: z.number().min(0).optional(),
  additional_charges: z.number().min(0).optional(),
  adjustment: z.number().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  terms: z.string().trim().max(6000).nullable().optional(),
  items: z.array(ItemSchema).min(1).max(200),
});

/** Everything the Sales hub needs on first paint. */
export const getSalesWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase;
    const { ensureBillingSettings, requireTenantId } = await import("@/lib/billing.server");
    const tenantId = await requireTenantId(supabase);
    const settings = await ensureBillingSettings(supabase, tenantId);

    const [docs, contacts, products, banks] = await Promise.all([
      supabase
        .from("sales_documents")
        .select(
          "id, kind, doc_number, status, issue_date, due_date, valid_until, currency, grand_total, paid_amount, balance, customer_snapshot, contact_id, finalized_at, share_token, last_sent_at, quotation_id",
        )
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("contacts")
        .select("id, name, phone, email, company")
        .order("created_at", { ascending: false })
        .limit(500),
      supabase.from("products").select("id, title, sku, price, description").limit(300),
      supabase.from("bank_accounts").select("id, bank_name, account_name, is_default").limit(20),
    ]);
    if (docs.error) throw docs.error;

    return {
      settings,
      documents: docs.data ?? [],
      contacts: contacts.data ?? [],
      products: products.data ?? [],
      banks: banks.data ?? [],
    };
  });

export const getSalesDocument = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { loadDocumentBundle } = await import("@/lib/billing.server");
    return loadDocumentBundle(context.supabase, data.id);
  });

/** Creates or updates a draft. Totals are recomputed from the raw item inputs. */
export const saveSalesDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DocSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { saveDraftDocument } = await import("@/lib/billing.server");
    // Raw Postgres text used to be toasted at the customer: saving a quotation
    // showed `column reference "period" is ambiguous`, from the document
    // numbering function (QA §5). The original is logged; the reader gets a
    // sentence that says whether anything was saved and what to do.
    try {
      return await saveDraftDocument(context.supabase, context.userId, data as never);
    } catch (error) {
      const { toPlainError } = await import("@/lib/plain-error");
      const plain = toPlainError(error, { action: "save this document" });
      // Only machine text is rewritten. billing.server.ts also throws sentences
      // written for this reader ("This document is finalized…") and replacing
      // one of those with a generic line would lose information.
      if (!plain.recognised) throw error;
      console.error("[billing] saveSalesDocument failed", plain.technical);
      throw new Error(plain.message);
    }
  });

/** Locks the document, mints its number, verification QR and public share link. */
export const finalizeSalesDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), origin: z.string().url().optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { finalizeDocument } = await import("@/lib/billing.server");
    const result = await finalizeDocument(context.supabase, context.userId, data.id, data.origin);
    const { data: doc } = await context.supabase
      .from("sales_documents")
      .select("share_token, doc_number, kind")
      .eq("id", data.id)
      .maybeSingle();
    return {
      ...result,
      share_token: doc?.share_token ?? null,
      doc_number: doc?.doc_number ?? null,
    };
  });

/** Returns the current PDF as base64 so the browser can preview or download it. */
export const getDocumentPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), origin: z.string().url().optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { renderDocumentPdf } = await import("@/lib/billing.server");
    const { bytes, doc } = await renderDocumentPdf(context.supabase, data.id, {
      baseUrl: data.origin,
    });
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return {
      base64: btoa(binary),
      filename: `${doc.kind}-${doc.doc_number}.pdf`,
    };
  });

/** Sends the document link over WhatsApp from the workspace's connected number. */
export const sendDocumentOnWhatsApp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        origin: z.string().url(),
        phone: z.string().trim().min(6).max(30).optional(),
        note: z.string().trim().max(600).optional(),
        waNumberId: z.string().uuid().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const { finalizeDocument, logActivity, requireTenantId } = await import("@/lib/billing.server");
    const tenantId = await requireTenantId(supabase);

    let { data: doc } = await supabase
      .from("sales_documents")
      .select(
        "id, kind, doc_number, status, grand_total, balance, currency, share_token, finalized_at, contact_id, customer_snapshot",
      )
      .eq("id", data.id)
      .maybeSingle();
    if (!doc) throw new Error("Document not found.");

    if (!doc.finalized_at) {
      await finalizeDocument(supabase, context.userId, data.id, data.origin);
      const fresh = await supabase
        .from("sales_documents")
        .select(
          "id, kind, doc_number, status, grand_total, balance, currency, share_token, finalized_at, contact_id, customer_snapshot",
        )
        .eq("id", data.id)
        .maybeSingle();
      doc = fresh.data ?? doc;
    }

    const snapshot = (doc.customer_snapshot ?? {}) as { phone?: string; name?: string };
    let phone = data.phone ?? snapshot.phone ?? null;
    if (!phone && doc.contact_id) {
      const { data: contact } = await supabase
        .from("contacts")
        .select("phone")
        .eq("id", doc.contact_id)
        .maybeSingle();
      phone = contact?.phone ?? null;
    }
    if (!phone) throw new Error("No WhatsApp number for this customer — add a phone number first.");

    const link = `${data.origin.replace(/\/$/, "")}/pay/${doc.share_token}`;
    const label =
      doc.kind === "quotation"
        ? "Quotation"
        : doc.kind === "credit_note"
          ? "Credit note"
          : "Invoice";
    const amount = `${doc.currency} ${Number(doc.balance || doc.grand_total).toFixed(2)}`;
    const body =
      (data.note ? `${data.note}\n\n` : "") +
      `${label} ${doc.doc_number}\nAmount: ${amount}\n\nView & download the PDF here:\n${link}`;

    const { sendWhatsAppText, resolveWaCredentials } = await import("@/lib/wa.server");
    const creds = await resolveWaCredentials(tenantId, data.waNumberId ?? null);
    await sendWhatsAppText(phone, body, creds);

    await supabase
      .from("sales_documents")
      .update({
        last_sent_at: new Date().toISOString(),
        status: doc.status === "draft" ? "sent" : doc.status,
      })
      .eq("id", data.id);
    await logActivity(supabase, tenantId, data.id, "sent_whatsapp", context.userId, {
      phone,
      link,
    });

    return { ok: true, link, phone };
  });

/** Records a payment, recomputes the balance and (when settled) sends the PAID copy. */
export const recordDocumentPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        documentId: z.string().uuid(),
        amount: z.number().positive().max(100_000_000),
        method: z
          .enum(["cash", "bank_transfer", "credit_card", "online", "cheque", "other"])
          .optional(),
        reference: z.string().trim().max(200).optional(),
        paid_at: z.string().max(40).optional(),
        notes: z.string().trim().max(1000).optional(),
        origin: z.string().url(),
        notifyCustomer: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const { logActivity, refreshPaymentState, requireTenantId } =
      await import("@/lib/billing.server");
    const tenantId = await requireTenantId(supabase);

    const { data: doc } = await supabase
      .from("sales_documents")
      .select(
        "id, tenant_id, currency, contact_id, kind, doc_number, share_token, customer_snapshot, balance, grand_total",
      )
      .eq("id", data.documentId)
      .maybeSingle();
    if (!doc || doc.tenant_id !== tenantId) throw new Error("Document not found.");

    // Never let a payment exceed what's actually owed — the schema had no
    // check beyond a flat $100M cap, so a typo or malicious client could push
    // a document's balance negative.
    const owed = Number(doc.balance ?? doc.grand_total ?? 0);
    if (data.amount > owed + 0.01) {
      throw new Error(
        `Payment of ${data.amount} exceeds the remaining balance of ${owed.toFixed(2)}.`,
      );
    }

    const method = (data.method ?? "bank_transfer") as
      "cash" | "bank_transfer" | "credit_card" | "online" | "cheque" | "other";

    const { data: payment, error: payError } = await supabase
      .from("payments")
      .insert({
        tenant_id: tenantId,
        contact_id: doc.contact_id,
        amount: data.amount,
        currency: doc.currency,
        method,
        reference: data.reference ?? null,
        notes: data.notes ?? null,
        paid_at: data.paid_at ?? new Date().toISOString(),
        recorded_by: context.userId,
      })
      .select("id")
      .single();
    if (payError) throw payError;

    const { error: allocError } = await supabase.from("payment_allocations").insert({
      tenant_id: tenantId,
      payment_id: payment.id,
      document_id: data.documentId,
      amount: data.amount,
    });
    if (allocError) throw allocError;

    const state = await refreshPaymentState(supabase, data.documentId);
    await logActivity(
      supabase,
      tenantId,
      data.documentId,
      "payment_recorded",
      context.userId,
      {
        amount: data.amount,
        method,
        status: state?.status,
      },
      payment.id,
    );

    // Fully settled → send the stamped PAID copy straight back to the customer.
    let receiptSent = false;
    if (state?.status === "paid" && data.notifyCustomer !== false) {
      try {
        const snapshot = (doc.customer_snapshot ?? {}) as { phone?: string };
        let phone = snapshot.phone ?? null;
        if (!phone && doc.contact_id) {
          const { data: contact } = await supabase
            .from("contacts")
            .select("phone")
            .eq("id", doc.contact_id)
            .maybeSingle();
          phone = contact?.phone ?? null;
        }
        if (phone) {
          const link = `${data.origin.replace(/\/$/, "")}/pay/${doc.share_token}`;
          const { sendWhatsAppText, resolveWaCredentials } = await import("@/lib/wa.server");
          const creds = await resolveWaCredentials(tenantId, null);
          await sendWhatsAppText(
            phone,
            `Payment received — thank you!\n\nInvoice ${doc.doc_number} is now marked PAID.\nDownload your paid copy here:\n${link}`,
            creds,
          );
          receiptSent = true;
          await logActivity(supabase, tenantId, data.documentId, "receipt_sent", context.userId, {
            phone,
          });
        }
      } catch (e) {
        console.error("[billing] paid receipt send failed", e);
      }
    }

    return { ...state, receiptSent };
  });

/** Turns an accepted quotation into a draft invoice with the same lines. */
export const convertQuotationToInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const { loadDocumentBundle, requireTenantId, saveDraftDocument, tenantToday } =
      await import("@/lib/billing.server");
    const { doc, items } = await loadDocumentBundle(supabase, data.id);
    if (doc.kind !== "quotation") throw new Error("Only quotations can be converted.");

    // The tenant's calendar day. Converting a quotation just after midnight
    // in Dubai was dating the new invoice the previous day.
    const today = await tenantToday(supabase, await requireTenantId(supabase));
    const result = await saveDraftDocument(supabase, context.userId, {
      kind: "invoice",
      contact_id: doc.contact_id,
      customer_snapshot: doc.customer_snapshot as never,
      bank_account_id: doc.bank_account_id,
      quotation_id: doc.id,
      issue_date: today,
      due_date: null,
      currency: doc.currency,
      payment_terms: doc.payment_terms,
      reference: `Quotation ${doc.doc_number}`,
      notes: doc.notes,
      terms: doc.terms,
      invoice_discount: Number(doc.invoice_discount),
      shipping: Number(doc.shipping),
      additional_charges: Number(doc.additional_charges),
      adjustment: Number(doc.adjustment),
      items: items.map((item: Record<string, unknown>) => ({
        product_id: (item["product_id"] as string) ?? null,
        name: item["name_snapshot"] as string,
        sku: (item["sku_snapshot"] as string) ?? null,
        description: (item["description_snapshot"] as string) ?? null,
        quantity: Number(item["quantity"]),
        unit: (item["unit"] as string) ?? null,
        unit_price: Number(item["unit_price"]),
        discount_value: Number(item["discount_value"] ?? 0),
        discount_type: (item["discount_type"] as "percent" | "fixed") ?? "percent",
        tax_rate: Number(item["tax_rate"] ?? 0),
      })),
    });

    await supabase.from("sales_documents").update({ status: "accepted" }).eq("id", data.id);
    return result;
  });

/** Company details, payment link and defaults used on every document. */
export const saveBillingProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        legal_name: z.string().trim().max(200).nullable().optional(),
        address: z.string().trim().max(500).nullable().optional(),
        phone: z.string().trim().max(60).nullable().optional(),
        email: z.string().trim().max(200).nullable().optional(),
        website: z.string().trim().max(200).nullable().optional(),
        vat_number: z.string().trim().max(80).nullable().optional(),
        default_currency: z.string().trim().min(2).max(6).optional(),
        default_tax_rate: z.number().min(0).max(100).optional(),
        default_payment_terms: z.string().trim().max(300).nullable().optional(),
        default_terms: z.string().trim().max(6000).nullable().optional(),
        online_payment_url: z.string().trim().max(500).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { ensureBillingSettings, requireTenantId } = await import("@/lib/billing.server");
    const tenantId = await requireTenantId(context.supabase);
    await ensureBillingSettings(context.supabase, tenantId);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) patch[key] = value;
    }
    const { error } = await context.supabase
      .from("billing_settings")
      .update(patch as never)
      .eq("tenant_id", tenantId);
    if (error) throw error;
    return { ok: true };
  });
