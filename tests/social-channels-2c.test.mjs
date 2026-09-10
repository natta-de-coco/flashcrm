// Batch 2C — LinkedIn Pages, TikTok, X and Pinterest on the channel model.
//
//   npm run test:social-channels
//
// Pure parsers against fixtures, discovery against a recording fake fetch, the
// progressive scopes each connector now asks for, and the token-endpoint
// client authentication Pinterest and X require.
//
// MUTATION=legacy_scopes replays the scope lists these connectors requested
// before 2C (write permissions for publishing code that does not exist). The
// suite MUST fail: it exists to stop exactly that.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  connectorDefinition,
  initialTierIds,
  scopesForTiers,
  usesChannelModel,
  DISCOVERY_FAMILY,
} from "../node_modules/.cache/flas-registry.mjs";
import {
  discoverLinkedInOrganizations,
  discoverSingleAccount,
  linkedInOrgId,
  parseLinkedInOrganizations,
  parsePinterestUser,
  parseTikTokUser,
  parseXUser,
  tiktokUserFields,
} from "../node_modules/.cache/flas-authorizations.mjs";
import { exchangeCode, tokenRequestHeaders } from "../node_modules/.cache/flas-oauth.mjs";

const MUTATION = process.env.MUTATION ?? "";
if (MUTATION === "legacy_scopes") console.log("!! MUTATION: pre-2C scope lists — the suite must FAIL");

const LEGACY = {
  linkedin: ["r_organization_social", "w_organization_social", "rw_organization_admin"],
  tiktok: ["user.info.basic", "user.info.profile", "user.info.stats", "video.list"],
  twitter: ["tweet.read", "tweet.write", "users.read", "offline.access"],
  pinterest: ["boards:read", "pins:read", "pins:write", "user_accounts:read"],
};
const firstConnection = (id) => {
  if (MUTATION === "legacy_scopes") return LEGACY[id];
  const def = connectorDefinition(id);
  return scopesForTiers(def, initialTierIds(def));
};

/** A fetch that records every request and answers from a route table. */
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const hit = routes.find(([match]) => String(url).includes(match));
    if (!hit) return new Response("{}", { status: 404 });
    const [, status, body] = hit;
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
  return { impl, calls };
}

const WRITE_SCOPES = ["w_organization_social", "tweet.write", "pins:write", "video.publish", "video.upload", "dm.write"];

describe("first connection asks only for what Flas uses", () => {
  test("LinkedIn: Page listing and statistics, no posting permission", () => {
    assert.deepEqual([...firstConnection("linkedin")].sort(), ["r_organization_social", "rw_organization_admin"]);
  });

  test("X: read, profile and a refresh token; no posting permission", () => {
    assert.deepEqual([...firstConnection("twitter")].sort(), ["offline.access", "tweet.read", "users.read"]);
  });

  test("Pinterest: the account only", () => {
    assert.deepEqual(firstConnection("pinterest"), ["user_accounts:read"]);
  });

  test("TikTok: profile, stats and video list, no publishing", () => {
    assert.deepEqual(
      [...firstConnection("tiktok")].sort(),
      ["user.info.basic", "user.info.profile", "user.info.stats", "video.list"],
    );
  });

  test("no connector requests a write scope on its first connection", () => {
    for (const id of ["linkedin", "tiktok", "twitter", "pinterest"]) {
      for (const s of firstConnection(id)) {
        assert.ok(!WRITE_SCOPES.includes(s), `${id} requests ${s} on first connection`);
      }
    }
  });

  test("publishing cannot be requested while it is not built", () => {
    for (const id of ["linkedin", "tiktok", "twitter", "pinterest"]) {
      assert.throws(() => scopesForTiers(connectorDefinition(id), ["publishing"]), /cannot be requested/);
    }
  });

  test("all four use the channel model, each discovering only itself", () => {
    for (const id of ["linkedin", "tiktok", "twitter", "pinterest"]) {
      assert.equal(usesChannelModel(id), true, id);
      assert.deepEqual(DISCOVERY_FAMILY[id], [id]);
    }
  });
});

