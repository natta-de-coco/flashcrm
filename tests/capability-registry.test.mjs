// Batch 1 / Task 2 — the capability registry's guarantees, as tests.
//
// Run with:  npm run test:capabilities
//
// Uses node:test, which ships with Node. No test runner is added to the
// project for this: the suite is pure assertions over a data structure, and a
// native runner keeps it runnable in CI without a dependency to maintain.
//
// The registry is bundled to .cache/registry.mjs by the npm script before this
// runs, so the tests exercise the same TypeScript the app imports rather than
// a re-typed copy.
//
// MUTATION=gbp_messaging or MUTATION=youtube_dm deliberately corrupts the
// registry in memory. Those runs MUST fail — a suite that stays green when
// Google Business Profile is given messaging is not protecting anything.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  CAPABILITY_KEYS,
  CAPABILITY_LABELS,
  CONNECTOR_COUNTS,
  CONNECTOR_DEFINITIONS,
  NON_OAUTH_CONNECTORS,
  OAUTH_CONNECTORS,
  STATUS_LABELS,
  advertisableCapabilities,
  capabilityCeiling,
  connectorDefinition,
  resolveAllCapabilities,
  resolveCapability,
} from "../node_modules/.cache/flas-registry.mjs";

// ── deliberate mutations, to prove the suite can fail ───────────────────────
const MUTATION = process.env.MUTATION ?? "";
if (MUTATION === "gbp_messaging") {
  const gbp = CONNECTOR_DEFINITIONS.find((c) => c.id === "google_business");
  gbp.capabilities.direct_messages_read = {
    providerSupports: true, flasImplements: true, requiredScopes: [], reviewRequired: false,
  };
  console.log("!! MUTATION: Google Business Profile given messaging — the suite must FAIL");
}
if (MUTATION === "youtube_dm") {
  const yt = CONNECTOR_DEFINITIONS.find((c) => c.id === "youtube");
  yt.capabilities.direct_messages_send = {
    providerSupports: true, flasImplements: true, requiredScopes: [], reviewRequired: false,
  };
  console.log("!! MUTATION: YouTube given DM send — the suite must FAIL");
}

/**
 * Providers with no direct-message API, or none reachable under the scopes
 * Flas requests. Verified against official documentation on 2026-09-08.
 * Google Business Profile chat was retired by Google on 31 July 2024.
 */
const NO_DM_CONNECTORS = [
  "google_business", "youtube", "pinterest", "tiktok", "threads", "twitter",
  "linkedin", "meta_ads", "google_ads", "linkedin_ads", "tiktok_ads",
  "google_analytics", "search_console", "wordpress", "shopify", "woocommerce",
];

const DM_KEYS = ["direct_messages_read", "direct_messages_send"];

describe("registry shape", () => {
  test("connector ids are unique", () => {
    const ids = CONNECTOR_DEFINITIONS.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length, `duplicate id in [${ids.join(", ")}]`);
  });

  test("every connector declares every capability key", () => {
    for (const c of CONNECTOR_DEFINITIONS) {
      for (const key of CAPABILITY_KEYS) {
        assert.ok(c.capabilities[key], `${c.id} is missing capability "${key}"`);
        assert.equal(
          typeof c.capabilities[key].providerSupports, "boolean",
          `${c.id}.${key}.providerSupports must be a boolean`,
        );
      }
    }
  });

  test("no unknown capability keys are declared", () => {
    const known = new Set(CAPABILITY_KEYS);
    for (const c of CONNECTOR_DEFINITIONS) {
      for (const key of Object.keys(c.capabilities)) {
        assert.ok(known.has(key), `${c.id} declares unknown capability "${key}"`);
      }
    }
  });

  test("every capability key has a label, and every status has one", () => {
    for (const key of CAPABILITY_KEYS) {
      assert.ok(CAPABILITY_LABELS[key], `no label for capability "${key}"`);
    }
    for (const s of ["implemented", "scope_not_requested", "not_implemented",
      "requires_provider_review", "limited_by_account_type", "not_supported"]) {
      assert.ok(STATUS_LABELS[s], `no label for status "${s}"`);
    }
  });

  test("every connector cites at least one official documentation URL", () => {
    for (const c of CONNECTOR_DEFINITIONS) {
      assert.ok(c.docs.length > 0, `${c.id} has no documentation URL`);
      for (const url of c.docs) {
        assert.match(url, /^https:\/\//, `${c.id} documentation URL is not https: ${url}`);
      }
    }
  });

  test("every connector records when it was last verified", () => {
    for (const c of CONNECTOR_DEFINITIONS) {
      assert.match(c.lastVerified, /^\d{4}-\d{2}-\d{2}$/, `${c.id} has no lastVerified date`);
    }
  });
});

