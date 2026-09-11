// The OAuth return flow: detecting that a sign-in finished, without trusting
// anything the browser could forge.
//
//   node scripts/cc-oauth-return-bundle.mjs && node --test tests/oauth-return.test.mjs
//
// Everything here runs against the bundled TypeScript the app ships, not a
// re-typed copy of its rules. The state machine takes its clock as an argument
// and the attempt lookup takes its loader as an argument, so both are exercised
// without a browser and without a database.
//
// MUTATION=trust_ping makes a completion ping finish the attempt by itself --
// the exact mistake this design exists to prevent. That run MUST fail; a suite
// that stays green with the guard removed is not protecting anything.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  GRACE_POLL_MS,
  buildCompleteRedirect,
  connectReducer,
  decodeAttemptReason,
  decodeStoredAttempt,
  encodeAttemptReason,
  encodeStoredAttempt,
  initialConnectState,
  isReturnPing,
  isTerminalPhase,
  isWaitingPhase,
  legacyOutcomeSearch,
  looksLikeSecret,
  makeReturnPing,
  parseReturnPing,
  popupFeatures,
  readCompleteParams,
  shouldPoll,
} from "../node_modules/.cache/cc-oauth-return-pure.mjs";
import {
  connectAttemptProblem,
  readConnectAttempt,
} from "../node_modules/.cache/cc-oauth-return-attempts.mjs";

const MUTATION = process.env.MUTATION ?? "";
if (MUTATION === "trust_ping") {
  console.log("!! MUTATION: a ping is treated as proof of success — the suite must FAIL");
}

/** The reducer under test, wrapped so the mutation can break the guarantee. */
const reduce = (state, event) => {
  if (MUTATION === "trust_ping" && event.type === "PING") {
    return { ...state, phase: "completed" };
  }
  return connectReducer(state, event);
};

const T0 = 1_700_000_000_000;
const ATTEMPT = "11111111-2222-4333-8444-555555555555";
const OTHER_ID = "99999999-8888-4777-8666-555555555555";
const TENANT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OTHER_TENANT = "ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const USER = "12121212-3434-4565-8787-909090909090";
const OTHER_USER = "56565656-3434-4565-8787-909090909090";

/** Drives the machine from idle to a live wait, the way the hook does. */
function waiting(at = T0, attemptId = ATTEMPT) {
  let s = initialConnectState();
  s = reduce(s, { type: "START", platform: "instagram", at });
  s = reduce(s, { type: "POPUP_OPENED", at });
  s = reduce(s, { type: "READY", attemptId, at });
  return s;
}

const attemptRecord = (phase, extra = {}) => ({
  attemptId: ATTEMPT,
  platform: "instagram",
  phase,
  accountId: null,
  problem: null,
  updatedAt: new Date(T0).toISOString(),
  ...extra,
});

