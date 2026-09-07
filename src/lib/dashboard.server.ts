import type { SupabaseClient } from "@supabase/supabase-js";

export type DayBucket = { day: string; received: number; sent: number };

export type SocialPulseAccount = {
  id: string;
  platform: string;
  label: string;
  active: boolean;
  lastSyncedAt: string | null;
  audience: string | null;
  pending: number;
};

export type RecentConversation = {
  id: string;
  contactName: string;
  preview: string;
  channel: string;
  status: string;
  unread: number;
  lastMessageAt: string;
};

export type Trend = {
  /** This period's value (last 7 days). */
  current: number;
  /** Previous 7-day period, for comparison. */
  previous: number;
  /** Percent change, null when the previous period was zero. */
  changePct: number | null;
};

export type HealthFactor = {
  key: string;
  label: string;
  /** 0-100 sub-score. */
  score: number;
  detail: string;
};

export type BusinessHealth = {
  /** Weighted 0-100 overall score. */
  score: number;
  grade: "Excellent" | "Good" | "Needs work" | "At risk";
  factors: HealthFactor[];
};

export type DashboardOverview = {
  stats: { open: number; unread: number; contacts: number; botReplies: number };
  activity: { buckets: DayBucket[]; weekTotal: number; todayTotal: number };
  trends: {
    messages: Trend;
    inbound: Trend;
    leads: Trend;
    replies: Trend;
  };
  health: BusinessHealth;
  social: {
    accounts: SocialPulseAccount[];
    pendingTotal: number;
    interactions7d: number;
    totalAudience: number;
  };
  recentConversations: RecentConversation[];
};

function trend(current: number, previous: number): Trend {
  return {
    current,
    previous,
    changePct: previous > 0 ? Math.round(((current - previous) / previous) * 100) : null,
  };
}

