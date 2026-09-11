// Social Connection Doctor — capability-level diagnosis.
//
// The distinction this file exists to enforce: a GRANTED PERMISSION IS NOT A
// WORKING CAPABILITY. A scope can be present while the call still fails
// (page role removed, Instagram account still personal, business verification
// pending, API tier too low). So every capability carries two independent
// facts — what was granted, and what actually happened when we called it.
//
// Safety rule: a connection test never creates public content. Publishing is
// probed with read-only or validation endpoints only. A real test post
// requires explicit, separate user confirmation.
import { openSecret } from "@/lib/secret-box.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  normalizeProviderError,
  recordIntegrationError,
  type NormalizedError,
} from "./integration-errors.server";

export const META_API_VERSION = "v21.0";

/** Finer-grained than the catalog's 5 marketing capabilities — these map to
 *  individual API calls we can actually probe. */
export type DoctorCapability =
  | "profile_read"
  | "posts_read"
  | "comments_read"
  | "messages_read"
  | "publish"
  | "analytics"
  | "ads_read";

export const CAPABILITY_LABELS: Record<DoctorCapability, string> = {
  profile_read: "Read profile",
  posts_read: "Read posts",
  comments_read: "Read comments",
  messages_read: "Read messages",
  publish: "Publish content",
  analytics: "Read analytics",
  ads_read: "Read ad accounts",
};

export type TestOutcome = "pass" | "fail" | "warning" | "skipped" | "not_supported";

export type CheckResult = {
  key: string;
  label: string;
  outcome: TestOutcome;
  detail: string;
  httpStatus?: number | null;
  providerCode?: string | null;
  durationMs?: number;
};

export type CapabilityResult = {
  capability: DoctorCapability;
  /** What the platform says was granted. */
  permissionState:
    | "granted"
    | "missing"
    | "declined"
    | "expired"
    | "requires_admin"
    | "requires_review"
    | "not_supported"
    | "unknown";
  /** What happened when we actually called it. */
  testOutcome: TestOutcome;
  status:
    | "working"
    | "degraded"
    | "missing_permission"
    | "unsupported"
    | "failing"
    | "untested"
    | "unknown";
  detail: string;
  requiredScopes: string[];
  missingScopes: string[];
};

export type DoctorReport = {
  accountId: string;
  platform: string;
  verdict:
    | "healthy"
    | "partial"
    | "action_required"
    | "expiring_soon"
    | "limited"
    | "disconnected"
    | "error";
  healthScore: number;
  summary: string;
  checks: CheckResult[];
  capabilities: CapabilityResult[];
  identity: {
    id: string | null;
    name: string | null;
    username: string | null;
    matchesStored: boolean | null;
  };
  tokenExpiresAt: string | null;
};

export type AccountUnderTest = {
  id: string;
  tenant_id: string;
  platform: string;
  label: string;
  external_id: string | null;
  access_token: string | null;
  token_expires_at: string | null;
  granted_scopes: string[] | null;
};

/* ------------------------------------------------------------------ */
/* Provider adapter interface (§68)                                     */
/* ------------------------------------------------------------------ */

export type ProviderAdapter = {
  platform: string;
  /** Confirms the token is accepted and returns live granted scopes. */
  authenticate: (account: AccountUnderTest) => Promise<{
    ok: boolean;
    scopes: string[];
    check: CheckResult;
  }>;
  /** Who does the platform say this token belongs to? */
  identity: (account: AccountUnderTest) => Promise<{
    id: string | null;
    name: string | null;
    username: string | null;
    check: CheckResult;
  }>;
  /** Scopes each capability needs on this platform. Absent = unsupported. */
  requiredScopes: Partial<Record<DoctorCapability, string[]>>;
  /** A safe, read-only probe per capability. Absent = permission-only judgement. */
  probes: Partial<Record<DoctorCapability, (account: AccountUnderTest) => Promise<CheckResult>>>;
};

/* ------------------------------------------------------------------ */
/* Shared fetch helper                                                  */
/* ------------------------------------------------------------------ */

type ProbeContext = { platform: string; feature: string; apiVersion?: string };

/** One place that performs a probe, times it, and normalizes any failure so
 *  provider codes survive all the way into the report. */
