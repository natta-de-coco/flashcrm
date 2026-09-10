// Server-only engine behind the Integration Health Report and the automatic
// retry workflow. The retry pass re-checks the live permissions, refreshes the
// token when the platform allows it, and always writes back the newest reason
// so the customer-facing status is never stale.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { connector, CONNECTORS } from "./connections-catalog";
import type { AccountPlatform } from "./connections-catalog";
import { connectionStatus } from "./connection-status";
import {
  CONNECTION_STATE_INFO,
  classifyHealthObservation,
  missingScopesFor,
  type ConnectionState as LifecycleState,
} from "./connection-state";
import { redactSecrets } from "./integration-errors.server";
import { encryptTokensForStorage, readStoredTokens } from "./social-token-store.server";
import { readTokensForAccount, refreshAuthorization } from "./social-authorizations.server";
import { declinedScopes } from "./social-channel-capabilities";
import { connectorDefinition } from "./social-connector-definitions";
import type { ConnectionState } from "./connection-status";
import type { HealthReport, HealthRow } from "./integration-health";
import { refreshAccessToken } from "./oauth.server";

/* eslint-disable @typescript-eslint/no-explicit-any */

type AccountRow = {
  id: string;
  tenant_id: string;
  platform: string;
  label: string;
  active: boolean;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  granted_scopes: string[] | null;
  permissions: any;
  last_synced_at: string | null;
  last_analytics_sync_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  status_reason: string | null;
  retry_count: number;
  last_retry_at: string | null;
  next_retry_at: string | null;
  external_id: string | null;
  connect_method: string | null;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_key_id: string | null;
  connection_state: string;
  last_validation_success_at: string | null;
  legacy_manual_connection: boolean;
  /** Batch 2A: set when the token lives on a shared social_authorizations row. */
  authorization_id: string | null;
};

const ACCOUNT_COLUMNS =
  "id, tenant_id, platform, label, active, access_token, refresh_token, access_token_enc, refresh_token_enc, token_key_id, token_expires_at, granted_scopes, permissions, last_synced_at, last_analytics_sync_at, last_error, last_error_at, status_reason, retry_count, last_retry_at, next_retry_at, external_id, connect_method, connection_state, last_validation_success_at, legacy_manual_connection, authorization_id";

/** The report shows status only; it never selects a token column. */
const REPORT_COLUMNS =
  "id, tenant_id, platform, label, active, token_expires_at, granted_scopes, permissions, last_synced_at, last_analytics_sync_at, last_error, last_error_at, status_reason, retry_count, last_retry_at, next_retry_at, external_id, connect_method, connection_state, last_validation_success_at, legacy_manual_connection, authorization_id";

function grantedScopes(row: AccountRow): string[] {
  if (row.granted_scopes?.length) return row.granted_scopes;
  const perms = row.permissions;
  if (Array.isArray(perms?.granted)) return perms.granted.map(String);
  return [];
}

function missingScopes(row: AccountRow): string[] {
  // Derived from the connector registry rather than the old REQUIRED_PERMISSIONS
  // table, which listed scopes Flas never requests and would have reported them
  // as permanently missing.
  return missingScopesFor(row.platform, grantedScopes(row));
}

function nextStepFor(state: ConnectionState, row: AccountRow | undefined): string {
  if (!row) return "Press Connect and complete the guided wizard.";
  if (row.next_retry_at && new Date(row.next_retry_at).getTime() > Date.now()) {
    return `Flas retries automatically on ${new Date(row.next_retry_at).toLocaleString()} (attempt ${
      row.retry_count + 1
    }). No action needed unless it fails again.`;
  }
  switch (state) {
    case "connected":
      return "Nothing required — monitoring continues automatically.";
    case "expired":
      return "Run Retry now: Flas refreshes the token. If the platform issued no refresh token, reconnect once.";
    case "needs_verification":
      return "Reconnect and leave every permission enabled on the consent screen.";
    case "pending_review":
      return "Submit the platform app for review, or add this account as a tester, then press Retry now.";
    case "failing":
      return "Press Retry now. If it still fails, reconnect the account from the wizard.";
    default:
      return "Press Connect to authorize this platform.";
  }
}

