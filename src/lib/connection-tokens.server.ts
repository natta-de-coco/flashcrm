// Server-only: finds the token an account really holds when it is not in `access_token`.
//
// Accounts connected the old way keep their token in access_token, sealed with the secret box. An
// account connected through the channel picker keeps it encrypted instead: on the account itself
// (a Facebook Page's own token) or on the sign-in it belongs to (a Google or LinkedIn token shared by
// its channels), and leaves access_token empty. An empty access_token is therefore NOT the same
// thing as "disconnected on purpose": a health check has to look where sync looks
// (readTokensForAccount) before it says so.
//
// Those columns come from the channel-picker migrations and may not exist in a given database, so
// they are read on their own, through an untyped client, and a missing column means "this account
// has no such token".
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { CHANNEL_COLUMNS, isMissingColumnError } from "@/lib/connection-evidence.server";
import type { SupabaseClient } from "@supabase/supabase-js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type UntypedClient = SupabaseClient<any, "public", any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export type ChannelTokens =
  /** No such token: the columns do not exist, the account has none, or its sign-in was disconnected. */
  | { kind: "none" }
  /** Could not find out. Never to be read as "none". */
  | { kind: "error"; stage: "load" | "credentials" }
  | {
      kind: "found";
      access: string;
      refresh: string | null;
      /** The sign-in this token belongs to, when it is the sign-in's (renewed through the sign-in). */
      authorizationId: string | null;
      source: "account" | "authorization";
    };

export async function readChannelTokens(account: {
  id: string;
  tenant_id: string;
  platform: string;
}): Promise<ChannelTokens> {
  let row: {
    authorization_id?: string | null;
    access_token_enc?: string | null;
    refresh_token_enc?: string | null;
  } | null;
  try {
    const { data, error } = await (supabaseAdmin as unknown as UntypedClient)
      .from("social_accounts")
      .select(CHANNEL_COLUMNS.join(", "))
      .eq("id", account.id)
      .eq("tenant_id", account.tenant_id)
      .maybeSingle();
    if (error)
      return isMissingColumnError(error, CHANNEL_COLUMNS)
        ? { kind: "none" }
        : { kind: "error", stage: "load" };
    row = data as typeof row;
  } catch {
    return { kind: "error", stage: "load" };
  }
  if (!row || !(row.authorization_id || row.access_token_enc || row.refresh_token_enc)) {
    return { kind: "none" };
  }

  try {
    const { readTokensForAccount } = await import("@/lib/social-authorizations.server");
    const tokens = await readTokensForAccount({
      tenant_id: account.tenant_id,
      platform: account.platform,
      authorization_id: row.authorization_id ?? null,
      access_token_enc: row.access_token_enc ?? null,
      refresh_token_enc: row.refresh_token_enc ?? null,
      access_token: null,
      refresh_token: null,
    });
    if (!tokens.access) return { kind: "none" };
    const own = tokens.source !== "authorization";
    return {
      kind: "found",
      access: tokens.access,
      refresh: tokens.refresh,
      authorizationId: own ? null : (row.authorization_id ?? null),
      source: own ? "account" : "authorization",
    };
  } catch {
    // A stored token that cannot be decrypted (a missing or rotated key): the check stops without
    // writing, exactly as it does for a sealed token it cannot open.
    return { kind: "error", stage: "credentials" };
  }
}

/**
 * The accounts of a workspace that are switched on, hold nothing in access_token and keep a sign-in
 * or an encrypted token somewhere else (any of the channel columns is set). An account that is on
 * but holds nothing anywhere has nothing to check and is not listed. A channel column that does not
 * exist in this database contributes no accounts; a read that fails for any other reason is an
 * error, never an empty list.
 */
export async function readChannelModelAccounts(
  tenantId: string,
  columns: string,
): Promise<{ rows: Record<string, unknown>[]; failed: boolean }> {
  const client = supabaseAdmin as unknown as UntypedClient;
  const answers = await Promise.all(
    CHANNEL_COLUMNS.map(
      async (column) =>
        await client
          .from("social_accounts")
          .select(columns)
          .eq("tenant_id", tenantId)
          .is("access_token", null)
          .eq("active", true)
          .not(column, "is", null),
    ),
  );
  const byId = new Map<string, Record<string, unknown>>();
  for (const [index, answer] of answers.entries()) {
    if (answer.error) {
      if (isMissingColumnError(answer.error, [CHANNEL_COLUMNS[index] as string])) continue;
      return { rows: [], failed: true };
    }
    for (const row of (answer.data ?? []) as unknown as Record<string, unknown>[]) {
      byId.set(String(row["id"]), row);
    }
  }
  return { rows: [...byId.values()], failed: false };
}