async function probe(
  ctx: ProbeContext,
  label: string,
  key: string,
  run: () => Promise<Response>,
): Promise<CheckResult & { normalized?: NormalizedError }> {
  const startedAt = Date.now();
  try {
    const res = await run();
    const durationMs = Date.now() - startedAt;
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* some endpoints return no body */
    }
    // Meta returns HTTP 200 with an { error } payload in some cases.
    const hasErrorPayload =
      typeof body === "object" && body !== null && "error" in (body as object);
    if (res.ok && !hasErrorPayload) {
      return {
        key,
        label,
        outcome: "pass",
        detail: `${label} succeeded.`,
        httpStatus: res.status,
        durationMs,
      };
    }
    const normalized = normalizeProviderError({
      platform: ctx.platform,
      httpStatus: res.status,
      body,
      apiVersion: ctx.apiVersion ?? null,
    });
    return {
      key,
      label,
      outcome: "fail",
      detail: normalized.friendlyMessage,
      httpStatus: normalized.httpStatus,
      providerCode: normalized.providerCode,
      durationMs,
      normalized,
    };
  } catch (thrown) {
    const normalized = normalizeProviderError({
      platform: ctx.platform,
      thrown,
      apiVersion: ctx.apiVersion ?? null,
    });
    return {
      key,
      label,
      outcome: "fail",
      detail: normalized.friendlyMessage,
      durationMs: Date.now() - startedAt,
      normalized,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Meta adapter — Facebook Pages + Instagram (§8, §9)                   */
/* ------------------------------------------------------------------ */

const GRAPH = `https://graph.facebook.com/${META_API_VERSION}`;

function metaAdapter(platform: "facebook" | "instagram"): ProviderAdapter {
  const ctx: ProbeContext = { platform, feature: "meta", apiVersion: META_API_VERSION };
  const q = (token: string) => `access_token=${encodeURIComponent(token)}`;

  return {
    platform,
    requiredScopes:
      platform === "instagram"
        ? {
            profile_read: ["instagram_basic"],
            posts_read: ["instagram_basic"],
            comments_read: ["instagram_manage_comments"],
            messages_read: ["instagram_manage_messages"],
            publish: ["instagram_content_publish"],
            analytics: ["instagram_manage_insights"],
          }
        : {
            profile_read: ["pages_show_list"],
            posts_read: ["pages_read_engagement"],
            comments_read: ["pages_read_engagement"],
            messages_read: ["pages_messaging"],
            publish: ["pages_manage_posts"],
            analytics: ["read_insights"],
            ads_read: ["ads_read"],
          },

    authenticate: async (account) => {
      const token = account.access_token ?? "";
      const result = await probe(ctx, "Authentication", "authentication", () =>
        fetch(`${GRAPH}/me/permissions?${q(token)}`),
      );
      let scopes: string[] = [];
      if (result.outcome === "pass") {
        try {
          const res = await fetch(`${GRAPH}/me/permissions?${q(token)}`);
          const json = (await res.json()) as {
            data?: Array<{ permission: string; status: string }>;
          };
          scopes = (json.data ?? []).filter((p) => p.status === "granted").map((p) => p.permission);
        } catch {
          /* scopes stay empty; authentication already passed */
        }
      }
      return { ok: result.outcome === "pass", scopes, check: result };
    },

    identity: async (account) => {
      const token = account.access_token ?? "";
      const fields = platform === "instagram" ? "id,username,name" : "id,name";
      const target = account.external_id ? encodeURIComponent(account.external_id) : "me";
      const check = await probe(ctx, "Account identity", "identity", () =>
        fetch(`${GRAPH}/${target}?fields=${fields}&${q(token)}`),
      );
      if (check.outcome !== "pass") return { id: null, name: null, username: null, check };
      try {
        const res = await fetch(`${GRAPH}/${target}?fields=${fields}&${q(token)}`);
        const json = (await res.json()) as { id?: string; name?: string; username?: string };
        return {
          id: json.id ?? null,
          name: json.name ?? null,
          username: json.username ?? null,
          check,
        };
      } catch {
        return { id: null, name: null, username: null, check };
      }
    },

    probes: {
      profile_read: async (account) => {
        const token = account.access_token ?? "";
        const target = account.external_id ? encodeURIComponent(account.external_id) : "me";
        const fields = platform === "instagram" ? "id,username" : "id,name";
        return probe(ctx, "Read profile", "capability:profile_read", () =>
          fetch(`${GRAPH}/${target}?fields=${fields}&${q(token)}`),
        );
      },
      posts_read: async (account) => {
        const token = account.access_token ?? "";
        if (!account.external_id) {
          return {
            key: "capability:posts_read",
            label: "Read posts",
            outcome: "skipped",
            detail: "No account id stored to read posts from.",
          };
        }
        const edge = platform === "instagram" ? "media" : "feed";
        return probe(ctx, "Read posts", "capability:posts_read", () =>
          fetch(`${GRAPH}/${encodeURIComponent(account.external_id!)}/${edge}?limit=1&${q(token)}`),
        );
      },
      analytics: async (account) => {
        const token = account.access_token ?? "";
        if (!account.external_id) {
          return {
            key: "capability:analytics",
            label: "Read analytics",
            outcome: "skipped",
            detail: "No account id stored.",
          };
        }
        // Reading one lightweight metric proves insights access without cost.
        const metric = platform === "instagram" ? "impressions" : "page_impressions";
        return probe(ctx, "Read analytics", "capability:analytics", () =>
          fetch(
            `${GRAPH}/${encodeURIComponent(account.external_id!)}/insights?metric=${metric}&period=day&${q(token)}`,
          ),
        );
      },
      ads_read: async (account) => {
        const token = account.access_token ?? "";
        return probe(ctx, "Read ad accounts", "capability:ads_read", () =>
          fetch(`${GRAPH}/me/adaccounts?limit=1&fields=id&${q(token)}`),
        );
      },
      // publish is deliberately NOT probed with a write. Presence of the
      // scope plus a readable publishing target is as far as a safe test
      // can go; a real publish test needs explicit user confirmation.
    },
  };
}

const ADAPTERS: Record<string, ProviderAdapter> = {
  facebook: metaAdapter("facebook"),
  instagram: metaAdapter("instagram"),
};

export function adapterFor(platform: string): ProviderAdapter | null {
  return ADAPTERS[platform] ?? null;
}

/* ------------------------------------------------------------------ */
/* Scoring (§3, §74)                                                    */
/* ------------------------------------------------------------------ */

function scoreFrom(
  authOk: boolean,
  capabilities: CapabilityResult[],
  tokenExpiringSoon: boolean,
): number {
  if (!authOk) return 0;
  const gradeable = capabilities.filter((c) => c.status !== "unsupported");
  if (gradeable.length === 0) return 60;
  const points = gradeable.reduce((sum, c) => {
    if (c.status === "working") return sum + 100;
    if (c.status === "degraded") return sum + 60;
    if (c.status === "missing_permission") return sum + 30;
    if (c.status === "untested") return sum + 50;
    return sum; // failing / unknown
  }, 0);
  const base = Math.round(points / gradeable.length);
  // Authentication is weighted heavily: it passed, so floor the score.
  const withAuth = Math.round(base * 0.85 + 100 * 0.15);
  return Math.max(0, Math.min(100, tokenExpiringSoon ? withAuth - 10 : withAuth));
}

function verdictFrom(
  authOk: boolean,
  capabilities: CapabilityResult[],
  tokenExpiringSoon: boolean,
): DoctorReport["verdict"] {
  if (!authOk) return "disconnected";
  const gradeable = capabilities.filter((c) => c.status !== "unsupported");
  const anyFailing = gradeable.some((c) => c.status === "failing");
  const anyMissing = gradeable.some((c) => c.status === "missing_permission");
  if (anyFailing) return "error";
  if (anyMissing) return "action_required";
  if (tokenExpiringSoon) return "expiring_soon";
  if (gradeable.some((c) => c.status === "degraded" || c.status === "untested")) return "partial";
  return "healthy";
}

/* ------------------------------------------------------------------ */
/* Orchestrator (§4, §55)                                               */
/* ------------------------------------------------------------------ */

/**
 * Runs a full diagnostic against one account and persists the result.
 * Makes real API calls — it does not read cached database values and call
 * that a test.
 */
export async function runConnectionTest(args: {
  account: AccountUnderTest;
  triggeredBy?: string | null;
  trigger?: "manual" | "auto" | "post_oauth" | "pre_publish" | "scheduled";
}): Promise<DoctorReport> {
  // Opened here as well as by the callers: the test sends this token to the
  // provider, and ciphertext would fail every check for the wrong reason.
  args.account.access_token = await openSecret(args.account.access_token);
  const { account } = args;
  const startedAt = Date.now();
  const checks: CheckResult[] = [];
  const capabilities: CapabilityResult[] = [];

  const adapter = adapterFor(account.platform);

  // No adapter yet for this platform — say so honestly rather than guessing.
  if (!adapter) {
    const report: DoctorReport = {
      accountId: account.id,
      platform: account.platform,
      verdict: "limited",
      healthScore: 0,
      summary: `Deep diagnostics for ${account.platform} are not built yet — only basic checks are available for this platform.`,
      checks: [
        {
          key: "adapter",
          label: "Platform diagnostics",
          outcome: "not_supported",
          detail: `No diagnostic adapter exists for ${account.platform} yet.`,
        },
      ],
      capabilities: [],
      identity: { id: null, name: null, username: null, matchesStored: null },
      tokenExpiresAt: account.token_expires_at,
    };
    await persistReport(
      account,
      report,
      Date.now() - startedAt,
      args.triggeredBy ?? null,
      args.trigger ?? "manual",
    );
    return report;
  }

  if (!account.access_token) {
    const report: DoctorReport = {
      accountId: account.id,
      platform: account.platform,
      verdict: "disconnected",
      healthScore: 0,
      summary: "No stored authorization for this account — it needs connecting.",
      checks: [
        {
          key: "authentication",
          label: "Authentication",
          outcome: "fail",
          detail: "No access token stored.",
        },
      ],
      capabilities: [],
      identity: { id: null, name: null, username: null, matchesStored: null },
      tokenExpiresAt: null,
    };
    await persistReport(
      account,
      report,
      Date.now() - startedAt,
      args.triggeredBy ?? null,
      args.trigger ?? "manual",
    );
    return report;
  }

  // Test 1 — Authentication (also yields live scopes).
  const auth = await adapter.authenticate(account);
  checks.push(auth.check);

  // Test 2 — Identity, and whether it matches what we stored (§47).
  let identity: DoctorReport["identity"] = {
    id: null,
    name: null,
    username: null,
    matchesStored: null,
  };
  if (auth.ok) {
    const id = await adapter.identity(account);
    checks.push(id.check);
    const matchesStored =
      account.external_id && id.id ? String(id.id) === String(account.external_id) : null;
    identity = { id: id.id, name: id.name, username: id.username, matchesStored };
    if (matchesStored === false) {
      checks.push({
        key: "identity_match",
        label: "Account match",
        outcome: "warning",
        detail: `The platform returned a different account (${id.id}) than the one stored (${account.external_id}).`,
      });
    }
  }

  // Test 3 — Token expiry.
  const expiresAt = account.token_expires_at ? new Date(account.token_expires_at) : null;
  const daysLeft = expiresAt ? Math.round((expiresAt.getTime() - Date.now()) / 86400000) : null;
  const tokenExpiringSoon = daysLeft != null && daysLeft <= 14 && daysLeft >= 0;
  checks.push({
    key: "token",
    label: "Token validity",
    outcome:
      daysLeft == null ? "warning" : daysLeft < 0 ? "fail" : tokenExpiringSoon ? "warning" : "pass",
    detail:
      daysLeft == null
        ? "No expiry recorded for this authorization."
        : daysLeft < 0
          ? "This authorization has expired."
          : `Valid — expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`,
  });

  // Tests 4 & 5 — Permissions AND real capability probes, tracked separately.
  if (auth.ok) {
    const live = auth.scopes.length > 0 ? auth.scopes : (account.granted_scopes ?? []);
    for (const [cap, required] of Object.entries(adapter.requiredScopes) as [
      DoctorCapability,
      string[],
    ][]) {
      const missing = required.filter((scope) => !live.includes(scope));
      const permissionState = missing.length === 0 ? "granted" : "missing";

      const probeFn = adapter.probes[cap];
      let testOutcome: TestOutcome = "skipped";
      let detail = "";

      if (missing.length > 0) {
        detail = `Not approved: ${missing.join(", ")}.`;
        testOutcome = "skipped";
      } else if (probeFn) {
        const result = await probeFn(account);
        checks.push(result);
        testOutcome = result.outcome;
        detail = result.detail;
        const normalized = (result as { normalized?: NormalizedError }).normalized;
        if (normalized) {
          await recordIntegrationError({
            tenantId: account.tenant_id,
            accountId: account.id,
            platform: account.platform,
            feature: CAPABILITY_LABELS[cap],
            operation: result.key,
            error: normalized,
          });
        }
      } else {
        // Permission granted but no safe read-only probe exists (publishing).
        testOutcome = "skipped";
        detail =
          "Permission approved. Not verified with a live call — publishing is never tested automatically.";
      }

      const status: CapabilityResult["status"] =
        missing.length > 0
          ? "missing_permission"
          : testOutcome === "pass"
            ? "working"
            : testOutcome === "fail"
              ? "failing"
              : testOutcome === "warning"
                ? "degraded"
                : "untested";

      capabilities.push({
        capability: cap,
        permissionState,
        testOutcome,
        status,
        detail,
        requiredScopes: required,
        missingScopes: missing,
      });
    }
  }

  const healthScore = scoreFrom(auth.ok, capabilities, tokenExpiringSoon);
  const verdict = verdictFrom(auth.ok, capabilities, tokenExpiringSoon);
  const broken = capabilities.filter(
    (c) => c.status === "missing_permission" || c.status === "failing",
  );
  const summary = !auth.ok
    ? "The platform rejected this authorization — the account needs reconnecting."
    : broken.length === 0
      ? "Everything checked is working."
      : `${broken.length} of ${capabilities.length} capabilities need attention: ${broken.map((b) => CAPABILITY_LABELS[b.capability]).join(", ")}.`;

  const report: DoctorReport = {
    accountId: account.id,
    platform: account.platform,
    verdict,
    healthScore,
    summary,
    checks,
    capabilities,
    identity,
    tokenExpiresAt: account.token_expires_at,
  };

  await persistReport(
    account,
    report,
    Date.now() - startedAt,
    args.triggeredBy ?? null,
    args.trigger ?? "manual",
  );
  return report;
}

/** Writes the run, its individual checks, and the per-capability health. */
async function persistReport(
  account: AccountUnderTest,
  report: DoctorReport,
  durationMs: number,
  triggeredBy: string | null,
  trigger: string,
): Promise<void> {
  try {
    const { data: run } = await supabaseAdmin
      .from("social_connection_tests")
      .insert({
        tenant_id: account.tenant_id,
        account_id: account.id,
        triggered_by: triggeredBy,
        trigger,
        finished_at: new Date().toISOString(),
        verdict: report.verdict,
        health_score: report.healthScore,
        summary: report.summary,
        duration_ms: durationMs,
      })
      .select("id")
      .single();

    if (run?.id && report.checks.length > 0) {
      await supabaseAdmin.from("social_test_results").insert(
        report.checks.map((c, index) => ({
          test_id: run.id,
          tenant_id: account.tenant_id,
          check_key: c.key,
          label: c.label,
          outcome: c.outcome,
          detail: c.detail ?? null,
          http_status: c.httpStatus ?? null,
          provider_code: c.providerCode ?? null,
          duration_ms: c.durationMs ?? null,
          position: index,
        })),
      );
    }

    for (const cap of report.capabilities) {
      await supabaseAdmin.from("social_capabilities").upsert(
        {
          tenant_id: account.tenant_id,
          account_id: account.id,
          capability: cap.capability,
          status: cap.status,
          permission_state: cap.permissionState,
          tested_at: new Date().toISOString(),
          test_outcome: cap.testOutcome,
          detail: cap.detail,
          required_scopes: cap.requiredScopes,
          missing_scopes: cap.missingScopes,
        },
        { onConflict: "account_id,capability" },
      );
    }
  } catch (error) {
    console.error("[social-doctor] failed to persist test report", error);
  }
}
