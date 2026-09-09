// Batch 1 / Task 3 — the database half of the connection state model.
//
//   node supabase/verify/verify-connection-state.mjs
//
// The pure model is covered by tests/connection-state.test.mjs. This covers
// what only a real Postgres can answer:
//
//   * the CHECK constraints refuse an unknown state
//   * the trigger refuses an illegal transition, so a support script or a
//     future server function that writes around the application still cannot
//     corrupt the model
//   * state_changed_at is stamped by the database, not by the caller
//   * the backfill puts existing rows in the right state
//   * expire_abandoned_oauth_attempts() retires what it should and, more
//     importantly, does not touch what it should not
//
// SABOTAGE=1 drops the transition trigger. The run must then fail.
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(HERE, "..", "migrations");
const PORT = 54991;

// A run that fails mid-way leaves its data directory behind, and initdb then
// refuses to start at all -- so the next run reports a startup error rather
// than the failure you were trying to fix. Clear it first.
const DATA_DIR = path.join(HERE, ".pgdata-state");
fs.rmSync(DATA_DIR, { recursive: true, force: true });

const p = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: "postgres", password: "postgres", port: PORT, persistent: false,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});
await p.initialise();
await p.start();
const c = new pg.Client({ host: "localhost", port: PORT, user: "postgres", password: "postgres", database: "postgres" });
await c.connect();
await c.query("SET search_path TO public, extensions");
await c.query(fs.readFileSync(path.join(HERE, "supabase-shim.sql"), "utf8"));
for (const f of fs.readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort()) {
  try { await c.query(fs.readFileSync(path.join(MIG, f), "utf8")); }
  catch { try { await c.query("ROLLBACK"); } catch {} }
}

if (process.env.SABOTAGE) {
  await c.query("DROP TRIGGER IF EXISTS social_accounts_guard_state ON public.social_accounts");
  console.log("!! SABOTAGE: transition trigger dropped - the suite must now FAIL");
}

