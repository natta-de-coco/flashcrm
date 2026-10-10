// QA, 26 Sep, Social Hub:
//   H1  the Instagram card showed 3,405 followers after a sync — Facebook's
//       number, not Instagram's.
//   H3  every post was listed twice with no platform label, and the order was
//       6h ago, 2d, 59d, 6h ago …
//   H9  the composer offered "Schedule post" although nothing in Flas ever
//       publishes a saved post, and had no account picker.
//   H10 a saved draft disappeared from the composer and could only be deleted,
//       never edited, from inside "Reach & audience".
//
// Review findings left open on those fixes (PR #36, PR #28), at the end:
//   R1  an Instagram id Meta would not confirm was still synced.
//   R2  "No account" on a draft was saved against the first account found.
//   R3  "Save changes" on a planned post turned it back into a draft.
//   R4  a TikTok account added with a token only could no longer be synced.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { createDb } from "./support/db-double.mjs";

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
const { draftSaveRequest } = loadLib("../src/lib/social-drafts.ts");
const { isUnfinishedConnection } = loadLib("../src/lib/social-account-readiness.ts");
const { syncSummary } = loadLib("../src/lib/sync-report.ts");

// The sync and the handlers that save and update a post, as production runs
// them, with the database and the provider replaced. Built here so the suite
// needs no extra step.
await import("../scripts/build-social-bundle.mjs");
const { syncSocialAccount, saveSocialPost, updateSocialPost } =
  await import("../node_modules/.cache/flas-social.mjs");

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
    // What is sent is built in social-drafts.ts and tested below (R2, R3).
    assert.ok(route.includes("draftSaveRequest(draft, plan)"));
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

/* ───────────────── Review findings on the fixes above (R1–R4) ───────────── */

// From here on the real server code runs: the sync against a stand-in for the
// provider, and the save and update handlers against a stand-in database.

const TENANT = "0b6f4c1e-0000-4000-8000-000000000001";
const IG_ACCOUNT = "0b6f4c1e-0000-4000-8000-0000000000a1";
const FB_ACCOUNT = "0b6f4c1e-0000-4000-8000-0000000000b1";
const TIKTOK_ACCOUNT = "0b6f4c1e-0000-4000-8000-0000000000d1";
const SAVED_POST = "0b6f4c1e-0000-4000-8000-0000000000c1";
/** An Instagram account id, as Meta writes one. */
const IG_ID = "17841400000000000";

const db = createDb();

function startSuite(rows) {
  db.reset(rows);
  globalThis.socialSuite = { db: db.client, audits: [] };
}

/** What a handler receives: the request as it arrives, and the signed-in person's client. */
const asUser = (data) => ({
  data: JSON.parse(JSON.stringify(data)),
  context: { supabase: db.client, userId: "user-1" },
});

/** The database's own error, passed on as it is rather than swallowed. */
const refusedWith = (message) => (error) => error?.message === message;

/**
 * Replaces the network with a stand-in for the provider. `answer` gets the
 * host and path of each request and returns the JSON body, or null to refuse.
 * Nothing real is reachable: an unlisted request is refused, and recorded.
 */
function installProvider(answer) {
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/v[0-9.]+(?=\/)/, "");
    calls.push(`${url.hostname}${path}`);
    const body = answer(url.hostname, path, url.searchParams.get("fields") ?? "") ?? {
      error: { message: `Unsupported get request: ${path}` },
    };
    const refused = Boolean(body.error) && body.error.code !== "ok";
    return { ok: !refused, status: refused ? 400 : 200, json: async () => body };
  };
  return calls;
}

