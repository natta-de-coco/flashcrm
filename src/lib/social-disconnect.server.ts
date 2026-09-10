/**
 * Disconnecting a social account (Batch 1, Phase 18).
 *
 * The order is the point:
 *   1. the caller has already proven workspace membership (RLS read)
 *   2. the account is re-read with an explicit tenant filter
 *   3. provider-side revoke is attempted where Flas supports it
 *   4. the result is recorded as a fixed code, never provider text
 *   5-7. every token column and the refresh lease are cleared
 *   8-9. the account goes inactive and moves to `disconnected`
 *   10. posts, comments and analytics are kept -- nothing is deleted
 *   11. the operation is audited
 *
 * A provider that cannot be reached does not block a local disconnect: the
 * tokens are removed either way and `provider_revoke_failed` is recorded. What
 * must never happen is a disconnect that leaves a usable token behind.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { connector } from "@/lib/connections-catalog";
import {
  CLEARED_TOKEN_COLUMNS,
  TOKEN_READ_COLUMNS,
  readStoredTokens,
} from "@/lib/social-token-store.server";

export type RevokeResult = "revoked" | "not_supported" | "no_token" | "provider_revoke_failed";

/**
 * Asks the provider to invalidate the grant. Only Meta and Google are wired;
 * every other provider reports `not_supported` rather than pretending.
 */
export async function revokeAtProvider(
  provider: string | undefined,
  token: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<RevokeResult> {
  if (!token) return "no_token";
  try {
    if (provider === "meta") {
      const res = await fetchImpl("https://graph.facebook.com/v21.0/me/permissions", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.ok ? "revoked" : "provider_revoke_failed";
    }
    if (provider === "google") {
      const res = await fetchImpl("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
      });
      return res.ok ? "revoked" : "provider_revoke_failed";
    }
    return "not_supported";
  } catch {
    return "provider_revoke_failed";
  }
}

export type DisconnectResult =
  | { ok: true; providerRevoke: RevokeResult }
  | { ok: false; reason: "not_found" | "lookup_failed" | "clear_failed" };

export async function disconnectSocialAccount(args: {
  accountId: string;
  tenantId: string;
  actorId: string | null;
  fetchImpl?: typeof fetch;
}): Promise<DisconnectResult> {
  const { data: row, error } = await supabaseAdmin
    .from("social_accounts")
    .select(`id, tenant_id, platform, ${TOKEN_READ_COLUMNS}`)
    .eq("id", args.accountId)
    .eq("tenant_id", args.tenantId)
    .maybeSingle();
  if (error) return { ok: false, reason: "lookup_failed" };
  if (!row) return { ok: false, reason: "not_found" };

  // A token that no longer decrypts is still removed below; it just cannot be
  // revoked at the provider first.
  let token: string | null = null;
  try {
    token = (await readStoredTokens(row)).access;
  } catch {
    token = null;
  }
  const providerRevoke = await revokeAtProvider(
    connector(row.platform)?.provider,
    token,
    args.fetchImpl,
  );

  const { error: clearError } = await supabaseAdmin
    .from("social_accounts")
    .update({
      ...CLEARED_TOKEN_COLUMNS,
      refresh_lease_id: null,
      refresh_leased_until: null,
      active: false,
      health: "disconnected",
      next_retry_at: null,
    })
    .eq("id", row.id)
    .eq("tenant_id", args.tenantId);
  if (clearError) return { ok: false, reason: "clear_failed" };

  const { transitionConnection } = await import("@/lib/connection-state.server");
  await transitionConnection({
    accountId: row.id,
    tenantId: args.tenantId,
    to: "disconnected",
    reason: "disconnected_by_user",
    actorId: args.actorId,
  });

  const { logAudit } = await import("@/lib/audit.server");
  await logAudit({
    action: "connection.disconnected",
    tenantId: args.tenantId,
    actorId: args.actorId,
    entityType: "social_account",
    entityId: row.id,
    details: { platform: row.platform, provider_revoke: providerRevoke },
  });
  if (providerRevoke === "provider_revoke_failed") {
    await logAudit({
      action: "connection.provider_revoke_failed",
      tenantId: args.tenantId,
      actorId: args.actorId,
      entityType: "social_account",
      entityId: row.id,
      details: { platform: row.platform },
    });
  }
  return { ok: true, providerRevoke };
}
