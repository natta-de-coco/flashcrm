import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { getDashboardOverview } from "@/lib/dashboard.functions";
import { getDailyBrief } from "@/lib/brief.functions";
import type { BusinessHealth, Trend } from "@/lib/dashboard.server";
import { getMetaSyncHealth } from "@/lib/meta-health.functions";
import { usePersistentTimestamp } from "@/hooks/usePersistentTimestamp";
import { logWidgetError } from "@/lib/widget-error-log";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Facebook,
  Inbox,
  Instagram,
  Linkedin,
  MessageSquare,
  Music2,
  RefreshCw,
  Sparkles,
  Store,
  TrendingDown,
  TrendingUp,
  Twitter,
  Users,
  XCircle,
  Youtube,
  type LucideIcon,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Flas CRM" },
      {
        name: "description",
        content: "Live overview of WhatsApp conversations, leads and chatbot activity.",
      },
      { property: "og:title", content: "Dashboard — Flas CRM" },
      {
        property: "og:description",
        content: "Live overview of WhatsApp conversations, leads and chatbot activity.",
      },
    ],
  }),
  component: DashboardPage,
});

const PLATFORM_ICONS: Record<string, LucideIcon> = {
  instagram: Instagram,
  facebook: Facebook,
  youtube: Youtube,
  twitter: Twitter,
  linkedin: Linkedin,
  tiktok: Music2,
  google_business: Store,
};

const activityConfig = {
  received: { label: "Received", color: "var(--color-chart-1)" },
  sent: { label: "Sent by you & AI", color: "var(--color-chart-2)" },
} satisfies ChartConfig;

/** Helpful inline error state with a retry button — never a blank widget. */
function WidgetError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center">
      <AlertTriangle className="size-5 text-destructive" />
      <p className="text-sm font-medium">Couldn't load this widget</p>
      <p className="max-w-xs text-xs text-muted-foreground">{message}</p>
      <Button
        size="sm"
        variant="outline"
        className="mt-1 gap-1.5"
        onClick={onRetry}
        aria-label="Retry this widget"
      >
        <RefreshCw className="size-3.5" /> Retry this widget
      </Button>
    </div>
  );
}

function StatCardsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i}>
          <CardContent className="flex items-center gap-4 pt-6">
            <Skeleton className="size-10 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-6 w-14" />
              <Skeleton className="h-3 w-24" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="space-y-3">
      <div className="flex items-end gap-3">
        {[40, 65, 30, 80, 55, 70, 45].map((h, i) => (
          <Skeleton key={i} className="w-full" style={{ height: `${h * 2}px` }} />
        ))}
      </div>
      <Skeleton className="h-3 w-40" />
    </div>
  );
}

function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg border p-3">
          <Skeleton className="size-8 shrink-0 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** Week-over-week change pill: up is good, flat and unknown stay neutral. */
function TrendPill({ trend, label }: { trend?: Trend | undefined; label?: string | undefined }) {
  if (!trend) return null;
  if (trend.changePct === null) {
    return (
      <p className="mt-1 truncate text-[11px] text-muted-foreground">
        {trend.current} {label ?? "this week"}
      </p>
    );
  }
  const up = trend.changePct >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <p
      className={`mt-1 flex items-center gap-1 truncate text-[11px] ${
        up ? "text-brand" : "text-destructive"
      }`}
    >
      <Icon className="size-3 shrink-0" />
      {up ? "+" : ""}
      {trend.changePct}%
      <span className="truncate text-muted-foreground">{label ?? "vs last week"}</span>
    </p>
  );
}

