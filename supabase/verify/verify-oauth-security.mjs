// Batch 1 / Task 4 — the OAuth security controls only a real database can prove.
//
//   node supabase/verify/verify-oauth-security.mjs
//
// Covers single-use consumption, replay, expiry, tampering, the fact that the
// plaintext state is no longer stored, tenant/user/provider binding, and the
// refresh lock.
//
// SABOTAGE=1 removes the single-use guard from consumption. The run must fail.
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(HERE, "..", "migrations");
const PORT = 54992;

const DATA_DIR = path.join(HERE, ".pgdata-oauthsec");
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
  // Drops the single-use guard, leaving consumption replayable.
  await c.query(`
    CREATE OR REPLACE FUNCTION public.consume_oauth_state_hash(_state_hash text)
    RETURNS TABLE (id text, tenant_id uuid, user_id uuid, platform text, redirect_uri text, code_verifier text)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
    BEGIN
      RETURN QUERY
      UPDATE public.oauth_states s SET used_at = now()
       WHERE s.state_hash = _state_hash
      RETURNING s.state_hash, s.tenant_id, s.user_id, s.platform, s.redirect_uri, s.code_verifier;
    END; $$;`);
  console.log("!! SABOTAGE: single-use guard removed - the suite must now FAIL");
}

let failures = 0;
const check = (ok, label, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${label}${detail ? "  -- " + detail : ""}`);
};

const sha = (v) => crypto.createHash("sha256").update(v).digest("hex");

const org = (await c.query("insert into organizations(name,slug) values('Alpha','alpha') returning id")).rows[0].id;
const orgB = (await c.query("insert into organizations(name,slug) values('Beta','beta') returning id")).rows[0].id;
const uid = (await c.query("insert into auth.users(email) values('a@a.test') returning id")).rows[0].id;

/** Writes a state row the way startAuthorization now does: hash only. */
const startAttempt = async (stateValue, { platform = "facebook", minutes = 15, tenant = org } = {}) => {
  await c.query(
    `insert into oauth_states (tenant_id, user_id, platform, state_hash, redirect_uri, expires_at)
     values ($1,$2,$3,$4,'https://flas.test/api/public/oauth-callback',
             now() + ($5 || ' minutes')::interval)`,
    [tenant, uid, platform, sha(stateValue), String(minutes)],
  );
};

const consume = async (stateValue) => {
  const { rows } = await c.query("select * from consume_oauth_state_hash($1)", [sha(stateValue)]);
  return rows;
};

// ── 1. The plaintext state is not stored ────────────────────────────────────
console.log("\n=== the state value is never written to the database ===");
{
  const secret = "state-value-never-stored-0123456789";
  await startAttempt(secret);
  const { rows } = await c.query("select state, state_hash from oauth_states where state_hash=$1", [sha(secret)]);
  check(rows[0]?.state === null, "the plaintext state column is NULL on new rows", `got ${rows[0]?.state}`);
  check(rows[0]?.state_hash === sha(secret), "the digest is stored instead");

  const { rows: anywhere } = await c.query(
    "select count(*)::int as n from oauth_states where state = $1", [secret],
  );
  check(anywhere[0].n === 0, "the value appears nowhere in the table");
}

// ── 2. Single use and replay ────────────────────────────────────────────────
console.log("\n=== a state can be used exactly once ===");
{
  const s = "single-use-state-abcdefghijklmnop";
  await startAttempt(s);
  const first = await consume(s);
  check(first.length === 1, "the first callback consumes it");

  const replay = await consume(s);
  check(replay.length === 0, "a replay of the same state returns nothing", `got ${replay.length} row(s)`);

  const third = await consume(s);
  check(third.length === 0, "and stays refused on further attempts");
}

// ── 3. Expiry and tampering ─────────────────────────────────────────────────
console.log("\n=== expired and tampered states are refused ===");
{
  const s = "expired-state-abcdefghijklmnopqrs";
  await startAttempt(s, { minutes: -1 });
  check((await consume(s)).length === 0, "an expired state is refused");

  const good = "tamper-base-abcdefghijklmnopqrstu";
  await startAttempt(good);
  const tampered = await c.query("select * from consume_oauth_state_hash($1)", [sha(good + "x")]);
  check(tampered.rows.length === 0, "a modified state does not match any row");
  check((await consume(good)).length === 1, "and the real state still works afterwards");
}

// ── 4. Binding ──────────────────────────────────────────────────────────────
console.log("\n=== the row binds tenant, user and provider ===");
{
  const s = "binding-state-abcdefghijklmnopqrs";
  await startAttempt(s, { platform: "instagram", tenant: orgB });
  const [row] = await consume(s);
  check(row?.tenant_id === orgB, "the workspace comes from the state row, not the request");
  check(row?.user_id === uid, "the user who started the flow is recorded");
  check(row?.platform === "instagram", "the platform is bound, so a code cannot be redeemed for another");
}

// ── 5. Attempt state is advanced on consumption ─────────────────────────────
console.log("\n=== consumption records that the callback arrived ===");
{
  const s = "attempt-state-abcdefghijklmnopqr";
  await startAttempt(s);
  await consume(s);
  const { rows } = await c.query("select attempt_state, used_at from oauth_states where state_hash=$1", [sha(s)]);
  check(rows[0]?.attempt_state === "callback_received", "attempt_state advances", `got ${rows[0]?.attempt_state}`);
  check(rows[0]?.used_at !== null, "used_at is stamped");
}

// ── 6. Refresh lease ────────────────────────────────────────────────────────
// This section used to test try_lock_connection_refresh(), a transaction-
// scoped advisory lock -- inside an explicit BEGIN, which the application
// never issues. Called through PostgREST each RPC is its own transaction, so
// the lock was released before the refresh it guarded. 20260910100000 replaced
// it with a row lease; supabase/verify/verify-social-batch1.mjs covers the
// lease in depth, and this keeps the OAuth suite's own guarantee honest.
console.log("\n=== only one refresh per account runs at a time ===");
{
  const account = (await c.query(
    `insert into social_accounts (tenant_id, platform, label, connect_method)
     values ($1,'facebook','Page','oauth') returning id`, [org],
  )).rows[0].id;

  const other = new pg.Client({ host: "localhost", port: PORT, user: "postgres", password: "postgres", database: "postgres" });
  await other.connect();
  const acquire = async (cl, id) =>
    (await cl.query("select acquire_connection_refresh_lease($1,$2,60) as id", [id, org])).rows[0].id;

  // No surrounding transaction: this is how the application calls it.
  const mine = await acquire(c, account);
  check(Boolean(mine), "the first caller takes the lease");

  const theirs = await acquire(other, account);
  check(theirs === null, "a concurrent caller is refused rather than queued", `got ${theirs}`);

  const account2 = (await c.query(
    `insert into social_accounts (tenant_id, platform, label, connect_method)
     values ($1,'instagram','IG','oauth') returning id`, [org],
  )).rows[0].id;
  check(Boolean(await acquire(other, account2)), "a different account is unaffected");

  // The property the old lock lacked: it is still held after the call returns.
  check((await acquire(other, account)) === null, "the lease is still held after the acquiring call has returned");

  const released = (await c.query(
    "select release_connection_refresh_lease($1,$2,$3) as ok", [account, org, mine],
  )).rows[0].ok;
  check(released === true, "the holder releases it");
  check(Boolean(await acquire(other, account)), "and another caller can then take it");
  await other.end();
}

console.log("");
console.log(
  failures === 0
    ? "OK - state cannot be replayed, tampered with, or read from the database."
    : `FAIL - ${failures} problem(s).`,
);
await c.end();
await p.stop();
process.exit(failures === 0 ? 0 : 1);
