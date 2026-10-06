// QA, 26 Sep, Social Hub:
//   H1  the Instagram card showed 3,405 followers after a sync — Facebook's
//       number, not Instagram's.
//   H3  every post was listed twice with no platform label, and the order was
//       6h ago, 2d, 59d, 6h ago …
//   H9  the composer offered "Schedule post" although nothing in Flas ever
//       publishes a saved post, and had no account picker.
//   H10 a saved draft disappeared from the composer and could only be deleted,
//       never edited, from inside "Reach & audience".
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

// The libraries run in their own VM realm, so an object they return does not
// share this realm's prototypes and deepStrictEqual refuses it. Compare shapes
// through JSON instead.
const sameShape = (actual, expected, message) =>
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);
const ids = (posts) => posts.map((p) => p.id).join(",");

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
    .split("\r\n")
    .join("\n");

const { isMetaNodeId, metaErrorNodeType, isInstagramNodeType, readInstagramIdentity } = loadLib(
  "../src/lib/instagram-identity.ts",
);
const {
  postDateIso,
  postSortValue,
  sortPostsByDateDesc,
  sortPostsByDateAsc,
  groupPostsByState,
  isEditablePost,
  postStatusLabel,
  postAttribution,
  humanizePlatformId,
} = loadLib("../src/lib/social-posts.ts");
const { SOCIAL_HUB_CAN_PUBLISH, publishReality, plannedPostNote } = loadLib(
  "../src/lib/social-publishing.ts",
);
const { CONNECTOR_DEFINITIONS, resolveCapability } = loadLib(
  "../src/lib/social-connector-definitions.ts",
);

/* ───────────────────────── H1: whose followers are these? ───────────────── */

describe("an Instagram connection must prove it is on Instagram", () => {
  it("refuses when Meta says the id is a Facebook Page", () => {
    // What Meta answers for /{page-id}?fields=...,media_count — media_count
    // exists only on an Instagram user node, so the Page is named outright.
    const verdict = readInstagramIdentity({
      storedId: "102938475610293",
      errorMessage: "(#100) Tried accessing nonexisting field (media_count) on node type (Page)",
    });
    assert.equal(verdict.kind, "wrong_account");
    assert.equal(verdict.nodeType, "Page");
    assert.match(verdict.message, /Facebook Page/);
    assert.match(verdict.message, /Reconnect Instagram/);
  });

  it("stores the Instagram account's own follower count when Meta confirms it", () => {
    const verdict = readInstagramIdentity({
      storedId: "17841400000000000",
      profile: {
        id: "17841400000000000",
        username: "the.bakery",
        followers_count: 3587,
        media_count: 46,
      },
    });
    assert.equal(verdict.kind, "instagram");
    assert.equal(verdict.followers, 3587);
    assert.equal(verdict.username, "the.bakery");
  });

  it("never invents a number when Meta answered without media_count", () => {
    // A Page answers followers_count happily. Accepting that reply is exactly
    // how the Instagram card came to show Facebook's 3,405.
    const verdict = readInstagramIdentity({
      storedId: "102938475610293",
      profile: { id: "102938475610293", username: "the.bakery", followers_count: 3405 },
    });
    assert.equal(verdict.kind, "unconfirmed");
    assert.equal(verdict.followers, undefined);
  });

  it("treats a missing permission as unknown, not as the wrong account", () => {
    const verdict = readInstagramIdentity({
      storedId: "17841400000000000",
      errorMessage: "(#200) Requires instagram_basic permission",
    });
    assert.equal(verdict.kind, "unconfirmed");
    assert.match(verdict.message, /instagram_basic/);
  });

  it("does not refuse when the node Meta named is Instagram's own", () => {
    const verdict = readInstagramIdentity({
      storedId: "17841400000000000",
      errorMessage: "(#100) Tried accessing nonexisting field (media_count) on node type (IGUser)",
    });
    assert.equal(verdict.kind, "unconfirmed");
  });

  it("rejects an id that is not a Graph node id at all", () => {
    for (const storedId of ["the.bakery", "accounts/1/locations/2", "", "  "]) {
      assert.equal(readInstagramIdentity({ storedId }).kind, "wrong_account", storedId);
    }
  });

  it("reads the node type out of Meta's message", () => {
    assert.equal(metaErrorNodeType("… on node type (Page)"), "Page");
    assert.equal(metaErrorNodeType("… on node type (IGUser)"), "IGUser");
    assert.equal(metaErrorNodeType("Unsupported get request."), null);
    assert.equal(metaErrorNodeType(null), null);
    assert.equal(isInstagramNodeType("IGUser"), true);
    assert.equal(isInstagramNodeType("InstagramUser"), true);
    assert.equal(isInstagramNodeType("Page"), false);
    assert.equal(isInstagramNodeType(null), false);
  });

  it("knows a Graph node id from anything else", () => {
    assert.equal(isMetaNodeId("17841400000000000"), true);
    assert.equal(isMetaNodeId(" 102938475610293 "), true);
    assert.equal(isMetaNodeId("the.bakery"), false);
    assert.equal(isMetaNodeId("123abc"), false);
    assert.equal(isMetaNodeId(null), false);
  });

  it("the sync checks identity before it writes a follower count", () => {
    const source = read("src/lib/social.server.ts");
    const instagramBranch = source.slice(
      source.indexOf('if (account.platform === "instagram")'),
      source.indexOf("\n  } else {"),
    );
    assert.ok(instagramBranch.length > 0, "the Instagram branch should still be there");
    // The old call asked only for followers_count, which a Page also answers.
    assert.ok(
      !instagramBranch.includes("?fields=followers_count"),
      "the Instagram sync must not read followers without confirming the account",
    );
    assert.ok(instagramBranch.includes("readInstagramIdentity"));
    assert.ok(
      instagramBranch.includes('identity.kind === "wrong_account"'),
      "a wrong account must stop the sync",
    );
  });
});