/** Meta's Graph API for one Instagram account; `profile` is its answer to the identity check. */
const instagramGraph = (profile) => (host, path, fields) => {
  if (host !== "graph.facebook.com") return null;
  if (path === "/me") return { id: "102938475610293", name: "The Bakery" };
  if (path === `/${IG_ID}`) {
    return fields.includes("media_count") ? profile : { id: IG_ID, username: "the.bakery" };
  }
  if (path === `/${IG_ID}/media`) {
    return {
      data: [
        {
          id: "m1",
          caption: "Fresh loaves at 8",
          like_count: 4,
          comments_count: 1,
          timestamp: "2026-10-01T08:00:00+0000",
        },
      ],
    };
  }
  if (path === "/m1/comments") {
    return {
      data: [
        {
          id: "c1",
          username: "a.customer",
          text: "Do you deliver?",
          timestamp: "2026-10-01T09:00:00+0000",
        },
      ],
    };
  }
  return null;
};

const instagramAccount = {
  id: IG_ACCOUNT,
  tenant_id: TENANT,
  platform: "instagram",
  external_id: IG_ID,
  access_token: "a-test-token",
  connect_method: "oauth",
};

const accountRow = (fields) => ({
  id: IG_ACCOUNT,
  tenant_id: TENANT,
  platform: "instagram",
  label: "Bakery IG",
  external_id: IG_ID,
  active: true,
  last_synced_at: null,
  stats: { followers: 120 },
  ...fields,
});

describe("R1: an Instagram account Meta will not confirm is not synced", () => {
  let realFetch;
  let realConsoleError;
  beforeEach(() => {
    startSuite({ social_accounts: [accountRow()] });
    realFetch = globalThis.fetch;
    realConsoleError = console.error;
    // The sync logs what it could not read; that is expected here.
    console.error = () => {};
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    console.error = realConsoleError;
  });

  const assertNothingWasSynced = (result, calls) => {
    assert.equal(db.table("social_posts").length, 0, "no post is stored for an unconfirmed id");
    assert.equal(
      db.table("social_interactions").length,
      0,
      "no comment is stored for an unconfirmed id",
    );
    assert.equal(result.posts, 0);
    assert.equal(result.interactions, 0);
    assert.equal(
      calls.some((call) => call.endsWith("/media") || call.endsWith("/comments")),
      false,
      "the posts and comments are not even read",
    );
    const [account] = db.table("social_accounts");
    assert.equal(account.last_synced_at, null, "an account nothing was read from has not synced");
    sameShape(account.stats, { followers: 120 }, "the old number stays as it was");
  };

  it("stores no posts or comments when Meta answers without media_count", async () => {
    // A Facebook Page answers followers_count happily; only media_count proves
    // the id is an Instagram account.
    const calls = installProvider(
      instagramGraph({ id: IG_ID, username: "the.bakery", followers_count: 3405 }),
    );
    const result = await syncSocialAccount(instagramAccount, true);

    assertNothingWasSynced(result, calls);
    // Reported the way every other section that could not be read is.
    assert.equal(result.skipped?.length, 1);
    assert.equal(result.skipped[0].what, "Instagram profile");
    assert.match(result.skipped[0].reason, /could not confirm this id is an Instagram account/);
    // And the words no longer say only the follower count was left alone.
    assert.match(result.skipped[0].reason, /nothing was synced from it/);
    // And it is not a success: nothing was synced, and the person is told why.
    assert.equal(result.ok, false);
    const told = syncSummary(result);
    assert.equal(told.tone, "error");
    assert.equal(told.text, `Instagram profile: ${result.skipped[0].reason}`);
  });

  it("stores nothing when Meta refuses the profile for a missing permission", async () => {
    const calls = installProvider(
      instagramGraph({ error: { message: "(#200) Requires instagram_basic permission" } }),
    );
    const result = await syncSocialAccount(instagramAccount, true);

    assertNothingWasSynced(result, calls);
    assert.equal(result.ok, false);
    assert.equal(result.skipped?.[0]?.what, "Instagram profile");
    assert.match(result.skipped[0].reason, /instagram_basic/);
    assert.match(result.error, /Instagram profile: .*instagram_basic/);
  });

  it("stores nothing when the token has expired, and says to reconnect", async () => {
    const calls = installProvider(
      instagramGraph({
        error: { message: "Error validating access token: Session has expired" },
      }),
    );
    const result = await syncSocialAccount(instagramAccount, true);

    assertNothingWasSynced(result, calls);
    assert.equal(result.ok, false);
    assert.match(result.error, /Reconnect this account/);
  });

  it("still syncs an account Meta confirms", async () => {
    const calls = installProvider(
      instagramGraph({
        id: IG_ID,
        username: "the.bakery",
        followers_count: 3587,
        media_count: 46,
      }),
    );
    const result = await syncSocialAccount(instagramAccount, true);

    assert.equal(result.ok, true);
    assert.equal(result.posts, 1);
    assert.equal(result.interactions, 1);
    assert.equal(result.skipped, undefined);
    assert.ok(calls.some((call) => call.endsWith(`/${IG_ID}/media`)));
    assert.equal(db.table("social_posts")[0].caption, "Fresh loaves at 8");
    assert.equal(db.table("social_interactions")[0].body, "Do you deliver?");
    const [account] = db.table("social_accounts");
    assert.ok(account.last_synced_at, "a real sync is stamped");
    sameShape(account.stats, { followers: 3587 });
  });

  it("still refuses outright an id Meta names as a Facebook Page", async () => {
    const calls = installProvider(
      instagramGraph({
        error: {
          message: "(#100) Tried accessing nonexisting field (media_count) on node type (Page)",
        },
      }),
    );
    const result = await syncSocialAccount(instagramAccount, true);

    assert.equal(result.ok, false);
    assert.match(result.error, /Facebook Page/);
    assertNothingWasSynced(result, calls);
  });
});

