// QR verification page. Scanning the code on any Flas PDF lands here and
// confirms the document is genuine and shows its current payment status.
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { verifyDocument } from "@/lib/public-billing.functions";
import { createFileRoute } from "@tanstack/react-router";
import { ShieldCheck, ShieldX } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import type { MessageKey } from "@/lib/i18n";

/** One line in the reader's language, for the states the route shows without the page. */
function Notice({ message }: { message: MessageKey }) {
  const { t } = useI18n();
  return <p className="text-sm text-muted-foreground">{t(message)}</p>;
}

export const Route = createFileRoute("/verify/$token")({
  loader: ({ params }) => verifyDocument({ data: { token: params.token } }),
  head: () => ({
    meta: [
      { title: "Document verification — Flas by Mobi Digital Solutions" },
      {
        name: "description",
        content:
          "Check that a Flas quotation or invoice is genuine: issuer, number, amount and live payment status.",
      },
      { property: "og:title", content: "Document verification — Flas" },
      {
        property: "og:description",
        content: "Confirm a Flas invoice or quotation is authentic and see its payment status.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  errorComponent: () => (
    <Wrapper>
      <Notice message="verifyToken.temporarilyUnavailable" />
    </Wrapper>
  ),
  notFoundComponent: () => (
    <Wrapper>
      <Notice message="verifyToken.noDocumentMatches" />
    </Wrapper>
  ),
  component: VerifyPage,
});

function Wrapper({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-xl px-4 py-12">{children}</main>;
}

function VerifyPage() {
  const { t, tr } = useI18n();
  const doc = Route.useLoaderData();

  if (!doc) {
    return (
      <Wrapper>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <ShieldX className="h-5 w-5" /> {t("verifyToken.notVerified")}
            </CardTitle>
            <CardDescription>{t("verifyToken.thisCodeDoesNotMatch")}</CardDescription>
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
            <ShieldCheck className="h-5 w-5" /> {t("verifyToken.genuineDocument")}
          </CardTitle>
          <CardDescription>
            {tr("verifyToken.issuedThroughFlasByAnd", {
              value: doc.issuer ?? t("verifyToken.theSeller"),
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row label={t("verifyToken.type")} value={doc.kind.replace("_", " ")} />
          <Row label={t("verifyToken.number")} value={doc.doc_number} />
          <Row label={t("verifyToken.verificationId")} value={doc.verification_id ?? "—"} />
          <Row label={t("verifyToken.issued")} value={doc.issue_date} />
          <Row
            label={t("verifyToken.amount")}
            value={`${doc.currency} ${doc.grand_total.toFixed(2)}`}
          />
          <Row
            label={t("verifyToken.balance")}
            value={
              doc.balance <= 0 ? "Settled in full" : `${doc.currency} ${doc.balance.toFixed(2)} due`
            }
          />
          <div className="flex items-center justify-between pt-2">
            <span className="text-muted-foreground">{t("verifyToken.status")}</span>
            <Badge variant="secondary" className="capitalize">
              {doc.status.replace("_", " ")}
            </Badge>
          </div>
          {doc.pdf_hash ? (
            <p className="break-all pt-3 text-xs text-muted-foreground">
              {tr("verifyToken.pdfFingerprint", { pdfhash: doc.pdf_hash })}
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
      <span className="text-end font-medium capitalize">{value}</span>
    </div>
  );
}
