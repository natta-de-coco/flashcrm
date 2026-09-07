// Server-only logic for the Flas Business Advisor — a senior, niche-aware
// business manager persona that reads the tenant's live data (channels, social,
// leads, catalog, location) and returns a structured strategic review.
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiOptionsFor, callFlashAi, gatherLeadSummary, gatherMessagingAnalytics } from "./flash-ai.server";
import { getDashboardOverviewData } from "./dashboard.server";

export type AdvisorProfile = {
  business_name: string | null;
  industry: string | null;
  niche: string | null;
  description: string | null;
  website_url: string | null;
  city: string | null;
  country: string | null;
  currency: string | null;
  business_stage: string | null;
  monthly_revenue_target: number | null;
  main_goal: string | null;
  competitors: string | null;
  learned_facts: string | null;
};

const PROFILE_COLUMNS =
  "business_name, industry, niche, description, website_url, city, country, currency, business_stage, monthly_revenue_target, main_goal, competitors, learned_facts";

export async function getAdvisorProfile(supabase: SupabaseClient): Promise<AdvisorProfile | null> {
  const { data } = await supabase.from("business_profiles").select(PROFILE_COLUMNS).maybeSingle();
  return (data as AdvisorProfile | null) ?? null;
}

export type AdvisorSnapshot = {
  profile: AdvisorProfile | null;
  facts: string;
};

