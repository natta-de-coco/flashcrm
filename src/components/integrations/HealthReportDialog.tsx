// Customer-facing Integration Health Report: one row per platform with status,
// last error, missing permissions and the next retry step — exportable as PDF
// or CSV, and able to run the automatic retry workflow on the spot.
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  encryptStoredCredentials,
  getIntegrationHealthReport,
  retryConnections,
} from "@/lib/connections.functions";
import { CONNECTOR_COUNTS, NON_OAUTH_CONNECTORS } from "@/lib/social-connector-definitions";
import { downloadHealthReportCsv, downloadHealthReportPdf } from "@/lib/integration-health";
import type { HealthRow } from "@/lib/integration-health";

/**
 * Counts come from the connector registry, so the grid and this dialog cannot
 * disagree. The catalogue and the health report used to report different
 * totals with no explanation of the gap.
 */
const KEYED_CONNECTORS = NON_OAUTH_CONNECTORS;
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, FileDown, RefreshCw, Stethoscope } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

const TONE: Record<string, string> = {
  connected: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  needs_verification: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  pending_review: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  expired: "bg-red-500/10 text-red-600 dark:text-red-400",
  failing: "bg-red-500/10 text-red-600 dark:text-red-400",
  not_connected: "bg-muted text-muted-foreground",
};

