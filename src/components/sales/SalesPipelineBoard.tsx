// Visual Kanban-style sales pipeline board.
// Five stages derived from document status: Draft → Sent → Accepted → Unpaid → Paid.
// Every action (send, accept, convert, pay, download) is a callback so the
// parent SalesPage owns all the mutations and dialogs — this component is
// display-only and zero-network.
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { STAGES, getDocStage, type DocRow, type StageDef, type StageId } from "@/lib/sales-pipeline";
import {
  ArrowRight,
  CheckCircle,
  CheckCircle2,
  Clock,
  CreditCard,
  Download,
  FileText,
  Send,
  User,
} from "lucide-react";

type BoardActions = {
  onOpenExisting: (id: string) => void;
  onSendWhatsApp: (doc: DocRow) => void;
  onConvertQuotation: (id: string) => void;
  onRecordPayment: (doc: DocRow) => void;
  onDownloadPdf: (id: string) => void;
};

function StageColumn({
  stage,
  docs,
  currency,
  ...actions
}: { stage: StageDef; docs: DocRow[]; currency: string } & BoardActions) {
  const stageTotal = docs.reduce((s, d) => s + Number(d.grand_total), 0);

  return (
    <div className="flex min-w-[260px] max-w-[320px] flex-1 flex-col rounded-xl border bg-card">
      {/* Column header */}
      <div className={`rounded-t-xl border-b px-3 py-2.5 ${stage.headerColor}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold">{stage.label}</span>
          <Badge variant="outline" className={`text-[10px] ${stage.badgeTone}`}>
            {docs.length}
          </Badge>
        </div>
        <p className="mt-0.5 text-[11px] opacity-70">{stage.description}</p>
        {docs.length > 0 && (
          <div className="mt-1.5 text-[11px] font-medium opacity-80">
            {currency}{" "}
            {stageTotal.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </div>
        )}
      </div>

      {/* Column Cards */}
      <div className="flex-1 space-y-2.5 overflow-y-auto p-2.5">
        {docs.length === 0 ? (
          <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-border/60 p-4 text-center text-xs text-muted-foreground">
            No documents in this stage
          </div>
        ) : (
          docs.map((doc) => {
            const customerName =
              doc.customer_snapshot?.name ||
              doc.customer_snapshot?.company ||
              "No customer named";
            const isInvoice = doc.kind === "invoice";
            const hasBalance = Number(doc.balance) > 0;

            return (
              <Card
                key={doc.id}
                className="border shadow-xs transition-colors hover:border-foreground/30"
              >
                <CardContent className="space-y-2 p-3">
                  {/* Top Row: Doc Number & Kind */}
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate font-mono text-xs font-bold">
                      {doc.doc_number || "Draft"}
                    </span>
                    <Badge
                      variant="outline"
                      className={`px-1.5 py-0 text-[10px] font-medium capitalize ${
                        isInvoice
                          ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                          : "border-blue-500/30 text-blue-600 dark:text-blue-400"
                      }`}
                    >
                      {doc.kind}
                    </Badge>
                  </div>

                  {/* Customer */}
                  <div className="flex items-center gap-1.5 text-xs font-medium text-foreground/90">
                    <User className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="truncate">{customerName}</span>
                  </div>

                  {/* Amounts */}
                  <div className="space-y-0.5 rounded-md bg-muted/40 p-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Total:</span>
                      <span className="font-semibold">
                        {doc.currency} {Number(doc.grand_total).toFixed(2)}
                      </span>
                    </div>
                    {isInvoice && hasBalance && (
                      <div className="flex items-center justify-between font-medium text-amber-600 dark:text-amber-400">
                        <span>Balance:</span>
                        <span>
                          {doc.currency} {Number(doc.balance).toFixed(2)}
                        </span>
                      </div>
                    )}
                    {isInvoice && !hasBalance && (
                      <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400">
                        <span className="flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Fully Paid
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Date & sent indicator */}
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {doc.issue_date}
                    </span>
                    {doc.last_sent_at && (
                      <span className="text-[10px] text-blue-600 dark:text-blue-400">Sent</span>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-wrap items-center gap-1.5 border-t pt-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 flex-1 px-2 text-xs"
                      onClick={() => actions.onOpenExisting(doc.id)}
                    >
                      <FileText className="me-1 h-3 w-3" />
                      Edit
                    </Button>

                    {stage.id === "draft" && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 flex-1 px-2 text-xs"
                        onClick={() => actions.onSendWhatsApp(doc)}
                      >
                        <Send className="me-1 h-3 w-3" />
                        Send
                      </Button>
                    )}

                    {stage.id === "sent" && doc.kind === "quotation" && (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-7 flex-1 px-2 text-xs"
                        onClick={() => actions.onConvertQuotation(doc.id)}
                      >
                        <CheckCircle className="me-1 h-3 w-3" />
                        Accept
                      </Button>
                    )}

                    {stage.id === "accepted" && (
                      <Button
                        variant="default"
                        size="sm"
                        className="h-7 w-full px-2 text-xs"
                        onClick={() => actions.onConvertQuotation(doc.id)}
                      >
                        <ArrowRight className="me-1 h-3 w-3" />
                        Convert to Invoice
                      </Button>
                    )}

                    {stage.id === "unpaid" && isInvoice && (
                      <Button
                        variant="default"
                        size="sm"
                        className="h-7 w-full px-2 text-xs"
                        onClick={() => actions.onRecordPayment(doc)}
                      >
                        <CreditCard className="me-1 h-3 w-3" />
                        Record Payment
                      </Button>
                    )}

                    {stage.id === "paid" && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 flex-1 px-2 text-xs"
                        onClick={() => actions.onDownloadPdf(doc.id)}
                      >
                        <Download className="me-1 h-3 w-3" />
                        PDF
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}

export function SalesPipelineBoard({
  documents,
  currency,
  ...actions
}: { documents: DocRow[]; currency: string } & BoardActions) {
  // Group documents by stage, filtering out internal subscription receipts
  const byStage: Record<StageId, DocRow[]> = Object.fromEntries(
    STAGES.map((s) => [s.id, [] as DocRow[]]),
  ) as Record<StageId, DocRow[]>;
  for (const doc of documents) {
    const { custom_fields } = doc as { custom_fields?: Record<string, unknown> | null };
    const isReceipt =
      custom_fields &&
      (custom_fields["is_subscription_receipt"] === true ||
        custom_fields["provider"] === "stripe" ||
        Boolean(custom_fields["stripe_invoice_id"]));
    if (isReceipt) continue;
    const stage = getDocStage(doc);
    byStage[stage].push(doc);
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {STAGES.map((stage) => (
        <StageColumn
          key={stage.id}
          stage={stage}
          docs={byStage[stage.id] ?? []}
          currency={currency}
          {...actions}
        />
      ))}
    </div>
  );
}
