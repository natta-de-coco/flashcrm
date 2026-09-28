// The Inbox accepts a conversation to open, so "Message in Inbox" on a contact
// lands on that conversation instead of on a list the user then has to search.
//
// Kept out of the route file so the parsing is testable, and so the shape of a
// valid link is stated in one place.

/** A Postgres uuid. A hand-edited link cannot make the inbox query junk. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The conversation a link asks for, or null.
 *
 * Anything that is not a uuid is dropped rather than passed on: the value goes
 * straight into a lookup, and "open whatever this string says" is not a thing
 * the inbox should honour.
 */
export function requestedConversationId(search: Record<string, unknown>): string | null {
  const raw = search["conversation"];
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  return UUID.test(id) ? id : null;
}

/** The link a contact's Message button points at. */
export function inboxConversationHref(conversationId: string): string {
  return `/inbox?conversation=${encodeURIComponent(conversationId)}`;
}
