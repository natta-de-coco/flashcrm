import { ManageSubscriptionDialog } from "@/components/manager/ManageSubscriptionDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { listSubscriptions, updatePlanThresholds } from "@/lib/companies.functions";
import { formatMomentUnambiguous } from "@/lib/locale";
import { listCompanyPresence } from "@/lib/presence.functions";
import {
  BUCKET_LABELS,
  billedBy,
  bucketOf,
  companyAccess,
  needsAttention,
  paidUntilText,
  planLabel,
  statusLabel,
  type Bucket,
} from "@/lib/subscription-admin";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ChevronRight, RefreshCw, Search } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

// An index route: companies.tsx used to be the parent of the company page,
// Errors and Subscribers, but never rendered an <Outlet />, so opening any of
// them changed the address and kept showing this list.
export const Route = createFileRoute("/_authenticated/companies/")({
  head: () => ({
    meta: [{ title: "Companies — Flas Manager" }, { name: "robots", content: "noindex" }],
  }),
  component: CompaniesPage,
});

type Filter = "attention" | "all" | Bucket;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "attention", label: "Needs attention" },
  { key: "all", label: "All" },
  { key: "paid", label: BUCKET_LABELS.paid },
  { key: "trial", label: BUCKET_LABELS.trial },
  { key: "expiring", label: BUCKET_LABELS.expiring },
  { key: "expired", label: BUCKET_LABELS.expired },
  { key: "past_due", label: BUCKET_LABELS.past_due },
  { key: "no_date", label: BUCKET_LABELS.no_date },
  { key: "canceled", label: BUCKET_LABELS.canceled },
  { key: "suspended", label: BUCKET_LABELS.suspended },
];

const BUCKET_STYLES: Record<Bucket, string> = {
  paid: "bg-emerald-100 text-emerald-800",
  trial: "bg-blue-100 text-blue-800",
  expiring: "bg-amber-100 text-amber-900",
  expired: "bg-red-100 text-red-800",
  past_due: "bg-red-100 text-red-800",
  no_date: "bg-slate-100 text-slate-700",
  canceled: "bg-slate-100 text-slate-700",
  suspended: "bg-red-600 text-white",
};

