// Server-only engine behind the Integration Health Report and the automatic
// retry workflow. The retry pass re-checks the live permissions, refreshes the
// token when the platform allows it, and always writes back the newest reason
// so the customer-facing status is never stale.
import { openSecret, sealSecret, sealTenantSecrets } from "@/lib/secret-box.server";
import { LINKEDIN_API_VERSION } from "@/lib/linkedin";
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

    reason = probe.reason;
    scopes = probe.scopes;
  } else if (provider) {
    // Serialise refreshes per account.
    //
    // Two concurrent health checks both called the provider, and the second
    // response overwrote the first. Where a provider rotates the refresh token
    // on use — Google and X do — the losing token is already invalidated, so
    // the connection breaks precisely because we tried twice to fix it.
    //
    // The lock is a lease on the row (see 20260911100000): it holds after the
    // RPC's own transaction ends, unlike the advisory lock it replaced, which
    // PostgREST released before the refresh began. It is non-blocking -- a
    // caller that loses the race skips the refresh rather than queueing behind
    // it and then making a second redundant call.
    const { data: gotLock } = await supabaseAdmin.rpc("try_lock_connection_refresh", {
      _account_id: row.id,
    });
    if (gotLock === false) {
      // Not "healthy": nothing was validated. Reporting a skipped check as
      // healthy is how a broken connection got a green badge.
      return {
        platform: row.platform,
        outcome: "in_progress",
        reason:
          "A refresh for this connection is already running; this check was skipped rather than refreshing twice.",

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

    } finally {
      // Release early so the next check need not wait out the lease. A
      // failure here is harmless: the lease expires on its own.
      await supabaseAdmin
        .rpc("release_connection_refresh" as never, { _account_id: row.id } as never)
        .then(
          () => undefined,
          () => undefined,
        );

    }
  } else {
    outcome = "needs_reconnect";
  }


  const recovered = outcome === "healthy" || outcome === "recovered" || outcome === "refreshed";

  // A 5xx, a rate limit or a timeout is the provider being unavailable, not
  // the customer's authorization being wrong. Distinguishing them decides both
  // the message shown and whether the token is kept.
  const providerDown =
    !recovered &&
    /\b5\d\d\b|rate limit|too many requests|timed? ?out|ETIMEDOUT|ECONNRESET|temporarily unavailable/i.test(
      reason,
    );

  const retryCount = recovered ? 0 : row.retry_count + 1;

  const { error: writeError } = await supabaseAdmin
    .from("social_accounts")
    .update({

      access_token: await sealSecret(token),
      refresh_token: await sealSecret(refreshToken),

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
