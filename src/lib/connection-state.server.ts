/**
 * The only sanctioned way to move a connection between states.
 *
 * Every transition goes through `transitionConnection()`, which validates the
 * edge, writes the new state with its reason, and records
 * `connection.state_changed` in the audit log. Nothing else in the codebase may
 * write `connection_state` directly — the database trigger from
 * 20260908100000 will reject an illegal edge regardless, but the useful error
 * message and the audit trail come from here.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  type AttemptState,
  type ConnectionState,
  effectiveAttemptState,
  isLegalTransition,
  missingScopesFor,
} from "@/lib/connection-state";

export type TransitionResult =
  | { ok: true; from: ConnectionState; to: ConnectionState; changed: boolean }
  | { ok: false; reason: string };

/**
 * Moves one connection to a new state.
 *
 * Returns rather than throws for an illegal edge. A caller reacting to a
 * provider response should not crash a webhook or a sync because the state it
 * inferred was not reachable — it should record that it tried. Genuine
 * programming errors still surface, because the database trigger raises.
 */
export async function transitionConnection(args: {
  accountId: string;
  tenantId: string;
  to: ConnectionState;
  reason: string;
  actorId?: string | null;
}): Promise<TransitionResult> {
  const { data: current, error: readError } = await supabaseAdmin
    .from("social_accounts")
    .select("id, tenant_id, platform, connection_state")
    .eq("id", args.accountId)
    .eq("tenant_id", args.tenantId)
    .maybeSingle();

  if (readError) return { ok: false, reason: readError.message };
  if (!current) return { ok: false, reason: "Connection not found in this workspace" };

  const from = current.connection_state as ConnectionState;

  if (from === args.to) {
    // Not an error, and not worth an audit row. Re-asserting the same state is
    // how a successful refresh that changed nothing else reports a heartbeat.
    return { ok: true, from, to: args.to, changed: false };
  }

  if (!isLegalTransition(from, args.to)) {
    return {
      ok: false,
      reason: `Cannot move a ${current.platform} connection from "${from}" to "${args.to}".`,
    };
  }

  const { error: writeError } = await supabaseAdmin
    .from("social_accounts")
    .update({
      connection_state: args.to,
      state_reason: args.reason.slice(0, 500),
      // state_changed_at is stamped by the trigger, so it cannot be forgotten
      // or backdated by a caller.
    })
    .eq("id", args.accountId)
    .eq("tenant_id", args.tenantId);

  if (writeError) return { ok: false, reason: writeError.message };

  try {
    const { logAudit } = await import("@/lib/audit.server");
    await logAudit({
      action: "connection.state_changed",
      tenantId: args.tenantId,
      actorId: args.actorId ?? null,
      entityType: "social_account",
      entityId: args.accountId,
      details: { platform: current.platform, from, to: args.to, reason: args.reason },
    });
  } catch (e) {
    // The state change is already committed. Losing its audit row is worth a
    // log line, not a rollback that would leave the row and reality disagreeing.
    console.error("[connection-state] transition audit failed", e);
  }

  return { ok: true, from, to: args.to, changed: true };
}

/**
 * Which state a connection should be in, given what we know about it.
 *
 * Replaces computeHealth(), which returned one of three values and collapsed
 * six different situations into "disconnected". Ordered most specific first,
 * so a row lands in the narrowest state that is true of it.
 *
 * `scope_incomplete` is computed from `granted_scopes` — the real scopes the
 * provider returned — against the connector registry. The previous check read
 * `permissions`, which is written as the JSON object `{ granted: [...] }` while
 * being typed as an array, so `permissions.length > 0` was never true and that
 * branch had never once executed.
 */
export function deriveConnectionState(row: {
  active: boolean;
  access_token: string | null;
  token_expires_at: string | null;
  granted_scopes: string[] | null;
  platform: string;
}): { state: ConnectionState; reason: string } {
  if (!row.active) {
    return { state: "disconnected", reason: "Disconnected in this workspace" };
  }
  if (!row.access_token) {
    return { state: "ready_to_authorize", reason: "No access token stored" };
  }

  const expiresAt = row.token_expires_at ? new Date(row.token_expires_at).getTime() : null;
  const REFRESH_WINDOW_MS = 72 * 60 * 60 * 1000;
  if (expiresAt !== null && expiresAt - Date.now() < REFRESH_WINDOW_MS) {
    return {
      state: "token_expiring",
      reason:
        expiresAt < Date.now()
          ? "The access token has expired"
          : "The access token expires within 72 hours",
    };
  }

  const missing = missingScopesFor(row.platform, row.granted_scopes ?? []);
  if (missing.length > 0) {
    return {
      state: "scope_incomplete",
      reason: `Not granted: ${missing.join(", ")}`,
    };
  }

  return { state: "connected", reason: "Authorized and in date" };
}


/**
 * Retires authorization attempts nobody ever finished.
 *
 * Reading is already correct without this — `effectiveAttemptState()` derives
 * `expired` from `expires_at` — so this is housekeeping plus a definite audit
 * event, not the mechanism correctness depends on. That distinction matters:
 * the previous sweep function was never wired to anything and ran zero times.
 */
export async function sweepAbandonedAttempts(): Promise<{
  expired: number;
  deleted: number;
}> {
  // Record what is about to be retired, so the audit log gains a terminal
  // event for attempts whose callback never arrived.
  const { data: stale } = await supabaseAdmin
    .from("oauth_states")
    .select("id, tenant_id, user_id, platform, expires_at, used_at, attempt_state")
    .eq("attempt_state", "started")
    .is("used_at", null)
    .lt("expires_at", new Date().toISOString())
    .limit(500);

  if (stale?.length) {
    const { logAudit } = await import("@/lib/audit.server");
    for (const row of stale) {
      try {
        await logAudit({
          action: "connection.authorize_abandoned",
          tenantId: row.tenant_id,
          actorId: row.user_id,
          entityType: "platform",
          entityId: row.platform,
          details: {
            reason: "The consent screen was never completed before the request expired",
            startedAt: row.expires_at,
          },
        });
      } catch {
        /* keep sweeping; one missing audit row must not stall the rest */
      }
    }
  }

  const { data, error } = await supabaseAdmin.rpc("expire_abandoned_oauth_attempts");
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;
  return {
    expired: Number((result as { expired_count?: number })?.expired_count ?? 0),
    deleted: Number((result as { deleted_count?: number })?.deleted_count ?? 0),
  };
}

/**
 * Records how one authorization attempt ended.
 *
 * The row survives consumption (consume_oauth_state stamps `used_at` rather
 * than deleting), so the outcome can be written against it and the sweep can
 * retire it later. Never throws: an attempt that has already been swept is not
 * an error worth failing a callback over.
 */
export async function markAttempt(
  state: string,
  attemptState: AttemptState,
  reason: string,
): Promise<void> {
  try {
    await supabaseAdmin
      .from("oauth_states")
      .update({ attempt_state: attemptState, attempt_reason: reason.slice(0, 300) })
      .eq("state", state);
  } catch (e) {
    console.error("[connection-state] could not mark attempt", e);
  }
}

/** Re-exported so server callers need only one import. */
export { effectiveAttemptState, missingScopesFor };