describe("LinkedIn organization discovery", () => {
  const acls = {
    elements: [
      { role: "ADMINISTRATOR", state: "APPROVED", organization: "urn:li:organization:111", roleAssignee: "urn:li:person:abc" },
      { role: "ANALYST", state: "APPROVED", organization: "urn:li:organization:222" },
      { role: "CONTENT_ADMINISTRATOR", state: "APPROVED", organizationTarget: "urn:li:organization:111" },
      { role: "ADMINISTRATOR", state: "REQUESTED", organization: "urn:li:organization:333" },
      { role: "ADMINISTRATOR", state: "APPROVED", organization: "urn:li:school:444" },
    ],
  };
  const orgs = {
    results: {
      111: { id: 111, localizedName: "Acme Ltd", vanityName: "acme", primaryOrganizationType: "NONE" },
      222: { id: 222, localizedName: "Acme Labs", primaryOrganizationType: "BRAND" },
    },
  };

  test("organization URNs parse; anything else is rejected", () => {
    assert.equal(linkedInOrgId("urn:li:organization:42"), "42");
    assert.equal(linkedInOrgId("urn:li:school:42"), null);
    assert.equal(linkedInOrgId("urn:li:organization:42x"), null);
    assert.equal(linkedInOrgId(undefined), null);
  });

  test("one candidate per approved Page; pending roles and non-organizations are skipped", () => {
    const out = parseLinkedInOrganizations(acls, orgs);
    assert.deepEqual(out.map((c) => c.externalId).sort(), ["111", "222"]);
  });

  test("a Super admin can connect; the external id is the numeric id the sync expects", () => {
    const acme = parseLinkedInOrganizations(acls, orgs).find((c) => c.externalId === "111");
    assert.equal(acme.eligible, true);
    assert.equal(acme.name, "Acme Ltd");
    assert.equal(acme.handle, "acme");
    assert.match(acme.description, /Super admin/);
    assert.match(acme.description, /Content admin/);
  });

  test("an Analyst sees the Page but cannot connect it, and is told why", () => {
    const labs = parseLinkedInOrganizations(acls, orgs).find((c) => c.externalId === "222");
    assert.equal(labs.eligible, false);
    assert.match(labs.ineligibleReason, /Super admins/);
    assert.match(labs.ineligibleReason, /Analyst/);
    assert.equal(labs.accountType, "LinkedIn showcase page");
  });

  test("a Page whose name lookup failed still appears", () => {
    const out = parseLinkedInOrganizations(acls, {});
    assert.equal(out.find((c) => c.externalId === "111").name, "LinkedIn page");
  });

  test("discovery sends the current API version and looks admins and others up separately", async () => {
    const f = fakeFetch([
      ["organizationAcls", 200, acls],
      ["organizationsLookup", 200, { results: { 222: orgs.results[222] } }],
      ["rest/organizations?", 200, { results: { 111: orgs.results[111] } }],
    ]);
    const r = await discoverLinkedInOrganizations("tok-li", f.impl);
    assert.equal(r.ok, true);
    assert.equal(r.memberId, "abc");
    assert.equal(r.channels.find((c) => c.externalId === "222").name, "Acme Labs");
    for (const c of f.calls) {
      assert.equal(c.init.headers["LinkedIn-Version"], "202608");
      assert.equal(c.init.headers["X-Restli-Protocol-Version"], "2.0.0");
      assert.ok(!c.url.includes("tok-li"), "token in URL");
    }
    assert.ok(f.calls.some((c) => c.url.includes("rest/organizations?ids=List(111)")));
    assert.ok(f.calls.some((c) => c.url.includes("organizationsLookup?ids=List(222)")));
  });

  test("a refused role query is reported as missing permission, not as no Pages", async () => {
    const f = fakeFetch([["organizationAcls", 403, { message: "Not enough permissions" }]]);
    const r = await discoverLinkedInOrganizations("t", f.impl);
    assert.deepEqual(r, { ok: false, code: "scope_incomplete", httpStatus: 403 });
  });
});

