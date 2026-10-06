import { CompanyMembers } from "@/components/manager/CompanyMembers";
import { ManageSubscriptionDialog } from "@/components/manager/ManageSubscriptionDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { getCompanyWorkspace } from "@/lib/companies.functions";
import { formatDayUnambiguous, formatMomentUnambiguous } from "@/lib/locale";
import { exportCompanyData } from "@/lib/presence.functions";
import {
  billedBy,
  companyAccess,
  paidUntilText,
  planLabel,
  statusLabel,
} from "@/lib/subscription-admin";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Download, Eye, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/hooks/useI18n";

export const Route = createFileRoute("/_authenticated/companies/$orgId")({
  head: () => ({
    meta: [{ title: "Company workspace — Flas Manager" }, { name: "robots", content: "noindex" }],
  }),
  component: CompanyWorkspacePage,
});

/** Manager portal: one company -- its subscription, team access, and a read-only look inside. */
function CompanyWorkspacePage() {
  const { t, tr } = useI18n();
  const { orgId } = Route.useParams();
  const { isSuperAdmin } = useAuth();
  const fetchWorkspace = useServerFn(getCompanyWorkspace);
  const runExport = useServerFn(exportCompanyData);

  const ws = useQuery({
    queryKey: ["company-workspace", orgId],
    queryFn: () => fetchWorkspace({ data: { organizationId: orgId } }),
    enabled: isSuperAdmin,
  });

  const exportMutation = useMutation({
    mutationFn: () => runExport({ data: { organizationId: orgId } }),
    onSuccess: (payload) => {
      const name = ws.data?.org.name ?? "company";
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `flash-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-data.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t("companiesOrgId.companyDataExported"));
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("companiesOrgId.exportFailed")),
  });

  if (!isSuperAdmin) {
    return (
      <main className="grid flex-1 place-items-center p-6">
        <p className="text-sm text-muted-foreground">
          {t("companiesOrgId.thisAreaIsOnlyAvailable")}
        </p>
      </main>
    );
  }

  const d = ws.data;
  const now = new Date();
  const access = d ? companyAccess(d.org, now) : null;

  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link
          to="/companies"
          className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
        >
          <ArrowLeft className="size-3.5" /> {t("companiesOrgId.allCompanies")}
        </Link>
        <Button
          size="sm"
          variant="outline"
          className="gap-1"
          disabled={!d || exportMutation.isPending}
          onClick={() => exportMutation.mutate()}
        >
          <Download className="size-3.5" /> {t("companiesOrgId.exportAllData")}
        </Button>
      </div>

      <div className="mb-6 flex items-start gap-3 rounded-lg border border-brand/40 bg-brand-soft p-4">
        <Eye className="mt-0.5 size-5 shrink-0 text-brand" />
        <div>
          <p className="text-sm font-semibold">
            {tr("companiesOrgId.youAreViewingSWorkspace", {
              value: d?.org.name ?? t("companiesOrgId.thisCompany"),
            })}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("companiesOrgId.theirLeadsConversationsAndActivity")}
          </p>
        </div>
      </div>

      {ws.isLoading && (
        <p className="text-sm text-muted-foreground">{t("companiesOrgId.loadingWorkspace")}</p>
      )}
      {ws.error && (
        <p className="text-sm text-destructive">
          {ws.error instanceof Error
            ? ws.error.message
            : t("companiesOrgId.couldNotLoadThisWorkspace")}
        </p>
      )}

      {d && access && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">{t("companiesOrgId.subscription")}</CardTitle>
              <ManageSubscriptionDialog company={d.org} />
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{d.org.name}</span>
                <Badge variant="secondary">{planLabel(d.org.plan)}</Badge>
                <Badge variant="outline">{statusLabel(d.org.subscription_status)}</Badge>
                {d.org.suspended && (
                  <Badge variant="destructive">{t("companiesOrgId.suspended")}</Badge>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {tr("companiesOrgId.paidUntil", {
                  paidUntilText: paidUntilText(d.org, now),
                  value:
                    billedBy(d.org) === "paddle"
                      ? t("companiesOrgId.paysByCardPaddle")
                      : t("companiesOrgId.paysManually"),
                })}
              </p>
              <p
                className={`text-xs ${access.allowed ? "text-muted-foreground" : "font-medium text-destructive"}`}
              >
                {access.allowed
                  ? t("companiesOrgId.hasAccess")
                  : t("companiesOrgId.noAccess", { reason: access.reason })}
              </p>
              <p className="text-xs text-muted-foreground">
                {tr("companiesOrgId.joined", {
                  slug: d.org.slug,
                  formatDayUnambiguous: formatDayUnambiguous(d.org.created_at),
                })}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {tr("companiesOrgId.team", { length: d.staff.length })}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                {t("companiesOrgId.suspendOnePersonWithoutAffecting")}
              </p>
              <CompanyMembers orgId={orgId} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <MailCheck className="size-4 text-brand" />{" "}
                {t("companiesOrgId.authenticationEmailActivity")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {d.authEmails.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t("companiesOrgId.noVerificationOrRecoveryEmails")}
                </p>
              )}
              {d.authEmails.map((email) => (
                <div
                  key={email.id}
                  className="flex items-start justify-between gap-3 border-b border-border/60 pb-2 last:border-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{email.recipient_email}</p>
                    <p className="text-xs text-muted-foreground">
                      {tr("companiesOrgId.attempt", {
                        value:
                          email.action_type === "signup"
                            ? t("companiesOrgId.accountVerification")
                            : t("companiesOrgId.passwordRecovery"),
                        attemptnumber: email.attempt_number,
                      })}
                    </p>
                    {email.provider_error && (
                      <p className="mt-1 text-xs text-destructive">{email.provider_error}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-end">
                    <Badge
                      variant={email.status === "accepted" ? "secondary" : "destructive"}
                      className="capitalize"
                    >
                      {email.status}
                    </Badge>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {formatMomentUnambiguous(email.requested_at)}
                    </p>
                  </div>
                </div>
              ))}
              <p className="pt-1 text-[11px] text-muted-foreground">
                {t("companiesOrgId.acceptedMeansTheEmailService")}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("companiesOrgId.connectedNumbers")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {d.numbers.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t("companiesOrgId.noWhatsappNumbersConnected")}
                </p>
              )}
              {d.numbers.map((n) => (
                <p key={n.id} className="flex items-center justify-between text-sm">
                  <span>
                    {n.label}{" "}
                    <span className="text-xs text-muted-foreground">
                      {n.display_phone ?? n.phone_number_id}
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    {n.is_default && (
                      <Badge variant="secondary" className="text-[10px]">
                        {t("companiesOrgId.default")}
                      </Badge>
                    )}
                    <Badge variant={n.active ? "outline" : "destructive"} className="text-[10px]">
                      {n.active ? t("companiesOrgId.active") : t("companiesOrgId.inactive")}
                    </Badge>
                  </span>
                </p>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("companiesOrgId.recentLeads")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {d.leads.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t("companiesOrgId.noLeadsCapturedYet")}
                </p>
              )}
              {d.leads.map((l) => (
                <p key={l.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">
                    {l.name ?? l.email}{" "}
                    <span className="text-xs text-muted-foreground">
                      {tr("companiesOrgId.via", { source: l.source })}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {l.consent_given && (
                      <Badge className="bg-brand text-[10px] text-brand-foreground">
                        {t("companiesOrgId.optedIn")}
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-[10px] capitalize">
                      {l.status}
                    </Badge>
                  </span>
                </p>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("companiesOrgId.recentConversations")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {d.conversations.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t("companiesOrgId.noConversationsYet")}
                </p>
              )}
              {d.conversations.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {c.contacts?.name ?? t("companiesOrgId.unknown")}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {c.last_message_preview ?? t("companiesOrgId.noMessages")}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Badge variant="secondary" className="text-[10px] capitalize">
                      {c.channel === "web" ? t("companiesOrgId.website") : "WhatsApp"}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] capitalize">
                      {c.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("companiesOrgId.recentActivity")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {d.audit.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t("companiesOrgId.noRecordedActivityYet")}
                </p>
              )}
              {d.audit.map((a) => (
                <p key={a.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate font-medium">{a.action}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {a.actor_label ?? t("companiesOrgId.system")} ·{" "}
                    {formatMomentUnambiguous(a.created_at)}
                  </span>
                </p>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </main>
  );
}