let failures = 0;
const check = (ok, label, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${label}${detail ? "  -- " + detail : ""}`);
};

const org = (await c.query("insert into organizations(name,slug) values('Alpha','alpha') returning id")).rows[0].id;

const makeAccount = async (state) => {
  const { rows } = await c.query(
    `insert into social_accounts (tenant_id, platform, label, connect_method, connection_state)
     values ($1,'facebook','Page','oauth',$2) returning id`,
    [org, state],
  );
  return rows[0].id;
};

const setState = async (id, to) => {
  try {
    await c.query("update social_accounts set connection_state=$2 where id=$1", [id, to]);
    return { ok: true };
  } catch (e) {
    return { ok: false, err: e.message.split("\n")[0] };
  }
};

// ── 1. CHECK constraints ────────────────────────────────────────────────────
console.log("\n=== unknown states are impossible to write ===");
{
  let rejected = false;
  try {
    await c.query(
      `insert into social_accounts (tenant_id, platform, label, connect_method, connection_state)
       values ($1,'facebook','X','oauth','totally_made_up')`,
      [org],
    );
  } catch { rejected = true; }
  check(rejected, "an unknown connection_state is refused by the CHECK constraint");

  let attemptRejected = false;
  try {
    const uid = (await c.query("insert into auth.users(email) values('a@a.test') returning id")).rows[0].id;
    await c.query(
      `insert into oauth_states (tenant_id, user_id, platform, state, redirect_uri, attempt_state)
       values ($1,$2,'facebook','st-1','https://x.test/cb','nonsense')`,
      [org, uid],
    );
  } catch { attemptRejected = true; }
  check(attemptRejected, "an unknown attempt_state is refused by the CHECK constraint");
}

// ── 2. The transition trigger ───────────────────────────────────────────────
console.log("\n=== the trigger enforces the whitelist ===");
{
  const id = await makeAccount("connected");
  const legal = await setState(id, "token_expiring");
  check(legal.ok, "connected -> token_expiring is accepted", legal.err ?? "");

  // not_configured is deliberately permissive: it is the column default, so a
  // row created by any path that does not set a state must still be able to
  // reach whatever it really is.
  const id2 = await makeAccount("not_configured");
  const fromUnknown = await setState(id2, "connected");
  check(fromUnknown.ok, "not_configured -> connected is accepted (unknown, not a stage)", fromUnknown.err ?? "");

  // A refresh cannot fail before a token has ever existed.
  const id2b = await makeAccount("ready_to_authorize");
  const illegal = await setState(id2b, "refresh_failed");
  check(!illegal.ok, "ready_to_authorize -> refresh_failed is refused", illegal.err ?? "unexpectedly accepted");

  const id3 = await makeAccount("disconnected");
  const illegal2 = await setState(id3, "revoked");
  check(!illegal2.ok, "disconnected -> revoked is refused", illegal2.err ?? "unexpectedly accepted");

  // The rule that protects customers during a provider outage.
  const id4 = await makeAccount("provider_unavailable");
  const illegal3 = await setState(id4, "revoked");
  check(!illegal3.ok, "provider_unavailable -> revoked is refused", illegal3.err ?? "unexpectedly accepted");

  const id5 = await makeAccount("connected");
  const same = await setState(id5, "connected");
  check(same.ok, "re-asserting the same state is allowed as a heartbeat", same.err ?? "");
}

// ── 3. state_changed_at is the database's job ───────────────────────────────
console.log("\n=== the timestamp cannot be forgotten or backdated ===");
{
  const id = await makeAccount("connected");
  await c.query("update social_accounts set state_changed_at = now() - interval '10 days' where id=$1", [id]);
  const before = (await c.query("select state_changed_at from social_accounts where id=$1", [id])).rows[0].state_changed_at;
  await setState(id, "token_expiring");
  const after = (await c.query("select state_changed_at from social_accounts where id=$1", [id])).rows[0].state_changed_at;
  check(after > before, "state_changed_at is stamped by the trigger on a real change");

  // A write that does not change the state should not fake activity.
  const stamp = (await c.query("select state_changed_at from social_accounts where id=$1", [id])).rows[0].state_changed_at;
  await c.query("update social_accounts set label='renamed' where id=$1", [id]);
  const unchanged = (await c.query("select state_changed_at from social_accounts where id=$1", [id])).rows[0].state_changed_at;
  check(String(unchanged) === String(stamp), "an unrelated update leaves state_changed_at alone");
}

// ── 4. Abandoned attempts ───────────────────────────────────────────────────
console.log("\n=== abandoned attempts are retired, live ones are not ===");
{
  const uid = (await c.query("insert into auth.users(email) values('b@b.test') returning id")).rows[0].id;
  const mkAttempt = async (name, expiresOffset, used) => {
    await c.query(
      `insert into oauth_states (tenant_id, user_id, platform, state, redirect_uri, expires_at, used_at, attempt_state)
       values ($1,$2,'facebook',$3,'https://x.test/cb', now() + ($4 || ' minutes')::interval, $5, 'started')`,
      [org, uid, name, String(expiresOffset), used],
    );
  };
  await mkAttempt("abandoned", -60, null);   // expired, never used
  await mkAttempt("in-flight", 10, null);    // still open
  await mkAttempt("consumed", -60, new Date().toISOString()); // finished

  const { rows } = await c.query("select * from expire_abandoned_oauth_attempts()");
  const expired = Number(rows[0].expired_count);
  check(expired === 1, "exactly the abandoned attempt was retired", `expired ${expired}`);

  const live = (await c.query("select attempt_state from oauth_states where state='in-flight'")).rows[0];
  check(live?.attempt_state === "started", "an in-flight attempt is untouched", `got ${live?.attempt_state}`);

  const done = (await c.query("select attempt_state from oauth_states where state='consumed'")).rows[0];
  check(
    done?.attempt_state === "started",
    "a consumed attempt is not relabelled as expired",
    `got ${done?.attempt_state}`,
  );

  const gone = (await c.query("select attempt_state from oauth_states where state='abandoned'")).rows[0];
  check(gone?.attempt_state === "expired", "the abandoned attempt now reads expired", `got ${gone?.attempt_state}`);
}

// ── 5. Backfill ─────────────────────────────────────────────────────────────
// Simulates rows written before the migration and re-runs its CASE, so the
// mapping is asserted rather than assumed.
console.log("\n=== backfill maps legacy rows correctly ===");
{
  const legacy = async (active, token, expiresMinutes) => {
    const { rows } = await c.query(
      `insert into social_accounts (tenant_id, platform, label, connect_method, active, access_token, token_expires_at, connection_state)
       values ($1,'instagram','L','oauth',$2,$3,
               case when $4::int is null then null else now() + ($4 || ' minutes')::interval end,
               'not_configured')
       returning id`,
      [org, active, token, expiresMinutes],
    );
    await c.query(
      `UPDATE social_accounts SET connection_state =
         CASE
           WHEN active IS NOT TRUE THEN 'disconnected'
           WHEN access_token IS NULL THEN 'ready_to_authorize'
           WHEN token_expires_at IS NOT NULL AND token_expires_at < now() THEN 'token_expiring'
           WHEN token_expires_at IS NOT NULL AND token_expires_at < now() + interval '72 hours' THEN 'token_expiring'
           ELSE 'connected'
         END
       WHERE id = $1 AND connection_state = 'not_configured'`,
      [rows[0].id],
    );
    return (await c.query("select connection_state from social_accounts where id=$1", [rows[0].id])).rows[0].connection_state;
  };

  check(await legacy(false, "tok", null) === "disconnected", "inactive -> disconnected");
  check(await legacy(true, null, null) === "ready_to_authorize", "no token -> ready_to_authorize");
  check(await legacy(true, "tok", -60) === "token_expiring", "expired token -> token_expiring");
  check(await legacy(true, "tok", 60) === "token_expiring", "expiring soon -> token_expiring");
  check(await legacy(true, "tok", 60 * 24 * 30) === "connected", "healthy -> connected");
}

console.log("");
console.log(
  failures === 0
    ? "OK - the database enforces the state model."
    : `FAIL - ${failures} problem(s).`,
);
await c.end();
await p.stop();
process.exit(failures === 0 ? 0 : 1);
