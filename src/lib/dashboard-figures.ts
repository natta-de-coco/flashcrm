// The dashboard's numbers, in one place, so two cards cannot quietly disagree.
//
// QA M7 (26 Sep): the AI brief said health 62 while the score card said 60,
// "3 social accounts" against "4/4 accounts active", and "27 to reply" against
// an Inbox badge of 22. Three different causes hid behind one symptom:
//
//   * the brief is generated once per UTC day and cached (brief.server.ts), so
//     its figures are a snapshot while every card around it is live;
//   * the health score is an average of five factor scores, computed in one
//     place — moved here so it is testable and described honestly;
//   * "to reply" counted every open social interaction, including the outbound
//     replies we ourselves insert with the default status 'open'
//     (social_interactions.status default, migration 20260824161021), while the
//     Inbox badge counts only `direction = 'in'` (inbox.tsx). The dashboard was
//     therefore always the larger number.
//
// Everything here is pure so tests/dashboard-trust.test.mjs can pin it down.

export type HealthGrade = "Excellent" | "Good" | "Needs work" | "At risk";

/** How the score is built, said in the same words the card shows the reader. */
export const HEALTH_METHOD_NOTE =
  "Average of the five factors below, weighted equally and recalculated on every refresh.";

/**
 * The overall business health score: the mean of the factor scores, rounded.
 * Equal weights, stated as such — the type used to call it "weighted", which
 * invited the reader to look for weights that were never there.
 */
export function summariseHealth(factors: ReadonlyArray<{ score: number }>): {
  score: number;
  grade: HealthGrade;
} {
  const score =
    factors.length === 0
      ? 0
      : Math.round(factors.reduce((sum, f) => sum + f.score, 0) / factors.length);
  return { score, grade: healthGrade(score) };
}

export function healthGrade(score: number): HealthGrade {
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Good";
  if (score >= 50) return "Needs work";
  return "At risk";
}

/**
 * Social interactions waiting for a reply.
 *
 * `exactTotal` is a database-side count with exactly the Inbox badge's filters
 * (`direction = 'in'` and `status = 'open'`), so the two screens cannot differ.
 * The per-account breakdown comes from a capped sample of the newest rows, so
 * it can be short of the total; `partial` says when it is, instead of letting
 * the parts silently fail to add up to the whole.
 */
export function reconcileSocialPending(input: {
  exactTotal: number;
  sampledByAccount: ReadonlyMap<string, number>;
}): { total: number; perAccount: Map<string, number>; counted: number; partial: boolean } {
  const perAccount = new Map(input.sampledByAccount);
  let counted = 0;
  for (const value of perAccount.values()) counted += value;
  return {
    total: input.exactTotal,
    perAccount,
    counted,
    partial: counted < input.exactTotal,
  };
}

/** Said under the per-account list when the breakdown cannot show every item. */
export function pendingBreakdownNote(pending: { total: number; counted: number }): string | null {
  if (pending.counted >= pending.total) return null;
  return `Showing the ${pending.counted} most recent of ${pending.total} waiting for a reply — open the Inbox for the rest.`;
}

/**
 * When a brief was written, as a date, or null when there is no usable
 * timestamp. A missing or unreadable one used to reach `new Date(...)
 * .toLocaleTimeString()` and print "Invalid Date" to the reader.
 */
export function briefWrittenAt(generatedAt: string | null | undefined): Date | null {
  if (!generatedAt) return null;
  const written = new Date(generatedAt);
  return Number.isFinite(written.getTime()) ? written : null;
}

/**
 * How old a brief is at the moment the server answers, worked out on the
 * server from its own clock and the brief's own timestamp. Null when it cannot
 * be worked out. The reader's device clock plays no part: it can be minutes or
 * hours off, which made a brief look "just written" or very old at will.
 */
export function briefAgeMs(generatedAt: string | null | undefined, now: Date): number | null {
  const written = briefWrittenAt(generatedAt);
  return written ? Math.max(0, now.getTime() - written.getTime()) : null;
}

/**
 * How far the brief is behind the cards beside it: the age the server gave when
 * the brief was fetched, plus the time between fetching the brief and last
 * fetching the cards. Both fetch times come from the same device clock, so only
 * their difference is used, and a wrong clock cancels out. NaN when the age is
 * unknown, which `briefSnapshotKind` never calls fresh.
 */
export function briefAgeBesideCards(input: {
  ageMs: number | null | undefined;
  briefFetchedAt: number;
  cardsFetchedAt: number;
}): number {
  if (typeof input.ageMs !== "number" || !Number.isFinite(input.ageMs)) return Number.NaN;
  return input.ageMs + Math.max(0, input.cardsFetchedAt - input.briefFetchedAt);
}

/** Beyond this, a cached brief and the live cards have had time to diverge. */
export const BRIEF_DIVERGENCE_MS = 5 * 60_000;

/**
 * What to say under the AI brief so its numbers are not read as live ones.
 * The brief is written once a day and reused (brief.server.ts:100-116); the
 * cards beside it refetch every 30 seconds. They measure different moments,
 * and the reader has to be told which is which.
 */
export function briefSnapshotNote(input: {
  /** Generation time, already formatted for the reader's locale. */
  generatedAtTime: string;
  cached: boolean;
  /** How long after the brief the live figures were last read, in ms. */
  ageMs: number;
}): string {
  const kind = briefSnapshotKind(input);
  if (kind === "fresh") {
    return `Written just now from the same figures as the cards on this page.`;
  }
  if (kind === "diverged") {
    return `Figures as they stood at ${input.generatedAtTime} today. The cards on this page are live and have moved since, so numbers here can differ — press Regenerate for a brief on today's current figures.`;
  }
  return `Figures as they stood at ${input.generatedAtTime} today, reused until tomorrow.`;
}

/**
 * Which of the three notes applies, so the screen can say it in the reader's
 * language while this module keeps the one rule for choosing it.
 */
export function briefSnapshotKind(input: {
  cached: boolean;
  ageMs: number;
}): "fresh" | "diverged" | "cached" {
  // Age decides whether the brief and the cards can have drifted apart, however
  // the server delivered it. `cached: false` only says it was not read from the
  // daily cache on that request; after Regenerate it stays false in the page's
  // memory while the cards keep refetching, so reading it as "fresh" had a
  // brief written at 08:14 still saying "Written just now" at lunchtime. An age
  // that cannot be worked out is never called fresh.
  if (!(input.ageMs < BRIEF_DIVERGENCE_MS)) return "diverged";
  return input.cached ? "cached" : "fresh";
}
