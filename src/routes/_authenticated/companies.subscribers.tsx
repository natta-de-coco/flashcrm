import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Building2, PauseCircle, PlayCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

/**
 * Super-admin only.  The single dashboard where the platform owner manages
 * every customer company on Flas: subscription status, activity, suspend /
 * resume, drill into any tenant's operational counters.
 *
 * Reads via the `list_subscribers()` SECURITY DEFINER RPC (which enforces
 * is_super_admin at query time — the page is a UI on top of that).  Suspending
 * a tenant flips `organizations.suspended` — protected by the guard trigger
 * that refuses to suspend an org whose owner is a locked super admin.
 */
export const Route = createFileRoute("/_authenticated/companies/subscribers")({
  head: () => ({
    meta: [
      { title: "Subscribers — Flas CRM (super admin)" },
      {
        name: "description",
        content: "Every customer company on Flas: plan, status, activity, suspend / resume.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SubscribersPage,
});

type Row = {
  tenant_id: string;
  company_name: string;
  slug: string;
  plan: string;
  subscription_status: string;
  subscription_renews_at: string | null;
  suspended: boolean;
  paddle_customer_id: string | null;
  paddle_subscription_id: string | null;
  country: string | null;
  currency: string | null;
  company_created_at: string;
  staff_count: number;
  active_wa_numbers: number;
  active_social_accounts: number;
  contacts_count: number;
  messages_count: number;
  last_message_at: string | null;
};

function statusBadge(row: Row) {
  if (row.suspended) return <Badge className="bg-red-100 text-red-800">suspended</Badge>;
  const s = row.subscription_status;
  const cls: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-800",
    trial: "bg-blue-100 text-blue-800",
    past_due: "bg-amber-100 text-amber-800",
    canceled: "bg-slate-100 text-slate-800",
  };
  return <Badge className={cls[s] ?? "bg-slate-100 text-slate-800"}>{s}</Badge>;
}

function SubscribersPage() {
  const { isSuperAdmin, loading } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [loadingRows, setLoadingRows] = useState(true);

  useEffect(() => {
    if (!loading && !isSuperAdmin) void navigate({ to: "/dashboard", replace: true });
  }, [loading, isSuperAdmin, navigate]);

  async function load() {
    setLoadingRows(true);
    const { data, error } = await supabase.rpc("list_subscribers");
    if (error) toast.error(error.message);
    setRows((data as Row[] | null) ?? []);
    setLoadingRows(false);
  }
  useEffect(() => {
    if (isSuperAdmin) void load();
  }, [isSuperAdmin]);

  async function suspend(row: Row, next: boolean) {
    const verb = next ? "Suspend" : "Reactivate";
    if (
      !confirm(
        `${verb} "${row.company_name}"? Their team will ${next ? "lose access immediately" : "regain access"}.`,
      )
    )
      return;
    const { error } = await supabase
      .from("organizations")
      .update({ suspended: next })
      .eq("id", row.tenant_id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${row.company_name} ${next ? "suspended" : "reactivated"}.`);
    await load();
  }

  if (loading || !isSuperAdmin) {
    return <main className="p-6 text-sm text-muted-foreground">Checking access…</main>;
  }

  const filtered = rows
    .filter((r) =>
      statusFilter === "all"
        ? true
        : statusFilter === "suspended"
          ? r.suspended
          : r.subscription_status === statusFilter && !r.suspended,
    )
    .filter(
      (r) =>
        !filter ||
        r.company_name.toLowerCase().includes(filter.toLowerCase()) ||
        (r.paddle_customer_id ?? "").toLowerCase().includes(filter.toLowerCase()) ||
        (r.country ?? "").toLowerCase().includes(filter.toLowerCase()),
    );

  const counts = {
    all: rows.length,
    active: rows.filter((r) => r.subscription_status === "active" && !r.suspended).length,
    trial: rows.filter((r) => r.subscription_status === "trial" && !r.suspended).length,
    past_due: rows.filter((r) => r.subscription_status === "past_due" && !r.suspended).length,
    canceled: rows.filter((r) => r.subscription_status === "canceled").length,
    suspended: rows.filter((r) => r.suspended).length,
  };

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Building2 className="size-6" /> Subscribers
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every customer company on Flas. Suspend / reactivate access, drill into activity,
            cross-reference against Paddle billing.
          </p>
        </div>
        <Button onClick={load} disabled={loadingRows} variant="outline">
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        {(["all", "active", "trial", "past_due", "canceled", "suspended"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setStatusFilter(k)}
            className={`rounded-md border px-3 py-2 text-left text-xs transition-colors ${
              statusFilter === k ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
            }`}
          >
            <div className="text-lg font-bold">{counts[k]}</div>
            <div className="capitalize text-muted-foreground">{k.replace("_", " ")}</div>
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Companies</CardTitle>
          <CardDescription>
            Filter by name, Paddle customer id, or country. Click any row to open that workspace.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="max-w-md"
          />
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Renews</TableHead>
                  <TableHead>Staff</TableHead>
                  <TableHead>WA #</TableHead>
                  <TableHead>Socials</TableHead>
                  <TableHead>Contacts</TableHead>
                  <TableHead>Msgs</TableHead>
                  <TableHead>Last activity</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center text-xs text-muted-foreground">
                      {loadingRows ? "Loading…" : "No subscribers matching this filter."}
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((r) => (
                    <TableRow key={r.tenant_id}>
                      <TableCell>
                        <button
                          className="text-left hover:underline"
                          onClick={() =>
                            navigate({ to: "/companies/$orgId", params: { orgId: r.tenant_id } })
                          }
                        >
                          <div className="font-medium">{r.company_name}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {r.country ?? "—"} · {r.currency ?? "—"} ·{" "}
                            {r.paddle_customer_id ?? "no-billing"}
                          </div>
                        </button>
                      </TableCell>
                      <TableCell className="text-xs">
                        <Badge variant="outline">{r.plan}</Badge>
                      </TableCell>
                      <TableCell>{statusBadge(r)}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {r.subscription_renews_at
                          ? new Date(r.subscription_renews_at).toLocaleDateString()
                          : "—"}
                      </TableCell>
                      <TableCell className="text-xs">{r.staff_count}</TableCell>
                      <TableCell className="text-xs">{r.active_wa_numbers}</TableCell>
                      <TableCell className="text-xs">{r.active_social_accounts}</TableCell>
                      <TableCell className="text-xs">{r.contacts_count}</TableCell>
                      <TableCell className="text-xs">{r.messages_count}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {r.last_message_at ? new Date(r.last_message_at).toLocaleString() : "never"}
                      </TableCell>
                      <TableCell>
                        {r.suspended ? (
                          <Button variant="outline" size="sm" onClick={() => suspend(r, false)}>
                            <PlayCircle className="mr-1 size-3" /> Reactivate
                          </Button>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={() => suspend(r, true)}>
                            <PauseCircle className="mr-1 size-3" /> Suspend
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <AlertTriangle className="size-3" />
            Suspending a company blocks their team's access instantly. Their data + WhatsApp inbox
            are retained; nothing is deleted. Locked super-admin workspaces are protected from
            suspension at the DB level and will surface a policy error if attempted.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
