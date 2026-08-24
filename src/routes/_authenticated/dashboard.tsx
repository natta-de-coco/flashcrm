import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { supabase } from "@/integrations/supabase/client";
import { STAGES, type Contact, type Conversation } from "@/lib/crm-types";
import { getMetaSyncHealth } from "@/lib/meta-health.functions";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
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
      { title: "Dashboard — Flash CRM" },
      {
        name: "description",
        content: "Live overview of WhatsApp conversations, leads and chatbot activity.",
      },
      { property: "og:title", content: "Dashboard — Flash CRM" },
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

type SocialAccount = {
  id: string;
  platform: string;
  label: string;
  active: boolean;
  last_synced_at: string | null;
  stats: Record<string, number> | null;
};

type SocialInteraction = {
  id: string;
  account_id: string;
  kind: string;
  status: string;
  created_at: string;
};

/** First useful audience number from a sync, if any (mirrors Social Hub). */
function audienceStat(stats: SocialAccount["stats"]): string | null {
  if (!stats) return null;
  const order: [string, string][] = [
    ["followers", "followers"],
    ["subscribers", "subscribers"],
    ["reviews", "reviews"],
    ["videos", "videos"],
    ["tweets", "posts"],
  ];
  for (const [key, label] of order) {
    const value = stats[key];
    if (typeof value === "number") return `${value.toLocaleString()} ${label}`;
  }
  return null;
}

function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

const activityConfig = {
  received: { label: "Received", color: "var(--color-chart-1)" },
  sent: { label: "Sent by you & AI", color: "var(--color-chart-2)" },
} satisfies ChartConfig;