/** Gathers everything the advisor reasons about, as plain-text facts. */
export async function gatherAdvisorSnapshot(supabase: SupabaseClient): Promise<AdvisorSnapshot> {
  const [profile, overview, leads, messaging, products, social, socialPosts] = await Promise.all([
    getAdvisorProfile(supabase).catch(() => null),
    getDashboardOverviewData(supabase).catch(() => null),
    gatherLeadSummary(supabase as never).catch(() => null),
    gatherMessagingAnalytics(supabase as never, 30).catch(() => null),
    supabase
      .from("products")
      .select("title, price, description")
      .limit(40)
      .then((r) => r.data ?? []),
    supabase
      .from("social_accounts")
      .select("id, platform, label, stats, last_synced_at, active")
      .then((r) => r.data ?? []),
    supabase
      .from("social_posts")
      .select("caption, account_id, reach, likes, comments_count, shares, status, published_at")
      .order("published_at", { ascending: false })
      .limit(40)
      .then((r) => r.data ?? []),
  ]);

  const lines: string[] = [];

  lines.push("## Business");
  lines.push(`Name: ${profile?.business_name ?? "unknown"}`);
  lines.push(`Industry: ${profile?.industry ?? "unknown"} / niche: ${profile?.niche ?? "unknown"}`);
  lines.push(
    `Location: ${[profile?.city, profile?.country].filter(Boolean).join(", ") || "not provided"}`,
  );
  lines.push(`Stage: ${profile?.business_stage ?? "unknown"}`);
  lines.push(
    `Revenue target: ${
      profile?.monthly_revenue_target != null
        ? `${profile.monthly_revenue_target} ${profile.currency ?? ""}/month`
        : "not provided"
    }`,
  );
  if (profile?.main_goal) lines.push(`Owner's main goal: ${profile.main_goal}`);
  if (profile?.competitors) lines.push(`Named competitors: ${profile.competitors}`);
  if (profile?.description) lines.push(`About: ${profile.description}`);
  if (profile?.website_url) lines.push(`Website: ${profile.website_url}`);
  if (profile?.learned_facts) lines.push(`Learned facts: ${profile.learned_facts}`);

  if (overview) {
    lines.push("\n## Channel performance");
    lines.push(`Health score: ${overview.health.score}/100 (${overview.health.grade})`);
    for (const f of overview.health.factors)
      lines.push(`- ${f.label}: ${f.score}/100 — ${f.detail}`);
    lines.push(
      `Messages this week ${overview.trends.messages.current} vs ${overview.trends.messages.previous} last week; inbound ${overview.trends.inbound.current} vs ${overview.trends.inbound.previous}; new leads ${overview.trends.leads.current} vs ${overview.trends.leads.previous}`,
    );
    lines.push(
      `Conversations open ${overview.stats.open}, unread ${overview.stats.unread}, contacts ${overview.stats.contacts}`,
    );
    lines.push(
      `Daily traffic (last 7 days): ${overview.activity.buckets
        .map((d) => `${d.day} in=${d.received} out=${d.sent}`)
        .join(", ")}`,
    );
    lines.push(
      `Social: ${overview.social.accounts.length} accounts, audience ${overview.social.totalAudience}, ${overview.social.interactions7d} interactions in 7 days, ${overview.social.pendingTotal} awaiting reply`,
    );
  }

  if (messaging) {
    lines.push("\n## WhatsApp delivery (30 days)");
    lines.push(
      `Inbound ${messaging.totals.inbound}, outbound ${messaging.totals.outbound} (bot ${messaging.totals.botReplies}, agent ${messaging.totals.agentReplies}), delivered ${messaging.totals.delivered}, read ${messaging.totals.read}, failed ${messaging.totals.failed}`,
    );
    lines.push(
      `Average first response: ${
        messaging.avgFirstResponseMinutes != null
          ? `${messaging.avgFirstResponseMinutes} min`
          : "not enough data"
      }`,
    );
  }

  if (leads) {
    lines.push("\n## Leads & pipeline");
    lines.push(`Total ${leads.totalLeads} leads, ${leads.consentedLeads} opted in`);
    lines.push(
      `By source: ${
        Object.entries(leads.bySource)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ") || "none"
      }`,
    );
    lines.push(`Top tags: ${leads.topTags.join(", ") || "none"}`);
    lines.push(
      `Pipeline stages: ${
        Object.entries(leads.contactsByStage)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ") || "none"
      }`,
    );
  }

  lines.push("\n## Social accounts (latest sync)");
  const accountRows = social as Array<{
    id: string;
    platform: string;
    label: string;
    stats: unknown;
    last_synced_at: string | null;
    active: boolean;
  }>;
  if (accountRows.length === 0) lines.push("No social accounts connected.");
  for (const a of accountRows) {
    const s = (a.stats ?? {}) as Record<string, number | string>;
    const statText = Object.entries(s)
      .slice(0, 8)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    lines.push(
      `- ${a.platform} (${a.label})${a.active ? "" : " [inactive]"}: ${statText || "no stats yet"}; last synced ${a.last_synced_at ?? "never"}`,
    );
  }

  // Post-level performance so recommendations reference what actually worked.
  const platformById = new Map(accountRows.map((a) => [a.id, a.platform]));
  const postRows = socialPosts as Array<{
    caption: string;
    account_id: string | null;
    reach: number;
    likes: number;
    comments_count: number;
    shares: number;
    status: string;
    published_at: string | null;
  }>;
  const published = postRows.filter((p) => p.status === "published" || p.published_at);
  lines.push("\n## Post performance (most recent 40 posts)");
  if (published.length === 0) {
    lines.push("No published post metrics synced yet.");
  } else {
    const totalReach = published.reduce((s, p) => s + (p.reach ?? 0), 0);
    const totalEngagement = published.reduce(
      (s, p) => s + (p.likes ?? 0) + (p.comments_count ?? 0) + (p.shares ?? 0),
      0,
    );
    lines.push(
      `Published ${published.length} posts, total reach ${totalReach}, total engagement ${totalEngagement}` +
        (totalReach > 0
          ? `, engagement rate ${((totalEngagement / totalReach) * 100).toFixed(1)}%`
          : ""),
    );
    const ranked = [...published]
      .sort(
        (a, b) =>
          (b.likes ?? 0) +
          (b.comments_count ?? 0) +
          (b.shares ?? 0) -
          ((a.likes ?? 0) + (a.comments_count ?? 0) + (a.shares ?? 0)),
      )
      .slice(0, 5);
    for (const p of ranked) {
      lines.push(
        `- [${platformById.get(p.account_id ?? "") ?? "unknown"}] reach ${p.reach ?? 0}, likes ${p.likes ?? 0}, comments ${p.comments_count ?? 0}, shares ${p.shares ?? 0}: "${p.caption.slice(0, 120)}"`,
      );
    }
    const scheduled = postRows.filter((p) => p.status === "scheduled").length;
    if (scheduled > 0) lines.push(`Scheduled but not yet published: ${scheduled}`);
  }
  if (overview) {
    lines.push(
      `Replies waiting across social inboxes: ${overview.social.pendingTotal} (7-day interactions ${overview.social.interactions7d}, audience ${overview.social.totalAudience})`,
    );
  }

  lines.push("\n## Products");
  if (products.length === 0) lines.push("No products in the catalog.");
  for (const p of products as Array<{
    title: string;
    price: number | null;
    description: string | null;
  }>) {
    lines.push(`- ${p.title}${p.price != null ? ` — ${p.price}` : ""}`);
  }

  return { profile, facts: lines.join("\n") };
}

