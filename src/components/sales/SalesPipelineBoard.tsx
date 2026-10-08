import { useMemo } from "react";
import {
  FileText,
  Send,
  CheckCircle,
  CreditCard,
  ArrowRight,
  Download,
  Clock,
  CheckCircle2,
  Receipt,
  User,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  type DocRow,
  type StageId,
  type StageDef,
  STAGES,
  getDocStage,
} from "@/lib/sales-pipeline";

export type { DocRow, StageId, StageDef };
export { getDocStage };

interface SalesPipelineBoardProps {
  documents: DocRow[];
  onOpenExisting: (id: string) => void;
  onSendWhatsApp: (doc: DocRow) => void;
  onRecordPayment: (doc: DocRow) => void;
  onConvertQuotation: (id: string) => void;
  onDownloadPdf: (id: string) => void;
}

export function SalesPipelineBoard({
  documents,
  onOpenExisting,
  onSendWhatsApp,
  onRecordPayment,
  onConvertQuotation,
  onDownloadPdf,
}: SalesPipelineBoardProps) {
  const grouped = useMemo(() => {
    const map: Record<StageId, DocRow[]> = {
      draft: [],
      sent: [],
      accepted: [],
      unpaid: [],
      paid: [],
    };
    for (const doc of documents) {
      const stage = getDocStage(doc);
      map[stage].push(doc);
    }
    return map;
  }, [documents]);

  const currency = documents[0]?.currency ?? "AED";

  return (
    <div className="w-full">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-5">
        {STAGES.map((stage) => {
          const docs = grouped[stage.id];
          const totalVal = docs.reduce((sum, d) => sum + Number(d.grand_total || 0), 0);

          return (
            <div
              key={stage.id}
              className="flex flex-col rounded-xl border bg-muted/20 p-3 shadow-xs min-h-[500px]"
            >
              {/* Column Header */}
              <div className={`mb-3 rounded-lg border p-2.5 ${stage.headerColor}`}>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm">{stage.label}</span>
                  <Badge variant="secondary" className="px-1.5 py-0 text-xs font-mono font-medium">
                    {docs.length}
                  </Badge>
                </div>
                <div className="mt-1 flex items-baseline justify-between text-xs">
                  <span className="text-muted-foreground truncate">{stage.description}</span>
                </div>
                <div className="mt-1.5 font-bold text-sm tracking-tight">
                  {currency} {totalVal.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                </div>
              </div>

              {/* Column Cards */}
              <div className="flex-1 space-y-2.5 overflow-y-auto">
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
                        className="border shadow-xs hover:border-foreground/30 transition-colors"
                      >
                        <CardContent className="p-3 space-y-2">
                          {/* Top Row: Doc Number & Kind */}
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-mono text-xs font-bold truncate">
                              {doc.doc_number || "Draft"}
                            </span>
                            <Badge
                              variant="outline"
                              className={`text-[10px] px-1.5 py-0 font-medium capitalize ${
                                isInvoice
                                  ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                                  : "border-blue-500/30 text-blue-600 dark:text-blue-400"
                              }`}
                            >
                              {doc.kind}
                            </Badge>
                          </div>

                          {/* Customer */}
                          <div className="flex items-center gap-1.5 text-xs text-foreground/90 font-medium">
                            <User className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span className="truncate">{customerName}</span>
                          </div>

                          {/* Amounts */}
                          <div className="rounded-md bg-muted/40 p-2 text-xs space-y-0.5">
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">Grand Total:</span>
                              <span className="font-semibold">
                                {doc.currency} {Number(doc.grand_total).toFixed(2)}
                              </span>
                            </div>
                            {isInvoice && hasBalance && (
                              <div className="flex items-center justify-between text-amber-600 dark:text-amber-400 font-medium">
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

                          {/* Dates */}
                          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {doc.issue_date}
                            </span>
                            {doc.last_sent_at && (
                              <span className="text-[10px] text-blue-600 dark:text-blue-400">
                                Sent
                              </span>
                            )}
                          </div>

                          {/* Action Buttons */}
                          <div className="pt-1 border-t flex flex-wrap items-center gap-1.5">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs flex-1"
                              onClick={() => onOpenExisting(doc.id)}
                            >
                              <FileText className="me-1 h-3 w-3" />
                              Edit
                            </Button>

                            {/* Stage-specific quick actions */}
                            {stage.id === "draft" && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 px-2 text-xs flex-1"
                                onClick={() => onSendWhatsApp(doc)}
                              >
                                <Send className="me-1 h-3 w-3" />
                                Send
                              </Button>
                            )}

                            {stage.id === "accepted" && (
                              <Button
                                variant="default"
                                size="sm"
                                className="h-7 px-2 text-xs w-full"
                                onClick={() => onConvertQuotation(doc.id)}
                              >
                                <ArrowRight className="me-1 h-3 w-3" />
                                Convert to Invoice
                              </Button>
                            )}

                            {stage.id === "sent" && doc.kind === "quotation" && (
                              <Button
                                variant="secondary"
                                size="sm"
                                className="h-7 px-2 text-xs flex-1"
                                onClick={() => onConvertQuotation(doc.id)}
                              >
                                <CheckCircle className="me-1 h-3 w-3" />
                                Accept
                              </Button>
                            )}

                            {stage.id === "unpaid" && isInvoice && (
                              <Button
                                variant="default"
                                size="sm"
                                className="h-7 px-2 text-xs w-full"
                                onClick={() => onRecordPayment(doc)}
                              >
                                <CreditCard className="me-1 h-3 w-3" />
                                Record Payment
                              </Button>
                            )}

                            {stage.id === "paid" && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 px-2 text-xs flex-1"
                                onClick={() => onDownloadPdf(doc.id)}
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
        })}
      </div>
    </div>
  );
}
