// Customer-facing document page: view the quotation/invoice, download the PDF,
// pay online and tell the seller once payment is made. Public by design — the
// share token is the credential.
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { claimDocumentPayment, getPublicDocument } from "@/lib/public-billing.functions";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Download, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/pay/$token")({
  loader: ({ params }) => getPublicDocument({ data: { token: params.token } }),
  head: () => ({
    meta: [
      { title: "Your document — Flas by Mobi Digital Solutions" },
      {
        name: "description",
        content:
          "View your quotation or invoice, download the official PDF and complete payment securely.",
      },
      { property: "og:title", content: "Your document — Flas" },
      {
        property: "og:description",
        content: "View, download and pay your quotation or invoice securely.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  errorComponent: () => (
    <Shell>
      <p className="text-sm text-muted-foreground">
        We could not load this document. Please ask the sender for a fresh link.
      </p>
    </Shell>
  ),
  notFoundComponent: () => (
    <Shell>
      <p className="text-sm text-muted-foreground">This link is no longer valid.</p>
    </Shell>
  ),
  component: PayPage,
});

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-bold">Flas · Mobi Digital Solutions</h1>
      {children}
    </main>
  );
}

function PayPage() {
  const doc = Route.useLoaderData();
  const { token } = Route.useParams();
  const claim = useServerFn(claimDocumentPayment);
  const [reference, setReference] = useState("");

  const tellSeller = useMutation({
    mutationFn: () =>
      claim({ data: { token, ...(reference.trim() ? { reference: reference.trim() } : {}) } }),
    onSuccess: () => toast.success("Thanks — the sender has been notified."),
    onError: () => toast.error("Could not notify the sender. Please contact them directly."),
  });

  if (!doc) {
    return (
      <Shell>
        <p className="text-sm text-muted-foreground">
          This document is not available. It may have been withdrawn.
        </p>
      </Shell>
    );
  }

  const money = (value: number) => `${doc.currency} ${value.toFixed(2)}`;
  const label =
    doc.kind === "quotation" ? "Quotation" : doc.kind === "credit_note" ? "Credit note" : "Invoice";
  const issuer = (doc.company["legal_name"] ?? doc.company["trade_name"] ?? "") as string;

  return (
    <Shell>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>
                {label} {doc.doc_number}
              </CardTitle>
              <CardDescription>
                {issuer ? `From ${issuer} · ` : ""}Issued {doc.issue_date}
                {doc.due_date ? ` · Due ${doc.due_date}` : ""}
                {doc.valid_until ? ` · Valid until ${doc.valid_until}` : ""}
              </CardDescription>
            </div>
            <Badge variant="secondary" className="capitalize">
              {doc.status.replace("_", " ")}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2">Item</th>
                  <th className="py-2 text-right">Qty</th>
                  <th className="py-2 text-right">Price</th>
                  <th className="py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {doc.items.map((item, index) => (
                  <tr key={index} className="border-b last:border-0">
                    <td className="py-2">
                      <div className="font-medium">{item.name}</div>
                      {item.description ? (
                        <div className="text-xs text-muted-foreground">{item.description}</div>
                      ) : null}
                    </td>
                    <td className="py-2 text-right">{item.quantity}</td>
                    <td className="py-2 text-right">{money(item.unit_price)}</td>
                    <td className="py-2 text-right">{money(item.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-lg bg-muted/50 p-4 text-sm">
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground">Total</span>
              <span className="font-semibold">{money(doc.grand_total)}</span>
            </div>
            {doc.paid_amount > 0 ? (
              <div className="flex justify-between py-1">
                <span className="text-muted-foreground">Paid</span>
                <span>{money(doc.paid_amount)}</span>
              </div>
            ) : null}
            <div className="flex justify-between border-t pt-2 text-base font-bold">
              <span>{doc.balance <= 0 ? "Settled" : "Amount due"}</span>
              <span>{money(Math.max(0, doc.balance))}</span>
            </div>
          </div>

          {doc.bank ? (
            <div className="rounded-lg border p-4 text-sm">
              <p className="mb-2 font-semibold">Bank transfer details</p>
              <ul className="space-y-1 text-muted-foreground">
                {Object.entries(doc.bank)
                  .filter(([, value]) => value)
                  .map(([key, value]) => (
                    <li key={key}>
                      <span className="capitalize">{key.replace(/_/g, " ")}:</span> {String(value)}
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}

          {doc.notes ? <p className="text-sm text-muted-foreground">{doc.notes}</p> : null}
          {doc.terms ? (
            <p className="whitespace-pre-line text-xs text-muted-foreground">{doc.terms}</p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <a href={`/api/public/documents/${token}`} target="_blank" rel="noreferrer">
                <Download className="mr-1 h-4 w-4" /> Download PDF
              </a>
            </Button>
            {doc.online_payment_url && doc.balance > 0 ? (
              <Button asChild variant="outline">
                <a href={doc.online_payment_url} target="_blank" rel="noreferrer">
                  Pay online
                </a>
              </Button>
            ) : null}
            {doc.verification_id ? (
              <span className="inline-flex items-center gap-1 self-center text-xs text-muted-foreground">
                <ShieldCheck className="h-4 w-4" /> Verification ID {doc.verification_id} — scan the
                QR code on the PDF to confirm authenticity.
              </span>
            ) : null}
          </div>

          {doc.balance > 0 ? (
            <div className="rounded-lg border border-dashed p-4">
              <p className="mb-2 text-sm font-semibold">Already paid by transfer or cash?</p>
              <div className="flex flex-wrap gap-2">
                <Input
                  className="max-w-xs"
                  placeholder="Payment reference (optional)"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
                <Button
                  variant="outline"
                  disabled={tellSeller.isPending}
                  onClick={() => tellSeller.mutate()}
                >
                  <CheckCircle2 className="mr-1 h-4 w-4" /> I have paid
                </Button>
              </div>
            </div>
          ) : (
            <p className="flex items-center gap-2 text-sm font-medium text-emerald-600">
              <CheckCircle2 className="h-4 w-4" /> Payment received — thank you.
            </p>
          )}
        </CardContent>
      </Card>
    </Shell>
  );
}
