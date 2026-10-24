// Server-only: where the proof that a connection was really checked against its platform is
// stored and read.
//
// Two timestamps on social_accounts carry that proof:
//   last_validation_attempt_at  a live check was tried (whatever the answer)
//   last_validation_success_at  the platform accepted the token and every permission was granted
// They come from 20261015120000_social_account_validation_evidence.sql. The generated database
// types do not list them (they are generated from the live database, which may not have them
// yet), so this module is the only place that names them, through an untyped client.
//
// The code has to work before that SQL is applied and after it:
//   * a read or write that fails because the columns do not exist is recognised
//     (isMissingEvidenceColumn) and reported as "evidence unavailable";
//   * "evidence unavailable" is never green. Nothing here ever invents a timestamp.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { redactSecrets } from "@/lib/integration-errors.server";
import type { SupabaseClient } from "@supabase/supabase-js";

export const EVIDENCE_COLUMNS = [
  "last_validation_attempt_at",
  "last_validation_success_at",
] as const;

/** Written on every reconnect: a new token has not been checked by anyone yet. */
export const EVIDENCE_RESET = {
  last_validation_attempt_at: null,
  last_validation_success_at: null,
} as const;

/**
 * Runs the write of a (re)connected account together with the reset of what its old token proved,
 * and repeats it without the reset where the evidence columns do not exist (there is nothing to
 * clear). `run` receives the columns to lay over its own values. This module and nothing else names
 * them: a test keeps every other file from setting either column.
 */
