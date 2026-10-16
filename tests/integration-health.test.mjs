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
