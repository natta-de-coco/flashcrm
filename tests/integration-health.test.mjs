// Integration health, end to end through the real handlers: what the Connect accounts screen and
// the Health report say about an account, and what pressing Verify now / Retry now does.
//
//   npm run test:connection-state
//
// Issue #77, item 2: "Facebook says verified and nothing was checked". The code under test is the
// real bundle (scripts/build-health-bundle.mjs); the database, the network and the token refresh
// are the doubles in tests/support/health-world.mjs. No test can reach a real platform.
//
// MUTATION=<name> puts one bug back (see mutate() at the bottom of each section); each MUST fail
// at least one test. The names are listed in the pull request.
import { test, describe, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  A,
  ADMIN_A,
  B,
  BATCH1_EDGES,
  CONNECTION_STATES,
  DAY,
  EVIDENCE,
  GRAPH,
  HOUR,
  LIVE_EDGES,
  SECRET,
  accepts,
  createWorld,
  everything,
  facebookHealthy,
  installTrigger,
  iso,
  json,
  on,
  requiredScopesFor,
  withoutEvidenceColumns,
} from "./support/health-world.mjs";
import { connectionStatus } from "../node_modules/.cache/flas-connection-status.mjs";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

/** The rule, stated here on purpose rather than imported: a row needs attention unless it is fine or left alone. */
const needsAttention = (state) => state !== "connected" && state !== "not_connected";

const world = createWorld();
const functions = await import("../node_modules/.cache/flas-health-functions.mjs");
const engine = await import("../node_modules/.cache/flas-health-engine.mjs");
const reconnect = await import("../node_modules/.cache/flas-health-connections-server.mjs");
const { getConnections, getIntegrationHealthReport, retryConnections } = functions;

const MUTATION = process.env.MUTATION ?? "";
if (MUTATION) console.log(`!! MUTATION: ${MUTATION} — the suite must FAIL`);

beforeEach(() => world.reset());
afterEach(() => world.restore());

const connections = async (session = world.admin()) => await getConnections({ context: session });
const report = async (session = world.admin()) =>
  await getIntegrationHealthReport({ context: session });
const rowFor = (rep, id) => rep.rows.find((r) => r.account_id === id);

/** A verified, synced account: saved check, identified, every permission, synced an hour ago. */
const verified = (over = {}) =>
  world.account({
    last_validation_success_at: iso(-2 * HOUR),
    last_validation_attempt_at: iso(-2 * HOUR),
    ...over,
  });

