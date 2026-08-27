// QR verification page. Scanning the code on any Flash PDF lands here and
// confirms the document is genuine and shows its current payment status.
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { verifyDocument } from "@/lib/public-billing.functions";
import { createFileRoute } from "@tanstack/react-router";
import { ShieldCheck, ShieldX } from "lucide-react";

export const Route = createFileRoute("/verify/$token")({
  loader: ({ params }) => verifyDocument({ data: { token: params.token } }),
  head: () => ({
    meta: [
      { title: "Document verification — Flash by Mobi Digital Solutions" },
      {
        name: "description",
        content:
          "Check that a Flash quotation or invoice is genuine: issuer, number, amount and live payment status.",
      },
      { property: "og:title", content: "Document verification — Flash" },
      {
        property: "og:description",
        content: "Confirm a Flash invoice or quotation is authentic and see its payment status.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  errorComponent: () => (
    <Wrapper>
      <p className="text-sm text-muted-foreground">Verification is temporarily unavailable.</p>
    </Wrapper>
  ),
  notFoundComponent: () => (
    <Wrapper>
      <p className="text-sm text-muted-foreground">No document matches this code.</p>
    </Wrapper>
  ),
  component: VerifyPage,
});

function Wrapper({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-xl px-4 py-12">{children}</main>;
}

function VerifyPage() {
  const doc = Route.useLoaderData();

  if (!doc) {
    return (
      <Wrapper>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <ShieldX className="h-5 w-5" /> Not verified
            </CardTitle>
            <CardDescription>
              This code does not match any document issued through Flash. Treat the document as
              unverified and contact the sender.
            </CardDescription>
          </CardHeader>
        </Card>
      </Wrapper>
    );
  }

  return (
    <Wrapper>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-emerald-600">
            <ShieldCheck className="h-5 w-5" /> Genuine document
          </CardTitle>
          <CardDescription>
            Issued through Flash by {doc.issuer ?? "the seller"} and unchanged since it was
            finalised.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row label="Type" value={doc.kind.replace("_", " ")} />
          <Row label="Number" value={doc.doc_number} />
          <Row label="Verification ID" value={doc.verification_id ?? "—"} />
          <Row label="Issued" value={doc.issue_date} />
          <Row label="Amount" value={`${doc.currency} ${doc.grand_total.toFixed(2)}`} />
          <Row
            label="Balance"
            value={
              doc.balance <= 0 ? "Settled in full" : `${doc.currency} ${doc.balance.toFixed(2)} due`
            }
          />
          <div className="flex items-center justify-between pt-2">
            <span className="text-muted-foreground">Status</span>
            <Badge variant="secondary" className="capitalize">
              {doc.status.replace("_", " ")}
            </Badge>
          </div>
          {doc.pdf_hash ? (
            <p className="break-all pt-3 text-xs text-muted-foreground">
              PDF fingerprint: {doc.pdf_hash}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </Wrapper>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium capitalize">{value}</span>
    </div>
  );
}
