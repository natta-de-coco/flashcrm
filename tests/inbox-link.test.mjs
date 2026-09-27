// A contact's "Message in Inbox" button links to one conversation. The route
// used to accept the parameter and ignore it, so the button dropped the user on
// the inbox list and left them to find the thread themselves.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function loadLib(relative) {
  const compiled = ts.transpileModule(readFileSync(new URL(relative, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, require: () => ({}) });
  return exports;
}
const { inboxConversationHref, requestedConversationId } = loadLib("../src/lib/inbox-link.ts");
const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
    .split("\r\n")
    .join("\n");

const UUID = "2f1a9c64-7b3d-4e21-9a5f-8c0d6e4b1a77";

describe("the inbox opens the conversation a link asks for", () => {
  it("accepts a uuid", () => {
    assert.equal(requestedConversationId({ conversation: UUID }), UUID);
  });

  it("trims a value that arrived with whitespace", () => {
    assert.equal(requestedConversationId({ conversation: ` ${UUID} ` }), UUID);
  });

  it("refuses anything that is not a uuid", () => {
    // The value goes straight into a lookup; "open whatever this says" is not
    // something the inbox should honour.
    for (const bad of ["", "   ", "latest", "1", "../admin", `${UUID}'; drop table--`]) {
      assert.equal(requestedConversationId({ conversation: bad }), null, `accepted ${bad}`);
    }
  });

  it("refuses a value that is not a string at all", () => {
    for (const bad of [undefined, null, 42, {}, [UUID]]) {
      assert.equal(requestedConversationId({ conversation: bad }), null);
    }
  });

  it("ignores other search parameters", () => {
    assert.equal(requestedConversationId({ channel: "social" }), null);
  });

  it("builds a link the route accepts", () => {
    // The two halves have to agree, or the button is decorative.
    const href = inboxConversationHref(UUID);
    const search = Object.fromEntries(new URL(href, "https://x.test").searchParams);
    assert.equal(requestedConversationId(search), UUID);
  });
});

describe("the route is wired to it", () => {
  const route = read("src/routes/_authenticated/inbox.tsx");

  it("validates the search parameter instead of ignoring it", () => {
    assert.match(route, /validateSearch/);
    assert.match(route, /requestedConversationId\(search\)/);
  });

  it("opens that conversation instead of the newest one", () => {
    assert.match(route, /Route\.useSearch\(\)/);
    assert.match(route, /useState<string \| null>\(requested \?\? null\)/);
    // The auto-open effect must not override a requested thread.
    assert.match(route, /if \(activeId \|\| !list\.length\) return;/);
  });
});
