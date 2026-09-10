// Social Integration Release Gate — Batch 1, the database half.
//
//   node supabase/verify/verify-social-batch1.mjs
//
// Proves 20260910100000 against a real Postgres:
//   A  it applies cleanly, and a second run is harmless
//   B  clients cannot write tokens or touch oauth_states (declared AND enforced)
//   C  the SQL transition whitelist is identical to the TypeScript one
//   D  returning to connected needs a fresh authorization
//   E  the refresh lease is exclusive, holder-released and self-expiring, and
//      two concurrent refreshes reach the provider exactly once
//   F  no child row can point at another workspace's account
//   G  the sweep times out stuck authorizations
//   H  duplicate connections are refused within a tenant, allowed across
//   I  legacy pasted-token rows are marked, not deleted
//
// SABOTAGE=1 removes the tenant-match trigger on social_posts and makes the
// lease always grant. The run MUST fail.
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");
const MIG = path.join(HERE, "..", "migrations");
const BATCH1 = "20260910100000_social_batch1_foundation.sql";
const PORT = 54994;

// The TypeScript side of the whitelist comparison.
spawnSync(process.execPath, [path.join(ROOT, "scripts", "build-state-bundle.mjs")], {
  cwd: ROOT,
  stdio: "inherit",
});
const model = await import(
  new URL("../../node_modules/.cache/flas-connection-state.mjs", import.meta.url).href
);

const DATA_DIR = path.join(HERE, ".pgdata-batch1");
fs.rmSync(DATA_DIR, { recursive: true, force: true });
const p = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: "postgres", password: "postgres", port: PORT, persistent: false,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});
await p.initialise();
await p.start();
const connect = async () => {
  const cl = new pg.Client({ host: "localhost", port: PORT, user: "postgres", password: "postgres", database: "postgres" });
  await cl.connect();
  await cl.query("SET search_path TO public, extensions");
  return cl;
};
const c = await connect();
await c.query(fs.readFileSync(path.join(HERE, "supabase-shim.sql"), "utf8"));

