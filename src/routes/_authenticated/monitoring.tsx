import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { retryWebhookEvent } from "@/lib/crm.functions";
import { getAnalyticsInsights, getWhatsAppAnalytics } from "@/lib/flash-ai.functions";
import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Loader2,
  RefreshCw,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/monitoring")({
  head: () => ({
    meta: [
      { title: "Webhook Monitoring — Flash CRM" },
      {
        name: "description",
        content:
          "Live WhatsApp webhook delivery status with event logs, one-click retries and failure alerts.",
      },
      { property: "og:title", content: "Webhook Monitoring — Flash CRM" },
      {
        property: "og:description",
        content: "Round-the-clock monitoring of WhatsApp webhook deliveries, retries and alerts.",
      },
    ],
  }),
  component: MonitoringPage,
});

type EventRow = {
  id: string;
  source: string;
  event_type: string;
  status: string;
  error: string | null;
  attempts: number;
  duration_ms: number | null;
  last_retry_at: string | null;
  created_at: string;
  payload: unknown;
};

type AlertRow = {
  id: string;
  severity: string;
  title: string;
  message: string | null;
  source: string;
  resolved: boolean;
  created_at: string;
};

const REFRESH_MS = 10000;

function MonitoringPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | "failed" | "processed">("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [insights, setInsights] = useState<string | null>(null);
  const retry = useServerFn(retryWebhookEvent);
  const fetchAnalytics = useServerFn(getWhatsAppAnalytics);
  const fetchInsights = useServerFn(getAnalyticsInsights);

  const waAnalytics = useQuery({
    queryKey: ["wa_analytics"],
    refetchInterval: 60000,
    queryFn: () => fetchAnalytics(),
  });

  const insightsMutation = useMutation({
    mutationFn: () => fetchInsights(),
    onSuccess: (res) => setInsights(res.insights),
    onError: (e: Error) => toast.error(e.message),
  });

  const events = useQuery({
    queryKey: ["webhook_events", filter],
    refetchInterval: REFRESH_MS,
    queryFn: async () => {
      let query = supabase
        .from("webhook_events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (filter !== "all") query = query.eq("status", filter);
      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as EventRow[];
    },
  });

  const alerts = useQuery({
    queryKey: ["system_alerts"],
    refetchInterval: REFRESH_MS,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("system_alerts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(40);
      if (error) throw error;
      return data as unknown as AlertRow[];
    },
  });

  const stats = useQuery({
    queryKey: ["webhook_stats"],
    refetchInterval: REFRESH_MS,
    queryFn: async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("webhook_events")
        .select("status, duration_ms, created_at")
        .gte("created_at", since);
      if (error) throw error;
      const rows = data ?? [];
      const failed = rows.filter((r) => r.status === "failed").length;
      const processed = rows.filter((r) => r.status === "processed").length;
      const durations = rows
        .map((r) => r.duration_ms)
        .filter((d): d is number => typeof d === "number");
      return {
        total: rows.length,
        failed,
        processed,
        successRate: rows.length ? Math.round((processed / rows.length) * 100) : 100,
        avgMs: durations.length
          ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
          : 0,
        lastEventAt: rows.length
          ? rows.map((r) => r.created_at).sort().slice(-1)[0]
          : null,
      };
    },
  });

  const retryMutation = useMutation({
    mutationFn: async (eventId: string) => retry({ data: { eventId } }),
    onSuccess: (res) => {
      if (res.ok) toast.success("Event reprocessed successfully");
      else toast.error(res.error ?? "Retry failed");
      void qc.invalidateQueries({ queryKey: ["webhook_events"] });
      void qc.invalidateQueries({ queryKey: ["webhook_stats"] });
      void qc.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function resolveAlert(id: string) {
    const { error } = await supabase.from("system_alerts").update({ resolved: true }).eq("id", id);
    if (error) toast.error(error.message);
    else void qc.invalidateQueries({ queryKey: ["system_alerts"] });
  }

  const openAlerts = (alerts.data ?? []).filter((a) => !a.resolved);

  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Webhook monitoring</h1>
          <p className="text-sm text-muted-foreground">
            Live delivery status for every WhatsApp event — refreshed automatically every 10 seconds.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void qc.invalidateQueries({ queryKey: ["webhook_events"] });
            void qc.invalidateQueries({ queryKey: ["webhook_stats"] });
            void qc.invalidateQueries({ queryKey: ["system_alerts"] });
          }}
        >
          <RefreshCw className="size-4" /> Refresh now
        </Button>
      </header>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Events (24h)", value: stats.data?.total ?? 0 },
          { label: "Success rate", value: `${stats.data?.successRate ?? 100}%` },
          { label: "Failures (24h)", value: stats.data?.failed ?? 0 },
          { label: "Avg processing", value: `${stats.data?.avgMs ?? 0} ms` },
        ].map((card) => (
          <Card key={card.label}>
            <CardHeader className="pb-2">
              <CardDescription>{card.label}</CardDescription>
              <CardTitle className="text-2xl">{card.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card className="mb-6">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <BarChart3 className="size-4 text-primary" />
                WhatsApp analytics — last {waAnalytics.data?.days ?? 30} days
              </CardTitle>
              <CardDescription>
                Delivery and engagement from your workspace, synced with Meta where available.
              </CardDescription>
            </div>
            <Button
              size="sm"
              onClick={() => insightsMutation.mutate()}
              disabled={insightsMutation.isPending || waAnalytics.isLoading}
            >
              {insightsMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              Ask Flash AI what to improve
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          {waAnalytics.isLoading && (
            <p className="text-sm text-muted-foreground">Crunching your messaging stats…</p>
          )}
          {waAnalytics.data && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[
                  { label: "Inbound messages", value: waAnalytics.data.totals.inbound },
                  { label: "Outbound messages", value: waAnalytics.data.totals.outbound },
                  {
                    label: "Delivered",
                    value: `${waAnalytics.data.totals.delivered + waAnalytics.data.totals.read}${
                      waAnalytics.data.totals.failed
                        ? ` (${waAnalytics.data.totals.failed} failed)`
                        : ""
                    }`,
                  },
                  {
                    label: "Read rate",
                    value: waAnalytics.data.totals.outbound
                      ? `${Math.round(
                          (waAnalytics.data.totals.read / waAnalytics.data.totals.outbound) * 100,
                        )}%`
                      : "—",
                  },
                  {
                    label: "Handled by bot",
                    value: waAnalytics.data.totals.outbound
                      ? `${Math.round(
                          (waAnalytics.data.totals.botReplies /
                            waAnalytics.data.totals.outbound) *
                            100,
                        )}%`
                      : "—",
                  },
                  {
                    label: "Avg first response",
                    value:
                      waAnalytics.data.avgFirstResponseMinutes != null
                        ? waAnalytics.data.avgFirstResponseMinutes >= 60
                          ? `${Math.round(waAnalytics.data.avgFirstResponseMinutes / 60)} h`
                          : `${waAnalytics.data.avgFirstResponseMinutes} min`
                        : "—",
                  },
                ].map((card) => (
                  <div key={card.label} className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">{card.label}</p>
                    <p className="text-xl font-bold">{card.value}</p>
                  </div>
                ))}
              </div>

              {waAnalytics.data.perNumber.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">Per WhatsApp number</p>
                  {waAnalytics.data.perNumber.map((n) => (
                    <div
                      key={n.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {n.label}
                          {n.display_phone ? (
                            <span className="font-normal text-muted-foreground">
                              {" "}
                              · {n.display_phone}
                            </span>
                          ) : null}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {n.local.conversations} conversations · {n.local.unread} unread
                        </p>
                      </div>
                      {n.meta.ok ? (
                        <div className="flex gap-2">
                          <Badge variant="secondary">Meta sent: {n.meta.sent}</Badge>
                          <Badge variant="secondary">Meta delivered: {n.meta.delivered}</Badge>
                        </div>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">
                          Meta analytics unavailable{n.meta.error ? ` — ${n.meta.error}` : ""}
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {insights && (
                <div className="rounded-lg border bg-muted/40 p-4">
                  <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
                    <Sparkles className="size-4 text-primary" /> Flash AI recommendations
                  </p>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                    {insights}
                  </p>
                </div>
              )}
              {!insights && !insightsMutation.isPending && (
                <p className="text-xs text-muted-foreground">
                  Tip: run “Ask Flash AI what to improve” to get a plain-English action plan based
                  on these numbers — deliverability, response time, bot balance and compliance.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="size-4 text-destructive" />
            Alerts
            {openAlerts.length > 0 && <Badge variant="destructive">{openAlerts.length} open</Badge>}
          </CardTitle>
          <CardDescription>
            Raised automatically whenever a webhook event or WhatsApp delivery fails.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {(alerts.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              No alerts — everything has been delivering cleanly.
            </p>
          )}
          {(alerts.data ?? []).map((alert) => (
            <div
              key={alert.id}
              className={cn(
                "flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3",
                alert.resolved && "opacity-60",
              )}
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  {alert.title}
                  <Badge
                    variant={alert.severity === "critical" ? "destructive" : "secondary"}
                    className="capitalize"
                  >
                    {alert.severity}
                  </Badge>
                </p>
                {alert.message && (
                  <p className="mt-0.5 break-words text-xs text-muted-foreground">{alert.message}</p>
                )}
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {new Date(alert.created_at).toLocaleString()}
                </p>
              </div>
              {alert.resolved ? (
                <Badge variant="secondary" className="gap-1">
                  <CheckCircle2 className="size-3" /> Resolved
                </Badge>
              ) : (
                <Button size="sm" variant="outline" onClick={() => void resolveAlert(alert.id)}>
                  Mark resolved
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <IncidentsCard />

      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Event log</CardTitle>
              <CardDescription>
                Last 100 webhook events. Failed events can be retried safely.
              </CardDescription>
            </div>
            <div className="flex gap-1">
              {(["all", "failed", "processed"] as const).map((f) => (
                <Button
                  key={f}
                  size="sm"
                  variant={filter === f ? "default" : "outline"}
                  className="capitalize"
                  onClick={() => setFilter(f)}
                >
                  {f}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {events.isLoading && <p className="text-sm text-muted-foreground">Loading events…</p>}
          {!events.isLoading && (events.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              No webhook events recorded yet. They appear here as soon as Meta starts posting.
            </p>
          )}
          {(events.data ?? []).map((event) => (
            <div key={event.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    <Badge
                      variant={event.status === "failed" ? "destructive" : "secondary"}
                      className="capitalize"
                    >
                      {event.status}
                    </Badge>
                    <span className="capitalize">{event.source}</span>
                    <span className="text-muted-foreground">· {event.event_type}</span>
                    {event.attempts > 1 && (
                      <span className="text-xs text-muted-foreground">
                        {event.attempts} attempts
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {new Date(event.created_at).toLocaleString()}
                    {event.duration_ms != null ? ` · ${event.duration_ms} ms` : ""}
                    {event.last_retry_at
                      ? ` · retried ${new Date(event.last_retry_at).toLocaleTimeString()}`
                      : ""}
                  </p>
                  {event.error && (
                    <p className="mt-1 break-words text-xs text-destructive">{event.error}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setExpanded(expanded === event.id ? null : event.id)}
                  >
                    {expanded === event.id ? "Hide payload" : "View payload"}
                  </Button>
                  {event.status === "failed" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={retryMutation.isPending}
                      onClick={() => retryMutation.mutate(event.id)}
                    >
                      {retryMutation.isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <RotateCcw className="size-4" />
                      )}
                      Retry
                    </Button>
                  )}
                </div>
              </div>
              {expanded === event.id && (
                <pre className="mt-3 max-h-64 overflow-auto rounded-md bg-muted p-3 text-[11px] leading-relaxed">
                  {JSON.stringify(event.payload, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
