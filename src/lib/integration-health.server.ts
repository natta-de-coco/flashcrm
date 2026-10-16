/// Server-only engine behind the Integration Health Report and the retry workflow.
//
// The report and the Connect accounts screen decide an account's status with the same function
// (connectionStatus in connection-status.ts), fed by the same builder (statusInputFromRow), so the
// two cannot disagree. The retry workflow asks the platform whether a token works; only an
// answer that was received, accepted, and saved is ever called verified.
import { openSecret, sealSecret, sealTenantSecrets } from "@/lib/secret-box.server";
import { LINKEDIN_API_VERSION } from "@/lib/linkedin";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { connector, CONNECTORS } from "./connections-catalog";
import { connectionStatus, nextActionFor, statusInputFromRow } from "./connection-status";
import { featuresForScopes, missingScopesFor, notProvenFor } from "./connection-state";
import type { ConnectionState } from "./connection-status";
import { evidenceFor, plainOrNull, readEvidence, safeText } from "./connection-evidence.server";
import { connectorDefinition } from "./social-connector-definitions";
import { needsAttention } from "./integration-health";
import type { HealthDiagnostics, HealthReport, HealthRow } from "./integration-health";
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
  connection_state: string | null;
  created_at: string;
};

// `permissions` is deliberately not read: it holds the capability keys Flas enabled, never the
// scopes the platform granted. The permissions of an account are granted_scopes and nothing else.
const ACCOUNT_COLUMNS =
  "id, tenant_id, platform, label, active, access_token, refresh_token, token_expires_at, granted_scopes, last_synced_at, last_analytics_sync_at, last_error, last_error_at, status_reason, retry_count, last_retry_at, next_retry_at, external_id, connect_method, connection_state, created_at";

const grantedScopes = (row: AccountRow): string[] => row.granted_scopes ?? [];
const missingScopes = (row: AccountRow): string[] =>
  missingScopesFor(row.platform, grantedScopes(row));

type RetryLogRow = {
  id: string;
  account_id: string | null;
  platform: string;
  outcome: string;
  reason: string | null;
  trigger: string;
  created_at: string;
  details: any;
};

/** What the most recent check of an account says, read from its retry log entry. Staff only. */
function diagnosticsFrom(
  log: RetryLogRow | undefined,
  evidenceReady: boolean,
  attemptedAt: string | null,
  granted: string[],
  missing: string[],
): HealthDiagnostics {
  const details = (log?.details && typeof log.details === "object" ? log.details : {}) as {
    stage?: unknown;
    http_status?: unknown;
    correlation_id?: unknown;
    provider_message?: unknown;
  };
  const reference = typeof details.correlation_id === "string" ? details.correlation_id : null;
  return {
    stage: typeof details.stage === "string" ? details.stage : null,
    http_status: typeof details.http_status === "number" ? details.http_status : null,
    correlation_id: reference ? reference.slice(0, 8) : null,
    last_attempt_at: attemptedAt ?? log?.created_at ?? null,
    evidence_storage: evidenceReady ? "ready" : "missing",
    scopes_granted: granted,
    scopes_missing: missing,
    provider_message:
      typeof details.provider_message === "string" ? safeText(details.provider_message) : null,
  };
}

/**
 * Full report for one workspace. One row per account, plus one for each platform with none.
 *
 * `staff` is true only for Flas staff (a super admin). Everyone else gets plain words: features
 * instead of permission names, no provider answers, no diagnostics block.
 */