describe("scopes", () => {
  test("required and optional scopes never overlap", () => {
    for (const c of CONNECTOR_DEFINITIONS) {
      const requested = new Set(c.requestedScopes);
      for (const s of c.optionalScopes) {
        assert.ok(
          !requested.has(s),
          `${c.id} lists "${s}" as both requested and optional — one of them is wrong`,
        );
      }
    }
  });

  test("a capability's required scopes are declared somewhere on the connector", () => {
    // Either requested today, or acknowledged as optional. A required scope
    // appearing in neither list means the registry is describing a scope
    // nobody has thought about.
    for (const c of CONNECTOR_DEFINITIONS) {
      const known = new Set([...c.requestedScopes, ...c.optionalScopes]);
      for (const key of CAPABILITY_KEYS) {
        const facts = c.capabilities[key];
        if (!facts.providerSupports) continue;
        for (const scope of facts.requiredScopes) {
          assert.ok(
            known.has(scope),
            `${c.id}.${key} requires "${scope}" which is in neither requestedScopes nor optionalScopes`,
          );
        }
      }
    }
  });

  test("a capability that is implemented and missing its scope is reported, not hidden", () => {
    // This is the state Facebook comment replies are in. The point of the test
    // is that such a capability must never resolve to "implemented".
    for (const c of CONNECTOR_DEFINITIONS) {
      for (const r of resolveAllCapabilities(c)) {
        if (r.missingScopes.length > 0 && r.flasImplements && r.providerSupports) {
          assert.equal(
            r.status, "scope_not_requested",
            `${c.id}.${r.key} is missing ${r.missingScopes.join(", ")} but resolved to "${r.status}"`,
          );
        }
      }
    }
  });
});

describe("honest capability display", () => {
  test("nothing unsupported can ever be advertised", () => {
    for (const c of CONNECTOR_DEFINITIONS) {
      for (const cap of advertisableCapabilities(c)) {
        assert.ok(
          cap.providerSupports && cap.flasImplements,
          `${c.id} advertises "${cap.key}" without both provider support and an implementation`,
        );
      }
    }
  });

  test("connectors with no DM API cannot advertise DMs", () => {
    for (const id of NO_DM_CONNECTORS) {
      const c = connectorDefinition(id);
      assert.ok(c, `${id} is missing from the registry`);
      for (const key of DM_KEYS) {
        const shown = advertisableCapabilities(c).some((x) => x.key === key);
        assert.equal(shown, false, `${id} advertises "${key}" — it has no such API under its scopes`);
      }
    }
  });

  test("Google Business Profile cannot advertise messaging in any form", () => {
    const gbp = connectorDefinition("google_business");
    for (const key of DM_KEYS) {
      assert.equal(
        gbp.capabilities[key].providerSupports, false,
        `google_business.${key} claims provider support — Google retired Business Profile chat on 31 July 2024`,
      );
      assert.equal(resolveCapability(gbp, key).status, "not_supported");
    }
  });

  test("YouTube cannot advertise private direct messages", () => {
    const yt = connectorDefinition("youtube");
    for (const key of DM_KEYS) {
      assert.equal(
        yt.capabilities[key].providerSupports, false,
        `youtube.${key} claims provider support — YouTube has no private DM API, only public comments`,
      );
    }
  });

  test("a DM capability may only be advertised where DMs are genuinely implemented", () => {
    for (const c of CONNECTOR_DEFINITIONS) {
      for (const key of DM_KEYS) {
        if (!advertisableCapabilities(c).some((x) => x.key === key)) continue;
        assert.ok(
          c.capabilities[key].providerSupports && c.capabilities[key].flasImplements,
          `${c.id} advertises ${key} without implementing it`,
        );
      }
    }
  });

  test("every capability note is provider-specific, never the old generic DM line", () => {
    for (const c of CONNECTOR_DEFINITIONS) {
      for (const key of CAPABILITY_KEYS) {
        const note = c.capabilities[key].note ?? "";
        if (!note) continue;
        if (DM_KEYS.includes(key)) continue;
        assert.ok(
          !/DMs stop arriving/i.test(note),
          `${c.id}.${key} carries the generic DM warning`,
        );
      }
    }
  });
});

describe("counts", () => {
  test("counts are derived from the registry, not typed by hand", () => {
    assert.equal(CONNECTOR_COUNTS.total, CONNECTOR_DEFINITIONS.length);
    assert.equal(CONNECTOR_COUNTS.oauthPlatforms, OAUTH_CONNECTORS.length);
    assert.equal(CONNECTOR_COUNTS.keyedOrPlugin, NON_OAUTH_CONNECTORS.length);
  });

  test("the two groups partition the whole catalogue with no overlap", () => {
    assert.equal(
      CONNECTOR_COUNTS.oauthPlatforms + CONNECTOR_COUNTS.keyedOrPlugin,
      CONNECTOR_COUNTS.total,
      "OAuth and keyed connectors do not add up to the total — the 19-vs-16 problem is back",
    );
    const oauthIds = new Set(OAUTH_CONNECTORS.map((c) => c.id));
    for (const c of NON_OAUTH_CONNECTORS) {
      assert.ok(!oauthIds.has(c.id), `${c.id} is counted in both groups`);
    }
  });
});

describe("observed capabilities cannot exceed the static definition", () => {
  test("the ceiling only contains capabilities Flas has implemented", () => {
    for (const c of CONNECTOR_DEFINITIONS) {
      for (const key of capabilityCeiling(c.id)) {
        assert.ok(
          c.capabilities[key].providerSupports && c.capabilities[key].flasImplements,
          `${c.id} ceiling includes "${key}" which is not implemented`,
        );
      }
    }
  });

  test("an observed row claiming more than the ceiling is rejected", () => {
    // Simulates a social_capabilities row written with a capability the static
    // definition does not allow — the case the two-layer model exists to catch.
    const ceiling = capabilityCeiling("google_business");
    assert.equal(
      ceiling.has("direct_messages_read"), false,
      "an observed google_business row could claim DM access",
    );
    assert.ok(ceiling.has("reviews_read"), "reviews_read should be within the GBP ceiling");
  });

  test("an unknown connector has an empty ceiling rather than a permissive one", () => {
    assert.equal(capabilityCeiling("not_a_real_connector").size, 0);
  });
});
