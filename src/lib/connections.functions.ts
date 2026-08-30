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

    const { computeHealth } = await import("@/lib/connections.server");
    const enriched = (accounts.data ?? []).map((a) => ({
      ...a,
      health: computeHealth({
        active: a.active,
        access_token: a.connect_method === "oauth" || a.external_id ? "set" : "set",
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
    const tenantId = await callerTenantId(context.supabase, context.userId);
    if (!tenantId) throw new Error("Your workspace is still being set up — try again in a moment.");
    const { startAuthorization } = await import("@/lib/oauth.server");
    const { logAudit } = await import("@/lib/audit.server");
    await logAudit({
      action: "connection.authorize_started",
      tenantId,
      actorId: context.userId,
      entityType: "platform",
      entityId: data.platform,
    });
    return startAuthorization({
      platform: data.platform,
      origin: data.origin.replace(/\/$/, ""),
      tenantId,
      userId: context.userId,
    });
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
      .select("id, platform, label, profile")
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
    });
  });

/** Disconnects a platform (keeps history, clears the authorization). */
export const disconnectConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => IdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("social_accounts")
      .update({ active: false, health: "disconnected" })
      .eq("id", data.id);
    if (error) throw error;
    const { logAudit } = await import("@/lib/audit.server");
    await logAudit({
      action: "connection.disconnected",
      actorId: context.userId,
      entityType: "social_account",
      entityId: data.id,
    });
    return { ok: true };
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

/** Re-checks permissions and refreshes tokens for one or all connections. */
export const retryConnections = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ accountId: z.string().uuid().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const tenantId = await callerTenantId(context.supabase, context.userId);
    if (!tenantId) throw new Error("Your workspace is still being set up — try again in a moment.");
    const { retryConnection, retryDueConnections } = await import(
      "@/lib/integration-health.server"
    );
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
