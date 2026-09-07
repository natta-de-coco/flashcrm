// Server-only helpers for the Connect Your Business screen: profile discovery
// after authorization, connection health, Flas account scans and the AI
// profile optimizer. Tokens are only ever touched with the admin client.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { AccountPlatform } from "./connections-catalog";
import { connector } from "./connections-catalog";
import { callFlashAi } from "./flash-ai.server";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ConnectionHealth = "connected" | "attention" | "disconnected" | "unknown";

export type DiscoveredProfile = {
  name?: string | undefined;
  username?: string | undefined;
  picture?: string | undefined;
  bio?: string | undefined;
  website?: string | undefined;
  category?: string | undefined;
  followers?: number | undefined;
  profile_url?: string | undefined;
  external_id?: string | undefined;
  ad_accounts?: string[] | undefined;
};

/** Best-effort profile discovery straight after authorization. */
export async function discoverProfile(
  platform: AccountPlatform,
  token: string,
): Promise<DiscoveredProfile> {
  const meta = connector(platform);
  try {
    if (meta?.provider === "meta") {
      if (platform === "facebook" || platform === "instagram") {
        const res = await fetch(
          `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,username,link,category,picture{url},fan_count,instagram_business_account{id,username,name,profile_picture_url,biography,website,followers_count}&access_token=${encodeURIComponent(token)}`,
        );
        const json: any = await res.json();
        const page = json?.data?.[0];
        if (!page) return {};
        if (platform === "facebook") {
          return {
            external_id: page.id,
            name: page.name,
            username: page.username,
            category: page.category,
            picture: page.picture?.data?.url ?? page.picture?.url,
            followers: page.fan_count,
            profile_url:
              page.link ?? (page.username ? `https://facebook.com/${page.username}` : undefined),
          };
        }
        const ig = page.instagram_business_account;
        if (!ig) return {};
        return {
          external_id: ig.id,
          name: ig.name,
          username: ig.username,
          bio: ig.biography,
          website: ig.website,
          picture: ig.profile_picture_url,
          followers: ig.followers_count,
          profile_url: ig.username ? `https://instagram.com/${ig.username}` : undefined,
        };
      }
      if (platform === "meta_ads") {
        const res = await fetch(
          `https://graph.facebook.com/v21.0/me/adaccounts?fields=id,name&access_token=${encodeURIComponent(token)}`,
        );
        const json: any = await res.json();
        const list: string[] = (json?.data ?? []).map((a: any) => `${a.name} (${a.id})`);
        return { name: list[0] ?? "Meta Ads", ad_accounts: list, external_id: json?.data?.[0]?.id };
      }
    }
    if (platform === "youtube") {
      const res = await fetch(
        "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true",
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const json: any = await res.json();
      const ch = json?.items?.[0];
      if (!ch) return {};
      return {
        external_id: ch.id,
        name: ch.snippet?.title,
        username: ch.snippet?.customUrl,
        bio: ch.snippet?.description,
        picture: ch.snippet?.thumbnails?.default?.url,
        followers: Number(ch.statistics?.subscriberCount ?? 0),
        profile_url: ch.snippet?.customUrl
          ? `https://youtube.com/${ch.snippet.customUrl}`
          : `https://youtube.com/channel/${ch.id}`,
      };
    }
    if (platform === "search_console") {
      const res = await fetch("https://www.googleapis.com/webmasters/v3/sites", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json: any = await res.json();
      const site = json?.siteEntry?.[0];
      return site ? { name: site.siteUrl, external_id: site.siteUrl } : {};
    }
  } catch {
    /* discovery is best-effort — the connection still works */
  }
  return {};
}

/** Derives a traffic-light health state from what we actually know. */
export function computeHealth(row: {
  active: boolean;
  access_token: string | null;
  token_expires_at: string | null;
  last_synced_at: string | null;
}): ConnectionHealth {
  if (!row.active || !row.access_token) return "disconnected";
  if (row.token_expires_at && new Date(row.token_expires_at).getTime() < Date.now()) {
    return "disconnected";
  }
  const soon = 1000 * 60 * 60 * 72;
  if (row.token_expires_at && new Date(row.token_expires_at).getTime() - Date.now() < soon) {
    return "attention";
  }
  if (!row.last_synced_at) return "attention";
  const stale = Date.now() - new Date(row.last_synced_at).getTime() > 1000 * 60 * 60 * 24 * 7;
  return stale ? "attention" : "connected";
}

/** Stores an authorized connection (insert or refresh of an existing row). */
export async function saveAuthorizedConnection(args: {
  tenantId: string;
  platform: AccountPlatform;
  token: string;
  refreshToken?: string | null;
  expiresAt: string | null;
  grantedScopes?: string[];
  profile: DiscoveredProfile;
  permissions: string[];
}) {
  const meta = connector(args.platform);
  const label = args.profile.name ?? meta?.name ?? args.platform;
  const { data: existing } = await supabaseAdmin
    .from("social_accounts")
    .select("id, refresh_token")
    .eq("tenant_id", args.tenantId)
    .eq("platform", args.platform)
    .maybeSingle();

  const payload = {
    tenant_id: args.tenantId,
    platform: args.platform,
    label,
    external_id: args.profile.external_id ?? null,
    access_token: args.token,
    // Providers omit the refresh token on re-consent — keep the one we hold.
    refresh_token: args.refreshToken ?? existing?.refresh_token ?? null,
    token_expires_at: args.expiresAt,
    granted_scopes: args.grantedScopes?.length ? args.grantedScopes : null,
    active: true,
    health: "connected",
    status_reason: null,
    last_error: null,
    last_error_at: null,
    retry_count: 0,
    next_retry_at: null,
    connect_method: "oauth",
    profile: args.profile as unknown as never,
    permissions: { granted: args.permissions } as unknown as never,
    profile_url: args.profile.profile_url ?? meta?.manageUrl ?? null,
  };

  if (existing) {
    await supabaseAdmin.from("social_accounts").update(payload).eq("id", existing.id);
    return existing.id;
  }
  const { data } = await supabaseAdmin
    .from("social_accounts")
    .insert(payload)
    .select("id")
    .single();
  return data?.id ?? null;
}

function parseJson<T>(text: string, fallback: T): T {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return fallback;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return fallback;
  }
}

export type ScanResult = {
  overall: number;
  scores: Record<string, number>;
  findings: string[];
  measured: string[];
  estimated: string[];
};

const SCAN_KEYS = [
  "profile_optimization",
  "brand_consistency",
  "content_quality",
  "seo_discoverability",
  "engagement",
  "posting_consistency",
  "conversion_readiness",
];

/** Flas Account Scan — grades a connected account on what we can observe. */
export async function scanAccount(args: {
  account: {
    id: string;
    tenant_id: string;
    platform: string;
    label: string;
    profile: Record<string, unknown> | null;
    stats: Record<string, unknown> | null;
    last_synced_at: string | null;
  };
  posts: {
    caption: string;
    likes: number;
    comments_count: number;
    reach: number;
    published_at: string | null;
  }[];
  business: Record<string, unknown> | null;
}): Promise<ScanResult> {
  const meta = connector(args.account.platform);
  const system = `You are Flas, a senior social media strategist. Grade a business social account.
Return ONLY JSON: {"overall":0-100,"scores":{${SCAN_KEYS.map((k) => `"${k}":0-100`).join(",")}},"findings":["short specific issue", ...max 6],"measured":["metric names you actually used"],"estimated":["things you judged without hard data"]}
Never invent metrics. If data is missing, judge conservatively and list it under "estimated".`;
  const user = JSON.stringify(
    {
      platform: meta?.name ?? args.account.platform,
      account_label: args.account.label,
      profile: args.account.profile ?? {},
      platform_stats: args.account.stats ?? {},
      last_synced_at: args.account.last_synced_at,
      recent_posts: args.posts.slice(0, 15),
      business_knowledge: args.business ?? {},
    },
    null,
    1,
  ).slice(0, 12000);

  const text = await callFlashAi(system, user, {
    tenantId: args.account.tenant_id,
    feature: "connection_scan",
  });
  const parsed = parseJson<ScanResult>(text, {
    overall: 0,
    scores: {},
    findings: [],
    measured: [],
    estimated: [],
  });
  const scores: Record<string, number> = {};
  for (const key of SCAN_KEYS) {
    const value = Number(parsed.scores?.[key] ?? 0);
    scores[key] = Math.max(0, Math.min(100, Math.round(value)));
  }
  const values = Object.values(scores);
  const overall = parsed.overall
    ? Math.max(0, Math.min(100, Math.round(parsed.overall)))
    : Math.round(values.reduce((a, b) => a + b, 0) / (values.length || 1));
  return {
    overall,
    scores,
    findings: (parsed.findings ?? []).slice(0, 6).map((f) => String(f)),
    measured: (parsed.measured ?? []).slice(0, 8).map(String),
    estimated: (parsed.estimated ?? []).slice(0, 8).map(String),
  };
}

export type OptimizerResult = {
  bio: string;
  description: string;
  business_summary: string;
  keywords: string[];
  cta: string;
  hashtags: string[];
  notes: string[];
};

/** AI Profile Optimizer — copy-ready replacement profile content. */
export async function optimizeProfile(args: {
  platform: string;
  label: string;
  profile: Record<string, unknown> | null;
  business: Record<string, unknown> | null;
  findings: string[];
  tenantId?: string | null;
}): Promise<OptimizerResult> {
  const meta = connector(args.platform);
  const system = `You are Flas, a brand and local-SEO copywriter. Rewrite this business's ${meta?.name ?? args.platform} profile content.
Respect the platform's real limits (Instagram bio 150 chars, Google Business description 750 chars, LinkedIn tagline short, YouTube description longer).
Use the business's own products, services, locations and tone. No invented claims, no fake awards, no statistics.
Return ONLY JSON: {"bio":"","description":"","business_summary":"","keywords":[],"cta":"","hashtags":[],"notes":["what changed and why"]}`;
  const user = JSON.stringify(
    {
      platform: meta?.name,
      account: args.label,
      current_profile: args.profile ?? {},
      business_knowledge: args.business ?? {},
      scan_findings: args.findings,
    },
    null,
    1,
  ).slice(0, 12000);
  const text = await callFlashAi(system, user, {
    tenantId: args.tenantId ?? null,
    feature: "profile_optimize",
  });
  const parsed = parseJson<OptimizerResult>(text, {
    bio: "",
    description: "",
    business_summary: "",
    keywords: [],
    cta: "",
    hashtags: [],
    notes: [],
  });
  return {
    bio: String(parsed.bio ?? ""),
    description: String(parsed.description ?? ""),
    business_summary: String(parsed.business_summary ?? ""),
    keywords: (parsed.keywords ?? []).map(String).slice(0, 15),
    cta: String(parsed.cta ?? ""),
    hashtags: (parsed.hashtags ?? []).map(String).slice(0, 20),
    notes: (parsed.notes ?? []).map(String).slice(0, 8),
  };
}
