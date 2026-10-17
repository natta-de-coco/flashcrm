import {
  HomeGlossary,
  HomeIllustration,
  HomeStartGuide,
  HomeTaskCards,
} from "@/components/dashboard/HomeGuide";
import { homePriority } from "@/lib/home-guide";
import { canOpen, isCompanyManager } from "@/lib/permissions";
import { useTenant } from "@/hooks/useTenant";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
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
import type { BusinessHealth } from "@/lib/dashboard.server";
import { getMetaSyncHealth } from "@/lib/meta-health.functions";
import { briefSnapshotKind, pendingBreakdownNote } from "@/lib/dashboard-figures";
import { formatInboxTime } from "@/lib/inbox-presentation";
import { resolveTenantLocale } from "@/lib/locale";
import { useI18n } from "@/hooks/useI18n";
import { hasMessage, type MessageKey } from "@/lib/i18n";
import { logWidgetError } from "@/lib/widget-error-log";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  MessageCircle,
  Plug,
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

/** The grade the server computes, as the key it is shown under. */
const GRADE_KEY: Record<string, MessageKey> = {
  Excellent: "dashboard.health.grade.excellent",
  Good: "dashboard.health.grade.good",
  "Needs work": "dashboard.health.grade.needsWork",
  "At risk": "dashboard.health.grade.atRisk",
  "Not enough activity yet": "home.health.insufficient",
};

/** Helpful inline error state with a retry button — never a blank widget. */
function WidgetError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center">
      <AlertTriangle className="size-5 text-destructive" />
      <p className="text-sm font-medium">{t("dashboard.widgetError")}</p>
      <p className="max-w-xs text-xs text-muted-foreground">{message}</p>
      <Button
        size="sm"
        variant="outline"
        className="mt-1 gap-1.5"
        onClick={onRetry}
        aria-label={t("dashboard.retryWidget")}
      >
        <RefreshCw className="size-3.5" /> {t("dashboard.retryWidget")}
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