/** Business Health Score: one weighted number plus the factors behind it. */
function HealthCard({ health }: { health: BusinessHealth }) {
  const tone =
    health.score >= 85
      ? "text-brand"
      : health.score >= 70
        ? "text-brand"
        : health.score >= 50
          ? "text-amber-600 dark:text-amber-400"
          : "text-destructive";
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between">
        <div>
          <CardTitle className="text-base">Business health score</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Responsiveness, inbox, leads, social and compliance combined.
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className={`text-3xl font-bold leading-none ${tone}`}>{health.score}</p>
          <p className="text-[11px] text-muted-foreground">{health.grade}</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {health.factors.map((f) => (
          <div key={f.key}>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-medium">{f.label}</span>
              <span className="text-muted-foreground">{f.score}/100</span>
            </div>
            <Progress value={f.score} className="mt-1 h-1.5" />
            <p className="mt-1 truncate text-[11px] text-muted-foreground">{f.detail}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function DashboardPage() {
  const overviewFn = useServerFn(getDashboardOverview);
  const overview = useQuery({
    queryKey: ["dashboard-overview"],
    queryFn: () => overviewFn(),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: 2,
    // Progressive loading: skeletons show only until the first response
    // lands; afterwards the previous data stays visible while refreshing.
    placeholderData: keepPreviousData,
  });

  const metaHealthFn = useServerFn(getMetaSyncHealth);
  const metaHealth = useQuery({
    queryKey: ["meta_sync_health"],
    queryFn: () => metaHealthFn(),
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: 2,
    placeholderData: keepPreviousData,
  });

  // Flas AI daily brief — generated once per day per workspace on the server and
  // reused on every refresh, so loading it on mount costs at most one model call a day.
  const briefFn = useServerFn(getDailyBrief);
  const brief = useQuery({
    queryKey: ["dashboard-daily-brief"],
    queryFn: () => briefFn({ data: {} }),
    staleTime: 60 * 60_000,
    refetchOnWindowFocus: false,
    retry: 0,
  });
  const qc = useQueryClient();
  const regenerateBrief = useMutation({
    mutationFn: () => briefFn({ data: { force: true } }),
    onSuccess: (data) => {
      qc.setQueryData(["dashboard-daily-brief"], data);
    },
  });
  const briefBusy = brief.isFetching || regenerateBrief.isPending;

  // Widget error logging — report each distinct failure once per message so
  // slow/flaky endpoints are visible in function logs and the audit trail.
  const loggedRef = useRef<Record<string, string>>({});
  useEffect(() => {
    const err = overview.error;
    if (overview.isError && err && loggedRef.current["overview"] !== err.message) {
      loggedRef.current["overview"] = err.message;
      logWidgetError("dashboard-overview", "getDashboardOverview", err);
    }
  }, [overview.isError, overview.error]);

  useEffect(() => {
    const err = metaHealth.error;
    if (metaHealth.isError && err && loggedRef.current["meta"] !== err.message) {
      loggedRef.current["meta"] = err.message;
      logWidgetError("meta-sync", "getMetaSyncHealth", err);
    }
  }, [metaHealth.isError, metaHealth.error]);

  const refreshing = overview.isRefetching || metaHealth.isRefetching;
  const refreshAll = () => {
    void overview.refetch();
    void metaHealth.refetch();
  };
  // Persisted per-widget timestamps: survive reloads, replaced only after the
  // next successful refresh of that widget's endpoint.
  const overviewUpdatedAt = usePersistentTimestamp(
    "flashdash:overview-updated-at",
    overview.dataUpdatedAt,
  );
  const metaUpdatedAt = usePersistentTimestamp(
    "flashdash:meta-updated-at",
    metaHealth.dataUpdatedAt,
  );

  const data = overview.data;
  const stats = [
    {
      label: "Open conversations",
      value: data?.stats.open ?? 0,
      icon: Inbox,
      trend: data?.trends.inbound,
      trendLabel: "inbound vs last week",
    },
    {
      label: "Unread messages",
      value: data?.stats.unread ?? 0,
      icon: MessageSquare,
      trend: undefined,
      trendLabel: undefined,
    },
    {
      label: "Contacts",
      value: data?.stats.contacts ?? 0,
      icon: Users,
      trend: data?.trends.leads,
      trendLabel: "new leads vs last week",
    },
    {
      label: "Bot replies",
      value: data?.stats.botReplies ?? 0,
      icon: Bot,
      trend: data?.trends.replies,
      trendLabel: "replies sent vs last week",
    },
  ];

  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Everything happening across WhatsApp, your website widget and your pipeline.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={refreshAll}
            disabled={refreshing}
          >
            <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <span className="text-[11px] text-muted-foreground">
            {overviewUpdatedAt ? `Updated ${overviewUpdatedAt}` : "Loading…"}
          </span>
        </div>
      </header>

      {/* Stat cards */}
      {overview.isLoading ? (
        <StatCardsSkeleton />
      ) : overview.isError ? (
        <Card>
          <CardContent className="pt-6">
            <WidgetError
              message={overview.error.message}
              onRetry={() => overview.refetch()}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {stats.map((s) => (
            <Card key={s.label}>
              <CardContent className="flex items-center gap-4 pt-6">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
                  <s.icon className="size-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-2xl font-bold leading-none">{s.value}</p>
                  <p className="truncate text-xs text-muted-foreground">{s.label}</p>
                  <TrendPill trend={s.trend} label={s.trendLabel} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Flas AI daily brief + business health score */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="size-4 text-brand" /> Flas AI daily brief
              </CardTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">
                What changed this week and the three things worth doing today.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 gap-1.5"
              onClick={() => regenerateBrief.mutate()}
              disabled={briefBusy}
            >
              <RefreshCw className={`size-3.5 ${briefBusy ? "animate-spin" : ""}`} />
              {brief.data ? "Regenerate" : "Generate brief"}
            </Button>
          </CardHeader>
          <CardContent>
            {briefBusy ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-56" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            ) : brief.isError ? (
              <WidgetError message={brief.error.message} onRetry={() => brief.refetch()} />
            ) : brief.data ? (
              <div className="space-y-3">
                <p className="text-sm font-semibold">{brief.data.headline}</p>
                <p className="text-sm text-muted-foreground">{brief.data.summary}</p>
                {brief.data.actions.length > 0 && (
                  <ul className="space-y-1.5">
                    {brief.data.actions.map((a) => (
                      <li key={a} className="flex items-start gap-2 text-sm">
                        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-brand" />
                        <span>{a}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-[11px] text-muted-foreground">
                  {brief.data.cached ? "Today's brief, generated" : "Generated"}{" "}
                  {new Date(brief.data.generatedAt).toLocaleTimeString()}
                  {brief.data.cached ? " · reused until tomorrow" : ""}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Ask Flas AI to read this week's numbers and tell you where to focus.
              </p>
            )}
          </CardContent>
        </Card>

        {overview.isLoading || !data ? (
          <Card>
            <CardContent className="space-y-3 pt-6">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </CardContent>
          </Card>
        ) : (
          <HealthCard health={data.health} />
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {/* 7-day activity chart */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">7-day activity</CardTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {data
                  ? `${data.activity.weekTotal} messages this week · ${data.activity.todayTotal} today`
                  : "Messages across the last 7 days"}
              </p>
            </div>
            <Link to="/inbox" className="text-xs font-medium text-brand hover:underline">
              Open inbox
            </Link>
          </CardHeader>
          <CardContent>
            {overview.isLoading ? (
              <ChartSkeleton />
            ) : overview.isError ? (
              <WidgetError
                message={overview.error.message}
                onRetry={() => overview.refetch()}
              />
            ) : (
              <ChartContainer config={activityConfig} className="h-56 w-full aspect-auto">
                <BarChart
                  data={data?.activity.buckets ?? []}
                  margin={{ top: 8, right: 8, bottom: 0, left: -18 }}
                >
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} />
                  <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={36} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar dataKey="received" stackId="msgs" fill="var(--color-received)" />
                  <Bar
                    dataKey="sent"
                    stackId="msgs"
                    fill="var(--color-sent)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        {/* Social pulse */}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Social pulse</CardTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {data
                  ? `${data.social.totalAudience > 0 ? `${data.social.totalAudience.toLocaleString()} audience · ` : ""}${data.social.interactions7d} interactions this week`
                  : "Connected accounts and replies"}
              </p>
            </div>
            <Link to="/social" className="text-xs font-medium text-brand hover:underline">
              Social Hub
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {overview.isLoading ? (
              <ListSkeleton rows={3} />
            ) : overview.isError ? (
              <WidgetError
                message={overview.error.message}
                onRetry={() => overview.refetch()}
              />
            ) : (
              <>
                {data?.social.accounts.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No social accounts connected yet. Link Instagram, Facebook, YouTube, X,
                    LinkedIn, TikTok or Google Business in the{" "}
                    <Link to="/social" className="font-medium text-brand hover:underline">
                      Social Hub
                    </Link>
                    .
                  </p>
                )}
                {data?.social.accounts.map((a) => {
                  const Icon = PLATFORM_ICONS[a.platform] ?? Store;
                  return (
                    <div
                      key={a.id}
                      className="flex items-center justify-between gap-3 rounded-lg border p-3"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                          <Icon className="size-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{a.label}</p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {a.audience ?? "no stats yet"}
                            {a.lastSyncedAt
                              ? ` · synced ${new Date(a.lastSyncedAt).toLocaleDateString()}`
                              : " · never synced"}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {!a.active && (
                          <Badge variant="outline" className="text-[10px]">
                            inactive
                          </Badge>
                        )}
                        {a.pending > 0 && (
                          <Badge className="bg-brand text-[10px] text-brand-foreground">
                            {a.pending} to reply
                          </Badge>
                        )}
                      </div>
                    </div>
                  );
                })}
                {(data?.social.accounts.length ?? 0) > 0 &&
                  data?.social.pendingTotal === 0 && (
                    <p className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
                      <CheckCircle2 className="size-3.5 text-brand" /> All caught up —
                      nothing waiting for a reply.
                    </p>
                  )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* WhatsApp & Meta sync */}
      <Card className="mt-4">
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">WhatsApp & Meta sync</CardTitle>
            {metaUpdatedAt && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Updated {metaUpdatedAt}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              aria-label="Refresh Meta sync health"
              onClick={() => void metaHealth.refetch()}
              disabled={metaHealth.isRefetching}
            >
              <RefreshCw
                className={`size-3.5 ${metaHealth.isRefetching ? "animate-spin" : ""}`}
              />
            </Button>
            <Link to="/monitoring" className="text-xs font-medium text-brand hover:underline">
              Full monitoring
            </Link>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {metaHealth.isLoading ? (
            <ListSkeleton rows={2} />
          ) : metaHealth.isError ? (
            <WidgetError
              message={metaHealth.error.message}
              onRetry={() => metaHealth.refetch()}
            />
          ) : (
            <>
              {metaHealth.data?.numbers.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No WhatsApp numbers connected yet. Add one in{" "}
                  <Link to="/settings" className="font-medium text-brand hover:underline">
                    Settings
                  </Link>
                  .
                </p>
              )}
              {(metaHealth.data?.numbers ?? []).map((n) => (
                <div
                  key={n.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      {n.label}
                      {n.isDefault && (
                        <Badge variant="secondary" className="ml-2 text-[10px]">
                          default
                        </Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {n.displayPhone ?? "no display number"} · {n.conversations} chats ·{" "}
                      {n.messages24h} msgs/24h
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {!n.active && (
                      <Badge variant="outline" className="text-[10px]">
                        inactive
                      </Badge>
                    )}
                    {n.active && !n.credentialsPresent && (
                      <Badge variant="destructive" className="gap-1 text-[10px]">
                        <XCircle className="size-3" /> missing credentials
                      </Badge>
                    )}
                    {n.active && n.credentialsPresent && n.apiOk && (
                      <Badge className="gap-1 bg-brand text-[10px] text-brand-foreground">
                        <CheckCircle2 className="size-3" />
                        Meta connected
                        {n.qualityRating ? ` · ${n.qualityRating.toLowerCase()} quality` : ""}
                      </Badge>
                    )}
                    {n.active && n.credentialsPresent && !n.apiOk && (
                      <Badge variant="destructive" className="gap-1 text-[10px]">
                        <XCircle className="size-3" /> Meta unreachable
                      </Badge>
                    )}
                    {n.analyticsMissing && (
                      <Badge variant="secondary" className="gap-1 text-[10px]">
                        <AlertTriangle className="size-3" /> analytics missing
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}
        </CardContent>
      </Card>

      {/* Recent conversations */}
      <div className="mt-6">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">Recent conversations</CardTitle>
            <Link to="/inbox" className="text-xs font-medium text-brand hover:underline">
              Open inbox
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {overview.isLoading ? (
              <ListSkeleton rows={5} />
            ) : overview.isError ? (
              <WidgetError
                message={overview.error.message}
                onRetry={() => overview.refetch()}
              />
            ) : (
              <>
                {data?.recentConversations.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No conversations yet. Connect WhatsApp in Settings or embed the website
                    widget.
                  </p>
                )}
                {data?.recentConversations.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{c.contactName}</p>
                      <p className="truncate text-xs text-muted-foreground">{c.preview}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant="secondary" className="text-[10px] capitalize">
                        {c.channel === "web" ? "Website" : "WhatsApp"}
                      </Badge>
                      {c.unread > 0 && (
                        <Badge className="bg-brand text-[10px] text-brand-foreground">
                          {c.unread} new
                        </Badge>
                      )}
                      <span className="hidden text-[11px] text-muted-foreground sm:inline">
                        {new Date(c.lastMessageAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                ))}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
