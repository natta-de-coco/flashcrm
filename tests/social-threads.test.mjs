// QA, 26 Sep, on the Social inbox:
//   H4 "Your own page replies are shown as customer messages"
//   H5 "No threading: each message is a separate row (Mteos Timer x4)"
//   H7 "Messages from 2025 are still Waiting/Open, which inflates 27 to reply"
//
// The grouping is pure, so it is tested directly. The sync side (direction,
// attachments, first-sync archiving) is pinned at the bottom.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function loadLib(relative, modules = {}) {
  const compiled = ts.transpileModule(readFileSync(new URL(relative, import.meta.url), "utf8"), {
    // ES2020, not the default: without it Map iteration is downlevelled into
    // something that silently yields nothing, and every grouping test "fails"
    // because of the harness rather than the code.
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  // The real module, not a stub: grouping depends on reading a reply's marker,
  // and a stub would make every reply look like an ordinary message -- which is
  // precisely the bug being tested for.
  runInNewContext(compiled, { exports, require: (id) => modules[id] ?? {} });
  return exports;
}
const threadMarkers = loadLib("../src/lib/social-thread.ts");
const { groupThreads, threadKey, threadMatches, threadStatus } = loadLib(
  "../src/lib/social-threads.ts",
  { "@/lib/social-thread": threadMarkers },
);
const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
    .split("\r\n")
    .join("\n");

const ACCOUNT = "acct-1";
let seq = 0;
const msg = (over = {}) => ({
  id: `i-${++seq}`,
  account_id: ACCOUNT,
  kind: "dm",
  direction: "in",
  author_name: "Mteos Timer",
  author_handle: null,
  body: "hello",
  status: "open",
  created_at: "2026-09-20T10:00:00Z",
  thread_id: null,
  ...over,
});

describe("a customer's messages are one conversation, not four rows", () => {
  it("groups DMs by the provider's conversation id", () => {
    const items = [
      msg({ thread_id: "conv-a", created_at: "2026-09-20T10:00:00Z" }),
      msg({ thread_id: "conv-a", created_at: "2026-09-20T10:05:00Z", body: "still there?" }),
      msg({ thread_id: "conv-b", author_name: "Someone else" }),
    ];
    const threads = groupThreads(items);
    assert.equal(threads.length, 2);
    const first = threads.find((t) => t.key.endsWith("conv-a"));
    assert.equal(first.items.length, 2);
    assert.equal(first.latest.body, "still there?");
  });

  it("falls back to the customer when there is no conversation id yet", () => {
    // Before the thread_id migration runs, grouping still has to work.
    const items = [msg({ author_name: "Mteos Timer" }), msg({ author_name: "Mteos Timer" })];
    assert.equal(groupThreads(items).length, 1);
  });

  it("never merges two accounts, or a comment with a DM, from the same name", () => {
    const items = [
      msg({ author_name: "Ali" }),
      msg({ author_name: "Ali", account_id: "acct-2" }),
      msg({ author_name: "Ali", kind: "comment" }),
    ];
    assert.equal(groupThreads(items).length, 3);
  });

  it("orders a conversation oldest first, and conversations newest first", () => {
    const items = [
      msg({ thread_id: "c1", created_at: "2026-09-01T00:00:00Z", body: "old" }),
      msg({ thread_id: "c1", created_at: "2026-09-02T00:00:00Z", body: "new" }),
      msg({ thread_id: "c2", created_at: "2026-09-05T00:00:00Z", body: "newest thread" }),
    ];
    const threads = groupThreads(items);
    assert.equal(threads[0].latest.body, "newest thread");
    // Spread into this realm first: the array comes from the vm sandbox, and
    // deepEqual compares prototypes.
    assert.deepEqual([...threads[1].items.map((i) => i.body)], ["old", "new"]);
  });

  it("puts both sides in the thread, so nobody answers twice", () => {
    // H4: our own replies used to be stored as the customer's messages, or
    // dropped entirely — either way the thread looked unanswered.
    const items = [
      msg({ thread_id: "c1", created_at: "2026-09-20T10:00:00Z", body: "is it in stock?" }),
      msg({
        thread_id: "c1",
        created_at: "2026-09-20T10:30:00Z",
        direction: "out",
        author_name: "A to Z Security",
        body: "Yes, we have it",
        status: "replied",
      }),
    ];
    const [thread] = groupThreads(items);
    assert.equal(thread.items.length, 2);
    assert.equal(thread.items[1].direction, "out");
    assert.equal(thread.latestInbound.body, "is it in stock?");
  });
});

describe("what counts as waiting for a reply", () => {
  it("the customer spoke last and nobody answered", () => {
    const [t] = groupThreads([msg({ thread_id: "c1" })]);
    assert.equal(t.waiting, true);
    assert.equal(threadStatus(t), "open");
  });

  it("we spoke last, so it is not waiting", () => {
    const [t] = groupThreads([
      msg({ thread_id: "c1", created_at: "2026-09-20T10:00:00Z" }),
      msg({
        thread_id: "c1",
        created_at: "2026-09-20T11:00:00Z",
        direction: "out",
        status: "replied",
      }),
    ]);
    assert.equal(t.waiting, false);
    assert.equal(threadStatus(t), "replied");
  });

  it("an archived last message is not waiting either", () => {
    // H7: old history imported as Open is what inflated "27 to reply".
    const [t] = groupThreads([msg({ thread_id: "c1", status: "archived" })]);
    assert.equal(t.waiting, false);
    assert.equal(threadStatus(t), "archived");
  });

  it("a live message keeps the thread open even when an older one was archived", () => {
    const [t] = groupThreads([
      msg({ thread_id: "c1", created_at: "2025-03-01T00:00:00Z", status: "archived" }),
      msg({ thread_id: "c1", created_at: "2026-09-20T10:00:00Z", status: "open" }),
    ]);
    assert.equal(threadStatus(t), "open");
  });
});

describe("searching a conversation looks at all of it", () => {
  it("matches on an older message, not just the newest", () => {
    const [t] = groupThreads([
      msg({ thread_id: "c1", created_at: "2026-09-01T00:00:00Z", body: "quote for 20 cameras" }),
      msg({ thread_id: "c1", created_at: "2026-09-02T00:00:00Z", body: "any update?" }),
    ]);
    assert.equal(threadMatches(t, "cameras"), true);
    assert.equal(threadMatches(t, "invoice"), false);
    assert.equal(threadMatches(t, "   "), true);
  });
});

describe("the sync stores direction, attachments and history correctly", () => {
  const server = read("src/lib/social.server.ts");

  it("recognizes our own messages by id or by name", () => {
    // H4's cause: the only check was `from.id === external_id`, and the id Meta
    // reports does not always equal the one stored on the row.
    assert.match(server, /function sentByUs\(/);
    assert.match(server, /self\.ids\.has\(String\(from\.id\)\)/);
    assert.match(server, /from\.name\.trim\(\) === self\.name\.trim\(\)/);
    assert.match(server, /graphGet\(`\/me\?fields=id,name`/);
  });

  it("stores our messages as ours instead of dropping them", () => {
    assert.ok(
      !server.includes("if (msg.from?.id === account.external_id) continue;"),
      "skipping our own messages is what left threads looking unanswered",
    );
    assert.match(server, /direction: ours \? "out" : "in"/);
  });

  it("describes an attachment rather than storing an empty bubble", () => {
    // H6: photos, stickers and shared posts rendered as blank.
    assert.match(server, /function describeAttachments\(/);
    assert.match(server, /\(photo\$\{name\}\)/);
    assert.match(server, /\(voice message\$\{name\}\)/);
    assert.match(server, /\(sticker\)/);
    assert.match(server, /attachments\{mime_type,name,image_data\},sticker/);
  });

  it("files old history as history on a first sync only", () => {
    assert.match(server, /HISTORY_CUTOFF_DAYS = 30/);
    assert.match(server, /function olderThanCutoff\(/);
    assert.match(server, /if \(!firstSync \|\| !at\) return false/);
    const fns = read("src/lib/social.functions.ts");
    assert.match(fns, /!account\.last_synced_at/);
  });

  it("survives a database that does not have thread_id yet", () => {
    // The column arrives in its own migration; a sync between this deploy and
    // that SQL must not break.
    assert.match(server, /error\.code === "42703"/);
    assert.match(server, /thread_id: _dropped/);
  });
});

describe("a reply we saved belongs to the customer it answers", () => {
  // Review of this PR: a reply carries no thread_id and its author is "You", so
  // keying it by its author put every reply to every customer into one "You"
  // thread -- a cross-customer duplicate that could then be replied to as if our
  // own message were the question.
  const { replyMarker } = threadMarkers;
  const reply = (parentId, over = {}) =>
    msg({
      direction: "out",
      author_name: "You",
      author_handle: null,
      status: "replied",
      external_id: replyMarker(parentId, true),
      created_at: "2026-09-20T12:00:00Z",
      ...over,
    });

  it("does not put two customers' replies in one thread", () => {
    const ali = msg({ author_name: "Ali", created_at: "2026-09-20T10:00:00Z" });
    const sara = msg({ author_name: "Sara", created_at: "2026-09-20T11:00:00Z" });
    const threads = groupThreads([
      ali,
      sara,
      reply(ali.id, { body: "yours, Ali" }),
      reply(sara.id, { body: "yours, Sara" }),
    ]);
    assert.equal(threads.length, 2, "one thread per customer, not a shared 'You' thread");
    const forAli = threads.find((t) => t.items.some((i) => i.id === ali.id));
    // Spread first: the array comes from the sandbox realm, where deepEqual
    // compares prototypes and not just contents.
    assert.deepEqual(
      [...forAli.items].map((i) => i.body),
      ["hello", "yours, Ali"],
    );
    assert.equal(forAli.latestInbound.id, ali.id);
  });

  it("puts the reply in the conversation even when that thread has a provider id", () => {
    const inbound = msg({ thread_id: "conv-a", created_at: "2026-09-20T10:00:00Z" });
    const [t] = groupThreads([inbound, reply(inbound.id)]);
    assert.equal(t.key, `t:${ACCOUNT}:conv-a`);
    assert.equal(t.items.length, 2);
    assert.equal(t.waiting, false, "the customer has been answered");
  });

  it("keeps an orphan reply on its own rather than merging it with someone else", () => {
    // The message it answers is outside the window the inbox read.
    const threads = groupThreads([reply("gone-1"), reply("gone-2")]);
    assert.equal(threads.length, 2);
    for (const t of threads) assert.equal(t.latestInbound, null);
  });

  it("follows a reply written to a reply", () => {
    const inbound = msg({ author_name: "Ali", created_at: "2026-09-20T10:00:00Z" });
    const first = reply(inbound.id, { created_at: "2026-09-20T12:00:00Z" });
    const second = reply(first.id, { created_at: "2026-09-20T13:00:00Z", body: "and one more" });
    const threads = groupThreads([inbound, first, second]);
    assert.equal(threads.length, 1);
    assert.equal(threads[0].items.length, 3);
  });
});

describe("a thread of only our own messages cannot be answered", () => {
  const inbox = read("src/components/inbox/SocialInbox.tsx");

  it("does not treat our own message as the one being replied to", () => {
    assert.ok(
      !inbox.includes("active?.latestInbound ?? active?.latest"),
      "falling back to the newest message of either side aims a reply at ourselves",
    );
    assert.match(inbox, /const activeInbound = active\?\.latestInbound \?\? null;/);
  });

  it("disables the composer and says why", () => {
    assert.match(inbox, /disabled=\{submit\.isPending \|\| !activeInbound\}/);
    assert.match(inbox, /disabled=\{draft\.isPending \|\| !activeInbound\}/);
    assert.match(inbox, /disabled=\{archive\.isPending \|\| !activeInbound\}/);
    // Said through a translation key now; the English is still this sentence.
    assert.match(inbox, /socialInbox\.nothingToReplyToThis/);
    assert.match(
      read("src/lib/i18n/screens/social-inbox.ts"),
      /"socialInbox\.nothingToReplyToThis":\s*"Nothing to reply to/,
    );
  });
});

describe("our own Instagram comments are recognized as ours", () => {
  const server = read("src/lib/social.server.ts");

  it("compares the Instagram handle with the Instagram account's own handle", () => {
    // Review of this PR: the comments request does not include `from`, and the
    // handle was compared against `/me`'s display name -- which, for a
    // Page-derived token, is the Page's name. They agree only by coincidence.
    assert.match(server, /fields=id,username`/);
    assert.match(server, /handles\.add\(handle\)/);
    assert.match(server, /sentByUs\(\{ id: c\.from\?\.id, handle: c\.username \}, self\)/);
    assert.ok(
      !server.includes("sentByUs({ id: c.from?.id, name: c.username }, self)"),
      "an Instagram handle is not a display name",
    );
  });

  it("compares handles without @ or case getting in the way", () => {
    assert.match(server, /function normalizeHandle\(/);
    assert.match(server, /replace\(\/\^@\/, ""\)\.toLowerCase\(\)/);
    assert.match(server, /self\.handles\.has\(handle\)/);
  });
});

describe("the migration that adds the thread column", () => {
  const sql = read("supabase/migrations/20260927120000_social_interactions_thread_id.sql");

  it("is additive and re-runnable", () => {
    assert.match(sql, /ADD COLUMN IF NOT EXISTS thread_id text/);
    assert.match(sql, /CREATE INDEX IF NOT EXISTS social_interactions_thread_idx/);
  });

  it("files the history that was already imported, which no code path reaches", () => {
    // Review of this PR: firstSync is `!last_synced_at`, so the accounts that
    // actually have two years of "Open" history are exactly the ones the code
    // rule can never help -- importing that history set last_synced_at.
    assert.match(sql, /UPDATE public\.social_interactions AS si/);
    assert.match(sql, /SET status = 'archived'/);
    assert.match(sql, /si\.direction = 'in'/);
    assert.match(sql, /si\.status = 'open'/);
    assert.match(sql, /si\.created_at < now\(\) - interval '30 days'/);
  });

  it("leaves a conversation alone when it has spoken in the last 30 days", () => {
    // A customer who wrote 45 days ago and again yesterday is a live
    // conversation; archiving the old half of it would hide real work.
    assert.match(sql, /NOT EXISTS \(/);
    assert.match(sql, /recent\.created_at >= now\(\) - interval '30 days'/);
    assert.match(sql, /recent\.account_id = si\.account_id/);
    assert.match(sql, /recent\.kind = si\.kind/);
    assert.ok(!/DELETE FROM public\.social_interactions/.test(sql), "nothing is deleted");
  });
});
