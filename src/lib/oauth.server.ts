// Server-only OAuth plumbing for platform connections. Flas never asks the
// user for a platform password: we redirect to the platform's own consent
// screen and exchange the returned code for a token server-side.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { connectorDefinition } from "@/lib/social-connector-definitions";
import type { AccountPlatform, Connector } from "./connections-catalog";
import { connector } from "./connections-catalog";

type Provider = NonNullable<Connector["provider"]>;

type ProviderConfig = {
  authorizeUrl: string;
  tokenUrl: string;
  idEnv: string;
  secretEnv: string;
  /**
   * Facebook Login for Business replaces the scope list with a *configuration*
   * created in the app dashboard, passed as `config_id`. Meta's own guidance is
   * that scope "can still be included, but we recommend that you do not use it"
   * once a configuration exists, because the configuration is what the business
   * actually consented to. Optional: unset means the classic scope flow, which
   * is what every existing connection was made with.
   */
  configIdEnv?: string;
  /** Scopes per platform id. */
  extraAuthParams?: Record<string, string>;
};

export const PROVIDERS: Record<Provider, ProviderConfig> = {
  meta: {
    authorizeUrl: "https://www.facebook.com/v21.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v21.0/oauth/access_token",
    idEnv: "META_APP_ID",
    secretEnv: "META_APP_SECRET",
    configIdEnv: "META_LOGIN_CONFIG_ID",
  },
  google: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    idEnv: "GOOGLE_OAUTH_CLIENT_ID",
    secretEnv: "GOOGLE_OAUTH_CLIENT_SECRET",
    // select_account: Google shows its account chooser every time, including
    // Brand Accounts, so nobody connects the wrong personal account because
    // the browser happened to be signed in to it. consent: a refresh token is
    // returned on every authorization. include_granted_scopes: an upgrade adds
    // permissions without dropping the ones already granted.
    extraAuthParams: {
      access_type: "offline",
      prompt: "select_account consent",
      include_granted_scopes: "true",
    },
  },
  linkedin: {
    authorizeUrl: "https://www.linkedin.com/oauth/v2/authorization",
    tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
    idEnv: "LINKEDIN_CLIENT_ID",
    secretEnv: "LINKEDIN_CLIENT_SECRET",
  },
  tiktok: {
    authorizeUrl: "https://www.tiktok.com/v2/auth/authorize/",
    tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
    idEnv: "TIKTOK_CLIENT_KEY",
    secretEnv: "TIKTOK_CLIENT_SECRET",
  },
  twitter: {
    authorizeUrl: "https://twitter.com/i/oauth2/authorize",
    tokenUrl: "https://api.twitter.com/2/oauth2/token",
    idEnv: "X_CLIENT_ID",
    secretEnv: "X_CLIENT_SECRET",
    // Real PKCE is generated per-authorization below.  The hardcoded challenge
    // used previously was equivalent to no PKCE at all and would be rejected by
    // X's confidential-client / stricter modes.
    extraAuthParams: {},
  },
  pinterest: {
    authorizeUrl: "https://www.pinterest.com/oauth/",
    tokenUrl: "https://api.pinterest.com/v5/oauth/token",
    idEnv: "PINTEREST_APP_ID",
    secretEnv: "PINTEREST_APP_SECRET",
  },
};

export type StartResult =
  { ready: true; url: string } | { ready: false; reason: string; missing: string[] };

/** Providers that require PKCE (send code_challenge on auth, code_verifier on exchange). */
// TikTok requires PKCE; Google and X support S256 and reject nothing by
// sending it. Meta's classic dialog and Pinterest are left out deliberately —
// an unsupported code_challenge is an unknown parameter, and providers differ
// in whether they ignore or reject those. Widen only with a verified source.
const PKCE_PROVIDERS: Provider[] = ["twitter", "tiktok", "google"];

function base64UrlEncode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Generate a real PKCE pair (S256).  Verifier is 43+ chars; challenge is
 *  sha256(verifier) base64url-encoded — exactly per RFC 7636. */
async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
  const rand = new Uint8Array(32);
  crypto.getRandomValues(rand);
  const verifier = base64UrlEncode(rand.buffer);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64UrlEncode(digest) };
}

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