describe("the Connect accounts screen is sent the proof it reads (B1)", () => {
  test("a verified account is Connected there, and an unverified one is not", async () => {
    const good = verified();
    const unproven = world.account({ external_id: "1001" });
    const { accounts } = await connections();
    const byId = (id) => accounts.find((a) => a.id === id);
    // The screen calls connectionStatus(account) on what it receives (IntegrationsAuditFixed).
    assert.equal(connectionStatus(byId(good.id)).state, "connected");
    assert.equal(connectionStatus(byId(unproven.id)).state, "unverified");
    assert.equal(byId(good.id).last_validation_success_at, good.last_validation_success_at);
    assert.equal(byId(good.id).evidence, "ok");
  });

  test("no token or refresh token ever leaves the server", async () => {
    verified({ refresh_token: `sealed:${SECRET.googleRefresh}` });
    const { accounts } = await connections();
    const text = JSON.stringify(accounts);
    assert.doesNotMatch(text, /access_token|refresh_token"|sealed:|EAAB|1\/\/0g/);
  });
});

describe("both readers answer the same for the same account (T12, B6)", () => {
  test("screen, server status and report agree on a table of accounts", async () => {
    const granted = requiredScopesFor("instagram");
    const rows = [
      verified({ platform: "facebook", label: "Verified page" }),
      world.account({ platform: "facebook", label: "Second page", external_id: "1001" }),
      verified({
        platform: "instagram",
        label: "Missing permission",
        external_id: "2000",
        granted_scopes: granted.slice(1),
      }),
      verified({
        platform: "youtube",
        label: "Never synced",
        external_id: "UC1",
        last_synced_at: null,
      }),
      world.account({
        platform: "google_business",
        label: "Unplugged",
        external_id: "g1",
        active: false,
        connection_state: "disconnected",
        access_token: null,
      }),
      verified({
        platform: "linkedin",
        label: "Outage",
        external_id: "l1",
        connection_state: "provider_unavailable",
        next_retry_at: iso(HOUR),
      }),
      world.account({ platform: "facebook", label: "Pending", external_id: null }),
      world.account({
        platform: "tiktok",
        label: "Refused",
        external_id: "t1",
        active: false,
        connection_state: "revoked",
      }),
      verified({
        platform: "twitter",
        label: "No permissions",
        external_id: "x1",
        granted_scopes: null,
      }),
    ];
    const screen = await connections();
    const rep = await report();
    for (const r of rows) {
      const account = screen.accounts.find((a) => a.id === r.id);
      const reportRow = rowFor(rep, r.id);
      assert.ok(account && reportRow, `${r.label} is missing from a reader`);
      const fromScreen = connectionStatus(account); // what the browser computes
      assert.deepEqual(
        [account.status.state, account.status.label, account.status.reason, account.status.code],
        [fromScreen.state, fromScreen.label, fromScreen.reason, fromScreen.code],
        `${r.label}: the server's status and the browser's disagree`,
      );
      assert.deepEqual(
        [reportRow.state, reportRow.state_label, reportRow.reason, reportRow.reason_code],
        [fromScreen.state, fromScreen.label, fromScreen.reason, fromScreen.code],
        `${r.label}: the report and the screen disagree`,
      );
      assert.equal(
        JSON.stringify(reportRow.reason_params),
        JSON.stringify(fromScreen.params),
        `${r.label}: parameters differ`,
      );
    }
  });

  test("the report states its own reason, not a stale sentence stored on the row", async () => {
    // A row whose stored sentence says everything is fine, and which nobody ever verified.
    const stale = world.account({
      status_reason: "Healthy — verified yesterday, last synced an hour ago.",
      last_error: "Meta said no. access_token=EAABwzLixnjYBO1234567890abcdefghijklmnop",
    });
    const row = rowFor(await report(), stale.id);
    assert.equal(row.state, "unverified");
    assert.equal(row.reason_code, "not_verified");
    assert.doesNotMatch(row.reason, /Healthy|verified yesterday/);
    // What the platform last said is shown beside it, and with the secret taken out.
    assert.match(row.last_error, /Meta said no/);
    assert.doesNotMatch(row.last_error, /EAABwzLixnj/);
  });
});

describe("the report counts what it lists (B3, B5, T11)", () => {
  test("two unverified accounts are two needing attention, and the totals add up", async () => {
    world.account({ label: "One" });
    world.account({ label: "Two", external_id: "1001" });
    verified({ platform: "linkedin", external_id: "l1" });
    const rep = await report();
    assert.equal(rep.totals.unverified, 2);
    assert.equal(rep.needs_attention, 2);
    assert.equal(rep.connected, 1);
    // The number is exactly the rows the dialog lists.
    const listed = rep.rows.filter((r) => needsAttention(r.state));
    assert.equal(rep.needs_attention, listed.length);
    assert.equal(
      Object.values(rep.totals).reduce((a, b) => a + b, 0),
      rep.rows.length,
      "every row is counted once",
    );
  });

  test("provider_unavailable and disconnected are counted the right way round", async () => {
    world.account({
      platform: "linkedin",
      external_id: "l1",
      connection_state: "provider_unavailable",
    });
    world.account({
      platform: "tiktok",
      external_id: "t1",
      active: false,
      access_token: null,
      connection_state: "disconnected",
    });
    const rep = await report();
    assert.equal(rep.totals.provider_unavailable, 1);
    assert.equal(rep.needs_attention, 1);
    const disconnected = rep.rows.find((r) => r.reason_code === "disconnected");
    assert.equal(disconnected.state, "not_connected");
    assert.equal(needsAttention(disconnected.state), false);
  });

  test("every account has its own row: two channels and a pending sign-in on one platform", async () => {
    const one = world.account({ label: "Page one", external_id: "1000" });
    const two = world.account({ label: "Page two", external_id: "1001" });
    const pending = world.account({ label: "Pending", external_id: null });
    const rep = await report();
    const facebook = rep.rows.filter((r) => r.platform === "facebook");
    assert.deepEqual(facebook.map((r) => r.account_id).sort(), [one.id, two.id, pending.id].sort());
    assert.equal(rowFor(rep, pending.id).reason_code, "unidentified");
    // A platform nobody connected still gets exactly one row, with no account.
    const youtube = rep.rows.filter((r) => r.platform === "youtube");
    assert.equal(youtube.length, 1);
    assert.equal(youtube[0].account_id, null);
    assert.equal(youtube[0].state, "not_connected");
  });
});

describe("permissions come from granted_scopes only (B2, B4, T2)", () => {
  test("capability keys in `permissions` are not scopes, so nothing is falsely missing", async () => {
    // The platform never listed its scopes; `permissions` holds Flas's own capability keys.
    const account = world.account({
      granted_scopes: null,
      permissions: { granted: ["profile", "comments_read"] },
    });
    const row = rowFor(await report(), account.id);
    assert.deepEqual(row.granted_permissions, []);
    assert.deepEqual(row.missing_permissions, []);
    assert.equal(row.reason_code, "scopes_unknown");
    assert.notEqual(row.state, "connected");
  });

  test("a real missing permission is named, in plain features, by the report and by the screen", async () => {
    const granted = requiredScopesFor("facebook").filter((p) => p !== "pages_messaging");
    const account = verified({ granted_scopes: granted });
    const row = rowFor(await report(), account.id);
    assert.equal(row.state, "needs_verification");
    assert.deepEqual(row.missing_permissions, ["Read DMs"]);
    const screen = (await connections()).accounts.find((a) => a.id === account.id);
    assert.deepEqual(connectionStatus(screen).params.missing, ["Read DMs"]);
    assert.equal(row.action, "reconnect");
  });
});

describe("technical details are for Flas staff only", () => {
  const TECHNICAL = [
    "pages_messaging",
    "pages_show_list",
    "read_insights",
    "app secret",
    "client_secret",
    "redirect_uri",
  ];
  const staffSession = () => {
    world.db.table("profiles").push({ id: "staff-1", tenant_id: A, staff_role: "super_admin" });
    return world.session(A, "staff-1");
  };

  test("a company admin's report names no permission, credential or provider answer", async () => {
    const granted = requiredScopesFor("facebook").filter((p) => p !== "pages_messaging");
    const withGap = verified({
      granted_scopes: granted,
      last_error: "(#200) Requires pages_messaging permission",
    });
    world.account({
      external_id: "1001",
      last_error: "Platform app credentials are missing. Check the App secret.",
    });
    const rep = await report();
    const text = JSON.stringify(rep);
    for (const word of TECHNICAL) assert.ok(!text.includes(word), "the report leaked " + word);
    // The plain version is there: which feature is affected.
    assert.deepEqual(rowFor(rep, withGap.id).missing_permissions, ["Read DMs"]);
    assert.equal(rowFor(rep, withGap.id).diagnostics, null);
    assert.deepEqual(rowFor(rep, withGap.id).granted_permissions, []);
    // A provider answer that names a permission or a credential is withheld, not rewritten.
    assert.equal(rowFor(rep, withGap.id).last_error, null);
  });

  test("the screen's status for a company admin carries features, never permission names", async () => {
    const granted = requiredScopesFor("facebook").filter((p) => p !== "pages_messaging");
    const account = verified({ granted_scopes: granted });
    const screen = (await connections()).accounts.find((a) => a.id === account.id);
    const text = JSON.stringify(screen.status);
    assert.doesNotMatch(text, /pages_messaging/);
    assert.match(screen.status.reason, /Read DMs/);
  });

  test("staff get the diagnostics: technical names, stage and the platform's own words", async () => {
    const granted = requiredScopesFor("facebook").filter((p) => p !== "pages_messaging");
    const account = verified({ granted_scopes: granted, last_error: "Requires pages_messaging" });
    world.db.table("connection_retry_log").push({
      id: "log-1",
      tenant_id: A,
      account_id: account.id,
      platform: "facebook",
      outcome: "scopes_missing",
      reason: "x",
      trigger: "manual",
      created_at: iso(-1000),
      details: {
        stage: "probe",
        http_status: 200,
        correlation_id: "abcdef12-0000-4000-8000-000000000000",
        provider_message: "(#200) Requires pages_messaging permission",
      },
    });
    const row = rowFor(await report(staffSession()), account.id);
    assert.deepEqual(row.diagnostics.scopes_missing, ["pages_messaging"]);
    assert.ok(row.diagnostics.scopes_granted.length > 0);
    assert.equal(row.diagnostics.stage, "probe");
    assert.equal(row.diagnostics.http_status, 200);
    assert.equal(row.diagnostics.correlation_id, "abcdef12");
    assert.match(row.diagnostics.provider_message, /pages_messaging/);
    assert.equal(row.diagnostics.evidence_storage, "ready");
    assert.ok(row.granted_permissions.length > 0);
    assert.match(row.last_error, /pages_messaging/);
  });
});

describe("one next step, chosen from the evidence (acceptance)", () => {
  const actionOf = async (over, platform = "facebook") => {
    world.reset();
    const account = world.account({ platform, ...over });
    return rowFor(await report(), account.id).action;
  };

  test("each account gets exactly the step its own facts call for", async () => {
    assert.equal(await actionOf({ external_id: null }), "choose_account");
    assert.equal(await actionOf({}), "verify");
    assert.equal(await actionOf({ last_validation_success_at: iso(-HOUR) }), "none");
    assert.equal(
      await actionOf({ last_validation_success_at: iso(-HOUR), granted_scopes: ["x"] }),
      "reconnect",
      "a missing permission",
    );
    assert.equal(await actionOf({ connect_method: "manual" }), "reconnect", "a pasted token");
    assert.equal(
      await actionOf({ active: false, connection_state: "revoked" }),
      "reconnect",
      "a refused token",
    );
    assert.equal(
      await actionOf({ active: false, access_token: null, connection_state: "disconnected" }),
      "connect",
    );
    assert.equal(await actionOf({ connection_state: "provider_unavailable" }), "retry");
    // Flas has no live check for Threads, so it must not offer to verify it.
    assert.equal(await actionOf({ external_id: "t1" }, "threads"), "coming_soon");
  });

  test("a platform nobody connected offers to connect, or says coming soon if Flas has not built it", async () => {
    const rep = await report();
    const of = (platform) => rep.rows.find((r) => r.platform === platform && !r.account_id);
    assert.equal(of("facebook").action, "connect");
    assert.equal(of("youtube").action, "connect");
    // TikTok Ads and WhatsApp have no sign-in Flas can run, so there is nothing to press yet.
    assert.equal(of("tiktok_ads").action, "coming_soon");
    assert.equal(of("whatsapp").action, "coming_soon");
  });
});

describe("a deliberate disconnect reads as one (B7, T7 readers)", () => {
  test("Disconnected, with the on-purpose sentence, and not counted as needing attention", async () => {
    const gone = world.account({
      active: false,
      access_token: null,
      refresh_token: null,
      connection_state: "disconnected",
      last_validation_success_at: iso(-3 * DAY),
    });
    const rep = await report();
    const row = rowFor(rep, gone.id);
    assert.equal(row.state, "not_connected");
    assert.equal(row.state_label, "Disconnected");
    assert.match(row.reason, /on purpose/);
    assert.doesNotMatch(row.reason, /revoked|refused/);
    assert.equal(rep.needs_attention, 0);
    const screen = (await connections()).accounts.find((a) => a.id === gone.id);
    assert.equal(screen.status.code, "disconnected");
  });
});

describe("when verification results cannot be saved, nothing reads as verified (T4 readers)", () => {
  test("both readers say so, the page still loads, and nothing is green", async () => {
    // The evidence columns do not exist in this database: the generated types do not list them.
    withoutEvidenceColumns(world);
    // Even if a stale value somehow sat on the row, it must not count.
    const account = verified();
    const screen = await connections();
    assert.equal(screen.accounts.length, 1, "the screen must still load");
    assert.equal(screen.accounts[0].evidence, "unavailable");
    assert.equal(connectionStatus(screen.accounts[0]).code, "evidence_unavailable");
    assert.notEqual(connectionStatus(screen.accounts[0]).state, "connected");

    const rep = await report();
    const row = rowFor(rep, account.id);
    assert.equal(row.evidence_state, "unavailable");
    assert.equal(row.reason_code, "evidence_unavailable");
    assert.match(row.reason, /cannot save verification results/);
    assert.equal(rep.connected, 0);
    // Whether results can be saved is a staff diagnostic; the company sees only the plain sentence.
    assert.equal(row.diagnostics, null);
    world.db.table("profiles").push({ id: "staff-1", tenant_id: A, staff_role: "super_admin" });
    const staffRow = rowFor(await report(world.session(A, "staff-1")), account.id);
    assert.equal(staffRow.diagnostics.evidence_storage, "missing");
  });

  test("a database that cannot be read for any other reason is also never green", async () => {
    verified();
    world.db.fail("social_accounts:read", (q) =>
      EVIDENCE.some((c) => String(q.columns ?? "").includes(c))
        ? { code: "57P01", message: "terminating connection" }
        : undefined,
    );
    const screen = await connections();
    assert.equal(screen.accounts[0].evidence, "unavailable");
    assert.notEqual(connectionStatus(screen.accounts[0]).state, "connected");
  });

  test("a report that cannot read the accounts fails instead of showing every platform empty", async () => {
    world.db.fail("social_accounts:read", (q) =>
      String(q.columns ?? "").includes("created_at")
        ? { code: "57P01", message: "down" }
        : undefined,
    );
    await assert.rejects(report(), /could not read/i);
  });
});

describe("only a company admin may run or read checks (F1, T14)", () => {
  test("a member is refused by both, and no platform is asked", async () => {
    verified();
    world.provider([]); // any request at all would throw "unplanned request"
    await assert.rejects(report(world.member()), /Only a company admin can check connections/);
    await assert.rejects(
      retryConnections({ data: {}, context: world.member() }),
      /Only a company admin can check connections/,
    );
    assert.equal(world.fetches.length, 0);
    assert.equal(world.logRows().length, 0);
  });

  test("a company admin and a platform owner are allowed", async () => {
    verified();
    world.db.table("profiles").push({ id: "owner-1", tenant_id: A, staff_role: "super_admin" });
    await report(world.admin());
    await report(world.session(A, "owner-1"));
  });
});

describe("reconnecting clears what the old token proved (T-reconnect)", () => {
  const save = async (args = {}) =>
    await reconnect.saveAuthorizedConnection({
      tenantId: A,
      platform: "facebook",
      token: SECRET.metaNew,
      refreshToken: null,
      expiresAt: iso(60 * DAY),
      grantedScopes: requiredScopesFor("facebook"),
      profile: { external_id: "1000", name: "Acme Page" },
      permissions: ["profile"],
      ...args,
    });

  test("the old verification does not survive a new token", async () => {
    const account = verified();
    assert.ok(account.last_validation_success_at);
    await save();
    const row = world.stored(account.id);
    assert.equal(row.last_validation_success_at, null);
    assert.equal(row.last_validation_attempt_at, null);
    assert.equal(row.access_token, `sealed:${SECRET.metaNew}`, "the new token must be saved");
  });

  test("it still reconnects where the evidence columns do not exist", async () => {
    withoutEvidenceColumns(world);
    const account = world.account();
    await save();
    assert.equal(world.stored(account.id).access_token, `sealed:${SECRET.metaNew}`);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   The checks themselves: what pressing Verify now / Retry now does.
   ══════════════════════════════════════════════════════════════════════════ */

const stateMod = await import("../node_modules/.cache/flas-connection-state.mjs");
const modelMod = await import("../node_modules/.cache/flas-health-model.mjs");

const check = async (id, session = world.admin()) =>
  (await retryConnections({ data: { accountId: id }, context: session })).results[0];
const checkAll = async (session = world.admin()) =>
  (await retryConnections({ data: {}, context: session })).results;
const clone = (value) => JSON.parse(JSON.stringify(value));

const GOOGLE = "https://oauth2.googleapis.com/tokeninfo";
const tokeninfo = (reply) => ({
  match: (url, init) => url === GOOGLE && init?.method === "POST",
  reply,
});
const googleOk = (scopes = requiredScopesFor("youtube")) =>
  tokeninfo(() => json(200, { scope: scopes.join(" "), expires_in: "3000" }));
const channel = (over = {}) =>
  world.account({
    platform: "youtube",
    external_id: "UC1",
    label: "Channel",
    access_token: `sealed:${SECRET.googleAccess}`,
    refresh_token: `sealed:${SECRET.googleRefresh}`,
    token_expires_at: iso(HOUR),
    ...over,
  });

describe("Verify now asks the platform and saves what it said (T1)", () => {
  test("a Facebook Page: asked for the saved Page, result saved, both readers agree", async () => {
    const account = world.account();
    world.provider(facebookHealthy());
    const result = await check(account.id);

    assert.equal(result.outcome, "healthy");
    assert.deepEqual(
      world.fetches.map((f) => f.url),
      [`${GRAPH}/1000?fields=id`, `${GRAPH}/me/permissions`],
      "it must ask about the saved Page itself, then its permissions",
    );
    for (const f of world.fetches) {
      assert.equal(f.headers.Authorization, `Bearer ${SECRET.meta}`, "the token goes in a header");
      assert.ok(f.signal instanceof AbortSignal, "every request has a timeout");
      assert.doesNotMatch(f.url, /access_token|EAAB/);
    }

    const row = world.stored(account.id);
    assert.ok(row.last_validation_success_at, "the proof was not saved");
    assert.ok(row.last_validation_attempt_at);
    assert.equal(row.health, "connected");
    assert.equal(row.connection_state, "connected");
    assert.equal(result.saved_at, row.last_validation_success_at);
    assert.equal(result.status.state, "connected");
    assert.match(result.reason, /^Verified\. Facebook accepted the token/);
    assert.equal(result.log_saved, true);

    const screen = (await connections()).accounts.find((a) => a.id === account.id);
    const rep = rowFor(await report(), account.id);
    assert.equal(connectionStatus(screen).state, "connected");
    assert.deepEqual(
      [rep.state, rep.state_label, rep.reason],
      [result.status.state, result.status.label, result.status.reason],
      "the check, the screen and the report must say the same thing",
    );
  });

  test("an Instagram account is asked about its own account id, not about /me", async () => {
    const account = world.account({ platform: "instagram", external_id: "2000" });
    world.provider(facebookHealthy({ id: "2000", scopes: requiredScopesFor("instagram") }));
    const result = await check(account.id);
    assert.equal(result.outcome, "healthy");
    assert.equal(world.fetches[0].url, `${GRAPH}/2000?fields=id`);
    assert.ok(world.stored(account.id).last_validation_success_at);
  });

  test("a platform that answers for a different account verifies nothing", async () => {
    const account = world.account();
    world.provider([
      on(`${GRAPH}/1000?fields=id`, () => json(200, { id: "9999" })),
      on(`${GRAPH}/me/permissions`, () => json(200, { data: [] })),
    ]);
    const result = await check(account.id);
    assert.equal(result.outcome, "needs_reconnect");
    assert.equal(world.stored(account.id).last_validation_success_at, null);
    assert.notEqual(result.status.state, "connected");
  });

  test("Google: the token is sent in the request body, never in the address", async () => {
    const account = channel();
    world.provider([googleOk()]);
    const result = await check(account.id);
    assert.equal(result.outcome, "healthy");
    const [call] = world.fetches;
    assert.equal(call.method, "POST");
    assert.equal(call.url, GOOGLE);
    assert.equal(call.url.includes(SECRET.googleAccess), false);
    assert.match(String(call.body), /access_token=/);
    assert.ok(world.stored(account.id).last_validation_success_at);
  });

  test("the group Retry now checks an unverified account (the old 'nothing to retry' message)", async () => {
    // An active, identified account nobody ever verified used to be skipped by the group retry,
    // so the dialog said every connection was healthy while nothing had been checked.
    const account = world.account();
    world.provider(facebookHealthy());
    const results = await checkAll();
    assert.equal(results.length, 1);
    assert.equal(results[0].outcome, "healthy");
    assert.ok(world.stored(account.id).last_validation_success_at);
  });
});

describe("a missing permission is reported, not hidden behind a working token (T2)", () => {
  test("no verification is saved, the state says so, and both readers name the feature", async () => {
    const account = world.account();
    const granted = requiredScopesFor("facebook").filter((p) => p !== "pages_messaging");
    world.provider(facebookHealthy({ scopes: granted }));
    const result = await check(account.id);

    assert.equal(result.outcome, "scopes_missing");
    assert.match(result.reason, /did not grant: Read DMs/);
    assert.doesNotMatch(result.reason, /pages_messaging/);
    assert.deepEqual(result.params.permissions, ["Read DMs"]);
    const row = world.stored(account.id);
    assert.equal(row.last_validation_success_at, null);
    assert.ok(row.last_validation_attempt_at, "the attempt is still recorded");
    assert.equal(row.connection_state, "scope_incomplete");
    assert.deepEqual(row.granted_scopes, granted, "the fresher list from the platform is kept");
    assert.equal(rowFor(await report(), account.id).state, "needs_verification");
    const screen = (await connections()).accounts.find((a) => a.id === account.id);
    assert.equal(connectionStatus(screen).state, "needs_verification");
  });

  test("a platform that lists no permissions cannot be verified either", async () => {
    // Facebook Page tokens may not answer /me/permissions, and nothing was stored at connect time.
    const account = world.account({ granted_scopes: null });
    world.provider([
      on(`${GRAPH}/1000?fields=id`, () => json(200, { id: "1000" })),
      on(`${GRAPH}/me/permissions`, () => json(400, { error: { message: "no", code: 100 } })),
    ]);
    const result = await check(account.id);
    assert.equal(result.outcome, "scopes_unknown");
    assert.equal(world.stored(account.id).last_validation_success_at, null);
  });
});

describe("a result that was not saved is never reported as saved (T3)", () => {
  test("the database refuses the write", async () => {
    const account = world.account();
    world.provider(facebookHealthy());
    world.db.fail("social_accounts:update", { code: "XX000", message: "disk full" });
    const result = await check(account.id);
    assert.equal(result.outcome, "save_failed");
    assert.match(
      result.reason,
      /could not save the result, so nothing was marked verified\. Reference [0-9a-f]{8}\./,
    );
    assert.equal(world.stored(account.id).last_validation_success_at, null);
    assert.notEqual(result.status.state, "connected");
    assert.equal(rowFor(await report(), account.id).state, "unverified");
    const screen = (await connections()).accounts.find((a) => a.id === account.id);
    assert.equal(connectionStatus(screen).state, "unverified");
  });

  test("the write matches no account: it changed meanwhile, nothing is marked verified", async () => {
    const account = world.account();
    world.provider(facebookHealthy());
    world.db.fail("social_accounts:update", { empty: true });
    const result = await check(account.id);
    assert.equal(result.outcome, "changed_while_checking");
    assert.equal(world.stored(account.id).last_validation_success_at, null);
    assert.notEqual(result.outcome, "healthy");
  });

  test("a log entry that cannot be written does not undo a verification that was saved", async () => {
    const account = world.account();
    world.provider(facebookHealthy());
    world.db.fail("connection_retry_log:insert", { message: "log table is down" });
    const result = await check(account.id);
    assert.equal(result.outcome, "healthy");
    assert.equal(result.log_saved, false);
    assert.ok(world.stored(account.id).last_validation_success_at);
  });

  test("a renewed token is kept even when the result could not be saved", async () => {
    // Google and X retire the old refresh token the moment a new one is issued. Losing the new one
    // would break the connection for a reason nobody could see.
    const account = channel({ token_expires_at: iso(-HOUR) });
    world.provider([googleOk()]);
    world.db.fail("social_accounts:update", (q) =>
      "last_validation_attempt_at" in (q.patch ?? {})
        ? { code: "XX000", message: "boom" }
        : undefined,
    );
    const result = await check(account.id);
    assert.equal(result.outcome, "save_failed");
    assert.equal(world.refreshCalls.length, 1);
    assert.equal(world.stored(account.id).access_token, `sealed:${SECRET.metaNew}`);
    assert.equal(world.stored(account.id).last_validation_success_at, null);
  });
});

describe("a workspace without the evidence columns never shows green (T4)", () => {
  test("the check ends 'cannot store results', both readers say so, nothing is green", async () => {
    withoutEvidenceColumns(world);
    const account = world.account();
    world.provider(facebookHealthy());
    const result = await check(account.id);

    assert.equal(result.outcome, "evidence_unavailable");
    assert.match(result.reason, /cannot store verification results yet\. Reference [0-9a-f]{8}\./);
    const row = world.stored(account.id);
    assert.ok(!row.last_validation_success_at);
    assert.notEqual(row.health, "connected", "the old health column must not say connected either");
    assert.equal(result.status.code, "evidence_unavailable");
    const rep = await report();
    assert.equal(rowFor(rep, account.id).reason_code, "evidence_unavailable");
    assert.equal(rep.connected, 0);
    const screen = (await connections()).accounts.find((a) => a.id === account.id);
    assert.equal(connectionStatus(screen).code, "evidence_unavailable");
  });
});

describe("renewing a token (T5)", () => {
  test("two checks at once renew once; the other stands aside; the lease outlives the write", async () => {
    const account = channel({ token_expires_at: iso(-HOUR) });
    world.provider([googleOk()]);
    const order = [];
    let granted = false;
    world.db.onRpc("try_lock_connection_refresh", async () => {
      order.push("lock");
      const first = !granted;
      granted = true;
      return { data: first, error: null };
    });
    world.db.onRpc("release_connection_refresh", async () => {
      order.push("release");
      return { data: null, error: null };
    });
    world.db.fail("social_accounts:update", () => {
      order.push("write");
      return undefined;
    });
    world.refreshImpl = async (args) => {
      order.push("refresh");
      await new Promise((resolve) => setImmediate(resolve));
      return {
        token: SECRET.metaNew,
        refreshToken: args.refreshToken,
        expiresAt: iso(HOUR),
        scopes: [],
      };
    };

    const results = await Promise.all([check(account.id), check(account.id)]);
    assert.deepEqual(results.map((r) => r.outcome).sort(), ["in_progress", "refreshed"]);
    assert.equal(world.refreshCalls.length, 1, "the provider must be asked to renew once");
    assert.ok(
      order.indexOf("write") < order.indexOf("release"),
      "released before the write: " + order,
    );
    assert.equal(world.stored(account.id).access_token, `sealed:${SECRET.metaNew}`);
    assert.ok(world.stored(account.id).last_validation_success_at);
  });

  test("a lease that cannot be taken renews nothing and changes nothing", async () => {
    const account = channel({ token_expires_at: iso(-HOUR) });
    world.provider([googleOk()]);
    world.db.onRpc("try_lock_connection_refresh", async () => ({
      data: null,
      error: { message: "rpc failed" },
    }));
    const before = clone(world.stored(account.id));
    const result = await check(account.id);
    assert.equal(result.outcome, "in_progress");
    assert.equal(world.refreshCalls.length, 0);
    assert.deepEqual(clone(world.stored(account.id)), before);
  });

  test("a healthy check never rewrites the token columns", async () => {
    const account = world.account();
    world.provider(facebookHealthy());
    const patches = [];
    world.db.fail("social_accounts:update", (q) => {
      patches.push(q.patch);
      return undefined;
    });
    await check(account.id);
    assert.equal(patches.length, 1, "exactly one write");
    for (const column of ["access_token", "refresh_token", "token_expires_at"]) {
      assert.ok(
        !(column in patches[0]),
        column + " must not be written by a check that renewed nothing",
      );
    }
  });

  test("a renewal is saved only if the stored tokens are still the ones it started from", async () => {
    const account = channel({ token_expires_at: iso(-HOUR) });
    world.provider([googleOk()]);
    // While the platform is being asked, somebody reconnects the account: new tokens are stored.
    world.refreshImpl = async (args) => {
      Object.assign(world.stored(account.id), {
        access_token: "sealed:from-the-reconnect",
        refresh_token: "sealed:also-from-the-reconnect",
      });
      return {
        token: SECRET.metaNew,
        refreshToken: args.refreshToken,
        expiresAt: iso(HOUR),
        scopes: [],
      };
    };
    const result = await check(account.id);
    assert.equal(result.outcome, "changed_while_checking");
    assert.equal(world.stored(account.id).access_token, "sealed:from-the-reconnect");
    assert.equal(world.stored(account.id).refresh_token, "sealed:also-from-the-reconnect");
    assert.equal(world.stored(account.id).last_validation_success_at, null);
  });

  test("if somebody renewed it while this check waited for the lease, theirs is used", async () => {
    const account = channel({ token_expires_at: iso(-HOUR) });
    world.provider([googleOk()]);
    world.db.onRpc("try_lock_connection_refresh", async () => {
      Object.assign(world.stored(account.id), {
        access_token: "sealed:renewed-by-someone-else",
        token_expires_at: iso(HOUR),
      });
      return { data: true, error: null };
    });
    const result = await check(account.id);
    assert.equal(result.outcome, "healthy");
    assert.equal(world.refreshCalls.length, 0, "it must not renew again");
    assert.match(String(world.fetches[0].body), /renewed-by-someone-else/);
    assert.equal(world.stored(account.id).access_token, "sealed:renewed-by-someone-else");
  });

  test("a second press inside thirty seconds shows the saved result instead of asking again", async () => {
    const account = world.account();
    world.provider(facebookHealthy());
    const first = await check(account.id);
    assert.equal(first.outcome, "healthy");
    const asked = world.fetches.length;
    const logged = world.logRows().length;
    const second = await check(account.id);
    assert.equal(second.outcome, "recently_checked");
    assert.equal(second.status.state, "connected", "it shows what is saved");
    assert.equal(world.fetches.length, asked);
    assert.equal(world.logRows().length, logged);
    // A scheduled or sync-time renewal is not a person pressing twice.
    const auto = await engine.retryConnection({
      accountId: account.id,
      tenantId: A,
      trigger: "auto",
    });
    assert.equal(auto.outcome, "healthy");
  });
});

describe("what the platform answered decides what is saved (T6)", () => {
  const hang = (_url, init) =>
    new Promise((_, reject) => {
      init.signal.addEventListener("abort", () =>
        reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" })),
      );
      // Eight seconds go by in this call; the request must have been cut off by now.
      mock.timers.tick(8000);
    });
  const cases = [
    {
      name: "401: the token is refused, renewal is tried and fails",
      reply: () => json(401, { error: "invalid_token" }),
      outcome: "needs_reconnect",
      state: "revoked",
      active: false,
      renewals: 1,
      http: 401,
    },
    {
      name: "Google's 400 for an invalid token counts as refused",
      reply: () => json(400, { error: "invalid_token", error_description: "Invalid Value" }),
      outcome: "needs_reconnect",
      state: "revoked",
      active: false,
      renewals: 1,
      http: 400,
    },
    {
      name: "403: a permission is missing; the sign-in is kept and not renewed",
      reply: () => json(403, { error: { message: "Forbidden", status: "PERMISSION_DENIED" } }),
      outcome: "forbidden",
      // The database today refuses connected -> refresh_failed, so the state is kept; the refusal
      // withdraws the proof instead (see the matrix further down).
      state: "connected",
      active: true,
      renewals: 0,
      http: 403,
      says: /\(HTTP 403\)\. A permission is probably missing/,
    },
    {
      name: "429: limiting requests; nothing changes",
      reply: () => json(429, { error: { message: "slow down" } }, { "retry-after": "120" }),
      outcome: "rate_limited",
      state: "connected",
      active: true,
      renewals: 0,
      http: 429,
      says: /is limiting requests right now\. Nothing was changed/,
    },
    {
      name: "500",
      reply: () => json(500, { error: { message: "oops" } }),
      outcome: "provider_unavailable",
      state: "provider_unavailable",
      active: true,
      renewals: 0,
      http: 500,
      says: /did not answer \(HTTP 500\)\. Nothing was changed and the account was not marked verified\. Try again after/,
    },
    {
      name: "503",
      reply: () => json(503, "<html>down</html>"),
      outcome: "provider_unavailable",
      state: "provider_unavailable",
      active: true,
      renewals: 0,
      http: 503,
      says: /HTTP 503/,
    },
    {
      name: "no answer at all",
      reply: () => {
        throw new TypeError("fetch failed");
      },
      outcome: "provider_unavailable",
      state: "provider_unavailable",
      active: true,
      renewals: 0,
      http: null,
      says: /did not answer\. Nothing was changed/,
    },
    {
      name: "the request is cut off after eight seconds",
      reply: hang,
      outcome: "provider_unavailable",
      state: "provider_unavailable",
      active: true,
      renewals: 0,
      http: null,
      timers: true,
    },
  ];

  for (const c of cases) {
    test(c.name, async () => {
      const account = channel();
      world.refreshImpl = async () => {
        throw new Error("Token refresh failed for google (HTTP 400): invalid_grant");
      };
      world.provider([tokeninfo(c.reply)]);
      if (c.timers) mock.timers.enable({ apis: ["setTimeout"] });
      let result;
      try {
        result = await check(account.id);
      } finally {
        if (c.timers) mock.timers.reset();
      }
      const row = world.stored(account.id);
      assert.equal(result.outcome, c.outcome);
      assert.equal(row.connection_state, c.state);
      assert.ok(
        accepts(LIVE_EDGES, "connected", row.connection_state) &&
          accepts(BATCH1_EDGES, "connected", row.connection_state),
        "the database would refuse this state",
      );
      assert.equal(row.active, c.active);
      assert.equal(world.refreshCalls.length, c.renewals);
      assert.equal(result.http_status ?? null, c.http);
      assert.equal(row.last_validation_success_at, null, "a failed check must not leave a proof");
      assert.ok(row.last_validation_attempt_at, "but the attempt is recorded");
      assert.notEqual(row.health, "connected");
      assert.ok(row.next_retry_at, "a failed check says when to look again");
      assert.equal(row.retry_count, 1);
      assert.notEqual(result.status.state, "connected");
      if (c.says) assert.match(result.reason, c.says);
      for (const f of world.fetches) assert.ok(f.signal instanceof AbortSignal);
      assert.equal(world.logRows().length, 1);
      assert.equal(world.logRows()[0].outcome, c.outcome);
    });
  }

  test("429 waits as long as the platform asked", async () => {
    const account = channel();
    world.provider([tokeninfo(() => json(429, {}, { "retry-after": "600" }))]);
    await check(account.id);
    const wait = Date.parse(world.stored(account.id).next_retry_at) - Date.now();
    assert.ok(wait > 590_000 && wait < 610_000, "waited " + wait);
  });

  test("a refusal while the account is marked 'platform unavailable' leaves that state and lands on a legal one", async () => {
    const account = channel({ connection_state: "provider_unavailable" });
    installTrigger(world, LIVE_EDGES);
    world.refreshImpl = async () => {
      throw new Error("Token refresh failed for google (HTTP 400): invalid_grant");
    };
    world.provider([tokeninfo(() => json(401, { error: "invalid_token" }))]);
    const result = await check(account.id);
    // provider_unavailable -> revoked is not an edge the database accepts: the whole write would be
    // lost. The platform DID answer, so "not answering" is no longer true: the one neutral step out
    // is taken, and the answer is still reported as a refusal.
    assert.equal(world.stored(account.id).connection_state, "token_expiring");
    assert.equal(result.outcome, "needs_reconnect");
    assert.notEqual(result.status.state, "provider_unavailable");
    assert.notEqual(result.status.state, "connected");
  });

  test("a failure that succeeds on the next press clears the error and the wait", async () => {
    const account = channel({
      connection_state: "provider_unavailable",
      retry_count: 3,
      last_error: "old",
      last_error_at: iso(-HOUR),
      next_retry_at: iso(-1000),
      last_validation_attempt_at: iso(-HOUR),
    });
    world.provider([googleOk()]);
    const result = await check(account.id);
    assert.equal(result.outcome, "healthy");
    const row = world.stored(account.id);
    assert.equal(row.connection_state, "connected");
    assert.equal(row.retry_count, 0);
    assert.equal(row.next_retry_at, null);
    assert.equal(row.last_error, null);
  });
});

describe("a deliberate disconnect is left alone (T7)", () => {
  const unplugged = (over = {}) =>
    world.account({
      active: false,
      access_token: null,
      refresh_token: null,
      connection_state: "disconnected",
      health: "disconnected",
      ...over,
    });

  test("one account and the group retry: no request, no write, no log", async () => {
    const account = unplugged();
    const before = clone(world.db.state.rows);
    world.provider([]);
    const single = await check(account.id);
    assert.equal(single.outcome, "skipped_disconnected");
    assert.match(single.reason, /disconnected on purpose/);
    assert.deepEqual(await checkAll(), []);
    assert.equal(world.fetches.length, 0);
    assert.deepEqual(clone(world.db.state.rows), before, "nothing in the database changed");
  });

  test("even one that still has a token stored is not touched", async () => {
    const account = unplugged({ access_token: "sealed:left-behind" });
    world.provider([]);
    const before = clone(world.stored(account.id));
    assert.equal((await check(account.id)).outcome, "skipped_disconnected");
    assert.deepEqual(clone(world.stored(account.id)), before);
    assert.equal(world.fetches.length, 0);
  });
});

describe("one company cannot touch another's accounts (T8)", () => {
  test("a foreign account id finds nothing, asks nothing, changes nothing", async () => {
    const theirs = world.account({
      tenant_id: B,
      label: "Beta's private page",
      external_id: "7777",
    });
    world.account({ label: "Alpha page" });
    world.provider([]);
    const before = clone(world.stored(theirs.id));
    const result = await check(theirs.id);
    assert.equal(result.outcome, "not_found");
    assert.deepEqual(clone(world.stored(theirs.id)), before);
    assert.equal(world.fetches.length, 0);
  });

  test("the group retry and the report stay inside the company", async () => {
    const theirs = world.account({
      tenant_id: B,
      label: "Beta's private page",
      external_id: "7777",
    });
    const ours = world.account();
    world.provider(facebookHealthy());
    const before = clone(world.stored(theirs.id));
    const results = await checkAll();
    assert.equal(results.length, 1);
    assert.equal(results[0].account_id, ours.id);
    assert.deepEqual(clone(world.stored(theirs.id)), before);
    for (const f of world.fetches) assert.doesNotMatch(f.url, /7777/);
    const text = JSON.stringify(await report());
    assert.ok(!text.includes("Beta's private page") && !text.includes(theirs.id));
  });
});

describe("the result says what happened, not 'everything is fine' (T9)", () => {
  test("a workspace of unverified accounts gets one outcome each, with honest totals", async () => {
    world.account({ label: "Passes", external_id: "p1" });
    world.account({ label: "Refused", external_id: "p2" });
    world.account({
      platform: "threads",
      label: "No check yet",
      external_id: "t1",
      granted_scopes: null,
    });
    world.provider([
      on(`${GRAPH}/p1?fields=id`, () => json(200, { id: "p1" })),
      on(`${GRAPH}/me/permissions`, () =>
        json(200, {
          data: requiredScopesFor("facebook").map((permission) => ({
            permission,
            status: "granted",
          })),
        }),
      ),
      on(`${GRAPH}/p2?fields=id`, () => json(403, { error: { message: "no", code: 200 } })),
    ]);
    const results = await checkAll();
    assert.equal(results.length, 3);
    const by = Object.fromEntries(results.map((r) => [r.outcome, r]));
    assert.ok(by.healthy && by.forbidden && by.not_checkable);
    assert.deepEqual(modelMod.summariseOutcomes(results), {
      checked: 3,
      verified: 1,
      skipped: 1,
      attention: 1,
    });
  });

  test("accounts with no live check are reported as not checked, never as verified", async () => {
    world.account({ platform: "threads", external_id: "t1", granted_scopes: null });
    world.account({ platform: "linkedin_ads", external_id: "l1", granted_scopes: null });
    world.provider([]);
    const results = await checkAll();
    assert.deepEqual(
      results.map((r) => r.outcome),
      ["not_checkable", "not_checkable"],
    );
    assert.match(results[0].reason, /has no live check for Threads yet/);
    assert.deepEqual(modelMod.summariseOutcomes(results), {
      checked: 2,
      verified: 0,
      skipped: 2,
      attention: 0,
    });
  });
});

describe("no secret is ever stored, logged or returned (T10)", () => {
  const SECRETS = [
    SECRET.meta,
    SECRET.metaNew,
    SECRET.googleAccess,
    SECRET.googleRefresh,
    "EAABechoedByThePlatform1234567890abcdefgh",
  ];
  const assertClean = (result, label) => {
    const text = everything(world, result);
    for (const secret of SECRETS) {
      // The stored tokens themselves legitimately sit in their own columns; strip those out.
      const without = text
        .replaceAll(`sealed:${secret}`, "")
        .replaceAll(`"access_token":"sealed:${secret}"`, "");
      assert.ok(!without.includes(secret), label + ": " + secret.slice(0, 8) + " leaked");
    }
    assert.doesNotMatch(
      text.replaceAll(/sealed:[A-Za-z0-9.\/_-]+/g, ""),
      /Bearer [A-Za-z0-9._-]{8,}/,
    );
  };

  test("a platform that echoes the token back in its error", async () => {
    const account = world.account();
    world.provider([
      on(`${GRAPH}/1000?fields=id`, () =>
        json(400, {
          error: {
            message: `Invalid OAuth access token. access_token=${SECRET.meta} Authorization: Bearer ${SECRET.meta} also EAABechoedByThePlatform1234567890abcdefgh`,
            code: 100,
            type: "OAuthException",
          },
        }),
      ),
    ]);
    const restore = world.capture();
    let result;
    try {
      result = await check(account.id);
    } finally {
      restore();
    }
    assert.notEqual(result.outcome, "healthy");
    assertClean(result, "facebook");
    // And the redaction was real work: the platform's words reached the log with the secret removed.
    const logged = world.logRows()[0];
    assert.match(JSON.stringify(logged.details), /\[redacted\]/);
  });

  test("a renewal that fails with the refresh token in its message", async () => {
    const account = channel({ token_expires_at: iso(-HOUR) });
    world.refreshImpl = async (args) => {
      throw new Error(
        `Token refresh failed for google (HTTP 400): invalid_grant refresh_token=${args.refreshToken} client_secret=abcd1234efgh5678`,
      );
    };
    world.provider([googleOk()]);
    const restore = world.capture();
    let result;
    try {
      result = await check(account.id);
    } finally {
      restore();
    }
    assert.equal(result.outcome, "needs_reconnect");
    assertClean(result, "google renewal");
    assert.doesNotMatch(everything(world, result), /client_secret=abcd1234efgh5678/);
  });

  test("the audit trail of a check holds outcomes, not provider text", async () => {
    const account = world.account();
    world.provider([
      on(`${GRAPH}/1000?fields=id`, () =>
        json(400, { error: { message: "Secret detail from the platform", code: 100 } }),
      ),
    ]);
    await check(account.id);
    const audit = world.audits.find((a) => a.action === "connection.retry");
    assert.ok(audit);
    assert.doesNotMatch(JSON.stringify(audit), /Secret detail/);
    assert.equal(audit.details.results[0].outcome, "needs_reconnect");
  });
});

describe("a group is never marked verified at once (T13)", () => {
  test("only the accounts the platform accepted carry a proof", async () => {
    const ids = ["a1", "a2", "a3", "a4", "a5", "a6"];
    const accounts = ids.map((id) => world.account({ label: id, external_id: id }));
    world.provider([
      on(`${GRAPH}/me/permissions`, () =>
        json(200, {
          data: requiredScopesFor("facebook").map((permission) => ({
            permission,
            status: "granted",
          })),
        }),
      ),
      {
        match: (url) => /\/a[1-6]\?fields=id/.test(url),
        reply: (url) => {
          const id = url.match(/\/(a[1-6])\?/)[1];
          return ["a1", "a3", "a5"].includes(id)
            ? json(200, { id })
            : json(403, { error: { message: "no", code: 200 } });
        },
      },
    ]);
    const results = await checkAll();
    assert.equal(results.length, 6);
    const verifiedIds = accounts
      .filter((a) => world.stored(a.id).last_validation_success_at)
      .map((a) => a.external_id)
      .sort();
    assert.deepEqual(verifiedIds, ["a1", "a3", "a5"]);
    for (const id of ["a2", "a4", "a6"]) {
      const row = world.stored(accounts[ids.indexOf(id)].id);
      assert.equal(row.last_validation_success_at, null);
      assert.notEqual(row.health, "connected");
    }
  });

  test("the group is limited to twenty-five accounts a time", async () => {
    for (let i = 0; i < 30; i++) world.account({ label: "p" + i, external_id: "x" + i });
    world.provider([
      {
        match: (url) => /\/x\d+\?fields=id/.test(url),
        reply: (url) => json(200, { id: url.match(/\/(x\d+)\?/)[1] }),
      },
      on(`${GRAPH}/me/permissions`, () =>
        json(200, {
          data: requiredScopesFor("facebook").map((permission) => ({
            permission,
            status: "granted",
          })),
        }),
      ),
    ]);
    assert.equal((await checkAll()).length, 25);
  });
});

describe("a verified account does not claim what a token cannot prove (T15)", () => {
  test("Facebook and Instagram say what depends on Meta's review, and nothing says messaging works", async () => {
    const fb = world.account();
    const ig = world.account({ platform: "instagram", external_id: "2000" });
    world.provider([
      ...facebookHealthy(),
      on(`${GRAPH}/2000?fields=id`, () => json(200, { id: "2000" })),
    ]);
    // Instagram's permissions come from the same /me/permissions answer in this double.
    world.db.table("social_accounts").find((r) => r.id === ig.id).granted_scopes =
      requiredScopesFor("instagram");
    await checkAll();
    const rep = await report();
    const fbRow = rowFor(rep, fb.id);
    assert.equal(fbRow.state, "connected");
    assert.ok(fbRow.not_proven.includes("Read DMs"), "Messenger must be named as not proven");
    const sentences = [
      fbRow.reason,
      fbRow.fix,
      ...rep.rows.map((r) => r.reason + " " + r.fix),
      ...["healthy", "scopes_missing", "scopes_unknown", "evidence_unavailable"].map((o) =>
        modelMod.describeOutcome(o, {
          platform: "Facebook",
          reference: "abcd1234",
          features: ["Read DMs"],
        }),
      ),
    ].join(" ");
    assert.doesNotMatch(
      sentences,
      /(messag\w*|messenger|inbox|dms?)\s+(works|is working|are working|is ready|is enabled)/i,
    );
    assert.doesNotMatch(sentences, /fully (working|connected)|everything (works|is working)/i);
    const igRow = rowFor(rep, ig.id);
    if (igRow.state === "connected") assert.ok(igRow.not_proven.length > 0);
  });
});

describe("a connector with no live check is never called verified (T16, E1)", () => {
  test("Threads: not checkable, nothing sent, nothing written, and not green", async () => {
    const account = world.account({ platform: "threads", external_id: "t1", granted_scopes: null });
    world.provider([]);
    const before = clone(world.db.state.rows);
    const result = await check(account.id);
    assert.equal(result.outcome, "not_checkable");
    assert.equal(world.fetches.length, 0);
    assert.deepEqual(clone(world.db.state.rows), before);
    assert.notEqual(result.status.state, "connected");
    assert.equal(result.status.action, "coming_soon");
  });

  test("the live checks and the list the screens read are the same list", () => {
    assert.deepEqual([...engine.PROBE_PLATFORMS].sort(), [...stateMod.LIVE_CHECK_PLATFORMS].sort());
  });
});

describe("accounts that cannot be checked yet say why, without asking the platform", () => {
  test("a pasted token, a revoked sign-in and an account nobody chose", async () => {
    const pasted = world.account({ connect_method: "manual" });
    const revoked = world.account({
      external_id: "r1",
      connection_state: "revoked",
      active: false,
    });
    const pending = world.account({ external_id: null });
    world.provider([]);
    assert.equal((await check(pasted.id)).outcome, "reconnect_needed");
    assert.equal((await check(revoked.id)).outcome, "needs_reconnect");
    const pendingResult = await check(pending.id);
    assert.equal(pendingResult.outcome, "not_identified");
    assert.match(
      pendingResult.reason,
      /no account was chosen yet\. Choose which account to connect\./,
    );
    assert.equal(world.fetches.length, 0);
    assert.equal(world.logRows().length, 0);
  });

  test("an unreadable stored token ends the check without writing anything", async () => {
    const account = world.account();
    world.provider([]);
    globalThis.healthTest.openFails = true;
    const before = clone(world.stored(account.id));
    const result = await check(account.id);
    assert.equal(result.outcome, "failed");
    assert.deepEqual(clone(world.stored(account.id)), before);
    assert.equal(world.fetches.length, 0);
  });
});

describe("callers that renew a token before syncing keep working", () => {
  test("retryConnection keeps its name, arguments and result fields", async () => {
    const account = channel({ token_expires_at: iso(-HOUR) });
    world.provider([googleOk()]);
    const result = await engine.retryConnection({
      accountId: account.id,
      tenantId: A,
      trigger: "auto",
      actorId: ADMIN_A,
    });
    assert.equal(result.platform, "youtube");
    assert.equal(result.outcome, "refreshed");
    assert.equal(typeof result.reason, "string");
    assert.equal(world.stored(account.id).access_token, `sealed:${SECRET.metaNew}`);
  });

  test("a state change is recorded in the audit trail", async () => {
    const account = world.account({ connection_state: "connected" });
    world.provider([
      on(`${GRAPH}/1000?fields=id`, () => json(503, { error: { message: "down" } })),
    ]);
    await check(account.id);
    const change = world.audits.find((a) => a.action === "connection.state_changed");
    assert.ok(change);
    assert.deepEqual(
      [change.details.from, change.details.to],
      ["connected", "provider_unavailable"],
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Round 2, finding 1 (and 15): only a real, saved check says "verified"
   ══════════════════════════════════════════════════════════════════════════ */

const EVIDENCE_COLUMNS = ["last_validation_success_at", "last_validation_attempt_at"];
/** The one file that may set the two evidence columns. */
const EVIDENCE_MODULE = "src/lib/connection-evidence.server.ts";

/**
 * Every place in a source text that SETS one of the two evidence columns: an object property or an
 * assignment whose value does not come from reading those columns. A line that merely copies a value
 * read from them (`saved.last_validation_success_at`) is not a writer.
 */
function evidenceWriters(fileName, text) {
  const file = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const named = (n) =>
    n && (ts.isIdentifier(n) || ts.isStringLiteralLike(n)) && EVIDENCE_COLUMNS.includes(n.text);
  const mentionsColumn = (node) => {
    let found = false;
    const visit = (n) => {
      if (named(n)) found = true;
      else ts.forEachChild(n, visit);
    };
    visit(node);
    return found;
  };
  const found = [];
  const at = (n) => `${fileName}:${file.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  const walk = (n) => {
    if (
      ts.isPropertyAssignment(n) &&
      ts.isObjectLiteralExpression(n.parent) &&
      named(n.name) &&
      !mentionsColumn(n.initializer)
    ) {
      found.push(at(n));
    } else if (ts.isShorthandPropertyAssignment(n) && named(n.name)) {
      found.push(at(n));
    } else if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const left = n.left;
      const target = ts.isPropertyAccessExpression(left)
        ? left.name
        : ts.isElementAccessExpression(left)
          ? left.argumentExpression
          : null;
      if (named(target) && !mentionsColumn(n.right)) found.push(at(n));
    }
    ts.forEachChild(n, walk);
  };
  walk(file);
  return found;
}

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const lf = (text) => text.split("\r\n").join("\n");

describe("only the evidence module writes a verification (finding 1, 15)", () => {
  test("the scan sees a writer, and tells a writer from a reader", () => {
    const old = "const x = { label: 'a', last_validation_success_at: new Date().toISOString() };";
    assert.equal(evidenceWriters("old.ts", old).length, 1, "the connect-time stamp must be found");
    assert.equal(
      evidenceWriters("assign.ts", "patch['last_validation_attempt_at'] = now;").length,
      1,
    );
    assert.equal(
      evidenceWriters(
        "read.ts",
        "const y = { last_validation_success_at: saved.last_validation_success_at ?? null };",
      ).length,
      0,
      "copying a value that was read is not a write",
    );
    assert.equal(
      evidenceWriters("type.ts", "type T = { last_validation_success_at?: string | null };").length,
      0,
    );
  });

  test("the evidence module is a writer, so the scan is not looking at nothing", () => {
    const text = lf(readFileSync(EVIDENCE_MODULE, "utf8"));
    assert.ok(evidenceWriters(EVIDENCE_MODULE, text).length >= 2);
  });

  test("no other file under src sets either column", () => {
    const offenders = sourceFiles("src")
      .map((path) => path.split("\\").join("/"))
      .filter((path) => path !== EVIDENCE_MODULE && path !== "src/integrations/supabase/types.ts")
      .flatMap((path) => evidenceWriters(path, lf(readFileSync(path, "utf8"))));
    assert.deepEqual(
      offenders,
      [],
      "these lines set a verification time; only a real, saved check may (connection-evidence.server.ts)",
    );
  });
});

const authorizations = await import("../node_modules/.cache/flas-health-authorizations.mjs");

describe("choosing channels does not say a channel was checked (finding 1)", () => {
  const AUTH = "aaaaaaaa-0000-4000-8000-0000000000a1";
  const authorize = () => {
    world.db.table("social_authorizations").push({
      id: AUTH,
      tenant_id: A,
      platform: "youtube",
      provider: "google",
      granted_scopes: requiredScopesFor("youtube"),
      requested_scopes: requiredScopesFor("youtube"),
      authorization_state: "active",
      discovered_at: new Date().toISOString(),
      discovered_assets: [
        {
          externalId: "UC1",
          platform: "youtube",
          accountType: "YouTube channel",
          name: "Channel",
          handle: null,
          avatarUrl: null,
          description: null,
          metrics: { audience: null, content: null, views: null },
          eligible: true,
          ineligibleReason: null,
          linkedTo: null,
        },
      ],
      access_token_enc: null,
      refresh_token_enc: null,
    });
  };
  const choose = async () =>
    await authorizations.connectDiscoveredChannels({
      tenantId: A,
      userId: ADMIN_A,
      authorizationId: AUTH,
      externalIds: ["UC1"],
    });

  test("a new channel has no proof and no attempt, and no screen calls it verified", async () => {
    authorize();
    const { connected } = await choose();
    assert.equal(connected.length, 1);
    const id = connected[0].accountId;
    const row = world.stored(id);
    assert.ok(row, "the channel was connected");
    assert.equal(row.last_validation_success_at ?? null, null, "nobody asked the platform yet");
    assert.equal(row.last_validation_attempt_at ?? null, null);
    const shown = rowFor(await report(), id);
    assert.notEqual(shown.state, "connected");
    assert.doesNotMatch(shown.reason, /Verified/);
  });

  test("a reconnected channel loses the proof its old token had", async () => {
    authorize();
    const old = channel({
      last_validation_success_at: iso(-DAY),
      last_validation_attempt_at: iso(-DAY),
    });
    const { connected } = await choose();
    assert.equal(connected[0].rebound, true);
    assert.equal(connected[0].accountId, old.id);
    const row = world.stored(old.id);
    assert.equal(row.last_validation_success_at, null);
    assert.equal(row.last_validation_attempt_at, null);
  });

  test("a reconnect still works where the evidence columns do not exist", async () => {
    authorize();
    withoutEvidenceColumns(world);
    const old = channel();
    const { connected } = await choose();
    assert.equal(connected[0].rebound, true);
    assert.equal(world.stored(old.id).authorization_id, AUTH, "the rebind was saved");
  });
});

describe("the report reads only its own company's check log (finding 15)", () => {
  test("another company's log lines never reach this company's report", async () => {
    const mine = world.account();
    const theirs = world.account({ tenant_id: B, external_id: "B1" });
    world.db.table("connection_retry_log").push(
      {
        id: "log-mine",
        tenant_id: A,
        account_id: mine.id,
        platform: "facebook",
        outcome: "healthy",
        reason: "Verified. Facebook accepted the token and Flas saved the result.",
        trigger: "manual",
        created_at: iso(-2000),
        details: { stage: "done", correlation_id: "aaaaaaaa-1111-4111-8111-111111111111" },
      },
      {
        id: "log-beta",
        tenant_id: B,
        account_id: theirs.id,
        platform: "facebook",
        outcome: "forbidden",
        reason: "Beta Co secret check line",
        trigger: "manual",
        created_at: iso(-1000),
        details: { stage: "probe", correlation_id: "bbbbbbbb-2222-4222-8222-222222222222" },
      },
    );
    const rep = await report();
    assert.deepEqual(
      rep.retries.map((r) => r.id),
      ["log-mine"],
    );
    assert.doesNotMatch(JSON.stringify(rep), /Beta Co secret|bbbbbbbb/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Round 2, finding 2: a change made while a check runs is never overwritten
   ══════════════════════════════════════════════════════════════════════════ */

describe("a change made while a check runs is not overwritten (finding 2)", () => {
  /** Facebook answers a healthy token, and runs `flip` the first time it is asked (the person acts meanwhile). */
  const duringTheCheck = (flip) => {
    let done = false;
    return [
      on(`${GRAPH}/1000?fields=id`, () => {
        if (!done) {
          done = true;
          flip();
        }
        return json(200, { id: "1000" });
      }),
      on(`${GRAPH}/me/permissions`, () =>
        json(200, {
          data: requiredScopesFor("facebook").map((permission) => ({
            permission,
            status: "granted",
          })),
        }),
      ),
    ];
  };

  // The three steps of a disconnect, as disconnectConnection takes them one after the other. A check
  // can finish between any two of them.
  const steps = {
    "switched off": { active: false, health: "disconnected" },
    "tokens cleared": {
      active: false,
      health: "disconnected",
      access_token: null,
      refresh_token: null,
    },
    disconnected: {
      active: false,
      health: "disconnected",
      access_token: null,
      refresh_token: null,
      connection_state: "disconnected",
    },
  };

  for (const [name, change] of Object.entries(steps)) {
    test(`a disconnect that lands ${name} while the platform is being asked is kept`, async () => {
      const account = world.account({ health: "connected" });
      let snapshot;
      world.provider(
        duringTheCheck(() => {
          Object.assign(world.stored(account.id), change);
          snapshot = clone(world.stored(account.id));
        }),
      );
      const result = await check(account.id);

      assert.equal(result.outcome, "changed_while_checking");
      assert.match(result.reason, /changed while Flas was checking it/);
      assert.equal(result.status, undefined, "no status is claimed from a row that moved");
      assert.deepEqual(
        clone(world.stored(account.id)),
        snapshot,
        "the check wrote nothing over the person's change",
      );
      const row = world.stored(account.id);
      assert.equal(row.active, false);
      assert.equal(row.last_validation_success_at, null, "and verified nothing");
      assert.equal(row.last_validation_attempt_at, null);
      assert.equal(
        world.audits.some((a) => a.action === "connection.state_changed"),
        false,
      );
      assert.equal(world.logRows().length, 1, "the check is still on record");
      assert.equal(world.logRows()[0].outcome, "changed_while_checking");
      assert.match(world.logRows()[0].reason, /changed while Flas was checking it/);
      assert.doesNotMatch(world.logRows()[0].reason, /Verified/);
    });
  }

  test("the same holds for the check that runs before a sync (trigger: auto)", async () => {
    const account = world.account();
    let snapshot;
    world.provider(
      duringTheCheck(() => {
        Object.assign(world.stored(account.id), steps["disconnected"]);
        snapshot = clone(world.stored(account.id));
      }),
    );
    const result = await engine.retryConnection({
      accountId: account.id,
      tenantId: A,
      trigger: "auto",
    });
    assert.equal(result.outcome, "changed_while_checking");
    assert.deepEqual(clone(world.stored(account.id)), snapshot);
  });

  test("an account whose sign-in was revoked meanwhile is not brought back to life", async () => {
    // The database itself would accept revoked -> connected today, so only this guard stops it.
    const account = world.account();
    world.provider(
      duringTheCheck(() => {
        Object.assign(world.stored(account.id), { active: false, connection_state: "revoked" });
      }),
    );
    const result = await check(account.id);
    assert.equal(result.outcome, "changed_while_checking");
    assert.equal(world.stored(account.id).connection_state, "revoked");
    assert.equal(world.stored(account.id).active, false);
  });

  test("a token somebody else stored meanwhile is not overwritten", async () => {
    const account = world.account();
    world.provider(
      duringTheCheck(() => {
        world.stored(account.id).access_token = "sealed:stored-by-a-reconnect";
      }),
    );
    const result = await check(account.id);
    assert.equal(result.outcome, "changed_while_checking");
    assert.equal(world.stored(account.id).access_token, "sealed:stored-by-a-reconnect");
    assert.equal(world.stored(account.id).last_validation_success_at, null);
  });

  test("a failed answer is not written over the change either", async () => {
    const account = world.account();
    let snapshot;
    world.provider([
      on(`${GRAPH}/1000?fields=id`, () => {
        Object.assign(world.stored(account.id), steps["disconnected"]);
        snapshot = clone(world.stored(account.id));
        return json(503, { error: { message: "down" } });
      }),
    ]);
    const result = await check(account.id);
    assert.equal(result.outcome, "changed_while_checking");
    assert.deepEqual(clone(world.stored(account.id)), snapshot);
  });

  test("a renewed token is not stored on an account that was disconnected while it renewed", async () => {
    const account = channel({ token_expires_at: iso(-HOUR) });
    world.provider([googleOk()]);
    world.refreshImpl = async (args) => {
      Object.assign(world.stored(account.id), steps["disconnected"]);
      return {
        token: SECRET.metaNew,
        refreshToken: args.refreshToken,
        expiresAt: iso(HOUR),
        scopes: [],
      };
    };
    const result = await check(account.id);
    assert.equal(world.refreshCalls.length, 1);
    assert.equal(result.outcome, "changed_while_checking");
    const row = world.stored(account.id);
    assert.equal(row.access_token, null, "the new token must not revive a disconnected account");
    assert.equal(row.refresh_token, null);
    assert.equal(row.connection_state, "disconnected");
  });

  test("the group check leaves the changed account alone and still verifies the others", async () => {
    const moved = world.account({ external_id: "1000" });
    const other = world.account({ external_id: "2000" });
    world.provider([
      on(`${GRAPH}/1000?fields=id`, () => {
        Object.assign(world.stored(moved.id), steps["disconnected"]);
        return json(200, { id: "1000" });
      }),
      on(`${GRAPH}/2000?fields=id`, () => json(200, { id: "2000" })),
      on(`${GRAPH}/me/permissions`, () =>
        json(200, {
          data: requiredScopesFor("facebook").map((permission) => ({
            permission,
            status: "granted",
          })),
        }),
      ),
    ]);
    const results = await checkAll();
    const byId = Object.fromEntries(results.map((r) => [r.account_id, r.outcome]));
    assert.equal(byId[moved.id], "changed_while_checking");
    assert.equal(byId[other.id], "healthy");
    assert.equal(world.stored(moved.id).connection_state, "disconnected");
    assert.ok(world.stored(other.id).last_validation_success_at);
  });
});

describe("the new outcome reads calmly and counts as not saved", () => {
  test("it is a sentence in all five languages, and is counted as not checked", () => {
    const said = modelMod.describeOutcome("changed_while_checking", { platform: "Facebook" });
    assert.match(said, /changed while Flas was checking it/);
    assert.doesNotMatch(said, /fail|error|problem/i);
    assert.deepEqual(modelMod.summariseOutcomes([{ outcome: "changed_while_checking" }]), {
      checked: 1,
      verified: 0,
      attention: 0,
      skipped: 1,
    });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Round 2, finding 4: what a check stores and logs follows what finally happened
   ══════════════════════════════════════════════════════════════════════════ */

describe("a result that was not saved is never logged or stored as verified (finding 4)", () => {
  test("a refused write is logged as it was, not as 'Verified'", async () => {
    const account = world.account();
    world.provider(facebookHealthy());
    world.db.fail("social_accounts:update", { code: "XX000", message: "disk full" });
    const result = await check(account.id);

    assert.equal(result.outcome, "save_failed");
    const [log] = world.logRows();
    assert.equal(log.outcome, "save_failed");
    assert.match(
      log.reason,
      /could not save the result, so nothing was marked verified\. Reference/,
    );
    assert.doesNotMatch(log.reason, /Verified/);
    // What the dialog's "Recent checks" and the PDF print comes from here.
    const printed = (await report()).retries.map((r) => r.reason).join(" ");
    assert.doesNotMatch(printed, /Verified\./);
  });

  test("where verification results cannot be stored, neither the row nor the log says verified", async () => {
    withoutEvidenceColumns(world);
    const account = world.account();
    world.provider(facebookHealthy());
    const result = await check(account.id);

    assert.equal(result.outcome, "evidence_unavailable");
    const row = world.stored(account.id);
    for (const text of [row.state_reason, row.status_reason, world.logRows()[0].reason]) {
      assert.doesNotMatch(String(text), /Verified/);
      assert.match(String(text), /cannot store verification results yet/);
    }
    assert.equal(world.logRows()[0].outcome, "evidence_unavailable");
  });

  test("a check that was saved still says so", async () => {
    const account = world.account();
    world.provider(facebookHealthy());
    const result = await check(account.id);
    assert.equal(result.outcome, "healthy");
    assert.equal(world.stored(account.id).state_reason, "Verified by a live check.");
    assert.match(world.logRows()[0].reason, /^Verified\. Facebook accepted the token/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Round 2, finding 3: a check only moves an account along edges the database accepts
   ══════════════════════════════════════════════════════════════════════════ */

describe("every check lands on a state the database accepts (finding 3)", () => {
  // What a pretend Google answers, one reply per kind of answer the engine tells apart.
  const scopes = requiredScopesFor("youtube");
  const replies = {
    "worked, every permission": () => json(200, { scope: scopes.join(" ") }),
    "worked, a permission missing": () => json(200, { scope: scopes.slice(1).join(" ") }),
    401: () => json(401, { error: "invalid_token" }),
    403: () => json(403, { error: { message: "Forbidden" } }),
    429: () => json(429, {}, { "retry-after": "120" }),
    500: () => json(500, { error: { message: "oops" } }),
    "no answer": () => {
      throw new TypeError("fetch failed");
    },
  };
  const REFUSALS = ["401", "403"];

  // Where the account ends up, from where it starts, for each answer. The same in both worlds,
  // because the engine only takes edges BOTH triggers accept. "kept" = the state is left as it is.
  const expected = {
    connected: {
      "worked, every permission": "connected",
      "worked, a permission missing": "scope_incomplete",
      401: "revoked",
      403: "connected",
      429: "connected",
      500: "provider_unavailable",
      "no answer": "provider_unavailable",
    },
    scope_incomplete: {
      "worked, every permission": "connected",
      "worked, a permission missing": "scope_incomplete",
      401: "revoked",
      403: "scope_incomplete",
      429: "scope_incomplete",
      500: "scope_incomplete",
      "no answer": "scope_incomplete",
    },
    token_expiring: {
      "worked, every permission": "connected",
      "worked, a permission missing": "token_expiring",
      401: "revoked",
      403: "refresh_failed",
      429: "token_expiring",
      500: "provider_unavailable",
      "no answer": "provider_unavailable",
    },
    refresh_failed: {
      "worked, every permission": "connected",
      "worked, a permission missing": "connected",
      401: "revoked",
      403: "refresh_failed",
      429: "refresh_failed",
      500: "refresh_failed",
      "no answer": "refresh_failed",
    },
    provider_unavailable: {
      "worked, every permission": "connected",
      "worked, a permission missing": "connected",
      401: "token_expiring",
      403: "token_expiring",
      429: "provider_unavailable",
      500: "provider_unavailable",
      "no answer": "provider_unavailable",
    },
    not_configured: {
      "worked, every permission": "connected",
      "worked, a permission missing": "scope_incomplete",
      401: "not_configured",
      403: "not_configured",
      429: "not_configured",
      500: "not_configured",
      "no answer": "not_configured",
    },
    ready_to_authorize: {
      "worked, every permission": "connected",
      "worked, a permission missing": "scope_incomplete",
      401: "ready_to_authorize",
      403: "ready_to_authorize",
      429: "ready_to_authorize",
      500: "ready_to_authorize",
      "no answer": "ready_to_authorize",
    },
  };
  // States with no way out in the database today: the check keeps them and still saves its answer.
  const FROZEN = [
    "missing_app_credentials",
    "authorization_started",
    "authorization_cancelled",
    "callback_error",
  ];
  // Never asked: the gate stops a deliberate disconnect and a revoked sign-in before any request.
  const GATED = ["disconnected", "revoked"];

  const triggers = [
    ["the database as it is today", LIVE_EDGES],
    ["the database after batch 1", BATCH1_EDGES],
  ];

  for (const [world_, edges] of triggers) {
    for (const from of CONNECTION_STATES.filter((s) => !GATED.includes(s))) {
      for (const [answer, reply] of Object.entries(replies)) {
        test(`${world_}: ${from} + ${answer}`, async () => {
          installTrigger(world, edges);
          const proved = iso(-DAY);
          const account = channel({
            connection_state: from,
            last_validation_success_at: proved,
            last_validation_attempt_at: proved,
          });
          world.refreshImpl = async () => {
            throw new Error("Token refresh failed for google (HTTP 400): invalid_grant");
          };
          world.provider([tokeninfo(reply)]);
          const result = await check(account.id);
          const row = world.stored(account.id);
          const where = `${from} + ${answer}`;

          // 1. The write was accepted, so the answer, the wait and the attempt were not lost.
          assert.notEqual(
            result.outcome,
            "save_failed",
            `${where}: the database refused the write`,
          );
          assert.notEqual(result.outcome, "changed_while_checking");
          assert.notEqual(row.last_validation_attempt_at, proved);
          assert.ok(Date.parse(row.last_validation_attempt_at) > Date.now() - 60_000, where);
          const failed =
            answer !== "worked, every permission" && answer !== "worked, a permission missing";
          assert.equal(row.retry_count, failed ? 1 : 0, `${where}: the retry count was lost`);

          // 2. The state is an edge BOTH triggers accept (read from the migrations, not from the code).
          assert.ok(
            accepts(LIVE_EDGES, from, row.connection_state) &&
              accepts(BATCH1_EDGES, from, row.connection_state),
            `${where}: wrote ${row.connection_state}`,
          );

          // 3. Where it ends up.
          if (expected[from]) {
            assert.equal(row.connection_state, expected[from][answer], where);
          } else {
            assert.equal(row.connection_state, from, `${where}: a state with no way out is kept`);
          }

          // 4. Nothing says something the answer did not.
          const shown = rowFor(await report(), account.id);
          if (REFUSALS.includes(answer)) {
            assert.equal(
              row.last_validation_success_at,
              null,
              `${where}: a refusal withdraws the proof`,
            );
            assert.ok(
              shown.state !== "connected" && shown.state !== "provider_unavailable",
              `${where}: the report reads ${shown.state}`,
            );
            assert.notEqual(row.connection_state, "provider_unavailable", where);
          } else if (answer === "worked, every permission") {
            assert.ok(row.last_validation_success_at > iso(-HOUR), `${where}: no proof was saved`);
            assert.notEqual(row.connection_state, "provider_unavailable", where);
            assert.notEqual(row.connection_state, "refresh_failed", where);
          } else if (answer === "worked, a permission missing") {
            assert.notEqual(row.connection_state, "provider_unavailable", where);
            assert.notEqual(row.connection_state, "refresh_failed", where);
            // (A row that says no app credentials exist, yet holds a token, is not something the app
            // writes; the report reads its state, not its token. Every other state reads by evidence.)
            if (from !== "missing_app_credentials") {
              assert.equal(
                shown.state,
                "needs_verification",
                `${where}: the report reads ${shown.state}`,
              );
            }
          } else {
            // 429, an outage, no answer: the platform said nothing about the token.
            assert.equal(row.last_validation_success_at, proved, `${where}: the proof stands`);
          }
        });
      }
    }
  }

  test("the proof an outage leaves alone is the one it found", async () => {
    // A platform that does not answer says nothing about the token: what was proved stays proved.
    const proved = iso(-DAY);
    const account = channel({
      last_validation_success_at: proved,
      last_validation_attempt_at: proved,
    });
    world.provider([tokeninfo(replies["500"])]);
    await check(account.id);
    assert.equal(world.stored(account.id).last_validation_success_at, proved);
  });

  test("a 403 on a verified, connected account no longer reads as verified", async () => {
    // The database today refuses connected -> refresh_failed. The state stays, and the account
    // reads as not verified because the refusal withdrew its proof.
    installTrigger(world, LIVE_EDGES);
    const account = channel({
      last_validation_success_at: iso(-HOUR),
      last_validation_attempt_at: iso(-HOUR),
    });
    world.provider([tokeninfo(replies["403"])]);
    const result = await check(account.id);
    assert.equal(result.outcome, "forbidden");
    assert.equal(world.stored(account.id).connection_state, "connected");
    assert.equal(result.status.state, "unverified");
    assert.equal(rowFor(await report(), account.id).state, "unverified");
    const screen = (await connections()).accounts.find((a) => a.id === account.id);
    assert.equal(connectionStatus(screen).state, "unverified");
  });

  test("the SQL each world reads is the trigger it claims (the parsing finds what is known)", () => {
    // The database today has no connected -> refresh_failed; batch 1 adds it. And only the older
    // trigger lets a disconnected or revoked account go straight back to connected.
    assert.equal(LIVE_EDGES.has("connected>refresh_failed"), false);
    assert.equal(BATCH1_EDGES.has("connected>refresh_failed"), true);
    assert.equal(LIVE_EDGES.has("disconnected>connected"), true);
    assert.equal(BATCH1_EDGES.has("disconnected>connected"), false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Round 2, finding 5: a token kept somewhere other than access_token is still a token
   ══════════════════════════════════════════════════════════════════════════ */

// Invented key ring for the encrypted columns; nothing here is a real secret.
process.env["SOCIAL_TOKEN_ENCRYPTION_KEYS"] = `k1:${Buffer.alloc(32, 7).toString("base64")}`;
process.env["SOCIAL_TOKEN_ACTIVE_KEY_ID"] = "k1";
const tokenStore = await import("../node_modules/.cache/flas-health-token-store.mjs");

describe("an account that keeps its token elsewhere is checked, not called disconnected (finding 5)", () => {
  const AUTH_ID = "aaaaaaaa-0000-4000-8000-0000000000a2";

  /** A channel whose Google token lives on its authorization, as the channel picker stores it. */
  const onAuthorization = async ({ authorization = {}, account = {} } = {}) => {
    const tokens = await authorizations.encryptAuthorizationTokens({
      tenantId: A,
      authorizationId: AUTH_ID,
      accessToken: SECRET.googleAccess,
      refreshToken: SECRET.googleRefresh,
    });
    world.db.table("social_authorizations").push({
      id: AUTH_ID,
      tenant_id: A,
      provider: "google",
      platform: "youtube",
      authorization_state: "active",
      expires_at: null,
      granted_scopes: requiredScopesFor("youtube"),
      requested_scopes: requiredScopesFor("youtube"),
      ...tokens,
      ...authorization,
    });
    return world.account({
      platform: "youtube",
      external_id: "UC1",
      label: "Channel",
      access_token: null,
      refresh_token: null,
      authorization_id: AUTH_ID,
      access_token_enc: null,
      refresh_token_enc: null,
      token_expires_at: null,
      ...account,
    });
  };

  test("the token on the sign-in is read and used, and the result is saved", async () => {
    const account = await onAuthorization();
    world.provider([googleOk()]);
    const patches = [];
    world.db.fail("social_accounts:update", (q) => {
      patches.push(q.patch);
      return undefined;
    });
    const result = await check(account.id);

    assert.equal(result.outcome, "healthy");
    assert.match(
      String(world.fetches[0].body),
      new RegExp(SECRET.googleAccess.replace(".", "\\.")),
    );
    const row = world.stored(account.id);
    assert.ok(row.last_validation_success_at);
    assert.equal(row.access_token, null, "no plaintext token appears on the account");
    for (const column of [
      "access_token",
      "refresh_token",
      "access_token_enc",
      "refresh_token_enc",
    ]) {
      assert.ok(!(column in patches[0]), `${column} is not the check's to write`);
    }
    assert.doesNotMatch(
      everything(world, result),
      new RegExp(SECRET.googleAccess.replace(".", "\\.")),
    );
  });

  test("a Facebook Page token kept encrypted on the account itself is read and used", async () => {
    const tokens = await tokenStore.encryptTokensForStorage({
      tenantId: A,
      platform: "facebook",
      accessToken: SECRET.meta,
      refreshToken: null,
    });
    const account = world.account({
      access_token: null,
      authorization_id: AUTH_ID,
      ...tokens,
    });
    world.provider(facebookHealthy());
    const result = await check(account.id);
    assert.equal(result.outcome, "healthy");
    assert.equal(world.fetches[0].headers.Authorization, `Bearer ${SECRET.meta}`);
    assert.ok(world.stored(account.id).last_validation_success_at);
  });

  test("the group check includes it", async () => {
    await onAuthorization();
    world.provider([googleOk()]);
    const results = await checkAll();
    assert.equal(results.length, 1);
    assert.equal(results[0].outcome, "healthy");
  });

  test("a deliberate disconnect of such an account is still left alone", async () => {
    const account = await onAuthorization({
      account: { active: false, connection_state: "disconnected", health: "disconnected" },
    });
    world.provider([]);
    const before = clone(world.stored(account.id));
    assert.equal((await check(account.id)).outcome, "skipped_disconnected");
    assert.deepEqual(clone(world.stored(account.id)), before);
    assert.equal(world.fetches.length, 0);
    assert.deepEqual(await checkAll(), []);
  });

  test("a sign-in that was disconnected on purpose reads as that", async () => {
    const account = await onAuthorization({
      authorization: { authorization_state: "disconnected" },
    });
    world.provider([]);
    const result = await check(account.id);
    assert.equal(result.outcome, "skipped_disconnected");
    assert.equal(world.fetches.length, 0);
  });

  test("an expired token on the sign-in is renewed through the sign-in, not on the account", async () => {
    const account = await onAuthorization();
    world.db.onRpc("acquire_authorization_refresh_lease", async () => ({
      data: "lease-1",
      error: null,
    }));
    world.db.onRpc("release_authorization_refresh_lease", async () => ({
      data: true,
      error: null,
    }));
    let asked = 0;
    world.provider([
      tokeninfo(() =>
        asked++ === 0
          ? json(401, { error: "invalid_token" })
          : json(200, { scope: requiredScopesFor("youtube").join(" ") }),
      ),
    ]);
    const before = world.db.table("social_authorizations")[0].access_token_enc;
    const result = await check(account.id);

    assert.equal(result.outcome, "refreshed");
    assert.equal(world.refreshCalls.length, 1);
    assert.notEqual(
      world.db.table("social_authorizations")[0].access_token_enc,
      before,
      "the new token is kept",
    );
    assert.match(String(world.fetches[1].body), new RegExp(SECRET.metaNew));
    const row = world.stored(account.id);
    assert.equal(row.access_token, null, "nothing is written to the account's own token columns");
    assert.equal(row.refresh_token, null);
    assert.ok(row.last_validation_success_at);
  });

  test("a read that fails is not a disconnect", async () => {
    const account = await onAuthorization();
    world.provider([]);
    world.db.fail("social_accounts:read", (q) =>
      String(q.columns ?? "").includes("authorization_id")
        ? { code: "57014", message: "canceling statement due to statement timeout" }
        : undefined,
    );
    const before = clone(world.stored(account.id));
    const result = await check(account.id);
    assert.equal(result.outcome, "failed");
    assert.doesNotMatch(result.reason, /on purpose/);
    assert.deepEqual(clone(world.stored(account.id)), before);
    assert.equal(world.fetches.length, 0);
  });

  test("a stored token that cannot be decrypted ends the check without writing", async () => {
    const account = await onAuthorization({
      authorization: { access_token_enc: "v1:k1:AAAA:AAAA:AAAA" },
    });
    world.provider([]);
    const before = clone(world.stored(account.id));
    const result = await check(account.id);
    assert.equal(result.outcome, "failed");
    assert.equal(result.stage, "credentials");
    assert.deepEqual(clone(world.stored(account.id)), before);
    assert.equal(world.fetches.length, 0);
  });

  test("where those columns do not exist (the database today) an empty token is still 'no sign-in'", async () => {
    const account = world.account({ access_token: null });
    world.provider([]);
    world.db.fail("social_accounts:read", (q) =>
      String(q.columns ?? "").includes("authorization_id")
        ? { code: "42703", message: "column social_accounts.authorization_id does not exist" }
        : undefined,
    );
    const result = await check(account.id);
    assert.equal(result.outcome, "skipped_disconnected");
    assert.equal(world.fetches.length, 0);
  });
});
