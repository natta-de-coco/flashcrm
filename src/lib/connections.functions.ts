import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { SOCIAL_ACCOUNT_PLATFORMS } from "@/lib/connections-catalog";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

type Client = SupabaseClient<Database>;

const PlatformSchema = z.enum(SOCIAL_ACCOUNT_PLATFORMS);
const IdSchema = z.object({ id: z.string().uuid() });

async function callerTenantId(supabase: Client, userId: string): Promise<string | null> {
  const { data } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", userId)
    .maybeSingle();
  return data?.tenant_id ?? null;
}

/**
 * Who is asking, for deciding how much of a problem they may see. Same profile
 * row and the same staff_role values as every other admin check in the app.
 */
async function callerRole(
  supabase: Client,
  userId: string,
): Promise<{ superAdmin: boolean; workspaceAdmin: boolean; tenantId: string | null }> {
  const { data } = await supabase
    .from("profiles")
    .select("tenant_id, staff_role")
    .eq("id", userId)
    .maybeSingle();
  const staffRole = String(data?.staff_role ?? "");
  return {
    superAdmin: staffRole === "super_admin",
    workspaceAdmin: staffRole === "company_admin" || staffRole === "super_admin",
    tenantId: data?.tenant_id ?? null,
  };
}

/** Everything the Connect Your Business screen renders. */
export const getConnections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase;
    const [accounts, scans, waNumbers, sites] = await Promise.all([
      supabase
        .from("social_accounts")
        .select(
          "id, platform, label, external_id, active, last_synced_at, created_at, stats, profile, permissions, token_expires_at, profile_url, last_post_at, last_analytics_sync_at, health, connect_method",
        )
        .order("created_at", { ascending: true }),
      supabase
        .from("social_account_scans")
        .select("id, account_id, overall, scores, findings, suggestions, created_at")
        .order("created_at", { ascending: false })
        .limit(60),
      supabase.from("wa_numbers").select("id, label, active").limit(20),
      supabase.from("lead_sites").select("id, name, platform, active").limit(50),
    ]);
    if (accounts.error) throw accounts.error;

    const { providerReadiness } = await import("@/lib/oauth.server");
    const tenantId = await callerTenantId(supabase, context.userId);
    const providerReady = await providerReadiness(tenantId);

    // Whether each connection's access token renews itself. Worked out here
    // because the refresh token is deliberately unreadable from a browser
    // session; only the yes/no leaves the server.
    const renewing = new Set<string>();
    if (tenantId) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: withRefresh } = await supabaseAdmin
        .from("social_accounts")
        .select("id")
        .eq("tenant_id", tenantId)
        .not("refresh_token", "is", null);
      for (const r of withRefresh ?? []) renewing.add(r.id);
    }

    const { computeHealth } = await import("@/lib/connections.server");
    const enriched = (accounts.data ?? []).map((a) => ({
      ...a,
      renews: renewing.has(a.id),
      health: computeHealth({
        active: a.active,
        renews: renewing.has(a.id),
        // Both branches of this were "set", so health could never report a
        // missing credential -- an account saved without a token showed as
        // healthy right up until its first sync failed.
        access_token: a.connect_method === "oauth" || a.external_id ? "set" : null,
        token_expires_at: a.token_expires_at,
        last_synced_at: a.last_synced_at,
      }),
    }));

    return {
      accounts: enriched,
      scans: scans.data ?? [],
      providerReady,
      whatsappNumbers: waNumbers.data ?? [],
      sites: sites.data ?? [],
      serverTime: new Date().toISOString(),
    };
  });

/** Starts the platform's official OAuth authorization flow. */
export const startConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ platform: PlatformSchema, origin: z.string().url() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const role = await callerRole(context.supabase, context.userId);
    const tenantId = role.tenantId;
    if (!tenantId) throw new Error("Your workspace is still being set up — try again in a moment.");
    const { startAuthorization } = await import("@/lib/oauth.server");
    const { startResultForCaller } = await import("@/lib/connection-readiness.server");
    const { logAudit } = await import("@/lib/audit.server");

    // Run first, then record what actually happened.
    //
    // This logged "Authorization started" before knowing whether one could
    // start, so a workspace with no app keys -- or a deployment whose origin
    // is not in OAUTH_ALLOWED_ORIGINS -- accumulated a row per click saying an
    // authorization had begun when the customer was never sent anywhere. That
    // is why the logs show repeated attempts against nothing connected.
    const result = await startAuthorization({
      platform: data.platform,
      origin: data.origin.replace(/\/$/, ""),
      tenantId,
      userId: context.userId,
    });

    // What the caller may see. The reason comes from the filtered problem, so
    // the sentence and the problem can never disagree, and server setting names
    // reach only a Flas super admin.
    const shaped = result.ready ? result : startResultForCaller(result, role);

    await logAudit({
      action: result.ready ? "connection.authorize_started" : "connection.authorize_blocked",
      tenantId,
      actorId: context.userId,
      entityType: "platform",
      entityId: data.platform,
      // The unfiltered reason used to be stored here, setting names and all.
      // The stable code says the same thing and carries nothing sensitive.
      details: result.ready
        ? { attempt_id: result.attemptId }
        : { code: result.problem.code, owner: result.problem.owner },
    });

    return shaped;
  });