/* ───────────────────────── H3: order and attribution ────────────────────── */

const post = (id, fields) => ({
  id,
  account_id: null,
  status: "published",
  published_at: null,
  scheduled_at: null,
  created_at: null,
  ...fields,
});

describe("the posts list is ordered by the post's own date", () => {
  it("puts 6h ago above 2d above 59d", () => {
    const now = Date.now();
    const hours = (n) => new Date(now - n * 3600_000).toISOString();
    // The order the query returns: sorted by created_at, which a first sync
    // writes in one pass, so it says nothing about the content.
    const rows = [
      post("two-days", { published_at: hours(48) }),
      post("six-hours", { published_at: hours(6) }),
      post("fifty-nine-days", { published_at: hours(59 * 24) }),
    ];
    assert.equal(ids(sortPostsByDateDesc(rows)), "six-hours,two-days,fifty-nine-days");
  });

  it("prefers the published date over the row's created_at", () => {
    const rows = [
      post("old-post-synced-last", {
        published_at: "2019-01-01T00:00:00.000Z",
        created_at: "2026-09-26T10:00:02.000Z",
      }),
      post("new-post-synced-first", {
        published_at: "2026-09-20T00:00:00.000Z",
        created_at: "2026-09-26T10:00:01.000Z",
      }),
    ];
    assert.equal(ids(sortPostsByDateDesc(rows)), "new-post-synced-first,old-post-synced-last");
  });

  it("falls back to scheduled_at, then created_at", () => {
    assert.equal(
      postDateIso(post("a", { published_at: "2026-01-01T00:00:00Z" })),
      "2026-01-01T00:00:00Z",
    );
    assert.equal(
      postDateIso(post("b", { scheduled_at: "2026-02-01T00:00:00Z" })),
      "2026-02-01T00:00:00Z",
    );
    assert.equal(
      postDateIso(post("c", { created_at: "2026-03-01T00:00:00Z" })),
      "2026-03-01T00:00:00Z",
    );
    assert.equal(postDateIso(post("d", {})), null);
    assert.equal(postSortValue(post("e", { published_at: "not a date" })), null);
  });

  it("keeps undated posts at the end and equal dates in their incoming order", () => {
    const same = "2026-09-01T00:00:00.000Z";
    const rows = [
      post("undated", {}),
      post("first-of-the-pair", { published_at: same }),
      post("second-of-the-pair", { published_at: same }),
    ];
    assert.equal(ids(sortPostsByDateDesc(rows)), "first-of-the-pair,second-of-the-pair,undated");
    assert.equal(ids(sortPostsByDateAsc(rows)), "first-of-the-pair,second-of-the-pair,undated");
  });

  it("does not mutate the list it was given", () => {
    const rows = [
      post("b", { published_at: "2026-01-01T00:00:00Z" }),
      post("a", { published_at: "2026-09-01T00:00:00Z" }),
    ];
    sortPostsByDateDesc(rows);
    assert.equal(ids(rows), "b,a");
  });

  it("names the account every post belongs to", () => {
    const accounts = [
      { id: "acc-ig", platform: "instagram", label: "Bakery IG" },
      { id: "acc-fb", platform: "facebook", label: "Bakery Page" },
    ];
    sameShape(postAttribution({ account_id: "acc-ig" }, accounts), {
      platform: "instagram",
      label: "Bakery IG",
      attached: true,
    });
    sameShape(postAttribution({ account_id: "acc-fb" }, accounts), {
      platform: "facebook",
      label: "Bakery Page",
      attached: true,
    });
    // Two identical captions, one per platform, are told apart by the platform.
    assert.notEqual(
      postAttribution({ account_id: "acc-ig" }, accounts).platform,
      postAttribution({ account_id: "acc-fb" }, accounts).platform,
    );
    sameShape(postAttribution({ account_id: null }, accounts), {
      platform: null,
      label: "No account",
      attached: false,
    });
    sameShape(postAttribution({ account_id: "acc-gone" }, accounts), {
      platform: null,
      label: "Account removed",
      attached: false,
    });
  });

  it("spells out a platform it has no icon for instead of guessing", () => {
    assert.equal(humanizePlatformId("google_business"), "Google Business");
    assert.equal(humanizePlatformId("meta_ads"), "Meta Ads");
    assert.equal(humanizePlatformId("pinterest"), "Pinterest");
  });

  it("draws a neutral icon rather than another platform's", () => {
    const source = read("src/routes/_authenticated/social.tsx");
    assert.ok(
      !/platformMeta\(platform\)\.icon/.test(source),
      "an unknown platform must not inherit the first platform's icon",
    );
    assert.ok(source.includes("platformEntry(platform)?.icon ?? Globe"));
    assert.ok(source.includes("PlatformBadge"), "every post row carries a platform badge");
  });
});

