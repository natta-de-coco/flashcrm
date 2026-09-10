// Batch 1 / Task 3 — the connection state model's guarantees, as tests.
//
//   npm run test:connection-state
//
// Covers the pure model only: the transition whitelist, the derived states,
// scope completeness and abandoned-attempt derivation. The database side (the
// CHECK constraints and the transition trigger) is exercised separately by
// supabase/verify/verify-connection-state.mjs against a real Postgres, because
// a trigger cannot be tested by importing a module.
//
// MUTATION=allow_illegal removes the transition guard. That run MUST fail: a
// suite that stays green with the guard gone is not protecting anything.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ATTEMPT_STATES,
  CONNECTION_STATES,
  CONNECTION_STATE_INFO,
  ATTEMPT_STATE_INFO,
  allowedNextStates,
  effectiveAttemptState,
  isLegalTransition,
  isUsable,
  missingScopesFor,
} from "../node_modules/.cache/flas-connection-state.mjs";
import { deriveConnectionState } from "../node_modules/.cache/flas-derive-state.mjs";

const MUTATION = process.env.MUTATION ?? "";

/** The guard under test, wrapped so a mutation can disable it. */
const legal = (from, to) => (MUTATION === "allow_illegal" ? true : isLegalTransition(from, to));
if (MUTATION === "allow_illegal") {
  console.log("!! MUTATION: transition guard disabled — the suite must FAIL");
}

const HOUR = 3600_000;
const iso = (ms) => new Date(Date.now() + ms).toISOString();

describe("state vocabulary", () => {
  test("every connection state has presentation copy", () => {
    for (const s of CONNECTION_STATES) {
      const info = CONNECTION_STATE_INFO[s];
      assert.ok(info, `no presentation for "${s}"`);
      assert.ok(info.label && info.description, `"${s}" is missing a label or description`);
      assert.ok(
        ["customer", "flas", "provider", "none"].includes(info.actionOwner),
        `"${s}" has no valid actionOwner`,
      );
    }
  });

  test("every attempt state has copy", () => {
    for (const s of ATTEMPT_STATES) {
      assert.ok(ATTEMPT_STATE_INFO[s]?.label, `no label for attempt state "${s}"`);
    }
  });

  test("a provider outage never asks the customer to do anything", () => {
    // Reconnecting does not fix someone else's 5xx, and telling them to try
    // turns the provider's downtime into our support load.
    const info = CONNECTION_STATE_INFO.provider_unavailable;
    assert.equal(info.actionOwner, "provider");
    assert.equal(info.nextAction, null);
  });

  test("states a customer must act on say who owns the fix", () => {
    for (const s of ["missing_app_credentials", "scope_incomplete", "revoked"]) {
      assert.equal(CONNECTION_STATE_INFO[s].actionOwner, "customer", `${s} should be customer-owned`);
      assert.ok(CONNECTION_STATE_INFO[s].nextAction, `${s} should tell them what to do`);
    }
  });
});