function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** First useful audience number from a sync, if any (mirrors Social Hub). */
function audienceStat(stats: Record<string, number> | null): string | null {
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

/**
 * Aggregates everything the dashboard widgets need (inbox stats, 7-day
 * activity, social pulse, recent conversations) into one plain DTO.
 * Runs with the caller's supabase client so RLS scopes it to their tenant.
 */
export async function getDashboardOverviewData(
  supabase: SupabaseClient,
): Promise<DashboardOverview> {
  const weekStart = new Date();
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - 6);
  // Previous comparison window starts 7 days before the current one.
  const priorStart = new Date(weekStart);
  priorStart.setDate(priorStart.getDate() - 7);

  const [convs, contacts, msgs, weekMsgs, accounts, interactions, leadRows] = await Promise.all([
    supabase
      .from("conversations")
      .select(
        "id, status, channel, unread_count, last_message_at, last_message_preview, contacts(name)",
      )
      .order("last_message_at", { ascending: false })
      .limit(100),
    supabase.from("contacts").select("id, stage, value").limit(500),
    supabase.from("messages").select("id, sender").limit(1000),
    supabase
      .from("messages")
      .select("id, sender, created_at")
      .gte("created_at", priorStart.toISOString())
      .limit(10000),
    supabase.from("social_accounts").select("id, platform, label, active, last_synced_at, stats"),
    supabase
      .from("social_interactions")
      .select("id, account_id, kind, status, created_at")
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("leads")
      .select("id, created_at, consent_given")
      .gte("created_at", priorStart.toISOString())
      .limit(5000),
  ]);

  const firstError =
    convs.error ??
    contacts.error ??
    msgs.error ??
    weekMsgs.error ??
    accounts.error ??
    interactions.error ??
    leadRows.error;
  if (firstError) throw new Error(firstError.message);

  const conversations = convs.data ?? [];
  const contactRows = contacts.data ?? [];
  const messageRows = msgs.data ?? [];
  const fortnightMessageRows = weekMsgs.data ?? [];
  const weekStartMs = weekStart.getTime();
  const weekMessageRows = fortnightMessageRows.filter(
    (m) => new Date(m.created_at).getTime() >= weekStartMs,
  );
  const priorMessageRows = fortnightMessageRows.filter(
    (m) => new Date(m.created_at).getTime() < weekStartMs,
  );
  const accountRows = accounts.data ?? [];
  const interactionRows = interactions.data ?? [];
  const leads = leadRows.data ?? [];

  // ---- 7-day activity buckets (received vs sent) ----
  const buckets: DayBucket[] = [];
  const bucketIndex = new Map<string, number>();
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    bucketIndex.set(dayKey(d), buckets.length);
    buckets.push({
      day: d.toLocaleDateString("en-US", { weekday: "short" }),
      received: 0,
      sent: 0,
    });
  }
  for (const m of weekMessageRows) {
    const idx = bucketIndex.get(dayKey(new Date(m.created_at)));
    if (idx === undefined) continue;
    if (m.sender === "contact") buckets[idx]!.received += 1;
    else buckets[idx]!.sent += 1;
  }
  const weekTotal = weekMessageRows.length;
  const last = buckets[buckets.length - 1];
  const todayTotal = (last?.received ?? 0) + (last?.sent ?? 0);

  // ---- Social pulse aggregates ----
  const pendingByAccount = new Map<string, number>();
  let pendingTotal = 0;
  let interactions7d = 0;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const i of interactionRows) {
    if (i.status === "open") {
      pendingTotal += 1;
      pendingByAccount.set(i.account_id, (pendingByAccount.get(i.account_id) ?? 0) + 1);
    }
    if (new Date(i.created_at).getTime() >= weekAgo) interactions7d += 1;
  }

  const pulseAccounts: SocialPulseAccount[] = accountRows.map((a) => ({
    id: a.id,
    platform: a.platform,
    label: a.label,
    active: a.active,
    lastSyncedAt: a.last_synced_at,
    audience: audienceStat(a.stats as Record<string, number> | null),
    pending: pendingByAccount.get(a.id) ?? 0,
  }));

  const totalAudience = accountRows.reduce((sum, a) => {
    const s = a.stats as Record<string, number> | null;
    if (!s) return sum;
    return sum + (s["followers"] ?? s["subscribers"] ?? 0);
  }, 0);

  // ---- Week-over-week trends ----
  const inboundNow = weekMessageRows.filter((m) => m.sender === "contact").length;
  const inboundPrev = priorMessageRows.filter((m) => m.sender === "contact").length;
  const repliesNow = weekMessageRows.length - inboundNow;
  const repliesPrev = priorMessageRows.length - inboundPrev;
  const leadsNow = leads.filter((l) => new Date(l.created_at).getTime() >= weekStartMs).length;
  const leadsPrev = leads.length - leadsNow;

  const trends = {
    messages: trend(weekMessageRows.length, priorMessageRows.length),
    inbound: trend(inboundNow, inboundPrev),
    leads: trend(leadsNow, leadsPrev),
    replies: trend(repliesNow, repliesPrev),
  };

  // ---- Business Health Score ----
  const unreadTotal = conversations.reduce((sum, c) => sum + (c.unread_count ?? 0), 0);
  const responsiveness =
    inboundNow === 0 ? 70 : Math.max(0, Math.min(100, Math.round((repliesNow / inboundNow) * 100)));
  const inboxHygiene = Math.max(0, 100 - unreadTotal * 5);
  const pipeline = Math.min(100, leadsNow * 10);
  const socialPresence =
    accountRows.length === 0
      ? 0
      : Math.min(
          100,
          Math.round((accountRows.filter((a) => a.active).length / accountRows.length) * 60) +
            Math.min(40, interactions7d * 4),
        );
  const consentRate =
    leads.length === 0
      ? 60
      : Math.round((leads.filter((l) => l.consent_given).length / leads.length) * 100);

  const factors: HealthFactor[] = [
    {
      key: "responsiveness",
      label: "Responsiveness",
      score: responsiveness,
      detail: `${repliesNow} replies to ${inboundNow} inbound messages this week`,
    },
    {
      key: "inbox",
      label: "Inbox hygiene",
      score: inboxHygiene,
      detail: unreadTotal === 0 ? "No unread messages" : `${unreadTotal} unread messages waiting`,
    },
    {
      key: "pipeline",
      label: "Lead flow",
      score: pipeline,
      detail: `${leadsNow} new leads in the last 7 days`,
    },
    {
      key: "social",
      label: "Social presence",
      score: socialPresence,
      detail:
        accountRows.length === 0
          ? "No social accounts connected"
          : `${accountRows.filter((a) => a.active).length}/${accountRows.length} accounts active · ${interactions7d} interactions`,
    },
    {
      key: "consent",
      label: "Marketing compliance",
      score: consentRate,
      detail:
        leads.length === 0
          ? "No leads captured yet"
          : `${consentRate}% of recent leads gave marketing consent`,
    },
  ];

  const score = Math.round(factors.reduce((sum, f) => sum + f.score, 0) / factors.length);
  const grade: BusinessHealth["grade"] =
    score >= 85 ? "Excellent" : score >= 70 ? "Good" : score >= 50 ? "Needs work" : "At risk";

  return {
    stats: {
      open: conversations.filter((c) => c.status === "open").length,
      unread: unreadTotal,
      contacts: contactRows.length,
      botReplies: messageRows.filter((m) => m.sender === "bot").length,
    },
    activity: { buckets, weekTotal, todayTotal },
    trends,
    health: { score, grade, factors },
    social: {
      accounts: pulseAccounts,
      pendingTotal,
      interactions7d,
      totalAudience,
    },
    recentConversations: conversations.slice(0, 8).map((c) => ({
      id: c.id,
      contactName: (c.contacts as unknown as { name?: string } | null)?.name ?? "Unknown",
      preview: c.last_message_preview ?? "No messages",
      channel: c.channel,
      status: c.status,
      unread: c.unread_count ?? 0,
      lastMessageAt: c.last_message_at,
    })),
  };
}