const ADVISOR_PERSONA = [
  "You are the Flas Business Advisor: a seasoned business owner and operator with 25+ years of hands-on experience across every major niche —",
  "retail and e-commerce, restaurants and cafés, real estate, clinics and dental, salons and spas, fitness, education and coaching, travel,",
  "construction and trades, automotive, logistics, professional services (legal, accounting, marketing), SaaS, manufacturing, events and weddings,",
  "and local service businesses. You think like a CEO plus a CMO plus a CFO in one person.",
  "You reason from the data you are given: channel traffic, response times, lead sources, pipeline stages, social account reach and engagement,",
  "product mix and pricing, and the city/country the business operates in (local demand, purchasing power, seasonality, culture, language, payment habits, regulations).",
  "Rules: never invent metrics that were not provided; when data is missing say exactly what to start tracking.",
  "Be direct and commercially specific — name numbers, channels, prices, timelines, and who should do it.",
].join(" ");

export type AdvisorAnalysis = {
  verdict: string;
  positioning: string;
  scores: { label: string; score: number; note: string }[];
  opportunities: {
    title: string;
    why: string;
    action: string;
    impact: "high" | "medium" | "low";
  }[];
  risks: string[];
  local: string[];
  socialPlan: { platform: string; recommendation: string }[];
  pricing: string[];
  next7Days: string[];
  next90Days: string[];
  kpis: { name: string; target: string }[];
  generatedAt: string;
};

function stripFences(raw: string): string {
  return raw
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
}

/** Full strategic review, returned as structured JSON for the advisor page. */
export async function buildAdvisorAnalysis(supabase: SupabaseClient): Promise<AdvisorAnalysis> {
  const { facts } = await gatherAdvisorSnapshot(supabase);

  const system = [
    ADVISOR_PERSONA,
    "Return STRICT JSON only (no markdown fences) matching exactly this shape:",
    '{"verdict": string (max 300 chars), "positioning": string (max 400 chars),',
    '"scores": [4-6 {"label": string, "score": 0-100 integer, "note": string (max 140 chars)}],',
    '"opportunities": [4-6 {"title": string, "why": string, "action": string, "impact": "high"|"medium"|"low"}],',
    '"risks": [3-5 strings], "local": [3-5 strings about the city/country market, demand, seasonality, pricing power, language, regulation],',
    '"socialPlan": [1 entry per connected platform (or the 3 platforms you recommend starting) {"platform": string, "recommendation": string}],',
    '"pricing": [2-4 strings about product mix, price points and offers],',
    '"next7Days": [5 short imperative actions], "next90Days": [4 short strategic moves],',
    '"kpis": [4-6 {"name": string, "target": string}]}',
  ].join("\n");

  const raw = await callFlashAi(system, facts, await aiOptionsFor(supabase, "advisor_analysis"));

  let parsed: Partial<AdvisorAnalysis> = {};
  try {
    parsed = JSON.parse(stripFences(raw)) as Partial<AdvisorAnalysis>;
  } catch {
    parsed = { verdict: raw.slice(0, 300) };
  }

  return {
    verdict: parsed.verdict?.trim() || "Not enough data yet for a verdict.",
    positioning: parsed.positioning?.trim() || "",
    scores: Array.isArray(parsed.scores) ? parsed.scores.slice(0, 6) : [],
    opportunities: Array.isArray(parsed.opportunities) ? parsed.opportunities.slice(0, 6) : [],
    risks: Array.isArray(parsed.risks) ? parsed.risks.slice(0, 5) : [],
    local: Array.isArray(parsed.local) ? parsed.local.slice(0, 5) : [],
    socialPlan: Array.isArray(parsed.socialPlan) ? parsed.socialPlan.slice(0, 8) : [],
    pricing: Array.isArray(parsed.pricing) ? parsed.pricing.slice(0, 4) : [],
    next7Days: Array.isArray(parsed.next7Days) ? parsed.next7Days.slice(0, 6) : [],
    next90Days: Array.isArray(parsed.next90Days) ? parsed.next90Days.slice(0, 5) : [],
    kpis: Array.isArray(parsed.kpis) ? parsed.kpis.slice(0, 6) : [],
    generatedAt: new Date().toISOString(),
  };
}