let failures = 0;
const check = (ok, label, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${label}${detail ? "  -- " + detail : ""}`);
};

// ── A. apply ────────────────────────────────────────────────────────────────
console.log("\n=== A. the Batch 1 migration applies cleanly ===");
let batch1Error = null;
for (const f of fs.readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort()) {
  try {
    await c.query(fs.readFileSync(path.join(MIG, f), "utf8"));
  } catch (e) {
    try { await c.query("ROLLBACK"); } catch {}
    if (f === BATCH1) batch1Error = e.message.split("\n")[0];
  }
}
check(batch1Error === null, `${BATCH1} applied on a fresh database`, batch1Error ?? "");

const exists = async (sql, params = []) => (await c.query(sql, params)).rowCount > 0;
check(await exists(`select 1 from information_schema.columns where table_name='social_accounts' and column_name='access_token_enc'`), "encrypted token columns exist");
check(await exists(`select 1 from pg_proc where proname='acquire_connection_refresh_lease'`), "the refresh lease RPC exists");
check(!(await exists(`select 1 from pg_proc where proname='try_lock_connection_refresh'`)), "the lock that never held is gone");
check(await exists(`select 1 from pg_trigger where tgname='social_posts_tenant_match'`), "the tenant-match trigger is installed");
check(await exists(`select 1 from pg_indexes where indexname='social_accounts_tenant_platform_external_key'`), "the duplicate-connection index exists");

// ── fixtures ────────────────────────────────────────────────────────────────
const mkOrg = async (slug) => (await c.query("insert into organizations(name,slug) values($1,$1) returning id", [slug])).rows[0].id;
const orgA = await mkOrg("alpha");
const orgB = await mkOrg("beta");
const mkUser = async (email, org) => {
  const id = (await c.query("insert into auth.users(email) values($1) returning id", [email])).rows[0].id;
  await c.query("update profiles set tenant_id=$2, staff_role='company_admin' where id=$1", [id, org]);
  await c.query("insert into user_roles(user_id,role) values($1,'admin') on conflict do nothing", [id]);
  return id;
};
const adminA = await mkUser("a@alpha.test", orgA);
const adminB = await mkUser("b@beta.test", orgB);
const mkAccount = async (org, platform, externalId, extra = "") =>
  (await c.query(
    `insert into social_accounts (tenant_id, platform, label, connect_method, external_id ${extra ? ", " + extra.split("=")[0] : ""})
     values ($1, $2, 'acct', 'oauth', $3 ${extra ? ", " + extra.split("=")[1] : ""}) returning id`,
    [org, platform, externalId],
  )).rows[0].id;
const accA = await mkAccount(orgA, "facebook", "page-a");
const accB = await mkAccount(orgB, "facebook", "page-b");

if (process.env.SABOTAGE) {
  await c.query("DROP TRIGGER IF EXISTS social_posts_tenant_match ON public.social_posts");
  await c.query(`CREATE OR REPLACE FUNCTION public.acquire_connection_refresh_lease(_account_id uuid, _tenant_id uuid, _lease_seconds integer DEFAULT 60)
                 RETURNS uuid LANGUAGE sql AS $$ SELECT gen_random_uuid() $$`);
  console.log("!! SABOTAGE: tenant trigger dropped and lease always grants - the suite must now FAIL");
}

async function asUser(uid, fn) {
  await c.query("begin");
  try {
    await c.query("select set_config('request.jwt.claim.sub',$1,true)", [uid]);
    await c.query("set local role authenticated");
    return { value: await fn() };
  } catch (e) {
    return { threw: e.message.split("\n")[0] };
  } finally {
    try { await c.query("rollback"); } catch {}
    await c.query("reset role");
  }
}

// ── B. grants ───────────────────────────────────────────────────────────────
console.log("\n=== B. clients cannot write tokens or read oauth_states ===");
const priv = async (col, kind) =>
  (await c.query(`select has_column_privilege('authenticated','public.social_accounts',$1,$2) as p`, [col, kind])).rows[0].p;
check(!(await priv("access_token", "UPDATE")), "declared: no UPDATE on access_token");
check(!(await priv("access_token", "INSERT")), "declared: no INSERT on access_token");
for (const col of ["access_token_enc", "refresh_token_enc", "token_key_id", "refresh_lease_id"]) {
  check(!(await priv(col, "SELECT")), `declared: no SELECT on ${col}`);
}
check(await priv("last_validation_success_at", "SELECT"), "declared: SELECT on last_validation_success_at (observability)");
const tablePriv = async (t, kind) => (await c.query(`select has_table_privilege('authenticated',$1,$2) as p`, [`public.${t}`, kind])).rows[0].p;
check(!(await tablePriv("oauth_states", "SELECT")), "declared: no SELECT on oauth_states");

// Declared privileges can be wrong in ways a real write exposes, so try them.
const upd = await asUser(adminA, () => c.query("update social_accounts set access_token='stolen' where id=$1", [accA]));
check(Boolean(upd.threw), "enforced: a member cannot write a token into their own account", upd.threw ?? "write accepted");
const ins = await asUser(adminA, () => c.query(
  "insert into social_accounts (tenant_id, platform, label, access_token) values ($1,'instagram','x','pasted')", [orgA]));
check(Boolean(ins.threw), "enforced: a member cannot insert an account with a pasted token", ins.threw ?? "insert accepted");
const del = await asUser(adminA, () => c.query("delete from social_accounts where id=$1", [accA]));
check(Boolean(del.threw), "enforced: a member cannot hard-delete an account (disconnect is server-side)", del.threw ?? "delete accepted");
const enc = await asUser(adminA, () => c.query("select access_token_enc from social_accounts where id=$1", [accA]));
check(Boolean(enc.threw), "enforced: a member cannot read the encrypted token column", enc.threw ?? "read allowed");
const oauth = await asUser(adminA, () => c.query("select * from oauth_states"));
check(Boolean(oauth.threw), "enforced: a member cannot read oauth_states (code_verifier lives there)", oauth.threw ?? "read allowed");
const obs = await asUser(adminA, () => c.query("select connection_state, last_validation_success_at from social_accounts where id=$1", [accA]));
check(!obs.threw && obs.value.rowCount === 1, "enforced: a member can read their own account's status", obs.threw ?? "");

// ── C. whitelist parity ─────────────────────────────────────────────────────
console.log("\n=== C. the SQL whitelist equals the TypeScript whitelist ===");
{
  const ts = new Set(model.allTransitions().map(([f, t]) => `${f}>${t}`));
  let mismatches = [];
  for (const f of model.CONNECTION_STATES) {
    for (const t of model.CONNECTION_STATES) {
      if (f === t) continue;
      const sql = (await c.query("select public.is_legal_connection_transition($1,$2) as ok", [f, t])).rows[0].ok;
      if (sql !== ts.has(`${f}>${t}`)) mismatches.push(`${f}->${t} sql=${sql} ts=${ts.has(`${f}>${t}`)}`);
    }
  }
  check(mismatches.length === 0, `all ${model.CONNECTION_STATES.length ** 2 - model.CONNECTION_STATES.length} ordered pairs agree`, mismatches.slice(0, 4).join("; "));
  const states = (await c.query(`select pg_get_constraintdef(oid) d from pg_constraint where conname='social_accounts_connection_state_check'`)).rows[0].d;
  const sqlStates = [...states.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  check(JSON.stringify(sqlStates) === JSON.stringify([...model.CONNECTION_STATES].sort()), "the CHECK constraint lists exactly the 13 states");
}

// ── D. trigger ──────────────────────────────────────────────────────────────
console.log("\n=== D. the trigger enforces the model ===");
{
  const setState = async (id, s) => {
    try { await c.query("update social_accounts set connection_state=$2 where id=$1", [id, s]); return null; }
    catch (e) { return e.message.split("\n")[0]; }
  };
  const acc = await mkAccount(orgA, "instagram", "ig-a");
  await c.query("update social_accounts set connection_state='connected' where id=$1", [acc]);
  check((await setState(acc, "refresh_failed")) === null, "connected -> refresh_failed is accepted (the lost-update fix)");
  check((await setState(acc, "disconnected")) === null, "refresh_failed -> disconnected is accepted");
  const back = await setState(acc, "connected");
  check(back !== null, "disconnected -> connected is refused without a new authorization", back ?? "accepted");
  check((await setState(acc, "ready_to_authorize")) === null, "disconnected -> ready_to_authorize is accepted");
  check((await setState(acc, "authorization_started")) === null, "-> authorization_started is accepted");
  check((await setState(acc, "connected")) === null, "authorization_started -> connected is accepted");
}

// ── E. refresh lease ────────────────────────────────────────────────────────
console.log("\n=== E. the refresh lease ===");
{
  const c2 = await connect();
  const acquire = async (cl, acc, org, secs = 60) =>
    (await cl.query("select public.acquire_connection_refresh_lease($1,$2,$3) as id", [acc, org, secs])).rows[0].id;
  const release = async (cl, acc, org, lease) =>
    (await cl.query("select public.release_connection_refresh_lease($1,$2,$3) as ok", [acc, org, lease])).rows[0].ok;

  const first = await acquire(c, accA, orgA);
  check(Boolean(first), "the first worker gets the lease");
  const second = await acquire(c2, accA, orgA);
  check(second === null, "a second worker is refused while it is held", `got ${second}`);
  check((await release(c2, accA, orgA, "00000000-0000-4000-8000-000000000000")) === false, "only the holder can release it");
  check((await release(c, accA, orgA, first)) === true, "the holder releases it");
  check(Boolean(await acquire(c2, accA, orgA)), "after release, another worker can take it");

  // A crashed worker never releases. The lease must lapse on its own.
  await c.query("update social_accounts set refresh_leased_until = now() - interval '1 second' where id=$1", [accA]);
  check(Boolean(await acquire(c, accA, orgA)), "an expired lease is taken over (a dead worker cannot block refreshes)");
  await c.query("update social_accounts set refresh_lease_id=null, refresh_leased_until=null where id=$1", [accA]);

  check((await acquire(c, accA, orgB)) === null, "a lease cannot be taken with another tenant's id");

  // Phase 37: two concurrent refreshes, one provider call.
  let providerCalls = 0;
  const worker = async (cl) => {
    const lease = await acquire(cl, accB, orgB);
    if (!lease) return "REFRESH_IN_PROGRESS";
    providerCalls++;
    await new Promise((r) => setTimeout(r, 150));
    await release(cl, accB, orgB, lease);
    return "refreshed";
  };
  const results = await Promise.all([worker(c), worker(c2)]);
  check(providerCalls === 1, "two concurrent refreshes call the provider exactly once", `calls=${providerCalls}`);
  check(results.includes("REFRESH_IN_PROGRESS") && results.includes("refreshed"), "one refreshes, the other reports REFRESH_IN_PROGRESS", results.join(","));
  await c2.end();
}

// ── F. parent-child tenant consistency ──────────────────────────────────────
console.log("\n=== F. no child row can point at another workspace's account ===");
async function columnsOf(table) {
  return (await c.query(
    `select column_name, data_type, is_nullable, column_default, udt_name from information_schema.columns
      where table_schema='public' and table_name=$1 order by ordinal_position`, [table])).rows;
}
async function checkLiteral(table, column) {
  const { rows } = await c.query(`select pg_get_constraintdef(oid) d from pg_constraint where conrelid=$1::regclass and contype='c'`, [`public."${table}"`]);
  for (const r of rows) {
    if (!new RegExp(`(^|[^A-Za-z0-9_])${column}([^A-Za-z0-9_]|$)`).test(r.d)) continue;
    const lit = [...r.d.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    if (lit.length) return lit[0];
  }
  return null;
}
async function enumLabel(udt) {
  return (await c.query(`select e.enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname=$1 order by e.enumsortorder limit 1`, [udt])).rows[0]?.enumlabel ?? null;
}
/** Inserts one row with explicit tenant and account; other required columns filled by type. */
async function insertChild(table, tenantId, accountId, fk = {}) {
  const cols = await columnsOf(table);
  const needed = cols.filter((x) =>
    ["tenant_id", "account_id"].includes(x.column_name) || fk[x.column_name] !== undefined ||
    (x.is_nullable === "NO" && (!x.column_default || /auth\.|current_tenant_id|current_setting/.test(x.column_default))));
  const values = [];
  for (const col of needed) {
    const n = col.column_name, t = col.data_type;
    if (n === "tenant_id") values.push(tenantId);
    else if (n === "account_id") values.push(accountId);
    else if (fk[n] !== undefined) values.push(fk[n]);
    else if ((t === "text" || t === "character varying") && (await checkLiteral(table, n))) values.push(await checkLiteral(table, n));
    else if (t === "USER-DEFINED") values.push(await enumLabel(col.udt_name));
    else if (t === "uuid") values.push(n.endsWith("user_id") || n === "triggered_by" ? adminA : null);
    else if (t.startsWith("timestamp")) values.push(new Date().toISOString());
    else if (t === "boolean") values.push(false);
    else if (["integer", "bigint", "smallint", "numeric", "double precision", "real"].includes(t)) values.push(0);
    else if (t === "ARRAY") values.push([]);
    else if (t === "jsonb" || t === "json") values.push("{}");
    else values.push(`${table}-row`);
  }
  try {
    const { rows } = await c.query(
      `insert into public."${table}" (${needed.map((x) => `"${x.column_name}"`).join(",")}) values (${needed.map((_, i) => `$${i + 1}`).join(",")}) returning id`,
      values);
    return { id: rows[0].id };
  } catch (e) {
    return { error: e.message.split("\n")[0] };
  }
}
const CHILD = ["social_posts", "social_interactions", "social_capabilities", "social_connection_tests",
  "integration_errors", "connection_retry_log", "social_account_scans"];
for (const table of CHILD) {
  const good = await insertChild(table, orgA, accA);
  if (good.error) { check(false, `${table}: a same-workspace row can be written`, good.error); continue; }
  const cross = await insertChild(table, orgA, accB);
  check(Boolean(cross.error) && /does not belong to tenant/.test(cross.error),
    `${table}: inserting Workspace A's tenant with Workspace B's account is refused`, cross.error ?? "accepted");
  let moved = null;
  try { await c.query(`update public."${table}" set account_id=$2 where id=$1`, [good.id, accB]); }
  catch (e) { moved = e.message.split("\n")[0]; }
  check(Boolean(moved) && /does not belong to tenant/.test(moved),
    `${table}: re-pointing an existing row at Workspace B's account is refused`, moved ?? "accepted");
}
{
  const testA = await insertChild("social_connection_tests", orgA, accA);
  const testB = await insertChild("social_connection_tests", orgB, accB);
  if (testA.id && testB.id) {
    const cross = await insertChild("social_test_results", orgA, null, { test_id: testB.id });
    check(Boolean(cross.error) && /does not belong to tenant/.test(cross.error),
      "social_test_results: Workspace A cannot attach a result to Workspace B's test", cross.error ?? "accepted");
    const ok = await insertChild("social_test_results", orgA, null, { test_id: testA.id });
    check(!ok.error, "social_test_results: a same-workspace result is accepted", ok.error ?? "");
  }
}

