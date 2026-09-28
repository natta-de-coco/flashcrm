// Turns one raw database or provider failure into a sentence a business owner
// can act on, while keeping the original text for the log.
//
// QA §5 (26 Sep): `column reference "period" is ambiguous` and
// `(#100) Tried accessing nonexisting field (analytics) on node type
// (WhatsAppBusinessPhoneNumber)` reached customers word for word. Neither tells
// the reader what happened, whether their work was saved, or what to do next.
//
// Two rules this file keeps:
//  1. The raw text is never discarded. Callers show `message` and log
//     `technical`. integration-errors.server.ts does the same job for provider
//     failures it stores, but it is server-only (it imports supabaseAdmin and
//     node:crypto), so browser code cannot use it. This module is pure and
//     runs in both places.
//  2. When the cause is not recognised we say exactly that. Guessing a cause
//     ("check your connection") sends people to fix something that is not
//     broken, which is worse than admitting we do not know.

/** What kind of failure this is — drives tone, and whether retrying can help. */
export type PlainErrorKind =
  | "flas_fault"
  | "conflict"
  | "missing_detail"
  | "stale_reference"
  | "not_allowed"
  | "timeout"
  | "unreachable"
  | "provider_unsupported"
  | "provider_auth"
  | "provider_rate_limit"
  | "unknown";

export type PlainError = {
  /** Safe to show. Never contains provider or database jargon. */
  message: string;
  /** The original text, for console/function logs and support tickets. */
  technical: string;
  kind: PlainErrorKind;
  /** False when we could not identify the cause, so the copy says so. */
  recognised: boolean;
  /** True when trying the same thing again could plausibly work. */
  retryable: boolean;
};

/**
 * Why Meta's per-number message analytics are unavailable in Flas (QA H11).
 *
 * Meta exposes `analytics` on the WhatsApp Business Account (WABA) node, not on
 * a phone number. Flas stores no WABA id anywhere — `wa_numbers` holds
 * `phone_number_id` and nothing else identifying the business account — so the
 * request can never succeed and the failure is permanent, not transient.
 */
export const META_ANALYTICS_UNAVAILABLE =
  "Meta keeps send and delivery totals on the WhatsApp Business Account, and Flas does not store that account's ID yet, so those two figures are unavailable. Your own message counts on this page are complete, and the connection itself is fine.";

/** The raw text of anything thrown, without assuming it was an Error. */
export function rawErrorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const candidate = error as { message?: unknown; error?: unknown; details?: unknown };
    if (typeof candidate.message === "string") return candidate.message;
    if (typeof candidate.error === "string") return candidate.error;
    if (typeof candidate.details === "string") return candidate.details;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

type Rule = {
  kind: PlainErrorKind;
  match: RegExp;
  retryable: boolean;
  /** Built from the raw text so a named field or column can be quoted back. */
  explain: (raw: string) => string;
};

/**
 * Only causes seen in this codebase are listed. Postgres SQLSTATEs come from
 * supabase-js errors (billing, contacts, sales); the Meta shapes come from
 * graph.facebook.com replies in meta-health and flash-ai.
 */