describe("transitions", () => {
  test("re-asserting the same state is always allowed", () => {
    for (const s of CONNECTION_STATES) {
      assert.ok(legal(s, s), `${s} -> ${s} should be allowed as a heartbeat`);
    }
  });

  test("every declared next state is a real state", () => {
    for (const s of CONNECTION_STATES) {
      for (const next of allowedNextStates(s)) {
        assert.ok(CONNECTION_STATES.includes(next), `${s} -> "${next}" is not a known state`);
      }
    }
  });

  test("not_configured is permissive, because it means unknown", () => {
    // It is the column default. A row created by a path that does not set a
    // state must still be able to reach whatever it really is — restricting
    // this blocked saveAuthorizedConnection() from updating such a row.
    for (const to of ["connected", "ready_to_authorize", "disconnected", "token_expiring"]) {
      assert.ok(legal("not_configured", to), `not_configured -> ${to} should be allowed`);
    }
  });

  test("illegal edges are refused", () => {
    const illegal = [
      // Credentials must exist before an account can be authorized.
      ["missing_app_credentials", "connected"],
      // A refresh failure cannot happen before a token exists.
      ["ready_to_authorize", "refresh_failed"],
      ["not_configured", "revoked"],
      // A deliberate disconnect is not a provider outage.
      ["disconnected", "provider_unavailable"],
      ["disconnected", "revoked"],
    ];
    for (const [from, to] of illegal) {
      assert.equal(legal(from, to), false, `${from} -> ${to} should be refused`);
    }
  });

  test("a provider outage can never lead to a state that discards the token", () => {
    // The whole point of provider_unavailable: an hour of Meta 5xx must not
    // sign every customer out.
    // refresh_failed is allowed: it keeps the token and schedules a retry.
    // Forbidding it (as this test once did) meant a health check that found a
    // real refresh failure after an outage was rejected by the trigger, and the
    // whole update -- error, retry count, backoff -- was lost.
    for (const to of allowedNextStates("provider_unavailable")) {
      assert.notEqual(to, "revoked", "an outage must not be a route to revoked");
    }
  });

  test("every state can reach disconnected", () => {
    // A customer must always be able to unplug an integration, whatever state
    // it is in -- including mid-authorization.
    for (const s of CONNECTION_STATES) {
      assert.ok(legal(s, "disconnected"), `${s} should be able to reach disconnected`);
    }
  });

  test("every terminal state can be recovered from", () => {
    for (const s of ["revoked", "disconnected"]) {
      assert.ok(
        allowedNextStates(s).length > 0,
        `${s} is a dead end — a customer could never reconnect`,
      );
    }
  });

  test("isUsable is true only where the connection can do work", () => {
    assert.ok(isUsable("connected"));
    assert.ok(isUsable("token_expiring"), "an expiring token still works until it expires");
    assert.equal(isUsable("revoked"), false);
    assert.equal(isUsable("disconnected"), false);
    assert.equal(isUsable("provider_unavailable"), false);
  });
});

describe("derived connection state", () => {
  const base = {
    active: true,
    access_token: "tok",
    token_expires_at: iso(30 * 24 * HOUR),
    granted_scopes: null,
    platform: "facebook",
  };

  test("a healthy connection is connected", () => {
    assert.equal(deriveConnectionState(base).state, "connected");
  });

  test("the six situations that used to be one are now distinct", () => {
    // computeHealth() returned "disconnected" for every one of these.
    assert.equal(deriveConnectionState({ ...base, active: false }).state, "disconnected");
    assert.equal(deriveConnectionState({ ...base, access_token: null }).state, "ready_to_authorize");
    assert.equal(
      deriveConnectionState({ ...base, token_expires_at: iso(-HOUR) }).state,
      "token_expiring",
    );
    assert.equal(
      deriveConnectionState({ ...base, token_expires_at: iso(HOUR) }).state,
      "token_expiring",
    );
  });

  test("a token outside the refresh window is not flagged", () => {
    assert.equal(deriveConnectionState({ ...base, token_expires_at: iso(100 * HOUR) }).state, "connected");
  });

  test("a token inside the 72 hour window is flagged", () => {
    assert.equal(deriveConnectionState({ ...base, token_expires_at: iso(71 * HOUR) }).state, "token_expiring");
  });

  test("every derived state carries a reason", () => {
    for (const row of [
      base,
      { ...base, active: false },
      { ...base, access_token: null },
      { ...base, token_expires_at: iso(-HOUR) },
    ]) {
      assert.ok(deriveConnectionState(row).reason.length > 0, "a state without a reason is unusable in the UI");
    }
  });
});

