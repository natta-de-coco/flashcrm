// One conversation, one row.
//
// Every DM was stored as its own interaction and the inbox listed each one
// separately, so a single customer appeared six times ("Mteos Timer x4") and the
// thread view showed one bubble with no history. Comments have no conversation
// id, so they group by the customer on that account instead — which is what a
// person reading the inbox would do anyway.
//
// A reply Flas saved is the exception: its author is "You" and it has no
// thread_id, so keying it by its author put every reply to every customer into
// one "You" thread. It carries the id of the message it answers, and that is
// what decides which conversation it belongs to.

import { replyParentId } from "@/lib/social-thread";

export type ThreadItem = {
  id: string;
  account_id: string;
  kind: "comment" | "dm";
  direction: "in" | "out";
  author_name: string | null;
  author_handle: string | null;
  body: string;
  status: "open" | "replied" | "archived";
  created_at: string;
  thread_id?: string | null;
  external_id?: string | null;
  replied_at?: string | null;
  ai_suggestion?: string | null;
};

export type Thread<T extends ThreadItem = ThreadItem> = {
  key: string;
  /** Newest message, whoever sent it — what the list row shows. */
  latest: T;
  /** Newest message from the customer: what a reply is a reply to. */
  latestInbound: T | null;
  /** Oldest first, both directions. */
  items: T[];
  /** True when the customer spoke last and nobody has answered. */
  waiting: boolean;
};

/**
 * What ties messages into one conversation.
 *
 * Meta's conversation id when we have it (DMs, once the thread_id column
 * exists). Otherwise the customer on that account — stable enough to group a
 * person's messages, and scoped per account so two workspaces or two Pages
 * never merge.
 */
export function threadKey(i: ThreadItem): string {
  if (i.thread_id) return `t:${i.account_id}:${i.thread_id}`;
  const who = (i.author_handle ?? i.author_name ?? "").trim().toLowerCase();
  if (who) return `w:${i.account_id}:${i.kind}:${who}`;
  return `i:${i.id}`;
}

const byOldest = (a: ThreadItem, b: ThreadItem) =>
  Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id);

/**
 * Groups interactions into conversations, newest conversation first.
 *
 * Both directions go in: a thread that shows only the customer's half reads as
 * if nobody ever answered, which is how the same reply got sent twice.
 */
export function groupThreads<T extends ThreadItem>(interactions: T[]): Thread<T>[] {
  const byId = new Map(interactions.map((i) => [i.id, i] as const));

  /**
   * The conversation an item belongs to. For one of our saved replies that is
   * the conversation of the message it answers, not its own — an answer with no
   * question in front of it is not a conversation. A reply whose message is not
   * in the window read here stands alone rather than joining another customer's.
   */
  const keyFor = (item: T): string => {
    let current: ThreadItem = item;
    // A reply to a reply is possible, so the parent is followed rather than read
    // once; the bound stops a marker that names itself from spinning.
    for (let hop = 0; hop < 5; hop++) {
      const parentId = replyParentId(current.external_id);
      if (!parentId) return threadKey(current);
      const parent = byId.get(parentId);
      if (!parent || parent.id === current.id) break;
      current = parent;
    }
    return `i:${item.id}`;
  };

  const byKey = new Map<string, T[]>();
  for (const i of interactions) {
    const key = keyFor(i);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(i);
    else byKey.set(key, [i]);
  }

  const threads: Thread<T>[] = [];
  for (const [key, items] of byKey) {
    const ordered = [...items].sort(byOldest);
    const latest = ordered[ordered.length - 1]!;
    const inbound = ordered.filter((i) => i.direction === "in");
    const latestInbound = inbound[inbound.length - 1] ?? null;
    threads.push({
      key,
      latest,
      latestInbound,
      items: ordered,
      // The customer spoke last, and that message is not marked handled.
      waiting: latest.direction === "in" && latest.status === "open",
    });
  }

  return threads.sort((a, b) => Date.parse(b.latest.created_at) - Date.parse(a.latest.created_at));
}

/** Does any message in this conversation match what was typed in the search box? */
export function threadMatches(thread: Thread, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return thread.items.some(
    (i) =>
      i.body.toLowerCase().includes(q) ||
      (i.author_name ?? "").toLowerCase().includes(q) ||
      (i.author_handle ?? "").toLowerCase().includes(q),
  );
}

/**
 * The status a conversation has, as opposed to the status of one message.
 *
 * A thread is open while the customer's last message is unhandled, even if an
 * older message in it was archived — otherwise filtering by Open hides live
 * conversations.
 */
export function threadStatus(thread: Thread): "open" | "replied" | "archived" {
  if (thread.waiting) return "open";
  const last = thread.latest;
  if (last.direction === "out" || last.status === "replied") return "replied";
  return last.status;
}
