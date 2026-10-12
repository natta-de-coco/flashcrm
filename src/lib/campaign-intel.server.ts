// Campaign Planner — real, computed audience/channel data the AI reasons
// over. The numbers here (segment counts, channel engagement, geography) are
// always computed in TypeScript from actual rows, never invented by the
// model; the AI's job is strategy on top of real facts, not the facts
// themselves. Every query is scoped to the caller's RLS client, so results
// never cross tenants.
import type { SupabaseClient } from "@supabase/supabase-js";
import { isOptedIn } from "./campaign-audience";
import { inferCountryFromPhone, countryOption } from "./locale";
import { aiOptionsFor, callFlashAi } from "./flash-ai.server";

export type AudienceSegments = {
  totalContacts: number;
  bySource: { source: string; count: number }[];
  byStage: { stage: string; count: number }[];
  byCountry: { country: string; countryName: string; count: number }[];
  topTags: { tag: string; count: number }[];
  consentedShare: number; // 0-1, share of leads with recorded consent
};

export async function gatherAudienceSegments(supabase: SupabaseClient): Promise<AudienceSegments> {
  const [{ data: contacts }, { data: leads }] = await Promise.all([
    supabase.from("contacts").select("stage, tags, phone").limit(2000),
    supabase.from("leads").select("source, consent_given, subscribed").limit(2000),
  ]);

  const bySource = new Map<string, number>();
  let consented = 0;
  for (const lead of leads ?? []) {
    bySource.set(lead.source, (bySource.get(lead.source) ?? 0) + 1);
    // Was `consent_given || subscribed`, which reported a 100% consent rate for
    // every workspace: `leads.subscribed` defaults to true and nothing ever
    // clears it, so it is a suppression flag, not evidence of an opt-in (H8).
    if (isOptedIn(lead)) consented += 1;
  }

  const byStage = new Map<string, number>();
  const byCountry = new Map<string, number>();
  const tagCounts = new Map<string, number>();
  for (const c of contacts ?? []) {
    byStage.set(c.stage, (byStage.get(c.stage) ?? 0) + 1);
    const country = inferCountryFromPhone(c.phone);
    if (country) byCountry.set(country, (byCountry.get(country) ?? 0) + 1);
    for (const tag of c.tags ?? []) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }

  const sortDesc = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]);

  return {
    totalContacts: (contacts ?? []).length,
    bySource: sortDesc(bySource).map(([source, count]) => ({ source, count })),
    byStage: sortDesc(byStage).map(([stage, count]) => ({ stage, count })),
    byCountry: sortDesc(byCountry).map(([country, count]) => ({
      country,
      countryName: countryOption(country)?.name ?? country,
      count,
    })),
    topTags: sortDesc(tagCounts)
      .slice(0, 10)
      .map(([tag, count]) => ({ tag, count })),
    consentedShare: (leads ?? []).length > 0 ? consented / (leads ?? []).length : 0,
  };
}

export type ChannelPerformance = {
  platform: string;
  label: string;
  audience: number | null; // followers/subscribers, whatever the platform calls it
  postsAnalyzed: number;
  avgEngagementPerPost: number; // likes + comments + shares, averaged
  avgReach: number;
  lastSyncedAt: string | null;
};

/** Ranks connected social accounts by real engagement — not a vibe, an
 *  average over each account's own recent posts. Accounts never synced or
 *  with zero posts still show up (audience-only) so a channel isn't invisible
 *  just because posting has been thin. */
export async function gatherChannelPerformance(
  supabase: SupabaseClient,
): Promise<ChannelPerformance[]> {
  const { data: accounts } = await supabase
    .from("social_accounts")
    .select("id, platform, label, stats, active, last_synced_at")
    .eq("active", true);
  if (!accounts?.length) return [];

  const accountIds = accounts.map((a) => a.id);
  const { data: posts } = await supabase
    .from("social_posts")
    .select("account_id, likes, comments_count, shares, reach")
    .in("account_id", accountIds)
    .order("published_at", { ascending: false })
    .limit(500);

  const postsByAccount = new Map<string, typeof posts>();
  for (const p of posts ?? []) {
    const list = postsByAccount.get(p.account_id) ?? [];
    list.push(p);
    postsByAccount.set(p.account_id, list);
  }

  return accounts
    .map((a) => {
      const accountPosts = postsByAccount.get(a.id) ?? [];
      const n = accountPosts.length;
      const sum = (f: (p: NonNullable<typeof posts>[number]) => number) =>
        accountPosts.reduce((s, p) => s + f(p), 0);
      const stats = (a.stats ?? {}) as Record<string, number>;
      const audience =
        stats["followers"] ?? stats["subscribers"] ?? stats["reviews"] ?? stats["videos"] ?? null;
      return {
        platform: a.platform,
        label: a.label,
        audience,
        postsAnalyzed: n,
        avgEngagementPerPost:
          n > 0
            ? Math.round(sum((p) => (p.likes ?? 0) + (p.comments_count ?? 0) + (p.shares ?? 0)) / n)
            : 0,
        avgReach: n > 0 ? Math.round(sum((p) => p.reach ?? 0) / n) : 0,
        lastSyncedAt: a.last_synced_at,
      };
    })
    .sort((a, b) => b.avgEngagementPerPost - a.avgEngagementPerPost);
}

