/**
 * Social authorizations and the channels they reach (Batch 2A).
 *
 *   Authorization   a PERSON granted Flas access. Tokens live here, once.
 *   Discovery       Flas asks the provider which channels that person manages.
 *   Selection       the person chooses which of them to connect.
 *   Connection      one social_accounts row per chosen channel, referencing
 *                   the authorization instead of holding its own token.
 *
 * Nothing in this module returns a token to a caller outside the server, logs
 * one, or writes one unencrypted. Discovery results carry public metadata only.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  connectorDefinition,
  type ConnectorDefinition,
} from "@/lib/social-connector-definitions";
import { declinedScopes } from "@/lib/social-channel-capabilities";
import { decryptSecret, encryptSecret, readKeyRing } from "@/lib/social-secrets.server";
import {
  encryptTokensForStorage,
  readStoredTokens,
  TOKEN_READ_COLUMNS,
} from "@/lib/social-token-store.server";
import { isLegalTransition, type ConnectionState } from "@/lib/connection-state";

/** A discovery result may be acted on for this long; after that, re-authorize. */
export const DISCOVERY_TTL_MS = 60 * 60 * 1000;

export type DiscoveredChannel = {
  externalId: string;
  platform: string;
  accountType: string;
  name: string;
  handle: string | null;
  avatarUrl: string | null;
  description: string | null;
  metrics: { audience: number | null; content: number | null; views: number | null };
  /** Some discovered assets cannot be connected (a personal Instagram account). */
  eligible: boolean;
  ineligibleReason: string | null;
  /** For an Instagram account: the Facebook Page it is linked to. */
  linkedTo: { platform: string; name: string } | null;
};

export type ProviderIdentity = { userId: string | null; emailHint: string | null };

/* ---------------------------------------------------------------- tokens */

/** AAD for authorization tokens: bound to the specific authorization row. */
function authAad(tenantId: string, authorizationId: string, field: "access_token" | "refresh_token") {
  return `flas-social:v1:${tenantId}:authorization:${authorizationId}:${field}`;
}

export async function encryptAuthorizationTokens(args: {
  tenantId: string;
  authorizationId: string;
  accessToken: string | null;
  refreshToken: string | null;
}) {
  const ring = readKeyRing(); // throws when not configured: nothing is stored
  return {
    access_token_enc: args.accessToken
      ? await encryptSecret(args.accessToken, authAad(args.tenantId, args.authorizationId, "access_token"))
      : null,
    refresh_token_enc: args.refreshToken
      ? await encryptSecret(args.refreshToken, authAad(args.tenantId, args.authorizationId, "refresh_token"))
      : null,
    token_key_id: ring.active,
  };
}

export async function readAuthorizationTokens(row: {
  id: string;
  tenant_id: string;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
}): Promise<{ access: string | null; refresh: string | null }> {
  return {
    access: row.access_token_enc
      ? await decryptSecret(row.access_token_enc, authAad(row.tenant_id, row.id, "access_token"))
      : null,
    refresh: row.refresh_token_enc
      ? await decryptSecret(row.refresh_token_enc, authAad(row.tenant_id, row.id, "refresh_token"))
      : null,
  };
}

const AUTH_TOKEN_COLUMNS = "id, tenant_id, provider, access_token_enc, refresh_token_enc, expires_at, granted_scopes, requested_scopes, authorization_state";

/**
 * Tokens for one channel. Channel-model accounts read them from their
 * authorization; older accounts still hold their own.
 */
export async function readTokensForAccount(account: {
  tenant_id: string;
  platform: string;
  authorization_id?: string | null;
  access_token_enc?: string | null;
  refresh_token_enc?: string | null;
  access_token?: string | null;
  refresh_token?: string | null;
}): Promise<{ access: string | null; refresh: string | null; source: string }> {
  // A channel with its own token -- a Facebook Page or linked Instagram
  // account -- uses it. Otherwise the token is on the authorization.
  if (!account.authorization_id || account.access_token_enc) return readStoredTokens(account);
  const { data: auth } = await supabaseAdmin
    .from("social_authorizations")
    .select(AUTH_TOKEN_COLUMNS)
    .eq("id", account.authorization_id)
    .eq("tenant_id", account.tenant_id)
    .maybeSingle();
  if (!auth || auth.authorization_state === "disconnected" || auth.authorization_state === "revoked") {
    return { access: null, refresh: null, source: "none" };
  }
  const t = await readAuthorizationTokens(auth);
  return { ...t, source: "authorization" };
}

