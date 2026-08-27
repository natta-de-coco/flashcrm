// Application incident monitor: frontend crashes, failed server actions and
// blank-screen reports for this workspace only, with the route, session and
// user that hit them so support can reproduce fast.
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getErrorEvents } from "@/lib/telemetry.functions";
import { useQuery } from "@tanstack/react-query";
import { Bug } from "lucide-react";

const KIND_LABEL: Record<string, string> = {
  frontend: "Frontend error",
  server_action: "Server action failed",
  blank_screen: "Blank screen",
  network: "Network failure",
  error_boundary: "Screen crashed",
};

export function IncidentsCard() {
  const incidents = useQuery({
    queryKey: ["error-events"],
    queryFn: () => getErrorEvents(),
    refetchInterval: 60_000,
  });

  const events = incidents.data?.events ?? [];

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Bug className="size-4 text-primary" />
          Application incidents
          {events.length > 0 && <Badge variant="secondary">{events.length} recent</Badge>}
        </CardTitle>
        <CardDescription>
          Captured automatically with the page, session and user so nothing fails silently. Only
          your own workspace is shown.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {incidents.isLoading && <Skeleton className="h-16 w-full" />}
        {!incidents.isLoading && events.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No incidents recorded — the app has been running cleanly.
          </p>
        )}
        {events.slice(0, 25).map((event) => (
          <div key={event.id} className="rounded-lg border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold">
                {KIND_LABEL[event.kind] ?? event.kind}
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
      </CardContent>
    </Card>
  );
}
