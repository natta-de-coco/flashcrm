import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getIntegrationLogs } from "@/lib/connections.functions";
import { useQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";

const ACTION_LABEL: Record<string, string> = {
  "connection.authorize_started": "Authorization started",
  "connection.connected": "Platform connected",
  "connection.disconnected": "Platform disconnected",
  "connection.scanned": "Flash profile scan",
  "site.activated": "Website plugin activated",
  "website.synced": "Website knowledge synced",
};

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
              <div key={row.id} className="flex items-start justify-between gap-3 border-b pb-2 text-xs last:border-0">
                <div className="min-w-0">
                  <p className="font-medium">{ACTION_LABEL[row.action] ?? row.action}</p>
                  <p className="truncate text-muted-foreground">
                    {row.actor_label ?? "System"}
                    {row.entity_id ? ` · ${row.entity_id}` : ""}
                  </p>
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
              <div key={row.id} className="flex items-start justify-between gap-3 border-b pb-2 text-xs last:border-0">
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
