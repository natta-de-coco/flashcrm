// Data & privacy controls: workspace data export (GDPR portability) and
// account/workspace deletion requests, recorded for compliance follow-up.
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Download, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const EXPORT_TABLES = [
  "contacts",
  "leads",
  "conversations",
  "messages",
  "campaigns",
  "products",
  "invoices",
  "content_posts",
  "seo_articles",
] as const;

export function DataPrivacyCard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [reason, setReason] = useState("");

  const requests = useQuery({
    queryKey: ["deletion-requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deletion_requests")
        .select("id, scope, status, created_at")
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data ?? [];
    },
  });

  const PAGE_SIZE = 1000;
  const MAX_PAGES = 50; // hard ceiling (50k rows/table) so a pathological tenant can't hang the browser

  /** Pages through every row instead of a flat .limit() — a flat cap silently
   *  dropped rows past it with no indication the export was incomplete. */
  async function fetchAllRows(
    table: (typeof EXPORT_TABLES)[number],
  ): Promise<{ rows: unknown[]; truncated: boolean }> {
    const rows: unknown[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const from = page * PAGE_SIZE;
      const { data, error } = await supabase
        .from(table)
        .select("*")
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(`${table}: ${error.message}`);
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE_SIZE) return { rows, truncated: false };
    }
    return { rows, truncated: true };
  }

  const exportAll = useMutation({
    mutationFn: async () => {
      const bundle: Record<string, unknown> = {
        exported_at: new Date().toISOString(),
        exported_by: user?.email ?? null,
      };
      const truncatedTables: string[] = [];
      for (const table of EXPORT_TABLES) {
        const { rows, truncated } = await fetchAllRows(table);
        bundle[table] = rows;
        if (truncated) truncatedTables.push(table);
      }
      bundle["truncated_tables"] = truncatedTables;
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `flash-crm-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      return truncatedTables;
    },
    onSuccess: (truncatedTables) => {
      if (truncatedTables.length > 0) {
        toast.warning(
          `Export downloaded, but ${truncatedTables.join(", ")} hit the ${MAX_PAGES * PAGE_SIZE}-row safety limit and may be incomplete. Contact support for a full export.`,
        );
      } else {
        toast.success("Export downloaded");
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const requestDeletion = useMutation({
    mutationFn: async (scope: "account" | "workspace") => {
      const { data: tenantId } = await supabase.rpc("current_tenant_id");
      const { error } = await supabase.from("deletion_requests").insert({
        tenant_id: tenantId as string,
        requested_by: user?.id ?? null,
        scope,
        target: user?.email ?? null,
        status: "pending",
        details: { reason: reason.trim() || null },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setReason("");
      toast.success("Deletion request submitted — we'll process it within 30 days.");
      void qc.invalidateQueries({ queryKey: ["deletion-requests"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Data &amp; privacy</CardTitle>
        <CardDescription>
          Export everything in this workspace, or ask us to delete it. See our{" "}
          <Link to="/privacy" className="underline">
            privacy policy
          </Link>{" "}
          and{" "}
          <Link to="/terms" className="underline">
            terms
          </Link>
          .
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => exportAll.mutate()}
            disabled={exportAll.isPending}
            className="gap-1.5"
          >
            <Download className="size-4" />
            {exportAll.isPending ? "Preparing export…" : "Download my data (JSON)"}
          </Button>
          <span className="text-xs text-muted-foreground">
            Contacts, leads, chats, campaigns, catalog, invoices and content.
          </span>
        </div>

        <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
            <ShieldAlert className="size-4" /> Delete data
          </p>
          <Label htmlFor="deletion-reason" className="text-xs text-muted-foreground">
            Reason (optional)
          </Label>
          <Textarea
            id="deletion-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Tell us why you're leaving so we can improve."
            rows={2}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={requestDeletion.isPending}
              onClick={() => {
                if (window.confirm("Request deletion of your personal account and its data?"))
                  requestDeletion.mutate("account");
              }}
            >
              Delete my account
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={requestDeletion.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    "Request deletion of the entire workspace, including all contacts, chats and campaigns? This cannot be undone once processed.",
                  )
                )
                  requestDeletion.mutate("workspace");
              }}
            >
              Delete workspace
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Requests are logged and processed within 30 days. Export your data first.
          </p>
        </div>

        {(requests.data ?? []).length > 0 && (
          <div className="space-y-1">
            {(requests.data ?? []).map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between rounded-md border px-3 py-2 text-xs"
              >
                <span className="capitalize">
                  {r.scope} deletion · {new Date(r.created_at).toLocaleDateString()}
                </span>
                <span className="capitalize text-muted-foreground">{r.status}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
