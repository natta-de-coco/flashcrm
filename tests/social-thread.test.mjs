import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function loadLib(relative) {
  const compiled = ts.transpileModule(readFileSync(new URL(relative, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, require: () => ({}) });
  return exports;
}
const { repliesFor, replyDelivery, replyMarker } = loadLib("../src/lib/social-thread.ts");

const page = "page-1";
const tau = {
  id: "tau",
  account_id: page,
  kind: "dm",
  direction: "in",
  created_at: "2026-09-17T07:14:31Z",
};
const angelina = {
  id: "angelina",
  account_id: page,
  kind: "dm",
  direction: "in",
  created_at: "2026-07-28T10:00:00Z",
};
const out = (id, externalId, createdAt, kind = "dm", account = page) => ({
  id,
  account_id: account,
  kind,
  direction: "out",
  external_id: externalId,
  created_at: createdAt,
});

test("a reply shows only in the thread of the message it answers", () => {
  // The screenshot: Angelina's reply, sent after Tau Italia's message arrived,
  // appeared in Tau Italia's thread.
  const toTau = out("r1", replyMarker("tau", false, 1), "2026-09-17T08:00:00Z");
  const toAngelina = out("r2", replyMarker("angelina", false, 2), "2026-09-18T09:00:00Z");
  const rows = [tau, angelina, toTau, toAngelina];
  assert.deepEqual(
    repliesFor(tau, rows).map((r) => r.id),
    ["r1"],
  );
  assert.deepEqual(
    repliesFor(angelina, rows).map((r) => r.id),
    ["r2"],
  );
});

test("a reply from another Page is never shown, even if it names the message", () => {
  const stray = out("r3", replyMarker("tau", true, 3), "2026-09-17T08:00:00Z", "dm", "page-2");
  assert.equal(repliesFor(tau, [tau, stray]).length, 0);
});

test("older replies count only if saved in the same moment the message was answered", () => {
  const answered = { ...tau, replied_at: "2026-09-17T09:00:00Z" };
  const same = out("legacy-same", null, "2026-09-17T09:00:03Z");
  const later = out("legacy-later", null, "2026-09-20T12:00:00Z");
  const otherKind = out("legacy-comment", null, "2026-09-17T09:00:02Z", "comment");
  assert.deepEqual(
    repliesFor(answered, [answered, same, later, otherKind]).map((r) => r.id),
    ["legacy-same"],
  );
  assert.equal(repliesFor(tau, [tau, same, later]).length, 0, "never answered: nothing guessed");
});

test("replies read oldest first", () => {
  const a = out("a", replyMarker("tau", true, 1), "2026-09-17T08:00:00Z");
  const b = out("b", replyMarker("tau", true, 2), "2026-09-17T09:00:00Z");
  assert.deepEqual(
    repliesFor(tau, [b, a]).map((r) => r.id),
    ["a", "b"],
  );
});

test("each reply says whether the customer actually got it", () => {
  assert.equal(replyDelivery(out("s", replyMarker("tau", true), "x")), "sent");
  assert.equal(replyDelivery(out("n", replyMarker("tau", false), "x")), "not_sent");
  // Before markers, Messenger replies were only ever saved in FLAS.
  assert.equal(replyDelivery(out("old-dm", null, "x", "dm")), "not_sent");
  assert.equal(replyDelivery(out("old-comment", null, "x", "comment")), "unknown");
});

test("two replies to the same message get different markers", () => {
  // external_id is unique per account.
  assert.notEqual(replyMarker("tau", true, 1), replyMarker("tau", true, 2));
});

test("the bot only reads contact columns that exist", () => {
  // contacts(name, preferred_language) failed silently in production: there is
  // no preferred_language column, so every customer read as "not known yet".
  const bot = readFileSync(new URL("../src/lib/wa.server.ts", import.meta.url), "utf8");
  const types = readFileSync(
    new URL("../src/integrations/supabase/types.ts", import.meta.url),
    "utf8",
  );
  const contactsRow = types.slice(
    types.indexOf("      contacts: {"),
    types.indexOf("Insert:", types.indexOf("      contacts: {")),
  );
  const selected = /contacts\(([^)]*)\)/
    .exec(bot)[1]
    .split(",")
    .map((c) => c.trim());
  for (const column of selected)
    assert.ok(
      contactsRow.split(/\r?\n/).some((line) => line.trim().startsWith(`${column}:`)),
      `contacts.${column} exists`,
    );
});
