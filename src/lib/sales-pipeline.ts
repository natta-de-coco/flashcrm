// Deal stages and pipeline rules for visual sales tracking across quotations, invoices, and payments.

export type DocRow = {
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

export type StageId = "draft" | "sent" | "accepted" | "unpaid" | "paid";

export type StageDef = {
  id: StageId;
  label: string;
  description: string;
  headerColor: string;
  badgeTone: string;
};

export const STAGES: StageDef[] = [
  {
    id: "draft",
    label: "Draft",
    description: "Quotes & invoices in preparation",
    headerColor: "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
    badgeTone: "bg-muted text-muted-foreground",
  },
  {
    id: "sent",
    label: "Sent / Review",
    description: "Sent to customer via WhatsApp or email",
    headerColor: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
    badgeTone: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  },
  {
    id: "accepted",
    label: "Accepted Quotes",
    description: "Customer agreed — ready to invoice",
    headerColor: "border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-300",
    badgeTone: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  },
  {
    id: "unpaid",
    label: "Awaiting Payment",
    description: "Invoiced with outstanding balance",
    headerColor: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    badgeTone: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  },
  {
    id: "paid",
    label: "Paid & Settled",
    description: "Payment collected and stamped",
    headerColor: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    badgeTone: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  },
];

export function getDocStage(doc: DocRow): StageId {
  if (doc.status === "draft") return "draft";
  if (doc.kind === "quotation") {
    if (doc.status === "accepted") return "accepted";
    return "sent";
  }
  // For invoices
  if (doc.status === "paid" || Number(doc.balance) <= 0) {
    return "paid";
  }
  return "unpaid";
}

/** Identifies internal SaaS billing receipts which must not appear in customer sales pipeline or lists. */
export function isSubscriptionReceipt(doc: {
  custom_fields?: Record<string, unknown> | null;
}): boolean {
  if (!doc.custom_fields) return false;
  return (
    doc.custom_fields["is_subscription_receipt"] === true ||
    doc.custom_fields["provider"] === "stripe" ||
    Boolean(doc.custom_fields["stripe_invoice_id"])
  );
}