/** Business Health Score: one number plus every factor that makes it up. */
function HealthCard({ health }: { health: BusinessHealth }) {
  const { t } = useI18n();
  const tone =
    health.score === null
      ? "text-muted-foreground"
      : health.score >= 85
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
          <CardTitle className="text-base">{t("home.health.title")}</CardTitle>
          {/* Says how the number is made, because the AI brief quotes a score
              taken earlier in the day and the two used to differ with no
              explanation anywhere on the page (QA M7). */}
          <p className="mt-0.5 text-xs text-muted-foreground">{t("dashboard.health.method")}</p>
        </div>
        <div className="shrink-0 text-end">
          <p className={`text-3xl font-bold leading-none ${tone}`}>{health.score ?? "—"}</p>
          <p className="text-[11px] text-muted-foreground">
            {GRADE_KEY[health.grade] ? t(GRADE_KEY[health.grade]!) : health.grade}
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs leading-relaxed text-muted-foreground">{t("home.health.note")}</p>
        {health.factors.map((f) => (
          <div key={f.key}>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-medium">
                {(() => {
                  const key = `dashboard.health.factor.${f.key}`;
                  return hasMessage(key) ? t(key) : f.label;
                })()}
              </span>
              <span className="text-muted-foreground">
                {f.score === null ? t("home.health.noData") : `${f.score}/100`}
              </span>
            </div>
            {f.score !== null && <Progress value={f.score} className="mt-1 h-1.5" />}
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {f.score === null
                ? t("home.health.noData")
                : f.values
                  ? t(`home.health.detail.${f.key}` as MessageKey, f.values)
                  : f.detail}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const { t, language } = useI18n();
  const { tenant, staffRole } = useTenant();
  const canInbox = canOpen(staffRole, "/inbox");
  const canSocial = canOpen(staffRole, "/social");
  const canConnect = canOpen(staffRole, "/connect");
  const canMonitor = canOpen(staffRole, "/monitoring");
  const canBrief = canOpen(staffRole, "/advisor");
  const canOverview = !!tenant && canInbox && canOpen(staffRole, "/contacts");
  const scope = `${tenant?.id}:${staffRole}`;
  const activityConfig = useMemo(
    () =>
      ({
        received: { label: t("dashboard.activity.received"), color: "var(--color-chart-1)" },
        sent: { label: t("dashboard.activity.sent"), color: "var(--color-chart-2)" },
      }) satisfies ChartConfig,
    [t],
  );
  const overviewFn = useServerFn(getDashboardOverview);
  const overview = useQuery({
    queryKey: ["dashboard-overview", scope],
    enabled: !!tenant && canOverview,
    queryFn: () => overviewFn(),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: 2,
    // Progressive loading: skeletons show only until the first response
    // lands; afterwards the previous data stays visible while refreshing.
  });

  const metaHealthFn = useServerFn(getMetaSyncHealth);
  const metaHealth = useQuery({
    queryKey: ["meta_sync_health", scope],
    enabled: !!tenant && isCompanyManager(staffRole),
    queryFn: () => metaHealthFn(),
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: 2,
  });

  // Flas AI daily brief — generated once per day per workspace on the server and
  // reused on every refresh, so loading it on mount costs at most one model call a day.
  const briefFn = useServerFn(getDailyBrief);
  const brief = useQuery({
    queryKey: ["dashboard-daily-brief", scope],
    enabled: false,
    queryFn: () => briefFn({ data: {} }),
    staleTime: 60 * 60_000,
    refetchOnWindowFocus: false,
    retry: 0,
  });
  const qc = useQueryClient();
  const regenerateBrief = useMutation({
    mutationFn: (_request: { scope: string }) => briefFn({ data: { force: true } }),
    onSuccess: (data, request) => {
      qc.setQueryData(["dashboard-daily-brief", request.scope], data);
    },
    // Without this the spinner simply stopped and the stale brief stayed on
    // screen: brief.isError reflects the query, not this mutation.
    onError: (e: Error) => toast.error(e.message),
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
    if (canOverview) void overview.refetch();
    if (isCompanyManager(staffRole)) void metaHealth.refetch();
  };
  // Only successful data for this scope may claim an update time.
  const displayLocale = resolveTenantLocale({
    locale: language,
    timezone: tenant?.timezone ?? null,
  });
  const overviewUpdatedAt = overview.dataUpdatedAt
    ? formatInboxTime(new Date(overview.dataUpdatedAt).toISOString(), displayLocale)
    : null;
  const metaUpdatedAt = metaHealth.dataUpdatedAt
    ? formatInboxTime(new Date(metaHealth.dataUpdatedAt).toISOString(), displayLocale)
    : null;

  const data = overview.data;
  // H11: the one thing Meta will not give us, said once for the whole card.
  const metaAnalyticsGap = metaHealth.data?.metaAnalytics.available
    ? null
    : (metaHealth.data?.metaAnalytics.reason ?? null);
  const priority = homePriority(
    overview.isSuccess && data
      ? {
          open: data.stats.open,
          unreadConversations: data.stats.unreadConversations,
          contacts: data.stats.contacts,
          activity: data.activity.weekTotal,
          hasConversations: data.recentConversations.length > 0,
        }
      : null,
  );
  const isNewWorkspace = priority === "new";
  const stats = [
    {
      label: t("dashboard.stat.open"),
      value: data?.stats.open ?? 0,
      icon: Inbox,
      description: t("home.stat.open.desc"),
      to: "/inbox" as const,
    },
    {
      label: t("home.stat.unread.title"),
      value: data?.stats.unreadConversations ?? null,
      description: t("home.stat.unread.desc"),
      to: "/inbox" as const,
      icon: MessageSquare,
    },
    {
      label: t("dashboard.stat.contacts"),
      value: data?.stats.contacts ?? 0,
      icon: Users,
      description: t("home.stat.contacts.desc"),
      to: "/contacts" as const,
    },
    {
      label: t("dashboard.stat.botReplies"),
      value: data?.stats.botReplies ?? 0,
      icon: Bot,
      description: t("home.stat.botReplies.desc"),
      to: "/chatbot" as const,
    },
  ].filter((stat) => canOpen(staffRole, stat.to));

  return (
    <main className="mx-auto w-full max-w-[1440px] min-h-0 flex-1 space-y-6 p-4 sm:p-6">
      <header className="flas-hero flex items-center gap-6 rounded-3xl border bg-card p-5 sm:p-8">
        <div className="min-w-0 flex-1">
          <p className="mb-3 inline-flex max-w-full items-center gap-2 rounded-full border bg-card/80 px-3 py-1 text-xs font-medium text-primary">
            <span className="size-1.5 shrink-0 rounded-full bg-primary" />
            <span className="truncate">{tenant?.name ?? t("home.eyebrow")}</span>
          </p>
          <h1 className="max-w-xl text-2xl font-bold leading-tight tracking-tight sm:text-4xl">
            {t(staffRole === "seo_editor" ? "home.writer.title" : "home.title")}
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            {t(staffRole === "seo_editor" ? "home.writer.subtitle" : "home.subtitle")}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {canInbox && (
              <Button asChild className="min-h-11 gap-2">
                <Link to="/inbox">
                  <Inbox className="size-4" />
                  {t("home.action.inbox")}
                  <ArrowRight className="size-4 rtl:rotate-180" />
                </Link>
              </Button>
            )}
            {canConnect && (
              <Button asChild variant="outline" className="min-h-11 gap-2">
                <Link to="/connect">
                  <Plug className="size-4" />
                  {t("home.action.connect")}
                </Link>
              </Button>
            )}
          </div>
        </div>
        <HomeIllustration />
      </header>
      <HomeStartGuide key={scope} role={staffRole} expanded={isNewWorkspace} />
      {canInbox && priority && (
        <section
          className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-2xl border bg-card p-4 sm:flex sm:items-center sm:gap-4 sm:p-5"
          aria-label={t(`home.primary.${priority}`)}
        >
          <span className="home-icon-tile">
            <MessageCircle className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">{t(`home.primary.${priority}`)}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(`home.primary.${priority}.desc`)}
            </p>
          </div>
          <Button
            asChild
            variant="outline"
            className="col-span-2 min-h-11 justify-self-stretch sm:shrink-0"
          >
            <Link to={isNewWorkspace && canConnect ? "/connect" : "/inbox"}>
              {t(isNewWorkspace && canConnect ? "home.action.connect" : "home.action.inbox")}
              <ArrowRight className="ms-2 size-4 rtl:rotate-180" />
            </Link>
          </Button>
        </section>
      )}
      <HomeTaskCards role={staffRole} />
      {canOverview && (
        <>
          <section aria-labelledby="home-overview-title">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="home-overview-title" className="text-lg font-semibold">
                  {t("home.today.title")}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">{t("home.status.recorded")}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {overview.isError
                    ? t("home.metric.unknown")
                    : overviewUpdatedAt
                      ? t("dashboard.updated", { time: overviewUpdatedAt })
                      : t("dashboard.loading")}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="min-h-11 gap-1.5"
                  onClick={refreshAll}
                  disabled={refreshing}
                >
                  <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
                  {t("dashboard.refresh")}
                </Button>
              </div>
            </div>
            {overview.isSuccess && data?.sampling && Object.values(data.sampling).some(Boolean) && (
              <p className="mb-4 rounded-xl border border-dashed p-3 text-sm text-muted-foreground">
                {t("home.activity.partial")}
              </p>
            )}
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
                  <Card key={s.label} className="border-border/70 shadow-none">
                    <Link
                      to={s.to}
                      className="block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-muted/30"
                    >
                      <CardContent className="flex items-start justify-between gap-3 p-5">
                        <div className="min-w-0">
                          <p className="stat-label">{s.label}</p>
                          <p className="stat-figure mt-2 text-[2rem] font-bold">
                            {s.value ?? t("home.metric.unknown")}
                          </p>
                          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                            {s.description}
                          </p>
                        </div>
                        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
                          <s.icon className="size-[1.125rem]" />
                        </span>
                      </CardContent>
                    </Link>
                  </Card>
                ))}
              </div>
            )}
          </section>
          {canInbox && (
            <>
              {/* Recent conversations */}
              <div className="mt-6">
                <Card>
                  <CardHeader className="flex-row items-center justify-between">
                    <CardTitle className="text-base">{t("dashboard.recent.title")}</CardTitle>
                    <Link to="/inbox" className="text-xs font-medium text-brand hover:underline">
                      {t("dashboard.openInbox")}
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
                          <div className="rounded-xl border border-dashed bg-muted/20 p-6 text-center">
                            <Inbox className="mx-auto mb-3 size-7 text-primary" />
                            <p className="text-sm font-semibold">{t("home.recent.empty.title")}</p>
                            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                              {t("home.recent.empty.desc")}
                            </p>
                          </div>
                        )}
                        {data?.recentConversations.map((c) => (
                          <Link
                            to="/inbox"
                            search={{ conversation: c.id }}
                            key={c.id}
                            className="flex min-h-16 items-center justify-between gap-3 rounded-xl border p-3 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold">{c.contactName}</p>
                              <p className="truncate text-xs text-muted-foreground">{c.preview}</p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <Badge variant="secondary" className="text-[10px] capitalize">
                                {c.channel === "web"
                                  ? t("dashboard.channel.web")
                                  : t("dashboard.channel.whatsapp")}
                              </Badge>
                              {c.unread > 0 && (
                                <Badge className="bg-brand text-[10px] text-brand-foreground">
                                  {t("dashboard.recent.new", { count: c.unread })}
                                </Badge>
                              )}
                              <span className="hidden text-[11px] text-muted-foreground sm:inline">
                                {new Date(c.lastMessageAt).toLocaleDateString()}
                              </span>
                            </div>
                          </Link>
                        ))}
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
          <details className="rounded-2xl border bg-card/50">
            <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 rounded-2xl p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5">
              <span className="flex-1">
                <span className="block font-semibold">{t("home.details.title")}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {t("home.details.desc")}
                </span>
              </span>
              <ChevronDown className="size-4 shrink-0" />
            </summary>
            <div className="px-3 pb-4 sm:px-5">
              {/* Flas AI daily brief + business health score */}
              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                {canBrief && (
                  <Card className="lg:col-span-2">
                    <CardHeader className="flex-row items-start justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Sparkles className="size-4 text-brand" /> {t("dashboard.brief.title")}
                        </CardTitle>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {t("home.brief.manual")}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0 gap-1.5"
                        onClick={() => regenerateBrief.mutate({ scope })}
                        disabled={briefBusy}
                      >
                        <RefreshCw className={`size-3.5 ${briefBusy ? "animate-spin" : ""}`} />
                        {brief.data
                          ? t("dashboard.brief.regenerate")
                          : t("dashboard.brief.generate")}
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
                        <WidgetError
                          message={brief.error.message}
                          onRetry={() => brief.refetch()}
                        />
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
                          {/* The brief is generated once per UTC day and reused
                    (brief.server.ts), while every card around it refetches
                    every 30 seconds. Saying so is the honest fix for the brief
                    quoting health 62 beside a card reading 60 (QA M7):
                    regenerating is the only way to make them one number. */}
                          <p className="text-[11px] text-muted-foreground">
                            {briefSnapshotKind({
                              cached: brief.data.cached,
                              ageMs: Math.max(
                                0,
                                Date.now() - new Date(brief.data.generatedAt).getTime(),
                              ),
                            }) === "fresh"
                              ? t("dashboard.brief.note.fresh")
                              : t("home.brief.snapshot", {
                                  time: new Date(brief.data.generatedAt).toLocaleString(),
                                })}
                          </p>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          {t("dashboard.brief.empty")}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )}

                {overview.isError ? (
                  <Card>
                    <CardContent className="pt-6">
                      <WidgetError
                        message={overview.error.message}
                        onRetry={() => overview.refetch()}
                      />
                    </CardContent>
                  </Card>
                ) : overview.isLoading || !data ? (
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
                      <CardTitle className="text-base">{t("dashboard.activity.title")}</CardTitle>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {data
                          ? t("dashboard.activity.summary", {
                              week: data.activity.weekTotal,
                              today: data.activity.todayTotal,
                            })
                          : t("dashboard.activity.empty")}
                      </p>
                    </div>
                    <Link to="/inbox" className="text-xs font-medium text-brand hover:underline">
                      {t("dashboard.openInbox")}
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
                    ) : data?.activity.weekTotal === 0 ? (
                      <div className="grid min-h-56 place-content-center rounded-xl border border-dashed bg-muted/20 p-6 text-center">
                        <MessageSquare className="mx-auto mb-3 size-7 text-primary" />
                        <p className="text-sm font-semibold">{t("home.activity.empty.title")}</p>
                        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                          {t("home.activity.empty.desc")}
                        </p>
                      </div>
                    ) : (
                      <ChartContainer config={activityConfig} className="h-56 w-full aspect-auto">
                        <BarChart
                          data={data?.activity.buckets ?? []}
                          margin={{ top: 8, right: 8, bottom: 0, left: -18 }}
                        >
                          <CartesianGrid vertical={false} />
                          <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} />
                          <YAxis
                            tickLine={false}
                            axisLine={false}
                            allowDecimals={false}
                            width={36}
                          />
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
                {canSocial && (
                  <Card>
                    <CardHeader className="flex-row items-center justify-between">
                      <div>
                        <CardTitle className="text-base">{t("dashboard.social.title")}</CardTitle>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {data
                            ? data.social.totalAudience > 0
                              ? t("dashboard.social.summaryAudience", {
                                  audience: data.social.totalAudience.toLocaleString(),
                                  incoming: data.social.interactions7d,
                                  pending: data.social.pendingTotal,
                                })
                              : t("dashboard.social.summary", {
                                  incoming: data.social.interactions7d,
                                  pending: data.social.pendingTotal,
                                })
                            : t("dashboard.social.empty")}
                        </p>
                      </div>
                      <Link
                        to="/social"
                        search={{ tab: "comments" }}
                        className="text-xs font-medium text-brand hover:underline"
                      >
                        {t("dashboard.social.hub")}
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
                            <div className="rounded-xl border border-dashed bg-muted/20 p-5 text-center">
                              <MessageCircle className="mx-auto mb-3 size-7 text-primary" />
                              <p className="text-sm font-semibold">
                                {t("home.social.empty.title")}
                              </p>
                              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                                {t("home.social.empty.desc")}
                              </p>
                              {canConnect ? (
                                <Link
                                  to="/connect"
                                  className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline"
                                >
                                  {t("home.action.connect")}
                                </Link>
                              ) : (
                                <p className="mt-3 text-xs text-muted-foreground">
                                  {t("home.help.manager")}
                                </p>
                              )}
                            </div>
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
                                      {a.audience ?? t("dashboard.social.noStats")}
                                      {a.lastSyncedAt
                                        ? ` · ${t("dashboard.social.synced", { date: new Date(a.lastSyncedAt).toLocaleDateString() })}`
                                        : ` · ${t("dashboard.social.neverSynced")}`}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-1.5">
                                  {!a.active && (
                                    <Badge variant="outline" className="text-[10px]">
                                      {t("dashboard.inactive")}
                                    </Badge>
                                  )}
                                  {a.pending > 0 && (
                                    <Badge className="bg-brand text-[10px] text-brand-foreground">
                                      {t("dashboard.social.toReply", { count: a.pending })}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                          {(data?.social.accounts.length ?? 0) > 0 &&
                            data?.social.pendingTotal === 0 && (
                              <p className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
                                <CheckCircle2 className="size-3.5 text-brand" />{" "}
                                {t("dashboard.social.caughtUp")}
                              </p>
                            )}
                          {/* The badges above come from a capped sample of the newest
                    rows; the total is a database count with the Inbox badge's
                    own filters. When they cannot match, say so rather than
                    leaving the parts short of the whole (QA M7). */}
                          {data?.social.pendingPartial &&
                            (() => {
                              const note = pendingBreakdownNote({
                                total: data.social.pendingTotal,
                                counted: data.social.pendingCounted,
                              });
                              // The module decides whether a note is needed; the screen
                              // says it in the reader's language.
                              return note ? (
                                <p className="pt-1 text-[11px] text-muted-foreground">
                                  {t("dashboard.social.pendingNote", {
                                    counted: data.social.pendingCounted,
                                    total: data.social.pendingTotal,
                                  })}
                                </p>
                              ) : null;
                            })()}
                        </>
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* WhatsApp & Meta sync */}
              {canMonitor && (
                <Card className="mt-4">
                  <CardHeader className="flex-row items-center justify-between">
                    <div>
                      <CardTitle className="text-base">{t("dashboard.meta.title")}</CardTitle>
                      {metaUpdatedAt && (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {t("dashboard.updated", { time: metaUpdatedAt })}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        aria-label={t("dashboard.meta.refresh")}
                        onClick={() => void metaHealth.refetch()}
                        disabled={metaHealth.isRefetching}
                      >
                        <RefreshCw
                          className={`size-3.5 ${metaHealth.isRefetching ? "animate-spin" : ""}`}
                        />
                      </Button>
                      <Link
                        to="/monitoring"
                        className="text-xs font-medium text-brand hover:underline"
                      >
                        {t("dashboard.meta.fullMonitoring")}
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
                            {t("dashboard.meta.none")}{" "}
                            <Link to="/connect" className="font-medium text-brand hover:underline">
                              {t("home.action.connect")}
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
                                  <Badge variant="secondary" className="ms-2 text-[10px]">
                                    {t("dashboard.meta.default")}
                                  </Badge>
                                )}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {n.displayPhone ?? t("dashboard.meta.noDisplay")} ·{" "}
                                {t("dashboard.meta.counts", {
                                  chats: n.conversations,
                                  messages: n.messages24h,
                                })}
                              </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              {!n.active && (
                                <Badge variant="outline" className="text-[10px]">
                                  {t("dashboard.inactive")}
                                </Badge>
                              )}
                              {n.active && !n.credentialsPresent && (
                                <Badge variant="destructive" className="gap-1 text-[10px]">
                                  <XCircle className="size-3" />{" "}
                                  {t("dashboard.meta.missingCredentials")}
                                </Badge>
                              )}
                              {n.active && n.credentialsPresent && n.apiOk && (
                                <Badge className="gap-1 bg-brand text-[10px] text-brand-foreground">
                                  <CheckCircle2 className="size-3" />
                                  {t("home.meta.reachable")}
                                  {n.qualityRating
                                    ? ` · ${t("dashboard.meta.quality", {
                                        quality: (() => {
                                          const key = `dashboard.meta.rating.${n.qualityRating.toLowerCase()}`;
                                          return hasMessage(key)
                                            ? t(key)
                                            : n.qualityRating.toLowerCase();
                                        })(),
                                      })}`
                                    : ""}
                                </Badge>
                              )}
                              {n.active && n.credentialsPresent && !n.apiOk && (
                                <Badge variant="destructive" className="gap-1 text-[10px]">
                                  <XCircle className="size-3" /> {t("dashboard.meta.unreachable")}
                                </Badge>
                              )}
                            </div>
                          </div>
                        ))}
                        {(metaHealth.data?.numbers.length ?? 0) > 0 && (
                          <p className="text-xs text-muted-foreground">{t("home.meta.note")}</p>
                        )}
                        {/* H11: said once, as a plain limitation, instead of a red
                  "analytics missing" badge per number. The figures live on the
                  WhatsApp Business Account and no WABA id is stored, so this
                  cannot be fixed by the reader — and must not look as if a
                  retry would help. */}
                        {(metaHealth.data?.numbers.length ?? 0) > 0 && metaAnalyticsGap && (
                          <p className="pt-1 text-[11px] text-muted-foreground">
                            {metaAnalyticsGap}
                          </p>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          </details>
        </>
      )}
      <HomeGlossary role={staffRole} />
    </main>
  );
}
