// Provider protocol rules from the September verification pass.
//
// Each test is a real provider refusing what Flas sent, confirmed against that
// provider's own documentation and a harness running the real code. A failure
// here means a connection that cannot complete for any customer.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyClientCredentials,
  buildAuthorizeParams,
  startAuthorization,
  tokenEndpointHeaders,
} from "../node_modules/.cache/flas-oauth.mjs";
import { deriveConnectionState } from "../node_modules/.cache/flas-derive-state.mjs";
import { CONNECTOR_DEFINITIONS } from "../node_modules/.cache/flas-registry.mjs";
import { connectionStatus } from "../node_modules/.cache/flas-connection-status.mjs";
import { computeHealth } from "../node_modules/.cache/flas-connections-server.mjs";
import { syncSocialAccount } from "../node_modules/.cache/flas-social-server.mjs";

const base = {
  clientId: "client-id",
  redirectUri: "https://flas.example/api/public/oauth-callback",
  state: "a".repeat(64),
};

describe("authorize requests use each provider's scope format", () => {
  it("TikTok scopes are comma-separated", () => {
    // TikTok's docs: scope is "A comma (,) separated string".
    const p = buildAuthorizeParams({
      ...base,
      provider: "tiktok",
      scopes: ["user.info.basic", "video.list"],
    });
    assert.equal(p.get("scope"), "user.info.basic,video.list");
  });

  it("Meta scopes are comma-separated", () => {
    const p = buildAuthorizeParams({
      ...base,
      provider: "meta",
      scopes: ["pages_show_list", "read_insights"],
    });
    assert.equal(p.get("scope"), "pages_show_list,read_insights");
  });

  for (const provider of ["google", "linkedin", "twitter", "pinterest"]) {
    it(`${provider} scopes are space-separated`, () => {
      const p = buildAuthorizeParams({ ...base, provider, scopes: ["one", "two"] });
      assert.equal(p.get("scope"), "one two");
    });
  }
});

describe("token requests authenticate the way each provider requires", () => {
  const basicPair = (headers) =>
    Buffer.from(String(headers.Authorization).replace(/^Basic /, ""), "base64").toString();

  for (const provider of ["twitter", "pinterest"]) {
    it(`${provider} sends client credentials as HTTP Basic, and not the secret in the body`, () => {
      // X answers unauthorized_client ("Missing valid authorization header")
      // without the header; Pinterest documents it as required.
      const headers = tokenEndpointHeaders(provider, "my-id", "my-secret");
      assert.equal(basicPair(headers), "my-id:my-secret");
      const body = new URLSearchParams();
      applyClientCredentials(body, provider, "my-id", "my-secret");
      assert.equal(body.get("client_secret"), null);
    });
  }

  it("X still receives client_id in the body", () => {
    const body = new URLSearchParams();
    applyClientCredentials(body, "twitter", "my-id", "my-secret");
    assert.equal(body.get("client_id"), "my-id");
  });

  for (const provider of ["google", "linkedin", "meta"]) {
    it(`${provider} uses body credentials and no Basic header`, () => {
      const headers = tokenEndpointHeaders(provider, "my-id", "my-secret");
      assert.equal(headers.Authorization, undefined);
      const body = new URLSearchParams();
      applyClientCredentials(body, provider, "my-id", "my-secret");
      assert.equal(body.get("client_id"), "my-id");
      assert.equal(body.get("client_secret"), "my-secret");
    });
  }

  it("TikTok identifies the client as client_key", () => {
    const body = new URLSearchParams();
    applyClientCredentials(body, "tiktok", "my-key", "my-secret");
    assert.equal(body.get("client_key"), "my-key");
    assert.equal(body.get("client_id"), null);
  });

  it("every token request is form-encoded and asks for JSON", () => {
    for (const provider of ["google", "linkedin", "meta", "tiktok", "twitter", "pinterest"]) {
      const headers = tokenEndpointHeaders(provider, "id", "secret");
      assert.equal(headers["Content-Type"], "application/x-www-form-urlencoded");
      assert.equal(headers.Accept, "application/json");
    }
  });
});

describe("a token that renews itself is not reported as expiring", () => {
  const inAnHour = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const row = {
    active: true,
    access_token: "token",
    token_expires_at: inAnHour,
    granted_scopes: null,
    platform: "youtube",
  };

  it("an hour-long Google token with a refresh token is not 'expiring'", () => {
    // It was, from the moment of connecting, which also hid a declined
    // permission behind the expiry state.
    assert.notEqual(
      deriveConnectionState({ ...row, refresh_token: "refresh" }).state,
      "token_expiring",
    );
  });

  it("the same token with no refresh token is still flagged", () => {
    assert.equal(deriveConnectionState(row).state, "token_expiring");
  });
});

