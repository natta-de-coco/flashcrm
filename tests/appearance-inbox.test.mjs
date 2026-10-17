import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSync } from "esbuild";
import { createRequire } from "node:module";
import vm from "node:vm";
const require = createRequire(import.meta.url);
function bundle(file, name) {
  buildSync({
    entryPoints: [file],
    outfile: `node_modules/.cache/${name}.cjs`,
    bundle: true,
    platform: "node",
    format: "cjs",
    logLevel: "error",
  });
  return require(`../node_modules/.cache/${name}.cjs`);
}
const themes = bundle("src/lib/appearance.ts", "appearance-model");
const drafts = bundle("src/lib/inbox-drafts.ts", "inbox-draft-model");
const presentation = bundle("src/lib/inbox-presentation.ts", "inbox-presentation-model");
const { InboxSendSession } = bundle("src/lib/inbox-send-session.ts", "inbox-send-session-model");

test("pending sends and lost-response references survive chat changes and route remounts", () => {
  const session = new InboxSendSession();
  let refs = 0;
  const next = () => `ref-${++refs}`;
  const first = session.begin("A:Hello", "A", next);
  // The provider retains the session while InboxPage leaves and returns.
  const remounted = session;
  assert.equal(remounted.isPending("A"), true);
  assert.equal(remounted.begin("A:Hello", "A", next), null);
  assert.equal(remounted.begin("A:New text", "A", next), null);
  session.finish("A:Hello", first.ref, false);
  const other = remounted.begin("B:Hello", "B", next);
  session.finish("B:Hello", other.ref, true);
  assert.equal(remounted.begin("A:Hello", "A", next).ref, first.ref);
  session.finish("A:Hello", first.ref, true);
  assert.notEqual(remounted.begin("A:Hello", "A", next).ref, first.ref);
});

