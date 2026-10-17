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
import {
  CONNECTION_STATES,
  classifyHealthObservation,
  featuresForScopes,
  hasLiveCheck,
  missingScopesFor,
  notProvenFor,
  scopesUnknown,
} from "./connection-state";
import type { ConnectionState as DurableState } from "./connection-state";
import type { ConnectionState, StatusEvidence } from "./connection-status";
import {
  evidenceFor,
  newCheckId,
  plainOrNull,
  readCredentials,
  readEvidence,
  safeText,
  writeCheck,
} from "./connection-evidence.server";
import type { CheckStart } from "./connection-evidence.server";
import { readChannelTokens } from "./connection-tokens.server";
import type { ChannelTokens } from "./connection-tokens.server";
import { normalizeProviderError } from "./integration-errors.server";
import { connectorDefinition } from "./social-connector-definitions";
import { describeOutcome, needsAttention } from "./integration-health";
import type {
  HealthDiagnostics,
  HealthReport,
  HealthRow,
  RetryOutcomeCode,
  RetryResult,
} from "./integration-health";
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
  storage: HealthDiagnostics["evidence_storage"],
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
    evidence_storage: storage,
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
  // Connectors with their own screen are not listed: another module holds their data, so a row
  // here would say "not connected" about something this report never looked at (WhatsApp's
  // numbers have their health on Alerts & health, and the dialog says so).
  for (const c of CONNECTORS.filter((x) => !x.internalHref && !x.healthHref)) {
    const owned = byPlatform.get(c.id) ?? [];
    // A platform with no account still gets its own row, so the report lists every connector.
    for (const row of owned.length ? owned : [undefined]) {
      const granted = row?.granted_scopes ?? [];
      const missingScopeNames = row ? missingScopesFor(row.platform, granted) : [];
      const requested = connectorDefinition(c.id)?.requestedScopes ?? [];
      const saved = row ? evidenceFor(evidence, row.id) : undefined;
      const status = connectionStatus(
        row
          ? statusInputFromRow(
              { ...row, renews: Boolean(row.refresh_token), has_token: Boolean(row.access_token) },
              saved,
            )
          : undefined,
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
        evidence_state: evidenceFor(evidence, row?.id ?? "").state,
        diagnostics:
          staff && row
            ? diagnosticsFrom(
                log.find((entry) => entry.account_id === row.id),
                saved?.state === "ok"
                  ? "ready"
                  : saved?.state === "unreadable"
                    ? "unreadable"
                    : "missing",
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
      reason: staff
        ? safeText(entry.reason, [], 1000) || null
        : plainOrNull(entry.reason, connectorDefinition(entry.platform)?.requestedScopes ?? []),
      trigger: entry.trigger,
      created_at: entry.created_at,
    })),
  };
}

export type RetryOutcome = RetryResult;

const BACKOFF_MINUTES = [15, 60, 240, 720, 1440];
/** Every request to a platform is cut off after this long; none can hang a check. */
const PROBE_TIMEOUT_MS = 8_000;
/** A second manual press inside this window shows the saved result instead of asking again. */
const RECENT_MS = 30_000;
/** How many accounts one bulk run checks. */
const BULK_CAP = 25;
const GRAPH = "https://graph.facebook.com/v21.0";

function backoffFrom(count: number): string {
  const minutes = BACKOFF_MINUTES[Math.min(count, BACKOFF_MINUTES.length - 1)] ?? 1440;
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

/* ------------------------------------------------------------------ */
/* Probes: one live question per connector, asked of the platform      */
/* ------------------------------------------------------------------ */

type ProbeResult =
  | { kind: "ok"; status: number; scopes?: string[] }
  | {
      kind: "refused";
      status: number;
      /** The platform said the token itself is not valid (not merely "not allowed"). */
      unauthorized: boolean;
      /** The platform's own error code, for Meta only. */
      code: string | null;
      message: string | null;
      retryAfter: number | null;
      /** True when no request was made: our own record says the token has lapsed. */
      local?: true;
    }
  | { kind: "mismatch"; status: number }
  | { kind: "unreachable"; message: string };

type Hit = { res: Response; body: any };

/** One request with a hard timeout. The body is read inside the timeout too. */
async function hit(url: string, init: RequestInit = {}): Promise<Hit> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const body: any = await res.json().catch(() => ({}));
    return { res, body };
  } finally {
    clearTimeout(timer);
  }
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, Math.round((at - Date.now()) / 1000)) : null;
}