export async function withEvidenceReset<T extends { error: DbError }>(
  run: (reset: typeof EVIDENCE_RESET | Record<string, never>) => PromiseLike<T>,
): Promise<T> {
  const first = await run(EVIDENCE_RESET);
  if (first.error && isMissingEvidenceColumn(first.error)) return await run({});
  return first;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type UntypedClient = SupabaseClient<any, "public", any>;
/* eslint-enable @typescript-eslint/no-explicit-any */
const untyped = (): UntypedClient => supabaseAdmin as unknown as UntypedClient;

type DbError =
  { code?: string; message?: string; details?: string; hint?: string } | null | undefined;

/**
 * True when a database error says one of these named columns does not exist.
 * PostgREST answers PGRST204 ("Could not find the 'x' column ... in the schema cache") to a write
 * and Postgres 42703 ("column ... does not exist") to a read. A different error that merely
 * mentions another column is NOT this: only a missing column that was named may be tolerated.
 */
export function isMissingColumnError(error: DbError, columns: readonly string[]): boolean {
  if (!error) return false;
  const text = [error.message, error.details, error.hint].filter(Boolean).join(" ");
  if (!columns.some((column) => text.includes(column))) return false;
  return (
    error.code === "PGRST204" || error.code === "42703" || /does not exist|schema cache/i.test(text)
  );
}

/** True when a database error says one of the two evidence columns does not exist. */
export function isMissingEvidenceColumn(error: DbError): boolean {
  return isMissingColumnError(error, EVIDENCE_COLUMNS);
}

export type EvidenceRow = {
  id: string;
  connection_state: string | null;
  last_validation_success_at: string | null;
  last_validation_attempt_at: string | null;
  last_error_at: string | null;
  next_retry_at: string | null;
};

export type EvidenceRead = {
  /** True only when the evidence columns were read. */
  available: boolean;
  /** Why not: the columns are missing, or the database refused the read. */
  failure: "missing_column" | "error" | null;
  byId: Map<string, EvidenceRow>;
};

const BASE_COLUMNS = "id, connection_state, last_error_at, next_retry_at";
const FULL_COLUMNS = `${BASE_COLUMNS}, ${EVIDENCE_COLUMNS.join(", ")}`;

function toRows(data: unknown, withEvidence: boolean): Map<string, EvidenceRow> {
  const byId = new Map<string, EvidenceRow>();
  for (const raw of (Array.isArray(data) ? data : []) as Partial<EvidenceRow>[]) {
    const id = String(raw.id);
    byId.set(id, {
      id,
      connection_state: raw.connection_state ?? null,
      last_error_at: raw.last_error_at ?? null,
      next_retry_at: raw.next_retry_at ?? null,
      last_validation_attempt_at: withEvidence ? (raw.last_validation_attempt_at ?? null) : null,
      last_validation_success_at: withEvidence ? (raw.last_validation_success_at ?? null) : null,
    });
  }
  return byId;
}

/**
 * Reads the evidence for one workspace (or one account of it). Never throws: when the columns are
 * missing, or the database cannot answer, the result says "unavailable" and carries what could
 * still be read, so a screen can show an honest "cannot verify" instead of failing or guessing.
 */
export async function readEvidence(tenantId: string, accountId?: string): Promise<EvidenceRead> {
  const run = async (columns: string) => {
    let query = untyped().from("social_accounts").select(columns).eq("tenant_id", tenantId);
    if (accountId) query = query.eq("id", accountId);
    return await query;
  };
  try {
    const full = await run(FULL_COLUMNS);
    if (!full.error) return { available: true, failure: null, byId: toRows(full.data, true) };
    if (isMissingEvidenceColumn(full.error)) {
      const base = await run(BASE_COLUMNS);
      if (!base.error) {
        return { available: false, failure: "missing_column", byId: toRows(base.data, false) };
      }
    }
  } catch {
    /* fall through: a read that throws is the same as one that fails */
  }
  return { available: false, failure: "error", byId: new Map() };
}

/** The evidence of one account, in the shape statusInputFromRow() (connection-status.ts) takes. */
export type EvidenceForStatus = {
  state: "ok" | "unavailable" | "unreadable";
  connection_state: string | null;
  last_validation_success_at: string | null;
  last_validation_attempt_at: string | null;
  last_error_at: string | null;
  next_retry_at: string | null;
};

export function evidenceFor(read: EvidenceRead, accountId: string): EvidenceForStatus {
  const found = read.byId.get(accountId);
  return {
    // A read that failed is not the same as columns that do not exist: one is a finished update
    // to ask for, the other a moment to wait.
    state: read.available ? "ok" : read.failure === "error" ? "unreadable" : "unavailable",
    connection_state: found?.connection_state ?? null,
    last_validation_success_at: read.available ? (found?.last_validation_success_at ?? null) : null,
    last_validation_attempt_at: read.available ? (found?.last_validation_attempt_at ?? null) : null,
    last_error_at: found?.last_error_at ?? null,
    next_retry_at: found?.next_retry_at ?? null,
  };
}

/**
 * A reference for one check. The full id is kept in the retry log; people read and quote the
 * first eight characters. It is random: it holds no workspace, account or provider text.
 */
export function newCheckId(): { id: string; reference: string } {
  const id = globalThis.crypto.randomUUID();
  return { id, reference: id.slice(0, 8) };
}

/**
 * Provider text made safe to store and to show. Anything token-shaped goes through
 * redactSecrets(), and every secret this call actually held is removed by value as well, because a
 * provider that echoes a token back does not always do it in a shape a pattern recognises.
 */
export function safeText(
  input: unknown,
  known: ReadonlyArray<string | null | undefined> = [],
  max = 500,
): string {
  let text = input == null ? "" : String(input);
  for (const secret of known) {
    if (secret && secret.length >= 8) text = text.split(secret).join("[redacted]");
  }
  // eslint-disable-next-line no-control-regex
  text = text.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return (redactSecrets(text) ?? "").slice(0, max);
}

/**
 * Provider or system text for people who are not Flas staff. Text that names a permission, an
 * app credential, a callback or another provider-console detail is withheld (null): those are
 * shown only in the staff diagnostics. Whatever is left has already been through safeText().
 */
export function plainOrNull(input: unknown, scopes: readonly string[] = []): string | null {
  const text = safeText(input);
  if (!text) return null;
  const technical =
    scopes.some((scope) => scope.length >= 4 && text.includes(scope)) ||
    /\b(app[ _-]?(id|secret)|client[ _-]?(id|secret)|redirect[ _-]?uri|callback|credentials?|developer (portal|console)|scopes?)\b/i.test(
      text,
    );
  return technical ? null : text;
}

export type CheckWrite =
  | { ok: true; row: Record<string, unknown>; evidence: "ok" | "unavailable" }
  | {
      ok: false;
      /**
       * database_error: the database refused or did not answer.
       * no_row: nothing matched -- the account is no longer what the check started from (a person
       *         disconnected or reconnected it meanwhile, or it is gone). Nothing was written.
       * several_rows: more than one account matched, which a single id never does.
       */
      kind: "database_error" | "no_row" | "several_rows";
      message: string;
    };

/**
 * What an account looked like when a check began. The write only lands on an account that still
 * looks like this: a person who disconnects, revokes or reconnects it while the platform is being
 * asked is not overwritten by an answer that was about the account as it used to be.
 *
 * The credentials are carried as a fingerprint (credentialsOf), never as values: a stored token
 * must not become part of a database request address, which is what a filter on it would do.
 */
export type CheckStart = {
  active: boolean;
  /** Left out (undefined) when the write is not about the state, only about keeping a new token. */
  connection_state?: string | null | undefined;
  /** The fingerprint of the stored credentials the check used (readCredentials). */
  credentials: string;
  /**
   * The sign-in the channel belongs to: an id, not a secret, so the write itself can match it.
   * undefined where the column does not exist.
   */
  authorizationId?: string | null | undefined;
};

/**
 * Where an account keeps its credentials. A reconnect writes some or all of these (the old way
 * replaces access_token; the channel picker writes the encrypted columns and a new sign-in), so all
 * of them are part of the fingerprint. Their values never leave the server.
 */
const TOKEN_COLUMNS = ["access_token", "refresh_token"] as const;
/** Written by the channel-picker migrations; a database may not have them yet. */
export const CHANNEL_COLUMNS = [
  "authorization_id",
  "access_token_enc",
  "refresh_token_enc",
] as const;

export type CredentialsRead =
  | {
      kind: "ok";
      access_token: string | null;
      refresh_token: string | null;
      token_expires_at: string | null;
      /** The sign-in this account belongs to. undefined where the column does not exist. */
      authorization_id: string | null | undefined;
      /** SHA-256 of every stored credential, as stored. Safe to compare, keep and log. */
      fingerprint: string;
    }
  /** The account is not there (any more) for this workspace. */
  | { kind: "gone" }
  /** The database could not say. Never to be read as "unchanged". */
  | { kind: "error" };

async function fingerprintOf(parts: ReadonlyArray<string | null>): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(parts));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Reads what an account stores as credentials, once, and fingerprints it. The comparison of "is it
 * still the credentials the check used" is made here, in memory, on a fresh read -- not by asking
 * the database to match a token in a filter, which would write the token into the request address.
 * Where the channel columns do not exist the account has no such credentials.
 */