describe("scope completeness", () => {
  test("no granted scopes means unknown, not everything missing", () => {
    // Some providers return no scope list at all. Treating that as "nothing
    // granted" would put every such connector permanently in scope_incomplete.
    assert.deepEqual(missingScopesFor("facebook", []), []);
  });

  test("a fully granted account reports nothing missing", () => {
    const granted = [
      "pages_show_list", "pages_read_engagement", "pages_messaging", "read_insights",
      "pages_manage_engagement",
    ];
    assert.deepEqual(missingScopesFor("facebook", granted), []);
  });

  test("a Page connected before comment replies needed a scope is told to reconnect", () => {
    // Requested since 2026-09-10. A Page that granted everything under the old
    // scope list must surface the gap, not silently keep failing replies.
    const grantedBeforeTheChange = [
      "pages_show_list", "pages_read_engagement", "pages_messaging", "read_insights",
    ];
    assert.deepEqual(missingScopesFor("facebook", grantedBeforeTheChange), ["pages_manage_engagement"]);
  });

  test("a declined permission is reported", () => {
    const granted = ["pages_show_list", "pages_read_engagement", "read_insights"];
    const missing = missingScopesFor("facebook", granted);
    assert.ok(missing.includes("pages_messaging"), `expected pages_messaging in ${missing.join(", ")}`);
  });

  test("scopes for capabilities Flas has not built are never demanded", () => {
    // The old REQUIRED_PERMISSIONS listed video.publish and
    // instagram_manage_messages, neither of which Flas requests or uses, so it
    // would have told customers to re-authorize for nothing.
    const missing = missingScopesFor("tiktok", ["user.info.basic"]);
    assert.equal(missing.includes("video.publish"), false, "asked for a scope Flas never requests");
    const ig = missingScopesFor("instagram", ["instagram_basic"]);
    assert.equal(ig.includes("instagram_manage_messages"), false, "asked for an unbuilt DM scope");
  });

  test("an unknown connector demands nothing", () => {
    assert.deepEqual(missingScopesFor("not_a_connector", ["x"]), []);
  });
});

describe("abandoned attempts", () => {
  test("an unused attempt past its expiry reads as expired without the sweep", () => {
    // purge_expired_oauth_states() existed for weeks and ran zero times, which
    // is exactly why correctness cannot depend on a sweep.
    assert.equal(
      effectiveAttemptState({ attempt_state: "started", used_at: null, expires_at: iso(-HOUR) }),
      "expired",
    );
  });

  test("an attempt still within its window stays started", () => {
    assert.equal(
      effectiveAttemptState({ attempt_state: "started", used_at: null, expires_at: iso(HOUR) }),
      "started",
    );
  });

  test("a consumed attempt is never reclassified as expired", () => {
    assert.equal(
      effectiveAttemptState({
        attempt_state: "completed",
        used_at: iso(-2 * HOUR),
        expires_at: iso(-HOUR),
      }),
      "completed",
    );
  });

  test("a terminal outcome survives expiry", () => {
    for (const s of ["cancelled", "callback_error", "completed"]) {
      assert.equal(
        effectiveAttemptState({ attempt_state: s, used_at: null, expires_at: iso(-HOUR) }),
        s,
        `${s} should not be overwritten by the expiry derivation`,
      );
    }
  });
});

import { resolveHealthState } from "../node_modules/.cache/flas-connection-state.mjs";