/**
 * Whether each OAuth provider family can actually be authorized for this
 * workspace, and where the keys come from. Drives the "Add app keys" state in
 * the Integrations screen so a company always sees the exact blocker.
 */
export async function providerReadiness(
  tenantId?: string | null,
): Promise<
  Record<Provider, { ready: boolean; source: "workspace" | "shared" | "none"; envNames: string[] }>
> {
  const providers = Object.keys(PROVIDERS) as Provider[];
  const entries = await Promise.all(
    providers.map(async (provider) => {
      const creds = await resolveCredentials(provider, tenantId);
      const ready = Boolean(creds.id && creds.secret);
      return [
        provider,
        {
          ready,
          source: ready ? creds.source : ("none" as const),
          envNames: providerEnvNames(provider),
        },
      ] as const;
    }),
  );
  return Object.fromEntries(entries) as Awaited<ReturnType<typeof providerReadiness>>;
}

/** SHA-256 as lowercase hex, matching what the database stores. */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The origins a provider may redirect back to.
 *
 * OAUTH_ALLOWED_ORIGINS is a comma-separated list. When it is unset the
 * deployment's own PUBLIC_APP_URL is used, and failing that localhost — so a
 * developer is not blocked, while production is only ever as open as it is
 * configured to be.
 *
 * Compared on the parsed origin rather than by string prefix: "https://flas.example"
 * must not match "https://flas.example.attacker.test".
 */
/**
 * One configured allow-list entry, as an origin.
 *
 * A bare host is accepted. Every social connection on the deployment was
 * refused because OAUTH_ALLOWED_ORIGINS held "flas.mobidigisol.com" while
 * this code compared it against "https://flas.mobidigisol.com": new URL() on
 * a bare host throws, the entry was skipped, and nothing could ever match --
 * with no message saying the configuration was the problem.
 *
 * Only the host shorthand is inferred, and only as https. A scheme that is
 * present is still honoured exactly (so http://localhost keeps working), and
 * an entry with a path, credentials or anything else unparseable still throws
 * to the caller, which refuses it.
 */
function originOfEntry(entry: string): string {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(entry) ? entry : `https://${entry}`;
  return new URL(withScheme).origin;
}

export function resolveAllowedOrigin(candidate: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== "https:" &&
    parsed.hostname !== "localhost" &&
    parsed.hostname !== "127.0.0.1"
  ) {
    return null;
  }

  const configured = (process.env["OAUTH_ALLOWED_ORIGINS"] ?? process.env["PUBLIC_APP_URL"] ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  const allowed = configured.length
    ? configured
    : ["http://localhost:8080", "http://127.0.0.1:8080"];

  for (const entry of allowed) {
    try {
      if (originOfEntry(entry) === parsed.origin) return parsed.origin;
    } catch {
      /* a malformed entry in configuration must not allow everything */
    }
  }
  return null;
}

