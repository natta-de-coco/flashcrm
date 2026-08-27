// Server-only OAuth plumbing for platform connections. Flas never asks the
// user for a platform password: we redirect to the platform's own consent
// screen and exchange the returned code for a token server-side.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { AccountPlatform, Connector } from "./connections-catalog";
import { connector } from "./connections-catalog";

type Provider = NonNullable<Connector["provider"]>;

type ProviderConfig = {
  authorizeUrl: string;
  tokenUrl: string;
  idEnv: string;
  secretEnv: string;
  /** Scopes per platform id. */
  scopes: Partial<Record<AccountPlatform, string[]>>;
  extraAuthParams?: Record<string, string>;
};

export const PROVIDERS: Record<Provider, ProviderConfig> = {
  meta: {
    authorizeUrl: "https://www.facebook.com/v21.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v21.0/oauth/access_token",
    idEnv: "META_APP_ID",
    secretEnv: "META_APP_SECRET",
    scopes: {
      facebook: [
        "pages_show_list",
        "pages_read_engagement",
        "pages_manage_posts",
        "pages_messaging",
        "read_insights",
      ],
      instagram: [
        "instagram_basic",
        "instagram_manage_comments",
        "instagram_manage_insights",
        "instagram_content_publish",
        "pages_show_list",
      ],
      threads: ["threads_basic", "threads_content_publish", "threads_manage_insights"],
      meta_ads: ["ads_read", "ads_management", "business_management"],
    },
  },
  google: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    idEnv: "GOOGLE_OAUTH_CLIENT_ID",
    secretEnv: "GOOGLE_OAUTH_CLIENT_SECRET",
    scopes: {
      youtube: [
        "https://www.googleapis.com/auth/youtube.readonly",
        "https://www.googleapis.com/auth/youtube.force-ssl",
      ],
      google_business: ["https://www.googleapis.com/auth/business.manage"],
      google_ads: ["https://www.googleapis.com/auth/adwords"],
      google_analytics: ["https://www.googleapis.com/auth/analytics.readonly"],
      search_console: ["https://www.googleapis.com/auth/webmasters.readonly"],
    },
    extraAuthParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
  },
  linkedin: {
    authorizeUrl: "https://www.linkedin.com/oauth/v2/authorization",
    tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
    idEnv: "LINKEDIN_CLIENT_ID",
    secretEnv: "LINKEDIN_CLIENT_SECRET",
    scopes: {
      linkedin: ["r_organization_social", "w_organization_social", "rw_organization_admin"],
      linkedin_ads: ["r_ads", "r_ads_reporting"],
    },
  },
  tiktok: {
    authorizeUrl: "https://www.tiktok.com/v2/auth/authorize/",
    tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
    idEnv: "TIKTOK_CLIENT_KEY",
    secretEnv: "TIKTOK_CLIENT_SECRET",
    scopes: {
      tiktok: ["user.info.basic", "user.info.profile", "user.info.stats", "video.list"],
      tiktok_ads: ["user.info.basic"],
    },
  },
  twitter: {
    authorizeUrl: "https://twitter.com/i/oauth2/authorize",
    tokenUrl: "https://api.twitter.com/2/oauth2/token",
    idEnv: "X_CLIENT_ID",
    secretEnv: "X_CLIENT_SECRET",
    scopes: { twitter: ["tweet.read", "tweet.write", "users.read", "offline.access"] },
    extraAuthParams: { code_challenge: "challenge", code_challenge_method: "plain" },
  },
  pinterest: {
    authorizeUrl: "https://www.pinterest.com/oauth/",
    tokenUrl: "https://api.pinterest.com/v5/oauth/token",
    idEnv: "PINTEREST_APP_ID",
    secretEnv: "PINTEREST_APP_SECRET",
    scopes: { pinterest: ["boards:read", "pins:read", "pins:write", "user_accounts:read"] },
  },
};

export type StartResult =
  | { ready: true; url: string }
  | { ready: false; reason: string; missing: string[] };

/** Credentials the workspace owner must add before a platform can be authorized. */
export function providerCredentials(provider: Provider): {
  id: string | undefined;
  secret: string | undefined;
} {
  const cfg = PROVIDERS[provider];
  return { id: process.env[cfg.idEnv], secret: process.env[cfg.secretEnv] };
}

/**
 * Credentials for one workspace. Each company can paste its own platform app
 * keys once (Integrations → Platform apps); Flas falls back to the shared
 * Mobi Digital Solutions app keys when a workspace has none of its own.
 */
export async function resolveCredentials(
  provider: Provider,
  tenantId?: string | null,
): Promise<{ id: string | undefined; secret: string | undefined; source: "workspace" | "shared" }> {
  if (tenantId) {
    const { data } = await supabaseAdmin
      .from("platform_apps")
      .select("client_id, client_secret")
      .eq("tenant_id", tenantId)
      .eq("provider", provider)
      .maybeSingle();
    if (data?.client_id && data.client_secret) {
      return { id: data.client_id, secret: data.client_secret, source: "workspace" };
    }
  }
  const env = providerCredentials(provider);
  return { ...env, source: "shared" };
}

export function providerEnvNames(provider: Provider): string[] {
  const cfg = PROVIDERS[provider];
  return [cfg.idEnv, cfg.secretEnv];
}