/** The composer's state for a new post, as the screen holds it. */
const composing = (fields) => ({
  id: null,
  caption: "  Fresh loaves at 8  ",
  platform: "instagram",
  accountId: null,
  plannedAt: "",
  loadedPlannedAt: "",
  ...fields,
});

describe("R2: a draft saved with 'No account' has no account", () => {
  beforeEach(() => {
    startSuite({
      social_accounts: [
        accountRow(),
        accountRow({ id: FB_ACCOUNT, platform: "facebook", label: "Bakery Page" }),
      ],
    });
  });

  it("the screen says 'no account' outright instead of leaving the account out", () => {
    const request = draftSaveRequest(composing(), false);
    assert.equal(request.kind, "create");
    assert.ok(
      Object.hasOwn(request.data, "accountId"),
      "leaving it out is what made the server pick an account",
    );
    assert.equal(request.data.accountId, null);
    assert.equal(request.data.caption, "Fresh loaves at 8");
    assert.equal(request.data.platform, "instagram");
  });

  it("is saved against no account although an account of that platform is connected", async () => {
    const request = draftSaveRequest(composing(), false);
    await saveSocialPost(asUser(request.data));

    const posts = db.table("social_posts");
    assert.equal(posts.length, 1);
    assert.equal(posts[0].account_id, null, "the screen said this draft has no account");
    assert.equal(posts[0].status, "draft");
    assert.equal(posts[0].caption, "Fresh loaves at 8");
  });

  it("does not go looking for an account when it was told there is none", async () => {
    // If the lookup were made, it would fail and the draft would not be saved.
    db.fail("social_accounts:read", { message: "connection reset" });
    await saveSocialPost(
      asUser({ caption: "Fresh loaves", platform: "instagram", accountId: null }),
    );
    assert.equal(db.table("social_posts")[0].account_id, null);
  });

  it("is saved against the account that was picked", async () => {
    const request = draftSaveRequest(
      composing({ accountId: FB_ACCOUNT, platform: "facebook" }),
      false,
    );
    assert.equal(request.data.accountId, FB_ACCOUNT);
    await saveSocialPost(asUser(request.data));
    assert.equal(db.table("social_posts")[0].account_id, FB_ACCOUNT);
  });

  it("a request that does not mention an account still gets that platform's account", async () => {
    // What a screen loaded before this change sends. Its behaviour is unchanged.
    await saveSocialPost(asUser({ caption: "Fresh loaves", platform: "instagram" }));
    assert.equal(db.table("social_posts")[0].account_id, IG_ACCOUNT);
  });

  it("does not save when that platform's account cannot be looked up", async () => {
    db.fail("social_accounts:read", { message: "connection reset" });
    await assert.rejects(
      saveSocialPost(asUser({ caption: "Fresh loaves", platform: "instagram" })),
      refusedWith("connection reset"),
    );
    assert.equal(db.table("social_posts").length, 0, "a failed lookup is not 'no account'");
    assert.equal(globalThis.socialSuite.audits.length, 0);
  });

  it("does not report a draft as saved when the database refused it", async () => {
    db.fail("social_posts:insert", { message: "connection reset" });
    await assert.rejects(
      saveSocialPost(asUser(draftSaveRequest(composing(), false).data)),
      refusedWith("connection reset"),
    );
    assert.equal(db.table("social_posts").length, 0);
    assert.equal(globalThis.socialSuite.audits.length, 0);
  });

  it("a new post is planned only by 'Save with a planned date'", async () => {
    const typed = composing({ plannedAt: "2026-11-02T09:30" });
    const asDraft = draftSaveRequest(typed, false);
    assert.equal(Object.hasOwn(asDraft.data, "scheduledAt"), false);

    const planned = draftSaveRequest(typed, true);
    assert.equal(planned.data.scheduledAt, new Date("2026-11-02T09:30").toISOString());
    await saveSocialPost(asUser(planned.data));
    const [row] = db.table("social_posts");
    assert.equal(row.status, "scheduled");
    assert.equal(row.scheduled_at, planned.data.scheduledAt);
    assert.equal(row.account_id, null);
  });
});

