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

  const [convs, contacts, msgs, weekMsgs, accounts, interactions, leadRows] =
    await Promise.all([
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

  const firstError =
    convs.error ??
    contacts.error ??
    msgs.error ??
    weekMsgs.error ??
    accounts.error ??
    interactions.error;
  if (firstError) throw new Error(firstError.message);

  const conversations = convs.data ?? [];
  const contactRows = contacts.data ?? [];
  const messageRows = msgs.data ?? [];
  const weekMessageRows = weekMsgs.data ?? [];
  const accountRows = accounts.data ?? [];
  const interactionRows = interactions.data ?? [];

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

  return {
    stats: {
      open: conversations.filter((c) => c.status === "open").length,
      unread: conversations.reduce((sum, c) => sum + (c.unread_count ?? 0), 0),
      contacts: contactRows.length,
      botReplies: messageRows.filter((m) => m.sender === "bot").length,
    },
    activity: { buckets, weekTotal, todayTotal },
    social: {
      accounts: pulseAccounts,
      pendingTotal,
      interactions7d,
      totalAudience,
    },
    recentConversations: conversations.slice(0, 8).map((c) => ({
      id: c.id,
      contactName:
        (c.contacts as unknown as { name?: string } | null)?.name ?? "Unknown",
      preview: c.last_message_preview ?? "No messages",
      channel: c.channel,
      status: c.status,
      unread: c.unread_count ?? 0,
      lastMessageAt: c.last_message_at,
    })),
  };
}
