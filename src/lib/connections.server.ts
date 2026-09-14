// Server-only helpers for the Connect Your Business screen: profile discovery
// after authorization, connection health, Flas account scans and the AI
// profile optimizer. Tokens are only ever touched with the admin client.
import { openSecret, sealSecret } from "@/lib/secret-box.server";
import { isLegalTransition } from "@/lib/connection-state";
import { LINKEDIN_API_VERSION } from "@/lib/linkedin";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { deriveConnectionState } from "@/lib/connection-state.server";
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
    if (platform === "twitter") {
      // Every X API call is keyed on the numeric user id. With no discovery,
      // sync stopped at "Add your numeric X user ID" with nowhere to add it.
      const res = await fetch(
        "https://api.x.com/2/users/me?user.fields=profile_image_url,public_metrics,description",
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const json: any = await res.json().catch(() => ({}));
      const u = json?.data;
      if (!u?.id) return {};
      return {
        external_id: String(u.id),
        name: u.name,
        username: u.username,
        picture: u.profile_image_url,
        bio: u.description,
        followers:
          typeof u.public_metrics?.followers_count === "number"
            ? u.public_metrics.followers_count
            : undefined,
        profile_url: u.username ? `https://x.com/${u.username}` : undefined,
      };
    }
    if (platform === "pinterest") {
      const res = await fetch("https://api.pinterest.com/v5/user_account", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json: any = await res.json().catch(() => ({}));
      if (!res.ok || !json?.username) return {};
      return {
        external_id: String(json.id ?? json.username),
        name: json.business_name || json.username,
        username: json.username,
        picture: json.profile_image,
        website: json.website_url || undefined,
        followers: typeof json.follower_count === "number" ? json.follower_count : undefined,
        profile_url: `https://www.pinterest.com/${json.username}/`,
      };
    }
    if (platform === "tiktok") {
      const res = await fetch(
        "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url",
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const json: any = await res.json().catch(() => ({}));
      const u = json?.data?.user;
      if (!u?.open_id) return {};
      return { external_id: String(u.open_id), name: u.display_name, picture: u.avatar_url };
    }
    const targets = await import("@/lib/connection-targets.server");
    if (targets.hasTargetDiscovery(platform)) {
      // A LinkedIn member can administer several Company Pages, a Google
      // account can manage several locations, GA4 properties or Search Console
      // sites, and a Facebook login several ad accounts. Exactly one is
      // connected here; several go through the picker in the OAuth callback.
      const listed = await targets.listConnectionTargets(platform, token);
      if (listed.ok && listed.targets.length === 1) {
        return targets.targetProfile(listed.targets[0]!);
      }
      return {};
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
  /** A stored refresh token: the access token renews itself when it lapses. */
  renews?: boolean | undefined;
}): ConnectionHealth {
  if (!row.active || !row.access_token) return "disconnected";
  // An hour-long Google access token that has lapsed is not a disconnected
  // account when a refresh token will renew it. Reading it that way showed a
  // working connection as "disconnected" an hour after it was made.
  const expiresAt =
    !row.renews && row.token_expires_at ? new Date(row.token_expires_at).getTime() : null;
  if (expiresAt !== null && expiresAt < Date.now()) {
    return "disconnected";
  }
  const soon = 1000 * 60 * 60 * 72;
  if (expiresAt !== null && expiresAt - Date.now() < soon) {
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
  // The existing connection is the one for THIS provider account. It used to
  // be looked up by tenant and platform alone, so connecting a second channel
  // updated the first one's row -- its posts and comments were then attached
  // to an account they did not belong to, and it could inherit the other
  // account's refresh token. A connection whose account has not been
  // identified yet (a Meta login awaiting Page selection, or a platform
  // without discovery) reuses the one unidentified row for that platform
  // rather than touching an identified channel.
  const externalId = args.profile.external_id ?? null;
  const findExisting = async () => {
    const base = supabaseAdmin
      .from("social_accounts")
      .select("id, refresh_token, connection_state")
      .eq("tenant_id", args.tenantId)
      .eq("platform", args.platform);
    const scoped = externalId ? base.eq("external_id", externalId) : base.is("external_id", null);
    // limit(1), not maybeSingle(): a workspace with legacy duplicates made
    // maybeSingle() error, which read as "no existing row" and inserted yet
    // another copy.
    const { data } = await scoped.order("created_at", { ascending: true }).limit(1);
    return data?.[0] ?? null;
  };
  const existing = await findExisting();

  // Credentials are sealed before they reach the database (secret-box.server).
  // A refresh token kept from an earlier consent is stored exactly as it is.
  const sealedToken = await sealSecret(args.token);
  const sealedRefresh = args.refreshToken
    ? await sealSecret(args.refreshToken)
    : (existing?.refresh_token ?? null);

  const payload = {
    tenant_id: args.tenantId,
    platform: args.platform,
    label,
    external_id: args.profile.external_id ?? null,
    access_token: sealedToken,
    // Providers omit the refresh token on re-consent — keep the one we hold.
    refresh_token: sealedRefresh,
    token_expires_at: args.expiresAt,
    granted_scopes: args.grantedScopes?.length ? args.grantedScopes : null,
    active: true,
    health: "connected",
    // The state model is authoritative; `health` is retained for one release
    // so existing readers keep working through the deploy. Derived rather than
    // assumed "connected": a consent screen where the customer unticked a
    // permission lands in scope_incomplete, which the old code could not say.
    connection_state: deriveConnectionState({
      active: true,
      access_token: args.token,
      token_expires_at: args.expiresAt,
      granted_scopes: args.grantedScopes ?? null,
      platform: args.platform,
      refresh_token: args.refreshToken ?? existing?.refresh_token ?? null,
    }).state,
    state_reason: deriveConnectionState({
      active: true,
      access_token: args.token,
      token_expires_at: args.expiresAt,
      granted_scopes: args.grantedScopes ?? null,
      platform: args.platform,
      refresh_token: args.refreshToken ?? existing?.refresh_token ?? null,
    }).reason,
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
    // A revoked or disconnected connection may only move to certain states
    // (the trigger in 20260908100000 enforces it). Re-authorizing passes
    // through ready_to_authorize first, which is legal from both and leads to
    // every state a fresh login can produce.
    const from = (existing.connection_state ?? "not_configured") as never;
    const to = payload.connection_state as never;
    if (
      from !== to &&
      !isLegalTransition(from, to) &&
      isLegalTransition(from, "ready_to_authorize" as never)
    ) {
      await supabaseAdmin
        .from("social_accounts")
        .update({ connection_state: "ready_to_authorize", state_reason: "Re-authorizing" })
        .eq("id", existing.id)
        .eq("tenant_id", args.tenantId);
    }
    const { error: updateError } = await supabaseAdmin
      .from("social_accounts")
      .update(payload)
      .eq("id", existing.id)
      .eq("tenant_id", args.tenantId);
    // Ignoring this error is how a reconnect "succeeded" while the row stayed
    // revoked with its dead token: the state trigger rejected the change and
    // nothing said so.
    if (updateError) throw new Error(`Could not save the connection: ${updateError.message}`);
    return existing.id;
  }
  const { data, error } = await supabaseAdmin
    .from("social_accounts")
    .insert(payload)
    .select("id")
    .single();
  // Two callbacks for the same channel racing each other: the unique index
  // (20260911110000) lets one insert win, and the other refreshes that row.
  if (error?.code === "23505") {
    const winner = await findExisting();
    if (winner) {
      await supabaseAdmin
        .from("social_accounts")
        .update({
          ...payload,
          refresh_token: args.refreshToken ? sealedRefresh : (winner.refresh_token ?? null),
        })
        .eq("id", winner.id)
        .eq("tenant_id", args.tenantId);
      return winner.id;
    }
  }
  if (error) throw new Error(`Could not save the connection: ${error.message}`);
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

/**
 * Ends Flas's hold on a connection's credentials.
 *
 * Tokens are always removed locally, whatever the provider says: a failed or
 * unreachable revocation endpoint must never leave a disconnected account able
 * to act on the customer's behalf.
 *
 * Revocation at the provider is attempted only where it cannot break other
 * connections. Google's revoke endpoint cancels the whole grant for the Flas
 * app, and with include_granted_scopes one person's YouTube, Business Profile
 * and Analytics connections share that grant -- so it is only called when this
 * is the workspace's last Google connection holding a token. Meta's
 * equivalent removes the app for that person across every Page and Instagram
 * account they connected, and needs the user token, which is replaced by a
 * Page token once a Page is chosen, so it is not called.
 */
export async function revokeAndClearTokens(args: {
  accountId: string;
  tenantId: string;
  platform: string;
}): Promise<{ revoked: boolean | "skipped" | "unsupported"; reason: string }> {
  const { data: row } = await supabaseAdmin
    .from("social_accounts")
    .select("access_token, refresh_token")
    .eq("id", args.accountId)
    .eq("tenant_id", args.tenantId)
    .maybeSingle();

  // Revocation needs the real token. A value that will not open is still
  // removed below; it just cannot be revoked at the provider.
  const plainRefresh = await openSecret(row?.refresh_token).catch(() => null);
  const plainAccess = await openSecret(row?.access_token).catch(() => null);

  const provider = connector(args.platform)?.provider ?? null;
  let revoked: boolean | "skipped" | "unsupported" = "unsupported";
  let reason =
    "Flas removed its copy of the credentials. This platform is not asked to revoke them.";

  const token = plainRefresh || plainAccess || null;
  if (provider === "google" && token) {
    const { data: siblings } = await supabaseAdmin
      .from("social_accounts")
      .select("id, platform")
      .eq("tenant_id", args.tenantId)
      .neq("id", args.accountId)
      .not("access_token", "is", null);
    const otherGoogle = (siblings ?? []).some((s) => connector(s.platform)?.provider === "google");
    if (otherGoogle) {
      revoked = "skipped";
      reason =
        "Flas removed its copy of the credentials. Google was not asked to revoke access, because another Google connection in this workspace may share the same authorization.";
    } else {
      try {
        const res = await fetch("https://oauth2.googleapis.com/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token }).toString(),
          signal: AbortSignal.timeout(8000),
        });
        revoked = res.ok;
        reason = res.ok
          ? "Google revoked Flas's access, and Flas removed its copy of the credentials."
          : `Google did not confirm the revocation (HTTP ${res.status}); Flas removed its copy of the credentials anyway.`;
      } catch {
        revoked = false;
        reason =
          "Google did not respond to the revocation request; Flas removed its copy of the credentials anyway.";
      }
    }
  } else if (provider === "meta") {
    reason =
      "Flas removed its copy of the credentials. To remove Flas from Facebook as well, remove it from the connected apps in your Facebook settings.";
  }

  await supabaseAdmin
    .from("social_accounts")
    .update({
      access_token: null,
      refresh_token: null,
      token_expires_at: null,
      refresh_locked_until: null as never,
    } as never)
    .eq("id", args.accountId)
    .eq("tenant_id", args.tenantId);

  return { revoked, reason };
}
