import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSync } from "esbuild";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
buildSync({
  entryPoints: ["src/lib/home-guide.ts"],
  outfile: "node_modules/.cache/home-guide.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  logLevel: "error",
});
const { homeActionsFor, homePriority } = createRequire(import.meta.url)(
  "../node_modules/.cache/home-guide.cjs",
);
test("new or unknown roles are not offered privileged tasks", () => {
  for (const role of [null, undefined, "", "unknown", "__proto__"])
    assert.deepEqual(homeActionsFor(role), []);
});
test("an article editor sees writing tasks, without customer, sales or setup links", () => {
  assert.deepEqual(
    homeActionsFor("seo_editor").map((a) => a.to),
    ["/seo-blog/studio", "/content"],
  );
});
test("front-line staff get customer work, without marketing or admin actions", () => {
  assert.deepEqual(
    homeActionsFor("staff").map((a) => a.to),
    ["/inbox", "/contacts", "/sales", "/catalog"],
  );
  assert.ok(homeActionsFor("company_admin").some((a) => a.to === "/social"));
});
test("a failed or old overview cannot become a clean inbox recommendation", () => {
  assert.equal(homePriority(null), null);
  assert.equal(homePriority({ open: 0, contacts: 0, activity: 0, hasConversations: false }), null);
});
test("unread chats take priority, while closed history is not a first-ever conversation", () => {
  const empty = {
    open: 0,
    unreadConversations: 0,
    contacts: 0,
    activity: 0,
    hasConversations: false,
  };
  assert.equal(homePriority(empty), "new");
  assert.equal(homePriority({ ...empty, hasConversations: true }), "caughtUp");
  assert.equal(homePriority({ ...empty, open: 8 }), "open");
  assert.equal(homePriority({ ...empty, open: 8, unreadConversations: 2 }), "unread");
});
test("dashboard data and late AI answers stay scoped, and generation requires an explicit action", () => {
  const source = readFileSync("src/routes/_authenticated/dashboard.tsx", "utf8");
  assert.match(source, /queryKey: \["dashboard-overview", scope\]/);
  assert.doesNotMatch(source, /placeholderData: keepPreviousData/);
  assert.match(source, /queryKey: \["dashboard-daily-brief", scope\],\s*enabled: false/);
  assert.match(source, /qc\.setQueryData\(\["dashboard-daily-brief", request\.scope\], data\)/);
  assert.match(source, /regenerateBrief\.mutate\(\{ scope \}\)/);
  assert.match(source, /enabled: !!tenant && isCompanyManager\(staffRole\)/);
  assert.match(source, /search=\{\{ conversation: c\.id \}\}/);
});