describe("R3: saving an edit keeps the plan the post already had", () => {
  const LOADED = "2026-11-02T09:30";
  const plannedIso = new Date(LOADED).toISOString();
  const plannedRow = (fields) => ({
    id: SAVED_POST,
    tenant_id: TENANT,
    account_id: IG_ACCOUNT,
    caption: "Old caption",
    status: "scheduled",
    scheduled_at: plannedIso,
    published_at: null,
    ...fields,
  });
  /** The composer's state after a saved post was loaded and its caption rewritten. */
  const editing = (fields) => ({
    id: SAVED_POST,
    caption: "New caption",
    platform: "instagram",
    accountId: IG_ACCOUNT,
    plannedAt: LOADED,
    loadedPlannedAt: LOADED,
    ...fields,
  });
  const savedPost = () => db.table("social_posts")[0];

  beforeEach(() => startSuite({ social_posts: [plannedRow()] }));

  it("'Save changes' on a planned post says nothing about a date it did not touch", () => {
    const request = draftSaveRequest(editing(), false);
    assert.equal(request.kind, "update");
    assert.equal(request.data.id, SAVED_POST);
    assert.equal(
      Object.hasOwn(request.data, "scheduledAt"),
      false,
      "an untouched date is not sent, so it cannot be changed or cleared by accident",
    );
  });

  it("'Save changes' after rewriting the caption leaves the post planned for the same time", async () => {
    await updateSocialPost(asUser(draftSaveRequest(editing(), false).data));

    assert.equal(savedPost().caption, "New caption");
    assert.equal(savedPost().status, "scheduled", "the plan must survive a caption edit");
    assert.equal(savedPost().scheduled_at, plannedIso);
    assert.equal(savedPost().account_id, IG_ACCOUNT);
  });

  it("'Save with this plan' with the date untouched keeps it too", async () => {
    await updateSocialPost(asUser(draftSaveRequest(editing(), true).data));
    assert.equal(savedPost().status, "scheduled");
    assert.equal(savedPost().scheduled_at, plannedIso);
  });

  it("emptying the date field and saving removes the plan, because the person asked", async () => {
    const request = draftSaveRequest(editing({ plannedAt: "" }), false);
    assert.equal(request.data.scheduledAt, null);
    await updateSocialPost(asUser(request.data));

    assert.equal(savedPost().status, "draft");
    assert.equal(savedPost().scheduled_at, null);
    assert.equal(savedPost().caption, "New caption");
  });

  it("a new date is saved whichever button is pressed", async () => {
    const moved = new Date("2026-11-05T14:00").toISOString();
    for (const plan of [false, true]) {
      startSuite({ social_posts: [plannedRow()] });
      const request = draftSaveRequest(editing({ plannedAt: "2026-11-05T14:00" }), plan);
      assert.equal(request.data.scheduledAt, moved, `plan=${plan}`);
      await updateSocialPost(asUser(request.data));
      assert.equal(savedPost().status, "scheduled", `plan=${plan}`);
      assert.equal(savedPost().scheduled_at, moved, `plan=${plan}`);
    }
  });

  it("a draft that is edited stays a draft", async () => {
    startSuite({ social_posts: [plannedRow({ status: "draft", scheduled_at: null })] });
    const request = draftSaveRequest(editing({ plannedAt: "", loadedPlannedAt: "" }), false);
    assert.equal(Object.hasOwn(request.data, "scheduledAt"), false);
    await updateSocialPost(asUser(request.data));

    assert.equal(savedPost().status, "draft");
    assert.equal(savedPost().scheduled_at, null);
    assert.equal(savedPost().caption, "New caption");
  });

  it("a draft given a date becomes a planned post", async () => {
    startSuite({ social_posts: [plannedRow({ status: "draft", scheduled_at: null })] });
    const request = draftSaveRequest(editing({ loadedPlannedAt: "" }), true);
    await updateSocialPost(asUser(request.data));

    assert.equal(savedPost().status, "scheduled");
    assert.equal(savedPost().scheduled_at, plannedIso);
  });

  it("'No account' on an edit takes the account off", async () => {
    const request = draftSaveRequest(editing({ accountId: null }), false);
    assert.equal(request.data.accountId, null);
    await updateSocialPost(asUser(request.data));

    assert.equal(savedPost().account_id, null);
    assert.equal(savedPost().status, "scheduled", "and still does not touch the plan");
  });

  it("a request that names neither an account nor a date changes only the caption", async () => {
    // What a caller that says nothing else sends: nothing it did not say is touched.
    await updateSocialPost(asUser({ id: SAVED_POST, caption: "Only the words changed" }));

    assert.equal(savedPost().caption, "Only the words changed");
    assert.equal(savedPost().account_id, IG_ACCOUNT, "the account is kept");
    assert.equal(savedPost().status, "scheduled", "the plan is kept");
    assert.equal(savedPost().scheduled_at, plannedIso);
  });

  it("a published post is still refused, and left as it was", async () => {
    startSuite({ social_posts: [plannedRow({ status: "published", scheduled_at: null })] });
    await assert.rejects(
      updateSocialPost(asUser(draftSaveRequest(editing(), false).data)),
      /cannot be changed here/,
    );
    assert.equal(savedPost().caption, "Old caption");
    assert.equal(savedPost().status, "published");
  });

  it("an edit the database refused is not reported as saved", async () => {
    db.fail("social_posts:update", { message: "connection reset" });
    await assert.rejects(
      updateSocialPost(asUser(draftSaveRequest(editing(), false).data)),
      refusedWith("connection reset"),
    );
    assert.equal(savedPost().caption, "Old caption");
    assert.equal(savedPost().status, "scheduled");
  });
});

