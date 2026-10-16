// Server-only logic for the AI Daily Brief shown on the dashboard.
// Reads through the caller's RLS-scoped client, then asks Flas AI for a
// short, action-oriented briefing based on the tenant's live numbers.
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiOptionsFor, callFlashAi, getBusinessContext } from "./flash-ai.server";
import { getDashboardOverviewData } from "./dashboard.server";
import { briefAgeMs } from "./dashboard-figures";

export type DailyBrief = {
  headline: string;
  summary: string;
  actions: string[];
  /** Null when the stored brief has no usable timestamp. */
  generatedAt: string | null;
  /**
   * How old the brief was when this answer was made, by the server's clock. The
   * page uses this and not its own clock to say how fresh the brief is.
   */
  ageMs: number | null;
  cached: boolean;
};

function trendLine(
  label: string,
  t: { current: number; previous: number; changePct: number | null },
) {
  const change =
    t.changePct === null ? "no prior data" : `${t.changePct > 0 ? "+" : ""}${t.changePct}%`;
  return `${label}: ${t.current} this week vs ${t.previous} last week (${change})`;
}

/**
 * Builds the daily brief: aggregates the dashboard overview, adds business
 * context, and returns a headline, a two-sentence summary and 3 next actions.
 */
async function generateDailyBrief(supabase: SupabaseClient): Promise<DailyBrief> {
  const [overview, profile] = await Promise.all([
    getDashboardOverviewData(supabase),
    getBusinessContext(supabase as never).catch(() => null),
  ]);

  const facts = [
    profile?.business_name ? `Business: ${profile.business_name}` : null,
    profile?.industry ? `Industry: ${profile.industry}` : null,
    profile?.description ? `About: ${profile.description}` : null,
    `Business health score: ${overview.health.score}/100 (${overview.health.grade})`,
    ...overview.health.factors.map((f) => `${f.label}: ${f.score}/100 — ${f.detail}`),
    trendLine("Total messages", overview.trends.messages),
    trendLine("Inbound messages", overview.trends.inbound),
    trendLine("New leads", overview.trends.leads),
    `Open conversations: ${overview.stats.open}, unread: ${overview.stats.unread}, contacts: ${overview.stats.contacts}`,
    `Social: ${overview.social.accounts.length} accounts, ${overview.social.pendingTotal} interactions waiting for a reply`,
  ]
    .filter(Boolean)
    .join("\n");

  const raw = await callFlashAi(
    [
      "You are Flas AI, the growth advisor inside a WhatsApp CRM.",
      "Write a short daily brief for the business owner from the metrics given.",
      "Reply with STRICT JSON only, no markdown fences:",
      '{"headline": string (max 60 chars), "summary": string (max 320 chars, 2 sentences), "actions": [3 short imperative strings, max 90 chars each]}',
      "Be concrete, reference the actual numbers, and never invent data that is not provided.",
    ].join(" "),
    facts,
    await aiOptionsFor(supabase, "daily_brief"),
  );

  let parsed: Partial<DailyBrief> = {};
  try {
    parsed = JSON.parse(
      raw
        .replace(/^```(?:json)?/i, "")
        .replace(/```$/, "")
        .trim(),
    ) as Partial<DailyBrief>;
  } catch {
    parsed = { headline: "Today at a glance", summary: raw.slice(0, 320), actions: [] };
  }

  return {
    headline: parsed.headline?.trim() || "Today at a glance",
    summary: parsed.summary?.trim() || "No summary available right now.",
    actions: (parsed.actions ?? []).filter((a) => typeof a === "string" && a.trim()).slice(0, 3),
    generatedAt: new Date().toISOString(),
    ageMs: 0,
    cached: false,
  };
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Returns today's brief for the caller's tenant. Generated once per UTC day and
 * reused on every refresh; pass force to regenerate and overwrite the cache.
 */
export async function buildDailyBrief(
  supabase: SupabaseClient,
  opts: { force?: boolean } = {},
): Promise<DailyBrief> {
  const today = utcDay();

  const { data: tenantId } = await supabase.rpc("current_tenant_id");
  if (!tenantId) return generateDailyBrief(supabase);

  if (!opts.force) {
    const { data: existing } = await supabase
      .from("daily_briefs")
      .select("headline, summary, actions, created_at")
      .eq("tenant_id", tenantId as string)
      .eq("brief_date", today)
      .maybeSingle();
    if (existing) {
      return {
        headline: existing.headline,
        summary: existing.summary,
        actions: Array.isArray(existing.actions) ? (existing.actions as string[]) : [],
        generatedAt: existing.created_at ?? null,
        ageMs: briefAgeMs(existing.created_at, new Date()),
        cached: true,
      };
    }
  }

  const fresh = await generateDailyBrief(supabase);

  await supabase.from("daily_briefs").upsert(
    {
      tenant_id: tenantId as string,
      brief_date: today,
      headline: fresh.headline,
      summary: fresh.summary,
      actions: fresh.actions,
      created_at: fresh.generatedAt ?? new Date().toISOString(),
    },
    { onConflict: "tenant_id,brief_date" },
  );

  return fresh;
}
