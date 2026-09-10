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
import { parseYouTubeChannels } from "../node_modules/.cache/flas-authorizations.mjs";

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
    assert.equal(usesChannelModel("facebook"), false);
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
