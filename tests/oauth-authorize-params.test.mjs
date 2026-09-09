// Facebook Login for Business — the authorization query string.
//
//   node scripts/build-state-bundle.mjs && node --test tests/oauth-authorize-params.test.mjs
//
// The rule that matters: a configuration (config_id) and a scope list are
// alternatives, never both. Meta's guidance is that once a configuration
// exists it is what the business consented to, so a scope list sent alongside
// it can only disagree with it.
//
// MUTATION=send_both sends scope and config_id together. That run MUST fail.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildAuthorizeParams } from "../node_modules/.cache/flas-oauth.mjs";

const MUTATION = process.env.MUTATION ?? "";
if (MUTATION === "send_both") {
  console.log("!! MUTATION: config_id no longer suppresses scope — the suite must FAIL");
}

const build = (over = {}) => {
  const p = buildAuthorizeParams({
    provider: "meta",
    clientId: "app-id-123",
    redirectUri: "https://flas.test/api/public/oauth-callback",
    state: "s".repeat(64),
    scopes: ["pages_show_list", "pages_read_engagement"],
    ...over,
  });
  if (MUTATION === "send_both" && over.configId) p.set("scope", "pages_show_list");
  return p;
};

describe("classic scope flow (unchanged)", () => {
  test("sends a comma-joined scope list for meta", () => {
    assert.equal(build().get("scope"), "pages_show_list,pages_read_engagement");
  });

  test("sends no config_id when none is configured", () => {
    assert.equal(build().get("config_id"), null);
  });

  test("non-meta providers still join scopes with a space", () => {
    const p = build({ provider: "linkedin", scopes: ["r_liteprofile", "w_member_social"] });
    assert.equal(p.get("scope"), "r_liteprofile w_member_social");
  });
});

describe("Login for Business (config_id)", () => {
  test("sends config_id when one is configured", () => {
    assert.equal(build({ configId: "cfg-987" }).get("config_id"), "cfg-987");
  });

  test("omits scope entirely, so the configuration is the only grant", () => {
    assert.equal(build({ configId: "cfg-987" }).get("scope"), null);
  });

  test("an empty config id is not a configuration and falls back to scopes", () => {
    const p = build({ configId: "" });
    assert.equal(p.get("config_id"), null);
    assert.equal(p.get("scope"), "pages_show_list,pages_read_engagement");
  });
});

describe("controls that must survive either flow", () => {
  for (const configId of [undefined, "cfg-987"]) {
    const label = configId ? "with config_id" : "with scopes";

    test(`state is still sent ${label}`, () => {
      assert.equal(build({ configId }).get("state"), "s".repeat(64));
    });

    test(`redirect_uri is still sent ${label}`, () => {
      assert.equal(
        build({ configId }).get("redirect_uri"),
        "https://flas.test/api/public/oauth-callback",
      );
    });

    test(`response_type stays code — never token ${label}`, () => {
      // An implicit-flow token would arrive in the browser, outside every
      // server-side control this module exists to apply.
      assert.equal(build({ configId }).get("response_type"), "code");
    });

    test(`PKCE is still attached when supplied ${label}`, () => {
      const p = build({ configId, pkceChallenge: "chal-abc" });
      assert.equal(p.get("code_challenge"), "chal-abc");
      assert.equal(p.get("code_challenge_method"), "S256");
    });
  }

  test("no PKCE parameters appear when no challenge is supplied", () => {
    const p = build();
    assert.equal(p.get("code_challenge"), null);
    assert.equal(p.get("code_challenge_method"), null);
  });

  test("tiktok still uses client_key rather than client_id", () => {
    const p = build({ provider: "tiktok" });
    assert.equal(p.get("client_id"), null);
    assert.equal(p.get("client_key"), "app-id-123");
  });

  test("provider extra parameters are preserved", () => {
    const p = build({ provider: "google", extraAuthParams: { access_type: "offline" } });
    assert.equal(p.get("access_type"), "offline");
  });
});