export function HealthReportDialog({ trigger }: { trigger?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const retry = useServerFn(retryConnections);

  const report = useQuery({
    queryKey: ["integration-health"],
    queryFn: () => getIntegrationHealthReport(),
    enabled: open,
  });

  const encrypt = useServerFn(encryptStoredCredentials);
  const sealing = useMutation({
    mutationFn: () => encrypt(),
    onSuccess: (result) => {
      toast.success(
        result.sealedNow
          ? `Encrypted ${result.sealedNow} stored credential(s).`
          : "Nothing needed encrypting.",
      );
      void qc.invalidateQueries({ queryKey: ["integration-health"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runRetry = useMutation({
    mutationFn: async (accountId?: string) => retry({ data: accountId ? { accountId } : {} }),
    onSuccess: (result) => {
      const results = result.results ?? [];
      if (results.length === 0) {
        toast.success("Nothing to retry — every connection is healthy.");
      } else {
        const recovered = results.filter((r) =>
          ["healthy", "recovered", "refreshed"].includes(r.outcome),
        ).length;
        toast.success(`Re-checked ${results.length} connection(s) — ${recovered} healthy now.`);
      }
      void qc.invalidateQueries({ queryKey: ["integration-health"] });
      void qc.invalidateQueries({ queryKey: ["connections"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const data = report.data;
  const attention = (data?.rows ?? []).filter(
    (r) => r.state !== "connected" && r.state !== "not_connected",
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" className="gap-1.5">
            <Stethoscope className="size-4" /> Health report
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>Integration Health Report</DialogTitle>
          <DialogDescription>
            {/* This said "every platform" while covering only the OAuth ones,
                so the totals here and on the connector grid disagreed and
                neither said why. Both numbers are derived from the catalogue
                now, so they cannot drift apart again. */}
            Status, last error, missing permissions and the next retry step for the{" "}
            {CONNECTOR_COUNTS.oauthPlatforms} API platform connectors that sign in with OAuth. The
            other {CONNECTOR_COUNTS.keyedOrPlugin} —{" "}
            {KEYED_CONNECTORS.map((c) => c.displayName).join(", ")} — connect with keys or a plugin
            rather than a login, so they are checked on their own cards instead. Export this and
            share it with whoever owns the account.
          </DialogDescription>
        </DialogHeader>

        {report.isLoading && (
          <div className="grid gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        )}

        {data && (
          <>
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge className={TONE["connected"]}>{data.connected} connected</Badge>
              <Badge className={TONE["failing"]}>{data.needs_attention} need attention</Badge>
              <Badge className={TONE["not_connected"]}>{data.not_connected} not connected</Badge>
            </div>

            {data.credentials ? (
              <p className="text-xs text-muted-foreground">
                {!data.credentials.configured
                  ? "Stored credentials are not encrypted: add TOKEN_ENCRYPTION_KEYS to the server's secrets."
                  : data.credentials.plaintext > 0
                    ? `${data.credentials.plaintext} stored credential(s) are not encrypted yet.`
                    : "Stored credentials are encrypted."}
                {data.credentials.configured && data.credentials.plaintext > 0 ? (
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto px-1 text-xs"
                    disabled={sealing.isPending}
                    onClick={() => sealing.mutate()}
                  >
                    {sealing.isPending ? "Encrypting…" : "Encrypt now"}
                  </Button>
                ) : null}
              </p>
            ) : null}

            <ScrollArea className="max-h-[52vh] pr-3">
              <div className="grid gap-2">
                {(attention.length > 0 ? attention : data.rows).map((row) => (
                  <HealthRowCard
                    key={row.platform}
                    row={row}
                    onRetry={() => runRetry.mutate(undefined)}
                    retrying={runRetry.isPending}
                  />
                ))}
              </div>

              {data.retries.length > 0 && (
                <div className="mt-4 grid gap-1.5">
                  <p className="text-sm font-semibold">Recent automatic retries</p>
                  {data.retries.slice(0, 8).map((r) => (
                    <p key={r.id} className="text-xs text-muted-foreground">
                      {new Date(r.created_at).toLocaleString()} · {r.platform.replace(/_/g, " ")} ·{" "}
                      <span className="font-medium">{r.outcome}</span>
                      {r.reason ? ` — ${r.reason}` : ""}
                    </p>
                  ))}
                </div>
              )}
            </ScrollArea>

            <DialogFooter className="flex-wrap gap-2 sm:justify-between">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                // Nothing to retry when every connection is healthy. The server
                // already handles that case gracefully, so this only saves a
                // pointless round trip -- but a button that looks actionable
                // and does nothing is its own small lie.
                disabled={runRetry.isPending || attention.length === 0}
                onClick={() => runRetry.mutate(undefined)}
              >
                <RefreshCw className={`size-4 ${runRetry.isPending ? "animate-spin" : ""}`} />
                Retry failing connections
              </Button>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => downloadHealthReportCsv(data)}
                >
                  <FileDown className="size-4" /> CSV
                </Button>
                <Button size="sm" className="gap-1.5" onClick={() => downloadHealthReportPdf(data)}>
                  <FileDown className="size-4" /> PDF
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function HealthRowCard({
  row,
  onRetry,
  retrying,
}: {
  row: HealthRow;
  onRetry: () => void;
  retrying: boolean;
}) {
  const good = row.state === "connected";
  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {good ? (
            <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
          ) : (
            <AlertTriangle className="size-4 shrink-0 text-amber-500" />
          )}
          <span className="truncate text-sm font-semibold">{row.platform_name}</span>
          {row.account_label && (
            <span className="truncate text-xs text-muted-foreground">{row.account_label}</span>
          )}
        </div>
        <Badge className={`${TONE[row.state] ?? TONE["not_connected"]} text-[11px]`}>
          {row.state_label}
        </Badge>
      </div>
      <p className="mt-2 break-words text-xs text-muted-foreground">{row.reason}</p>
      {row.last_error && (
        <p className="mt-1 break-words text-xs text-red-600 dark:text-red-400">
          Last error: {row.last_error}
        </p>
      )}
      {row.missing_permissions.length > 0 && (
        <p className="mt-1 break-words text-xs text-amber-600 dark:text-amber-400">
          Missing permissions: {row.missing_permissions.join(", ")}
        </p>
      )}
      <p className="mt-1 break-words text-xs">
        <span className="font-medium">Next step:</span> {row.next_step}
      </p>
      {!good && row.state !== "not_connected" && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 h-7 gap-1 px-2 text-xs"
          disabled={retrying}
          onClick={onRetry}
        >
          <RefreshCw className={`size-3.5 ${retrying ? "animate-spin" : ""}`} /> Retry now
        </Button>
      )}
    </div>
  );
}