/* ───────────────────────── H9: publishing is not built ──────────────────── */

describe("the composer only offers what Flas can actually do", () => {
  it("cannot publish or schedule on any connector", () => {
    assert.equal(SOCIAL_HUB_CAN_PUBLISH, false);
    for (const definition of CONNECTOR_DEFINITIONS) {
      const capability = resolveCapability(definition, "publish");
      const reality = publishReality({
        platform: definition.id,
        displayName: definition.displayName,
        publishStatus: capability.status,
        missingScopes: capability.missingScopes,
      });
      assert.equal(reality.canPublishNow, false, definition.id);
      assert.equal(reality.canSchedule, false, definition.id);
      assert.ok(reality.reason.length > 0, definition.id);
      assert.ok(reality.reason.includes(definition.displayName), definition.id);
    }
  });

  it("says why, in terms of what is missing", () => {
    const instagram = publishReality({
      platform: "instagram",
      displayName: "Instagram",
      publishStatus: "not_implemented",
      missingScopes: ["instagram_content_publish"],
    });
    assert.match(instagram.reason, /nothing in Flas sends a saved post/);
    assert.match(instagram.reason, /instagram_content_publish/);
    // Instagram will not take a caption on its own, and Flas stores no media.
    assert.equal(instagram.needsMedia, true);
    assert.match(instagram.reason, /image or video/);

    const analytics = publishReality({
      platform: "google_analytics",
      displayName: "Google Analytics",
      publishStatus: "not_supported",
    });
    assert.match(analytics.reason, /no publishing API/);
    assert.equal(analytics.needsMedia, false);
  });

  it("never promises a delivery next to the date field", () => {
    assert.match(plannedPostNote(false), /will not post it for you/);
    assert.equal(plannedPostNote(false).includes("Flas will post this"), false);
  });

  it("nothing in the product publishes a saved post", () => {
    // The premise of the whole fix. If a publisher is ever written, this test
    // fails and the UI copy above has to be revisited in the same change.
    for (const path of ["src/lib/social.functions.ts", "src/lib/social.server.ts"]) {
      const source = read(path);
      assert.equal(
        /status === "scheduled"/.test(source),
        false,
        `${path} does not act on a scheduled post`,
      );
    }
  });

  it("the composer shows no control that claims to post", () => {
    const source = read("src/routes/_authenticated/social.tsx");
    assert.equal(source.includes("Publish now"), false);
    assert.equal(source.includes("Schedule post"), false);
    assert.ok(source.includes("publishTruth"), "the reason is read from the registry");
    assert.ok(source.includes("reality.reason"), "and shown to the person");
  });

  it("offers an account to write for, which the save already accepted", () => {
    const route = read("src/routes/_authenticated/social.tsx");
    assert.ok(route.includes("writableAccounts"));
    assert.ok(/accountId: draft\.accountId|accountId: draft\.accountId/.test(route));
    assert.ok(read("src/lib/social.functions.ts").includes("accountId: z.string().uuid()"));
  });
});

