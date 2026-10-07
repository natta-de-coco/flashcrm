// How the Inbox reads a conversation's messages and its list of conversations.
//
// Both are read newest first, a page at a time. A whole thread used to be read
// oldest first with no limit, which ran into the API's row cap: past it, the
// END of the list was cut off. A long conversation showed its history and
// never its latest messages -- including the reply just sent, and the
// customer's last message that the 24-hour rule is worked out from.

export const THREAD_PAGE_SIZE = 100;
export const CONVERSATION_PAGE_SIZE = 200;

/**
 * Where a page ends: the oldest row's timestamp AND its id. Rows can share a
 * timestamp (anything inserted in one statement does), so a timestamp alone
 * either skips the ones that fall on a page edge or repeats them for ever.
 */
export type Cursor = { at: string; id: string };

export type Page<T> = {
  /** Newest first. */
  rows: T[];
  /** The last row of this page; null when there is nothing older. */
  before: Cursor | null;
};

/**
 * One fetch as a page. The fetch asks for one row more than a page so that
 * "is there anything older" needs no second query.
 */
export function pageOf<T extends { id: string }>(
  newestFirst: T[],
  size: number,
  timeOf: (row: T) => string | null,
): Page<T> {
  const rows = newestFirst.slice(0, size);
  const oldest = rows.at(-1);
  const at = oldest ? timeOf(oldest) : null;
  return {
    rows,
    before: newestFirst.length > size && oldest && at ? { at, id: oldest.id } : null,
  };
}

/**
 * The PostgREST filter for "strictly older than this row", for a list ordered
 * by `column` then id, both newest first. Values are quoted: a timestamp has
 * colons and a plus sign in it.
 */
export function olderThan(column: string, cursor: Cursor): string {
  const at = `"${cursor.at}"`;
  return `${column}.lt.${at},and(${column}.eq.${at},id.lt."${cursor.id}")`;
}

function eachOnce<T extends { id: string }>(pages: Page<T>[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const page of pages) {
    for (const row of page.rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      out.push(row);
    }
  }
  return out;
}

/** Pages as fetched (newest page first) as one thread, oldest message first. */
export function oldestFirst<T extends { id: string }>(pages: Page<T>[]): T[] {
  return eachOnce(pages).reverse();
}

/** Pages as fetched as one list, newest first. */
export function newestFirst<T extends { id: string }>(pages: Page<T>[]): T[] {
  return eachOnce(pages);
}

/** What the search box asks the server for: something worth a query, or nothing. */
export function serverSearchTerm(typed: string): string | null {
  const term = typed.trim();
  return term.length >= 2 ? term.slice(0, 80) : null;
}

/**
 * A search term as a "contains" value for a PostgREST filter. Quoted, so a
 * comma, bracket or dot typed by a person stays part of the text searched for
 * and cannot become part of the filter.
 */
export function containsFilterValue(term: string): string {
  return `"%${term.replace(/[\\"]/g, (c) => `\\${c}`)}%"`;
}

/**
 * The conversation open in a visible tab is being read, so it is not unread.
 * Unread used to be cleared only at the moment a conversation was opened: a
 * message arriving while the agent was reading the thread marked it unread
 * until they left and came back.
 */
export function shouldClearUnread(args: {
  activeId: string | null;
  unreadCount: number | null | undefined;
  visible: boolean;
}): boolean {
  return Boolean(args.activeId) && args.visible && (args.unreadCount ?? 0) > 0;
}