describe("connectors that cannot work are not offered as connectable", () => {
  for (const platform of ["threads", "tiktok_ads", "linkedin_ads", "google_ads"]) {
    it(`${platform} refuses to start an authorization and says why`, async () => {
      // Refuses before touching credentials or the database: the bundle's
      // supabaseAdmin throws if anything reaches it.
      const result = await startAuthorization({
        platform,
        origin: "https://flas.example",
        tenantId: "00000000-0000-0000-0000-000000000001",
        userId: "00000000-0000-0000-0000-000000000002",
      });
      assert.equal(result.ready, false);
      assert.ok(result.reason.length > 20, `no useful reason for ${platform}`);
    });
  }
});

describe("Flas requests only the permissions it uses", () => {
  it("no scope is requested solely for publishing, which Flas does not do", () => {
    for (const c of CONNECTOR_DEFINITIONS) {
      const publish = c.capabilities.publish;
      if (!publish || publish.flasImplements) continue;
      const neededElsewhere = new Set(
        Object.entries(c.capabilities)
          .filter(([key, facts]) => key !== "publish" && facts.flasImplements)
          .flatMap(([, facts]) => facts.requiredScopes),
      );
      for (const scope of publish.requiredScopes) {
        if (neededElsewhere.has(scope)) continue;
        assert.ok(
          !c.requestedScopes.includes(scope),
          `${c.id} requests "${scope}" only for publishing, which Flas does not implement`,
        );
      }
    }
  });

  const scopesOf = (id) => CONNECTOR_DEFINITIONS.find((c) => c.id === id).requestedScopes;

  it("Instagram requests pages_read_engagement, which Meta requires for comments", () => {
    assert.ok(scopesOf("instagram").includes("pages_read_engagement"));
  });

  it("Facebook requests what reading feed comments and conversations needs", () => {
    for (const scope of ["pages_read_user_content", "pages_manage_metadata", "pages_messaging"]) {
      assert.ok(scopesOf("facebook").includes(scope), `facebook is missing ${scope}`);
    }
  });
});

describe("a self-renewing token does not turn a working connection red", () => {
  // A Google access token lasts an hour. With a refresh token stored, its
  // lapse is routine -- yet the Connect card read it as "disconnected" and the
  // status badge as "Token expired" an hour after connecting.
  const anHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const recentSync = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const youtubeScopes = [...CONNECTOR_DEFINITIONS.find((c) => c.id === "youtube").requestedScopes];

  it("the Connect card keeps a lapsed but renewing token connected", () => {
    const health = computeHealth({
      active: true,
      access_token: "set",
      token_expires_at: anHourAgo,
      last_synced_at: recentSync,
      renews: true,
    });
    assert.equal(health, "connected");
  });

  it("without a refresh token the same lapse still reads disconnected", () => {
    const health = computeHealth({
      active: true,
      access_token: "set",
      token_expires_at: anHourAgo,
      last_synced_at: recentSync,
    });
    assert.equal(health, "disconnected");
  });

  it("the status badge does not call a renewing token expired", () => {
    const status = connectionStatus({
      platform: "youtube",
      active: true,
      token_expires_at: anHourAgo,
      last_synced_at: recentSync,
      granted_scopes: youtubeScopes,
      renews: true,
    });
    assert.notEqual(status.state, "expired");
  });

  it("and still does when there is no refresh token", () => {
    const status = connectionStatus({
      platform: "youtube",
      active: true,
      token_expires_at: anHourAgo,
      last_synced_at: recentSync,
      granted_scopes: youtubeScopes,
    });
    assert.equal(status.state, "expired");
  });
});

describe("YouTube sync authenticates the way the credential requires", () => {
  // Sync sent every stored credential as ?key=. An OAuth access token is not an
  // API key, and Google rejects it there with API_KEY_INVALID -- so an
  // OAuth-connected channel connected but never synced.
  const captured = [];
  const realFetch = globalThis.fetch;
  const run = async (account) => {
    captured.length = 0;
    globalThis.fetch = async (url, init) => {
      captured.push({ url: String(url), auth: init?.headers?.Authorization ?? null });
      // An error stops the sync after its first request, before any database write.
      return new Response(JSON.stringify({ error: { message: "stop" } }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    };
    try {
      return await syncSocialAccount(account);
    } finally {
      globalThis.fetch = realFetch;
    }
  };
  const base = { id: "a1", tenant_id: "t1", platform: "youtube", external_id: "UCchannel" };

  it("an OAuth token goes in the Authorization header, never in key=", async () => {
    await run({ ...base, access_token: "ya29.oauth-token", connect_method: "oauth" });
    assert.equal(captured[0].auth, "Bearer ya29.oauth-token");
    assert.doesNotMatch(captured[0].url, /[?&]key=/);
  });

  it("an OAuth token is recognised even when the caller omits connect_method", async () => {
    await run({ ...base, access_token: "ya29.oauth-token", connect_method: null });
    assert.equal(captured[0].auth, "Bearer ya29.oauth-token");
    assert.doesNotMatch(captured[0].url, /[?&]key=/);
  });

  it("a pasted API key still uses key=", async () => {
    await run({ ...base, access_token: "AIzaSyFakeKeyForTests", connect_method: "manual" });
    assert.match(captured[0].url, /[?&]key=AIza/);
    assert.equal(captured[0].auth, null);
  });
});