describe("TikTok, X and Pinterest discovery", () => {
  test("TikTok asks only for fields its granted scopes cover", () => {
    assert.equal(tiktokUserFields(["user.info.basic"]), "open_id,avatar_url,avatar_url_100,display_name");
    const all = tiktokUserFields(["user.info.basic", "user.info.profile", "user.info.stats"]);
    for (const f of ["username", "bio_description", "follower_count", "video_count"]) assert.ok(all.includes(f));
  });

  test("TikTok user parses; no open_id means no account", () => {
    const [c] = parseTikTokUser({
      data: { user: { open_id: "oid-1", display_name: "Chef Ana", username: "chefana", follower_count: 1200, video_count: 40 } },
    });
    assert.equal(c.externalId, "oid-1");
    assert.equal(c.handle, "@chefana");
    assert.deepEqual(c.metrics, { audience: 1200, content: 40, views: null });
    assert.deepEqual(parseTikTokUser({ data: { user: {} } }), []);
  });

  test("TikTok's 200-with-error answer is a failure, not an empty account", async () => {
    const f = fakeFetch([["user/info", 200, { error: { code: "scope_not_authorized" } }]]);
    const r = await discoverSingleAccount("tiktok", "t", ["user.info.basic"], f.impl);
    assert.equal(r.ok, false);
    assert.ok(!f.calls[0].url.includes("follower_count"), "asked for a field without its scope");
  });

  test("X user parses; the id must be numeric, as the sync requires", () => {
    const [c] = parseXUser({
      data: { id: "12345", name: "Acme", username: "acme", public_metrics: { followers_count: 9, tweet_count: 3 } },
    });
    assert.equal(c.externalId, "12345");
    assert.equal(c.metrics.content, 3);
    assert.deepEqual(parseXUser({ data: { id: "abc" } }), []);
  });

  test("X discovery calls users/me with the token in a header only", async () => {
    const f = fakeFetch([["users/me", 200, { data: { id: "1", username: "a" } }]]);
    const r = await discoverSingleAccount("twitter", "tok-x", [], f.impl);
    assert.equal(r.ok, true);
    assert.match(f.calls[0].url, /^https:\/\/api\.x\.com\/2\/users\/me\?/);
    assert.equal(f.calls[0].init.headers.Authorization, "Bearer tok-x");
    assert.ok(!f.calls[0].url.includes("tok-x"));
  });

  test("Pinterest account parses; a negative count is not shown as a number", () => {
    const [c] = parsePinterestUser({
      id: "p1", username: "acme", account_type: "BUSINESS", business_name: "Acme", follower_count: 50, monthly_views: -1,
    });
    assert.equal(c.accountType, "Pinterest business account");
    assert.equal(c.name, "Acme");
    assert.equal(c.metrics.views, null);
    assert.deepEqual(parsePinterestUser({}), []);
  });
});

describe("token endpoint client authentication", () => {
  test("Pinterest and X use HTTP Basic; others do not", () => {
    assert.equal(tokenRequestHeaders("pinterest", "id", "sec").Authorization, `Basic ${btoa("id:sec")}`);
    assert.equal(tokenRequestHeaders("twitter", "id", "sec").Authorization, `Basic ${btoa("id:sec")}`);
    assert.equal(tokenRequestHeaders("google", "id", "sec").Authorization, undefined);
    assert.equal(tokenRequestHeaders("meta", "id", "sec").Authorization, undefined);
  });

  const withFetch = async (provider, env, run) => {
    const saved = globalThis.fetch;
    const old = {};
    for (const [k, v] of Object.entries(env)) {
      old[k] = process.env[k];
      process.env[k] = v;
    }
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ access_token: "a", refresh_token: "r", expires_in: 60, scope: "x" }), {
        status: 200,
      });
    };
    try {
      await run();
    } finally {
      globalThis.fetch = saved;
      for (const [k, v] of Object.entries(old)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
    return calls;
  };

  test("a Pinterest code exchange sends the secret in the Basic header only", async () => {
    const calls = await withFetch("pinterest", { PINTEREST_APP_ID: "pid", PINTEREST_APP_SECRET: "psecret" }, () =>
      exchangeCode({ provider: "pinterest", code: "c", redirectUri: "https://app.example/cb" }),
    );
    const body = new URLSearchParams(calls[0].init.body);
    assert.equal(calls[0].init.headers.Authorization, `Basic ${btoa("pid:psecret")}`);
    assert.equal(body.get("client_secret"), null);
    assert.equal(body.get("client_id"), null);
    assert.ok(!calls[0].url.includes("psecret"));
  });

  test("an X code exchange: Basic header, client_id and PKCE verifier in the body, no secret", async () => {
    const calls = await withFetch("twitter", { X_CLIENT_ID: "xid", X_CLIENT_SECRET: "xsecret" }, () =>
      exchangeCode({ provider: "twitter", code: "c", redirectUri: "https://app.example/cb", codeVerifier: "v".repeat(43) }),
    );
    const body = new URLSearchParams(calls[0].init.body);
    assert.equal(calls[0].init.headers.Authorization, `Basic ${btoa("xid:xsecret")}`);
    assert.equal(body.get("client_id"), "xid");
    assert.equal(body.get("client_secret"), null);
    assert.equal(body.get("code_verifier"), "v".repeat(43));
  });
});