/* ------------------------------------------------------------- discovery */

/** Who signed in, from Google's OpenID userinfo. Best-effort; never blocks. */
export async function discoverGoogleIdentity(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderIdentity> {
  try {
    const res = await fetchImpl("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { userId: null, emailHint: null };
    const json = (await res.json()) as { sub?: string; email?: string };
    return { userId: json.sub ?? null, emailHint: json.email ?? null };
  } catch {
    return { userId: null, emailHint: null };
  }
}

type YouTubeChannelItem = {
  id?: string;
  snippet?: {
    title?: string;
    description?: string;
    customUrl?: string;
    thumbnails?: { default?: { url?: string }; medium?: { url?: string } };
  };
  statistics?: {
    subscriberCount?: string;
    hiddenSubscriberCount?: boolean;
    videoCount?: string;
    viewCount?: string;
  };
};

/**
 * Pure: turns a channels.list response into channel candidates. Split out so
 * the parsing is tested against fixtures without a network call.
 */
export function parseYouTubeChannels(json: { items?: YouTubeChannelItem[] }): DiscoveredChannel[] {
  const num = (v: string | undefined) => (v !== undefined && /^\d+$/.test(v) ? Number(v) : null);
  return (json.items ?? [])
    .filter((it): it is YouTubeChannelItem & { id: string } => typeof it.id === "string" && it.id.length > 0)
    .map((it) => ({
      externalId: it.id,
      platform: "youtube",
      accountType: "YouTube channel",
      name: it.snippet?.title?.trim() || "Untitled channel",
      handle: it.snippet?.customUrl ?? null,
      avatarUrl: it.snippet?.thumbnails?.medium?.url ?? it.snippet?.thumbnails?.default?.url ?? null,
      description: it.snippet?.description ? it.snippet.description.slice(0, 280) : null,
      metrics: {
        // A channel can hide its subscriber count; show "hidden", never 0.
        audience: it.statistics?.hiddenSubscriberCount ? null : num(it.statistics?.subscriberCount),
        content: num(it.statistics?.videoCount),
        views: num(it.statistics?.viewCount),
      },
      eligible: true,
      ineligibleReason: null,
      linkedTo: null,
    }));
}

/**
 * The channels this authorization reaches. `mine=true` returns the channel of
 * the identity chosen on Google's consent screen -- a person with a Brand
 * Account picks it there, which is why the account chooser is forced.
 */
export async function discoverYouTubeChannels(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; channels: DiscoveredChannel[] } | { ok: false; code: string; httpStatus: number | null }> {
  try {
    const res = await fetchImpl(
      "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true&maxResults=50",
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return { ok: false, code: "discovery_failed", httpStatus: res.status };
    return { ok: true, channels: parseYouTubeChannels((await res.json()) as { items?: YouTubeChannelItem[] }) };
  } catch {
    return { ok: false, code: "provider_unavailable", httpStatus: null };
  }
}

/* ---------------------------------------------------------------- Meta */

type MetaPageLike = {
  id: string;
  name: string;
  username: string | null;
  category: string | null;
  picture: string | null;
  followers: number | null;
  instagram: {
    id: string;
    username: string | null;
    name: string | null;
    picture: string | null;
    followers: number | null;
    biography: string | null;
  } | null;
};

/**
 * Pure: turns discovered Pages into channel candidates -- each Facebook Page,
 * and each Instagram professional account linked to one.
 *
 * It copies named fields only. A Page's access token is on the input object
 * and is deliberately never copied: discovery results are stored and shown in
 * the browser, and a Page token must never be in either.
 *
 * Eligibility follows what was actually granted. Meta lets a person untick
 * permissions, so a login can reach an Instagram account it has no Instagram
 * permission for; that account is shown, but not connectable.
 */
export function parseMetaChannels(
  pages: readonly MetaPageLike[],
  granted: readonly string[],
): DiscoveredChannel[] {
  const has = (s: string) => granted.includes(s);
  const out: DiscoveredChannel[] = [];
  for (const p of pages) {
    out.push({
      externalId: p.id,
      platform: "facebook",
      accountType: "Facebook Page",
      name: p.name,
      handle: p.username ? `@${p.username}` : null,
      avatarUrl: p.picture,
      description: p.category,
      metrics: { audience: p.followers, content: null, views: null },
      eligible: has("pages_show_list"),
      ineligibleReason: has("pages_show_list")
        ? null
        : "Facebook did not share your Pages with Flas. Sign in again and allow Page access.",
      linkedTo: null,
    });
    if (p.instagram) {
      out.push({
        externalId: p.instagram.id,
        platform: "instagram",
        accountType: "Instagram professional account",
        name: p.instagram.name ?? p.instagram.username ?? "Instagram account",
        handle: p.instagram.username ? `@${p.instagram.username}` : null,
        avatarUrl: p.instagram.picture,
        description: p.instagram.biography ? p.instagram.biography.slice(0, 280) : null,
        metrics: { audience: p.instagram.followers, content: null, views: null },
        eligible: has("instagram_basic"),
        ineligibleReason: has("instagram_basic")
          ? null
          : "Instagram access was not granted. Use Connect Instagram to add this account.",
        linkedTo: { platform: "facebook", name: p.name },
      });
    }
  }
  return out;
}

/** Permissions the person actually granted. Meta's token response has no scope list. */
export async function discoverMetaPermissions(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  try {
    const res = await fetchImpl("https://graph.facebook.com/v21.0/me/permissions", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: Array<{ permission?: string; status?: string }> };
    return (json.data ?? [])
      .filter((p) => p.status === "granted" && typeof p.permission === "string")
      .map((p) => p.permission as string);
  } catch {
    return [];
  }
}

/** Who signed in. Meta shares a name, not an email, without the email scope. */
export async function discoverMetaIdentity(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderIdentity> {
  try {
    const res = await fetchImpl("https://graph.facebook.com/v21.0/me?fields=id,name", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { userId: null, emailHint: null };
    const json = (await res.json()) as { id?: string; name?: string };
    return { userId: json.id ?? null, emailHint: json.name ?? null };
  } catch {
    return { userId: null, emailHint: null };
  }
}

export async function discoverChannels(
  platform: string,
  token: string,
): Promise<{
  identity: ProviderIdentity;
  channels: DiscoveredChannel[];
  error: string | null;
  /** Filled for providers whose token response carries no scope list. */
  grantedScopes: string[] | null;
}> {
  if (platform === "youtube") {
    const [identity, found] = await Promise.all([
      discoverGoogleIdentity(token),
      discoverYouTubeChannels(token),
    ]);
    return {
      identity,
      channels: found.ok ? found.channels : [],
      error: found.ok ? null : found.code,
      grantedScopes: null,
    };
  }
  if (platform === "facebook" || platform === "instagram") {
    const { discoverMetaTargets } = await import("@/lib/meta-discovery.server");
    const [identity, granted, targets] = await Promise.all([
      discoverMetaIdentity(token),
      discoverMetaPermissions(token),
      discoverMetaTargets(token),
    ]);
    return {
      identity,
      channels: targets.ok ? parseMetaChannels(targets.pages, granted) : [],
      error: targets.ok ? (targets.noPages ? "no_pages" : null) : "discovery_failed",
      grantedScopes: granted,
    };
  }
  return {
    identity: { userId: null, emailHint: null },
    channels: [],
    error: "discovery_not_implemented",
    grantedScopes: null,
  };
}

/* ------------------------------------------------------------ callback */

export type CompletionOutcome =
  | { kind: "select"; authorizationId: string }
  | { kind: "reconnected"; accountId: string; authorizationId: string }
  | { kind: "no_channels"; authorizationId: string; reason: string };

/**
 * Stores the authorization, discovers its channels, and decides where the
 * callback sends the user next. Called only from the OAuth callback, after the
 * state row has been consumed and the code exchanged.
 */
export async function completeChannelAuthorization(args: {
  tenantId: string;
  userId: string | null;
  platform: string;
  provider: string;
  stateHash: string;
  tokens: { token: string; refreshToken: string | null; expiresAt: string | null; scopes: string[] };
}): Promise<CompletionOutcome> {
  // What the attempt was for. Read by digest from the consumed row: the row
  // survives consumption, and the plaintext state is never stored.
  const { data: attempt } = await supabaseAdmin
    .from("oauth_states")
    .select("purpose, target_account_id, requested_scopes")
    .eq("state_hash", args.stateHash)
    .eq("tenant_id", args.tenantId)
    .maybeSingle();

  // Meta: swap the short-lived user token (valid for hours) for a long-lived
  // one (about 60 days) BEFORE discovery. Page tokens fetched with a
  // long-lived user token do not expire; fetched with a short-lived one, every
  // Page connection dies within hours. The previous flow never made this swap.
  let tokens = args.tokens;
  let exchangeNote: string | null = null;
  if (args.provider === "meta") {
    try {
      const { exchangeForLongLivedToken } = await import("@/lib/oauth.server");
      const longLived = await exchangeForLongLivedToken({ tenantId: args.tenantId, token: tokens.token });
      tokens = { ...tokens, token: longLived.token, expiresAt: longLived.expiresAt };
    } catch {
      exchangeNote = "long_lived_exchange_failed";
    }
  }

  const discovery = await discoverChannels(args.platform, tokens.token);

  const authorizationId = crypto.randomUUID();
  const tokenColumns = await encryptAuthorizationTokens({
    tenantId: args.tenantId,
    authorizationId,
    accessToken: tokens.token,
    refreshToken: tokens.refreshToken,
  });
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin.from("social_authorizations").insert({
    id: authorizationId,
    tenant_id: args.tenantId,
    authorized_by: args.userId,
    provider: args.provider,
    platform: args.platform,
    provider_user_id: discovery.identity.userId,
    provider_email_hint: discovery.identity.emailHint,
    ...tokenColumns,
    requested_scopes: attempt?.requested_scopes ?? [],
    // Meta's token response lists no scopes; discovery read /me/permissions.
    granted_scopes: tokens.scopes.length ? tokens.scopes : (discovery.grantedScopes ?? []),
    expires_at: tokens.expiresAt,
    authorization_state: "active",
    state_reason: exchangeNote,
    discovered_assets: discovery.channels as never,
    discovered_at: now,
    last_validation_success_at: discovery.error ? null : now,
  });
  if (error) throw new Error(`Could not store the authorization: ${error.message}`);

  // Reconnect / upgrade: if the same channel came back, rebind it and stop.
  if (attempt?.target_account_id && (attempt.purpose === "reconnect" || attempt.purpose === "upgrade")) {
    const { data: target } = await supabaseAdmin
      .from("social_accounts")
      .select("id, external_id, platform")
      .eq("id", attempt.target_account_id)
      .eq("tenant_id", args.tenantId)
      .maybeSingle();
    if (
      target?.external_id &&
      discovery.channels.some(
        (c) => c.externalId === target.external_id && c.platform === target.platform && c.eligible,
      )
    ) {
      await connectDiscoveredChannels({
        tenantId: args.tenantId,
        userId: args.userId,
        authorizationId,
        externalIds: [target.external_id],
      });
      return { kind: "reconnected", accountId: target.id, authorizationId };
    }
    // Signed in with an account that does not manage this channel. Fall
    // through to the picker, which says so, rather than rebinding blindly.
  }

  if (discovery.channels.length === 0) {
    return {
      kind: "no_channels",
      authorizationId,
      reason: discovery.error ?? "no_channels_found",
    };
  }
  return { kind: "select", authorizationId };
}

/* ------------------------------------------------------------ selection */

/**
 * Walks a channel to `to` through legal edges only. A fresh authorization is
 * what makes returning from disconnected/revoked legitimate, and the path
 * records that: -> ready_to_authorize -> authorization_started -> to.
 */
async function moveAccountTo(accountId: string, tenantId: string, to: ConnectionState, actorId: string | null) {
  const { transitionConnection } = await import("@/lib/connection-state.server");
  const { data: row } = await supabaseAdmin
    .from("social_accounts")
    .select("connection_state")
    .eq("id", accountId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const from = (row?.connection_state ?? "not_configured") as ConnectionState;
  const path: ConnectionState[] = isLegalTransition(from, to)
    ? [to]
    : isLegalTransition(from, "authorization_started")
      ? ["authorization_started", to]
      : ["ready_to_authorize", "authorization_started", to];
  for (const step of path) {
    await transitionConnection({ accountId, tenantId, to: step, reason: "new_authorization", actorId });
  }
}

/**
 * Creates or rebinds one social_accounts row per chosen channel.
 *
 * The chosen ids are checked against the authorization's own discovery list.
 * The browser sends ids only; names, avatars and eligibility come from what
 * the server discovered, so a tampered request cannot connect a channel the
 * authorization does not reach, or rename one.
 */
export async function connectDiscoveredChannels(args: {
  tenantId: string;
  userId: string | null;
  authorizationId: string;
  externalIds: readonly string[];
}): Promise<{ connected: Array<{ accountId: string; externalId: string; rebound: boolean }> }> {
  if (args.externalIds.length === 0) throw new Error("Choose at least one channel.");

  const { data: auth } = await supabaseAdmin
    .from("social_authorizations")
    .select(
      "id, tenant_id, platform, provider, granted_scopes, requested_scopes, discovered_assets, discovered_at, authorization_state, access_token_enc, refresh_token_enc",
    )
    .eq("id", args.authorizationId)
    .eq("tenant_id", args.tenantId)
    .maybeSingle();
  if (!auth) throw new Error("That authorization was not found in this workspace.");
  if (auth.authorization_state !== "active") throw new Error("That authorization is no longer active. Sign in again.");
  if (!auth.discovered_at || Date.now() - new Date(auth.discovered_at).getTime() > DISCOVERY_TTL_MS) {
    throw new Error("This channel list has expired. Sign in again to refresh it.");
  }

  const discovered = (auth.discovered_assets ?? []) as unknown as DiscoveredChannel[];
  const chosen = args.externalIds.map((id) => {
    const found = discovered.find((c) => c.externalId === id);
    if (!found) throw new Error("A selected channel is not one this sign-in can manage.");
    if (!found.eligible) throw new Error(found.ineligibleReason ?? "That channel cannot be connected.");
    return found;
  });

  // Meta: every Page has its own token. They are fetched fresh here with the
  // stored user token -- discovery never held one -- and each is stored
  // encrypted on its own channel. An Instagram account uses the token of the
  // Page it is linked to.
  const pageTokens = new Map<string, string>();
  if (chosen.some((c) => c.platform === "facebook" || c.platform === "instagram")) {
    const user = await readAuthorizationTokens(auth);
    if (!user.access) throw new Error("This sign-in has no usable token. Sign in again.");
    const { discoverMetaTargets } = await import("@/lib/meta-discovery.server");
    const fresh = await discoverMetaTargets(user.access);
    for (const p of fresh.pages) {
      if (!p.pageAccessToken) continue;
      pageTokens.set(`facebook:${p.id}`, p.pageAccessToken);
      if (p.instagram) pageTokens.set(`instagram:${p.instagram.id}`, p.pageAccessToken);
    }
  }
  const channelTokenColumns = async (ch: DiscoveredChannel) => {
    if (ch.platform !== "facebook" && ch.platform !== "instagram") {
      // The token lives on the authorization. None is left on the channel.
      return {
        access_token: null,
        refresh_token: null,
        access_token_enc: null,
        refresh_token_enc: null,
        token_key_id: null,
      };
    }
    const pageToken = pageTokens.get(`${ch.platform}:${ch.externalId}`);
    if (!pageToken) {
      throw new Error(`Facebook did not return access to ${ch.name}. Sign in again and allow access to it.`);
    }
    return encryptTokensForStorage({
      tenantId: args.tenantId,
      platform: ch.platform,
      accessToken: pageToken,
      refreshToken: null,
    });
  };

  const connected: Array<{ accountId: string; externalId: string; rebound: boolean }> = [];

  for (const ch of chosen) {
    // Each channel is judged by its own platform's registry entry: one Meta
    // sign-in can produce both Facebook and Instagram channels.
    const chDef = connectorDefinition(ch.platform) as ConnectorDefinition;
    const declined = declinedScopes(chDef, auth.granted_scopes, auth.requested_scopes);
    const target: ConnectionState = declined.length > 0 ? "scope_incomplete" : "connected";
    const tokenColumns = await channelTokenColumns(ch);
    const common = {
      label: ch.name,
      account_type: ch.accountType,
      authorization_id: auth.id,
      external_id: ch.externalId,
      profile: {
        name: ch.name,
        username: ch.handle ?? undefined,
        picture: ch.avatarUrl ?? undefined,
        bio: ch.description ?? undefined,
        followers: ch.metrics.audience ?? undefined,
      } as never,
      granted_scopes: auth.granted_scopes,
      missing_scopes: declined,
      active: true,
      health: "connected",
      connect_method: "oauth",
      legacy_manual_connection: false,
      ...tokenColumns,
      last_error: null,
      last_error_at: null,
      retry_count: 0,
      next_retry_at: null,
      last_validation_success_at: new Date().toISOString(),
    };

    // Reconnect never duplicates: the (tenant, platform, external_id) row, if
    // it exists, is rebound to the new authorization with its history intact.
    const { data: existing } = await supabaseAdmin
      .from("social_accounts")
      .select("id")
      .eq("tenant_id", args.tenantId)
      .eq("platform", ch.platform)
      .eq("external_id", ch.externalId)
      .maybeSingle();

    if (existing) {
      const { error } = await supabaseAdmin
        .from("social_accounts")
        .update(common)
        .eq("id", existing.id)
        .eq("tenant_id", args.tenantId);
      if (error) throw new Error(`Could not reconnect ${ch.name}: ${error.message}`);
      await moveAccountTo(existing.id, args.tenantId, target, args.userId);
      connected.push({ accountId: existing.id, externalId: ch.externalId, rebound: true });
    } else {
      const { data, error } = await supabaseAdmin
        .from("social_accounts")
        .insert({
          tenant_id: args.tenantId,
          platform: ch.platform,
          ...common,
          connection_state: target,
          state_reason: "new_authorization",
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`Could not connect ${ch.name}: ${error?.message ?? "unknown"}`);
      connected.push({ accountId: data.id, externalId: ch.externalId, rebound: false });
    }
  }

  await retireSupersededAuthorizations(args.tenantId, auth.id);

  const { logAudit } = await import("@/lib/audit.server");
  await logAudit({
    action: "channel.connected",
    tenantId: args.tenantId,
    actorId: args.userId,
    entityType: "social_authorization",
    entityId: auth.id,
    details: {
      platform: auth.platform,
      channels: connected.length,
      rebound: connected.filter((c) => c.rebound).length,
    },
  });
  return { connected };
}

/**
 * An authorization no channel references any more holds a live token for
 * nothing. After a reconnect rebinds a channel, the old authorization is
 * cleared so no unused credential lingers.
 */
async function retireSupersededAuthorizations(tenantId: string, keepId: string) {
  const { data: auths } = await supabaseAdmin
    .from("social_authorizations")
    .select("id")
    .eq("tenant_id", tenantId)
    .neq("id", keepId)
    .eq("authorization_state", "active")
    .not("discovered_at", "is", null)
    .lt("discovered_at", new Date(Date.now() - DISCOVERY_TTL_MS).toISOString());
  for (const a of auths ?? []) {
    const { count } = await supabaseAdmin
      .from("social_accounts")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("authorization_id", a.id);
    if ((count ?? 0) === 0) {
      await supabaseAdmin
        .from("social_authorizations")
        .update({
          authorization_state: "disconnected",
          state_reason: "superseded",
          access_token_enc: null,
          refresh_token_enc: null,
          token_key_id: null,
        })
        .eq("id", a.id)
        .eq("tenant_id", tenantId);
    }
  }
}

/* --------------------------------------------------------------- refresh */

/**
 * Refreshes one authorization under its lease. Every channel that shares it
 * benefits; two channels cannot race each other into a rotated-away token.
 */
export async function refreshAuthorization(args: {
  authorizationId: string;
  tenantId: string;
}): Promise<
  | { ok: true; token: string; expiresAt: string | null; scopes: string[] }
  | { ok: false; code: "refresh_in_progress" | "no_refresh_token" | "refresh_failed"; reason: string }
> {
  const { data: auth } = await supabaseAdmin
    .from("social_authorizations")
    .select(AUTH_TOKEN_COLUMNS)
    .eq("id", args.authorizationId)
    .eq("tenant_id", args.tenantId)
    .maybeSingle();
  if (!auth) return { ok: false, code: "refresh_failed", reason: "Authorization not found." };

  const { data: leaseId } = await supabaseAdmin.rpc("acquire_authorization_refresh_lease", {
    _authorization_id: auth.id,
    _tenant_id: args.tenantId,
    _lease_seconds: 60,
  });
  if (!leaseId) {
    return { ok: false, code: "refresh_in_progress", reason: "REFRESH_IN_PROGRESS" };
  }
  try {
    const current = await readAuthorizationTokens(auth);
    if (!current.refresh) {
      return { ok: false, code: "no_refresh_token", reason: "The provider issued no refresh token; reconnect once." };
    }
    const { refreshAccessToken } = await import("@/lib/oauth.server");
    const set = await refreshAccessToken({
      provider: auth.provider as never,
      refreshToken: current.refresh,
      currentToken: current.access,
      tenantId: args.tenantId,
    });
    const tokenColumns = await encryptAuthorizationTokens({
      tenantId: args.tenantId,
      authorizationId: auth.id,
      accessToken: set.token,
      refreshToken: set.refreshToken ?? current.refresh,
    });
    const now = new Date().toISOString();
    await supabaseAdmin
      .from("social_authorizations")
      .update({
        ...tokenColumns,
        expires_at: set.expiresAt,
        ...(set.scopes.length ? { granted_scopes: set.scopes } : {}),
        last_refreshed_at: now,
        authorization_state: "active",
        state_reason: null,
        updated_at: now,
      })
      .eq("id", auth.id)
      .eq("tenant_id", args.tenantId);
    return { ok: true, token: set.token, expiresAt: set.expiresAt, scopes: set.scopes };
  } catch (e) {
    const { redactSecrets } = await import("@/lib/integration-errors.server");
    return {
      ok: false,
      code: "refresh_failed",
      reason: redactSecrets(e instanceof Error ? e.message : String(e)) ?? "Refresh failed.",
    };
  } finally {
    await supabaseAdmin.rpc("release_authorization_refresh_lease", {
      _authorization_id: auth.id,
      _tenant_id: args.tenantId,
      _lease_id: leaseId,
    });
  }
}

/* ------------------------------------------------------------ disconnect */

/**
 * Detaches one channel from its authorization. The provider grant is revoked
 * only when no other channel still depends on it -- revoking a Google grant
 * because one of two channels was disconnected would silently break the other.
 */
export async function detachFromAuthorization(args: {
  accountId: string;
  tenantId: string;
  authorizationId: string;
}): Promise<{ lastChannel: boolean; token: string | null; provider: string | null }> {
  const { count } = await supabaseAdmin
    .from("social_accounts")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", args.tenantId)
    .eq("authorization_id", args.authorizationId)
    .eq("active", true)
    .neq("id", args.accountId);
  const lastChannel = (count ?? 0) === 0;
  if (!lastChannel) return { lastChannel, token: null, provider: null };

  const { data: auth } = await supabaseAdmin
    .from("social_authorizations")
    .select(AUTH_TOKEN_COLUMNS)
    .eq("id", args.authorizationId)
    .eq("tenant_id", args.tenantId)
    .maybeSingle();
  let token: string | null = null;
  try {
    token = auth ? (await readAuthorizationTokens(auth)).access : null;
  } catch {
    token = null;
  }
  await supabaseAdmin
    .from("social_authorizations")
    .update({
      authorization_state: "disconnected",
      state_reason: "last_channel_disconnected",
      access_token_enc: null,
      refresh_token_enc: null,
      token_key_id: null,
      refresh_lease_id: null,
      refresh_leased_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", args.authorizationId)
    .eq("tenant_id", args.tenantId);
  return { lastChannel, token, provider: auth?.provider ?? null };
}

export { TOKEN_READ_COLUMNS };
