import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getIntegrationLogs } from "@/lib/connections.functions";
import { useQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";

const ACTION_LABEL: Record<string, string> = {
  "connection.authorize_started": "Authorization started",
  // The OAuth callback records how each attempt ended. None of these were
  // mapped, so a run of failures rendered as a run of identical "started"
  // rows with no outcome and no reason -- the single most common support
  // question about connecting a channel.
  "connection.authorize_succeeded": "Authorization succeeded",
  "connection.authorize_failed": "Authorization failed",
  "connection.authorize_expired": "Authorization link expired",
  "connection.authorize_cancelled": "Authorization cancelled",
  "connection.authorize_blocked": "Could not start authorization",
  "connection.platform_app_saved": "Platform app keys saved",
  "connection.connected": "Platform connected",
  "connection.disconnected": "Platform disconnected",
  "connection.scanned": "Flas profile scan",
  "site.activated": "Website plugin activated",
  "website.synced": "Website knowledge synced",
};

const FAILED_ACTIONS = new Set([
  "connection.authorize_failed",
  "connection.authorize_expired",
  "connection.authorize_cancelled",
  "connection.authorize_blocked",
]);

/**
 * The human-readable reason stored alongside an audit row.
 *
 * It is written by the OAuth callback and already passed through
 * redactSecrets, so it is safe to display; it was simply never read.
 */
function reasonOf(details: unknown): string | null {
  if (!details || typeof details !== "object") return null;
  const reason = (details as { reason?: unknown }).reason;
  return typeof reason === "string" && reason.trim() ? reason : null;
}

/** Everything that happened across integrations — newest first. */
export function IntegrationLogs() {
  const logs = useQuery({
    queryKey: ["integration-logs"],
    queryFn: () => getIntegrationLogs(),
    refetchInterval: 60_000,
  });

  return (
    <section id="logs" className="grid gap-3">
      <div className="flex items-center gap-2">
        <ScrollText className="size-4 text-primary" />
        <h2 className="text-lg font-semibold">Integration logs</h2>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Connection activity</CardTitle>
            <CardDescription className="text-xs">
              Who connected, scanned or disconnected what — kept for compliance.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {logs.isLoading && <Skeleton className="h-24 w-full" />}
            {!logs.isLoading && (logs.data?.audit.length ?? 0) === 0 && (
              <p className="text-sm text-muted-foreground">
                No integration activity yet. Connect a platform above and it shows up here.
              </p>
            )}
            {logs.data?.audit.map((row) => (
              <div
                key={row.id}
                className="flex items-start justify-between gap-3 border-b pb-2 text-xs last:border-0"
              >
                <div className="min-w-0">
                  <p
                    className={
                      FAILED_ACTIONS.has(row.action) ? "font-medium text-destructive" : "font-medium"
                    }
                  >
                    {ACTION_LABEL[row.action] ?? row.action}
                  </p>
                  <p className="truncate text-muted-foreground">
                    {row.actor_label ?? "System"}
                    {row.entity_id ? ` · ${row.entity_id}` : ""}
                  </p>
                  {reasonOf(row.details) && (
                    <p className="mt-0.5 text-muted-foreground">{reasonOf(row.details)}</p>
                  )}
                </div>
                <span className="shrink-0 text-muted-foreground">
                  {new Date(row.created_at).toLocaleString()}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Incoming webhooks</CardTitle>
            <CardDescription className="text-xs">
              WhatsApp, plugin and platform callbacks with delivery status.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {logs.isLoading && <Skeleton className="h-24 w-full" />}
            {!logs.isLoading && (logs.data?.webhooks.length ?? 0) === 0 && (
              <p className="text-sm text-muted-foreground">No webhook traffic recorded yet.</p>
            )}
            {logs.data?.webhooks.map((row) => (
              <div
                key={row.id}
                className="flex items-start justify-between gap-3 border-b pb-2 text-xs last:border-0"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {row.source} · {row.event_type}
                  </p>
                  {row.error && <p className="truncate text-destructive">{row.error}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge
                    variant={
                      row.status === "processed"
                        ? "default"
                        : row.status === "failed"
                          ? "destructive"
                          : "secondary"
                    }
                    className="text-[10px]"
                  >
                    {row.status}
                  </Badge>
                  <span className="text-muted-foreground">
                    {new Date(row.created_at).toLocaleString()}
                  </span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