/** Full report for one workspace. */
export async function buildHealthReport(tenantId: string): Promise<HealthReport> {
  const [{ data: org }, { data: accounts }, { data: retries }] = await Promise.all([
    supabaseAdmin.from("organizations").select("name").eq("id", tenantId).maybeSingle(),
    supabaseAdmin.from("social_accounts").select(REPORT_COLUMNS).eq("tenant_id", tenantId),
    supabaseAdmin
      .from("connection_retry_log")
      .select("id, platform, outcome, reason, trigger, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const byPlatform = new Map<string, AccountRow>();
  for (const row of (accounts ?? []) as unknown as AccountRow[]) byPlatform.set(row.platform, row);

  const totals: Record<ConnectionState, number> = {
    connected: 0,
    unverified: 0,
    needs_verification: 0,
    pending_review: 0,
    expired: 0,
    failing: 0,
    not_connected: 0,
  };

  const rows: HealthRow[] = CONNECTORS.filter((c) => !c.internalHref).map((c) => {
    const row = byPlatform.get(c.id);
    const status = connectionStatus(
      row
        ? {
            platform: row.platform,
            active: row.active,
            token_expires_at: row.token_expires_at,
            last_synced_at: row.last_synced_at,
            last_analytics_sync_at: row.last_analytics_sync_at,
            permissions: grantedScopes(row),
            external_id: row.external_id,
            connect_method: row.connect_method,
            label: row.label,
            last_validation_success_at: row.last_validation_success_at,
            legacy_manual_connection: row.legacy_manual_connection,
          }
        : undefined,
    );
    totals[status.state] += 1;
    return {
      platform: c.id,
      platform_name: c.name,
      group: c.group,
      account_label: row?.label ?? null,
      state: status.state,
      state_label: status.label,
      reason: row?.status_reason ?? status.reason,
      fix: status.fix,
      last_error: row?.last_error ?? null,
      last_error_at: row?.last_error_at ?? null,
      last_synced_at: row?.last_synced_at ?? null,
      token_expires_at: row?.token_expires_at ?? null,
      granted_permissions: row ? grantedScopes(row) : [],
      missing_permissions: row ? missingScopes(row) : [],
      retry_count: row?.retry_count ?? 0,
      next_retry_at: row?.next_retry_at ?? null,
      next_step: nextStepFor(status.state, row),
    };
  });

  return {
    organization: org?.name ?? "Your workspace",
    generated_at: new Date().toISOString(),
    totals,
    connected: totals.connected,
    needs_attention:
      totals.unverified +
      totals.needs_verification +
      totals.pending_review +
      totals.expired +
      totals.failing,
    not_connected: totals.not_connected,
    rows,
    retries: retries ?? [],
  };
}

export type RetryOutcome = {
  platform: string;
  outcome:
    | "recovered"
    | "refreshed"
    | "healthy"
    | "failed"
    | "needs_reconnect"
    | "refresh_in_progress"
    | "rate_limited"
    | "provider_unavailable";
  reason: string;
};

const BACKOFF_MINUTES = [15, 60, 240, 720, 1440];

function backoffFrom(count: number): string {
  const minutes = BACKOFF_MINUTES[Math.min(count, BACKOFF_MINUTES.length - 1)] ?? 1440;
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

/** Live permission probe — proves the token still works right now. */
async function probeToken(
  platform: string,
  token: string,
): Promise<{ ok: boolean; reason: string; scopes?: string[] }> {
  const provider = connector(platform)?.provider;
  try {
    if (provider === "meta") {
      const res = await fetch("https://graph.facebook.com/v21.0/me/permissions", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json: any = await res.json();
      if (!res.ok || json?.error) {
        return {
          ok: false,
          reason: json?.error?.message ?? `Meta rejected the token (HTTP ${res.status}).`,
        };
      }
      const scopes = (json?.data ?? [])
        .filter((p: any) => p.status === "granted")
        .map((p: any) => String(p.permission));
      return {
        ok: true,
        reason: "Meta confirmed the token and returned live permissions.",
        scopes,
      };
    }
    if (provider === "google") {
      // POST body, not query string: tokeninfo accepts both (verified -- a
      // bad token POSTed returns 400, not 405), and only the query string
      // lands in access logs.
      const res = await fetch("https://oauth2.googleapis.com/tokeninfo", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ access_token: token }),
      });
      const json: any = await res.json();
      if (!res.ok)
        return { ok: false, reason: json?.error_description ?? "Google rejected the token." };
      return {
        ok: true,
        reason: "Google confirmed the token is valid.",
        scopes: String(json?.scope ?? "")
          .split(" ")
          .filter(Boolean),
      };
    }
    if (provider === "linkedin") {
      const res = await fetch("https://api.linkedin.com/v2/userinfo", {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.ok
        ? { ok: true, reason: "LinkedIn confirmed the token is valid." }
        : { ok: false, reason: `LinkedIn rejected the token (HTTP ${res.status}).` };
    }
    if (provider === "tiktok") {
      const res = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id", {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.ok
        ? { ok: true, reason: "TikTok confirmed the token is valid." }
        : { ok: false, reason: `TikTok rejected the token (HTTP ${res.status}).` };
    }
    if (provider === "twitter") {
      const res = await fetch("https://api.twitter.com/2/users/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.ok
        ? { ok: true, reason: "X confirmed the token is valid." }
        : { ok: false, reason: `X rejected the token (HTTP ${res.status}).` };
    }
    if (provider === "pinterest") {
      const res = await fetch("https://api.pinterest.com/v5/user_account", {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.ok
        ? { ok: true, reason: "Pinterest confirmed the token is valid." }
        : { ok: false, reason: `Pinterest rejected the token (HTTP ${res.status}).` };
    }
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "The platform did not respond.",
    };
  }
  return { ok: true, reason: "No live check available for this platform — status left unchanged." };
}

/**
 * Re-checks one connection: probe → refresh on failure → probe again, then
 * persist the newest state, reason and next retry time.
 */
export async function retryConnection(args: {
  accountId: string;
  tenantId: string;
  trigger: "manual" | "auto";
  actorId?: string | null;
}): Promise<RetryOutcome> {
  const { data } = await supabaseAdmin
    .from("social_accounts")
    .select(ACCOUNT_COLUMNS)
    .eq("id", args.accountId)
    .eq("tenant_id", args.tenantId)
    .maybeSingle();
  const row = data as AccountRow | null;
  if (!row) return { platform: "unknown", outcome: "failed", reason: "Connection not found." };

  const from = row.connection_state as LifecycleState;
  // Phase 38: revoked, disconnected and mid-authorization connections are never
  // refreshed automatically. Only a new authorization brings them back, so a
  // provider call here could only loop.
  if (NO_AUTOMATIC_RETRY.includes(from)) {
    return {
      platform: row.platform,
      outcome: "needs_reconnect",
      reason: CONNECTION_STATE_INFO[from].nextAction ?? "Reconnect the account.",
    };
  }

  const provider = connector(row.platform)?.provider;
  const now = new Date().toISOString();

  let stored: { access: string | null; refresh: string | null; source: string };
  try {
    stored = row.authorization_id ? await readTokensForAccount(row) : await readStoredTokens(row);
  } catch {
    stored = { access: null, refresh: null, source: "undecryptable" };
  }

  const expired = row.token_expires_at
    ? new Date(row.token_expires_at).getTime() < Date.now() + 60_000
    : false;
  const probe =
    !stored.access || expired
      ? { ok: false, reason: "Stored token is missing or expired." }
      : await probeToken(row.platform, stored.access);

  let outcome: RetryOutcome["outcome"] = "failed";
  let reason = probe.reason;
  let scopes: string[] | undefined = probe.ok ? probe.scopes : undefined;
  let validated = probe.ok;
  let expiresAt = row.token_expires_at;
  // Token columns are written only when a token actually changes -- and then
  // always encrypted. The previous version rewrote the plaintext columns on
  // every single check.
  let tokenPatch: Record<string, unknown> = {};
  let refreshPatch: Record<string, unknown> = {};

  if (probe.ok) {
    outcome = row.active ? "healthy" : "recovered";
    // A working legacy-plaintext token is encrypted the moment it is seen.
    if (stored.source === "legacy_plaintext") {
      tokenPatch = await encryptTokensForStorage({
        tenantId: row.tenant_id,
        platform: row.platform,
        accessToken: stored.access,
        refreshToken: stored.refresh,
      });
    }
  } else if (provider && row.authorization_id) {
    // Batch 2A: the token belongs to the authorization, shared by every
    // channel on it, so it is refreshed there under the authorization's own
    // lease -- two channels of one Google login cannot race each other.
    const r = await refreshAuthorization({
      authorizationId: row.authorization_id,
      tenantId: row.tenant_id,
    });
    if (!r.ok && r.code === "refresh_in_progress") {
      return {
        platform: row.platform,
        outcome: "refresh_in_progress",
        reason: "REFRESH_IN_PROGRESS: another check is already refreshing this connection.",
      };
    }
    if (r.ok) {
      expiresAt = r.expiresAt;
      refreshPatch = {
        last_refresh_success_at: new Date().toISOString(),
        refresh_failure_reason: null,
      };
      const verify = await probeToken(row.platform, r.token);
      validated = verify.ok;
      if (verify.ok) {
        outcome = "refreshed";
        reason = `Token refreshed automatically. ${verify.reason}`;
        scopes = verify.scopes ?? (r.scopes.length ? r.scopes : undefined);
      } else {
        outcome = "needs_reconnect";
        reason = `Refresh succeeded but the platform still refused access: ${verify.reason}`;
      }
    } else {
      outcome = "needs_reconnect";
      reason = `${probe.reason} Automatic refresh failed: ${r.reason}`;
      refreshPatch = {
        refresh_failure_reason: (redactSecrets(reason) ?? "refresh failed").slice(0, 500),
      };
    }
  } else if (provider) {
    // Phase 16: a row lease, not an in-memory or transaction-scoped lock. It
    // outlives this RPC, so it actually covers the provider call, and it
    // expires by itself if this worker dies.
    const { data: leaseId } = await supabaseAdmin.rpc("acquire_connection_refresh_lease", {
      _account_id: row.id,
      _tenant_id: row.tenant_id,
      _lease_seconds: 60,
    });
    if (!leaseId) {
      return {
        platform: row.platform,
        outcome: "refresh_in_progress",
        reason: "REFRESH_IN_PROGRESS: another check is already refreshing this connection.",
      };
    }
    try {
      const set = await refreshAccessToken({
        provider,
        refreshToken: stored.refresh,
        currentToken: stored.access,
        tenantId: row.tenant_id,
      });
      tokenPatch = await encryptTokensForStorage({
        tenantId: row.tenant_id,
        platform: row.platform,
        accessToken: set.token,
        // Kept when the provider does not rotate it.
        refreshToken: set.refreshToken ?? stored.refresh,
      });
      expiresAt = set.expiresAt;
      refreshPatch = {
        last_refresh_success_at: new Date().toISOString(),
        refresh_failure_reason: null,
      };
      const verify = await probeToken(row.platform, set.token);
      validated = verify.ok;
      if (verify.ok) {
        outcome = "refreshed";
        reason = `Token refreshed automatically. ${verify.reason}`;
        scopes = verify.scopes ?? (set.scopes.length ? set.scopes : undefined);
      } else {
        outcome = "needs_reconnect";
        reason = `Refresh succeeded but the platform still refused access: ${verify.reason}`;
      }
    } catch (error) {
      outcome = "needs_reconnect";
      reason = `${probe.reason} Automatic refresh failed: ${
        error instanceof Error ? error.message : "unknown error"
      }`;
      refreshPatch = {
        refresh_failure_reason: (redactSecrets(reason) ?? "refresh failed").slice(0, 500),
      };
    } finally {
      await supabaseAdmin.rpc("release_connection_refresh_lease", {
        _account_id: row.id,
        _tenant_id: row.tenant_id,
        _lease_id: leaseId,
      });
    }
  } else {
    outcome = "needs_reconnect";
  }

  // Everything below is stored, shown on screen or logged: redact first.
  const safeReason = redactSecrets(reason) ?? "Connection check failed.";
  // Batch 2A: a channel on an authorization is judged against what that
  // authorization ASKED for. A YouTube channel connected with basic access has
  // not "lost" the comments permission it never requested -- that is an
  // upgrade, not a fault.
  let missing: string[];
  if (row.authorization_id) {
    const { data: auth } = await supabaseAdmin
      .from("social_authorizations")
      .select("requested_scopes, granted_scopes")
      .eq("id", row.authorization_id)
      .eq("tenant_id", row.tenant_id)
      .maybeSingle();
    const def = connectorDefinition(row.platform);
    missing = def
      ? declinedScopes(def, scopes ?? auth?.granted_scopes ?? [], auth?.requested_scopes ?? [])
      : [];
  } else {
    missing = scopes ? missingScopesFor(row.platform, scopes) : missingScopes(row);
  }
  const observed = classifyHealthObservation({
    from,
    validated,
    missingScopes: validated ? missing.length : 0,
    reason: safeReason,
  });
  if (observed.code === "rate_limited") outcome = "rate_limited";
  if (observed.code === "provider_unavailable") outcome = "provider_unavailable";
  const recovered = observed.code === "healthy" || observed.code === "scope_incomplete";
  const retryLater = ["rate_limited", "provider_unavailable", "refresh_failed"].includes(
    observed.code,
  );
  const retryCount = recovered ? 0 : row.retry_count + 1;

  const { error: writeError } = await supabaseAdmin
    .from("social_accounts")
    .update({
      ...tokenPatch,
      ...refreshPatch,
      token_expires_at: expiresAt,
      ...(scopes?.length ? { granted_scopes: scopes } : {}),
      missing_scopes: missing,
      last_validation_attempt_at: now,
      ...(validated ? { last_validation_success_at: now } : {}),
      active: observed.active,
      health: recovered || observed.code === "rate_limited" ? "connected" : "disconnected",
      connection_state: observed.state,
      state_reason: `${observed.code}: ${safeReason}`.slice(0, 500),
      status_reason: safeReason,
      last_error: recovered ? null : safeReason,
      last_error_at: recovered ? null : now,
      retry_count: retryCount,
      last_retry_at: now,
      // Revoked gets no retry: that is the refresh loop Phase 38 forbids.
      next_retry_at: retryLater ? backoffFrom(retryCount) : null,
    })
    .eq("id", row.id)
    .eq("tenant_id", row.tenant_id);
  if (writeError) {
    console.error(
      "[integration-health] could not record the check:",
      redactSecrets(writeError.message),
    );
  }

  await supabaseAdmin.from("connection_retry_log").insert({
    tenant_id: row.tenant_id,
    account_id: row.id,
    platform: row.platform,
    outcome,
    reason: safeReason.slice(0, 1000),
    trigger: args.trigger,
    details: {
      code: observed.code,
      retry_count: retryCount,
      granted_scopes: scopes ?? grantedScopes(row),
      missing_permissions: missing,
    } as never,
  });

  return { platform: row.platform, outcome, reason: safeReason };
}

/** States a health check never touches: only a new authorization moves them. */
const NO_AUTOMATIC_RETRY: readonly LifecycleState[] = [
  "revoked",
  "disconnected",
  "authorization_started",
  "authorization_cancelled",
  "callback_error",
];

/** Retries every connection of a workspace that is currently unhealthy or due. */
export async function retryDueConnections(args: {
  tenantId: string;
  trigger: "manual" | "auto";
}): Promise<RetryOutcome[]> {
  const { data } = await supabaseAdmin
    .from("social_accounts")
    .select("id, active, token_expires_at, next_retry_at, connection_state")
    .eq("tenant_id", args.tenantId);

  const due = (data ?? []).filter((row) => {
    // Never retried automatically: only a new authorization brings these back.
    if (NO_AUTOMATIC_RETRY.includes(row.connection_state as LifecycleState)) return false;
    const expiringSoon = row.token_expires_at
      ? new Date(row.token_expires_at).getTime() - Date.now() < 1000 * 60 * 60 * 24 * 3
      : false;
    const dueNow = !row.next_retry_at || new Date(row.next_retry_at).getTime() <= Date.now();
    return (!row.active || expiringSoon) && dueNow;
  });

  const results: RetryOutcome[] = [];
  for (const row of due) {
    results.push(
      await retryConnection({ accountId: row.id, tenantId: args.tenantId, trigger: args.trigger }),
    );
  }
  return results;
}
