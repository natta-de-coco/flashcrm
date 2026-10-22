// Keeps one person's inbox drafts and send locks in memory across the one thing
// that takes the signed-in layout off the screen without ending the session:
// the two-factor code prompt.
//
// The drafts live in InboxDraftProvider, below the signed-in layout. A session
// that turns out to owe a code in the middle of a working day (two-factor was
// switched on from another device, and this browser learns at its next token
// refresh) is sent to /auth, which unmounts the layout and, with it, every
// unsent reply and every send that is waiting for an answer. Worse than the
// lost text: a send whose answer was never seen keeps its reference so that the
// retry is the same message, and a fresh lock would send it twice.
//
// So the provider hands its state to this module as it changes, and takes it
// back when it is drawn again. What makes that safe:
//
//   - It is kept for ONE identity, the same `${user id}:${company id}` scope the
//     provider is keyed by, and handed back only to exactly that scope. Another
//     person, or the same person in another company, gets nothing.
//   - It is dropped the moment anybody else, or nobody, is signed in
//     (forgetDraftsExcept, called from the auth provider on every auth event),
//     so "Back" at the prompt, a sign-out anywhere and an expired session all
//     discard it, as leaving the layout always did.
//   - It is memory only: nothing is written to browser storage, and a reload
//     discards it, as before.
//   - It does nothing on the server, where one module is shared by every
//     request and keeping anything would be a leak between people.
//   - While the company is still loading the scope reads `<user>:undefined`;
//     that is not an identity, so it neither keeps nor recalls anything (and so
//     cannot overwrite what is kept).
import type { Drafts } from "./inbox-drafts";
import type { InboxSendSession } from "./inbox-send-session";

type Kept = { userId: string; scope: string; state: Drafts; sends: InboxSendSession };

let kept: Kept | null = null;

const inBrowser = () => typeof window !== "undefined";

const isKnown = (part: string | undefined): part is string =>
  !!part && part !== "undefined" && part !== "null";

/** The user a scope belongs to, or null while the user or the company is not known yet. */
function ownerOf(scope: string): string | null {
  const parts = scope.split(":");
  if (parts.length !== 2) return null;
  const [userId, companyId] = parts;
  return isKnown(userId) && isKnown(companyId) ? userId : null;
}

/** What was kept for exactly this identity, or null. */
export function recallDrafts(scope: string): { state: Drafts; sends: InboxSendSession } | null {
  if (!inBrowser() || !kept || ownerOf(scope) === null) return null;
  return kept.scope === scope ? { state: kept.state, sends: kept.sends } : null;
}

/** Remember the drafts and send locks of this identity, replacing whatever was kept before. */
export function keepDrafts(scope: string, state: Drafts, sends: InboxSendSession): void {
  const userId = ownerOf(scope);
  if (!inBrowser() || userId === null || state.scope !== scope) return;
  kept = { userId, scope, state, sends };
}

/** Forget what is kept unless it belongs to the person now signed in (null: nobody is). */
export function forgetDraftsExcept(userId: string | null): void {
  if (kept && kept.userId !== userId) kept = null;
}
