// Telling a draft from a refusal.
//
// Defect H8, second half (QA, 26 Sep 2026): the campaign writer showed a green
// "Flas AI drafted your message" toast for text that was actually the model
// declining to write anything. The old call site toasted success on any
// resolved response, so a refusal arrived looking like a finished draft.
//
// The empty-audience case is now decided in code (see campaign-audience.ts), so
// this only has to catch a model that declines anyway. It is deliberately
// narrow: a false positive throws away a usable draft, so a match needs an
// explicit decline, not merely a negative-sounding sentence.

/** The verbs a decline lands on. The 0-3 filler words keep it in one clause,
 *  so "I cannot in good conscience write this" matches. */
const DECLINED = "(?:write|draft|create|generate|produce|compose|help|assist|comply|proceed|do)\\b";

const REFUSAL_PATTERNS: RegExp[] = [
  // "I can't write this", "I will not draft that", "I cannot help".
  new RegExp(
    `\\bI\\s+(?:can(?:'|’)?t|cannot|can\\s+not|won(?:'|’)?t|will\\s+not)\\s+(?:\\w+\\s+){0,3}?${DECLINED}`,
    "i",
  ),
  // "I'm unable to help with that", "I am not able to write this".
  new RegExp(
    `\\bI\\s*(?:'|’)?\\s*(?:m|am)\\s+(?:unable|not\\s+able)\\s+to\\s+(?:\\w+\\s+){0,3}?${DECLINED}`,
    "i",
  ),
  // The exact wording the tester was shown.
  /\bno\s+(?:opted[-\s]?in|consented|subscribed)\b/i,
  /\bthere\s+(?:are|is)\s+no\s+(?:opted[-\s]?in\s+)?(?:contacts|leads|recipients|subscribers|audience)\b/i,
];

// "I can't wait to show you…" is ordinary marketing copy in a friendly tone, and
// the only common phrase that would otherwise trip the first pattern.
const FALSE_POSITIVE = /\bI\s*(?:'|’)?\s*(?:can(?:'|’)?t|cannot|can\s+not)\s+wait\b/gi;

/**
 * True when `draft` reads as the model refusing rather than a message to send.
 * Empty or whitespace-only text counts: nothing was drafted either way.
 */
export function looksLikeRefusal(draft: string | null | undefined): boolean {
  const text = (draft ?? "").trim();
  if (!text) return true;
  const candidate = text.replace(FALSE_POSITIVE, "");
  return REFUSAL_PATTERNS.some((pattern) => pattern.test(candidate));
}

/** The refusal itself, trimmed to something a toast can carry. */
export function refusalSummary(draft: string): string {
  const firstLine = draft.trim().split(/\n+/)[0] ?? "";
  return firstLine.length > 180 ? `${firstLine.slice(0, 177)}…` : firstLine;
}