test("template and reply clicks share a synchronous per-conversation lock", () => {
  const session = new InboxSendSession();
  const template = session.begin("template:A:invoice", "A", () => "template-ref");
  assert.equal(
    session.begin("reply:A:Hello", "A", () => "reply-ref"),
    null,
  );
  session.finish(template.key, "stale-ref", true);
  assert.equal(session.isPending("A"), true);
  session.finish(template.key, template.ref, false);
  assert.equal(session.begin(template.key, "A", () => "new-ref").ref, template.ref);
  assert.equal(new InboxSendSession().isPending("A"), false, "a new identity owns no old attempts");
});
test("corrupt, legacy and malicious preferences keep the readable FLAS defaults", () => {
  for (const value of [
    null,
    "dark",
    [],
    { theme: "javascript:bad", effects: "false", density: "tiny", role: "super_admin" },
  ])
    assert.deepEqual(themes.parseAppearance(value), themes.DEFAULT_APPEARANCE);
  assert.deepEqual(
    themes.readAppearance({ getItem: () => "broken JSON" }),
    themes.DEFAULT_APPEARANCE,
  );
  assert.deepEqual(
    themes.readAppearance({
      getItem: () => {
        throw new Error("storage denied");
      },
    }),
    themes.DEFAULT_APPEARANCE,
  );
});
test("system theme follows the device, explicit themes keep the user's choice", () => {
  assert.equal(themes.resolvedTheme("system", true), "dark");
  assert.equal(themes.resolvedTheme("system", false), "light");
  assert.equal(themes.resolvedTheme("grey", true), "grey");
  assert.equal(themes.resolvedTheme("light", true), "light");
});
test("first-paint bootstrap and preference model agree, without requiring working storage", () => {
  for (const theme of ["light", "grey", "dark", "system", "unknown"]) {
    const root = {
      classList: {
        toggle: (name, value) => {
          root.dark = value;
        },
      },
      dataset: {},
      style: {},
    };
    const context = {
      document: { documentElement: root },
      localStorage: { getItem: () => JSON.stringify({ theme, motion: false, wallpaper: false }) },
      matchMedia: () => ({ matches: true }),
    };
    vm.runInNewContext(themes.APPEARANCE_BOOTSTRAP, context);
    assert.equal(
      root.dataset.theme,
      themes.resolvedTheme(themes.parseAppearance({ theme }).theme, true),
    );
    assert.equal(root.dark, root.dataset.theme === "dark");
    assert.equal(root.dataset.motion, "off");
    assert.equal(root.dataset.wallpaper, "off");
  }
  assert.doesNotThrow(() =>
    vm.runInNewContext(themes.APPEARANCE_BOOTSTRAP, {
      localStorage: {
        getItem: () => {
          throw new Error("denied");
        },
      },
    }),
  );
});
test("switching conversations retains separate unsent replies", () => {
  let state = drafts.emptyDrafts("user-A:company-A");
  state = drafts.changeDraft(state, state.scope, "chat-A", "First reply");
  state = drafts.changeDraft(state, state.scope, "chat-B", "Different reply");
  assert.deepEqual(state.values, { "chat-A": "First reply", "chat-B": "Different reply" });
});
test("a late send acknowledgement clears only the original unchanged reply", () => {
  const scope = "user-A:company-A";
  let state = drafts.changeDraft(drafts.emptyDrafts(scope), scope, "chat-A", "Hello");
  state = drafts.changeDraft(state, scope, "chat-B", "Keep this");
  state = drafts.acknowledgeReply(state, scope, "chat-A", " Hello ");
  assert.equal(state.values["chat-A"], undefined);
  assert.equal(state.values["chat-B"], "Keep this");
  state = drafts.changeDraft(state, scope, "chat-A", "A newer reply");
  assert.equal(drafts.acknowledgeReply(state, scope, "chat-A", "Hello"), state);
});
test("old requests cannot revive drafts after a company or user change", () => {
  const state = drafts.changeDraft(
    drafts.emptyDrafts("user-B:company-B"),
    "user-B:company-B",
    "same-id",
    "New company draft",
  );
  assert.equal(
    drafts.acknowledgeReply(state, "user-A:company-A", "same-id", "New company draft"),
    state,
  );
  assert.equal(
    drafts.insertSuggestion(
      state,
      "user-A:company-A",
      "same-id",
      "New company draft",
      "Old suggestion",
    ),
    state,
  );
  assert.deepEqual(drafts.changeDraft(state, "user-C:company-C", "chat-C", "Only here").values, {
    "chat-C": "Only here",
  });
});
test("AI drafts are suggestions and never overwrite edits made while waiting", () => {
  const scope = "A";
  let state = drafts.changeDraft(drafts.emptyDrafts(scope), scope, "chat-A", "Initial");
  assert.equal(
    drafts.insertSuggestion(state, scope, "chat-A", "Initial", "Suggestion").values["chat-A"],
    "Suggestion",
  );
  state = drafts.changeDraft(state, scope, "chat-A", "I kept typing");
  assert.equal(drafts.insertSuggestion(state, scope, "chat-A", "Initial", "Suggestion"), state);
});
test("unknown, unconfirmed and absent delivery states never become sent", () => {
  for (const status of [null, undefined, "unconfirmed", "unexpected", "received", ""])
    assert.equal(presentation.deliveryPresentation(status), "unknown");
  for (const status of ["sent", "delivered", "read", "failed"])
    assert.equal(presentation.deliveryPresentation(status), status);
  assert.equal(presentation.deliveryPresentation("sending"), "waiting");
});
test("chat times use company timezone and broken timestamps cannot crash the thread", () => {
  const dubai = { locale: "en", timezone: "Asia/Dubai" };
  const london = { locale: "en", timezone: "Europe/London" };
  assert.notEqual(
    presentation.formatInboxTime("2026-10-14T10:00:00Z", dubai),
    presentation.formatInboxTime("2026-10-14T10:00:00Z", london),
  );
  assert.equal(presentation.formatInboxTime("bad", dubai), "—");
  assert.equal(presentation.formatInboxDay("bad", dubai), "—");
});
