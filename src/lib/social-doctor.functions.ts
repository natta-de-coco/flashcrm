import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const AccountSchema = z.object({ accountId: z.string().uuid() });

/**
 * Runs a full live diagnostic against one connected account.
 * Tokens are read with the admin client and never leave the server.
 */
export const testSocialConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AccountSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: tenantId, error: tenantError } = await context.supabase.rpc("current_tenant_id");
    // A recursion/timeout failure of this lookup used to be reported as
    // "no workspace", which sent people hunting a problem that was not theirs.
    if (tenantError) throw new Error(`Could not load your workspace: ${tenantError.message}`);
    if (!tenantId) throw new Error("Your workspace is still being set up.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: account } = await supabaseAdmin
      .from("social_accounts")
      .select(
        "id, tenant_id, platform, label, external_id, access_token, token_expires_at, granted_scopes",
      )
      .eq("id", data.accountId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!account) throw new Error("Account not found in this workspace.");
    const { openSecret } = await import("@/lib/secret-box.server");
    account.access_token = await openSecret(account.access_token);

    const { runConnectionTest } = await import("@/lib/social-doctor.server");
    const report = await runConnectionTest({
      account,
      triggeredBy: context.userId,
      trigger: "manual",
    });

    // The raw report contains no token — safe to return to the browser.
    return report;
  });

/**
 * Lists the Facebook Pages / Instagram accounts this connection can reach,
 * plus a plain-language diagnosis when none of them qualify. Powers the
 * "which Page?" picker and the "Instagram setup incomplete" explanation.
 * Page access tokens are stripped before returning — the browser never
 * needs them and must never see them.
 */
export const getMetaTargets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AccountSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: tenantId, error: tenantError } = await context.supabase.rpc("current_tenant_id");
    // A recursion/timeout failure of this lookup used to be reported as
    // "no workspace", which sent people hunting a problem that was not theirs.
    if (tenantError) throw new Error(`Could not load your workspace: ${tenantError.message}`);
    if (!tenantId) throw new Error("Your workspace is still being set up.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: account } = await supabaseAdmin
      .from("social_accounts")
      .select("id, platform, access_token, external_id")
      .eq("id", data.accountId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (account) {
      const { openSecret } = await import("@/lib/secret-box.server");
      account.access_token = await openSecret(account.access_token);
    }
    if (!account?.access_token) throw new Error("This account has no stored authorization.");
    if (account.platform !== "facebook" && account.platform !== "instagram") {
      throw new Error("Page selection only applies to Facebook and Instagram.");
    }

    const { discoverMetaTargets, diagnoseMetaConnection } =
      await import("@/lib/meta-discovery.server");
    const discovery = await discoverMetaTargets(account.access_token);
    const platform = account.platform as "facebook" | "instagram";
    const diagnosis = diagnoseMetaConnection(discovery, platform);
    const relevant = platform === "instagram" ? discovery.pagesWithInstagram : discovery.pages;

    return {
      ok: discovery.ok,
      diagnosis,
      selectedId: account.external_id,
      targets: relevant.map((p) => ({
        pageId: p.id,
        pageName: p.name,
        picture: p.picture,
        followers: p.followers,
        category: p.category,
        canPublish: p.tasks.includes("CREATE_CONTENT"),
        instagramId: p.instagram?.id ?? null,
        instagramUsername: p.instagram?.username ?? null,
        // The id this account would be pinned to if chosen.
        targetId: platform === "instagram" ? (p.instagram?.id ?? null) : p.id,
      })),
    };
  });

const SelectTargetSchema = z.object({
  accountId: z.string().uuid(),
  pageId: z.string().min(1).max(120),
});

/**
 * Pins a connection to a specific Page / Instagram account, storing the
 * Page-scoped token that most Page operations actually require (the user
 * token is not sufficient). Re-runs diagnostics immediately afterwards so
 * the user sees the real result of their choice (§65).
 */