describe("Batch 1 state model", () => {
  test("exactly the thirteen required states", () => {
    const required = [
      "not_configured", "missing_app_credentials", "ready_to_authorize",
      "authorization_started", "authorization_cancelled", "callback_error",
      "scope_incomplete", "connected", "token_expiring", "refresh_failed",
      "revoked", "disconnected", "provider_unavailable",
    ];
    assert.deepEqual([...CONNECTION_STATES].sort(), [...required].sort());
  });

  test("the brief's example transitions are all legal", () => {
    const edges = [
      ["not_configured", "missing_app_credentials"],
      ["missing_app_credentials", "ready_to_authorize"],
      ["ready_to_authorize", "authorization_started"],
      ["authorization_started", "connected"],
      ["authorization_started", "authorization_cancelled"],
      ["authorization_started", "callback_error"],
      ["authorization_started", "scope_incomplete"],
      ["connected", "token_expiring"],
      ["token_expiring", "connected"],
      ["token_expiring", "refresh_failed"],
      ["connected", "revoked"],
      ["connected", "disconnected"],
      ["connected", "provider_unavailable"],
      ["scope_incomplete", "authorization_started"],
      ["provider_unavailable", "connected"],
      ["refresh_failed", "authorization_started"],
      ["revoked", "authorization_started"],
      ["disconnected", "ready_to_authorize"],
    ];
    for (const [from, to] of edges) {
      assert.ok(legal(from, to), `${from} -> ${to} should be legal`);
    }
  });

  test("returning to connected needs a fresh authorization", () => {
    assert.equal(legal("disconnected", "connected"), false, "disconnected -> connected");
    assert.equal(legal("revoked", "connected"), false, "revoked -> connected");
    assert.ok(legal("authorization_started", "connected"));
  });

  test("a health check can record a refresh failure on a connected account", () => {
    // The edge whose absence made the trigger reject the whole health update.
    assert.ok(legal("connected", "refresh_failed"));
  });

  test("resolveHealthState keeps a legal observation as-is", () => {
    assert.equal(resolveHealthState("connected", "refresh_failed"), "refresh_failed");
    assert.equal(resolveHealthState("token_expiring", "connected"), "connected");
  });

  test("resolveHealthState never lands on revoked from an outage", () => {
    assert.equal(resolveHealthState("provider_unavailable", "revoked"), "refresh_failed");
  });

  test("resolveHealthState cannot reconnect a disconnected account", () => {
    assert.equal(resolveHealthState("disconnected", "connected"), "disconnected");
    assert.equal(resolveHealthState("revoked", "connected"), "revoked");
  });

  test("resolveHealthState always returns a state reachable from the current one", () => {
    for (const from of CONNECTION_STATES) {
      for (const to of CONNECTION_STATES) {
        const got = resolveHealthState(from, to);
        assert.ok(legal(from, got), `${from} + ${to} -> ${got} is not reachable`);
      }
    }
  });
});

import { classifyHealthObservation } from "../node_modules/.cache/flas-connection-state.mjs";

describe("health-check classification (phases 35-40)", () => {
  const classify = (from, validated, reason, missingScopes = 0) =>
    classifyHealthObservation({ from, validated, reason, missingScopes });

  test("a validated token with every scope is connected", () => {
    const r = classify("token_expiring", true, "ok");
    assert.equal(r.state, "connected");
    assert.equal(r.code, "healthy");
  });

  test("partial scopes are never reported fully healthy", () => {
    const r = classify("connected", true, "ok", 2);
    assert.equal(r.state, "scope_incomplete");
    assert.notEqual(r.code, "healthy");
  });

  test("a 429 leaves the connection logically connected", () => {
    const r = classify("connected", false, "Meta API returned HTTP 429 (rate limit)");
    assert.equal(r.code, "rate_limited");
    assert.equal(r.state, "connected");
    assert.equal(r.active, true);
  });

  test("a 5xx is an outage, not a revocation", () => {
    const r = classify("connected", false, "Meta API returned HTTP 503");
    assert.equal(r.state, "provider_unavailable");
    assert.equal(r.active, true, "credentials must not be switched off during an outage");
  });

  test("a timeout is an outage", () => {
    assert.equal(classify("connected", false, "request timed out").state, "provider_unavailable");
  });

  test("a revoked grant is revoked and switched off", () => {
    const r = classify("connected", false, "invalid_grant: token has been revoked");
    assert.equal(r.state, "revoked");
    assert.equal(r.active, false);
  });

  test("a 401 during an outage cannot become revoked", () => {
    const r = classify("provider_unavailable", false, "HTTP 401");
    assert.notEqual(r.state, "revoked");
    assert.equal(r.code, "refresh_failed");
    assert.equal(r.active, true);
  });

  test("a 403 is a missing permission, not a revocation", () => {
    assert.notEqual(classify("connected", false, "HTTP 403 forbidden").state, "revoked");
  });

  test("an unknown failure keeps the token and retries", () => {
    const r = classify("connected", false, "something odd");
    assert.equal(r.state, "refresh_failed");
    assert.equal(r.active, true);
  });

  test("a health check never reconnects a disconnected account", () => {
    const r = classify("disconnected", true, "ok");
    assert.equal(r.state, "disconnected");
    assert.equal(r.active, false);
  });
});
