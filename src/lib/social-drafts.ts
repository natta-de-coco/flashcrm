// What the Social screen's composer sends when a post is saved.
//
// This was decided inline in the screen, where nothing could test it, and two
// review findings on PR #36 came from it:
//
//   - "No account" left the account out of the request. The server reads a
//     missing account as "pick one for me", so a draft the screen said had no
//     account was filed against the first account of that platform.
//   - "Save changes" on a planned post sent "no date". The server read that as
//     "remove the plan", so rewriting a caption silently turned a planned post
//     back into a draft.
//
// Both were the same mistake: something the person had not asked for was left
// to a default. So every choice is now said outright, and nothing is said about
// what was not touched:
//
//   account   always sent — the id that was picked, or null for "No account".
//   date      decided by the button that was pressed:
//               "Save with a planned date" / "Save with this plan" always sends
//               the date in the field, also when it is the one that was loaded;
//               "Save as draft" on a new post sends none;
//               "Save changes" on an edit sends only what the person did to the
//               field: nothing when it is untouched (the server then leaves the
//               plan alone), null when it was emptied on purpose, the new date
//               when it was changed.
//
// A date that was asked for but cannot be read is never sent as "no date": a
// new post would be saved as a plain draft under a message that says it was
// planned. The request is refused instead, and nothing is saved.
//
// Pure functions with no imports: the logic is tested directly in
// tests/social-hub.test.mjs, together with the handlers that receive it.

/** One piece of work in the composer: a new caption, or a saved post being rewritten. */
export type ComposerDraft<P extends string = string> = {
  /** The saved post being rewritten, or null for a new one. */
  id: string | null;
  caption: string;
  platform: P;
  /** The account picked, or null for "No account". */
  accountId: string | null;
  /** The date field's value (`datetime-local`), or "" when it is empty. */
  plannedAt: string;
  /**
   * What the date field held when the post was loaded for editing; "" for a new
   * post or a draft with no plan. Comparing against it is how an untouched date
   * is told from one that was changed or removed.
   */
  loadedPlannedAt: string;
};

export type NewPostRequest<P extends string = string> = {
  caption: string;
  platform: P;
  /** Always present. null is "No account", and is not a request to pick one. */
  accountId: string | null;
  /** Present only when the post was saved with a planned date. */
  scheduledAt?: string;
};

export type EditPostRequest = {
  id: string;
  caption: string;
  accountId: string | null;
  /** A new date, null to remove the plan, or left out to keep the plan as it is. */
  scheduledAt?: string | null;
};

export type DraftSaveRequest<P extends string = string> =
  { kind: "create"; data: NewPostRequest<P> } | { kind: "update"; data: EditPostRequest };

/** The date was asked for and cannot be read: nothing is sent, nothing is saved. */
export type UnreadableDate = { kind: "unreadable-date" };

/** A four-digit-year instant, the only shape the server accepts for a date. */
const FOUR_DIGIT_YEAR_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * A `datetime-local` value as an instant, or null when it is empty or cannot be
 * stored: not a date at all, a five-digit year (typed into the year part, which
 * `datetime-local` allows), or a year the database has no room for.
 */
function localInputToIso(value: string): string | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) return null;
  const iso = new Date(ms).toISOString();
  // A year outside 0000–9999 comes out as "+012026-…", which the server refuses.
  // Year 0000 passes that shape, but the database has no such year.
  return FOUR_DIGIT_YEAR_INSTANT.test(iso) && !iso.startsWith("0000") ? iso : null;
}

/**
 * What an edit says about the planned date, or null when the date it would send
 * cannot be read.
 *
 * `plan` (the plan button): always the date in the field. The button says "plan
 * it", whatever the form held when the post was loaded — a list that is out of
 * date may show a draft that is already planned, or the reverse.
 *
 * Otherwise ("Save changes"): nothing, when the field still holds what was
 * loaded. That is what keeps a plan through a caption edit, and it also means
 * the stored time is never rewritten from its rounded, local-time display.
 */
function editedDate(draft: ComposerDraft, plan: boolean): { scheduledAt?: string | null } | null {
  if (plan) {
    const iso = localInputToIso(draft.plannedAt);
    return iso ? { scheduledAt: iso } : null;
  }
  if (draft.plannedAt === draft.loadedPlannedAt) return {};
  // The person emptied the field: that is the deliberate way to remove a plan.
  if (draft.plannedAt === "") return { scheduledAt: null };
  const iso = localInputToIso(draft.plannedAt);
  return iso ? { scheduledAt: iso } : null;
}

/**
 * The request for saving the composer as it stands, or `unreadable-date` when a
 * date would have been sent and cannot be read.
 *
 * `plan` is which button was pressed: false for "Save as draft" / "Save
 * changes", true for "Save with a planned date" / "Save with this plan".
 */