export const selectMetaTarget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SelectTargetSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: tenantId, error: tenantError } = await context.supabase.rpc("current_tenant_id");
    // A recursion/timeout failure of this lookup used to be reported as
    // "no workspace", which sent people hunting a problem that was not theirs.
    if (tenantError) throw new Error(`Could not load your workspace: ${tenantError.message}`);
    if (!tenantId) throw new Error("Your workspace is still being set up.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: account } = await supabaseAdmin
      .from("social_accounts")
      .select(
        "id, tenant_id, platform, label, access_token, token_expires_at, granted_scopes, external_id",
      )
      .eq("id", data.accountId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!account?.access_token) throw new Error("This account has no stored authorization.");
    const { openSecret, sealSecret } = await import("@/lib/secret-box.server");
    account.access_token = await openSecret(account.access_token);
    // Checked again after opening: a stored value can open to nothing, and that
    // is "no authorization", not a null handed to discovery.
    if (!account.access_token) throw new Error("This account has no stored authorization.");

    const platform = account.platform as "facebook" | "instagram";
    // Checked before discovery so the customer gets the real reason. Once a
    // Page is chosen the row holds that Page's token, which cannot list other
    // Pages -- so asking to switch failed with "no longer available to this
    // login", which sent people looking for a permissions problem.
    if (platform === "facebook" && account.external_id && account.external_id !== data.pageId) {
      throw new Error(
        "This connection is already linked to a different Page. Connect again to add another Page.",
      );
    }
    const { discoverMetaTargets } = await import("@/lib/meta-discovery.server");
    const discovery = await discoverMetaTargets(account.access_token);
    const page = discovery.pages.find((p) => p.id === data.pageId);
    if (!page) throw new Error("That Page is no longer available to this login.");

    const targetId = platform === "instagram" ? page.instagram?.id : page.id;
    if (!targetId) throw new Error("That Page has no Instagram professional account attached.");

    const profile = {
      external_id: targetId,
      name: platform === "instagram" ? (page.instagram?.name ?? page.name) : page.name,
      username: platform === "instagram" ? page.instagram?.username : page.username,
      picture: platform === "instagram" ? page.instagram?.picture : page.picture,
      followers: platform === "instagram" ? page.instagram?.followers : page.followers,
    };

    // A connection already linked to a channel is never re-pointed at a
    // different one: that is how a record, with its posts and comments, came
    // to describe an account it no longer belonged to. A second Page is a
    // second connection.
    if (account.external_id && account.external_id !== targetId) {
      throw new Error(
        "This connection is already linked to a different Page. Connect again to add another Page.",
      );
    }

    // Reconnecting a channel that is already connected here folds the fresh
    // authorization into the existing row and drops the pending one, so the
    // same Page never ends up with two rows.
    const { data: already } = await supabaseAdmin
      .from("social_accounts")
      .select("id")
      .eq("tenant_id", tenantId as string)
      .eq("platform", account.platform)
      .eq("external_id", targetId)
      .neq("id", account.id)
      .limit(1);
    const keepId = already?.[0]?.id ?? account.id;

    // The row may be a revoked or disconnected connection being reconnected
    // through the picker. Its state has to follow the fresh authorization, or
    // it reads active and revoked at the same time.
    const { deriveConnectionState } = await import("@/lib/connection-state.server");
    const derived = deriveConnectionState({
      active: true,
      access_token:
        page.pageAccessToken && platform === "facebook"
          ? page.pageAccessToken
          : account.access_token,
      token_expires_at: account.token_expires_at,
      granted_scopes: account.granted_scopes,
      platform: account.platform,
    });

    const { error: saveError } = await supabaseAdmin
      .from("social_accounts")
      .update({
        external_id: targetId,
        label: profile.name ?? account.label,
        profile: profile as never,
        // A Page-scoped token outranks the user token for Page operations.
        access_token: await sealSecret(
          page.pageAccessToken && platform === "facebook"
            ? page.pageAccessToken
            : account.access_token,
        ),
        // A Page token taken from a long-lived user token does not expire;
        // the stored user token is long-lived when it has more than a day
        // left. Keeping its date would schedule a pointless, failing refresh.
        token_expires_at:
          page.pageAccessToken &&
          platform === "facebook" &&
          account.token_expires_at &&
          new Date(account.token_expires_at).getTime() - Date.now() > 24 * 60 * 60 * 1000
            ? null
            : account.token_expires_at,
        granted_scopes: account.granted_scopes,
        active: true,
        health: "connected",
        connection_state: derived.state,
        state_reason: derived.reason,
      })
      .eq("id", keepId)
      .eq("tenant_id", tenantId as string);
    if (saveError) throw new Error(`Could not save the selected Page: ${saveError.message}`);

    if (keepId !== account.id) {
      // Only the pending, never-identified row is removed.
      await supabaseAdmin
        .from("social_accounts")
        .delete()
        .eq("id", account.id)
        .eq("tenant_id", tenantId as string)
        .is("external_id", null);
    }

    const { logAudit } = await import("@/lib/audit.server");
    await logAudit({
      action: "connection.target_selected",
      tenantId: tenantId as string,
      actorId: context.userId,
      entityType: "social_account",
      entityId: keepId,
      details: { platform, pageId: page.id, targetId, mergedIntoExisting: keepId !== account.id },
    });

    // Immediately re-test so the user sees what their choice actually produced.
    const { runConnectionTest } = await import("@/lib/social-doctor.server");
    const report = await runConnectionTest({
      account: {
        ...account,
        external_id: targetId,
        access_token:
          page.pageAccessToken && platform === "facebook"
            ? page.pageAccessToken
            : account.access_token,
      },
      triggeredBy: context.userId,
      trigger: "post_oauth",
    });

    return { ok: true, report };
  });

