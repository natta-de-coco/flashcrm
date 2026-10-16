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
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  A,
  ADMIN_A,
  B,
  DAY,
  EVIDENCE,
  HOUR,
  SECRET,
  createWorld,
  everything,
  facebookHealthy,
  iso,
  json,
  on,
  requiredScopesFor,
  withoutEvidenceColumns,
} from "./support/health-world.mjs";
import { connectionStatus } from "../node_modules/.cache/flas-connection-status.mjs";

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
