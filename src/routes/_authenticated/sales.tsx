// Sales hub — create quotations and invoices, send them on WhatsApp, take
// payment and let Flas send the stamped PAID copy automatically.
import { PageHeader } from "@/components/PageHeader";
import { useTenant } from "@/hooks/useTenant";
import { todayInTimeZone } from "@/lib/locale";
import {
  documentChargeBlocker,
  invoiceLineBlocker,
  lineText,
  salesDraftBlocker,
} from "@/lib/form-validation";
import {
  InvoiceBuilder,
  emptyDocument,
  type BuilderState,
  previewTotals,
} from "@/components/sales/InvoiceBuilder";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  convertQuotationToInvoice,
  finalizeSalesDocument,
  getDocumentPdf,
  getSalesDocument,
  getSalesWorkspace,
  recordDocumentPayment,
  saveSalesDocument,
  sendDocumentOnWhatsApp,
} from "@/lib/billing.functions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";

import { toast } from "sonner";
import { useI18n } from "@/hooks/useI18n";
import { hasMessage, type MessageKey } from "@/lib/i18n";
import { AccountingExportDialog } from "@/components/sales/AccountingExportDialog";
import { type SyncInvoiceDoc, type SyncInvoiceItem } from "@/lib/accounting-sync";
import {
  AlertTriangle,
  ArrowRight,
  Download,
  FileText,
  Plus,
  Receipt,
  Send,
  Share2,
} from "lucide-react";
import { useRef, useState } from "react";
import { referenceFor, type SendReference } from "@/lib/send-reference";

/**
 * Why a document cannot be finalised yet, or null when it can.
 *
 * Finalising locks a sequential number and generates a PDF, so a document that
 * goes out with no customer, an empty line and a zero total burns a number on
 * something unsendable -- and in a numbered series that gap is permanent.
 * Saving a draft stays unrestricted; this only guards the irreversible step.
 */
function finaliseBlocker(state: BuilderState): string | null {
  const named = state.customer.name.trim() || state.customer.company.trim();
  if (!named) return "Add a customer name or company before finalising.";

  // `name` as well as `description`: the line-item field labelled "Description
  // shown on the PDF" writes `name`, and `description` is only ever set by
  // picking a catalogue product. Testing description alone made every
  // hand-typed invoice permanently unfinalisable, with the banner pointing at
  // a field the user had already filled in.
  const usable = state.items.filter((i) => lineText(i).length > 0 && Number(i.quantity) > 0);
  if (usable.length === 0) {
    return "Add at least one line with a description and a quantity above zero.";
  }

  const badLine = invoiceLineBlocker(state.items) ?? documentChargeBlocker(state);
  if (badLine) return badLine;

  if (previewTotals(state).grand <= 0) {
    return "The total is zero — check the prices before finalising.";
  }
  return null;
}