export async function readCredentials(
  tenantId: string,
  accountId: string,
): Promise<CredentialsRead> {
  const read = async (columns: readonly string[]) =>
    await untyped()
      .from("social_accounts")
      .select([...columns, "token_expires_at"].join(", "))
      .eq("id", accountId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
  try {
    let result = await read([...TOKEN_COLUMNS, ...CHANNEL_COLUMNS]);
    if (result.error && isMissingColumnError(result.error, CHANNEL_COLUMNS)) {
      result = await read(TOKEN_COLUMNS);
    }
    if (result.error) return { kind: "error" };
    if (!result.data) return { kind: "gone" };
    const row = result.data as unknown as Record<string, string | null | undefined>;
    return {
      kind: "ok",
      access_token: row["access_token"] ?? null,
      refresh_token: row["refresh_token"] ?? null,
      token_expires_at: row["token_expires_at"] ?? null,
      authorization_id: "authorization_id" in row ? (row["authorization_id"] ?? null) : undefined,
      fingerprint: await fingerprintOf(
        [...TOKEN_COLUMNS, ...CHANNEL_COLUMNS].map((column) => row[column] ?? null),
      ),
    };
  } catch {
    return { kind: "error" };
  }
}

type Matchable<Q> = {
  is(column: string, value: null): Q;
  eq(column: string, value: string | boolean): Q;
};

/** `column = value`, or `column IS NULL` -- an equality test on a null never matches in SQL. */
function equalsOrNull<Q extends Matchable<Q>>(
  query: Q,
  column: string,
  value: string | boolean | null,
): Q {
  return value === null ? query.is(column, null) : query.eq(column, value);
}

/**
 * The one write that stores the result of a check. It is checked three ways: the database must
 * not return an error, exactly one row must come back, and the account must still be what the
 * check started from (`unchangedSince`). Anything else is a failure the caller reports; a failed or
 * empty write never reads as "saved".
 *
 * "Still what the check started from" is judged in two places, neither of which names a credential
 * in the request address: the credentials are read again just before the write and their
 * fingerprint compared in memory, and the write itself only matches an account that is still on or
 * off and still in the same state.
 *
 * `evidence` says what to record about the check itself. When the evidence columns do not exist
 * the write is repeated once without them and the result says "unavailable".
 */
export async function writeCheck(args: {
  accountId: string;
  tenantId: string;
  patch: Record<string, unknown>;
  /** Laid over `patch` when the evidence columns turn out not to exist and the write is repeated. */
  fallbackPatch?: Record<string, unknown> | undefined;
  /**
   * What to record about the check itself; null records nothing (a write of tokens alone).
   * `successAt` stamps the proof; `withdrawProof` (a refusal) clears the earlier one; with neither,
   * the earlier proof is left exactly as it was.
   */
  evidence: { attemptAt: string; successAt: string | null; withdrawProof?: boolean } | null;
  /** The account as the check found it; the write lands only if it still looks exactly so. */
  unchangedSince: CheckStart;
  returning: string;
}): Promise<CheckWrite> {
  const attempt = async (wantEvidence: boolean) => {
    const recording = wantEvidence && args.evidence !== null;
    const withEvidence = recording;
    const patch: Record<string, unknown> = {
      ...args.patch,
      ...(wantEvidence ? {} : (args.fallbackPatch ?? {})),
    };
    if (recording && args.evidence) {
      patch["last_validation_attempt_at"] = args.evidence.attemptAt;
      if (args.evidence.successAt) patch["last_validation_success_at"] = args.evidence.successAt;
      else if (args.evidence.withdrawProof) patch["last_validation_success_at"] = null;
    }
    const start = args.unchangedSince;
    let query = untyped()
      .from("social_accounts")
      .update(patch)
      .eq("id", args.accountId)
      .eq("tenant_id", args.tenantId);
    query = equalsOrNull(query, "active", start.active);
    if (start.connection_state !== undefined) {
      query = equalsOrNull(query, "connection_state", start.connection_state);
    }
    // The sign-in is an id, not a secret: the database itself refuses a write onto a channel that
    // was moved to another sign-in after the credentials were last looked at.
    if (start.authorizationId !== undefined) {
      query = equalsOrNull(query, "authorization_id", start.authorizationId);
    }
    // The evidence columns are only asked for back when they are part of this attempt.
    return await query.select(
      withEvidence ? `${args.returning}, ${EVIDENCE_COLUMNS.join(", ")}` : args.returning,
    );
  };

  let evidence: "ok" | "unavailable" = args.evidence === null ? "unavailable" : "ok";
  let result;
  try {
    const now = await readCredentials(args.tenantId, args.accountId);
    if (now.kind === "error") {
      return {
        ok: false,
        kind: "database_error",
        message: "The account's stored credentials could not be read, so nothing was written.",
      };
    }
    if (now.kind === "gone" || now.fingerprint !== args.unchangedSince.credentials) {
      return {
        ok: false,
        kind: "no_row",
        message: "The account changed while the check ran, so nothing was written.",
      };
    }
    result = await attempt(true);
    if (result.error && isMissingEvidenceColumn(result.error)) {
      evidence = "unavailable";
      result = await attempt(false);
    }
  } catch (thrown) {
    return {
      ok: false,
      kind: "database_error",
      message: thrown instanceof Error ? thrown.message : "The database did not answer.",
    };
  }
  if (result.error) {
    return { ok: false, kind: "database_error", message: result.error.message ?? "Write refused." };
  }
  const rows = Array.isArray(result.data) ? result.data : [];
  if (rows.length !== 1) {
    return rows.length === 0
      ? {
          ok: false,
          kind: "no_row",
          message: "The account changed while the check ran, so nothing was written.",
        }
      : { ok: false, kind: "several_rows", message: "The write matched more than one account." };
  }
  return { ok: true, row: rows[0] as unknown as Record<string, unknown>, evidence };
}