/**
 * Which platforms can actually be connected right now, and what is missing when
 * they cannot.
 *
 * Until now the only way to find this out was to click Connect and read a toast
 * that disappeared. startAuthorization already computes the missing key names
 * and the UI threw them away. This surfaces the same answer up front, so the
 * card can say "needs your Meta app keys" before anyone is bounced to a
 * provider tab that was never going to work.
 *
 * Never returns key values -- only whether each one is present.
 */
export const getConnectReadiness = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const role = await callerRole(context.supabase, context.userId);
    const { CONNECTORS } = await import("@/lib/connections-catalog");
    const { providerEnvNames } = await import("@/lib/oauth.server");
    const { evaluateAllProviders, primaryProblem, problemForCaller, visibleMissingSettings } =
      await import("@/lib/connection-readiness.server");

    // One evaluation per provider family, not per connector -- Facebook and
    // Instagram share the same Meta app. This GET carries no browser origin, so
    // the deployment's own configured address is what gets diagnosed; it is
    // validated through the allowlist exactly like a browser's would be.
    const providers = await evaluateAllProviders({ tenantId: role.tenantId, origin: null });
    const byProvider = new Map(providers.map((p) => [p.provider as string, p]));

    const rows = [];
    for (const c of CONNECTORS) {
      if (!c.oauth || !c.provider) continue;
      const readiness = byProvider.get(c.provider);
      if (!readiness) continue;
      const [idEnv, secretEnv] = providerEnvNames(c.provider);
      const missing = [
        ...(!readiness.appIdPresent && idEnv ? [idEnv] : []),
        ...(!readiness.secretPresent && secretEnv ? [secretEnv] : []),
      ];
      const problem = primaryProblem(readiness);
      rows.push({
        id: c.id,
        name: c.name,
        provider: c.provider,
        // Unchanged meaning: whether the app keys are there at all.
        ready: readiness.configured,
        // Server setting names are administrator detail, so everyone else gets
        // the problem's plain English instead of a variable they cannot set.
        missing: visibleMissingSettings(missing, role),
        // "workspace" when this workspace pasted its own app keys, "shared"
        // when it falls back to the platform-wide ones, "none" when neither.
        source: readiness.credentialSource,
        state: readiness.state,
        problem: problem ? problemForCaller(problem, role) : null,
      });
    }
    return rows;
  });

/** Flas Account Scan for one connected account. */
export const scanConnectedAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => IdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const { data: account, error } = await supabase
      .from("social_accounts")
      .select("id, tenant_id, platform, label, profile, stats, last_synced_at")
      .eq("id", data.id)
      .single();
    if (error || !account) throw new Error("Account not found");

    const [{ data: posts }, { data: business }] = await Promise.all([
      supabase
        .from("social_posts")
        .select("caption, likes, comments_count, reach, published_at")
        .eq("account_id", data.id)
        .order("published_at", { ascending: false })
        .limit(15),
      supabase.from("business_profiles").select("*").maybeSingle(),
    ]);

    const { scanAccount } = await import("@/lib/connections.server");
    const result = await scanAccount({
      account: {
        ...account,
        profile: account.profile as Record<string, unknown> | null,
        stats: account.stats as Record<string, unknown> | null,
      },
      posts: posts ?? [],
      business: (business ?? null) as Record<string, unknown> | null,
    });

    const { error: insertError } = await supabase.from("social_account_scans").insert({
      account_id: data.id,
      overall: result.overall,
      scores: result.scores as never,
      findings: result.findings as never,
      suggestions: { measured: result.measured, estimated: result.estimated } as never,
    });
    if (insertError) throw insertError;
    const { logAudit } = await import("@/lib/audit.server");
    await logAudit({
      action: "connection.scanned",
      tenantId: account.tenant_id,
      actorId: context.userId,
      entityType: "social_account",
      entityId: data.id,
      details: { platform: account.platform, overall: result.overall },
    });
    return result;
  });