function refusal(platform: string, { res, body }: Hit, tokeninfo = false): ProbeResult {
  const meta = connector(platform)?.provider === "meta";
  const said = normalizeProviderError({ platform, httpStatus: res.status, body });
  const code = meta ? said.providerCode : null;
  return {
    kind: "refused",
    status: res.ok ? 400 : res.status,
    // Google's tokeninfo answers an invalid or expired token with 400, not 401.
    unauthorized: res.status === 401 || code === "190" || (tokeninfo && res.status === 400),
    code,
    message: said.providerMessage,
    retryAfter: parseRetryAfter(res.headers.get("retry-after")),
  };
}

const bearer = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

type ProbeContext = { platform: string; token: string; externalId: string | null };

/** Meta lists the permissions of a user token here; a Page token may not answer. */
async function metaPermissions(token: string): Promise<string[] | undefined> {
  try {
    const h = await hit(`${GRAPH}/me/permissions`, { headers: bearer(token) });
    if (!h.res.ok || !Array.isArray(h.body?.data)) return undefined;
    const granted: string[] = h.body.data
      .filter((p: any) => p?.status === "granted")
      .map((p: any) => String(p.permission));
    return granted.length ? granted : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Facebook and Instagram: ask for the very account that is saved. The same id has to come back,
 * which proves the token reaches that Page or Instagram account -- not merely that it is a valid
 * Meta token. (Sync asks Instagram for this same node with this same token; /me on a Page token
 * answers with the Page, not the Instagram account.)
 */
async function probeMetaNode({ platform, token, externalId }: ProbeContext): Promise<ProbeResult> {
  if (!externalId) return { kind: "mismatch", status: 0 };
  const h = await hit(`${GRAPH}/${encodeURIComponent(externalId)}?fields=id`, {
    headers: bearer(token),
  });
  if (!h.res.ok || h.body?.error) return refusal(platform, h);
  if (String(h.body?.id ?? "") !== externalId) return { kind: "mismatch", status: h.res.status };
  const scopes = await metaPermissions(token);
  return { kind: "ok", status: h.res.status, ...(scopes ? { scopes } : {}) };
}

/** Meta Ads: the login itself (an ad account is not a node the token is "for"). */
async function probeMetaLogin({ platform, token }: ProbeContext): Promise<ProbeResult> {
  const h = await hit(`${GRAPH}/me?fields=id`, { headers: bearer(token) });
  if (!h.res.ok || h.body?.error) return refusal(platform, h);
  const scopes = await metaPermissions(token);
  return { kind: "ok", status: h.res.status, ...(scopes ? { scopes } : {}) };
}

/** Google: the token goes in the request body, never in the address. */
async function probeGoogle({ platform, token }: ProbeContext): Promise<ProbeResult> {
  const h = await hit("https://oauth2.googleapis.com/tokeninfo", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ access_token: token }).toString(),
  });
  if (!h.res.ok) return refusal(platform, h, true);
  const scopes = String(h.body?.scope ?? "")
    .split(" ")
    .filter(Boolean);
  return { kind: "ok", status: h.res.status, ...(scopes.length ? { scopes } : {}) };
}

const simpleProbe =
  (url: string, extra: Record<string, string> = {}) =>
  async ({ platform, token }: ProbeContext): Promise<ProbeResult> => {
    const h = await hit(url, { headers: { ...bearer(token), ...extra } });
    return h.res.ok ? { kind: "ok", status: h.res.status } : refusal(platform, h);
  };

/**
 * One probe per connector, keyed by connector id and not by provider. A connector with no entry
 * here has no live check: it is never called verified (Threads, LinkedIn Ads, TikTok Ads and the
 * keyed connectors). LIVE_CHECK_PLATFORMS in connection-state.ts is the same list for screens, and
 * a test keeps the two equal.
 */
const PROBES: Record<string, (ctx: ProbeContext) => Promise<ProbeResult>> = {
  facebook: probeMetaNode,
  instagram: probeMetaNode,
  meta_ads: probeMetaLogin,
  youtube: probeGoogle,
  google_business: probeGoogle,
  google_ads: probeGoogle,
  google_analytics: probeGoogle,
  search_console: probeGoogle,
  // /v2/userinfo needs scopes Flas never requests and answered 403 for a working token, so the
  // check asks what the granted scopes cover.
  linkedin: simpleProbe(
    "https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&count=1",
    { "LinkedIn-Version": LINKEDIN_API_VERSION, "X-Restli-Protocol-Version": "2.0.0" },
  ),
  tiktok: simpleProbe("https://open.tiktokapis.com/v2/user/info/?fields=open_id"),
  twitter: simpleProbe("https://api.x.com/2/users/me"),
  pinterest: simpleProbe("https://api.pinterest.com/v5/user_account"),
};

/** The connector ids that have a live check. */
export const PROBE_PLATFORMS: readonly string[] = Object.keys(PROBES);

