// What the Inbox shows of a conversation, and of the list of conversations.
//
// Each case is a way the screen used to disagree with the database: a long
// thread that never showed its newest messages, a conversation that turned
// unread while it was being read, a customer who could not be found because
// their last message was too old to be in the loaded list.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  containsFilterValue,
  CONVERSATION_PAGE_SIZE,
  newestFirst,
  olderThan,
  oldestFirst,
  pageOf,
  serverSearchTerm,
  shouldClearUnread,
  THREAD_PAGE_SIZE,
} from "../node_modules/.cache/flas-inbox.mjs";

const at = (n) => new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString();
const row = (id, second) => ({ id, created_at: at(second) });

/** The query the screen sends: rows strictly older than a cursor, newest first, one extra. */
function fetchPage(table, size, before) {
  const rows = table
    .filter(
      (r) =>
        !before || r.created_at < before.at || (r.created_at === before.at && r.id < before.id),
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
    .slice(0, size + 1);
  return pageOf(rows, size, (r) => r.created_at);
}

/** Presses "load earlier" until there is nothing earlier. */
function readAll(table, size) {
  const pages = [fetchPage(table, size, null)];
  while (pages.at(-1).before) {
    assert.ok(pages.length < 1000, "paging does not end");
    pages.push(fetchPage(table, size, pages.at(-1).before));
  }
  return pages;
}

describe("a thread is read newest first, a page at a time", () => {
  it("shows the latest messages of a thread far longer than one fetch", () => {
    const table = Array.from({ length: 2500 }, (_, i) => row(`m${String(i).padStart(4, "0")}`, i));
    const first = fetchPage(table, THREAD_PAGE_SIZE, null);
    const shown = oldestFirst([first]);
    assert.equal(shown.length, THREAD_PAGE_SIZE);
    // The reply just sent is on screen. Reading oldest-first with a row cap
    // showed message 0 to 999 of this thread and never its end.
    assert.equal(shown.at(-1).id, "m2499");
    assert.equal(shown[0].id, "m2400");
    assert.ok(first.before, "and it knows there is more above");
  });

  it("reaches every message exactly once, in order, by loading earlier pages", () => {
    const table = Array.from({ length: 357 }, (_, i) => row(`m${String(i).padStart(4, "0")}`, i));
    const thread = oldestFirst(readAll(table, 50));
    assert.deepEqual(
      thread.map((m) => m.id),
      table.map((m) => m.id),
    );
  });

  it("does not skip a message that shares a timestamp with the last one on a page", () => {
    // Three messages in the same instant, straddling a page boundary. A cursor
    // made of the timestamp alone drops the ones past the edge.
    const table = [row("a", 1), row("b", 2), row("c", 2), row("d", 2), row("e", 3), row("f", 4)];
    const thread = oldestFirst(readAll(table, 3));
    assert.deepEqual(
      thread.map((m) => m.id),
      ["a", "b", "c", "d", "e", "f"],
    );
  });

  it("gets through more same-instant messages than a page holds", () => {
    // What a bulk import looks like: every row stamped by one statement. A
    // timestamp cursor can never move past them; the id half of the cursor can.
    const table = [
      ...Array.from({ length: 10 }, (_, i) => row(`m${i}`, 5)),
      row("old", 1),
      row("new", 9),
    ];
    const thread = oldestFirst(readAll(table, 3));
    assert.equal(thread.length, 12);
    assert.equal(new Set(thread.map((m) => m.id)).size, 12, "each exactly once");
    assert.equal(thread[0].id, "old");
    assert.equal(thread.at(-1).id, "new");
  });

  it("asks the database for rows strictly older than the last one shown", () => {
    assert.equal(
      olderThan("created_at", {
        at: "2026-10-06T14:56:40.123456+00:00",
        id: "11111111-1111-4111-8111-111111111111",
      }),
      'created_at.lt."2026-10-06T14:56:40.123456+00:00",' +
        'and(created_at.eq."2026-10-06T14:56:40.123456+00:00",id.lt."11111111-1111-4111-8111-111111111111")',
    );
  });

  it("says there is nothing earlier when the thread fits in one page", () => {
    const page = fetchPage([row("a", 1), row("b", 2)], THREAD_PAGE_SIZE, null);
    assert.equal(page.before, null);
    assert.deepEqual(
      oldestFirst([page]).map((m) => m.id),
      ["a", "b"],
    );
  });

  it("keeps the conversation list newest first across pages", () => {
    const table = Array.from({ length: 450 }, (_, i) => row(`c${String(i).padStart(3, "0")}`, i));
    const list = newestFirst(readAll(table, CONVERSATION_PAGE_SIZE));
    assert.equal(list.length, 450);
    assert.equal(list[0].id, "c449");
    assert.equal(list.at(-1).id, "c000");
  });
});

describe("a conversation being read is not unread", () => {
  it("clears the count for the open conversation in a visible tab", () => {
    assert.equal(shouldClearUnread({ activeId: "c1", unreadCount: 2, visible: true }), true);
  });

  it("leaves it alone when the tab is in the background: nobody is reading", () => {
    assert.equal(shouldClearUnread({ activeId: "c1", unreadCount: 2, visible: false }), false);
  });

  it("writes nothing when there is nothing to clear, or no conversation is open", () => {
    assert.equal(shouldClearUnread({ activeId: "c1", unreadCount: 0, visible: true }), false);
    assert.equal(shouldClearUnread({ activeId: "c1", unreadCount: null, visible: true }), false);
    assert.equal(shouldClearUnread({ activeId: null, unreadCount: 3, visible: true }), false);
  });
});

describe("searching for a customer", () => {
  it("asks the server only for something worth a query", () => {
    assert.equal(serverSearchTerm(""), null);
    assert.equal(serverSearchTerm(" a "), null);
    assert.equal(serverSearchTerm("  Sara "), "Sara");
    assert.equal(serverSearchTerm("x".repeat(500)).length, 80);
  });

  it("keeps what a person typed as text, never as part of the filter", () => {
    assert.equal(containsFilterValue("Sara"), '"%Sara%"');
    // A comma or bracket would otherwise end the value and start a new filter.
    assert.equal(containsFilterValue("Al, Co (Dubai)"), '"%Al, Co (Dubai)%"');
    assert.equal(containsFilterValue('say "hi"'), '"%say \\"hi\\"%"');
    assert.equal(containsFilterValue("back\\slash"), '"%back\\\\slash%"');
  });
});

describe("the Inbox screen uses these rules", () => {
  const inbox = readFileSync(
    new URL("../src/routes/_authenticated/inbox.tsx", import.meta.url),
    "utf8",
  )
    .split("\r\n")
    .join("\n");
  const between = (from, to) => inbox.slice(inbox.indexOf(from), inbox.indexOf(to));

  it("reads a thread newest first with a page limit", () => {
    const query = between("const messages = useInfiniteQuery({", "const thread = useMemo(");
    assert.match(query, /\.order\("created_at", \{ ascending: false \}\)/);
    assert.match(query, /\.limit\(THREAD_PAGE_SIZE \+ 1\)/);
    assert.match(query, /\.order\("id", \{ ascending: false \}\)/);
    assert.match(
      query,
      /if \(pageParam\) query = query\.or\(olderThan\("created_at", pageParam\)\);/,
    );
    assert.match(query, /\.eq\("conversation_id", activeId!\)/);
    assert.match(
      inbox,
      /const thread = useMemo\(\(\) => oldestFirst\(messages\.data\?\.pages \?\? \[\]\)/,
    );
    assert.ok(!inbox.includes("messages.data ?? []"), "something still reads the raw query result");
  });

  it("offers earlier messages and older conversations", () => {
    assert.match(inbox, /messages\.hasNextPage && \(/);
    assert.match(inbox, /onClick=\{\(\) => loadOlder\(messages\)\}/);
    assert.match(inbox, /onClick=\{\(\) => loadOlder\(conversations\)\}/);
    // A page that cannot be loaded is reported, not swallowed.
    assert.match(inbox, /if \(result\.isError\) toast\.error\(/);
    assert.match(inbox, /\.limit\(CONVERSATION_PAGE_SIZE \+ 1\)/);
  });

  it("follows the newest message, not the number of messages loaded", () => {
    assert.match(inbox, /\}, \[newestMessageId, activeId\]\);/);
  });

  it("works out the 24-hour window from the newest messages", () => {
    const rule = between(
      "const whatsappReplyWindowOpen = useMemo(",
      "const sendContext = useQuery({",
    );
    assert.match(rule, /const newestInbound = thread\b/);
  });

  it("clears unread for the conversation on screen, and only a row that has a count", () => {
    const effect = between(
      "const activeUnread = active?.unread_count ?? 0;",
      "const describeBlocks",
    );
    assert.match(effect, /shouldClearUnread\(\{ activeId, unreadCount: activeUnread, visible \}\)/);
    assert.match(effect, /\.gt\("unread_count", 0\)/);
    assert.match(effect, /document\.addEventListener\("visibilitychange", clear\);/);
    assert.match(effect, /\}, \[activeId, activeUnread, qc\]\);/);
    assert.match(effect, /if \(error\) console\.error/);
  });

  it("finds customers beyond the loaded conversations, inside the same access rules", () => {
    const search = between(
      "const foundConversations = useQuery({",
      "const messages = useInfiniteQuery({",
    );
    // The signed-in user's own client: row-level security decides what is found.
    assert.match(search, /await supabase\s*\n\s*\.from\("conversations"\)/);
    assert.match(search, /const value = containsFilterValue\(searchTerm!\);/);
    assert.match(search, /referencedTable: "contacts"/);
    assert.match(search, /\.limit\(50\)/);
    assert.ok(!inbox.includes("supabaseAdmin"));
  });

  it("exports the whole conversation, not only the pages on screen", () => {
    const transcript = between("async function wholeThread(", 'if (channel === "social")');
    assert.match(transcript, /\.range\(from, from \+ size - 1\)/);
    assert.match(transcript, /everyMessage = await wholeThread\(active\.id\);/);
    assert.match(transcript, /if \(error\) throw error;/);
  });
});
