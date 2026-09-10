import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { CompanyMembers } from "@/components/manager/CompanyMembers";
import {
  listCompanies,
  listCompanyBilling,
  updateCompanyStatus,
  updatePlanThresholds,
} from "@/lib/companies.functions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { exportCompanyData, listCompanyPresence } from "@/lib/presence.functions";
import { useServerFn } from "@tanstack/react-start";
import { Building2, CalendarClock, Circle, Download, Stethoscope, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { formatDayUnambiguous, formatMomentUnambiguous, isoDayLocal } from "@/lib/locale";

export const Route = createFileRoute("/_authenticated/companies")({
  head: () => ({
    meta: [{ title: "Companies — Flas Manager" }, { name: "robots", content: "noindex" }],
  }),
  component: CompaniesPage,
});

const STATUS_STYLES: Record<string, string> = {
  active: "bg-brand text-brand-foreground",
  trialing: "bg-brand-soft text-brand",
  trial: "bg-brand-soft text-brand",
  past_due: "bg-secondary text-secondary-foreground",
  canceled: "bg-muted text-muted-foreground",
  none: "bg-muted text-muted-foreground",
};

type StatusPatch = {
  subscriptionStatus?: "trial" | "active" | "past_due" | "canceled";
  suspended?: boolean;
  paidUntil?: string;
};

/** How the paid-until date reads at a glance, before any numbers are parsed. */
const BILLING_STYLES: Record<string, string> = {
  paid: "bg-brand text-brand-foreground",
  "expiring soon": "bg-amber-500 text-white",
  expired: "bg-destructive text-destructive-foreground",
  suspended: "bg-destructive text-destructive-foreground",
  "no billing set": "bg-muted text-muted-foreground",
};

/** Manager portal — super_admin only: every company on the platform. */
function CompaniesPage() {
  const { isSuperAdmin } = useAuth();
  const qc = useQueryClient();
  const fetchCompanies = useServerFn(listCompanies);
  const saveStatus = useServerFn(updateCompanyStatus);
  const savePlanThresholds = useServerFn(updatePlanThresholds);
  const fetchPresence = useServerFn(listCompanyPresence);
  const runExport = useServerFn(exportCompanyData);

  const presence = useQuery({
    queryKey: ["manager-presence"],
    queryFn: () => fetchPresence(),
    enabled: isSuperAdmin,
    refetchInterval: 30_000,
  });
  const presenceFor = (tenantId: string) =>
    presence.data?.tenants.find((t) => t.tenantId === tenantId);

  const exportMutation = useMutation({
    mutationFn: (input: { organizationId: string; name: string }) =>
      runExport({ data: { organizationId: input.organizationId } }),
    onSuccess: (payload, input) => {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `flash-${input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-data.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Company data exported");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Export failed"),
  });

  const companies = useQuery({
    queryKey: ["manager-companies"],
    queryFn: () => fetchCompanies(),
    enabled: isSuperAdmin,
  });

  // Billing comes from company_billing_overview, which computes the state in
  // the database rather than leaving every caller to derive "expired" from a
  // timestamp and get it subtly different.
  const fetchBilling = useServerFn(listCompanyBilling);
  const billing = useQuery({
    queryKey: ["manager-billing"],
    queryFn: () => fetchBilling(),
    enabled: isSuperAdmin,
  });
  const billingFor = (id: string) => billing.data?.find((b) => b.id === id);

  const [openTeam, setOpenTeam] = useState<string | null>(null);

  const thresholds = useQuery({
    queryKey: ["plan_thresholds"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plan_thresholds")
        .select("plan, deliverability_min, read_rate_min")
        .order("plan");
      if (error) throw error;
      return data ?? [];
    },
    enabled: isSuperAdmin,
  });

  const statusMutation = useMutation({
    mutationFn: (input: { organizationId: string } & StatusPatch) => saveStatus({ data: input }),
    onSuccess: () => {
      toast.success("Company updated");
      void qc.invalidateQueries({ queryKey: ["manager-companies"] });
      void qc.invalidateQueries({ queryKey: ["manager-billing"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed"),
  });

  const thresholdMutation = useMutation({
    mutationFn: (input: { plan: string; deliverabilityMin: number; readRateMin: number }) =>
      savePlanThresholds({ data: input }),
    onSuccess: () => toast.success("Plan thresholds saved"),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
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

  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold tracking-tight">Companies</h1>
        <p className="text-sm text-muted-foreground">
          Every workspace on the platform. Activate manual (cash) customers, suspend abuse, and
          troubleshoot a company's workspace.
        </p>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Who is online right now</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">
            A company counts as online when one of its team members was active in Flas in the last 5
            minutes.
          </p>
          {(presence.data?.tenants ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
          )}
          {(presence.data?.tenants ?? []).map((t) => {
            const org = (companies.data ?? []).find((c) => c.id === t.tenantId);
            return (
              <div
                key={t.tenantId}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border p-3 text-sm"
              >
                <Circle
                  className={
                    t.online > 0
                      ? "size-2.5 fill-brand text-brand"
                      : "size-2.5 fill-muted-foreground/40 text-muted-foreground/40"
                  }
                />
                <span className="font-medium">{org?.name ?? t.tenantId.slice(0, 8)}</span>
                <span className="text-xs text-muted-foreground">
                  {t.online > 0 ? `${t.online} online now` : "offline"} · {t.users} team members
                  {t.lastSeenAt ? ` · last seen ${formatMomentUnambiguous(t.lastSeenAt)}` : ""}
                </span>
                {t.lastActions[0] && (
                  <span className="text-xs text-muted-foreground">
                    latest: {t.lastActions[0].action}
                  </span>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Plan health thresholds</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Default deliverability and read-rate alert thresholds per subscription plan. Companies
            can override these per connected number in their own Settings.
          </p>
          {(thresholds.data ?? []).map((t) => (
            <div
              key={t.plan}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border p-3 text-sm"
            >
              <span className="w-24 font-semibold capitalize">{t.plan}</span>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                Deliverability
                <Input
                  type="number"
                  min={0}
                  max={100}
                  className="h-7 w-16 px-2 text-xs"
                  defaultValue={Number(t.deliverability_min)}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v) && v !== Number(t.deliverability_min)) {
                      thresholdMutation.mutate({
                        plan: t.plan,
                        deliverabilityMin: v,
                        readRateMin: Number(t.read_rate_min),
                      });
                    }
                  }}
                />
                %
              </label>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                Read rate
                <Input
                  type="number"
                  min={0}
                  max={100}
                  className="h-7 w-16 px-2 text-xs"
                  defaultValue={Number(t.read_rate_min)}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v) && v !== Number(t.read_rate_min)) {
                      thresholdMutation.mutate({
                        plan: t.plan,
                        deliverabilityMin: Number(t.deliverability_min),
                        readRateMin: v,
                      });
                    }
                  }}
                />
                %
              </label>
            </div>
          ))}
        </CardContent>
      </Card>

      {companies.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {companies.error && (
        <p className="text-sm text-destructive">
          {companies.error instanceof Error ? companies.error.message : "Could not load companies"}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {(companies.data ?? []).map((org) => (
          <Card key={org.id}>
            <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
              <div className="flex items-center gap-2">
                <Building2 className="size-4 text-muted-foreground" />
                <CardTitle className="text-base">{org.name}</CardTitle>
              </div>
              <div className="flex items-center gap-1.5">
                <Badge variant="secondary" className="capitalize">
                  {org.plan}
                </Badge>
                <Badge className={STATUS_STYLES[org.subscription_status] ?? STATUS_STYLES["none"]}>
                  {org.subscription_status}
                </Badge>
                {org.suspended && <Badge variant="destructive">suspended</Badge>}
                {billingFor(org.id)?.billing_state && !org.suspended && (
                  <Badge
                    className={
                      BILLING_STYLES[billingFor(org.id)!.billing_state!] ??
                      BILLING_STYLES["no billing set"]
                    }
                  >
                    {billingFor(org.id)!.billing_state}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                <span>{org.slug}</span>
                <span>{org.users} users</span>
                <span>
                  {(presenceFor(org.id)?.online ?? 0) > 0
                    ? `${presenceFor(org.id)?.online} online`
                    : "offline"}
                </span>
                <span>{org.leads} leads</span>
                <span>{org.conversations} chats</span>
                <span>joined {formatDayUnambiguous(org.created_at)}</span>
                {(billingFor(org.id)?.members_suspended ?? 0) > 0 && (
                  <span className="font-medium text-destructive">
                    {billingFor(org.id)!.members_suspended} suspended
                  </span>
                )}
              </div>
              {/* "Have they paid, and until when?" -- stated plainly, and
                  editable in place, because a cash customer who paid for a
                  year was previously recorded as lapsing in thirty days. */}
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-2.5 text-xs">
                <CalendarClock className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="font-medium">Paid until</span>
                <Input
                  type="date"
                  aria-label={`Date ${org.name} has paid until`}
                  className="h-7 w-36 px-2 text-xs"
                  defaultValue={
                    org.subscription_renews_at
                      ? isoDayLocal(org.subscription_renews_at)
                      : ""
                  }
                  onBlur={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    const current = org.subscription_renews_at
                      ? isoDayLocal(org.subscription_renews_at)
                      : "";
                    if (v !== current) {
                      statusMutation.mutate({ organizationId: org.id, paidUntil: v });
                    }
                  }}
                />
                {(() => {
                  const b = billingFor(org.id);
                  if (!b?.paid_until) {
                    return <span className="text-muted-foreground">not recorded</span>;
                  }
                  const days = b.days_remaining ?? 0;
                  return (
                    <span
                      className={days === 0 ? "font-medium text-destructive" : "text-muted-foreground"}
                    >
                      {days === 0 ? "lapsed" : `${days} day${days === 1 ? "" : "s"} left`}
                    </span>
                  );
                })()}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setOpenTeam(openTeam === org.id ? null : org.id)}
                >
                  <Users className="size-3.5" />
                  {openTeam === org.id ? "Hide users" : `Manage users (${org.users})`}
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link to="/companies/$orgId" params={{ orgId: org.id }}>
                    <Stethoscope className="size-3.5" /> Troubleshoot
                  </Link>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={exportMutation.isPending}
                  onClick={() => exportMutation.mutate({ organizationId: org.id, name: org.name })}
                >
                  <Download className="size-3.5" /> Export all data
                </Button>
                {org.subscription_status !== "active" && (
                  <Button
                    size="sm"
                    onClick={() =>
                      statusMutation.mutate({
                        organizationId: org.id,
                        subscriptionStatus: "active",
                      })
                    }
                  >
                    Activate (manual payment)
                  </Button>
                )}
                {org.suspended ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      statusMutation.mutate({ organizationId: org.id, suspended: false })
                    }
                  >
                    Unsuspend
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() =>
                      statusMutation.mutate({ organizationId: org.id, suspended: true })
                    }
                  >
                    Suspend
                  </Button>
                )}
              </div>

              {openTeam === org.id && <CompanyMembers orgId={org.id} />}
            </CardContent>
          </Card>
        ))}
      </div>
    </main>
  );
}
