import type { SupabaseClient } from "@supabase/supabase-js";
import { reconcileSocialPending, summariseHealth } from "@/lib/dashboard-figures";

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
  /**
   * 0-100. The mean of the factor scores below — five equal weights, no hidden
   * ones. Computed by summariseHealth so the card, the type and the number
   * cannot describe different things (QA M7).
   */
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
    /**
     * Incoming social messages and comments still waiting for a reply. Counted
     * with exactly the Inbox badge's filters, so the two agree (QA M7).
     */
    pendingTotal: number;
    /** True when the per-account breakdown covers only part of pendingTotal. */
    pendingPartial: boolean;
    /** How many of pendingTotal the per-account breakdown accounts for. */
    pendingCounted: number;
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

  const weekAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    convs,
    contactCount,
    contactSample,
    botReplyCount,
    weekMsgs,
    accounts,
    interactions,
    pendingCount,
    weekInteractionCount,
    leadRows,
  ] = await Promise.all([
    supabase
      .from("conversations")
      .select(
        "id, status, channel, unread_count, last_message_at, last_message_preview, contacts(name)",
      )
      .order("last_message_at", { ascending: false })
      .limit(100),
    // Real totals come from database-side counts, not a capped row sample —
    // otherwise the numbers freeze once a workspace passes the limit.
    supabase.from("contacts").select("id", { count: "exact", head: true }),
    supabase.from("contacts").select("id, stage, value").limit(500),
    supabase.from("messages").select("id", { count: "exact", head: true }).eq("sender", "bot"),
    supabase
      .from("messages")
      .select("id, sender, created_at")
      .gte("created_at", priorStart.toISOString())
      .limit(10000),
    supabase.from("social_accounts").select("id, platform, label, active, last_synced_at, stats"),
    // Only incoming, still-open interactions, newest first, for the per-account
    // breakdown. `direction` matters: sending a reply inserts an outbound row
    // (social.functions.ts) and social_interactions.status defaults to 'open',
    // so counting both directions made the dashboard's "to reply" grow by one
    // with every reply sent — 27 here against 22 in the Inbox (QA M7).
    supabase
      .from("social_interactions")
      .select("id, account_id, kind, status, created_at")
      .eq("direction", "in")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(500),
    // The totals themselves are database-side counts, like contacts above: a
    // capped sample stops being the truth as soon as a workspace outgrows it.
    supabase
      .from("social_interactions")
      .select("id", { count: "exact", head: true })
      .eq("direction", "in")
      .eq("status", "open"),
    supabase
      .from("social_interactions")
      .select("id", { count: "exact", head: true })
      .eq("direction", "in")
      .gte("created_at", weekAgoIso),
    supabase
      .from("leads")
      .select("id, created_at, consent_given")
      .gte("created_at", priorStart.toISOString())
      .limit(5000),
  ]);

  // One failing table must degrade its own widget, not blank the dashboard.
  for (const result of [
    convs,
    contactCount,
    contactSample,
    botReplyCount,
    weekMsgs,
    accounts,
    interactions,
    pendingCount,
    weekInteractionCount,
    leadRows,
  ]) {
    if (result.error) console.error("[dashboard] partial failure", result.error.message);
  }

  const conversations = convs.data ?? [];
  const contactRows = contactSample.data ?? [];
  const contactsTotal = contactCount.count ?? contactRows.length;
  const botReplies = botReplyCount.count ?? 0;
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
  // The sample is already filtered to incoming + open by the query above, so
  // every row here is one interaction waiting for a reply.
  const sampledByAccount = new Map<string, number>();
  for (const i of interactionRows) {
    sampledByAccount.set(i.account_id, (sampledByAccount.get(i.account_id) ?? 0) + 1);
  }
  const pending = reconcileSocialPending({
    // The head count failing must not invent a number: fall back to what the
    // sample actually holds.
    exactTotal: pendingCount.count ?? interactionRows.length,
    sampledByAccount,
  });
  const pendingByAccount = pending.perAccount;
  // Incoming interactions in the last 7 days, counted in the database. Our own
  // replies are not "interactions this week": including them made a busy team
  // look twice as engaged with as it was.
  const interactions7d = weekInteractionCount.count ?? 0;

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

  // One implementation of the score, shared with the tests that pin it down.
  const { score, grade } = summariseHealth(factors);

  return {
    stats: {
      open: conversations.filter((c) => c.status === "open").length,
      unread: unreadTotal,
      contacts: contactsTotal,
      botReplies,
    },
    activity: { buckets, weekTotal, todayTotal },
    trends,
    health: { score, grade, factors },
    social: {
      accounts: pulseAccounts,
      pendingTotal: pending.total,
      pendingPartial: pending.partial,
      pendingCounted: pending.counted,
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