/* ═══════════════════════════════════════════════════════════════════════════
 * A ping is a hint, never proof
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("completion pings are never believed", () => {
  test("a ping does not finish the attempt — it only brings the lookup forward", () => {
    const state = waiting();
    const pinged = reduce(state, { type: "PING", attemptId: ATTEMPT, at: T0 + 1000 });

    // The whole point. Any page able to post on the channel could otherwise
    // tell Flas that a connection succeeded.
    assert.equal(pinged.phase, "waiting");
    assert.equal(pinged.attempt, null);
    assert.equal(pinged.nextPollAt, T0 + 1000, "the ping should schedule an immediate lookup");
    assert.ok(shouldPoll(pinged, T0 + 1000));
  });

  test("only a server lookup can finish an attempt", () => {
    let s = waiting();
    s = reduce(s, { type: "PING", attemptId: ATTEMPT, at: T0 + 500 });
    assert.equal(s.phase, "waiting");
    s = reduce(s, { type: "LOOKUP", attempt: attemptRecord("completed"), at: T0 + 900 });
    assert.equal(s.phase, "completed");
  });

  test("a ping offers an id only when this tab never learned one", () => {
    // startConnect has not yet named the attempt (pre-readiness-contract), so
    // adopting the id the completion page carried is the only way to poll. The
    // server lookup is tenant- and user-scoped, so an id from a hostile tab
    // resolves to "not found" rather than to someone else's connection.
    let s = waiting(T0, null);
    assert.equal(s.attemptId, null);
    s = reduce(s, { type: "PING", attemptId: ATTEMPT, at: T0 + 100 });
    assert.equal(s.attemptId, ATTEMPT);

    // With an id of its own, this tab keeps it and ignores the one offered.
    const own = reduce(waiting(), { type: "PING", attemptId: OTHER_ID, at: T0 + 100 });
    assert.equal(own.attemptId, ATTEMPT);
  });

  test("a ping arriving after the outcome changes nothing", () => {
    let s = waiting();
    s = reduce(s, { type: "LOOKUP", attempt: attemptRecord("completed"), at: T0 + 900 });
    const late = reduce(s, { type: "PING", attemptId: ATTEMPT, at: T0 + 2000 });
    assert.equal(late, s, "a terminal state should be returned untouched");
  });

  test("the ping payload is validated before it is acted on", () => {
    assert.ok(isReturnPing(makeReturnPing(ATTEMPT, T0)));
    assert.ok(isReturnPing(makeReturnPing(null, T0)));
    assert.equal(isReturnPing({ type: "something-else", attemptId: ATTEMPT, at: T0 }), false);
    // Not a uuid: dropped here rather than sent to the server as a lookup.
    assert.equal(
      isReturnPing({ type: "flas-oauth-complete", attemptId: "../../x", at: T0 }),
      false,
    );
    assert.equal(isReturnPing({ type: "flas-oauth-complete", attemptId: ATTEMPT }), false);
    assert.equal(isReturnPing(null), false);
    assert.equal(isReturnPing("flas-oauth-complete"), false);
  });
});

describe("the storage-event fallback", () => {
  test("a well-formed payload parses to the same ping", () => {
    const raw = JSON.stringify(makeReturnPing(ATTEMPT, T0));
    const ping = parseReturnPing(raw);
    assert.equal(ping?.attemptId, ATTEMPT);
  });

  test("junk in the key is ignored rather than thrown on", () => {
    assert.equal(parseReturnPing("not json at all"), null);
    assert.equal(parseReturnPing(null), null);
    assert.equal(parseReturnPing(""), null);
    assert.equal(
      parseReturnPing(JSON.stringify({ type: "evil", attemptId: ATTEMPT, at: 1 })),
      null,
    );
  });

  test("the fallback drives the same PING event as the channel", () => {
    const ping = parseReturnPing(JSON.stringify(makeReturnPing(ATTEMPT, T0)));
    const s = reduce(waiting(), { type: "PING", attemptId: ping.attemptId, at: T0 + 10 });
    assert.equal(s.phase, "waiting", "still only a hint, whichever channel carried it");
    assert.equal(s.nextPollAt, T0 + 10);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * The window closing
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("the popup closing", () => {
  test("closing is not immediately failure — a grace poll runs first", () => {
    const s = reduce(waiting(), { type: "POPUP_CLOSED", at: T0 + 3000 });
    // The completion page calls window.close() as its last act, so `closed`
    // flips before the final poll would have run. Declaring "you closed it"
    // here would report a successful connection as an abandoned one.
    assert.equal(s.phase, "waiting");
    assert.equal(s.graceUntil, T0 + 3000 + GRACE_POLL_MS);
    assert.equal(s.nextPollAt, T0 + 3000, "the grace poll should be issued at once");
  });

  test("once the grace runs out with nothing to show, it is popup_closed", () => {
    let s = reduce(waiting(), { type: "POPUP_CLOSED", at: T0 + 3000 });
    s = reduce(s, { type: "TICK", at: T0 + 3000 + GRACE_POLL_MS - 1 });
    assert.equal(s.phase, "waiting", "still inside the grace window");
    s = reduce(s, { type: "TICK", at: T0 + 3000 + GRACE_POLL_MS });
    assert.equal(s.phase, "popup_closed");
    assert.equal(s.nextPollAt, null, "polling should stop once Retry is offered");
  });

  test("a completion that lands during the grace window wins", () => {
    let s = reduce(waiting(), { type: "POPUP_CLOSED", at: T0 + 3000 });
    s = reduce(s, { type: "LOOKUP", attempt: attemptRecord("completed"), at: T0 + 3200 });
    assert.equal(s.phase, "completed");
  });

  test("a completion that lands after popup_closed still wins", () => {
    // The real race: a slow callback, a fast close. The server record is the
    // truth whenever it arrives, and "you closed the window" must not become
    // the final word over a connection that actually exists.
    let s = reduce(waiting(), { type: "POPUP_CLOSED", at: T0 + 3000 });
    s = reduce(s, { type: "TICK", at: T0 + 3000 + GRACE_POLL_MS });
    assert.equal(s.phase, "popup_closed");
    s = reduce(s, { type: "LOOKUP", attempt: attemptRecord("completed"), at: T0 + 9000 });
    assert.equal(s.phase, "completed");
  });

  test("a second close event does not restart the grace window", () => {
    let s = reduce(waiting(), { type: "POPUP_CLOSED", at: T0 + 1000 });
    const again = reduce(s, { type: "POPUP_CLOSED", at: T0 + 2000 });
    assert.equal(again.graceUntil, T0 + 1000 + GRACE_POLL_MS);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Outcomes
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("outcomes are reported as what they are", () => {
  test("a cancelled callback is a cancellation, not an error", () => {
    // Pressing Cancel on the provider's screen is a decision, not a fault.
    // Reporting it as a failure sent people hunting for a problem.
    const s = reduce(waiting(), {
      type: "LOOKUP",
      attempt: attemptRecord("cancelled"),
      at: T0 + 1,
    });
    assert.equal(s.phase, "cancelled");
    assert.notEqual(s.phase, "failed");
  });

  test("an expired attempt says so", () => {
    const s = reduce(waiting(), { type: "LOOKUP", attempt: attemptRecord("expired"), at: T0 + 1 });
    assert.equal(s.phase, "expired");
  });

  test("a login with several accounts stops for the choice", () => {
    const attempt = attemptRecord("needs_target", { accountId: OTHER_ID });
    const s = reduce(waiting(), { type: "LOOKUP", attempt, at: T0 + 1 });
    assert.equal(s.phase, "needs_target");
    assert.equal(s.attempt.accountId, OTHER_ID);
  });

  test("a pending lookup keeps waiting, and backs off", () => {
    let s = waiting();
    const first = s.nextPollAt;
    s = reduce(s, { type: "LOOKUP", attempt: attemptRecord("pending"), at: T0 + 2000 });
    assert.equal(s.phase, "waiting");
    assert.ok(s.nextPollAt > first);
    const second = s.nextPollAt;
    s = reduce(s, { type: "LOOKUP", attempt: attemptRecord("pending"), at: second });
    assert.ok(s.nextPollAt > second, "the interval should keep growing, not hammer the server");
  });

  test("a refused lookup is not an outcome", () => {
    const s = reduce(waiting(), { type: "LOOKUP_FAILED", at: T0 + 2000 });
    assert.equal(s.phase, "waiting");
    assert.equal(s.problem, null);
    assert.ok(s.nextPollAt > T0);
  });

  test("startConnect refusing is a failure with the reason attached", () => {
    let s = initialConnectState();
    s = reduce(s, { type: "START", platform: "instagram", at: T0 });
    s = reduce(s, { type: "POPUP_OPENED", at: T0 });
    const problem = {
      code: "X",
      title: "t",
      message: "m",
      owner: "END_USER",
      severity: "blocking",
      nextAction: "a",
    };
    s = reduce(s, { type: "NOT_READY", problem, at: T0 });
    assert.equal(s.phase, "failed");
    assert.equal(s.problem.code, "X");
  });

  test("every waiting phase is a dialog phase and no terminal phase is", () => {
    for (const phase of ["opening", "waiting", "popup_blocked", "popup_closed"]) {
      assert.ok(isWaitingPhase(phase), `${phase} should keep the dialog open`);
      assert.equal(isTerminalPhase(phase), false);
    }
    for (const phase of ["completed", "needs_target", "cancelled", "failed", "expired"]) {
      assert.ok(isTerminalPhase(phase), `${phase} should be handed to the page`);
      assert.equal(isWaitingPhase(phase), false);
    }
  });
});

describe("a blocked popup", () => {
  test("keeps its attempt id so 'Continue in this tab' still resolves", () => {
    let s = initialConnectState();
    s = reduce(s, { type: "START", platform: "instagram", at: T0 });
    s = reduce(s, { type: "POPUP_BLOCKED", at: T0 });
    assert.equal(s.phase, "popup_blocked");
    s = reduce(s, { type: "READY", attemptId: ATTEMPT, at: T0 });
    assert.equal(s.phase, "popup_blocked", "still blocked; the user has not chosen yet");
    assert.equal(s.attemptId, ATTEMPT);
  });

  test("the popup is asked for before anything can have blocked it", () => {
    // window.open must be called inside the click, so the features string has
    // to be buildable with no async work in front of it.
    const features = popupFeatures({ width: 1600, height: 1000, left: 0, top: 0 });
    assert.match(features, /^popup=1,/);
    // `noopener` is what made the old flow unfixable: with it set, window.open
    // returns null by specification, so nothing could hold the handle.
    assert.equal(features.includes("noopener"), false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Resuming after a reload
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("resuming after a reload", () => {
  const stored = { attemptId: ATTEMPT, platform: "instagram", startedAt: T0 };

  test("only the attempt id and platform are ever stored", () => {
    const raw = encodeStoredAttempt(stored);
    assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ["attemptId", "platform", "startedAt"]);
    assert.equal(looksLikeSecret(raw), false);
  });

  test("a reload picks the wait back up", () => {
    const s = reduce(initialConnectState(), { type: "RESUME", stored, at: T0 + 5000 });
    assert.equal(s.phase, "waiting");
    assert.equal(s.attemptId, ATTEMPT);
    assert.equal(s.platform, "instagram");
    assert.equal(s.resumed, true);
    assert.equal(s.nextPollAt, T0 + 5000);
  });

  test("resuming never reaches over a wait already in progress", () => {
    const live = waiting(T0, OTHER_ID);
    const after = reduce(live, { type: "RESUME", stored, at: T0 + 100 });
    assert.equal(after, live);
    assert.equal(after.attemptId, OTHER_ID);
  });

  test("resuming never reaches over an outcome the user is reading", () => {
    let s = reduce(waiting(), { type: "LOOKUP", attempt: attemptRecord("completed"), at: T0 + 1 });
    const after = reduce(s, { type: "RESUME", stored, at: T0 + 200 });
    assert.equal(after.phase, "completed");
  });

  test("a stale or malformed record is discarded", () => {
    assert.equal(decodeStoredAttempt(encodeStoredAttempt(stored), T0 + 1000)?.attemptId, ATTEMPT);
    // oauth_states rows live fifteen minutes; anything older cannot resolve.
    assert.equal(decodeStoredAttempt(encodeStoredAttempt(stored), T0 + 16 * 60_000), null);
    assert.equal(
      decodeStoredAttempt('{"attemptId":"nope","platform":"x","startedAt":0}', T0),
      null,
    );
    assert.equal(decodeStoredAttempt("{", T0), null);
    assert.equal(decodeStoredAttempt(null, T0), null);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * The redirect the callback generates
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("the callback's redirect carries nothing secret", () => {
  const ALLOWED = new Set([
    "outcome",
    "attempt",
    "platform",
    "account",
    "reason",
    "detail",
    "code",
    "help",
  ]);

  const secrets = [
    "EAAGm0PX4ZCpsBA1ZCZBqZBZCZBqZBZCZBqZBZCZBqZBZC",
    "ya29.a0ARrdaM9xXxXxXxXxXxXxXx",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r",
    "access_token=abc123",
    "Authorization: Bearer sk_live_9f8a7b6c5d4e3f2a1b",
    "client_secret is 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d",
  ];

  test("only allowlisted parameters are ever written", () => {
    const url = buildCompleteRedirect({
      outcome: "blocked",
      attemptId: ATTEMPT,
      platform: "instagram",
      reason: "Nothing to connect",
      detail: "That login does not administer a Page.",
      help: "https://developers.facebook.com/apps/",
    });
    const params = new URLSearchParams(url.split("?")[1]);
    for (const key of params.keys()) {
      assert.ok(ALLOWED.has(key), `unexpected parameter "${key}" in the redirect`);
    }
    assert.ok(
      url.startsWith("/oauth/complete?"),
      "the path must be a constant, never attacker-set",
    );
  });

  test("a provider message that quotes a credential is dropped, not truncated", () => {
    // A provider error very often echoes the request back, and the request
    // carried the token. The defence cannot be "we only put safe things here";
    // it has to be a filter that runs on the way out.
    for (const secret of secrets) {
      assert.ok(looksLikeSecret(secret), `${secret.slice(0, 20)}… should be recognised as secret`);
      const url = buildCompleteRedirect({
        outcome: "error",
        attemptId: ATTEMPT,
        platform: "instagram",
        reason: secret,
        detail: `Provider said: ${secret}`,
        code: "token_exchange_failed",
      });
      assert.equal(url.includes("reason="), false, "a credential-shaped reason must be dropped");
      assert.equal(url.includes("detail="), false, "a credential-shaped detail must be dropped");
      const decoded = decodeURIComponent(url);
      assert.equal(decoded.includes(secret), false);
    }
  });

  test("an attempt id that is not a uuid never reaches the URL", () => {
    const url = buildCompleteRedirect({ outcome: "error", attemptId: "../../admin" });
    assert.equal(url.includes("attempt="), false);
  });

  test("a help link may only be an absolute https page", () => {
    const good = buildCompleteRedirect({ outcome: "blocked", help: "https://example.com/fix" });
    assert.ok(good.includes("help="));
    for (const bad of ["/connect?x=1", "javascript:alert(1)", "http://example.com"]) {
      assert.equal(
        buildCompleteRedirect({ outcome: "blocked", help: bad }).includes("help="),
        false,
        `"${bad}" should not be accepted as a help link`,
      );
    }
  });

  test("what is written is what is read back", () => {
    const url = buildCompleteRedirect({
      outcome: "select_target",
      attemptId: ATTEMPT,
      platform: "linkedin",
      accountId: OTHER_ID,
    });
    const back = readCompleteParams(new URLSearchParams(url.split("?")[1]));
    assert.equal(back.outcome, "select_target");
    assert.equal(back.attemptId, ATTEMPT);
    assert.equal(back.accountId, OTHER_ID);
    assert.equal(back.platform, "linkedin");
  });

  test("an unknown outcome word degrades to an error rather than being trusted", () => {
    const back = readCompleteParams(new URLSearchParams("outcome=connected_lol"));
    assert.equal(back.outcome, "error");
  });
});

describe("the full-page fallback speaks the old vocabulary", () => {
  test("every outcome maps onto parameters the existing screen renders", () => {
    assert.deepEqual(legacyOutcomeSearch({ outcome: "connected", platform: "facebook" }), {
      connected: "facebook",
    });
    assert.deepEqual(
      legacyOutcomeSearch({ outcome: "select_target", platform: "linkedin", accountId: OTHER_ID }),
      { connected: "linkedin", select_target: OTHER_ID },
    );
    // The shape older callbacks produced, so links already in the wild keep
    // opening the picker instead of a bare "connected" banner.
    assert.equal(legacyOutcomeSearch({ outcome: "select_target" }).select_target, "1");

    const blocked = legacyOutcomeSearch({
      outcome: "blocked",
      platform: "instagram",
      reason: "Nothing to connect",
      detail: "No Page found.",
    });
    assert.equal(blocked.connect_blocked, "instagram");
    assert.equal(blocked.connect_reason, "Nothing to connect");
    assert.equal(blocked.connect_detail, "No Page found.");

    // A cancellation gets its own parameter: it used to arrive as
    // connect_error and read as a fault when nothing had gone wrong.
    assert.equal(
      legacyOutcomeSearch({ outcome: "cancelled", platform: "tiktok" }).connect_error,
      undefined,
    );
    assert.equal(
      legacyOutcomeSearch({ outcome: "cancelled", platform: "tiktok" }).connect_cancelled,
      "tiktok",
    );
    assert.equal(
      legacyOutcomeSearch({ outcome: "expired", platform: "tiktok" }).connect_expired,
      "tiktok",
    );
    assert.equal(
      legacyOutcomeSearch({ outcome: "error", code: "pkce_error" }).connect_error,
      "pkce_error",
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Outcome markers on attempt_reason (no schema change)
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("outcome markers ride on attempt_reason", () => {
  test("a saved account round-trips", () => {
    const raw = encodeAttemptReason({ accountId: OTHER_ID, reason: "The account was connected" });
    const back = decodeAttemptReason(raw);
    assert.equal(back.accountId, OTHER_ID);
    assert.equal(back.targetAccountId, null);
    assert.equal(back.reason, "The account was connected");
  });

  test("a pending choice is distinguishable from a finished connection", () => {
    const raw = encodeAttemptReason({ targetAccountId: OTHER_ID, reason: "Choose a Page" });
    const back = decodeAttemptReason(raw);
    assert.equal(back.targetAccountId, OTHER_ID);
    assert.equal(back.accountId, null);
  });

  test("a failure code round-trips alongside the sentence", () => {
    const raw = encodeAttemptReason({
      code: "token_exchange_failed",
      reason: "HTTP 400 from meta",
    });
    const back = decodeAttemptReason(raw);
    assert.equal(back.code, "token_exchange_failed");
    assert.equal(back.reason, "HTTP 400 from meta");
  });

  test("the column limit truncates the sentence and never the markers", () => {
    const raw = encodeAttemptReason({
      accountId: OTHER_ID,
      code: "connect_failed",
      reason: "x".repeat(500),
    });
    assert.ok(raw.length <= 300, `attempt_reason must fit the column, got ${raw.length}`);
    const back = decodeAttemptReason(raw);
    // A cut-off uuid would decode to a different row, or to none at all.
    assert.equal(back.accountId, OTHER_ID);
    assert.equal(back.code, "connect_failed");
  });

  test("a reason written before the markers existed decodes to itself", () => {
    const back = decodeAttemptReason("The provider refused the request");
    assert.equal(back.reason, "The provider refused the request");
    assert.equal(back.accountId, null);
    assert.equal(back.code, null);
  });

  test("a forged marker is not accepted as a uuid", () => {
    const back = decodeAttemptReason("account=not-a-uuid; something happened");
    assert.equal(back.accountId, null);
  });

  test("nothing is stored that could be a credential", () => {
    const raw = encodeAttemptReason({ accountId: OTHER_ID, code: "pkce_error", reason: "denied" });
    assert.equal(looksLikeSecret(raw), false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * The lookup: whose attempt is it
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("getConnectAttempt is scoped to the caller", () => {
  const row = (over = {}) => ({
    id: ATTEMPT,
    tenant_id: TENANT,
    user_id: USER,
    platform: "instagram",
    attempt_state: "completed",
    attempt_reason: encodeAttemptReason({
      accountId: OTHER_ID,
      reason: "The account was connected",
    }),
    expires_at: new Date(Date.now() + 600_000).toISOString(),
    used_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    ...over,
  });

  const read = (over, caller = {}) =>
    readConnectAttempt({
      attemptId: ATTEMPT,
      tenantId: TENANT,
      userId: USER,
      audience: "admin",
      load: async () => (over === null ? null : row(over)),
      ...caller,
    });

  test("the caller's own attempt resolves", async () => {
    const attempt = await read({});
    assert.equal(attempt.phase, "completed");
    assert.equal(attempt.attemptId, ATTEMPT);
    assert.equal(attempt.accountId, OTHER_ID);
  });

  test("another workspace's attempt is not found", async () => {
    assert.equal(await read({ tenant_id: OTHER_TENANT }), null);
  });

  test("a colleague's attempt in the same workspace is not found", async () => {
    // Tenant scoping alone would let one person resolve another's in-flight
    // sign-in by guessing a uuid.
    assert.equal(await read({ user_id: OTHER_USER }), null);
  });

  test("an id that does not exist is not found", async () => {
    assert.equal(await read(null), null);
  });

  test("a caller with no workspace yet is refused before any read", async () => {
    let touched = false;
    const attempt = await readConnectAttempt({
      attemptId: ATTEMPT,
      tenantId: null,
      userId: USER,
      audience: "user",
      load: async () => {
        touched = true;
        return row();
      },
    });
    assert.equal(attempt, null);
    assert.equal(touched, false);
  });

  test("nothing sensitive is returned", async () => {
    const attempt = await read({});
    assert.deepEqual(Object.keys(attempt).sort(), [
      "accountId",
      "attemptId",
      "phase",
      "platform",
      "problem",
      "updatedAt",
    ]);
    assert.equal(looksLikeSecret(JSON.stringify(attempt)), false);
  });

  test("an attempt still running reads as pending", async () => {
    const attempt = await read({ attempt_state: "started", used_at: null, attempt_reason: null });
    assert.equal(attempt.phase, "pending");
    assert.equal(attempt.problem, null);
  });

  test("an unfinished attempt past its expiry reads as expired without a sweep", async () => {
    // The sweep keeps the table small; correctness must not depend on it
    // having run. purge_expired_oauth_states() existed for weeks unused.
    const attempt = await read({
      attempt_state: "started",
      used_at: null,
      attempt_reason: null,
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    });
    assert.equal(attempt.phase, "expired");
    assert.equal(attempt.problem.code, "OAUTH_ATTEMPT_EXPIRED");
  });

  test("a pending target choice is not reported as finished", async () => {
    const attempt = await read({
      attempt_reason: encodeAttemptReason({ targetAccountId: OTHER_ID, reason: "Choose a Page" }),
    });
    assert.equal(attempt.phase, "needs_target");
    assert.equal(attempt.accountId, OTHER_ID);
  });

  test("a cancelled callback reads as cancelled, with cancellation copy", async () => {
    const attempt = await read({
      attempt_state: "cancelled",
      attempt_reason: encodeAttemptReason({ code: "access_denied", reason: "declined" }),
    });
    assert.equal(attempt.phase, "cancelled");
    assert.equal(attempt.problem.code, "OAUTH_ACCESS_DENIED");
    assert.equal(attempt.problem.severity, "info", "a cancellation is not a fault");
  });

  test("a failed exchange carries the problem its code names", async () => {
    const attempt = await read({
      attempt_state: "callback_error",
      attempt_reason: encodeAttemptReason({
        code: "token_exchange_failed",
        reason: "HTTP 400 from meta",
      }),
    });
    assert.equal(attempt.phase, "failed");
    assert.equal(attempt.problem.code, "OAUTH_TOKEN_EXCHANGE_FAILED");
  });

  test("a non-admin is not handed administrator detail", async () => {
    const attempt = await read(
      {
        attempt_state: "callback_error",
        attempt_reason: encodeAttemptReason({
          code: "platform_app_missing",
          reason: "no client id",
        }),
      },
      { audience: "user" },
    );
    assert.equal(attempt.problem.technical, undefined);
    assert.equal(attempt.problem.url, undefined);
    assert.match(attempt.problem.nextAction, /administrator/i);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * What each failure actually tells the customer
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("every failure code has plain-English copy", () => {
  const CODES = [
    "platform_app_missing",
    "token_exchange_failed",
    "pkce_error",
    "state_expired",
    "state_invalid",
    "access_denied",
    "redirect_uri_mismatch",
    "scope_rejected",
    "no_eligible_target",
    "multiple_targets",
    "grant_expired",
    "connect_failed",
  ];

  test("each one produces an actionable problem", () => {
    for (const code of CODES) {
      const problem = connectAttemptProblem(code, {
        platform: "instagram",
        redirectUri: "https://app.flas.example/api/public/oauth-callback",
      });
      assert.ok(problem, `no problem built for "${code}"`);
      assert.ok(problem.title && problem.message && problem.nextAction, `"${code}" is incomplete`);
      assert.ok(
        ["FLAS_ADMIN", "WORKSPACE_ADMIN", "END_USER", "PROVIDER"].includes(problem.owner),
        `"${code}" has no valid owner`,
      );
      // The contract's copy rule: no environment variable names or API jargon
      // in anything a customer reads.
      const visible = `${problem.title} ${problem.message} ${problem.nextAction}`;
      assert.equal(/[A-Z_]{6,}/.test(visible), false, `"${code}" leaks a setting name: ${visible}`);
      assert.equal(looksLikeSecret(visible), false);
    }
  });

  test("a redirect mismatch hands over the exact address to register", () => {
    const redirectUri = "https://app.flas.example/api/public/oauth-callback";
    const problem = connectAttemptProblem("redirect_uri_mismatch", {
      platform: "instagram",
      redirectUri,
    });
    assert.match(problem.title, /does not recognise/i);
    assert.equal(problem.copyValue, redirectUri);
    assert.ok(problem.copyLabel);
    // The link has to name the page it opens, not say "platform settings".
    assert.match(problem.url, /^https:\/\/developers\.facebook\.com/);
    assert.match(problem.urlLabel, /Meta/);
  });

  test("missing app keys are an administrator's job, not the user's", () => {
    const problem = connectAttemptProblem("platform_app_missing", { platform: "instagram" });
    assert.equal(problem.owner, "WORKSPACE_ADMIN");
    assert.ok(problem.userMessage, "someone who cannot fix it needs their own wording");
  });

  test("no code means no problem invented", () => {
    assert.equal(connectAttemptProblem(null, { platform: "instagram" }), null);
  });

  test("an unrecognised code still says something useful", () => {
    const problem = connectAttemptProblem("something_new", { platform: "instagram" });
    assert.ok(problem.title && problem.nextAction);
  });
});