export const Route = createFileRoute("/_authenticated/sales")({
  head: () => ({
    meta: [
      { title: "Quotations & Invoices — Flas CRM" },
      {
        name: "description",
        content:
          "Build itemised quotations and invoices, send the PDF on WhatsApp, track payments and auto-send the PAID copy.",
      },
      { property: "og:title", content: "Quotations & Invoices — Flas CRM" },
      {
        property: "og:description",
        content: "Quote, invoice, get paid and deliver stamped PDFs straight over WhatsApp.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SalesPage,
});

type DocRow = {
  id: string;
  kind: string;
  doc_number: string;
  status: string;
  issue_date: string;
  currency: string;
  grand_total: number;
  paid_amount: number;
  balance: number;
  customer_snapshot: { name?: string; company?: string } | null;
  template_id?: string | null;
  custom_fields?: Record<string, string> | null;
  share_token: string | null;
  last_sent_at: string | null;
};

const STATUS_TONE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  partially_paid: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  paid: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  overdue: "bg-destructive/15 text-destructive",
  accepted: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  cancelled: "bg-muted text-muted-foreground",
};

function origin() {
  return typeof window === "undefined" ? "https://flas.mobidigisol.com" : window.location.origin;
}

function downloadBase64(base64: string, filename: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function SalesPage() {
  const { t, tr, tx } = useI18n();
  const qc = useQueryClient();
  // Issue dates are the tenant's calendar day. Computing them from UTC dated a
  // quotation raised on the 10th in Dubai as the 9th.
  const { tenant } = useTenant();
  const loadWorkspace = useServerFn(getSalesWorkspace);
  const loadDocument = useServerFn(getSalesDocument);
  const saveDoc = useServerFn(saveSalesDocument);
  const finalizeDoc = useServerFn(finalizeSalesDocument);
  const pdfDoc = useServerFn(getDocumentPdf);
  const sendWa = useServerFn(sendDocumentOnWhatsApp);
  const takePayment = useServerFn(recordDocumentPayment);
  const convertQuote = useServerFn(convertQuotationToInvoice);

  const [tab, setTab] = useState("all");
  const [builder, setBuilder] = useState<BuilderState | null>(null);
  const [payFor, setPayFor] = useState<DocRow | null>(null);
  const [payForm, setPayForm] = useState({ amount: "", reference: "", method: "bank_transfer" });
  const [sendFor, setSendFor] = useState<DocRow | null>(null);
  const [sendNote, setSendNote] = useState("");
  const [accountingTarget, setAccountingTarget] = useState<{
    doc: SyncInvoiceDoc;
    items: SyncInvoiceItem[];
  } | null>(null);
  // Why the last WhatsApp send did not go, shown in the dialog with the PDF as
  // the way to send it by hand.
  const [sendBlocks, setSendBlocks] = useState<{ code: string; message: string }[]>([]);
  // One reference per document message, kept until the server answers for it,
  // so a second click or a retry after a lost answer is the same message.
  const sendRef = useRef<SendReference | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["sales-workspace"],
    queryFn: () => loadWorkspace(),
  });

  const documents = (data?.documents ?? []) as unknown as DocRow[];
  const visible = documents.filter((doc) =>
    tab === "all"
      ? true
      : tab === "quotations"
        ? doc.kind === "quotation"
        : tab === "unpaid"
          ? doc.kind === "invoice" && Number(doc.balance) > 0
          : doc.kind === "invoice" && Number(doc.balance) <= 0,
  );

  const startNew = (kind: "quotation" | "invoice") => {
    const settings = data?.settings as
      | {
          default_currency?: string;
          default_tax_rate?: number;
          default_terms?: string | null;
          default_notes?: string | null;
          default_payment_terms?: string | null;
        }
      | undefined;
    const next = emptyDocument(
      settings?.default_currency ?? "AED",
      Number(settings?.default_tax_rate ?? 0),
      settings?.default_terms ?? "",
      tenant?.timezone ?? null,
      settings?.default_notes ?? "",
      settings?.default_payment_terms ?? "",
    );
    next.kind = kind;
    setBuilder(next);
  };

  const openAccountingSync = useMutation({
    mutationFn: (id: string) => loadDocument({ data: { id } }),
    onSuccess: (bundle) => {
      const doc = bundle.doc as unknown as Record<string, unknown>;
      const items = (bundle.items as unknown as Record<string, unknown>[]).map((it) => ({
        name: (it["name_snapshot"] as string) ?? "Item",
        description: (it["description_snapshot"] as string) ?? null,
        sku: (it["sku_snapshot"] as string) ?? null,
        quantity: Number(it["quantity"] ?? 1),
        unit: (it["unit"] as string) ?? null,
        unit_price: Number(it["unit_price"] ?? 0),
        discount_amount: Number(it["discount_amount"] ?? 0),
        tax_rate: Number(it["tax_rate"] ?? 0),
        tax_amount: Number(it["tax_amount"] ?? 0),
        line_total: Number(it["line_total"] ?? 0),
      }));
      const snapshot = (doc["customer_snapshot"] ?? {}) as Record<string, string | undefined>;
      setAccountingTarget({
        doc: {
          id: doc["id"] as string,
          doc_number: (doc["doc_number"] as string) ?? "INV-DRAFT",
          kind: (doc["kind"] as string) ?? "invoice",
          issue_date: (doc["issue_date"] as string) ?? "",
          due_date: (doc["due_date"] as string) ?? null,
          currency: (doc["currency"] as string) ?? "AED",
          tax_label: (doc["tax_label"] as string) ?? "VAT",
          subtotal: Number(doc["subtotal"] ?? 0),
          tax_total: Number(doc["tax_total"] ?? 0),
          grand_total: Number(doc["grand_total"] ?? 0),
          paid_amount: Number(doc["paid_amount"] ?? 0),
          balance: Number(doc["balance"] ?? 0),
          payment_terms: (doc["payment_terms"] as string) ?? null,
          reference: (doc["reference"] as string) ?? null,
          po_number: (doc["po_number"] as string) ?? null,
          notes: (doc["notes"] as string) ?? null,
          terms: (doc["terms"] as string) ?? null,
          customer_snapshot: {
            name: snapshot["name"] ?? null,
            company: snapshot["company"] ?? null,
            email: snapshot["email"] ?? null,
            phone: snapshot["phone"] ?? null,
            address: snapshot["address"] ?? null,
            vat_number: snapshot["vat_number"] ?? null,
          },
        },
        items,
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openExisting = useMutation({
    mutationFn: (id: string) => loadDocument({ data: { id } }),
    onSuccess: (bundle) => {
      const doc = bundle.doc as unknown as Record<string, unknown>;
      const snapshot = (doc["customer_snapshot"] ?? {}) as Record<string, string | undefined>;
      setBuilder({
        id: doc["id"] as string,
        kind: (doc["kind"] as "invoice") ?? "invoice",
        contact_id: (doc["contact_id"] as string) ?? null,
        template_id:
          (doc["template_id"] as string) ??
          ((doc["custom_fields"] as Record<string, string>)?.["template_id"] as string) ??
          "modern-emerald",
        customer: {
          name: snapshot["name"] ?? "",
          company: snapshot["company"] ?? "",
          email: snapshot["email"] ?? "",
          phone: snapshot["phone"] ?? "",
          address: snapshot["address"] ?? "",
          vat_number: snapshot["vat_number"] ?? "",
        },
        issue_date: (doc["issue_date"] as string) ?? todayInTimeZone(tenant?.timezone ?? null),
        due_date: (doc["due_date"] as string) ?? "",
        valid_until: (doc["valid_until"] as string) ?? "",
        currency: (doc["currency"] as string) ?? "AED",
        payment_terms: (doc["payment_terms"] as string) ?? "",
        reference: (doc["reference"] as string) ?? "",
        po_number: (doc["po_number"] as string) ?? "",
        invoice_discount: Number(doc["invoice_discount"] ?? 0),
        shipping: Number(doc["shipping"] ?? 0),
        additional_charges: Number(doc["additional_charges"] ?? 0),
        adjustment: Number(doc["adjustment"] ?? 0),
        notes: (doc["notes"] as string) ?? "",
        terms: (doc["terms"] as string) ?? "",
        items: (bundle.items as unknown as Record<string, unknown>[]).map((item) => ({
          product_id: (item["product_id"] as string) ?? null,
          name: item["name_snapshot"] as string,
          sku: (item["sku_snapshot"] as string) ?? null,
          description: (item["description_snapshot"] as string) ?? null,
          quantity: Number(item["quantity"]),
          unit: (item["unit"] as string) ?? null,
          unit_price: Number(item["unit_price"]),
          discount_value: Number(item["discount_value"] ?? 0),
          discount_type: (item["discount_type"] as "percent") ?? "percent",
          tax_rate: Number(item["tax_rate"] ?? 0),
        })),
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const payload = (state: BuilderState) => ({
    id: state.id,
    kind: state.kind,
    contact_id: state.contact_id,
    template_id: state.template_id || null,
    customer_snapshot: {
      name: state.customer.name || null,
      company: state.customer.company || null,
      email: state.customer.email || null,
      phone: state.customer.phone || null,
      address: state.customer.address || null,
      vat_number: state.customer.vat_number || null,
    },
    issue_date: state.issue_date,
    due_date: state.due_date || null,
    valid_until: state.valid_until || null,
    currency: state.currency,
    payment_terms: state.payment_terms || null,
    reference: state.reference || null,
    po_number: state.po_number || null,
    invoice_discount: state.invoice_discount || 0,
    shipping: state.shipping || 0,
    additional_charges: state.additional_charges || 0,
    adjustment: state.adjustment || 0,
    notes: state.notes || null,
    terms: state.terms || null,
    items: state.items.map((item) => ({
      product_id: item.product_id,
      name: item.name,
      sku: item.sku,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unit_price: item.unit_price,
      discount_value: item.discount_value,
      discount_type: item.discount_type,
      tax_rate: item.tax_rate,
    })),
  });

  const save = useMutation({
    mutationFn: async (finalize: boolean) => {
      if (!builder) return null;
      const result = await saveDoc({ data: payload(builder) });
      const id = (result as { id: string }).id;
      if (finalize) await finalizeDoc({ data: { id, origin: origin() } });
      return id;
    },
    onSuccess: (id, finalize) => {
      toast.success(finalize ? t("sales.documentFinalisedAndNumbered") : t("sales.draftSaved"));
      qc.invalidateQueries({ queryKey: ["sales-workspace"] });
      if (finalize) setBuilder(null);
      else if (id && builder) setBuilder({ ...builder, id });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const download = useMutation({
    mutationFn: (id: string) => pdfDoc({ data: { id, origin: origin() } }),
    onSuccess: (result) => downloadBase64(result.base64, result.filename),
    onError: (e: Error) => toast.error(e.message),
  });

  const send = useMutation({
    mutationFn: () => {
      sendRef.current = referenceFor(sendRef.current, `${sendFor!.id}\n${sendNote.trim()}`, () =>
        crypto.randomUUID(),
      );
      return sendWa({
        data: {
          id: sendFor!.id,
          origin: origin(),
          clientRef: sendRef.current.ref,
          ...(sendNote.trim() ? { note: sendNote.trim() } : {}),
        },
      });
    },
    onSuccess: (result) => {
      // The server has answered for this message; the next one is new.
      sendRef.current = null;
      qc.invalidateQueries({ queryKey: ["sales-workspace"] });
      if (result.state === "blocked") {
        // Nothing was sent. The dialog stays open with the reason and the PDF.
        setSendBlocks(result.blocks);
        return;
      }
      if (result.state === "accepted" || result.state === "duplicate") {
        toast.success(t("sales.sentOnWhatsappTo", { phone: result.phone ?? "" }));
      } else {
        // Refused, or never answered: said as such, never as "sent".
        toast.warning(
          t("sales.notSentOnWhatsappReason", {
            reason: tx(
              `inbox.sendFailure.${result.failureReason ?? "unknown"}`,
              result.deliveryError ?? "",
            ),
          }),
        );
      }
      setSendFor(null);
      setSendNote("");
      setSendBlocks([]);
    },
    // Kept for the retry: no answer is not a "no".
    onError: (e: Error) => toast.error(e.message),
  });

  const pay = useMutation({
    mutationFn: () =>
      takePayment({
        data: {
          documentId: payFor!.id,
          amount: Number(payForm.amount),
          method: payForm.method as "bank_transfer",
          origin: origin(),
          ...(payForm.reference.trim() ? { reference: payForm.reference.trim() } : {}),
        },
      }),
    onSuccess: (result) => {
      toast.success(
        result.receiptSent ? t("sales.paymentRecordedPaidCopySent") : t("sales.paymentRecorded"),
      );
      if (result.receiptNotSent) {
        const why = result.receiptNotSent.blocks.length
          ? result.receiptNotSent.blocks
              .map((b) => tx(`inbox.block.${b.code}`, b.message))
              .join(" ")
          : tx(`inbox.sendFailure.${result.receiptNotSent.reason ?? "unknown"}`, "");
        toast.warning(t("sales.paidCopyNotSentReason", { reason: why }));
      }
      setPayFor(null);
      setPayForm({ amount: "", reference: "", method: "bank_transfer" });
      qc.invalidateQueries({ queryKey: ["sales-workspace"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const convert = useMutation({
    mutationFn: (id: string) => convertQuote({ data: { id } }),
    onSuccess: () => {
      toast.success(t("sales.quotationConvertedToADraft"));
      qc.invalidateQueries({ queryKey: ["sales-workspace"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (builder) {
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader
          title={
            builder.id
              ? t(builder.kind === "quotation" ? "sales.editQuotation" : "sales.editInvoice")
              : t(builder.kind === "quotation" ? "sales.newQuotation" : "sales.newInvoice")
          }
          description={t("sales.addYourLinesSaveThe")}
          actions={
            <>
              <Button variant="ghost" onClick={() => setBuilder(null)}>
                {t("sales.back")}
              </Button>
              <Button
                variant="outline"
                disabled={save.isPending || salesDraftBlocker(builder) !== null}
                title={salesDraftBlocker(builder) ?? undefined}
                onClick={() => save.mutate(false)}
              >
                {t("sales.saveDraft")}
              </Button>
              <Button
                disabled={save.isPending || finaliseBlocker(builder) !== null}
                title={finaliseBlocker(builder) ?? undefined}
                onClick={() => save.mutate(true)}
              >
                {t("sales.finaliseNumber")}
              </Button>
            </>
          }
        />
        {finaliseBlocker(builder) && (
          <p className="mb-4 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            {tr("sales.youCanStillSaveIt", {
              strong: <strong className="text-foreground">{t("sales.notReadyToFinalise")}</strong>,
              finaliseBlocker: finaliseBlocker(builder),
            })}
          </p>
        )}
        <InvoiceBuilder
          state={builder}
          onChange={setBuilder}
          contacts={(data?.contacts ?? []) as never}
          products={(data?.products ?? []) as never}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={t("sales.quotationsInvoices")}
        description={t("sales.quoteACustomerTurnIt")}
        actions={
          <>
            <Button variant="outline" onClick={() => startNew("quotation")}>
              <Plus className="me-1 h-4 w-4" /> {t("sales.quotation")}
            </Button>
            <Button onClick={() => startNew("invoice")}>
              <Plus className="me-1 h-4 w-4" /> {t("sales.invoice")}
            </Button>
          </>
        }
      />

      <Tabs value={tab} onValueChange={setTab} className="mb-4">
        <TabsList>
          <TabsTrigger value="all">{t("sales.all")}</TabsTrigger>
          <TabsTrigger value="quotations">{t("sales.quotations")}</TabsTrigger>
          <TabsTrigger value="unpaid">{t("sales.unpaid")}</TabsTrigger>
          <TabsTrigger value="paid">{t("sales.paid")}</TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t("sales.loadingYourSalesDocuments")}</p>
      ) : visible.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Receipt className="h-4 w-4" /> {t("sales.nothingHereYet")}
            </CardTitle>
            <CardDescription>{t("sales.createYourFirstQuotationWhen")}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-3">
          {visible.map((doc) => (
            <Card key={doc.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="font-semibold">{doc.doc_number || t("sales.draft")}</span>
                    <Badge className={STATUS_TONE[doc.status] ?? "bg-muted"} variant="secondary">
                      {hasMessage(`sales.status.${doc.status}`)
                        ? t(`sales.status.${doc.status}` as MessageKey)
                        : doc.status.replace("_", " ")}
                    </Badge>
                    <span className="text-xs uppercase text-muted-foreground">
                      {doc.kind === "quotation" ? t("sales.quotation") : t("sales.invoice")}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    {doc.customer_snapshot?.name ?? t("sales.noCustomer")}
                    {doc.customer_snapshot?.company
                      ? ` · ${doc.customer_snapshot.company}`
                      : ""} · {doc.issue_date}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="me-2 text-end">
                    <div className="font-semibold">
                      {doc.currency} {Number(doc.grand_total).toFixed(2)}
                    </div>
                    {Number(doc.balance) > 0 && Number(doc.paid_amount) > 0 ? (
                      <div className="text-xs text-amber-600">
                        {tr("sales.balance", {
                          currency: doc.currency,
                          toFixed: Number(doc.balance).toFixed(2),
                        })}
                      </div>
                    ) : null}
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => openExisting.mutate(doc.id)}>
                    {t("sales.edit2")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={download.isPending}
                    onClick={() => download.mutate(doc.id)}
                  >
                    <Download className="me-1 h-4 w-4" /> PDF
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setSendFor(doc)}>
                    <Send className="me-1 h-4 w-4" /> WhatsApp
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={openAccountingSync.isPending}
                    onClick={() => openAccountingSync.mutate(doc.id)}
                    title={t("sales.accountingSyncTitle")}
                  >
                    <Share2 className="me-1 h-4 w-4" /> {t("sales.syncAccounting")}
                  </Button>
                  {doc.kind === "quotation" ? (
                    <Button size="sm" onClick={() => convert.mutate(doc.id)}>
                      <ArrowRight className="me-1 h-4 w-4" /> {t("sales.toInvoice")}
                    </Button>
                  ) : Number(doc.balance) > 0 ? (
                    <Button
                      size="sm"
                      onClick={() => {
                        setPayFor(doc);
                        setPayForm({
                          amount: String(Number(doc.balance).toFixed(2)),
                          reference: "",
                          method: "bank_transfer",
                        });
                      }}
                    >
                      {t("sales.markPaid")}
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={!!sendFor}
        onOpenChange={(open) => {
          if (open) return;
          setSendFor(null);
          setSendBlocks([]);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("sales.sendOnWhatsapp")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("sales.flasFinalisesTheDocumentIf")}</p>
          <div className="space-y-1.5">
            <Label>{t("sales.messageToAddOptional")}</Label>
            <Textarea
              rows={3}
              value={sendNote}
              placeholder={t("sales.hiAhmedHereIsThe")}
              onChange={(e) => setSendNote(e.target.value)}
            />
          </div>
          {sendBlocks.length > 0 && (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
            >
              <p className="flex items-center gap-1.5 font-semibold text-destructive">
                <AlertTriangle className="size-4 shrink-0" /> {t("sales.notSentOnWhatsapp")}
              </p>
              <ul className="mt-1 space-y-1 text-muted-foreground">
                {sendBlocks.map((b) => (
                  <li key={b.code}>{tx(`inbox.block.${b.code}`, b.message)}</li>
                ))}
              </ul>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                disabled={download.isPending}
                onClick={() => sendFor && download.mutate(sendFor.id)}
              >
                <Download className="size-4" /> {t("sales.downloadPdfToSendYourself")}
              </Button>
            </div>
          )}
          <Button disabled={send.isPending} onClick={() => send.mutate()}>
            {send.isPending ? t("sales.sending") : t("sales.sendNow")}
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog open={!!payFor} onOpenChange={(open) => !open && setPayFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("sales.recordPayment")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t("sales.amountReceived")}</Label>
              <Input
                type="number"
                step="0.01"
                value={payForm.amount}
                onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("sales.referenceOptional")}</Label>
              <Input
                value={payForm.reference}
                placeholder={t("sales.bankTransferRefReceiptNo")}
                onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })}
              />
            </div>
            <p className="text-xs text-muted-foreground">{t("sales.whenTheBalanceReachesZero")}</p>
            <Button disabled={pay.isPending || !payForm.amount} onClick={() => pay.mutate()}>
              {pay.isPending ? t("sales.saving") : t("sales.savePayment")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AccountingExportDialog
        open={!!accountingTarget}
        onOpenChange={(open) => !open && setAccountingTarget(null)}
        document={accountingTarget?.doc ?? null}
        items={accountingTarget?.items ?? []}
        companyName={tenant?.name}
      />
    </div>
  );
}