const RULES: Rule[] = [
  {
    // 42702. The document numbering function declared a plpgsql variable named
    // `period` beside document_sequences.period, so saving a quotation failed
    // with this text. Nothing the customer typed caused it.
    kind: "flas_fault",
    match: /is ambiguous|42702|42703|syntax error at or near|does not exist: function/i,
    retryable: false,
    explain: () =>
      "This is a fault inside Flas, not in anything you entered, and nothing was saved. The technical detail has been logged for the Flas team — please try again shortly, and tell support if it keeps failing.",
  },
  {
    // 23505
    kind: "conflict",
    // Deliberately SQL-only: a human sentence that happens to say "already
    // exists" must keep its own wording, so callers can rewrite machine text
    // without flattening messages written for this reader.
    match: /duplicate key value|violates unique constraint|23505/i,
    retryable: false,
    explain: () =>
      "A record with these details already exists, so this was not saved a second time. Change the detail that has to be unique — usually a number, code or name — and save again.",
  },
  {
    // 23502
    kind: "missing_detail",
    match: /null value in column|violates not-null constraint|23502/i,
    retryable: false,
    explain: (raw) => {
      const column = /null value in column "([^"]+)"/i.exec(raw)?.[1];
      const named = column ? ` The missing field is “${column.replace(/_/g, " ")}”.` : "";
      return `A required detail was empty, so nothing was saved.${named} Fill it in and save again.`;
    },
  },
  {
    // 23503
    kind: "stale_reference",
    match: /violates foreign key constraint|23503/i,
    retryable: false,
    explain: () =>
      "This points at a record that no longer exists — someone may have deleted it. Reload the page, choose it again and save.",
  },
  {
    // 42501 and RLS denials
    kind: "not_allowed",
    match: /permission denied|row-level security|42501|not authorized|insufficient_privilege/i,
    retryable: false,
    explain: () =>
      "Your account is not allowed to do this in this workspace. Ask a workspace administrator to do it, or to give you the permission.",
  },
  {
    // 57014 and gateway timeouts
    kind: "timeout",
    match: /statement timeout|57014|timed? ?out|ETIMEDOUT|504/i,
    retryable: true,
    explain: () =>
      "This took too long and was stopped, so nothing was saved. Try again — if it keeps timing out, save fewer items at once.",
  },
  {
    // Meta error 100 on a field the node does not have. Permanent: asking again
    // returns the same thing, so it must not be reported as a hiccup.
    kind: "provider_unsupported",
    match: /#100\)?\s*Tried accessing nonexisting field|nonexistent field|unsupported get request/i,
    retryable: false,
    explain: (raw) => {
      const field = /nonexisting field \(([^)]+)\)/i.exec(raw)?.[1];
      const named = field ? `“${field}”` : "this figure";
      return `The platform does not offer ${named} for the account Flas asked about, so it cannot be shown. This is a gap in what Flas asks for, not a problem with your connection or your data.`;
    },
  },
  {
    kind: "provider_auth",
    match: /#190\)?|Error validating access token|OAuthException|invalid_grant|token has expired/i,
    retryable: false,
    explain: () =>
      "The connection's access to the platform has expired or was withdrawn. Reconnect the account to restore it — nothing else is wrong.",
  },
  {
    kind: "provider_rate_limit",
    match: /#4\)|#17\)|#80\d{3}|rate limit|request limit reached|too many requests|429/i,
    retryable: true,
    explain: () =>
      "The platform is temporarily limiting how often Flas may ask for this. It usually clears by itself within the hour, and nothing was lost.",
  },
  {
    kind: "unreachable",
    match:
      /fetch failed|failed to fetch|ENOTFOUND|ECONNREFUSED|ECONNRESET|network error|socket hang up/i,
    retryable: true,
    explain: () =>
      "Flas could not reach the service. That is usually temporary — try again in a moment.",
  },
];

const UNKNOWN =
  "Something went wrong and Flas could not identify the cause, so nothing else has been changed. The technical detail has been logged — please try again, and send it to Flas support if it happens again.";

/**
 * Maps any thrown value to customer-facing copy plus the original text.
 *
 * `action` names what the reader was doing ("save this quotation") so the first
 * sentence tells them where they stand before the explanation.
 */
export function toPlainError(error: unknown, opts: { action?: string } = {}): PlainError {
  const technical = rawErrorText(error);
  const rule = RULES.find((r) => r.match.test(technical));
  const lead = opts.action ? `We could not ${opts.action}. ` : "";
  if (!rule) {
    return {
      message: `${lead}${UNKNOWN}`,
      technical,
      kind: "unknown",
      recognised: false,
      retryable: true,
    };
  }
  return {
    message: `${lead}${rule.explain(technical)}`,
    technical,
    kind: rule.kind,
    recognised: true,
    retryable: rule.retryable,
  };
}

/** The message alone, for a toast or an inline banner. */
export function plainErrorMessage(error: unknown, opts: { action?: string } = {}): string {
  return toPlainError(error, opts).message;
}
