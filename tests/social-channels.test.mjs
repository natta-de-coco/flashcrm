// Batch 2A — the authorization/channel model, as pure-function tests.
//
//   npm run test:social-channels
//
// Covers progressive scopes derived from the registry, per-channel capability
// states, YouTube discovery parsing, and identifier masking. The database side
// (grants, RLS, the tenant trigger, one authorization -> many channels, the
// authorization lease) is in supabase/verify/verify-social-authorizations.mjs.
//
// MUTATION=grant_all pretends every scope was granted. The suite MUST fail: a
// capability shown as available without its permission is the exact defect
// the channel model exists to prevent.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  connectorDefinition,
  initialTierIds,
  scopesForTiers,
  tierScopes,
  usesChannelModel,
} from "../node_modules/.cache/flas-registry.mjs";
import * as caps from "../node_modules/.cache/flas-channel-caps.mjs";
import { parseMetaChannels, parseYouTubeChannels } from "../node_modules/.cache/flas-authorizations.mjs";
import { DISCOVERY_FAMILY } from "../node_modules/.cache/flas-registry.mjs";

const MUTATION = process.env.MUTATION ?? "";
if (MUTATION === "grant_all") console.log("!! MUTATION: every scope treated as granted — the suite must FAIL");

const RO = "https://www.googleapis.com/auth/youtube.readonly";
const SSL = "https://www.googleapis.com/auth/youtube.force-ssl";
const EMAIL = "https://www.googleapis.com/auth/userinfo.email";
const yt = connectorDefinition("youtube");

const channelCaps = (granted, requested) => {
  const all = [RO, SSL, EMAIL, "openid"];
  return caps.channelCapabilities(yt, MUTATION === "grant_all" ? all : granted, requested);
};
const stateOf = (list, key) => list.find((c) => c.key === key)?.state;

describe("progressive scopes come from the registry", () => {
  test("a first YouTube connection asks for read-only access and sign-in only", () => {
    const scopes = scopesForTiers(yt, initialTierIds(yt)).sort();
    assert.deepEqual(scopes, [EMAIL, RO, "openid"].sort());
  });

  test("the first connection never asks for the edit/delete-capable scope", () => {
    assert.equal(scopesForTiers(yt, initialTierIds(yt)).includes(SSL), false);
  });

  test("enabling comments adds youtube.force-ssl and nothing broader", () => {
    const scopes = scopesForTiers(yt, ["basic", "comments"]);
    assert.ok(scopes.includes(SSL));
    assert.equal(scopes.includes("https://www.googleapis.com/auth/youtube"), false);
    assert.equal(scopes.includes("https://www.googleapis.com/auth/youtube.upload"), false);
  });

  test("a tier for code Flas has not written cannot be requested", () => {
    assert.throws(() => scopesForTiers(yt, ["basic", "replies"]), /cannot be requested/);
  });

  test("an unknown tier is refused rather than ignored", () => {
    assert.throws(() => scopesForTiers(yt, ["everything"]), /Unknown authorization tier/);
  });

  test("every tier's scopes are declared on the connector", () => {
    const declared = new Set([...yt.requestedScopes, ...yt.optionalScopes, ...(yt.identityScopes ?? [])]);
    for (const tier of yt.authorizationTiers) {
      for (const s of tierScopes(yt, tier)) assert.ok(declared.has(s), `${tier.id} needs undeclared ${s}`);
    }
  });

  test("the comments tier warns what Google bundles into its scope", () => {
    const tier = yt.authorizationTiers.find((t) => t.id === "comments");
    assert.match(tier.scopeCaveat ?? "", /edit and delete/);
  });

  test("YouTube uses the channel model; platforms not yet migrated do not", () => {
    assert.equal(usesChannelModel("youtube"), true);
    // Facebook moved to the channel model in Batch 2B. LinkedIn follows in 2C.
    assert.equal(usesChannelModel("linkedin"), false);
  });
});