function DashboardPage() {
  const data = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const weekStart = new Date();
      weekStart.setHours(0, 0, 0, 0);
      weekStart.setDate(weekStart.getDate() - 6);

      const [convs, contacts, msgs, weekMsgs, accounts, interactions] = await Promise.all([
        supabase
          .from("conversations")
          .select("*, contacts(id, name, phone, company, stage)")
          .order("last_message_at", { ascending: false })
          .limit(100),
        supabase.from("contacts").select("*").limit(500),
        supabase.from("messages").select("id, sender, created_at").limit(1000),
        supabase
          .from("messages")
          .select("id, sender, created_at")
          .gte("created_at", weekStart.toISOString())
          .limit(5000),
        supabase
          .from("social_accounts")
          .select("id, platform, label, active, last_synced_at, stats"),
        supabase
          .from("social_interactions")
          .select("id, account_id, kind, status, created_at")
          .order("created_at", { ascending: false })
          .limit(500),
      ]);
      if (convs.error) throw convs.error;
      if (contacts.error) throw contacts.error;
      if (msgs.error) throw msgs.error;
      if (weekMsgs.error) throw weekMsgs.error;
      if (accounts.error) throw accounts.error;
      if (interactions.error) throw interactions.error;
      return {
        conversations: convs.data as unknown as Conversation[],
        contacts: contacts.data as unknown as Contact[],
        messages: msgs.data,
        weekMessages: weekMsgs.data,
        socialAccounts: accounts.data as unknown as SocialAccount[],
        interactions: interactions.data as unknown as SocialInteraction[],
      };
    },
  });

  const metaHealthFn = useServerFn(getMetaSyncHealth);
  const metaHealth = useQuery({
    queryKey: ["meta_sync_health"],
    queryFn: () => metaHealthFn(),
    staleTime: 60_000,
  });

  const conversations = data.data?.conversations ?? [];
  const contacts = data.data?.contacts ?? [];
  const messages = data.data?.messages ?? [];
  const weekMessages = data.data?.weekMessages ?? [];
  const socialAccounts = data.data?.socialAccounts ?? [];
  const interactions = data.data?.interactions ?? [];

  const open = conversations.filter((c) => c.status === "open").length;
  const unread = conversations.reduce((sum, c) => sum + c.unread_count, 0);
  const botReplies = messages.filter((m) => m.sender === "bot").length;
  const pipelineValue = contacts
    .filter((c) => c.stage !== "lost")
    .reduce((sum, c) => sum + Number(c.value ?? 0), 0);

  const stats = [
    { label: "Open conversations", value: open, icon: Inbox },
    { label: "Unread messages", value: unread, icon: MessageSquare },
    { label: "Contacts", value: contacts.length, icon: Users },
    { label: "Bot replies", value: botReplies, icon: Bot },
  ];

  // ---- 7-day activity buckets (received vs sent) ----
  const dayBuckets: { day: string; received: number; sent: number }[] = [];
  const bucketIndex = new Map<string, number>();
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    bucketIndex.set(dayKey(d), dayBuckets.length);
    dayBuckets.push({
      day: d.toLocaleDateString(undefined, { weekday: "short" }),
      received: 0,
      sent: 0,
    });
  }
  for (const m of weekMessages) {
    const idx = bucketIndex.get(dayKey(new Date(m.created_at)));
    if (idx === undefined) continue;
    if (m.sender === "contact") dayBuckets[idx]!.received += 1;
    else dayBuckets[idx]!.sent += 1;
  }
  const weekTotal = weekMessages.length;
  const todayIdx = dayBuckets.length - 1;
  const todayTotal = (dayBuckets[todayIdx]?.received ?? 0) + (dayBuckets[todayIdx]?.sent ?? 0);

  // ---- Social pulse aggregates ----
  const pendingByAccount = new Map<string, number>();
  let pendingTotal = 0;
  let interactions7d = 0;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const i of interactions) {
    if (i.status === "open") {
      pendingTotal += 1;
      pendingByAccount.set(i.account_id, (pendingByAccount.get(i.account_id) ?? 0) + 1);
    }
    if (new Date(i.created_at).getTime() >= weekAgo) interactions7d += 1;
  }
  const totalAudience = socialAccounts.reduce((sum, a) => {
    const s = a.stats;
    if (!s) return sum;
    return sum + (s.followers ?? s.subscribers ?? 0);
  }, 0);

  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Everything happening across WhatsApp, your website widget and your pipeline.
        </p>
      </header>

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
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {/* 7-day activity chart */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">7-day activity</CardTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {weekTotal} messages this week · {todayTotal} today
              </p>
            </div>
            <Link to="/inbox" className="text-xs font-medium text-brand hover:underline">
              Open inbox
            </Link>
          </CardHeader>
          <CardContent>
            <ChartContainer config={activityConfig} className="h-56 w-full aspect-auto">
              <BarChart data={dayBuckets} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
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
          </CardContent>
        </Card>

        {/* Social pulse */}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Social pulse</CardTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {totalAudience > 0 && `${totalAudience.toLocaleString()} audience · `}
                {interactions7d} interactions this week
              </p>
            </div>
            <Link to="/social" className="text-xs font-medium text-brand hover:underline">
              Social Hub
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {socialAccounts.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No social accounts connected yet. Link Instagram, Facebook, YouTube, X, LinkedIn,
                TikTok or Google Business in the{" "}
                <Link to="/social" className="font-medium text-brand hover:underline">
                  Social Hub
                </Link>
                .
              </p>
            )}
            {socialAccounts.map((a) => {
              const Icon = PLATFORM_ICONS[a.platform] ?? Store;
              const pending = pendingByAccount.get(a.id) ?? 0;
              const audience = audienceStat(a.stats);
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
                        {audience ?? "no stats yet"}
                        {a.last_synced_at
                          ? ` · synced ${new Date(a.last_synced_at).toLocaleDateString()}`
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
                    {pending > 0 && (
                      <Badge className="bg-brand text-[10px] text-brand-foreground">
                        {pending} to reply
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })}
            {socialAccounts.length > 0 && pendingTotal === 0 && (
              <p className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
                <CheckCircle2 className="size-3.5 text-brand" /> All caught up — nothing waiting
                for a reply.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">WhatsApp & Meta sync</CardTitle>
          <Link to="/monitoring" className="text-xs font-medium text-brand hover:underline">
            Full monitoring
          </Link>
        </CardHeader>
        <CardContent className="space-y-2">
          {metaHealth.isLoading && (
            <p className="text-sm text-muted-foreground">Checking Meta connection…</p>
          )}
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
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">Recent conversations</CardTitle>
            <Link to="/inbox" className="text-xs font-medium text-brand hover:underline">
              Open inbox
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {conversations.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No conversations yet. Connect WhatsApp in Settings or embed the website widget.
              </p>
            )}
            {conversations.slice(0, 8).map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{c.contacts?.name ?? "Unknown"}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {c.last_message_preview ?? "No messages"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="secondary" className="text-[10px] capitalize">
                    {c.channel === "web" ? "Website" : "WhatsApp"}
                  </Badge>
                  <Badge variant="outline" className="text-[10px] capitalize">
                    {c.status}
                  </Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pipeline</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-2xl font-bold">
              {pipelineValue.toLocaleString(undefined, {
                style: "currency",
                currency: "USD",
                maximumFractionDigits: 0,
              })}
            </p>
            {STAGES.map((stage) => {
              const count = contacts.filter((c) => c.stage === stage.id).length;
              const pct = contacts.length ? Math.round((count / contacts.length) * 100) : 0;
              return (
                <div key={stage.id}>
                  <div className="flex justify-between text-xs">
                    <span className="font-medium">{stage.label}</span>
                    <span className="text-muted-foreground">{count}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-muted">
                    <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