/* ───────────────────────── H10: a draft stays reachable ─────────────────── */

describe("a saved draft can be found and rewritten", () => {
  it("splits drafts, planned posts and published ones", () => {
    const rows = [
      post("published-old", { status: "published", published_at: "2024-01-01T00:00:00Z" }),
      post("published-new", { status: "published", published_at: "2026-09-01T00:00:00Z" }),
      post("planned-later", { status: "scheduled", scheduled_at: "2026-12-01T00:00:00Z" }),
      post("planned-sooner", { status: "scheduled", scheduled_at: "2026-10-01T00:00:00Z" }),
      post("draft", { status: "draft", created_at: "2026-09-26T00:00:00Z" }),
    ];
    const groups = groupPostsByState(rows);
    assert.equal(ids(groups.published), "published-new,published-old");
    // A plan is read forwards: the next one first.
    assert.equal(ids(groups.planned), "planned-sooner,planned-later");
    assert.equal(ids(groups.drafts), "draft");
  });

  it("only a post that is not yet published can be edited", () => {
    assert.equal(isEditablePost(post("a", { status: "draft" })), true);
    assert.equal(isEditablePost(post("b", { status: "scheduled" })), true);
    assert.equal(isEditablePost(post("c", { status: "published" })), false);
  });

  it("does not call a saved post 'Scheduled', which would imply Flas sends it", () => {
    assert.equal(postStatusLabel("draft"), "Draft");
    assert.equal(postStatusLabel("scheduled"), "Planned");
    assert.equal(postStatusLabel("published"), "Published");
    assert.equal(postStatusLabel("anything-else"), "Draft");
  });

  it("the composer lists its own drafts and can load one back", () => {
    const source = read("src/routes/_authenticated/social.tsx");
    const composer = source.slice(
      source.indexOf("function ComposerTab("),
      source.indexOf("function PostRow("),
    );
    assert.ok(composer.length > 0);
    assert.ok(composer.includes("groupPostsByState"), "the composer shows the saved drafts");
    assert.ok(composer.includes("updateSocialPost") || source.includes("updateSocialPost"));
    // Said through a translation key now; the English is still these words.
    assert.ok(composer.includes("social.yourDrafts"));
    assert.match(read("src/lib/i18n/screens/social.ts"), /"social\.yourDrafts": "Your drafts"/);
    assert.ok(composer.includes("onEdit"), "a draft can be loaded back into the composer");
  });

  it("a published post is never rewritten in Flas — it lives on the platform", () => {
    const functions = read("src/lib/social.functions.ts");
    const update = functions.slice(
      functions.indexOf("export const updateSocialPost"),
      functions.indexOf("export const deleteSocialPost"),
    );
    assert.ok(update.length > 0, "updateSocialPost should exist");
    assert.ok(update.includes('.neq("status", "published")'));
    assert.ok(update.includes("cannot be changed here"));
  });
});
