import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { listCompanies, updateCompanyStatus } from "@/lib/companies.functions";
import { useAuth } from "@/hooks/useAuth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Building2, PauseCircle, PlayCircle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/companies")({
  head: () => ({
    meta: [
      { title: "Companies — Flas Manager" },
      { name: "description", content: "Manage every company on the Flas WhatsApp platform." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CompaniesPage,
});

const STATUS_STYLES: Record<string, string> = {
  trial: "bg-secondary text-secondary-foreground",
  active: "bg-brand text-brand-foreground",
  past_due: "bg-destructive/10 text-destructive",
  canceled: "bg-muted text-muted-foreground",
};

/** Platform manager portal: every company, its subscription and usage. */
function CompaniesPage() {
  const { isSuperAdmin } = useAuth();
  const qc = useQueryClient();
  const listFn = useServerFn(listCompanies);
  const updateFn = useServerFn(updateCompanyStatus);

  const companies = useQuery({
    queryKey: ["companies"],
    queryFn: () => listFn(),
    enabled: isSuperAdmin,
  });

  const update = useMutation({
    mutationFn: (input: {
      organizationId: string;
      subscriptionStatus?: "trial" | "active" | "past_due" | "canceled";
      suspended?: boolean;
    }) => updateFn({ data: input }),
    onSuccess: () => {
      toast.success("Company updated");
      void qc.invalidateQueries({ queryKey: ["companies"] });
    },
    onError: (e: Error) => toast.error(e.message),
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
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Companies</h1>
        <p className="text-sm text-muted-foreground">
          Every workspace on the platform — Flash WhatsApp Tool, $20/month per company. Activate
          after payment, suspend on abuse or non-payment.
        </p>
      </header>

      <div className="grid gap-3">
        {(companies.data ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            {companies.isLoading ? "Loading companies…" : "No companies yet."}
          </p>
        )}
        {(companies.data ?? []).map((org) => (
          <Card key={org.id}>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <Building2 className="size-4 text-muted-foreground" />
                  {org.name}
                  <Badge className={STATUS_STYLES[org.subscription_status] ?? ""}>
                    {org.subscription_status}
                  </Badge>
                  {org.suspended && <Badge variant="destructive">suspended</Badge>}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {org.slug} · {org.users} users · {org.contacts} contacts · {org.leads} leads ·{" "}
                  {org.conversations} chats
                  {org.subscription_renews_at
                    ? ` · renews ${new Date(org.subscription_renews_at).toLocaleDateString()}`
                    : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {org.subscription_status !== "active" && (
                  <Button
                    size="sm"
                    onClick={() =>
                      update.mutate({ organizationId: org.id, subscriptionStatus: "active" })
                    }
                    disabled={update.isPending}
                  >
                    <PlayCircle className="size-4" /> Activate ($20/mo)
                  </Button>
                )}
                {org.subscription_status === "active" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      update.mutate({ organizationId: org.id, subscriptionStatus: "past_due" })
                    }
                    disabled={update.isPending}
                  >
                    Mark past due
                  </Button>
                )}
                <Button
                  size="sm"
                  variant={org.suspended ? "default" : "outline"}
                  onClick={() =>
                    update.mutate({ organizationId: org.id, suspended: !org.suspended })
                  }
                  disabled={update.isPending}
                >
                  <PauseCircle className="size-4" />
                  {org.suspended ? "Resume" : "Suspend"}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </main>
  );
}