describe("R4: only a sign-in that still needs its account chosen is 'unfinished'", () => {
  const NEEDS_AN_ID = [
    "instagram",
    "facebook",
    "youtube",
    "twitter",
    "linkedin",
    "google_business",
  ];
  let realFetch;
  beforeEach(() => {
    startSuite({
      social_accounts: [
        accountRow({ id: TIKTOK_ACCOUNT, platform: "tiktok", external_id: null, stats: null }),
      ],
    });
    realFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("a TikTok account added with a token only is offered Sync", () => {
    assert.equal(
      isUnfinishedConnection({ platform: "tiktok", external_id: null, connect_method: "manual" }),
      false,
    );
    // TikTok has no account to choose: its sync never uses the id, however the
    // account was connected.
    assert.equal(
      isUnfinishedConnection({ platform: "tiktok", external_id: null, connect_method: "oauth" }),
      false,
    );
  });

  it("and that Sync works: the account is found from the token alone", async () => {
    const calls = installProvider((host, path) => {
      if (host !== "open.tiktokapis.com") return null;
      if (path === "/user/info/") {
        return { data: { user: { follower_count: 80, likes_count: 9, video_count: 1 } } };
      }
      if (path === "/video/list/") {
        return {
          error: { code: "ok" },
          data: { videos: [{ id: "v1", title: "Morning bake", create_time: 1790000000 }] },
        };
      }
      return null;
    });
    const result = await syncSocialAccount(
      {
        id: TIKTOK_ACCOUNT,
        tenant_id: TENANT,
        platform: "tiktok",
        external_id: null,
        access_token: "a-test-token",
        connect_method: "manual",
      },
      true,
    );

    assert.equal(result.ok, true, result.error);
    assert.equal(result.posts, 1);
    assert.equal(db.table("social_posts")[0].caption, "Morning bake");
    assert.ok(calls.every((call) => call.startsWith("open.tiktokapis.com/")));
  });

  it("a sign-in whose Page or account was never chosen is still 'Finish connecting'", () => {
    for (const platform of [...NEEDS_AN_ID, "google_analytics", "search_console", "meta_ads"]) {
      assert.equal(
        isUnfinishedConnection({ platform, external_id: null, connect_method: "oauth" }),
        true,
        platform,
      );
    }
  });

  it("and its Sync could only fail: those platforms' syncs refuse an account with no id", async () => {
    const calls = installProvider(() => null);
    for (const platform of NEEDS_AN_ID) {
      const result = await syncSocialAccount(
        {
          id: IG_ACCOUNT,
          tenant_id: TENANT,
          platform,
          external_id: null,
          access_token: "a-test-token",
          connect_method: "oauth",
        },
        true,
      );
      assert.equal(result.ok, false, platform);
      assert.ok(result.error, platform);
    }
    sameShape(calls, [], "nothing is asked of a provider for an account with no id");
  });

  it("a connection that names its account is finished, however it was made", () => {
    for (const connect_method of ["oauth", "manual", null, undefined]) {
      for (const platform of [...NEEDS_AN_ID, "tiktok"]) {
        assert.equal(
          isUnfinishedConnection({ platform, external_id: "1234567890", connect_method }),
          false,
          `${platform} ${connect_method}`,
        );
      }
    }
  });

  it("a pasted connection is never described as a sign-in to finish", () => {
    // Nothing on Connect & setup is waiting for it, so the link would lead
    // nowhere; Sync says which detail is missing.
    for (const platform of NEEDS_AN_ID) {
      assert.equal(
        isUnfinishedConnection({ platform, external_id: null, connect_method: "manual" }),
        false,
        platform,
      );
    }
  });

  it("the screen asks this rule for the wording and for the button", () => {
    const route = read("src/routes/_authenticated/social.tsx");
    const card = route.slice(
      route.indexOf("function AccountsCard("),
      route.indexOf("function InboxTab("),
    );
    assert.ok(card.length > 0);
    assert.equal(card.split("isUnfinishedConnection(a)").length - 1, 2);
    assert.equal(card.includes("!a.external_id"), false, "a missing id alone decides nothing");
  });

  it("the screen is told how each account was connected", () => {
    const functions = read("src/lib/social.functions.ts");
    const hub = functions.slice(
      functions.indexOf("export const getSocialHub"),
      functions.indexOf("export const connectSocialAccount"),
    );
    assert.ok(hub.length > 0);
    assert.match(hub, /"id, tenant_id, platform, label, external_id, connect_method, /);
  });
});
