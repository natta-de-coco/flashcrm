import { useState } from "react";
import { Check, Copy, Download, FileCode, FileSpreadsheet, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/hooks/useI18n";
import {
  generateQuickBooksCsv,
  generateQuickBooksIif,
  generateQuickBooksInvoiceJson,
  generateTallySalesXml,
  generateZohoInvoiceCsv,
  generateZohoInvoiceJson,
  type SyncInvoiceDoc,
  type SyncInvoiceItem,
} from "@/lib/accounting-sync";

type AccountingExportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: SyncInvoiceDoc | null;
  items: SyncInvoiceItem[];
  companyName?: string | undefined;
};

export function AccountingExportDialog({
  open,
  onOpenChange,
  document: doc,
  items,
  companyName,
}: AccountingExportDialogProps) {
  const { t } = useI18n();
  const [salesLedger, setSalesLedger] = useState("Sales Account");
  const [taxLedger, setTaxLedger] = useState("Output VAT");
  const [copiedTab, setCopiedTab] = useState<string | null>(null);

  if (!doc) return null;

  const tallyXml = generateTallySalesXml(doc, items, {
    companyName: companyName || "Flas CRM Company",
    salesLedger,
    taxLedger,
  });

  const qbCsv = generateQuickBooksCsv(doc, items);
  const qbIif = generateQuickBooksIif(doc, items, { salesLedger, taxLedger });
  const qbJson = generateQuickBooksInvoiceJson(doc, items);

  const zohoCsv = generateZohoInvoiceCsv(doc, items);
  const zohoJson = generateZohoInvoiceJson(doc, items);

  const downloadFile = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t("sales.downloadedFile", { filename }));
  };

  const copyToClipboard = (text: string, label: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedTab(label);
    toast.success(t("sales.copiedToClipboard", { label }));
    setTimeout(() => setCopiedTab(null), 2500);
  };

  const isQuotation = doc.kind === "quotation";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="size-5 text-brand" />
            {t("sales.accountingExportTitle", { docNumber: doc.doc_number })}
          </DialogTitle>
          <DialogDescription>{t("sales.accountingExportDesc")}</DialogDescription>
        </DialogHeader>

        <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {t("sales.offlineExportNotice")}
        </div>

        <div className="grid gap-3 pt-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">{t("sales.salesLedger")}</Label>
            <Input
              className="h-8 text-xs"
              value={salesLedger}
              onChange={(e) => setSalesLedger(e.target.value)}
              placeholder="e.g. Sales Account, General Sales"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("sales.taxLedger")}</Label>
            <Input
              className="h-8 text-xs"
              value={taxLedger}
              onChange={(e) => setTaxLedger(e.target.value)}
              placeholder="e.g. Output VAT, GST Output"
            />
          </div>
        </div>

        <Tabs defaultValue="tally" className="w-full pt-2">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="tally" className="text-xs">
              {t("sales.tallyTab")}
            </TabsTrigger>
            <TabsTrigger value="quickbooks" className="text-xs">
              {t("sales.quickbooksTab")}
            </TabsTrigger>
            <TabsTrigger value="zoho" className="text-xs">
              {t("sales.zohoTab")}
            </TabsTrigger>
          </TabsList>

          {/* TALLY PRIME */}
          <TabsContent value="tally" className="space-y-3 pt-3">
            <div className="rounded-lg border bg-muted/40 p-3 text-xs space-y-1.5">
              <p className="font-semibold text-foreground">{t("sales.howToImportTally")}</p>
              <ol className="list-decimal list-inside space-y-0.5 text-muted-foreground">
                <li>Download the Tally XML voucher below.</li>
                <li>
                  In Tally Prime, navigate to <strong>Import Data</strong> &gt;{" "}
                  <strong>Vouchers</strong>.
                </li>
                <li>
                  Select the downloaded XML file to import instantly with inventory and tax ledgers.
                </li>
              </ol>
            </div>

            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() =>
                  downloadFile(
                    tallyXml,
                    `tally-${doc.doc_number.toLowerCase().replace(/[^a-z0-9]/g, "-")}.xml`,
                    "application/xml",
                  )
                }
              >
                <Download className="size-4" /> {t("sales.downloadTallyXml")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => copyToClipboard(tallyXml, "Tally XML")}
              >
                {copiedTab === "Tally XML" ? (
                  <Check className="size-4" />
                ) : (
                  <Copy className="size-4" />
                )}
                {t("sales.copyXml")}
              </Button>
            </div>

            <Textarea
              readOnly
              rows={8}
              value={tallyXml}
              className="font-mono text-[11px] bg-muted/20"
            />
          </TabsContent>

          {/* QUICKBOOKS */}
          <TabsContent value="quickbooks" className="space-y-3 pt-3">
            <div className="rounded-lg border bg-muted/40 p-3 text-xs space-y-1.5">
              <p className="font-semibold text-foreground">{t("sales.howToImportQuickBooks")}</p>
              <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
                <li>
                  <strong>QuickBooks Online:</strong> Click <strong>Gear Icon</strong> &gt;{" "}
                  <strong>Import Data</strong> &gt;{" "}
                  <strong>{isQuotation ? "Estimates" : "Invoices"}</strong>, and upload the CSV
                  file.
                </li>
                <li>
                  <strong>QuickBooks Desktop:</strong> Go to <strong>File</strong> &gt;{" "}
                  <strong>Utilities</strong> &gt; <strong>Import</strong> &gt;{" "}
                  <strong>IIF Files</strong>.
                </li>
              </ul>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() =>
                  downloadFile(
                    qbCsv,
                    `quickbooks-${doc.doc_number.toLowerCase().replace(/[^a-z0-9]/g, "-")}.csv`,
                    "text/csv",
                  )
                }
              >
                <FileSpreadsheet className="size-4" /> {t("sales.downloadQuickBooksCsv")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  downloadFile(
                    qbIif,
                    `quickbooks-${doc.doc_number.toLowerCase().replace(/[^a-z0-9]/g, "-")}.iif`,
                    "text/plain",
                  )
                }
              >
                <FileCode className="size-4" /> {t("sales.downloadQuickBooksIif")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => copyToClipboard(qbJson, "QuickBooks JSON")}
              >
                {copiedTab === "QuickBooks JSON" ? (
                  <Check className="size-4" />
                ) : (
                  <Copy className="size-4" />
                )}
                {t("sales.copyRestJson")}
              </Button>
            </div>

            <Textarea
              readOnly
              rows={8}
              value={qbCsv}
              className="font-mono text-[11px] bg-muted/20"
            />
          </TabsContent>

          {/* ZOHO BOOKS */}
          <TabsContent value="zoho" className="space-y-3 pt-3">
            <div className="rounded-lg border bg-muted/40 p-3 text-xs space-y-1.5">
              <p className="font-semibold text-foreground">{t("sales.howToImportZoho")}</p>
              <ol className="list-decimal list-inside space-y-0.5 text-muted-foreground">
                <li>Download the Zoho Books CSV file below.</li>
                <li>
                  In Zoho Books, open <strong>Sales</strong> &gt;{" "}
                  <strong>{isQuotation ? "Estimates" : "Invoices"}</strong>.
                </li>
                <li>
                  Click the menu icon (<strong>...</strong>) in the top-right corner and select{" "}
                  <strong>Import {isQuotation ? "Estimates" : "Invoices"}</strong>.
                </li>
                <li>
                  Upload the file; line items, tax, discounts, and customer details will be
                  pre-matched.
                </li>
              </ol>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() =>
                  downloadFile(
                    zohoCsv,
                    `zoho-${doc.doc_number.toLowerCase().replace(/[^a-z0-9]/g, "-")}.csv`,
                    "text/csv",
                  )
                }
              >
                <Download className="size-4" /> {t("sales.downloadZohoCsv")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => copyToClipboard(zohoJson, "Zoho JSON")}
              >
                {copiedTab === "Zoho JSON" ? (
                  <Check className="size-4" />
                ) : (
                  <Copy className="size-4" />
                )}
                {t("sales.copyRestJson")}
              </Button>
            </div>

            <Textarea
              readOnly
              rows={8}
              value={zohoCsv}
              className="font-mono text-[11px] bg-muted/20"
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