/** Free-form question to the advisor, answered against the same live snapshot. */
export async function askAdvisorQuestion(
  supabase: SupabaseClient,
  question: string,
  history: { role: "user" | "assistant"; content: string }[] = [],
): Promise<string> {
  const { facts } = await gatherAdvisorSnapshot(supabase);

  const system = [
    ADVISOR_PERSONA,
    "Answer the owner's question as their business manager. Use markdown: a one-line answer first,",
    "then short bullets with concrete steps and numbers, then a final line starting with 'Do this first:'.",
    "Keep it under 350 words.",
  ].join(" ");

  const convo = history
    .slice(-8)
    .map((m) => `${m.role === "user" ? "Owner" : "Advisor"}: ${m.content}`)
    .join("\n");

  const user = [
    "BUSINESS DATA:",
    facts,
    convo ? `\nCONVERSATION SO FAR:\n${convo}` : "",
    `\nQUESTION: ${question}`,
  ].join("\n");

  return callFlashAi(system, user, await aiOptionsFor(supabase, "advisor_question"));
}

/* ---------------- KPI targets ---------------- */

export type KpiProposal = {
  metric:
    | "response_minutes"
    | "read_rate"
    | "conversion_rate"
    | "lead_velocity"
    | "social_pending"
    | "unread_backlog";
  target_value: number;
  rationale: string;
};

const KPI_MENU = [
  "response_minutes — average first response in minutes (lower is better)",
  "read_rate — % of outbound WhatsApp messages read (higher is better)",
  "conversion_rate — % of contacts reaching Won (higher is better)",
  "lead_velocity — new leads per week (higher is better)",
  "social_pending — social comments/DMs still waiting (lower is better)",
  "unread_backlog — unread chats right now (lower is better)",
].join("\n");

/**
 * Turns the advisor's read of the business into concrete, measurable targets
 * for the six KPIs Flas can actually measure from live data.
 */
export async function proposeKpiTargets(supabase: SupabaseClient): Promise<KpiProposal[]> {
  const { facts } = await gatherAdvisorSnapshot(supabase);

  const system = [
    ADVISOR_PERSONA,
    "Set realistic 30-day targets — ambitious but reachable from the current numbers, never a fantasy jump.",
    "Only use these metric keys:",
    KPI_MENU,
    'Return STRICT JSON only: {"targets": [{"metric": string, "target_value": number, "rationale": string (max 160 chars)}]}',
    "Include 4 to 6 targets. target_value must be a plain number in the metric's unit.",
  ].join("\n");

  const raw = await callFlashAi(system, facts, await aiOptionsFor(supabase, "kpi_targets"));
  let parsed: { targets?: KpiProposal[] } = {};
  try {
    parsed = JSON.parse(stripFences(raw)) as { targets?: KpiProposal[] };
  } catch {
    parsed = {};
  }

  const allowed = new Set([
    "response_minutes",
    "read_rate",
    "conversion_rate",
    "lead_velocity",
    "social_pending",
    "unread_backlog",
  ]);

  const seen = new Set<string>();
  return (parsed.targets ?? [])
    .filter((t) => t && allowed.has(t.metric) && Number.isFinite(Number(t.target_value)))
    .filter((t) => (seen.has(t.metric) ? false : (seen.add(t.metric), true)))
    .slice(0, 6)
    .map((t) => ({
      metric: t.metric,
      target_value: Math.max(0, Math.round(Number(t.target_value) * 10) / 10),
      rationale: (t.rationale ?? "").slice(0, 160),
    }));
}

