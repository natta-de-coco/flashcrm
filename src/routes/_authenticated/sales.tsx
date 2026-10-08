// Sales hub — create quotations and invoices, send them on WhatsApp, take
// payment and let Flas send the stamped PAID copy automatically.
import { PageHeader } from "@/components/PageHeader";
import { useTenant } from "@/hooks/useTenant";
import { todayInTimeZone } from "@/lib/locale";
import {
  InvoiceBuilder,
  emptyDocument,
  type BuilderState, previewTotals } from "@/components/sales/InvoiceBuilder";
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
import { ArrowRight, Download, FileText, KanbanSquare, LayoutList, Plus, Receipt, Send } from "lucide-react";
import { SalesPipelineBoard } from "@/components/sales/SalesPipelineBoard";
import { isSubscriptionReceipt } from "@/lib/sales-pipeline";
import { useState } from "react";
import { toast } from "sonner";

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

  const usable = state.items.filter(
    (i) => (i.description ?? "").trim().length > 0 && Number(i.quantity) > 0,
  );
  if (usable.length === 0) {
    return "Add at least one line with a description and a quantity above zero.";
  }

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
  const [viewMode, setViewMode] = useState<"board" | "list">("board");
  const [builder, setBuilder] = useState<BuilderState | null>(null);
  const [payFor, setPayFor] = useState<DocRow | null>(null);
  const [payForm, setPayForm] = useState({ amount: "", reference: "", method: "bank_transfer" });
  const [sendFor, setSendFor] = useState<DocRow | null>(null);
  const [sendNote, setSendNote] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["sales-workspace"],
    queryFn: () => loadWorkspace(),
  });

  const documents = (data?.documents ?? []) as unknown as DocRow[];
  // Internal SaaS billing receipts (Stripe) must never appear in the customer sales view.
  const customerDocs = documents.filter((doc) => !isSubscriptionReceipt(doc as { custom_fields?: Record<string, unknown> | null }));
  const visible = customerDocs.filter((doc) =>
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
      | { default_currency?: string; default_tax_rate?: number; default_terms?: string | null }
      | undefined;
    const next = emptyDocument(
      settings?.default_currency ?? "AED",
      Number(settings?.default_tax_rate ?? 0),
      settings?.default_terms ?? "",
      tenant?.timezone ?? null,
    );
    next.kind = kind;
    setBuilder(next);
  };

  const openExisting = useMutation({
    mutationFn: (id: string) => loadDocument({ data: { id } }),
    onSuccess: (bundle) => {
      const doc = bundle.doc as unknown as Record<string, unknown>;
      const snapshot = (doc["customer_snapshot"] ?? {}) as Record<string, string | undefined>;
      setBuilder({
        id: doc["id"] as string,
        kind: (doc["kind"] as "invoice") ?? "invoice",
        contact_id: (doc["contact_id"] as string) ?? null,
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
      toast.success(finalize ? "Document finalised and numbered." : "Draft saved.");
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
    mutationFn: () =>
      sendWa({
        data: {
          id: sendFor!.id,
          origin: origin(),
          ...(sendNote.trim() ? { note: sendNote.trim() } : {}),
        },
      }),
    onSuccess: (result) => {
      toast.success(`Sent on WhatsApp to ${result.phone}`);
      setSendFor(null);
      setSendNote("");
      qc.invalidateQueries({ queryKey: ["sales-workspace"] });
    },
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
        result.receiptSent ? "Payment recorded — PAID copy sent on WhatsApp." : "Payment recorded.",
      );
      setPayFor(null);
      setPayForm({ amount: "", reference: "", method: "bank_transfer" });
      qc.invalidateQueries({ queryKey: ["sales-workspace"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const convert = useMutation({
    mutationFn: (id: string) => convertQuote({ data: { id } }),
    onSuccess: () => {
      toast.success("Quotation converted to a draft invoice.");
      qc.invalidateQueries({ queryKey: ["sales-workspace"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (builder) {
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader
          title={builder.id ? `Edit ${builder.kind}` : `New ${builder.kind}`}
          description="Add your lines, save the draft, then finalise to lock the number and generate the PDF."
          actions={
            <>
              <Button variant="ghost" onClick={() => setBuilder(null)}>
                Back
              </Button>
              <Button
                variant="outline"
                disabled={save.isPending}
                onClick={() => save.mutate(false)}
              >
                Save draft
              </Button>
              <Button
                disabled={save.isPending || finaliseBlocker(builder) !== null}
                title={finaliseBlocker(builder) ?? undefined}
                onClick={() => save.mutate(true)}
              >
                Finalise &amp; number
              </Button>
            </>
          }
        />
        {finaliseBlocker(builder) && (
          <p className="mb-4 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            <strong className="text-foreground">Not ready to finalise:</strong>{" "}
            {finaliseBlocker(builder)} You can still save it as a draft.
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
        title="Quotations & Invoices"
        description="Quote a customer, turn it into an invoice, send the PDF on WhatsApp and let Flas deliver the stamped PAID copy the moment payment lands."
        actions={
          <>
            <Button variant="outline" onClick={() => startNew("quotation")}>
              <Plus className="mr-1 h-4 w-4" /> Quotation
            </Button>
            <Button onClick={() => startNew("invoice")}>
              <Plus className="mr-1 h-4 w-4" /> Invoice
            </Button>
          </>
        }
      />

      {/* Toolbar: view toggle + list-mode filters */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {/* Board / List toggle */}
        <div className="flex rounded-lg border p-0.5">
          <Button
            variant={viewMode === "board" ? "default" : "ghost"}
            size="sm"
            className="h-7 gap-1.5 px-2.5 text-xs"
            onClick={() => setViewMode("board")}
          >
            <KanbanSquare className="h-3.5 w-3.5" /> Board
          </Button>
          <Button
            variant={viewMode === "list" ? "default" : "ghost"}
            size="sm"
            className="h-7 gap-1.5 px-2.5 text-xs"
            onClick={() => setViewMode("list")}
          >
            <LayoutList className="h-3.5 w-3.5" /> List
          </Button>
        </div>

        {/* Filters — only shown in list mode */}
        {viewMode === "list" && (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="quotations">Quotations</TabsTrigger>
              <TabsTrigger value="unpaid">Unpaid</TabsTrigger>
              <TabsTrigger value="paid">Paid</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading your sales documents…</p>
      ) : viewMode === "board" ? (
        customerDocs.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Receipt className="h-4 w-4" /> Nothing here yet
              </CardTitle>
              <CardDescription>
                Create your first quotation — when the customer accepts, one click turns it into an
                invoice with the same lines.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <SalesPipelineBoard
            documents={customerDocs}
            currency={
              (data?.settings as { default_currency?: string } | undefined)?.default_currency ??
              "AED"
            }
            onOpenExisting={(id) => openExisting.mutate(id)}
            onSendWhatsApp={(doc) => setSendFor(doc)}
            onConvertQuotation={(id) => convert.mutate(id)}
            onRecordPayment={(doc) => {
              setPayFor(doc);
              setPayForm({
                amount: String(Number(doc.balance).toFixed(2)),
                reference: "",
                method: "bank_transfer",
              });
            }}
            onDownloadPdf={(id) => download.mutate(id)}
          />
        )
      ) : visible.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Receipt className="h-4 w-4" /> Nothing here yet
            </CardTitle>
            <CardDescription>
              Create your first quotation — when the customer accepts, one click turns it into an
              invoice with the same lines.
            </CardDescription>
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
                    <span className="font-semibold">{doc.doc_number || "Draft"}</span>
                    <Badge className={STATUS_TONE[doc.status] ?? "bg-muted"} variant="secondary">
                      {doc.status.replace("_", " ")}
                    </Badge>
                    <span className="text-xs uppercase text-muted-foreground">{doc.kind}</span>
                  </div>
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    {doc.customer_snapshot?.name ?? "No customer"}
                    {doc.customer_snapshot?.company
                      ? ` · ${doc.customer_snapshot.company}`
                      : ""} · {doc.issue_date}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="mr-2 text-right">
                    <div className="font-semibold">
                      {doc.currency} {Number(doc.grand_total).toFixed(2)}
                    </div>
                    {Number(doc.balance) > 0 && Number(doc.paid_amount) > 0 ? (
                      <div className="text-xs text-amber-600">
                        Balance {doc.currency} {Number(doc.balance).toFixed(2)}
                      </div>
                    ) : null}
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => openExisting.mutate(doc.id)}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={download.isPending}
                    onClick={() => download.mutate(doc.id)}
                  >
                    <Download className="mr-1 h-4 w-4" /> PDF
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setSendFor(doc)}>
                    <Send className="mr-1 h-4 w-4" /> WhatsApp
                  </Button>
                  {doc.kind === "quotation" ? (
                    <Button size="sm" onClick={() => convert.mutate(doc.id)}>
                      <ArrowRight className="mr-1 h-4 w-4" /> To invoice
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
                      Mark paid
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!sendFor} onOpenChange={(open) => !open && setSendFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send on WhatsApp</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Flas finalises the document if needed and sends the customer a secure link where they
            can view, download and pay.
          </p>
          <div className="space-y-1.5">
            <Label>Message to add (optional)</Label>
            <Textarea
              rows={3}
              value={sendNote}
              placeholder="Hi Ahmed, here is the quotation we discussed."
              onChange={(e) => setSendNote(e.target.value)}
            />
          </div>
          <Button disabled={send.isPending} onClick={() => send.mutate()}>
            {send.isPending ? "Sending…" : "Send now"}
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog open={!!payFor} onOpenChange={(open) => !open && setPayFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Amount received</Label>
              <Input
                type="number"
                step="0.01"
                value={payForm.amount}
                onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Reference (optional)</Label>
              <Input
                value={payForm.reference}
                placeholder="Bank transfer ref / receipt no."
                onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              When the balance reaches zero Flas sends the customer the PAID-stamped PDF on WhatsApp
              automatically.
            </p>
            <Button disabled={pay.isPending || !payForm.amount} onClick={() => pay.mutate()}>
              {pay.isPending ? "Saving…" : "Save payment"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