// ── G. sweep ────────────────────────────────────────────────────────────────
console.log("\n=== G. stuck authorizations are timed out ===");
{
  const stale = await mkAccount(orgA, "linkedin", "li-a");
  await c.query("update social_accounts set connection_state='authorization_started' where id=$1", [stale]);
  await c.query("update social_accounts set state_changed_at = now() - interval '20 minutes' where id=$1", [stale]);
  const fresh = await mkAccount(orgA, "pinterest", "pin-a");
  await c.query("update social_accounts set connection_state='authorization_started' where id=$1", [fresh]);
  const r = (await c.query("select * from public.expire_abandoned_oauth_attempts()")).rows[0];
  const state = async (id) => (await c.query("select connection_state from social_accounts where id=$1", [id])).rows[0].connection_state;
  check(await state(stale) === "authorization_cancelled", "an authorization abandoned 20 minutes ago is cancelled", await state(stale));
  check(await state(fresh) === "authorization_started", "one still in progress is left alone");
  check(Number(r.cancelled_count) === 1, "the sweep reports what it cancelled", `cancelled=${r.cancelled_count}`);
}

// ── H. duplicates ───────────────────────────────────────────────────────────
console.log("\n=== H. duplicate connections ===");
{
  let dup = null;
  try { await mkAccount(orgA, "facebook", "page-a"); } catch (e) { dup = e.message.split("\n")[0]; }
  check(Boolean(dup), "the same Page cannot be connected twice in one workspace", dup ?? "accepted");
  let other = null;
  try { await mkAccount(orgB, "facebook", "page-a"); } catch (e) { other = e.message.split("\n")[0]; }
  check(other === null, "the same Page may be connected by a different workspace", other ?? "");
}

// ── I. legacy rows, and a second run ────────────────────────────────────────
console.log("\n=== I. legacy pasted-token rows, and re-running the migration ===");
{
  const legacy = (await c.query(
    `insert into social_accounts (tenant_id, platform, label, connect_method, external_id) values ($1,'youtube','old','manual','UC-legacy') returning id`,
    [orgA])).rows[0].id;
  let rerun = null;
  try { await c.query(fs.readFileSync(path.join(MIG, BATCH1), "utf8")); }
  catch (e) { rerun = e.message.split("\n")[0]; try { await c.query("ROLLBACK"); } catch {} }
  check(rerun === null, "the migration re-runs cleanly on top of itself", rerun ?? "");
  const row = (await c.query("select legacy_manual_connection from social_accounts where id=$1", [legacy])).rows[0];
  check(row?.legacy_manual_connection === true, "a pasted-token row is marked legacy, not deleted");
}

console.log("");
console.log(failures === 0 ? "OK - Batch 1 database controls hold." : `FAIL - ${failures} problem(s).`);
await c.end();
await p.stop();
process.exit(failures === 0 ? 0 : 1);