async function runProbe(
  platform: string,
  token: string,
  externalId: string | null,
): Promise<ProbeResult> {
  const probe = PROBES[platform];
  if (!probe) return { kind: "unreachable", message: "No live check exists for this platform." };
  try {
    return await probe({ platform, token, externalId });
  } catch (thrown) {
    return {
      kind: "unreachable",
      message: safeText(thrown instanceof Error ? thrown.message : "No answer.", [token]),
    };
  }
}

/* ------------------------------------------------------------------ */
/* One check                                                           */
/* ------------------------------------------------------------------ */

/** The stored state, or "not_configured" (the column default) when it is missing or unknown. */
function asConnectionState(value: string | null): DurableState {
  return (CONNECTION_STATES as readonly string[]).includes(value ?? "")
    ? (value as DurableState)
    : "not_configured";
}

/** The status an account has, in the shape a check returns. */
function statusOf(
  row: AccountRow,
  over: Partial<AccountRow>,
  evidence: StatusEvidence,
  renews: boolean,
): NonNullable<RetryResult["status"]> {
  const status = connectionStatus(statusInputFromRow({ ...row, ...over, renews }, evidence));
  return {
    state: status.state,
    label: status.label,
    code: status.code,
    params: status.params,
    reason: status.reason,
    fix: status.fix,
    action: status.action,
  };
}

/** Frees the refresh lease. A failure is harmless: the lease expires by itself. */
async function releaseLease(accountId: string) {
  await supabaseAdmin
    .rpc("release_connection_refresh" as never, { _account_id: accountId } as never)
    .then(
      () => undefined,
      () => undefined,
    );
}

/**
 * Checks one connection against its platform and saves what was found.
 *
 * The order matters, and every step can end the check without writing anything:
 *   gate        a deliberate disconnect, a pasted token, an unidentified account, a connector with
 *               no live check, or a check made a moment ago: no request, no write
 *   credentials stored tokens that cannot be read stop here without writing
 *   probe       one read-only question, cut off after eight seconds
 *   refresh     only when the platform said the token is not valid, and only under the refresh
 *               lease, which is held until the result is written (never for a 403, a rate limit,
 *               an outage or no answer: refreshing for those burns a rotating refresh token)
 *   save        ONE checked write: an error, a row count other than one, or tokens that changed
 *               underneath is a failure, never "saved"
 * "Verified" is written only when the platform accepted the token, the account is identified,
 * its permissions are known and complete, and the checked write above succeeded and could store
 * the evidence.
 */
export async function retryConnection(args: {
  accountId: string;
  tenantId: string;
  trigger: "manual" | "auto";
  actorId?: string | null;
}): Promise<RetryOutcome> {
  const check = newCheckId();
  const lease = { held: false };
  try {
    return await runCheck(args, check, lease);
  } catch (thrown) {
    // Anything unexpected ends the check as a failure: nothing was marked verified.
    console.error(
      `[integration-health] ${check.reference} unexpected: ${safeText(thrown instanceof Error ? thrown.message : thrown)}`,
    );
    return {
      platform: "unknown",
      account_id: args.accountId,
      outcome: "failed",
      reason: describeOutcome("failed", { platform: "", reference: check.reference }),
      stage: "unexpected",
      correlation_id: check.reference,
    };
  } finally {
    if (lease.held) await releaseLease(args.accountId);
  }
}