/** Manager portal -- super_admin only: every company, its subscription and access. */
function CompaniesPage() {
  const { isSuperAdmin } = useAuth();
  const load = useServerFn(listSubscriptions);
  const fetchPresence = useServerFn(listCompanyPresence);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  const companies = useQuery({
    queryKey: ["manager-subscriptions"],
    queryFn: () => load(),
    enabled: isSuperAdmin,
  });
  const presence = useQuery({
    queryKey: ["manager-presence"],
    queryFn: () => fetchPresence(),
    enabled: isSuperAdmin,
    refetchInterval: 30_000,
  });
  const onlineFor = (id: string) =>
    presence.data?.tenants.find((t) => t.tenantId === id)?.online ?? 0;

  if (!isSuperAdmin) {
    return (
      <main className="grid flex-1 place-items-center p-6">
        <p className="text-sm text-muted-foreground">
          This area is only available to the Flas platform manager.
        </p>
      </main>
    );
  }

  const now = new Date();
  const rows = (companies.data ?? []).map((c) => ({ ...c, bucket: bucketOf(c, now) }));

  const counts: Record<Filter, number> = {
    attention: 0,
    all: rows.length,
    paid: 0,
    trial: 0,
    expiring: 0,
    expired: 0,
    past_due: 0,
    no_date: 0,
    canceled: 0,
    suspended: 0,
  };
  for (const r of rows) {
    counts[r.bucket] += 1;
    if (needsAttention(r.bucket)) counts.attention += 1;
  }

  const q = search.trim().toLowerCase();
  const visible = rows
    .filter((r) =>
      filter === "all"
        ? true
        : filter === "attention"
          ? needsAttention(r.bucket)
          : r.bucket === filter,
    )
    .filter(
      (r) =>
        !q ||
        [r.name, r.slug, r.country ?? "", r.paddle_customer_id ?? ""].some((v) =>
          v.toLowerCase().includes(q),
        ),
    )
    // What needs a decision first, then the soonest paid-until date.
    .sort((a, b) => {
      const urgency = Number(!needsAttention(a.bucket)) - Number(!needsAttention(b.bucket));
      const at = a.subscription_renews_at ? Date.parse(a.subscription_renews_at) : Infinity;
      const bt = b.subscription_renews_at ? Date.parse(b.subscription_renews_at) : Infinity;
      return urgency || (at === bt ? 0 : at < bt ? -1 : 1) || a.name.localeCompare(b.name);
    });

  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Companies</h1>
          <p className="text-sm text-muted-foreground">
            Every workspace on Flas. Use Manage to record a payment, change a plan or status, or
            suspend a company. Open shows everything else about it.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1"
          disabled={companies.isFetching}
          onClick={() => void companies.refetch()}
        >
          <RefreshCw className={`size-3.5 ${companies.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {FILTERS.filter((f) => f.key === "all" || f.key === "attention" || counts[f.key] > 0).map(
          (f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                filter === f.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border hover:bg-muted"
              }`}
            >
              {f.label} <span className="ms-1 font-semibold">{counts[f.key]}</span>
            </button>
          ),
        )}
      </div>

      <div className="relative mb-3 max-w-md">
        <Search className="pointer-events-none absolute start-2.5 top-2.5 size-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by company, country or Paddle customer ID"
          aria-label="Search companies"
          className="ps-8"
        />
      </div>

      {companies.isLoading && <p className="text-sm text-muted-foreground">Loading companies…</p>}
      {companies.error && (
        <p className="text-sm text-destructive">
          {companies.error instanceof Error ? companies.error.message : "Could not load companies"}
        </p>
      )}

      {companies.data && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Company</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Paid until</TableHead>
                    <TableHead>Access</TableHead>
                    <TableHead>Team</TableHead>
                    <TableHead>Activity</TableHead>
                    <TableHead className="text-end">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        className="py-8 text-center text-sm text-muted-foreground"
                      >
                        {rows.length === 0
                          ? "No companies yet."
                          : "No companies match this filter or search."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    visible.map((c) => {
                      const access = companyAccess(c, now);
                      const online = onlineFor(c.id);
                      const status = statusLabel(c.subscription_status);
                      return (
                        <TableRow key={c.id}>
                          <TableCell>
                            <div className="font-medium">{c.name}</div>
                            <div className="text-[11px] text-muted-foreground">
                              {[
                                c.country,
                                billedBy(c) === "paddle" ? "Paddle (card)" : "Manual payment",
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </div>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs">
                            {planLabel(c.plan)}
                          </TableCell>
                          <TableCell>
                            <Badge className={BUCKET_STYLES[c.bucket]}>
                              {BUCKET_LABELS[c.bucket]}
                            </Badge>
                            {status !== BUCKET_LABELS[c.bucket] && (
                              <div className="mt-0.5 text-[11px] text-muted-foreground">
                                {status}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs">
                            {paidUntilText(c, now)}
                          </TableCell>
                          <TableCell className="text-xs">
                            {access.allowed ? (
                              <span className="text-emerald-700">Has access</span>
                            ) : (
                              <span className="font-medium text-destructive" title={access.reason}>
                                No access
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs">
                            {c.staff} {c.staff === 1 ? "person" : "people"}
                            {c.members_suspended > 0 && (
                              <span className="text-destructive">
                                {" "}
                                · {c.members_suspended} suspended
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                            {online > 0 ? (
                              <span className="text-emerald-700">{online} online now</span>
                            ) : c.last_active ? (
                              formatMomentUnambiguous(c.last_active)
                            ) : (
                              "never"
                            )}
                          </TableCell>
                          <TableCell className="text-end">
                            <div className="flex justify-end gap-1.5">
                              <ManageSubscriptionDialog company={c} />
                              <Button size="sm" variant="ghost" className="gap-0.5" asChild>
                                <Link
                                  to="/companies/$orgId"
                                  params={{ orgId: c.id }}
                                  aria-label={`Open ${c.name}`}
                                >
                                  Open <ChevronRight className="size-3.5" />
                                </Link>
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <PlanThresholds />
    </main>
  );
}

/** WhatsApp health alert defaults per plan -- rarely changed, so kept folded away. */
function PlanThresholds() {
  const savePlanThresholds = useServerFn(updatePlanThresholds);
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
  });
  const thresholdMutation = useMutation({
    mutationFn: (input: { plan: string; deliverabilityMin: number; readRateMin: number }) =>
      savePlanThresholds({ data: input }),
    onSuccess: () => toast.success("Plan thresholds saved"),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  return (
    <details className="mt-8 rounded-lg border p-4">
      <summary className="cursor-pointer text-sm font-semibold">
        WhatsApp health alert thresholds per plan
      </summary>
      <p className="mt-2 text-xs text-muted-foreground">
        Default deliverability and read-rate alert thresholds per subscription plan. Companies can
        override these per connected number in their own Settings.
      </p>
      <div className="mt-3 space-y-2">
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
      </div>
    </details>
  );
}