/** AI Profile Optimizer — copy-ready optimized profile content. */
export const optimizeConnectedProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => IdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const { data: account, error } = await supabase
      .from("social_accounts")
      .select("id, platform, label, profile, tenant_id")
      .eq("id", data.id)
      .single();
    if (error || !account) throw new Error("Account not found");

    const [{ data: business }, { data: scan }] = await Promise.all([
      supabase.from("business_profiles").select("*").maybeSingle(),
      supabase
        .from("social_account_scans")
        .select("findings")
        .eq("account_id", data.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const { optimizeProfile } = await import("@/lib/connections.server");
    return optimizeProfile({
      platform: account.platform,
      label: account.label,
      profile: account.profile as Record<string, unknown> | null,
      business: (business ?? null) as Record<string, unknown> | null,
      findings: Array.isArray(scan?.findings) ? (scan.findings as string[]) : [],
      tenantId: account.tenant_id,
    });
  });

/** Disconnects a platform (keeps history, clears the authorization). */
export const disconnectConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => IdSchema.parse(input))
  .handler(async ({ data, context }) => {
    // The update runs as the caller, so RLS decides who may disconnect. It
    // returns the row so a refusal is visible: an RLS-blocked UPDATE affects
    // zero rows without raising, which previously reported success while
    // changing nothing.
    const { data: changed, error } = await context.supabase
      .from("social_accounts")
      .update({ active: false, health: "disconnected" })
      .eq("id", data.id)
      .select("id, tenant_id, platform");
    if (error) throw error;
    const disconnected = changed?.[0];
    if (!disconnected) {
      throw new Error(
        "That connection was not found, or you do not have permission to disconnect it.",
      );
    }

    // Disconnecting used to leave the access and refresh tokens stored, so a
    // "disconnected" account could still act on the customer's behalf.
    const { revokeAndClearTokens } = await import("@/lib/connections.server");
    const revocation = await revokeAndClearTokens({
      accountId: disconnected.id,
      tenantId: disconnected.tenant_id,
      platform: disconnected.platform,
    });

    // Recorded as a deliberate disconnect rather than lumped in with expiry,
    // revocation and failed refresh, which all used to read "disconnected".
    const tenantId = await callerTenantId(context.supabase, context.userId);
    if (tenantId) {
      const { transitionConnection } = await import("@/lib/connection-state.server");
      await transitionConnection({
        accountId: data.id,
        tenantId,
        to: "disconnected",
        reason: "Disconnected by a user in this workspace",
        actorId: context.userId,
      });
    }
    const { logAudit } = await import("@/lib/audit.server");
    await logAudit({
      action: "connection.disconnected",
      actorId: context.userId,
      entityType: "social_account",
      entityId: data.id,
      details: {
        tokens_cleared: true,
        provider_revoked: revocation.revoked,
        note: revocation.reason,
      },
    });
    return { ok: true, providerRevoked: revocation.revoked, note: revocation.reason };
  });

/** Exportable Integration Health Report for the signed-in workspace. */
export const getIntegrationHealthReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tenantId = await callerTenantId(context.supabase, context.userId);
    if (!tenantId) throw new Error("Your workspace is still being set up — try again in a moment.");
    const { buildHealthReport } = await import("@/lib/integration-health.server");
    return buildHealthReport(tenantId);
  });

/**
 * Encrypts this workspace's stored credentials that are still in plaintext.
 *
 * Admins only, because it rewrites every stored token. Idempotent: running it
 * again changes nothing. Values written from now on are sealed anyway; this
 * catches the ones stored before the key was configured.
 */
export const encryptStoredCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("tenant_id, staff_role")
      .eq("id", context.userId)
      .maybeSingle();
    if (!profile?.tenant_id) {
      throw new Error("Your workspace is still being set up — try again in a moment.");
    }
    if (!["company_admin", "super_admin"].includes(String(profile.staff_role ?? ""))) {
      throw new Error("Only company admins can encrypt stored credentials.");
    }
    const { sealTenantSecrets } = await import("@/lib/secret-box.server");
    const report = await sealTenantSecrets(profile.tenant_id);
    if (!report.configured) {
      throw new Error(
        "No encryption key is configured. Add TOKEN_ENCRYPTION_KEYS to the server's secrets first.",
      );
    }
    const { logAudit } = await import("@/lib/audit.server");
    await logAudit({
      action: "credentials.sealed",
      tenantId: profile.tenant_id,
      actorId: context.userId,
      entityType: "workspace",
      entityId: profile.tenant_id,
      details: { sealed: report.sealedNow },
    });
    return report;
  });

/** Re-checks permissions and refreshes tokens for one or all connections. */
export const retryConnections = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ accountId: z.string().uuid().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const tenantId = await callerTenantId(context.supabase, context.userId);
    if (!tenantId) throw new Error("Your workspace is still being set up — try again in a moment.");
    const { retryConnection, retryDueConnections } =
      await import("@/lib/integration-health.server");
    const results = data.accountId
      ? [
          await retryConnection({
            accountId: data.accountId,
            tenantId,
            trigger: "manual",
            actorId: context.userId,
          }),
        ]
      : await retryDueConnections({ tenantId, trigger: "manual" });

    const { logAudit } = await import("@/lib/audit.server");
    await logAudit({
      action: "connection.retry",
      tenantId,
      actorId: context.userId,
      entityType: "social_account",
      entityId: data.accountId ?? "all",
      details: { results } as never,
    });
    return { results };
  });

/** Integration activity log: connections, scans, plugin pings and webhooks. */
export const getIntegrationLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase;
    const [audit, webhooks] = await Promise.all([
      supabase
        .from("audit_log")
        .select("id, action, actor_label, entity_type, entity_id, details, created_at")
        .or(
          "action.like.connection.%,action.like.integration.%,action.like.site.%,action.like.wa_number.%,action.like.website.%",
        )
        .order("created_at", { ascending: false })
        .limit(40),
      supabase
        .from("webhook_events")
        .select("id, source, event_type, status, error, attempts, created_at")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    return { audit: audit.data ?? [], webhooks: webhooks.data ?? [] };
  });
