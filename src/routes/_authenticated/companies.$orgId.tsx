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

export const Route = createFileRoute("/_authenticated/companies/$orgId")({
  head: () => ({
    meta: [{ title: "Company workspace — Flas Manager" }, { name: "robots", content: "noindex" }],
  }),
  component: CompanyWorkspacePage,
});

/** Manager portal: one company -- its subscription, team access, and a read-only look inside. */
function CompanyWorkspacePage() {
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
      toast.success("Company data exported");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Export failed"),
  });

  if (!isSuperAdmin) {
    return (
      <main className="grid flex-1 place-items-center p-6">
        <p className="text-sm text-muted-foreground">
          This area is only available to the Flas platform manager.
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
          <ArrowLeft className="size-3.5" /> All companies
        </Link>
        <Button
          size="sm"
          variant="outline"
          className="gap-1"
          disabled={!d || exportMutation.isPending}
          onClick={() => exportMutation.mutate()}
        >
          <Download className="size-3.5" /> Export all data
        </Button>
      </div>

      <div className="mb-6 flex items-start gap-3 rounded-lg border border-brand/40 bg-brand-soft p-4">
        <Eye className="mt-0.5 size-5 shrink-0 text-brand" />
        <div>
          <p className="text-sm font-semibold">
            You are viewing {d?.org.name ?? "this company"}&apos;s workspace
          </p>
          <p className="text-xs text-muted-foreground">
            Their leads, conversations and activity are shown read-only. You can change their
            subscription and who has access. Every visit is recorded in the audit log.
          </p>
        </div>
      </div>

      {ws.isLoading && <p className="text-sm text-muted-foreground">Loading workspace…</p>}
      {ws.error && (
        <p className="text-sm text-destructive">
          {ws.error instanceof Error ? ws.error.message : "Could not load this workspace"}
        </p>
      )}

      {d && access && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">Subscription</CardTitle>
              <ManageSubscriptionDialog company={d.org} />
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{d.org.name}</span>
                <Badge variant="secondary">{planLabel(d.org.plan)}</Badge>
                <Badge variant="outline">{statusLabel(d.org.subscription_status)}</Badge>
                {d.org.suspended && <Badge variant="destructive">suspended</Badge>}
              </p>
              <p className="text-xs text-muted-foreground">
                Paid until {paidUntilText(d.org, now)} ·{" "}
                {billedBy(d.org) === "paddle" ? "pays by card (Paddle)" : "pays manually"}
              </p>
              <p
                className={`text-xs ${access.allowed ? "text-muted-foreground" : "font-medium text-destructive"}`}
              >
                {access.allowed ? "Has access." : `No access: ${access.reason}`}
              </p>
              <p className="text-xs text-muted-foreground">
                {d.org.slug} · joined {formatDayUnambiguous(d.org.created_at)}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Team ({d.staff.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Suspend one person without affecting the rest of the company.
              </p>
              <CompanyMembers orgId={orgId} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <MailCheck className="size-4 text-brand" /> Authentication email activity
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {d.authEmails.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No verification or recovery emails recorded yet.
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
                      {email.action_type === "signup"
                        ? "Account verification"
                        : "Password recovery"}{" "}
                      · attempt {email.attempt_number}
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
                Accepted means the email service accepted the request. Inbox delivery and opens are
                not reported.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Connected numbers</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {d.numbers.length === 0 && (
                <p className="text-sm text-muted-foreground">No WhatsApp numbers connected.</p>
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
                        default
                      </Badge>
                    )}
                    <Badge variant={n.active ? "outline" : "destructive"} className="text-[10px]">
                      {n.active ? "active" : "inactive"}
                    </Badge>
                  </span>
                </p>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent leads</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {d.leads.length === 0 && (
                <p className="text-sm text-muted-foreground">No leads captured yet.</p>
              )}
              {d.leads.map((l) => (
                <p key={l.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">
                    {l.name ?? l.email}{" "}
                    <span className="text-xs text-muted-foreground">via {l.source}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {l.consent_given && (
                      <Badge className="bg-brand text-[10px] text-brand-foreground">opted in</Badge>
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
              <CardTitle className="text-base">Recent conversations</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {d.conversations.length === 0 && (
                <p className="text-sm text-muted-foreground">No conversations yet.</p>
              )}
              {d.conversations.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{c.contacts?.name ?? "Unknown"}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {c.last_message_preview ?? "No messages"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Badge variant="secondary" className="text-[10px] capitalize">
                      {c.channel === "web" ? "Website" : "WhatsApp"}
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
              <CardTitle className="text-base">Recent activity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {d.audit.length === 0 && (
                <p className="text-sm text-muted-foreground">No recorded activity yet.</p>
              )}
              {d.audit.map((a) => (
                <p key={a.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate font-medium">{a.action}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {a.actor_label ?? "system"} · {formatMomentUnambiguous(a.created_at)}
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
