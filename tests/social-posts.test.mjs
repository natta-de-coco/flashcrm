// The Social posts screen (it was "Social Hub"). The owner could not find where to
// post to social media. The screen now opens on writing a post, and says
// plainly — in all five languages — that Flas saves and plans posts but does not
// publish them, and that the way out is to copy the post and post it yourself.
// Nothing on the screen may promise publishing or scheduling the code does not do.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

import * as app from "../node_modules/.cache/flas-i18n.mjs";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
    .split("\r\n")
    .join("\n");

const { MESSAGES } = app;
const LANGUAGES = ["en", "ar", "ms", "fil", "sw"];
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

/* ───────────────── the Social posts screen tells the truth ───────────────── */

describe("Social posts says plainly that Flas does not publish", () => {
  const KEYS = [
    "social.socialHub",
    "social.runYourClientSWhole",
    "social.aiComposer",
    "social.noPublishTitle",
    "social.noPublishBody",
    "social.copyThenPost",
    "social.needsMediaNote",
    "social.plannedDateNote",
    "social.copyPost",
    "social.postCopied",
    "social.copyFailed",
  ];

  it("has every new sentence in all five languages with its placeholders", () => {
    for (const key of KEYS) {
      assert.ok(MESSAGES.en[key], `en: ${key} is missing`);
      for (const language of LANGUAGES) {
        const text = MESSAGES[language][key];
        assert.ok(text && text.trim(), `${language}: ${key} is missing`);
        assert.deepEqual(placeholders(text), placeholders(MESSAGES.en[key]), `${language} ${key}`);
      }
    }
  });

  it("is called Social posts and opens on Write a post", () => {
    assert.equal(MESSAGES.en["social.socialHub"], "Social posts");
    assert.equal(MESSAGES.en["social.aiComposer"], "Write a post");
    const screen = read("src/routes/_authenticated/social.tsx");
    // The tab is in the address (?tab=write | comments | reach); no tab means the writer.
    assert.ok(
      screen.includes("parseSocialTab(search.tab)"),
      "the screen should read its tab from the address",
    );
    assert.equal(/useState\("(composer|inbox)"\)/.test(screen), false);
    const order = ["write", "comments", "reach"].map((value) =>
      screen.indexOf(`<TabsTrigger value="${value}"`),
    );
    assert.ok(
      order.every((at) => at > 0),
      "a tab is missing",
    );
    assert.ok(
      order[0] < order[1] && order[1] < order[2],
      "tabs: Write a post, Comments & DMs, Reach",
    );
  });

  it("says, in plain words, that Flas saves and plans posts but does not publish them", () => {
    assert.match(MESSAGES.en["social.noPublishTitle"], /does not publish/i);
    assert.match(MESSAGES.en["social.noPublishBody"], /copy/i);
    assert.match(MESSAGES.en["social.noPublishBody"], /save/i);
    assert.match(MESSAGES.en["social.copyThenPost"], /does not post/i);
    assert.match(MESSAGES.en["social.copyThenPost"], /copy/i);
    assert.match(MESSAGES.en["social.plannedDateNote"], /Nothing happens/);
    const screen = read("src/routes/_authenticated/social.tsx");
    assert.ok(screen.includes("social.noPublishTitle") && screen.includes("social.noPublishBody"));
  });

  it("gives the person something to do instead: copy the post", () => {
    const screen = read("src/routes/_authenticated/social.tsx");
    assert.ok(screen.includes("social.copyPost"), "there is a Copy post button");
    assert.ok(screen.includes("navigator.clipboard.writeText"));
  });

  it("shows no English-only sentence built in code, in any language", () => {
    const screen = read("src/routes/_authenticated/social.tsx");
    assert.equal(screen.includes("reality.reason"), false, "the reason was English-only");
    assert.equal(screen.includes("plannedPostNote("), false, "the date note was English-only");
    assert.ok(screen.includes("social.copyThenPost"));
    assert.ok(screen.includes("social.plannedDateNote"));
  });

  it("promises nothing it does not do", () => {
    const promises =
      /\b(will (be )?(post|publish)(ed)?|posts? automatically|auto-?post|schedule[sd]? (your |a )?post|publish(es)? (it |your post )?for you|post(s)? it for you)\b/i;
    for (const key of Object.keys(MESSAGES.en).filter((k) => k.startsWith("social."))) {
      const text = MESSAGES.en[key];
      // "Flas will not post it for you" is the honest sentence; only a promise fails.
      const withoutNegatives = text.replace(/\b(will|does|do|did) not\b[^.—]*/gi, "");
      assert.ok(!promises.test(withoutNegatives), `${key}: ${text}`);
    }
    const head = read("src/routes/_authenticated/social.tsx").slice(0, 3000);
    assert.ok(head.includes("Social posts — Flas CRM"));
    assert.equal(head.includes("Social Hub"), false);
  });

  it("uses the menu's name for the place accounts are connected", () => {
    assert.equal(MESSAGES.en["social.connectSetup"], "Connect accounts");
  });
});
