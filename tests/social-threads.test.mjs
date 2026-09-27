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

function loadLib(relative) {
  const compiled = ts.transpileModule(readFileSync(new URL(relative, import.meta.url), "utf8"), {
    // ES2020, not the default: without it Map iteration is downlevelled into
    // something that silently yields nothing, and every grouping test "fails"
    // because of the harness rather than the code.
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, require: () => ({}) });
  return exports;
}
const { groupThreads, threadKey, threadMatches, threadStatus } = loadLib(
  "../src/lib/social-threads.ts",
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

describe("the migration that adds the thread column", () => {
  const sql = read("supabase/migrations/20260927120000_social_interactions_thread_id.sql");

  it("is additive and re-runnable", () => {
    assert.match(sql, /ADD COLUMN IF NOT EXISTS thread_id text/);
    assert.match(sql, /CREATE INDEX IF NOT EXISTS social_interactions_thread_idx/);
  });
});
