import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  listCompanies,
  updateCompanyStatus,
  updatePlanThresholds,
} from "@/lib/companies.functions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Building2, Stethoscope } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/companies")({
  head: () => ({
    meta: [
      { title: "Companies — Flash Manager" },
      { name: "robots", content: "noindex" },
    ],
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

type StatusPatch = { subscriptionStatus?: "trial" | "active" | "past_due" | "canceled"; suspended?: boolean };

/** Manager portal — super_admin only: every company on the platform. */
function CompaniesPage() {
  const { isSuperAdmin } = useAuth();
  const qc = useQueryClient();
  const fetchCompanies = useServerFn(listCompanies);
  const saveStatus = useServerFn(updateCompanyStatus);
  const savePlanThresholds = useServerFn(updatePlanThresholds);

  const companies = useQuery({
    queryKey: ["manager-companies"],
    queryFn: () => fetchCompanies(),
    enabled: isSuperAdmin,
  });

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
      qc.invalidateQueries({ queryKey: ["manager-companies"] });
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
          This area is only available to the Flash platform manager.
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
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                <span>{org.slug}</span>
                <span>{org.users} users</span>
                <span>{org.leads} leads</span>
                <span>{org.conversations} chats</span>
                <span>
                  joined {new Date(org.created_at).toLocaleDateString()}
                  {org.subscription_renews_at
                    ? ` · renews ${new Date(org.subscription_renews_at).toLocaleDateString()}`
                    : ""}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" asChild>
                  <Link to="/companies/$orgId" params={{ orgId: org.id }}>
                    <Stethoscope className="size-3.5" /> Troubleshoot
                  </Link>
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
            </CardContent>
          </Card>
        ))}
      </div>
    </main>
  );
}
