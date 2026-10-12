// Server functions behind Social Channels and the Add Channel wizard (Batch 2A).
//
// Every read goes through the caller's RLS-scoped client, which is what proves
// workspace membership; the service role is used only after that, and always
// with the tenant the RLS read returned. No function here selects a token
// column or returns one.
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Everything the Social Channels screen renders. No token column is selected. */
export const getSocialChannels = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase;
    const [accounts, authorizations] = await Promise.all([
      sb
        .from("social_accounts")
        .select(
          "id, platform, label, external_id, active, profile, profile_url, account_type, authorization_id, connection_state, state_reason, last_synced_at, last_validation_success_at, last_validation_attempt_at, granted_scopes, missing_scopes, legacy_manual_connection, connect_method, created_at",
        )
        .order("created_at", { ascending: true }),
      sb
        .from("social_authorizations")
        .select(
          "id, provider, platform, provider_email_hint, requested_scopes, granted_scopes, authorization_state, expires_at, last_refreshed_at, created_at",
        ),
    ]);
    if (accounts.error) throw accounts.error;
    if (authorizations.error) throw authorizations.error;
    return { accounts: accounts.data ?? [], authorizations: authorizations.data ?? [] };
  });

/**
 * The channels one sign-in can reach, for the picker. Public metadata only --
 * the list was captured on the server at the callback.
 */
export const getAuthorizationDiscovery = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ authorizationId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: auth, error } = await context.supabase
      .from("social_authorizations")
      .select(
        "id, platform, provider_email_hint, requested_scopes, granted_scopes, discovered_assets, discovered_at, authorization_state",
      )
      .eq("id", data.authorizationId)
      .maybeSingle();
    if (error || !auth) throw new Error("That sign-in was not found in this workspace.");

    const { DISCOVERY_TTL_MS } = await import("@/lib/social-authorizations.server");
    const { maskIdentifier } = await import("@/lib/social-channel-capabilities");
    type Candidate = import("@/lib/social-authorizations.server").DiscoveredChannel;
    const candidates = (auth.discovered_assets ?? []) as unknown as Candidate[];

    const ids = candidates.map((c) => c.externalId);
    const { data: existing } = ids.length
      ? await context.supabase
          .from("social_accounts")
          .select("id, platform, external_id, active")
          .in("external_id", ids)
      : {
          data: [] as Array<{ id: string; platform: string; external_id: string | null; active: boolean }>,
        };

    const expired =
      !auth.discovered_at || Date.now() - new Date(auth.discovered_at).getTime() > DISCOVERY_TTL_MS;

    return {
      authorization: {
        id: auth.id,
        platform: auth.platform,
        signedInAs: auth.provider_email_hint,
        grantedScopes: auth.granted_scopes,
        requestedScopes: auth.requested_scopes,
        active: auth.authorization_state === "active",
        expired,
      },
      channels: candidates.map((c) => {
        // Matched on platform AND id: one Meta sign-in lists both Facebook
        // Pages and Instagram accounts.
        const match = (existing ?? []).find(
          (e) => e.external_id === c.externalId && e.platform === c.platform,
        );
        return {
          ...c,
          maskedId: maskIdentifier(c.externalId),
          alreadyConnected: Boolean(match?.active),
          existingAccountId: match?.id ?? null,
        };
      }),
    };
  });

/**
 * Connects the chosen channels. Only ids are accepted from the browser; the
 * server resolves them against its own discovery list.
 */
export const connectChannels = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        authorizationId: z.string().uuid(),
        externalIds: z.array(z.string().min(1).max(200)).min(1).max(50),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    // Membership: the authorization must be visible through RLS.
    const { data: visible } = await context.supabase
      .from("social_authorizations")
      .select("id, tenant_id")
      .eq("id", data.authorizationId)
      .maybeSingle();
    if (!visible) throw new Error("That sign-in was not found in this workspace.");

    const { connectDiscoveredChannels, readTokensForAccount } = await import(
      "@/lib/social-authorizations.server"
    );
    const result = await connectDiscoveredChannels({
      tenantId: visible.tenant_id,
      userId: context.userId,
      authorizationId: visible.id,
      externalIds: data.externalIds,
    });

    // First sync, so the channel shows videos and statistics straight away.
    // Best-effort: a sync failure never undoes a connection.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { syncSocialAccount } = await import("@/lib/social.server");
    for (const c of result.connected) {
      try {
        const { data: row } = await supabaseAdmin
          .from("social_accounts")
          .select(
            "id, tenant_id, platform, external_id, connect_method, authorization_id, granted_scopes",
          )
          .eq("id", c.accountId)
          .eq("tenant_id", visible.tenant_id)
          .single();
        if (!row) continue;
        const tokens = await readTokensForAccount(row);
        await syncSocialAccount({
          id: row.id,
          tenant_id: row.tenant_id,
          platform: row.platform as never,
          external_id: row.external_id,
          access_token: tokens.access,
          connect_method: row.connect_method,
          granted_scopes: row.granted_scopes,
        });
      } catch {
        /* the channel is connected; the next scheduled sync will retry */
      }
    }
    return { connected: result.connected.map((c) => ({ accountId: c.accountId, rebound: c.rebound })) };
  });
