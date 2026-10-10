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
//   date      on an edit, sent only when the date field was changed: the new
//             date, or null when the field was emptied on purpose. An untouched
//             date is left out, and the server then leaves the plan alone.
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

/** A `datetime-local` value as an instant, or null when it is empty or unreadable. */
function localInputToIso(value: string): string | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * What an edit says about the planned date.
 *
 * Nothing, when the field still holds what was loaded — whichever button was
 * pressed. That is what keeps a plan through a caption edit, and it also means
 * the stored time is never rewritten from its rounded, local-time display.
 */
function plannedDateChange(draft: ComposerDraft): { scheduledAt?: string | null } {
  if (draft.plannedAt === draft.loadedPlannedAt) return {};
  // The person emptied the field: that is the deliberate way to remove a plan.
  if (draft.plannedAt === "") return { scheduledAt: null };
  const iso = localInputToIso(draft.plannedAt);
  // A date that cannot be read changes nothing, rather than removing the plan.
  return iso ? { scheduledAt: iso } : {};
}

/**
 * The request for saving the composer as it stands.
 *
 * `plan` is which button was pressed: false for "Save as draft" / "Save
 * changes", true for "Save with a planned date" / "Save with this plan". For a
 * new post it decides whether the typed date is used. For an edit the form is
 * what is saved — see `plannedDateChange`.
 */
export function draftSaveRequest<P extends string>(
  draft: ComposerDraft<P>,
  plan: boolean,
): DraftSaveRequest<P> {
  const caption = draft.caption.trim();
  if (draft.id) {
    return {
      kind: "update",
      data: {
        id: draft.id,
        caption,
        accountId: draft.accountId,
        ...plannedDateChange(draft),
      },
    };
  }
  const scheduledAt = plan ? localInputToIso(draft.plannedAt) : null;
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