describe("per-channel capability states", () => {
  const basic = [RO, EMAIL, "openid"];

  test("basic access makes profile and analytics available", () => {
    const list = channelCaps(basic, basic);
    assert.equal(stateOf(list, "profile"), "available");
    assert.equal(stateOf(list, "analytics"), "available");
  });

  test("comments are an upgrade until their permission is granted", () => {
    const list = channelCaps(basic, basic);
    const c = list.find((x) => x.key === "comments_read");
    assert.equal(c.state, "needs_permission");
    assert.equal(c.tierId, "comments");
  });

  test("a permission the user declined reads as declined, not as an upgrade", () => {
    assert.equal(stateOf(channelCaps(basic, [...basic, SSL]), "comments_read"), "declined");
  });

  test("replies are shown as not built yet, never as available", () => {
    assert.equal(stateOf(channelCaps([...basic, SSL], [...basic, SSL]), "comments_reply"), "not_implemented");
  });

  test("YouTube DMs appear only as unsupported, with YouTube's own reason", () => {
    const dm = channelCaps(basic, basic).find((x) => x.key === "direct_messages_read");
    assert.equal(dm.state, "not_supported");
    assert.match(dm.note, /YouTube/);
  });

  test("generic unsupported capabilities are not listed at all", () => {
    const keys = channelCaps(basic, basic).map((c) => c.key);
    for (const k of ["ads_read", "ads_manage", "reviews_read", "webhooks"]) {
      assert.equal(keys.includes(k), false, `${k} should not appear on a YouTube card`);
    }
  });

  test("the summary counts enabled capabilities, not a bare 'Healthy'", () => {
    const s = caps.capabilitySummary(channelCaps(basic, [...basic, SSL]));
    assert.equal(s.enabled, 3);
    assert.equal(s.operational, 2);
    assert.match(s.label, /2 of 3 enabled capabilities operational/);
  });

  test("declined scopes exclude sign-in scopes", () => {
    assert.deepEqual(caps.declinedScopes(yt, [RO], [RO, EMAIL, "openid", SSL]), [SSL]);
  });

  test("upgrade options mark the unbuilt replies tier as not offerable", () => {
    const opts = caps.upgradeOptions(yt, basic);
    const replies = opts.find((o) => o.tier.id === "replies");
    assert.equal(replies.offerable, false);
    assert.equal(opts.find((o) => o.tier.id === "comments").offerable, true);
  });
});

describe("YouTube discovery parsing", () => {
  const fixture = {
    items: [
      {
        id: "UCaaaaaaaaaaaaaaaaaaaa01",
        snippet: {
          title: "A to Z Security Equipment",
          customUrl: "@atozsecurity",
          description: "x".repeat(500),
          thumbnails: { default: { url: "https://yt3.test/d.jpg" }, medium: { url: "https://yt3.test/m.jpg" } },
        },
        statistics: { subscriberCount: "1200", videoCount: "85", viewCount: "40000", hiddenSubscriberCount: false },
      },
      {
        id: "UCbbbbbbbbbbbbbbbbbbbb02",
        snippet: { title: "Hidden Subs Brand" },
        statistics: { subscriberCount: "0", hiddenSubscriberCount: true, videoCount: "3" },
      },
      { snippet: { title: "No id — must be skipped" } },
    ],
  };
  const parsed = parseYouTubeChannels(fixture);

  test("every channel with an id becomes a candidate; one without is skipped", () => {
    assert.equal(parsed.length, 2);
  });

  test("the channel's own name and handle are used, not the Google account's", () => {
    assert.equal(parsed[0].name, "A to Z Security Equipment");
    assert.equal(parsed[0].handle, "@atozsecurity");
  });

  test("a hidden subscriber count is null, never shown as zero", () => {
    assert.equal(parsed[1].metrics.audience, null);
    assert.equal(parsed[0].metrics.audience, 1200);
  });

  test("descriptions are trimmed and the medium thumbnail is preferred", () => {
    assert.equal(parsed[0].description.length, 280);
    assert.equal(parsed[0].avatarUrl, "https://yt3.test/m.jpg");
  });

  test("candidates carry no token or credential fields", () => {
    for (const c of parsed) {
      const text = JSON.stringify(c).toLowerCase();
      assert.equal(/token|secret|bearer/.test(text), false);
    }
  });
});