/** Builds the platform consent URL and records a single-use state row. */
export async function startAuthorization(args: {
  platform: AccountPlatform;
  origin: string;
  tenantId: string;
  userId: string;
  /** Batch 2A: what this attempt is for. Defaults to a first connection. */
  purpose?: "connect" | "reconnect" | "upgrade";
  /** Batch 2A: authorization tiers to request. Defaults to the initial tiers. */
  tierIds?: readonly string[];
  /** Batch 2A: the channel a reconnect or upgrade is for. */
  targetAccountId?: string | null;
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
      reason: `${meta.name} needs your own ${meta.provider} app keys. Open Connect & setup → Platform app keys, paste the ${meta.provider} App ID and Secret once, and every account on this platform then connects with one click.`,
      missing: providerEnvNames(meta.provider),
    };
  }

  // The origin arrives from the browser, so it decides where a provider sends
  // an authorization code. Providers enforce their own redirect allowlists,
  // which limits the damage, but an unchecked value here is still an
  // attacker-controlled input reaching an outbound URL. Check it against ours.
  const allowedOrigin = resolveAllowedOrigin(args.origin);
  if (!allowedOrigin) {
    // Almost always a deployment that was never told its own address: with no
    // OAUTH_ALLOWED_ORIGINS or PUBLIC_APP_URL the allowlist is loopback only,
    // and every provider is refused. Name the setting so the fix is obvious.
    let attempted = "this address";
    try {
      attempted = new URL(args.origin).origin;
    } catch {
      /* keep the generic wording for a malformed origin */
    }
    return {
      ready: false,
      reason: `${attempted} is not an allowed sign-in return address for this deployment. Add it to OAUTH_ALLOWED_ORIGINS in the host's secrets and redeploy.`,
      missing: ["OAUTH_ALLOWED_ORIGINS"],
    };
  }

  // Tokens are stored encrypted or not at all. Checked before the consent
  // screen, so a customer never approves access Flas then cannot keep.
  const { encryptionConfigured } = await import("@/lib/social-secrets.server");
  if (!encryptionConfigured()) {
    return {
      ready: false,
      reason:
        "Flas cannot store this connection securely yet: token encryption is not configured on this deployment.",
      missing: ["SOCIAL_TOKEN_ENCRYPTION_KEYS", "SOCIAL_TOKEN_ACTIVE_KEY_ID"],
    };
  }

  // 32 bytes from the CSPRNG = 256 bits, base64url-encoded (43 characters).
  // The previous two UUIDv4s gave ~244: six bits of each are fixed
  // version/variant markers, not randomness.
  const stateBytes = new Uint8Array(32);
  crypto.getRandomValues(stateBytes);
  const state = base64UrlEncode(stateBytes.buffer);
  // Only the digest is stored. The state itself lives in the provider's
  // redirect URL and nowhere we control, so reading oauth_states yields
  // nothing that can be replayed against a live authorization.
  const stateHash = await sha256Hex(state);
  const redirectUri = `${allowedOrigin}/api/public/oauth-callback`;

  // Real PKCE for providers that need it — verifier stored per-state row.
  const usePkce = PKCE_PROVIDERS.includes(meta.provider);
  const pkce = usePkce ? await generatePkce() : null;

  // The PKCE verifier is encrypted like a token. A verifier plus an
  // intercepted authorization code is a completed authorization, so it must
  // not sit readable in a table.
  let verifierEnc: string | null = null;
  if (pkce) {
    const { encryptSecret, tokenAad } = await import("@/lib/social-secrets.server");
    verifierEnc = await encryptSecret(
      pkce.verifier,
      tokenAad(args.tenantId, `oauth:${stateHash}`, "code_verifier"),
    );
  }

  // Scopes come from the registry. Connectors with authorization tiers ask
  // only for the tiers requested (the initial ones on a first connection) --
  // progressive authorization -- and a tier for code that does not exist is
  // refused, not silently requested.
  const def = connectorDefinition(args.platform);
  let requestedScopes: string[];
  try {
    if (def?.authorizationTiers?.length) {
      const { initialTierIds, scopesForTiers } = await import("@/lib/social-connector-definitions");
      requestedScopes = scopesForTiers(
        def,
        args.tierIds?.length ? args.tierIds : initialTierIds(def),
      );
    } else {
      requestedScopes = [...(def?.requestedScopes ?? [])];
    }
  } catch (e) {
    return {
      ready: false,
      reason: e instanceof Error ? e.message : "That permission cannot be requested.",
      missing: [],
    };
  }

  const { error } = await supabaseAdmin.from("oauth_states").insert({
    purpose: args.purpose ?? "connect",
    target_account_id: args.targetAccountId ?? null,
    requested_scopes: requestedScopes,
    tenant_id: args.tenantId,
    user_id: args.userId,
    platform: args.platform,
    provider: meta.provider,
    state_hash: stateHash,
    redirect_uri: redirectUri,
    code_verifier: verifierEnc,
  });
  if (error) return { ready: false, reason: error.message, missing: [] };

  // State bookkeeping and housekeeping. Both best-effort: neither may block a
  // connection. The sweep runs here because nothing else ever called it --
  // abandoned attempts were only ever *read* as expired, never retired.
  try {
    const { beginAuthorization, sweepAbandonedAttempts } =
      await import("@/lib/connection-state.server");
    await beginAuthorization({
      tenantId: args.tenantId,
      platform: args.platform,
      actorId: args.userId,
      accountId: args.targetAccountId ?? null,
    });
    await sweepAbandonedAttempts().catch(() => undefined);
  } catch {
    /* bookkeeping only */
  }

  // Scopes come from the connector registry, not from a list kept here.
  // There were three copies of this data -- here, connection-setup.ts and
  // connection-status.ts -- and they had already drifted: the setup wizard
  // told users TikTok requests video.publish, which this file never sent.
  const scopes = requestedScopes;
  const params = buildAuthorizeParams({
    provider: meta.provider,
    clientId: creds.id,
    redirectUri,
    state,
    scopes,
    extraAuthParams: cfg.extraAuthParams,
    configId: cfg.configIdEnv ? process.env[cfg.configIdEnv] : undefined,
    pkceChallenge: pkce?.challenge,
  });
  return { ready: true, url: `${cfg.authorizeUrl}?${params.toString()}` };
}

