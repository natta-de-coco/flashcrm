// Application incident monitor: frontend crashes, failed server actions and
// blank-screen reports for this workspace only, with the route, session and
// user that hit them so support can reproduce fast.
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getErrorEvents } from "@/lib/telemetry.functions";
import { useQuery } from "@tanstack/react-query";
import { Bug } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";

const KIND_LABEL: Record<string, string> = {
  frontend: "Frontend error",
  server_action: "Server action failed",
  blank_screen: "Blank screen",
  network: "Network failure",
  error_boundary: "Screen crashed",
};

const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;

type Incident = Awaited<ReturnType<typeof getErrorEvents>>["events"][number];

type IncidentGroup = {
  latest: Incident;
  count: number;
};

function groupIncidents(events: Incident[]): IncidentGroup[] {
  const grouped = new Map<string, IncidentGroup>();

  for (const event of events) {
    const key = `${event.kind}:${event.route ?? ""}:${event.message}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    grouped.set(key, { latest: event, count: 1 });
  }

  return [...grouped.values()];
}

export function IncidentsCard() {
  const { t, tr, tx } = useI18n();
  const incidents = useQuery({
    queryKey: ["error-events"],
    queryFn: () => getErrorEvents(),
    refetchInterval: 60_000,
  });

  const events = incidents.data?.events ?? [];
  const activeCutoff = Date.now() - ACTIVE_WINDOW_MS;
  const activeGroups = groupIncidents(
    events.filter((event) => new Date(event.created_at).getTime() >= activeCutoff),
  );
  const historicalCount =
    events.length - activeGroups.reduce((total, group) => total + group.count, 0);

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Bug className="size-4 text-primary" />
          {tr("incidentsCard.applicationIncidents", {
            badge: (
              <Badge variant={activeGroups.length > 0 ? "destructive" : "secondary"}>
                {activeGroups.length > 0
                  ? t("incidentsCard.active", { length: activeGroups.length })
                  : t("incidentsCard.healthy")}
              </Badge>
            ),
          })}
        </CardTitle>
        <CardDescription>{t("incidentsCard.activeMeansRecordedInThe")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {incidents.isLoading && <Skeleton className="h-16 w-full" />}
        {!incidents.isLoading && activeGroups.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t("incidentsCard.noIncidentsRecordedInThe")}
          </p>
        )}
        {activeGroups.slice(0, 25).map(({ latest: event, count }) => (
          <div
            key={`${event.kind}:${event.route ?? ""}:${event.message}`}
            className="rounded-lg border p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold">
                {tx(`incidentsCard.kind.${event.kind}`, KIND_LABEL[event.kind] ?? event.kind)}
                {count > 1 ? t("incidentsCard.repeatedTimes", { count: count }) : ""}
              </span>
              <Badge variant={event.severity === "error" ? "destructive" : "secondary"}>
                {event.severity}
              </Badge>
            </div>
            <p className="mt-1 break-words text-xs text-muted-foreground">{event.message}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {new Date(event.created_at).toLocaleString()}
              {event.route ? ` · ${event.route}` : ""}
              {event.user_email ? ` · ${event.user_email}` : ""}
            </p>
          </div>
        ))}
        {!incidents.isLoading && historicalCount > 0 && (
          <p className="pt-1 text-xs text-muted-foreground">
            {tr("incidentsCard.olderKeptInHistoryAnd", {
              historicalCount: historicalCount,
              value:
                historicalCount === 1
                  ? t("incidentsCard.incidentIs")
                  : t("incidentsCard.incidentsAre"),
            })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