async function runCheck(
  args: Parameters<typeof retryConnection>[0],
  check: { id: string; reference: string },
  lease: { held: boolean },
): Promise<RetryOutcome> {
  const noAccount = (outcome: "failed" | "not_found", stage: string): RetryOutcome => ({
    platform: "unknown",
    account_id: args.accountId,
    outcome,
    reason: describeOutcome(outcome, { platform: "", reference: check.reference }),
    stage,
    correlation_id: check.reference,
  });

  // What the account stores as credentials, fingerprinted, BEFORE anything is read from it: every
  // credential the check then uses is at least as new as this, so a reconnect that lands in between
  // can only make the final write refuse, never apply an answer about the old token to the new one.
  const started = await readCredentials(args.tenantId, args.accountId);
  if (started.kind === "error") {
    console.error(`[integration-health] ${check.reference} load failed`);
    return noAccount("failed", "load");
  }
  if (started.kind === "gone") return noAccount("not_found", "load");

  const { data, error } = await supabaseAdmin
    .from("social_accounts")
    .select(ACCOUNT_COLUMNS)
    .eq("id", args.accountId)
    .eq("tenant_id", args.tenantId)
    .maybeSingle();
  if (error) {
    console.error(`[integration-health] ${check.reference} load failed`);
    return noAccount("failed", "load");
  }
  if (!data) return noAccount("not_found", "load");
  const row = data as unknown as AccountRow;
  const name = connector(row.platform)?.name ?? row.platform;
  const from = asConnectionState(row.connection_state);

  const evidence = await readEvidence(row.tenant_id, row.id);
  const stored = evidenceFor(evidence, row.id);

  // Where is this account's token? An account connected the old way keeps it, sealed, in
  // access_token. One connected through the channel picker keeps it encrypted on the account itself
  // or on its sign-in and leaves access_token empty -- which is not "disconnected on purpose". Look
  // where sync looks before saying so. (A deliberate disconnect says so in its state, and needs no look.)
  let channel: Extract<ChannelTokens, { kind: "found" }> | null = null;
  if (!row.access_token && from !== "disconnected") {
    const found = await readChannelTokens(row);
    if (found.kind === "error") {
      console.error(
        `[integration-health] ${check.reference} ${row.platform} ${found.stage} failed`,
      );
      return {
        platform: row.platform,
        account_id: row.id,
        outcome: "failed",
        reason: describeOutcome("failed", { platform: name, reference: check.reference }),
        stage: found.stage,
        status: statusOf(row, {}, stored, false),
        correlation_id: check.reference,
      };
    }
    if (found.kind === "found") channel = found;
  }
  const renewsAsStored = Boolean(row.refresh_token) || Boolean(channel?.refresh);

  // Gate: reasons not to ask the platform at all. No request, no write.
  const gate = (outcome: RetryOutcomeCode): RetryOutcome => ({
    platform: row.platform,
    account_id: row.id,
    outcome,
    reason: describeOutcome(outcome, { platform: name, reference: check.reference }),
    stage: "gate",
    status: statusOf(row, {}, stored, renewsAsStored),
    saved_at: stored.last_validation_attempt_at,
    correlation_id: check.reference,
  });
  if (from === "disconnected" || (!row.access_token && !channel)) {
    return gate("skipped_disconnected");
  }
  if (row.connect_method === "manual") return gate("reconnect_needed");
  // A revoked account can only come back through a new sign-in, so asking the platform again would
  // change nothing. (The database as it is today would still accept revoked -> connected; this gate,
  // and the match on the account's state at the final write, are what stop a check from doing it.)
  if (from === "revoked") return gate("needs_reconnect");
  if (!row.external_id) return gate("not_identified");
  if (!hasLiveCheck(row.platform)) return gate("not_checkable");
  if (args.trigger === "manual" && stored.last_validation_attempt_at) {
    const age = Date.now() - Date.parse(stored.last_validation_attempt_at);
    if (age >= 0 && age < RECENT_MS) return gate("recently_checked");
  }

  // Credentials. Tokens are stored sealed; a failed open stops here WITHOUT writing: with a missing
  // or mistyped key, carrying on would overwrite every stored credential with nothing.
  let token: string | null;
  let refreshToken: string | null;
  try {
    token = channel ? channel.access : await openSecret(row.access_token);
    refreshToken = channel ? channel.refresh : await openSecret(row.refresh_token);
  } catch (thrown) {
    console.error(
      `[integration-health] ${check.reference} ${row.platform} credentials: ${safeText(thrown instanceof Error ? thrown.message : thrown)}`,
    );
    return {
      platform: row.platform,
      account_id: row.id,
      outcome: "failed",
      reason: describeOutcome("failed", { platform: name, reference: check.reference }),
      stage: "credentials",
      status: statusOf(row, {}, stored, renewsAsStored),
      correlation_id: check.reference,
    };
  }
  if (!token) return gate("skipped_disconnected");

  const provider = connector(row.platform)?.provider;
  const now = new Date().toISOString();
  let expiresAt = row.token_expires_at;
  // The account as this check found it. The one write at the end lands only on an account that
  // still looks exactly like this: a person who disconnects, revokes or reconnects it while the
  // platform is being asked is never overwritten by an answer about the account as it used to be.
  const unchangedSince: CheckStart = {
    active: row.active,
    connection_state: row.connection_state,
    credentials: started.fingerprint,
  };
  let refreshed = false;
  let refreshError: string | null = null;
  let refreshedScopes: string[] | undefined;
  let stage = "probe";

  // Probe. A token our own record says has lapsed is not sent anywhere: it is known to be refused.
  const expiresMs = row.token_expires_at ? Date.parse(row.token_expires_at) : Number.NaN;
  let probe: ProbeResult =
    Number.isFinite(expiresMs) && expiresMs < Date.now() + 60_000
      ? {
          kind: "refused",
          status: 401,
          unauthorized: true,
          code: null,
          message: null,
          retryAfter: null,
          local: true,
        }
      : await runProbe(row.platform, token, row.external_id);

  // Refresh: only when the platform said the token is not valid.
  //
  // A token that belongs to the account's sign-in is renewed through that sign-in, which has its own
  // lease and stores the new tokens itself; this check then writes none. A channel's own token (a
  // Facebook Page's) has nothing to renew it with, so a refusal of it is final.
  if (
    channel &&
    channel.source === "authorization" &&
    channel.authorizationId &&
    probe.kind === "refused" &&
    probe.unauthorized &&
    provider
  ) {
    stage = "refresh";
    const { refreshAuthorization } = await import("@/lib/social-authorizations.server");
    const renewed = await refreshAuthorization({
      authorizationId: channel.authorizationId,
      tenantId: row.tenant_id,
    });
    if (renewed.ok) {
      token = renewed.token;
      expiresAt = renewed.expiresAt;
      refreshedScopes = renewed.scopes.length ? renewed.scopes : undefined;
      refreshed = true;
      probe = await runProbe(row.platform, token, row.external_id);
    } else if (renewed.code === "refresh_in_progress") {
      return {
        platform: row.platform,
        account_id: row.id,
        outcome: "in_progress",
        reason: describeOutcome("in_progress", { platform: name }),
        stage,
        status: statusOf(row, {}, stored, renewsAsStored),
        correlation_id: check.reference,
      };
    } else {
      refreshError = safeText(renewed.reason, [token, refreshToken]);
    }
  } else if (
    !channel &&
    probe.kind === "refused" &&
    probe.unauthorized &&
    provider &&
    (refreshToken || provider === "meta")
  ) {
    stage = "refresh";
    // Serialise refreshes per account. Two concurrent checks both refreshing is how a provider that
    // rotates its refresh token (Google, X) ends up with the loser's token already invalidated. The
    // lease is non-blocking: a caller that loses the race stops rather than refreshing twice. An
    // RPC that errors counts as "not acquired" -- never as permission to go ahead.
    const lock = await supabaseAdmin.rpc("try_lock_connection_refresh", { _account_id: row.id });
    if (lock.error || lock.data !== true) {
      return {
        platform: row.platform,
        account_id: row.id,
        outcome: "in_progress",
        reason: describeOutcome("in_progress", { platform: name }),
        stage,
        status: statusOf(row, {}, stored, renewsAsStored),
        correlation_id: check.reference,
      };
    }
    lease.held = true;

    // Under the lease: has somebody already renewed this token while we waited? Then use theirs.
    const cur = await readCredentials(row.tenant_id, row.id);
    if (cur.kind !== "ok") {
      console.error(`[integration-health] ${check.reference} ${row.platform} lease read failed`);
      return {
        platform: row.platform,
        account_id: row.id,
        outcome: "failed",
        reason: describeOutcome("failed", { platform: name, reference: check.reference }),
        stage,
        status: statusOf(row, {}, stored, renewsAsStored),
        correlation_id: check.reference,
      };
    }
    if (cur.access_token !== row.access_token || cur.refresh_token !== row.refresh_token) {
      try {
        token = await openSecret(cur.access_token);
        refreshToken = await openSecret(cur.refresh_token);
      } catch {
        return {
          platform: row.platform,
          account_id: row.id,
          outcome: "failed",
          reason: describeOutcome("failed", { platform: name, reference: check.reference }),
          stage: "credentials",
          status: statusOf(row, {}, stored, renewsAsStored),
          correlation_id: check.reference,
        };
      }
      expiresAt = cur.token_expires_at;
      // The answer is about somebody else's renewed token, so that is the token to match.
      unchangedSince.credentials = cur.fingerprint;
      probe = token
        ? await runProbe(row.platform, token, row.external_id)
        : ({ kind: "unreachable", message: "No token." } as const);
    } else {
      try {
        const set = await refreshAccessToken({
          provider,
          refreshToken,
          currentToken: token,
          tenantId: row.tenant_id,
        });
        token = set.token;
        refreshToken = set.refreshToken ?? refreshToken;
        expiresAt = set.expiresAt;
        refreshedScopes = set.scopes.length ? set.scopes : undefined;
        refreshed = true;
        probe = await runProbe(row.platform, token, row.external_id);
      } catch (thrown) {
        refreshError = safeText(thrown instanceof Error ? thrown.message : thrown, [
          token,
          refreshToken,
        ]);
      }
    }
  }

  // What the platform said, as a state the database accepts from where the account is now.
  const known = [token, refreshToken, row.access_token, row.refresh_token];
  let missing: string[] = [];
  let unknownScopes = false;
  let classified: ReturnType<typeof classifyHealthObservation>;
  let httpStatus: number | null = null;
  let retryAfter: number | null = null;
  let outcome: RetryOutcomeCode;
  let verifiedCandidate = false;

  if (probe.kind === "ok") {
    httpStatus = probe.status;
    const scopes = probe.scopes ?? refreshedScopes ?? row.granted_scopes ?? [];
    missing = missingScopesFor(row.platform, scopes);
    unknownScopes = scopesUnknown(row.platform, scopes);
    classified = classifyHealthObservation({
      from,
      validated: true,
      missingScopes: missing.length,
      reason: "",
      httpStatus: probe.status,
      writeSafe: true,
    });
    // Verified is a fact about the token and its permissions, not about which state the database
    // lets this account move to: a state that has no way out (an authorization that never finished)
    // is kept, and the proof is still true.
    verifiedCandidate = missing.length === 0 && !unknownScopes && classified.active;
    outcome = verifiedCandidate
      ? refreshed
        ? "refreshed"
        : row.active
          ? "healthy"
          : "recovered"
      : missing.length > 0
        ? "scopes_missing"
        : unknownScopes
          ? "scopes_unknown"
          : "needs_reconnect";
  } else {
    stage = refreshError || refreshed ? "refresh" : "probe";
    if (probe.kind === "refused") {
      httpStatus = probe.local ? null : probe.status;
      retryAfter = probe.retryAfter;
    } else if (probe.kind === "mismatch") {
      httpStatus = probe.status || null;
    }
    classified = classifyHealthObservation({
      from,
      validated: false,
      writeSafe: true,
      missingScopes: 0,
      reason: refreshError ?? (probe.kind === "unreachable" ? probe.message : ""),
      // What the platform answered decides. After a failed renewal the renewal's own error is what
      // decides, and it is read from the sentence the refresh call threw.
      ...(refreshError
        ? {}
        : probe.kind === "refused"
          ? {
              httpStatus: probe.unauthorized ? 401 : probe.status,
              providerCode: probe.code,
            }
          : probe.kind === "mismatch"
            ? { httpStatus: 404 }
            : { unreachable: true }),
    });
    // "The platform no longer accepts this sign-in", judged from what it said and not from the
    // state the database would accept (a revoked answer can be filed under another state).
    const invalid = refreshError
      ? /revok|invalid[_ ]grant|reauthori/i.test(refreshError)
      : probe.kind === "refused" && probe.unauthorized;
    // 403, or Meta's permission codes: the sign-in is fine, a permission is not.
    const permissionDenied =
      probe.kind === "refused" &&
      (probe.status === 403 || ["3", "10", "200"].includes(probe.code ?? ""));
    outcome =
      classified.code === "rate_limited"
        ? "rate_limited"
        : classified.code === "provider_unavailable"
          ? "provider_unavailable"
          : invalid
            ? "needs_reconnect"
            : refreshError
              ? "failed"
              : permissionDenied
                ? "forbidden"
                : "needs_reconnect";
  }

  // The write.
  const verified = verifiedCandidate && evidence.available;
  const failure = [
    "rate_limited",
    "provider_unavailable",
    "needs_reconnect",
    "forbidden",
    "failed",
  ].includes(outcome);
  const retryCount = failure ? row.retry_count + 1 : 0;
  const retryAt = !failure
    ? null
    : outcome === "rate_limited" && retryAfter !== null
      ? new Date(Date.now() + Math.min(Math.max(retryAfter, 60), 86_400) * 1000).toISOString()
      : backoffFrom(retryCount);
  const features = featuresForScopes(row.platform, missing);
  const reason = describeOutcome(verifiedCandidate ? "healthy" : outcome, {
    platform: name,
    httpStatus,
    features,
    retryAt,
    reference: check.reference,
  });
  // What is stored if the proof turns out to be impossible to store (see fallbackPatch below).
  const unstoredReason = describeOutcome("evidence_unavailable", {
    platform: name,
    reference: check.reference,
  });
  const patch: Record<string, unknown> = {
    active: classified.active,
    connection_state: classified.state,
    health: verified ? "connected" : classified.state === "revoked" ? "disconnected" : "attention",
    state_reason: verifiedCandidate ? "Verified by a live check." : reason.slice(0, 500),
    status_reason: verifiedCandidate ? null : reason,
    last_error: failure ? reason : null,
    last_error_at: failure ? now : null,
    retry_count: retryCount,
    last_retry_at: now,
    next_retry_at: retryAt,
  };
  const listed = probe.kind === "ok" ? (probe.scopes ?? refreshedScopes) : undefined;
  if (listed?.length) patch["granted_scopes"] = listed;
  if (refreshed && !channel) {
    patch["access_token"] = await sealSecret(token);
    patch["refresh_token"] = await sealSecret(refreshToken);
    patch["token_expires_at"] = expiresAt;
  }

  const written = await writeCheck({
    accountId: row.id,
    tenantId: row.tenant_id,
    patch,
    // Where the evidence columns do not exist the write is repeated without them, and then nothing
    // may say "connected" or "verified": not the old health column, and not the stored sentences.
    fallbackPatch: {
      health: "attention",
      state_reason: unstoredReason.slice(0, 500),
      status_reason: unstoredReason,
    },
    evidence: {
      attemptAt: now,
      successAt: verifiedCandidate ? now : null,
      // The platform refused this token (or its permission): whatever an earlier check proved no
      // longer stands, whichever state the database lets the account move to. An outage, a rate
      // limit or no answer says nothing about the token, so the earlier proof is left alone.
      withdrawProof: outcome === "needs_reconnect" || outcome === "forbidden",
    },
    unchangedSince,
    returning:
      "id, active, connection_state, token_expires_at, granted_scopes, last_error_at, next_retry_at",
  });

  let saved: Record<string, unknown> | null = null;
  let evidenceSaved = false;
  if (written.ok) {
    saved = written.row;
    evidenceSaved = written.evidence === "ok";
    if (verifiedCandidate && !evidenceSaved) outcome = "evidence_unavailable";
  } else {
    console.error(
      `[integration-health] ${check.reference} ${row.platform} save failed (${written.kind})`,
    );
    // Nothing matched: the account is no longer what the check started from. That is not a
    // failure of the check, and nothing was written.
    outcome = written.kind === "no_row" ? "changed_while_checking" : "save_failed";
    stage = "save";
    // A provider that rotates refresh tokens has already retired the old one. If the result could not
    // be saved but the new tokens could be, keep them: losing them would break the connection. Only
    // onto the very account the renewal was for -- still switched on, same tokens -- so a rotated
    // token can never bring back an account somebody disconnected meanwhile.
    if (refreshed && !channel) {
      await writeCheck({
        accountId: row.id,
        tenantId: row.tenant_id,
        patch: {
          access_token: patch["access_token"],
          refresh_token: patch["refresh_token"],
          token_expires_at: expiresAt,
        },
        evidence: null,
        unchangedSince: { ...unchangedSince, connection_state: undefined },
        returning: "id",
      }).catch(() => undefined);
    }
  }
  if (written.ok) stage = outcome === "evidence_unavailable" ? "save" : "done";

  // The sentence for the log and for the caller follows what finally happened, never what was
  // hoped for before the write: a result that could not be saved is not logged as "Verified".
  const said = safeText(
    describeOutcome(outcome, {
      platform: name,
      httpStatus,
      features,
      retryAt,
      reference: check.reference,
    }),
    known,
    1000,
  );
  const changedMeanwhile = outcome === "changed_while_checking";

  // Read back: the status is built from the row the write returned, with the same function every
  // screen uses. When nothing was saved it is the row as it still stands.
  const savedFields = saved as {
    active?: boolean;
    connection_state?: string | null;
    token_expires_at?: string | null;
    granted_scopes?: string[] | null;
    last_error_at?: string | null;
    next_retry_at?: string | null;
    last_validation_attempt_at?: string | null;
    last_validation_success_at?: string | null;
  } | null;
  const status = savedFields
    ? statusOf(
        row,
        {
          active: savedFields.active ?? row.active,
          connection_state: savedFields.connection_state ?? row.connection_state,
          token_expires_at: savedFields.token_expires_at ?? row.token_expires_at,
          granted_scopes: savedFields.granted_scopes ?? row.granted_scopes,
        },
        {
          state: evidenceSaved ? "ok" : "unavailable",
          connection_state: savedFields.connection_state ?? null,
          last_validation_success_at: savedFields.last_validation_success_at ?? null,
          last_validation_attempt_at: savedFields.last_validation_attempt_at ?? null,
          last_error_at: savedFields.last_error_at ?? null,
          next_retry_at: savedFields.next_retry_at ?? null,
        },
        Boolean(refreshToken),
      )
    : statusOf(row, {}, stored, renewsAsStored);

  // The log of the check. It is never allowed to change the result: a log that cannot be written
  // is reported as log_saved: false.
  let logSaved = false;
  try {
    const logged = await supabaseAdmin.from("connection_retry_log").insert({
      tenant_id: row.tenant_id,
      account_id: row.id,
      platform: row.platform,
      outcome,
      reason: said,
      trigger: args.trigger,
      // connection_retry_log is readable by every member of the workspace (through the database's
      // own API as well as the dialog), so it holds plain facts only: no permission names, no
      // words from the platform (they can name an app or a Page) and only the short reference of
      // the check. What staff need is read from the account and from that reference.
      details: {
        stage,
        probe: PROBES[row.platform] ? row.platform : null,
        http_status: httpStatus,
        correlation_id: check.reference,
        evidence_saved: evidenceSaved,
        refreshed,
        retry_count: retryCount,
      } as never,
    });
    logSaved = !logged.error;
  } catch {
    logSaved = false;
  }

  if (written.ok && savedFields?.connection_state && savedFields.connection_state !== from) {
    const { logAudit } = await import("@/lib/audit.server");
    await logAudit({
      action: "connection.state_changed",
      tenantId: row.tenant_id,
      actorId: args.actorId ?? null,
      entityType: "social_account",
      entityId: row.id,
      details: {
        platform: row.platform,
        from,
        to: savedFields.connection_state,
        correlation_id: check.reference,
      },
    });
  }

  console.info(
    `[integration-health] ${check.reference} ${row.platform} stage=${stage} http=${httpStatus ?? "-"} outcome=${outcome}`,
  );

  return {
    platform: row.platform,
    account_id: row.id,
    outcome,
    reason: said,
    stage,
    // An account that changed while it was checked has no status to claim: the row this check read
    // is not the row that is there now, and nothing was written. The screen reads it afresh.
    ...(changedMeanwhile
      ? {}
      : {
          status,
          saved_at: written.ok && evidenceSaved ? now : (stored.last_validation_attempt_at ?? null),
        }),
    correlation_id: check.reference,
    http_status: httpStatus,
    log_saved: logSaved,
    params: { permissions: features, retry_at: retryAt },
  };
}