/** Builds the platform consent URL and records a single-use state row. */
export async function startAuthorization(args: {
  platform: AccountPlatform;
  origin: string;
  tenantId: string;
  userId: string;
}): Promise<StartResult> {
  const meta = connector(args.platform);
  if (!meta?.oauth || !meta.provider) {
    return {
      ready: false,
      reason: `${meta?.name ?? args.platform} does not offer a public authorization flow.`,
      missing: [],
    };
  }
  const cfg = PROVIDERS[meta.provider];
  const creds = await resolveCredentials(meta.provider, args.tenantId);
  if (!creds.id || !creds.secret) {
    return {
      ready: false,
      reason: `${meta.name} needs your own ${meta.provider} app keys. Open Integrations → Platform apps, paste the App ID and Secret once, and every account on this platform then connects with one click.`,
      missing: providerEnvNames(meta.provider),
    };
  }

  const state = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const redirectUri = `${args.origin}/api/public/oauth-callback`;

  const { error } = await supabaseAdmin.from("oauth_states").insert({
    tenant_id: args.tenantId,
    user_id: args.userId,
    platform: args.platform,
    state,
    redirect_uri: redirectUri,
  });
  if (error) return { ready: false, reason: error.message, missing: [] };

  const scopes = cfg.scopes[args.platform] ?? [];
  const params = new URLSearchParams({
    client_id: creds.id,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
    ...(scopes.length ? { scope: scopes.join(meta.provider === "meta" ? "," : " ") } : {}),
    ...(cfg.extraAuthParams ?? {}),
  });
  if (meta.provider === "tiktok") {
    params.delete("client_id");
    params.set("client_key", creds.id);
  }
  return { ready: true, url: `${cfg.authorizeUrl}?${params.toString()}` };
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string | string[];
  data?: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string | string[];
  };
  error?: unknown;
  error_description?: string;
};

export type TokenSet = {
  token: string;
  refreshToken: string | null;
  expiresAt: string | null;
  scopes: string[];
};

function readTokenSet(json: TokenResponse): TokenSet | null {
  const token = json.access_token ?? json.data?.access_token;
  if (!token) return null;
  const expiresIn = json.expires_in ?? json.data?.expires_in;
  const rawScope = json.scope ?? json.data?.scope;
  const scopes = Array.isArray(rawScope)
    ? rawScope
    : typeof rawScope === "string"
      ? rawScope.split(/[ ,]+/).filter(Boolean)
      : [];
  return {
    token,
    refreshToken: json.refresh_token ?? json.data?.refresh_token ?? null,
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
    scopes,
  };
}

function applyClientCredentials(
  body: URLSearchParams,
  provider: Provider,
  id: string,
  secret: string,
) {
  if (provider === "tiktok") {
    body.set("client_key", id);
    body.set("client_secret", secret);
    return;
  }
  body.set("client_id", id);
  body.set("client_secret", secret);
}

/** Exchanges an authorization code for an access token (and refresh token). */
export async function exchangeCode(args: {
  provider: Provider;
  code: string;
  redirectUri: string;
  tenantId?: string | null;
}): Promise<TokenSet> {
  const cfg = PROVIDERS[args.provider];
  const creds = await resolveCredentials(args.provider, args.tenantId);
  if (!creds.id || !creds.secret) throw new Error("Platform app credentials are missing.");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: args.code,
    redirect_uri: args.redirectUri,
  });
  applyClientCredentials(body, args.provider, creds.id, creds.secret);
  if (args.provider === "twitter") body.set("code_verifier", "challenge");

  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  const set = readTokenSet(json);
  if (!res.ok || !set) {
    throw new Error(`Token exchange failed for ${args.provider} (HTTP ${res.status}).`);
  }
  return set;
}

/**
 * Refreshes an access token. Meta long-lived page tokens have no refresh
 * token, so we exchange the existing token for a fresh long-lived one instead.
 */
export async function refreshAccessToken(args: {
  provider: Provider;
  refreshToken: string | null;
  currentToken: string | null;
  tenantId?: string | null;
}): Promise<TokenSet> {
  const cfg = PROVIDERS[args.provider];
  const creds = await resolveCredentials(args.provider, args.tenantId);
  if (!creds.id || !creds.secret) throw new Error("Platform app credentials are missing.");

  if (args.provider === "meta") {
    if (!args.currentToken) throw new Error("No token to extend.");
    const url = `${cfg.tokenUrl}?${new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: creds.id,
      client_secret: creds.secret,
      fb_exchange_token: args.currentToken,
    }).toString()}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    const json = (await res.json().catch(() => ({}))) as TokenResponse;
    const set = readTokenSet(json);
    if (!res.ok || !set) throw new Error(`Meta token extension failed (HTTP ${res.status}).`);
    return set;
  }

  if (!args.refreshToken) {
    throw new Error("This platform did not return a refresh token — reconnect once to renew it.");
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: args.refreshToken,
  });
  applyClientCredentials(body, args.provider, creds.id, creds.secret);

  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  const set = readTokenSet(json);
  if (!res.ok || !set) {
    const detail = json.error_description ? `: ${json.error_description}` : "";
    throw new Error(`Token refresh failed for ${args.provider} (HTTP ${res.status})${detail}`);
  }
  return { ...set, refreshToken: set.refreshToken ?? args.refreshToken };
}

/** Consumes a state row exactly once. */
export async function consumeState(state: string) {
  const { data, error } = await supabaseAdmin
    .from("oauth_states")
    .select("id, tenant_id, user_id, platform, redirect_uri, expires_at, used_at")
    .eq("state", state)
    .maybeSingle();
  if (error || !data) return null;
  if (data.used_at) return null;
  if (new Date(data.expires_at).getTime() < Date.now()) return null;
  await supabaseAdmin
    .from("oauth_states")
    .update({ used_at: new Date().toISOString() })
    .eq("id", data.id);
  return data;
}