/* ---------------- Follow-up mode ---------------- */

export type FollowUpQuestion = { id: string; question: string; why: string };

/**
 * Structured follow-up: before giving next actions the advisor asks 3-5
 * clarifying questions grounded in the workspace's live traffic and products.
 */
export async function buildFollowUpQuestions(
  supabase: SupabaseClient,
): Promise<FollowUpQuestion[]> {
  const { facts } = await gatherAdvisorSnapshot(supabase);

  const system = [
    ADVISOR_PERSONA,
    "You are starting a short diagnostic interview with the owner before recommending actions.",
    "Ask only what the data cannot tell you and what would change your advice — capacity, margins, stock,",
    "staffing, budget, seasonality, sales process, or which product they actually want to push.",
    "Reference the real numbers you were given inside the 'why'.",
    'Return STRICT JSON only: {"questions": [{"question": string (max 180 chars), "why": string (max 140 chars)}]}',
    "Exactly 3 to 5 questions, ordered by how much the answer changes your recommendation.",
  ].join("\n");

  const raw = await callFlashAi(system, facts, await aiOptionsFor(supabase, "follow_up_questions"));
  let parsed: { questions?: Array<{ question?: string; why?: string }> } = {};
  try {
    parsed = JSON.parse(stripFences(raw)) as typeof parsed;
  } catch {
    parsed = {};
  }

  return (parsed.questions ?? [])
    .filter((q) => (q.question ?? "").trim().length > 5)
    .slice(0, 5)
    .map((q, i) => ({
      id: `q${i + 1}`,
      question: (q.question ?? "").trim().slice(0, 180),
      why: (q.why ?? "").trim().slice(0, 140),
    }));
}

export type FollowUpPlan = {
  summary: string;
  actions: {
    action: string;
    why: string;
    owner: string;
    when: string;
    impact: "high" | "medium" | "low";
  }[];
  watchouts: string[];
  generatedAt: string;
};

/** Turns the owner's answers plus live data into a prioritised next-action plan. */
export async function buildFollowUpPlan(
  supabase: SupabaseClient,
  answers: { question: string; answer: string }[],
): Promise<FollowUpPlan> {
  const { facts } = await gatherAdvisorSnapshot(supabase);

  const system = [
    ADVISOR_PERSONA,
    "You just interviewed the owner. Combine their answers with the live data and give the next actions.",
    'Return STRICT JSON only: {"summary": string (max 400 chars),',
    '"actions": [4-6 {"action": string, "why": string, "owner": string, "when": string, "impact": "high"|"medium"|"low"}],',
    '"watchouts": [2-4 strings]}',
    "'when' is a concrete window like 'today', 'this week' or 'within 30 days'.",
  ].join("\n");

  const user = [
    "BUSINESS DATA:",
    facts,
    "\nOWNER'S ANSWERS:",
    ...answers.map((a) => `Q: ${a.question}\nA: ${a.answer}`),
  ].join("\n");

  const raw = await callFlashAi(system, user, await aiOptionsFor(supabase, "follow_up_plan"));
  let parsed: Partial<FollowUpPlan> = {};
  try {
    parsed = JSON.parse(stripFences(raw)) as Partial<FollowUpPlan>;
  } catch {
    parsed = { summary: raw.slice(0, 400) };
  }

  return {
    summary: parsed.summary?.trim() || "No summary returned.",
    actions: Array.isArray(parsed.actions) ? parsed.actions.slice(0, 6) : [],
    watchouts: Array.isArray(parsed.watchouts) ? parsed.watchouts.slice(0, 4) : [],
    generatedAt: new Date().toISOString(),
  };
}
