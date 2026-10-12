import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getDocumentPdf, getSalesDocument } from "@/lib/billing.functions";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Archive,
  CheckCircle,
  Copy,
  Download,
  FileCheck,
  FileText,
  History,
  Loader2,
  Receipt,
  Send,
  Shield,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

type DocumentHistoryDialogProps = {
  documentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const EVENT_ICONS: Record<string, typeof FileText> = {
  created: FileText,
  finalized: ShieldCheck,
  sent_whatsapp: Send,
  payment_claimed: Receipt,
  payment_recorded: CheckCircle,
  receipt_sent: CheckCircle,
};

const EVENT_LABELS: Record<string, string> = {
  created: "Draft created",
  finalized: "Document finalized & number locked",
  sent_whatsapp: "Sent on WhatsApp",
  payment_claimed: "Payment claimed by customer",
  payment_recorded: "Payment recorded",
  receipt_sent: "PAID stamped receipt auto-delivered",
};

export function DocumentHistoryDialog({
  documentId,
  open,
  onOpenChange,
}: DocumentHistoryDialogProps) {
  const loadDoc = useServerFn(getSalesDocument);
  const getPdf = useServerFn(getDocumentPdf);

  const query = useQuery({
    queryKey: ["sales-document-history", documentId],
    queryFn: () => (documentId ? loadDoc({ data: { id: documentId } }) : null),
    enabled: Boolean(documentId && open),
  });

  const downloadPdfMutation = useMutation({
    mutationFn: async () => {
      if (!documentId) throw new Error("No document ID");
      return getPdf({ data: { id: documentId } });
    },
    onSuccess: (res) => {
      const bytes = Uint8Array.from(atob(res.base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("PDF backup downloaded");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const doc = query.data?.doc as Record<string, any> | undefined;
  const activity = (query.data?.activity ?? []) as Array<{
    id: string;
    event: string;
    actor_label?: string | null;
    details?: Record<string, any> | null;
    created_at: string;
  }>;
  const files = (query.data?.files ?? []) as Array<{
    id: string;
    kind: string;
    storage_path: string;
    file_hash?: string | null;
    version: number;
    created_at: string;
  }>;

  const copyText = (val: string) => {
    void navigator.clipboard.writeText(val);
    toast.success("Copied to clipboard");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <History className="size-5 text-primary" />
            <DialogTitle>Document History &amp; Backup Logs</DialogTitle>
          </div>
          <DialogDescription>
            Audit trail, version history, SHA-256 verification fingerprints and tamper-proof PDF backups.
          </DialogDescription>
        </DialogHeader>

        {query.isLoading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="size-6 animate-spin text-primary" />
            <span className="text-sm">Loading document history and backups…</span>
          </div>
        ) : !doc ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No document record found.
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col space-y-4">
            {/* Header Summary */}
            {(() => {
              const d = doc as any;
              return (
                <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg border bg-muted/40">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-base">
                        {d.doc_number || "Draft"}
                      </span>
                      <Badge variant="outline" className="capitalize">
                        {d.kind}
                      </Badge>
                      <Badge variant="secondary" className="capitalize">
                        {d.status?.replace("_", " ")}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Issued: {d.issue_date} · Total: {d.currency} {Number(d.grand_total).toFixed(2)}
                    </p>
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => downloadPdfMutation.mutate()}
                    disabled={downloadPdfMutation.isPending}
                  >
                    {downloadPdfMutation.isPending ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Download className="size-3.5" />
                    )}
                    Download Current PDF
                  </Button>
                </div>
              );
            })()}

            {/* Tabs */}
            <Tabs defaultValue="activity" className="flex-1 min-h-0 flex flex-col">
              <TabsList className="grid grid-cols-2 w-full">
                <TabsTrigger value="activity" className="gap-1.5">
                  <History className="size-4" /> Activity Log ({activity.length})
                </TabsTrigger>
                <TabsTrigger value="files" className="gap-1.5">
                  <Archive className="size-4" /> PDF Backups &amp; Hashes ({files.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="activity" className="flex-1 min-h-0 overflow-y-auto pr-1 mt-3">
                {activity.length === 0 ? (
                  <div className="py-8 text-center text-xs text-muted-foreground border border-dashed rounded-lg">
                    No activity recorded for this document yet.
                  </div>
                ) : (
                  <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-border">
                    {activity.map((item) => {
                      const Icon = EVENT_ICONS[item.event] ?? FileText;
                      return (
                        <div key={item.id} className="relative">
                          <div className="absolute -left-6 top-1 grid size-5 place-items-center rounded-full border bg-background text-primary">
                            <Icon className="size-3" />
                          </div>
                          <div className="rounded-lg border p-3 text-xs bg-card">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-foreground">
                                {EVENT_LABELS[item.event] ?? item.event.replace(/_/g, " ")}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                {new Date(item.created_at).toLocaleString()}
                              </span>
                            </div>
                            {item.actor_label && (
                              <p className="text-[11px] text-muted-foreground mt-0.5">
                                Actor: <span className="font-medium text-foreground">{item.actor_label}</span>
                              </p>
                            )}
                            {item.details && Object.keys(item.details).length > 0 && (
                              <div className="mt-2 rounded bg-muted/60 p-2 font-mono text-[10px] space-y-1">
                                {Object.entries(item.details).map(([k, v]) => (
                                  <div key={k} className="flex items-baseline justify-between gap-2">
                                    <span className="text-muted-foreground capitalize">{k}:</span>
                                    <span className="truncate max-w-[280px] font-semibold">{String(v)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="files" className="flex-1 min-h-0 overflow-y-auto mt-3">
                {files.length === 0 ? (
                  <div className="py-8 text-center text-xs text-muted-foreground border border-dashed rounded-lg space-y-1">
                    <p className="font-medium text-foreground">No locked PDF backup archived yet.</p>
                    <p>Finalizing a document freezes its vector PDF, calculates its SHA-256 fingerprint, and stores an immutable copy.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {files.map((file) => (
                      <div key={file.id} className="rounded-lg border p-3 text-xs bg-card space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 font-semibold">
                            <FileCheck className="size-4 text-emerald-600" />
                            <span>Version {file.version} ({file.kind})</span>
                          </div>
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(file.created_at).toLocaleString()}
                          </span>
                        </div>

                        <div className="space-y-1 text-[11px]">
                          <div className="flex items-center justify-between text-muted-foreground">
                            <span>Storage Path:</span>
                            <span className="font-mono text-[10px] text-foreground truncate max-w-[320px]">
                              {file.storage_path}
                            </span>
                          </div>
                          {file.file_hash && (
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-muted-foreground">SHA-256 Hash:</span>
                              <div className="flex items-center gap-1 font-mono text-[10px] text-foreground">
                                <span className="truncate max-w-[260px]">{file.file_hash}</span>
                                <button
                                  type="button"
                                  onClick={() => copyText(file.file_hash!)}
                                  className="text-muted-foreground hover:text-foreground"
                                  title="Copy hash"
                                >
                                  <Copy className="size-3" />
                                </button>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="flex justify-end pt-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1"
                            onClick={() => downloadPdfMutation.mutate()}
                          >
                            <Download className="size-3" /> Download This Backup
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