export async function buildHealthReport(
  tenantId: string,
  options: { staff?: boolean } = {},
): Promise<HealthReport> {
  const staff = options.staff === true;
  const [{ data: org }, accountsResult, { data: retries }, evidence] = await Promise.all([
    supabaseAdmin.from("organizations").select("name").eq("id", tenantId).maybeSingle(),
    supabaseAdmin.from("social_accounts").select(ACCOUNT_COLUMNS).eq("tenant_id", tenantId),
    supabaseAdmin
      .from("connection_retry_log")
      .select("id, account_id, platform, outcome, reason, trigger, created_at, details")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(60),
    readEvidence(tenantId),
  ]);
  // A report built from a failed read would show every platform as "not connected". Say so instead.
  if (accountsResult.error) {
    throw new Error("Flas could not read this workspace's connections. Try again in a moment.");
  }
  const accounts = ((accountsResult.data ?? []) as unknown as AccountRow[]).sort(
    (a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.id.localeCompare(b.id),
  );
  const log = (retries ?? []) as unknown as RetryLogRow[];

  const byPlatform = new Map<string, AccountRow[]>();
  for (const row of accounts) {
    const list = byPlatform.get(row.platform) ?? [];
    list.push(row);
    byPlatform.set(row.platform, list);
  }

  const totals: Record<ConnectionState, number> = {
    connected: 0,
    unverified: 0,
    needs_verification: 0,
    pending_review: 0,
    expired: 0,
    failing: 0,
    provider_unavailable: 0,
    not_connected: 0,
  };

  const rows: HealthRow[] = [];
  for (const c of CONNECTORS.filter((x) => !x.internalHref)) {
    const owned = byPlatform.get(c.id) ?? [];
    // A platform with no account still gets its own row, so the report lists every connector.
    for (const row of owned.length ? owned : [undefined]) {
      const granted = row?.granted_scopes ?? [];
      const missingScopeNames = row ? missingScopesFor(row.platform, granted) : [];
      const requested = connectorDefinition(c.id)?.requestedScopes ?? [];
      const saved = row ? evidenceFor(evidence, row.id) : undefined;
      const status = connectionStatus(
        row ? statusInputFromRow({ ...row, renews: Boolean(row.refresh_token) }, saved) : undefined,
      );
      totals[status.state] += 1;
      rows.push({
        platform: c.id,
        platform_name: c.name,
        group: c.group,
        account_id: row?.id ?? null,
        account_label: row?.label ?? null,
        state: status.state,
        state_label: status.label,
        // The reason comes from the shared function, never from a sentence stored on the row: a
        // stale stored sentence once contradicted the badge beside it. What the platform last
        // said is shown separately as `last_error`.
        reason: status.reason,
        reason_code: status.code,
        reason_params: status.params,
        fix: status.fix,
        action: row ? status.action : nextActionFor("never_connected", c.id),
        last_error: staff
          ? safeText(row?.last_error) || null
          : plainOrNull(row?.last_error, requested),
        last_error_at: row?.last_error_at ?? null,
        last_synced_at: row?.last_synced_at ?? null,
        last_verified_at: saved?.last_validation_success_at ?? null,
        token_expires_at: row?.token_expires_at ?? null,
        granted_permissions: staff ? granted : [],
        missing_permissions: featuresForScopes(c.id, missingScopeNames),
        not_proven: row ? notProvenFor(row.platform) : [],
        retry_count: row?.retry_count ?? 0,
        next_retry_at: row?.next_retry_at ?? null,
        next_step: status.fix,
        evidence_state: saved?.state ?? (evidence.available ? "ok" : "unavailable"),
        diagnostics:
          staff && row
            ? diagnosticsFrom(
                log.find((entry) => entry.account_id === row.id),
                evidence.available,
                saved?.last_validation_attempt_at ?? null,
                granted,
                missingScopeNames,
              )
            : null,
      });
    }
  }

  // A dry run: it only counts, so opening the report never rewrites anything.
  const sealing = await sealTenantSecrets(tenantId, { dryRun: true });

  return {
    organization: org?.name ?? "Your workspace",
    generated_at: new Date().toISOString(),
    totals,
    connected: totals.connected,
    // Counted from the rows themselves, so this number and the list the dialog shows cannot differ.
    needs_attention: rows.filter((row) => needsAttention(row.state)).length,
    not_connected: totals.not_connected,
    rows,
    credentials: {
      configured: sealing.configured,
      plaintext: sealing.plaintext,
      sealed: sealing.alreadySealed,
    },
    // Old entries were stored before provider text was redacted on the way in; redact on the way
    // out as well.
    retries: log.slice(0, 30).map((entry) => ({
      id: entry.id,
      platform: entry.platform,
      outcome: entry.outcome,
      reason: staff ? safeText(entry.reason, [], 1000) || null : plainOrNull(entry.reason),
      trigger: entry.trigger,
      created_at: entry.created_at,
    })),
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
      await supabaseAdmin
        .rpc("release_connection_refresh" as never, { _account_id: row.id } as never)
        .then(
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