describe("Meta: progressive scopes and one sign-in for two platforms (Batch 2B)", () => {
  const fb = connectorDefinition("facebook");
  const ig = connectorDefinition("instagram");

  test("a first Facebook connection never asks for publishing, Messenger or reply permissions", () => {
    const scopes = scopesForTiers(fb, initialTierIds(fb));
    for (const s of ["pages_manage_posts", "pages_messaging", "pages_manage_engagement"]) {
      assert.equal(scopes.includes(s), false, `${s} should not be requested on first connection`);
    }
    assert.deepEqual(
      [...scopes].sort(),
      ["pages_read_engagement", "pages_show_list", "public_profile", "read_insights"].sort(),
    );
  });

  test("a first Instagram connection never asks for publishing or comment permissions", () => {
    const scopes = scopesForTiers(ig, initialTierIds(ig));
    assert.equal(scopes.includes("instagram_content_publish"), false);
    assert.equal(scopes.includes("instagram_manage_comments"), false);
    assert.ok(scopes.includes("pages_show_list"), "Instagram accounts are reached through Pages");
  });

  test("publishing tiers cannot be requested: publishing is not built", () => {
    assert.throws(() => scopesForTiers(fb, ["basic", "publishing"]), /cannot be requested/);
    assert.throws(() => scopesForTiers(ig, ["basic", "publishing"]), /cannot be requested/);
  });

  test("one Meta sign-in discovers both Facebook and Instagram channels", () => {
    assert.deepEqual([...DISCOVERY_FAMILY.facebook].sort(), ["facebook", "instagram"]);
    assert.equal(usesChannelModel("facebook"), true);
    assert.equal(usesChannelModel("instagram"), true);
  });

  const pages = [
    {
      id: "p1", name: "A to Z Security Equipment", username: "atozsecurity", category: "Security",
      picture: "https://fb.test/p1.jpg", followers: 900,
      // Present on the input, exactly as meta-discovery returns it -- and it
      // must never reach a candidate.
      pageAccessToken: "EAAPAGE-TOKEN-p1-SHOULD-NEVER-LEAK",
      tasks: ["MANAGE", "CREATE_CONTENT"],
      instagram: { id: "ig1", username: "atozsecurityequipment", name: "A to Z", picture: "https://ig.test/1.jpg", followers: 4200, biography: "b" },
    },
    {
      id: "p2", name: "Rover Walkie Talkie UAE", username: null, category: null,
      picture: null, followers: null, pageAccessToken: "EAAPAGE-TOKEN-p2", tasks: ["ANALYZE"], instagram: null,
    },
  ];

  test("each Page, and each linked Instagram account, becomes a candidate", () => {
    const c = parseMetaChannels(pages, ["pages_show_list", "instagram_basic"]);
    assert.equal(c.length, 3);
    assert.deepEqual(c.map((x) => `${x.platform}:${x.externalId}`), ["facebook:p1", "instagram:ig1", "facebook:p2"]);
  });

  test("an Instagram candidate names the Page it is linked to", () => {
    const ig1 = parseMetaChannels(pages, ["pages_show_list", "instagram_basic"]).find((x) => x.platform === "instagram");
    assert.equal(ig1.linkedTo.name, "A to Z Security Equipment");
    assert.equal(ig1.handle, "@atozsecurityequipment");
  });

  test("an Instagram account without Instagram permission is shown but not connectable", () => {
    const ig1 = parseMetaChannels(pages, ["pages_show_list"]).find((x) => x.platform === "instagram");
    assert.equal(ig1.eligible, false);
    assert.match(ig1.ineligibleReason, /Instagram access was not granted/);
  });

  test("a Page is not connectable when Page access was not shared", () => {
    const p1 = parseMetaChannels(pages, []).find((x) => x.externalId === "p1");
    assert.equal(p1.eligible, false);
  });

  test("no Page token ever reaches a candidate", () => {
    const text = JSON.stringify(parseMetaChannels(pages, ["pages_show_list", "instagram_basic"]));
    assert.equal(text.includes("EAAPAGE"), false);
    assert.equal(/token/i.test(text), false);
  });
});

describe("Meta long-lived exchange keeps the app secret out of URLs", () => {
  test("it POSTs a form body and the URL carries no secret", async () => {
    const { exchangeForLongLivedToken } = await import("../node_modules/.cache/flas-oauth.mjs");
    process.env.META_APP_ID = "test-app-id";
    process.env.META_APP_SECRET = "SECRET-MUST-NOT-BE-IN-URL";
    let seen;
    const fake = async (url, init) => {
      seen = { url: String(url), init };
      return new Response(JSON.stringify({ access_token: "LONG-LIVED", expires_in: 5184000 }), { status: 200 });
    };
    const set = await exchangeForLongLivedToken({ tenantId: null, token: "SHORT-LIVED", fetchImpl: fake });
    assert.equal(set.token, "LONG-LIVED");
    assert.equal(seen.init.method, "POST");
    assert.equal(seen.url.includes("SECRET-MUST-NOT-BE-IN-URL"), false, "the app secret is in the URL");
    assert.equal(seen.url.includes("client_secret"), false);
    assert.equal(seen.url.includes("SHORT-LIVED"), false, "the user token is in the URL");
    assert.match(String(seen.init.body), /grant_type=fb_exchange_token/);
    assert.ok(set.expiresAt, "the long-lived expiry is recorded");
  });
});

describe("no Connect button for a platform Flas cannot use", () => {
  test("Threads has nothing implemented, so it is not connectable", () => {
    assert.equal(caps.hasNoImplementedCapability(connectorDefinition("threads")), true);
  });
  test("Google Analytics 4 stores a connection only, so it is not connectable", () => {
    assert.equal(caps.hasNoImplementedCapability(connectorDefinition("google_analytics")), true);
  });
  test("YouTube and Facebook have working features, so they are connectable", () => {
    assert.equal(caps.hasNoImplementedCapability(connectorDefinition("youtube")), false);
    assert.equal(caps.hasNoImplementedCapability(connectorDefinition("facebook")), false);
  });
});

describe("identifier masking", () => {
  test("only the last four characters are shown", () => {
    assert.equal(caps.maskIdentifier("UCaaaaaaaaaaaaaaaaaaaa01"), "••••aa01");
  });
  test("a very short id is fully masked", () => {
    assert.equal(caps.maskIdentifier("abc"), "••••");
  });
});
