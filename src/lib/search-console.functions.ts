/**
 * src/lib/search-console.functions.ts
 *
 * Google Search Console SEO Studio & Performance Engine.
 * Retrieves verified properties, search analytics (Clicks, Impressions, CTR,
 * Average Ranking Position), top queries, top landing pages, and device breakdowns.
 */

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

type Client = SupabaseClient<Database>;

async function resolveTenant(supabase: Client, userId: string): Promise<string> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", userId)
    .maybeSingle();

  if (!profile?.tenant_id) {
    throw new Error("No active workspace found for this user account");
  }

  return profile.tenant_id;
}

export interface SearchConsoleMetricSummary {
  totalClicks: number;
  totalImpressions: number;
  averageCtr: number; // percentage, e.g. 4.2%
  averagePosition: number; // e.g. 8.4
}

export interface SearchConsoleQueryRow {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface SearchConsolePageRow {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface SearchConsolePerformanceData {
  connected: boolean;
  siteUrl?: string | null;
  periodDays: number;
  summary: SearchConsoleMetricSummary;
  queries: SearchConsoleQueryRow[];
  pages: SearchConsolePageRow[];
  dailyTrend: { date: string; clicks: number; impressions: number; position: number }[];
  isSimulated?: boolean;
}

const QueryPerformanceSchema = z.object({
  periodDays: z.number().int().min(7).max(90).default(28),
  siteUrl: z.string().optional(),
});

/**
 * Retrieves Search Console performance analytics for the active workspace.
 */
export const getSearchConsolePerformance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => QueryPerformanceSchema.parse(input))
  .handler(async ({ data, context }): Promise<SearchConsolePerformanceData> => {
    const tenantId = await resolveTenant(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Look for active search_console connected account
    const { data: account } = await supabaseAdmin
      .from("social_accounts")
      .select("id, platform, active, access_token, refresh_token, profile")
      .eq("tenant_id", tenantId)
      .eq("platform", "search_console")
      .eq("active", true)
      .maybeSingle();

    if (!account) {
      // Return simulated educational baseline preview if no property is connected yet
      return generatePreviewPerformance(data.periodDays);
    }

    // Attempt token decryption
    let token: string | null = null;
    try {
      if ((account as any).access_token_enc) {
        const { decryptSecret } = await import("@/lib/social-secrets.server");
        token = await decryptSecret(
          (account as any).access_token_enc,
          `tenant:${tenantId}:platform:search_console:field:access_token`
        );
      } else {
        token = (account as any).access_token || null;
      }
    } catch {
      token = null;
    }

    const siteUrl = data.siteUrl || (account.profile as any)?.external_id || (account.profile as any)?.name;

    if (!token || !siteUrl) {
      return generatePreviewPerformance(data.periodDays, siteUrl);
    }

    try {
      const endDate = new Date().toISOString().slice(0, 10);
      const startDate = new Date(Date.now() - data.periodDays * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);

      // Query Search Console API for top queries
      const queryRes = await fetch(
        `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            startDate,
            endDate,
            dimensions: ["query"],
            rowLimit: 25,
          }),
        }
      );

      // Query Search Console API for top pages
      const pageRes = await fetch(
        `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            startDate,
            endDate,
            dimensions: ["page"],
            rowLimit: 25,
          }),
        }
      );

      // Query daily trend
      const trendRes = await fetch(
        `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            startDate,
            endDate,
            dimensions: ["date"],
            rowLimit: data.periodDays,
          }),
        }
      );

      if (!queryRes.ok || !pageRes.ok) {
        return generatePreviewPerformance(data.periodDays, siteUrl);
      }

      const queryJson = (await queryRes.json()) as any;
      const pageJson = (await pageRes.json()) as any;
      const trendJson = (await trendRes.json()) as any;

      const queries: SearchConsoleQueryRow[] = (queryJson.rows || []).map((r: any) => ({
        query: r.keys?.[0] || "Unknown query",
        clicks: Math.round(r.clicks || 0),
        impressions: Math.round(r.impressions || 0),
        ctr: Number(((r.ctr || 0) * 100).toFixed(2)),
        position: Number((r.position || 0).toFixed(1)),
      }));

      const pages: SearchConsolePageRow[] = (pageJson.rows || []).map((r: any) => ({
        page: r.keys?.[0] || "/",
        clicks: Math.round(r.clicks || 0),
        impressions: Math.round(r.impressions || 0),
        ctr: Number(((r.ctr || 0) * 100).toFixed(2)),
        position: Number((r.position || 0).toFixed(1)),
      }));

      const dailyTrend = (trendJson.rows || []).map((r: any) => ({
        date: r.keys?.[0] || "",
        clicks: Math.round(r.clicks || 0),
        impressions: Math.round(r.impressions || 0),
        position: Number((r.position || 0).toFixed(1)),
      }));

      const totalClicks = queries.reduce((acc, q) => acc + q.clicks, 0);
      const totalImpressions = queries.reduce((acc, q) => acc + q.impressions, 0);
      const averageCtr = totalImpressions > 0 ? Number(((totalClicks / totalImpressions) * 100).toFixed(2)) : 0;
      const averagePosition =
        queries.length > 0
          ? Number((queries.reduce((acc, q) => acc + q.position, 0) / queries.length).toFixed(1))
          : 0;

      return {
        connected: true,
        siteUrl,
        periodDays: data.periodDays,
        summary: {
          totalClicks,
          totalImpressions,
          averageCtr,
          averagePosition,
        },
        queries,
        pages,
        dailyTrend,
        isSimulated: false,
      };
    } catch (e) {
      console.error("[search-console] Failed to query API:", e);
      return generatePreviewPerformance(data.periodDays, siteUrl);
    }
  });

function generatePreviewPerformance(periodDays: number, siteUrl?: string | null): SearchConsolePerformanceData {
  const dates: { date: string; clicks: number; impressions: number; position: number }[] = [];
  const now = Date.now();

  for (let i = periodDays; i >= 0; i--) {
    const d = new Date(now - i * 86400000).toISOString().slice(0, 10);
    const dayFactor = 1 + Math.sin(i / 3) * 0.3;
    dates.push({
      date: d,
      clicks: Math.round(42 * dayFactor),
      impressions: Math.round(920 * dayFactor),
      position: Number((7.8 - (periodDays - i) * 0.05).toFixed(1)),
    });
  }

  return {
    connected: Boolean(siteUrl),
    siteUrl: siteUrl ?? "https://flas.mobidigisol.com",
    periodDays,
    summary: {
      totalClicks: dates.reduce((acc, d) => acc + d.clicks, 0),
      totalImpressions: dates.reduce((acc, d) => acc + d.impressions, 0),
      averageCtr: 4.58,
      averagePosition: 6.4,
    },
    queries: [
      { query: "whatsapp crm uae", clicks: 382, impressions: 5410, ctr: 7.06, position: 2.4 },
      { query: "flas crm dubai", clicks: 294, impressions: 3890, ctr: 7.55, position: 1.8 },
      { query: "multichannel customer inbox", clicks: 178, impressions: 4210, ctr: 4.22, position: 4.2 },
      { query: "whatsapp business api dubai pricing", clicks: 145, impressions: 2900, ctr: 5.0, position: 3.1 },
      { query: "best crm for ecommerce gcc", clicks: 112, impressions: 3400, ctr: 3.29, position: 6.8 },
      { query: "automated whatsapp lead generation", clicks: 96, impressions: 2180, ctr: 4.4, position: 5.2 },
      { query: "meta ads whatsapp integration", clicks: 78, impressions: 1850, ctr: 4.21, position: 7.1 },
    ],
    pages: [
      { page: "/whatsapp-business-api", clicks: 512, impressions: 8400, ctr: 6.09, position: 3.2 },
      { page: "/features", clicks: 340, impressions: 6200, ctr: 5.48, position: 4.1 },
      { page: "/pricing", clicks: 289, impressions: 4800, ctr: 6.02, position: 2.8 },
      { page: "/blog/scale-whatsapp-sales-uae", clicks: 195, impressions: 4100, ctr: 4.75, position: 5.3 },
      { page: "/", clicks: 142, impressions: 3200, ctr: 4.43, position: 6.2 },
    ],
    dailyTrend: dates,
    isSimulated: true,
  };
}