/** Checks the accounts of a workspace that are failing, expiring or have never been verified. */
export async function retryDueConnections(args: {
  tenantId: string;
  trigger: "manual" | "auto";
  actorId?: string | null;
}): Promise<RetryOutcome[]> {
  const columns =
    "id, platform, active, token_expires_at, next_retry_at, external_id, connection_state";
  const base = () =>
    supabaseAdmin.from("social_accounts").select(columns).eq("tenant_id", args.tenantId);
  // Two kinds of account can be checked: one with a stored token, and one that is still switched on
  // and keeps its token elsewhere (the channel picker's accounts leave access_token empty). A
  // deliberate disconnect is neither: it clears its tokens and switches the account off.
  const [withToken, channelModel] = await Promise.all([
    base().not("access_token", "is", null),
    base().is("access_token", null).eq("active", true),
  ]);
  const error = withToken.error ?? channelModel.error;
  // A failed read must stop here: an empty list would read as "everything is fine".
  if (error) {
    throw new Error("Flas could not read this workspace's connections. Try again in a moment.");
  }
  const data = [...(withToken.data ?? []), ...(channelModel.data ?? [])];
  const evidence = await readEvidence(args.tenantId);

  const wanted = ((data ?? []) as unknown as Partial<AccountRow>[]).filter((row) => {
    // Deliberately disconnected and unidentified accounts are left alone.
    if (row.connection_state === "disconnected" || !row.external_id) return false;
    const expiringSoon = row.token_expires_at
      ? new Date(row.token_expires_at).getTime() - Date.now() < 1000 * 60 * 60 * 24 * 3
      : false;
    const failing =
      !row.active ||
      ["revoked", "refresh_failed", "provider_unavailable"].includes(row.connection_state ?? "");
    // Active, identified, and nobody has ever confirmed it with the platform.
    const unproven = !(evidence.byId.get(String(row.id))?.last_validation_success_at ?? null);
    return failing || expiringSoon || unproven;
  });
  const waitIsOver = (row: Partial<AccountRow>) =>
    !row.next_retry_at || new Date(row.next_retry_at).getTime() <= Date.now();
  const due = wanted.filter(waitIsOver).slice(0, BULK_CAP);
  // An account still inside its wait is not asked again, and is not left out of the answer either:
  // a button that checks "what is due" and returns nothing, while the list shows the account,
  // looks like it did nothing.
  const waiting = wanted.filter((row) => !waitIsOver(row)).slice(0, BULK_CAP);

  // Each account runs its own check and gets its own checked write. Nothing marks a group at once.
  const results: RetryOutcome[] = [];
  for (const row of due) {
    results.push(
      await retryConnection({
        accountId: String(row.id),
        tenantId: args.tenantId,
        trigger: args.trigger,
        actorId: args.actorId ?? null,
      }),
    );
  }
  for (const row of waiting) {
    const platform = String(row.platform);
    results.push({
      platform,
      account_id: String(row.id),
      outcome: "waiting_to_retry",
      reason: describeOutcome("waiting_to_retry", {
        platform: connector(platform)?.name ?? platform,
        retryAt: row.next_retry_at ?? null,
      }),
      stage: "gate",
      params: { retry_at: row.next_retry_at ?? null },
    });
  }
  return results;
}
