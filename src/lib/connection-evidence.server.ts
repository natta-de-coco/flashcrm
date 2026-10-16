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

/* eslint-disable @typescript-eslint/no-explicit-any */
type UntypedClient = SupabaseClient<any, "public", any>;
/* eslint-enable @typescript-eslint/no-explicit-any */
const untyped = (): UntypedClient => supabaseAdmin as unknown as UntypedClient;

type DbError =
  { code?: string; message?: string; details?: string; hint?: string } | null | undefined;

/**
 * True when a database error says one of the two evidence columns does not exist.
 * PostgREST answers PGRST204 ("Could not find the 'x' column ... in the schema cache") to a write
 * and Postgres 42703 ("column ... does not exist") to a read. A different error that merely
 * mentions another column is NOT this: only a missing evidence column may be tolerated.
 */
export function isMissingEvidenceColumn(error: DbError): boolean {
  if (!error) return false;
  const text = [error.message, error.details, error.hint].filter(Boolean).join(" ");
  if (!EVIDENCE_COLUMNS.some((column) => text.includes(column))) return false;
  return (
    error.code === "PGRST204" || error.code === "42703" || /does not exist|schema cache/i.test(text)
  );
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
  state: "ok" | "unavailable";
  connection_state: string | null;
  last_validation_success_at: string | null;
  last_validation_attempt_at: string | null;
  last_error_at: string | null;
  next_retry_at: string | null;
};

export function evidenceFor(read: EvidenceRead, accountId: string): EvidenceForStatus {
  const found = read.byId.get(accountId);
  return {
    state: read.available ? "ok" : "unavailable",
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
  | { ok: false; kind: "database_error" | "no_row"; message: string };

/**
 * The one write that stores the result of a check. It is checked three ways: the database must
 * not return an error, exactly one row must come back, and (for a refresh) the stored tokens must
 * still be the ones the check started from. Anything else is a failure the caller reports; a
 * failed or empty write never reads as "saved".
 *
 * `evidence` says what to record about the check itself. When the evidence columns do not exist
 * the write is repeated once without them and the result says "unavailable".
 */
export async function writeCheck(args: {
  accountId: string;
  tenantId: string;
  patch: Record<string, unknown>;
  evidence: { attemptAt: string; successAt: string | null };
  /** Raw stored token columns read at the start; the write only lands if both are unchanged. */
  guard?: { access_token: string | null; refresh_token: string | null } | undefined;
  returning: string;
}): Promise<CheckWrite> {
  const attempt = async (withEvidence: boolean) => {
    const patch: Record<string, unknown> = { ...args.patch };
    if (withEvidence) {
      patch["last_validation_attempt_at"] = args.evidence.attemptAt;
      if (args.evidence.successAt) patch["last_validation_success_at"] = args.evidence.successAt;
    }
    let query = untyped()
      .from("social_accounts")
      .update(patch)
      .eq("id", args.accountId)
      .eq("tenant_id", args.tenantId);
    if (args.guard) {
      query =
        args.guard.access_token === null
          ? query.is("access_token", null)
          : query.eq("access_token", args.guard.access_token);
      query =
        args.guard.refresh_token === null
          ? query.is("refresh_token", null)
          : query.eq("refresh_token", args.guard.refresh_token);
    }
    return await query.select(args.returning);
  };

  let evidence: "ok" | "unavailable" = "ok";
  let result;
  try {
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
    return {
      ok: false,
      kind: "no_row",
      message:
        rows.length === 0
          ? "The write matched no account (it may have changed while the check ran)."
          : "The write matched more than one account.",
    };
  }
  return { ok: true, row: rows[0] as unknown as Record<string, unknown>, evidence };
}