export function draftSaveRequest<P extends string>(
  draft: ComposerDraft<P>,
  plan: boolean,
): DraftSaveRequest<P> | UnreadableDate {
  const caption = draft.caption.trim();
  if (draft.id) {
    const date = editedDate(draft, plan);
    if (!date) return { kind: "unreadable-date" };
    return { kind: "update", data: { id: draft.id, caption, accountId: draft.accountId, ...date } };
  }
  // "Save as draft" on a new post sends no date, even with one typed.
  const scheduledAt = plan ? localInputToIso(draft.plannedAt) : null;
  if (plan && !scheduledAt) return { kind: "unreadable-date" };
  return {
    kind: "create",
    data: {
      caption,
      platform: draft.platform,
      accountId: draft.accountId,
      ...(scheduledAt ? { scheduledAt } : {}),
    },
  };
}

/**
 * Which message tells the person what was saved, decided from what was sent: a
 * request that carried a date saved a planned post; an edit without one updated
 * a post; a new post without one is a new draft.
 */
export function savedMessageKey(
  request: DraftSaveRequest,
): "social.savedWithAPlannedDate" | "social.draftUpdated" | "social.draftSaved" {
  if (typeof request.data.scheduledAt === "string") return "social.savedWithAPlannedDate";
  return request.kind === "update" ? "social.draftUpdated" : "social.draftSaved";
}

/** The functions that put a request on the wire: the server functions, or fakes in a test. */
export type DraftSenders<P extends string = string> = {
  save: (args: { data: NewPostRequest<P> }) => Promise<unknown>;
  update: (args: { data: EditPostRequest }) => Promise<unknown>;
};

export type SubmitOutcome<P extends string = string> =
  | UnreadableDate
  | {
      kind: "saved";
      /** What was sent. */
      request: DraftSaveRequest<P>;
      /** The message that says what was saved. */
      messageKey: ReturnType<typeof savedMessageKey>;
    };

/**
 * Saves the composer: builds the request, and hands it to exactly one of the
 * two senders, unchanged. Nothing is sent when the date cannot be read.
 *
 * The screen calls this and nothing else, so what reaches the server is what
 * `draftSaveRequest` decided — the screen has no room to add a default of its
 * own (the way `accountId ?? undefined` once would have, which JSON drops and
 * the server then reads as "pick an account for me").
 *
 * A sender that throws is not caught: the failure reaches the caller, and the
 * draft is not reported as saved.
 */
export async function submitDraft<P extends string>(
  draft: ComposerDraft<P>,
  plan: boolean,
  send: DraftSenders<P>,
): Promise<SubmitOutcome<P>> {
  const request = draftSaveRequest(draft, plan);
  if (request.kind === "unreadable-date") return request;
  if (request.kind === "update") await send.update({ data: request.data });
  else await send.save({ data: request.data });
  return { kind: "saved", request, messageKey: savedMessageKey(request) };
}

/** ISO instant → the value a `datetime-local` input expects, in local time. "" when there is none. */
export function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** The parts of a saved post the composer loads back. */
export type SavedPost = {
  id: string;
  caption: string;
  account_id: string | null;
  scheduled_at: string | null;
};

/**
 * What the composer holds after a saved post is chosen for editing.
 *
 * The date field shows the plan in local time, and `loadedPlannedAt` remembers
 * exactly what was shown: it is what an untouched date is told from a changed
 * one by, so a caption edit does not rewrite (or drop) the plan. A draft loads
 * with an empty date, which is also its `loadedPlannedAt`.
 *
 * The account is the post's own when that account is in the list the composer
 * offers; a post whose account is no longer there loads as "No account", which
 * is what the database holds once an account is deleted. The platform is the
 * account's, and otherwise stays what the composer already had.
 */
export function draftFromPost<P extends string>(
  post: SavedPost,
  accounts: readonly { id: string; platform: string }[],
  currentPlatform: P,
): ComposerDraft<P> {
  const account = accounts.find((a) => a.id === post.account_id);
  const planned = toLocalInputValue(post.scheduled_at);
  return {
    id: post.id,
    caption: post.caption,
    accountId: account ? account.id : null,
    platform: account ? (account.platform as P) : currentPlatform,
    plannedAt: planned,
    loadedPlannedAt: planned,
  };
}

/** The composer with nothing in it, for a new post on this platform. */
export function emptyDraft<P extends string>(platform: P): ComposerDraft<P> {
  return {
    id: null,
    caption: "",
    platform,
    accountId: null,
    plannedAt: "",
    loadedPlannedAt: "",
  };
}

/**
 * Whether the platform chosen in the composer is kept with the saved post.
 *
 * `social_posts` has an account but no platform column. With an account, the
 * platform is that account's, and is read from it. With "No account" nothing
 * else records it: the request carries the platform, the server uses it for the
 * caption and the audit log, and the row that is stored does not. The composer
 * says so, instead of letting a chosen platform look as if it were saved.
 */
export function platformIsKept(draft: { accountId: string | null }): boolean {
  return draft.accountId !== null;
}