/**
 * Builds the authorization query string. Pure — no database, no clock, no
 * randomness — so the rules below are covered by tests rather than only by
 * whatever a live provider happens to accept.
 */
export function buildAuthorizeParams(args: {
  provider: Provider;
  clientId: string;
  redirectUri: string;
  state: string;
  /** Readonly: the registry exposes its scope lists as const. */
  scopes: readonly string[];
  // Explicit `| undefined` because the project sets exactOptionalPropertyTypes.
  extraAuthParams?: Record<string, string> | undefined;
  configId?: string | undefined;
  pkceChallenge?: string | undefined;
}): URLSearchParams {
  // A configuration supersedes the scope list. Sending both invites the two to
  // disagree, and the configuration is the one the business granted.
  const useConfigId = Boolean(args.configId);
  const scopeSeparator = args.provider === "meta" ? "," : " ";

  const params = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    response_type: "code",
    state: args.state,
    ...(useConfigId ? { config_id: args.configId as string } : {}),
    ...(!useConfigId && args.scopes.length ? { scope: args.scopes.join(scopeSeparator) } : {}),
    ...(args.extraAuthParams ?? {}),
  });

  if (args.pkceChallenge) {
    params.set("code_challenge", args.pkceChallenge);
    params.set("code_challenge_method", "S256");
  }
  if (args.provider === "tiktok") {
    params.delete("client_id");
    params.set("client_key", args.clientId);
  }
  return params;
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

/**
 * A token endpoint that answered, and refused.
 *
 * The status and the parsed body travel with the error because
 * normalizeProviderError needs both to say anything specific. Given only a
 * thrown Error it takes its "never reached the provider" branch and files the
 * refusal as a transient network fault -- so a wrong app secret, an
 * unregistered redirect URI, and an app still in Development mode were all
 * recorded as "usually a temporary network problem, no action needed", and the
 * Meta code table was unreachable from the one flow that needed it most.
 *
 * The body is the provider's parsed JSON. It is passed to normalizeProviderError,
 * which redacts before anything is stored; it is never returned to the browser.
 */
export class ProviderTokenError extends Error {
  readonly httpStatus: number;
  readonly body: unknown;
  constructor(provider: Provider, httpStatus: number, body: unknown) {
    // The wording is load-bearing: sanitizeError in the callback matches
    // "token exchange failed" to choose the code shown in the browser.
    super(`Token exchange failed for ${provider} (HTTP ${httpStatus}).`);
    this.name = "ProviderTokenError";
    this.httpStatus = httpStatus;
    this.body = body;
  }
}

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
  // Pinterest and X (for confidential clients) authenticate the client with
  // HTTP Basic -- see tokenRequestHeaders. The secret must not also be in the
  // body: RFC 6749 forbids using two client-authentication methods at once.
  // X's PKCE flow still takes client_id in the body; Pinterest's does not.
  if (BASIC_AUTH_PROVIDERS.includes(provider)) {
    if (provider === "twitter") body.set("client_id", id);
    return;
  }
  body.set("client_id", id);
  body.set("client_secret", secret);
}