/** Per-capability health for one account, for the Capability Matrix (§6). */
export const getAccountCapabilities = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AccountSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("social_capabilities")
      .select(
        "capability, status, permission_state, test_outcome, detail, required_scopes, missing_scopes, tested_at",
      )
      .eq("account_id", data.accountId);
    if (error) throw error;
    return rows ?? [];
  });

/** Most recent test runs for one account (§55 — permanent test history). */
export const getConnectionTestHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AccountSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("social_connection_tests")
      .select("id, trigger, started_at, finished_at, verdict, health_score, summary, duration_ms")
      .eq("account_id", data.accountId)
      .order("started_at", { ascending: false })
      .limit(20);
    if (error) throw error;
    return rows ?? [];
  });

/**
 * Unresolved integration errors for this workspace, newest first.
 * Grouped by fingerprint, so each row is one distinct problem with a count —
 * not one row per occurrence.
 */
export const getIntegrationErrors = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: rows, error } = await context.supabase
      .from("integration_errors")
      .select(
        "id, platform, feature, http_status, provider_code, provider_subcode, provider_message, friendly_title, friendly_message, likely_cause, recommended_fix, severity, retryable, occurrence_count, first_seen, last_seen",
      )
      .is("resolved_at", null)
      .order("last_seen", { ascending: false })
      .limit(50);
    if (error) throw error;
    return rows ?? [];
  });

const TargetChoiceSchema = z.object({
  accountId: z.string().uuid(),
  targetId: z.string().min(1).max(300),
});

/**
 * The LinkedIn Company Pages or Business Profile locations a pending
 * connection can manage, for the picker. Read from the provider with the
 * stored token, which never leaves the server.
 */
export const getConnectionTargets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AccountSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: tenantId, error: tenantError } = await context.supabase.rpc("current_tenant_id");
    if (tenantError) throw new Error(`Could not load your workspace: ${tenantError.message}`);
    if (!tenantId) throw new Error("Your workspace is still being set up.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: account } = await supabaseAdmin
      .from("social_accounts")
      .select("id, platform, access_token, external_id")
      .eq("id", data.accountId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!account) throw new Error("Connection not found in this workspace.");

    const { hasTargetDiscovery, listConnectionTargets } =
      await import("@/lib/connection-targets.server");
    if (!hasTargetDiscovery(account.platform)) {
      throw new Error("Choosing an account only applies to LinkedIn and Business Profile.");
    }
    const { openSecret } = await import("@/lib/secret-box.server");
    const token = await openSecret(account.access_token);
    if (!token) throw new Error("This connection has no stored authorization.");

    const listed = await listConnectionTargets(account.platform, token);
    return {
      ok: listed.ok,
      reason: listed.ok ? null : listed.reason,
      selectedId: account.external_id,
      targets: listed.targets,
    };
  });

