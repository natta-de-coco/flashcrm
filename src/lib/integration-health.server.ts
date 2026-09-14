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
import { missingScopesFor } from "./connection-state";
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
};

const ACCOUNT_COLUMNS =
  "id, tenant_id, platform, label, active, access_token, refresh_token, token_expires_at, granted_scopes, permissions, last_synced_at, last_analytics_sync_at, last_error, last_error_at, status_reason, retry_count, last_retry_at, next_retry_at, external_id, connect_method";

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
    supabaseAdmin.from("social_accounts").select(ACCOUNT_COLUMNS).eq("tenant_id", tenantId),
    supabaseAdmin
      .from("connection_retry_log")
      .select("id, platform, outcome, reason, trigger, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const byPlatform = new Map<string, AccountRow>();
  for (const row of (accounts ?? []) as AccountRow[]) byPlatform.set(row.platform, row);

  const totals: Record<ConnectionState, number> = {
    connected: 0,
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
            renews: Boolean(row.refresh_token),
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

  // A dry run: it only counts, so opening the report never rewrites anything.
  const sealing = await sealTenantSecrets(tenantId, { dryRun: true });

  return {
    organization: org?.name ?? "Your workspace",
    generated_at: new Date().toISOString(),
    totals,
    connected: totals.connected,
    needs_attention:
      totals.needs_verification + totals.pending_review + totals.expired + totals.failing,
    not_connected: totals.not_connected,
    rows,
    credentials: {
      configured: sealing.configured,
      plaintext: sealing.plaintext,
      sealed: sealing.alreadySealed,
    },
    retries: retries ?? [],
  };
}

export type RetryOutcome = {
  platform: string;
  outcome: "recovered" | "refreshed" | "healthy" | "failed" | "needs_reconnect" | "in_progress";
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
      // Validity is asked of /me, which answers for user and Page tokens
      // alike. /me/permissions is a user-token edge; making it the test meant
      // a connected Facebook Page, which holds a Page token, could fail the
      // check and be marked broken while working. Permissions are read only
      // when that edge answers.
      const who = await fetch("https://graph.facebook.com/v21.0/me?fields=id", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const whoJson: any = await who.json().catch(() => ({}));
      if (!who.ok || whoJson?.error) {
        return {
          ok: false,
          reason: whoJson?.error?.message ?? `Meta rejected the token (HTTP ${who.status}).`,
        };
      }
      const res = await fetch("https://graph.facebook.com/v21.0/me/permissions", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json: any = await res.json().catch(() => ({}));
      const scopes: string[] | undefined =
        res.ok && Array.isArray(json?.data)
          ? json.data
              .filter((p: any) => p.status === "granted")
              .map((p: any) => String(p.permission))
          : undefined;
      return {
        ok: true,
        reason: "Meta confirmed the token is valid.",
        ...(scopes ? { scopes } : {}),
      };
    }
    if (provider === "google") {
      const res = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`,
      );
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
      // /v2/userinfo needs the openid/profile scopes, which Flas never
      // requests, so it answered 403 -- and the retry logic then marked a
      // working connection "revoked". Ask something the granted scopes cover.
      const res = await fetch(
        "https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&count=1",
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "LinkedIn-Version": LINKEDIN_API_VERSION,
            "X-Restli-Protocol-Version": "2.0.0",
          },
        },
      );
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
      const res = await fetch("https://api.x.com/2/users/me", {
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

  // Tokens are stored sealed. Everything below works on plaintext and the
  // write at the end seals again. A failed open stops here WITHOUT writing:
  // with a missing or mistyped key, carrying on would overwrite every stored
  // credential with nothing.
  try {
    row.access_token = await openSecret(row.access_token);
    row.refresh_token = await openSecret(row.refresh_token);
  } catch (error) {
    return {
      platform: row.platform,
      outcome: "failed",
      reason: error instanceof Error ? error.message : "Stored credentials could not be read.",
    };
  }

  const provider = connector(row.platform)?.provider;
  const now = new Date().toISOString();
  let outcome: RetryOutcome["outcome"] = "failed";
  let reason = "";
  let scopes: string[] | undefined;
  let token = row.access_token;
  let refreshToken = row.refresh_token;
  let expiresAt = row.token_expires_at;

  const expired = row.token_expires_at
    ? new Date(row.token_expires_at).getTime() < Date.now() + 60_000
    : false;

  const probe =
    !token || expired
      ? { ok: false, reason: "Stored token is missing or expired." }
      : await probeToken(row.platform, token);

  if (probe.ok) {
    outcome = row.active ? "healthy" : "recovered";
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
        refreshToken: row.refresh_token,
        currentToken: row.access_token,
        tenantId: row.tenant_id,
      });
      token = set.token;
      refreshToken = set.refreshToken ?? row.refresh_token;
      expiresAt = set.expiresAt;
      const verify = await probeToken(row.platform, set.token);
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
      await supabaseAdmin.rpc("release_connection_refresh" as never, { _account_id: row.id }).then(
        () => undefined,
        () => undefined,
      );
    }
  } else {
    outcome = "needs_reconnect";
    reason = probe.reason;
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

  await supabaseAdmin
    .from("social_accounts")
    .update({
      access_token: await sealSecret(token),
      refresh_token: await sealSecret(refreshToken),
      token_expires_at: expiresAt,
      ...(scopes?.length ? { granted_scopes: scopes } : {}),
      // `active` is deliberately NOT cleared on a provider outage. Setting it
      // false during an hour of Meta 5xx would sign every customer out of a
      // connection that is perfectly valid, and they would all reconnect for
      // nothing.
      active: recovered || providerDown,
      health: recovered ? "connected" : "disconnected",
      // Four different failures used to write the single word "disconnected".
      // They need different messages and different owners: a revoked grant is
      // the customer's to fix, a failed refresh is ours to retry, and a
      // provider outage is nobody's to fix here.
      connection_state: recovered
        ? "connected"
        : providerDown
          ? "provider_unavailable"
          : /revok|invalid[_ ]grant|reauthor|\b190\b|\b401\b|\b403\b/i.test(reason)
            ? "revoked"
            : "refresh_failed",
      state_reason: reason.slice(0, 500),
      status_reason: reason,
      last_error: recovered ? null : reason,
      last_error_at: recovered ? null : now,
      retry_count: retryCount,
      last_retry_at: now,
      next_retry_at: recovered ? null : backoffFrom(retryCount),
    })
    .eq("id", row.id);

  await supabaseAdmin.from("connection_retry_log").insert({
    tenant_id: row.tenant_id,
    account_id: row.id,
    platform: row.platform,
    outcome,
    reason: reason.slice(0, 1000),
    trigger: args.trigger,
    details: {
      retry_count: retryCount,
      granted_scopes: scopes ?? grantedScopes(row),
      missing_permissions: missingScopes({ ...row, granted_scopes: scopes ?? row.granted_scopes }),
    } as never,
  });

  return { platform: row.platform, outcome, reason };
}

/** Retries every connection of a workspace that is currently unhealthy or due. */
export async function retryDueConnections(args: {
  tenantId: string;
  trigger: "manual" | "auto";
}): Promise<RetryOutcome[]> {
  const { data } = await supabaseAdmin
    .from("social_accounts")
    .select("id, active, token_expires_at, next_retry_at")
    .eq("tenant_id", args.tenantId);

  const due = (data ?? []).filter((row) => {
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