/**
 * Providers whose token endpoint takes client credentials as HTTP Basic.
 * Verified 2026-09-11: Pinterest's token docs use Basic; X's say confidential
 * clients "will need to use a basic authentication scheme".
 */
const BASIC_AUTH_PROVIDERS: readonly Provider[] = ["pinterest", "twitter"];

/** Token-endpoint headers, including HTTP Basic for providers that need it. */
export function tokenRequestHeaders(
  provider: Provider,
  id: string,
  secret: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  if (BASIC_AUTH_PROVIDERS.includes(provider)) {
    headers["Authorization"] = `Basic ${btoa(`${id}:${secret}`)}`;
  }
  return headers;
}

/** Exchanges an authorization code for an access token (and refresh token). */
export async function exchangeCode(args: {
  provider: Provider;
  code: string;
  redirectUri: string;
  tenantId?: string | null;
  /** Required for PKCE providers (twitter/X). Retrieved from oauth_states. */
  codeVerifier?: string | null;
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
  if (PKCE_PROVIDERS.includes(args.provider)) {
    if (!args.codeVerifier) {
      throw new Error(`${args.provider} requires a PKCE code_verifier from the state row.`);
    }
    body.set("code_verifier", args.codeVerifier);
  }

  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: tokenRequestHeaders(args.provider, creds.id, creds.secret),
    body: body.toString(),
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  const set = readTokenSet(json);
  if (!res.ok || !set) {
    throw new ProviderTokenError(args.provider, res.status, json);
  }
  return set;
}

/**
 * Swaps a short-lived Meta user token (valid for hours) for a long-lived one
 * (about 60 days). Page tokens fetched with a long-lived user token do not
 * expire, which is why this runs at connect time, before any Page token is
 * requested.
 *
 * Server-side only: the request carries the app secret. It is sent as a POST
 * form body, never a query string, so the secret cannot land in a URL, a proxy
 * log or a provider access log. Meta's documentation shows a GET; the endpoint
 * accepts the same parameters as a POST body (verified 2026-09-11 -- a POST
 * with a bad client_id returns "Invalid Client ID", so the body was parsed,
 * while a PUT reports the parameter missing).
 */
export async function exchangeForLongLivedToken(args: {
  tenantId?: string | null;
  token: string;
  fetchImpl?: typeof fetch;
}): Promise<TokenSet> {
  const creds = await resolveCredentials("meta", args.tenantId);
  if (!creds.id || !creds.secret) throw new Error("Platform app credentials are missing.");
  const res = await (args.fetchImpl ?? fetch)(PROVIDERS.meta.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: creds.id,
      client_secret: creds.secret,
      fb_exchange_token: args.token,
    }).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  const set = readTokenSet(json);
  if (!res.ok || !set) throw new Error(`Meta token extension failed (HTTP ${res.status}).`);
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
    // Was a GET with client_secret in the query string -- the app secret in a
    // URL, which Batch 1 forbids. Now a POST body, via the shared function.
    return exchangeForLongLivedToken({ tenantId: args.tenantId ?? null, token: args.currentToken });
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
    headers: tokenRequestHeaders(args.provider, creds.id, creds.secret),
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

/** Atomic single-use state consumption via the DB RPC.  A previous version
 *  did read-then-update in two queries, letting two concurrent callbacks with
 *  the same state both succeed.  The RPC uses a single UPDATE ... RETURNING
 *  with the `used_at IS NULL AND expires_at > now()` guard, so only one
 *  caller ever gets a row back. */
export async function consumeState(state: string): Promise<{
  tenant_id: string;
  user_id: string;
  platform: string;
  redirect_uri: string;
  code_verifier: string | null;
} | null> {
  // Looked up by digest, because the plaintext state is no longer stored.
  const { data, error } = await supabaseAdmin.rpc("consume_oauth_state_hash", {
    _state_hash: await sha256Hex(state),
  });
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    tenant_id: row.tenant_id,
    user_id: row.user_id,
    platform: row.platform,
    redirect_uri: row.redirect_uri,
    code_verifier: row.code_verifier ?? null,
  };
}
