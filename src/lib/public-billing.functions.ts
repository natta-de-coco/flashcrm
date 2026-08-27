// Public, token-gated reads for the customer-facing invoice page. The share
// token is unguessable and only ever exposes the document it belongs to.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const TokenSchema = z.object({ token: z.string().trim().min(16).max(80) });

export type PublicDocument = {
  kind: string;
  doc_number: string;
  status: string;
  issue_date: string;
  due_date: string | null;
  valid_until: string | null;
  currency: string;
  grand_total: number;
  paid_amount: number;
  balance: number;
  notes: string | null;
  terms: string | null;
  company: Record<string, string | number | boolean | null>;
  customer: Record<string, string | number | boolean | null>;
  items: {
    name: string;
    description: string | null;
    quantity: number;
    unit_price: number;
    line_total: number;
  }[];
  bank: Record<string, string | number | boolean | null> | null;
  online_payment_url: string | null;
  verification_id: string | null;
};

export const getPublicDocument = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => TokenSchema.parse(input))
  .handler(async ({ data }): Promise<PublicDocument | null> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: doc } = await supabaseAdmin
      .from("sales_documents")
      .select("*")
      .eq("share_token", data.token)
      .maybeSingle();
    if (!doc || !doc.finalized_at) return null;

    const [{ data: items }, { data: settings }, { data: bank }] = await Promise.all([
      supabaseAdmin
        .from("sales_document_items")
        .select("name_snapshot, description_snapshot, quantity, unit_price, line_total")
        .eq("document_id", doc.id)
        .order("position"),
      supabaseAdmin
        .from("billing_settings")
        .select("online_payment_url")
        .eq("tenant_id", doc.tenant_id)
        .maybeSingle(),
      doc.bank_account_id
        ? supabaseAdmin
            .from("bank_accounts")
            .select("bank_name, account_name, account_number, iban, swift, branch")
            .eq("id", doc.bank_account_id)
            .maybeSingle()
        : supabaseAdmin
            .from("bank_accounts")
            .select("bank_name, account_name, account_number, iban, swift, branch")
            .eq("tenant_id", doc.tenant_id)
            .eq("is_default", true)
            .maybeSingle(),
    ]);

    await supabaseAdmin
      .from("sales_documents")
      .update({ viewed_at: new Date().toISOString() })
      .eq("id", doc.id)
      .is("viewed_at", null);

    return {
      kind: doc.kind,
      doc_number: doc.doc_number,
      status: doc.status,
      issue_date: doc.issue_date,
      due_date: doc.due_date,
      valid_until: doc.valid_until,
      currency: doc.currency,
      grand_total: Number(doc.grand_total),
      paid_amount: Number(doc.paid_amount),
      balance: Number(doc.balance),
      notes: doc.notes,
      terms: doc.terms,
      company: (doc.company_snapshot ?? {}) as Record<string, string | number | boolean | null>,
      customer: (doc.customer_snapshot ?? {}) as Record<string, string | number | boolean | null>,
      items: (items ?? []).map((item) => ({
        name: item.name_snapshot,
        description: item.description_snapshot,
        quantity: Number(item.quantity),
        unit_price: Number(item.unit_price),
        line_total: Number(item.line_total),
      })),
      bank: (bank ?? null) as Record<string, string | number | boolean | null> | null,
      online_payment_url:
        (settings as { online_payment_url?: string | null } | null)?.online_payment_url ?? null,
      verification_id: doc.verification_id,
    };
  });

/** Customer tells the seller "I paid" — logged for the seller to confirm. */
export const claimDocumentPayment = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    TokenSchema.extend({ reference: z.string().trim().max(200).optional() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: doc } = await supabaseAdmin
      .from("sales_documents")
      .select("id, tenant_id, doc_number")
      .eq("share_token", data.token)
      .maybeSingle();
    if (!doc) return { ok: false };

    await supabaseAdmin.from("document_activity").insert({
      tenant_id: doc.tenant_id,
      document_id: doc.id,
      event: "payment_claimed",
      actor_label: "customer",
      details: { reference: data.reference ?? null },
    });
    const { raiseAlert } = await import("@/lib/monitoring.server");
    await raiseAlert({
      title: `Customer says invoice ${doc.doc_number} is paid`,
      message: data.reference
        ? `Payment reference provided: ${data.reference}. Confirm it and record the payment in Sales.`
        : "Confirm the payment and record it in Sales to send the PAID copy automatically.",
      severity: "warning",
      source: "billing",
    });
    return { ok: true };
  });

/** QR verification lookup — proves a PDF matches the issued document. */
export const verifyDocument = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ token: z.string().trim().min(10).max(80) }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: doc } = await supabaseAdmin
      .from("sales_documents")
      .select(
        "kind, doc_number, status, issue_date, currency, grand_total, balance, verification_id, pdf_hash, company_snapshot, finalized_at",
      )
      .eq("verification_token", data.token)
      .maybeSingle();
    if (!doc || !doc.finalized_at) return null;
    return {
      kind: doc.kind,
      doc_number: doc.doc_number,
      status: doc.status,
      issue_date: doc.issue_date,
      currency: doc.currency,
      grand_total: Number(doc.grand_total),
      balance: Number(doc.balance),
      verification_id: doc.verification_id,
      pdf_hash: doc.pdf_hash,
      issuer:
        ((doc.company_snapshot ?? {}) as { legal_name?: string; trade_name?: string }).legal_name ??
        ((doc.company_snapshot ?? {}) as { trade_name?: string }).trade_name ??
        null,
    };
  });