/**
 * Pins a pending LinkedIn or Business Profile connection to one channel.
 *
 * The choice is accepted only if the provider, asked again here with the
 * stored token, lists it for this login -- an id posted by a browser is never
 * trusted on its own. A connection already pinned to a channel is not
 * re-pointed, and choosing a channel that is already connected merges into
 * that row instead of creating a second one.
 */
export const selectConnectionTarget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => TargetChoiceSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: tenantId, error: tenantError } = await context.supabase.rpc("current_tenant_id");
    if (tenantError) throw new Error(`Could not load your workspace: ${tenantError.message}`);
    if (!tenantId) throw new Error("Your workspace is still being set up.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: account } = await supabaseAdmin
      .from("social_accounts")
      .select(
        "id, platform, access_token, refresh_token, token_expires_at, granted_scopes, external_id",
      )
      .eq("id", data.accountId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!account) throw new Error("Connection not found in this workspace.");

    const { hasTargetDiscovery, listConnectionTargets, pickTarget, targetProfile } =
      await import("@/lib/connection-targets.server");
    if (!hasTargetDiscovery(account.platform)) {
      throw new Error("Choosing an account only applies to LinkedIn and Business Profile.");
    }
    if (account.external_id && account.external_id !== data.targetId) {
      throw new Error(
        "This connection is already linked to a different account. Connect again to add another.",
      );
    }

    const { openSecret } = await import("@/lib/secret-box.server");
    const token = await openSecret(account.access_token);
    if (!token) throw new Error("This connection has no stored authorization.");
    const listed = await listConnectionTargets(account.platform, token);
    if (!listed.ok) throw new Error(listed.reason);
    const target = pickTarget(listed.targets, data.targetId);
    if (!target) throw new Error("That account is not available to this login.");

    const { data: already } = await supabaseAdmin
      .from("social_accounts")
      .select("id")
      .eq("tenant_id", tenantId as string)
      .eq("platform", account.platform)
      .eq("external_id", target.id)
      .neq("id", account.id)
      .limit(1);
    const keepId = already?.[0]?.id ?? account.id;

    const { deriveConnectionState } = await import("@/lib/connection-state.server");
    const derived = deriveConnectionState({
      active: true,
      access_token: token,
      token_expires_at: account.token_expires_at,
      granted_scopes: account.granted_scopes,
      platform: account.platform,
      refresh_token: account.refresh_token,
    });
    const profile = targetProfile(target);

    const { error: saveError } = await supabaseAdmin
      .from("social_accounts")
      .update({
        external_id: target.id,
        label: target.name,
        profile: profile as never,
        profile_url: profile.profile_url ?? null,
        // The stored values as they are: already sealed, nothing to re-seal.
        access_token: account.access_token,
        refresh_token: account.refresh_token,
        token_expires_at: account.token_expires_at,
        granted_scopes: account.granted_scopes,
        active: true,
        health: "connected",
        connection_state: derived.state,
        state_reason: derived.reason,
      })
      .eq("id", keepId)
      .eq("tenant_id", tenantId as string);
    if (saveError) throw new Error(`Could not save the chosen account: ${saveError.message}`);

    if (keepId !== account.id) {
      await supabaseAdmin
        .from("social_accounts")
        .delete()
        .eq("id", account.id)
        .eq("tenant_id", tenantId as string)
        .is("external_id", null);
    }

    const { logAudit } = await import("@/lib/audit.server");
    await logAudit({
      action: "connection.target_selected",
      tenantId: tenantId as string,
      actorId: context.userId,
      entityType: "social_account",
      entityId: keepId,
      details: {
        platform: account.platform,
        targetId: target.id,
        mergedIntoExisting: keepId !== account.id,
      },
    });
    return { ok: true, accountId: keepId };
  });