export type CampaignPlan = {
  summary: string;
  targetSegments: { name: string; why: string; estimatedSize: number }[];
  recommendedChannels: { platform: string; rationale: string; priority: "primary" | "secondary" }[];
  geographicFocus: { area: string; why: string }[];
  timing: string;
  messagingAngle: string;
  draftOpeningMessage: string;
  risksOrGaps: string[];
};

/**
 * Generates a campaign plan grounded in real segment/channel data. The AI
 * never invents the numbers — they're computed above and handed to it as
 * facts; its job is to turn real facts into a targeting strategy.
 */
export async function generateCampaignPlan(
  supabase: SupabaseClient,
  input: { goal: string; product?: string | null; budgetNote?: string | null },
): Promise<CampaignPlan> {
  const [segments, channels] = await Promise.all([
    gatherAudienceSegments(supabase),
    gatherChannelPerformance(supabase),
  ]);

  const facts = [
    `## Audience (${segments.totalContacts} contacts)`,
    `By lead source: ${segments.bySource.map((s) => `${s.source}=${s.count}`).join(", ") || "no lead data yet"}`,
    `By pipeline stage: ${segments.byStage.map((s) => `${s.stage}=${s.count}`).join(", ") || "none"}`,
    `By inferred country (from phone calling code — approximate, not a real location field): ${
      segments.byCountry.map((c) => `${c.countryName}=${c.count}`).join(", ") || "no phone data yet"
    }`,
    `Top tags: ${segments.topTags.map((t) => `${t.tag}(${t.count})`).join(", ") || "none"}`,
    `Consent rate on leads: ${Math.round(segments.consentedShare * 100)}%`,
    "",
    "## Connected channels, ranked by real average engagement per post",
    ...(channels.length
      ? channels.map(
          (c) =>
            `- ${c.platform} "${c.label}": audience=${c.audience ?? "unknown"}, ${c.postsAnalyzed} posts analyzed, avg engagement/post=${c.avgEngagementPerPost}, avg reach/post=${c.avgReach}${c.lastSyncedAt ? "" : " (never synced)"}`,
        )
      : ["No connected/active social accounts yet."]),
  ].join("\n");

  const system = [
    "You are a senior performance-marketing strategist inside a WhatsApp-first CRM.",
    "You are given REAL, pre-computed audience and channel data for one company — never invent numbers not present in the facts.",
    "Where geography is 'inferred from phone calling code', say so plainly — do not present it as verified location data.",
    "If a data category is empty or thin (e.g. no connected channels, no phone data), say so honestly and recommend how to start collecting it, rather than fabricating a recommendation.",
    "Return ONLY a JSON object with this exact shape, no markdown fences, no commentary outside the JSON:",
    `{"summary": string, "targetSegments": [{"name": string, "why": string, "estimatedSize": number}], "recommendedChannels": [{"platform": string, "rationale": string, "priority": "primary"|"secondary"}], "geographicFocus": [{"area": string, "why": string}], "timing": string, "messagingAngle": string, "draftOpeningMessage": string, "risksOrGaps": [string]}`,
    "estimatedSize must be a real number drawn from the facts given (e.g. a segment count), not a guess.",
    "geographicFocus can be an empty array if there is no usable geographic signal in the facts — do not invent regions.",
    "recommendedChannels should only include platforms that appear in the facts as connected — do not recommend a platform with zero data on it as 'primary'.",
  ].join(" ");

  const user = [
    `Campaign goal: ${input.goal}`,
    input.product ? `Product/service being promoted: ${input.product}` : "",
    input.budgetNote ? `Budget/constraints: ${input.budgetNote}` : "",
    "",
    facts,
  ]
    .filter(Boolean)
    .join("\n");

  const raw = await callFlashAi(system, user, await aiOptionsFor(supabase, "campaign_plan"));
  let parsed: Partial<CampaignPlan>;
  try {
    const cleaned = raw
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned) as Partial<CampaignPlan>;
  } catch {
    throw new Error("The AI did not return a valid plan — try again.");
  }

  return {
    summary: parsed.summary ?? "",
    targetSegments: parsed.targetSegments ?? [],
    recommendedChannels: parsed.recommendedChannels ?? [],
    geographicFocus: parsed.geographicFocus ?? [],
    timing: parsed.timing ?? "",
    messagingAngle: parsed.messagingAngle ?? "",
    draftOpeningMessage: parsed.draftOpeningMessage ?? "",
    risksOrGaps: parsed.risksOrGaps ?? [],
  };
}
