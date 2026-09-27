// QA, 26 Sep: "Comments on posts 0" across 46 synced posts, and Sync reports
// success. Each risky section of a Meta sync was wrapped in a bare `catch {}`,
// so a Page without `pages_messaging` or an Instagram account without
// `instagram_manage_comments` synced "successfully" with nothing in it, and the
// reason — which names the missing permission — was discarded.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
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
const { skipReason, syncSummary } = loadLib("../src/lib/sync-report.ts");
const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8").split("\r\n").join("\n");

describe("a refused section says which permission is missing", () => {
  it("repeats the permission Meta itself named", () => {
    const reason = skipReason(
      "Instagram comments",
      new Error("(#200) Requires instagram_manage_comments permission"),
    );
    assert.match(reason, /instagram_manage_comments/);
    assert.match(reason, /Reconnect/);
  });

  it("names the likely permission when Meta does not", () => {
    const reason = skipReason("Messenger conversations", new Error("Unsupported get request"));
    assert.match(reason, /pages_messaging/);
    assert.match(reason, /Unsupported get request/);
  });

  it("tells the workspace to reconnect an expired token", () => {
    const reason = skipReason(
      "Facebook comments",
      new Error("Error validating access token: Session has been invalidated"),
    );
    assert.match(reason, /no longer valid/i);
    assert.match(reason, /Reconnect/);
  });

  it("does not blame a permission for a rate limit", () => {
    const reason = skipReason("Facebook comments", new Error("(#80001) There have been too many calls"));
    assert.match(reason, /rate-limit/i);
    assert.ok(!/pages_read_user_content/.test(reason), "a throttle is not a missing permission");
  });

  it("says plainly when the provider gave no reason at all", () => {
    const reason = skipReason("Instagram comments", undefined);
    assert.match(reason, /without saying why/);
    assert.match(reason, /instagram_manage_comments/);
  });
});

describe("what the person is told after a sync", () => {
  it("a clean sync is a success", () => {
    const s = syncSummary({ ok: true, posts: 20, interactions: 46 });
    assert.equal(s.tone, "success");
    assert.equal(s.text, "Synced 20 posts and 46 comment/DMs");
  });

  it("posts read but comments refused is a warning, not a success", () => {
    // This is the exact case QA hit: 46 posts, 0 comments, green toast.
    const s = syncSummary({
      ok: true,
      posts: 46,
      interactions: 0,
      skipped: [{ what: "Instagram comments", reason: "missing instagram_manage_comments" }],
    });
    assert.equal(s.tone, "warning");
    assert.match(s.text, /Instagram comments could not be read/);
    assert.match(s.detail, /instagram_manage_comments/);
  });

  it("lists several refused sections readably", () => {
    const s = syncSummary({
      ok: true,
      posts: 1,
      interactions: 1,
      skipped: [
        { what: "Facebook comments", reason: "a" },
        { what: "Messenger conversations", reason: "b" },
        { what: "Facebook page details", reason: "c" },
      ],
    });
    assert.match(
      s.text,
      /Facebook comments, Messenger conversations and Facebook page details could not be read/,
    );
    assert.equal(s.text.includes("1 posts"), false, "one post is a post, not posts");
  });

  it("a failed sync keeps its own error", () => {
    const s = syncSummary({ ok: false, posts: 0, interactions: 0, error: "Unknown site key" });
    assert.equal(s.tone, "error");
    assert.equal(s.text, "Unknown site key");
  });
});

describe("the sync no longer swallows what it could not read", () => {
  const server = read("src/lib/social.server.ts");

  it("has no bare catch left in the Meta sync", () => {
    const meta = server.slice(
      server.indexOf("async function syncMeta"),
      server.indexOf("/* ---------- YouTube"),
    );
    assert.equal(meta.includes("} catch {"), false, "a swallowed error is a lost diagnosis");
    assert.ok(meta.split("note(").length - 1 >= 4, "each refused section must be recorded");
  });

  it("returns the refused sections to the caller", () => {
    assert.match(server, /\.\.\.\(skipped\.length \? \{ skipped \} : \{\}\)/);
    assert.match(server, /skipped\?: SkippedSection\[\]/);
  });

  it("is what the Social Hub shows", () => {
    const page = read("src/routes/_authenticated/social.tsx");
    assert.match(page, /syncSummary\(result\)/);
    assert.match(page, /toast\.warning\(summary\.text/);
  });
});

describe("a connection whose Page was never chosen is not a syncable account", () => {
  const page = read("src/routes/_authenticated/social.tsx");

  it("offers Finish connecting instead of a Sync that can only fail", () => {
    // QA saw "Facebook – Never synced" and "Instagram – Never synced" ghost rows
    // whose Sync button did nothing: syncMeta refuses a row with no external_id
    // with "Add the Meta account ID and access token first", which makes no
    // sense for a connection made by signing in.
    assert.match(page, /!a\.external_id \? \(/);
    assert.match(page, /Finish connecting/);
    assert.match(page, /to="\/connect"/);
  });

  it("says what state it is in rather than Never synced", () => {
    assert.match(page, /choose which Page or account to use/);
  });
});
