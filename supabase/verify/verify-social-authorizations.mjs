// Batch 2A — the authorization/channel model, against a real Postgres.
//
//   node supabase/verify/verify-social-authorizations.mjs
//
//   A  20260911100000 applies cleanly, and re-runs harmlessly
//   B  members cannot read authorization tokens or write authorizations
//   C  a workspace cannot see another workspace's authorizations
//   D  a channel cannot reference another workspace's authorization
//   E  one authorization serves many channels; reconnect never duplicates
//   F  deleting an authorization detaches channels, it does not delete them
//   G  the authorization lease: exclusive, holder-released, self-expiring,
//      and two concurrent refreshes reach the provider once
//   H  oauth_states.purpose accepts only the three purposes
//
// SABOTAGE=1 drops the tenant trigger and grants token SELECT. MUST fail.
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(HERE, "..", "migrations");
const FILE = "20260911100000_social_authorizations.sql";
const PORT = 54995;

const DATA_DIR = path.join(HERE, ".pgdata-auths");
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

console.log("\n=== A. the migration applies ===");
let fileError = null;
for (const f of fs.readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort()) {
  try { await c.query(fs.readFileSync(path.join(MIG, f), "utf8")); }
  catch (e) { try { await c.query("ROLLBACK"); } catch {} if (f === FILE) fileError = e.message.split("\n")[0]; }
}
check(fileError === null, `${FILE} applied on a fresh database`, fileError ?? "");
let rerun = null;
try { await c.query(fs.readFileSync(path.join(MIG, FILE), "utf8")); }
catch (e) { rerun = e.message.split("\n")[0]; try { await c.query("ROLLBACK"); } catch {} }
check(rerun === null, "it re-runs cleanly on top of itself", rerun ?? "");

const mkOrg = async (slug) => (await c.query("insert into organizations(name,slug) values($1,$1) returning id", [slug])).rows[0].id;
const orgA = await mkOrg("alpha");
const orgB = await mkOrg("beta");
const mkUser = async (email, org) => {
  const id = (await c.query("insert into auth.users(email) values($1) returning id", [email])).rows[0].id;
  await c.query("update profiles set tenant_id=$2, staff_role='company_admin' where id=$1", [id, org]);
  return id;
};
const userA = await mkUser("a@alpha.test", orgA);
const userB = await mkUser("b@beta.test", orgB);
const mkAuth = async (org) =>
  (await c.query(
    `insert into social_authorizations (tenant_id, provider, platform, access_token_enc, requested_scopes, granted_scopes, provider_email_hint)
     values ($1,'google','youtube','v1:k:iv:ct:tag','{a}','{a}','x@test') returning id`, [org])).rows[0].id;
const authA = await mkAuth(orgA);
const authB = await mkAuth(orgB);
const mkChannel = async (org, ext, auth) =>
  (await c.query(
    `insert into social_accounts (tenant_id, platform, label, connect_method, external_id, authorization_id)
     values ($1,'youtube','ch','oauth',$2,$3) returning id`, [org, ext, auth])).rows[0].id;

if (process.env.SABOTAGE) {
  await c.query("DROP TRIGGER IF EXISTS social_accounts_authorization_tenant_match ON public.social_accounts");
  await c.query("GRANT SELECT (access_token_enc) ON public.social_authorizations TO authenticated");
  console.log("!! SABOTAGE: tenant trigger dropped, token column granted - the suite must now FAIL");
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

console.log("\n=== B. tokens stay server-side ===");
const colPriv = async (col, kind) =>
  (await c.query(`select has_column_privilege('authenticated','public.social_authorizations',$1,$2) p`, [col, kind])).rows[0].p;
for (const col of ["access_token_enc", "refresh_token_enc", "token_key_id", "refresh_lease_id"]) {
  check(!(await colPriv(col, "SELECT")), `declared: no SELECT on ${col}`);
}
check(await colPriv("provider_email_hint", "SELECT"), "declared: SELECT on provider_email_hint (for 'Signed in as')");
const readTok = await asUser(userA, () => c.query("select access_token_enc from social_authorizations"));
check(Boolean(readTok.threw), "enforced: a member cannot read an encrypted token", readTok.threw ?? "read allowed");
const ins = await asUser(userA, () => c.query(
  "insert into social_authorizations (tenant_id, provider, platform) values ($1,'google','youtube')", [orgA]));
check(Boolean(ins.threw), "enforced: a member cannot create an authorization", ins.threw ?? "insert accepted");
const upd = await asUser(userA, () => c.query("update social_authorizations set granted_scopes='{all}' where id=$1", [authA]));
check(Boolean(upd.threw) || upd.value?.rowCount === 0, "enforced: a member cannot rewrite granted scopes", upd.threw ?? `rows=${upd.value?.rowCount}`);

console.log("\n=== C. workspaces cannot see each other's authorizations ===");
const own = await asUser(userA, () => c.query("select id from social_authorizations"));
const ids = (own.value?.rows ?? []).map((r) => r.id);
check(ids.includes(authA), "Workspace A sees its own authorization", own.threw ?? "");
check(!ids.includes(authB), "Workspace A cannot see Workspace B's authorization");
const byId = await asUser(userA, () => c.query("select id from social_authorizations where id=$1", [authB]));
check((byId.value?.rowCount ?? 0) === 0, "not even by guessing its id");

console.log("\n=== D. a channel cannot reference another workspace's authorization ===");
let cross = null;
try { await mkChannel(orgA, "UC-cross", authB); } catch (e) { cross = e.message.split("\n")[0]; }
check(Boolean(cross) && /does not belong to tenant/.test(cross), "creating it is refused", cross ?? "accepted");
const chA = await mkChannel(orgA, "UC-a1", authA);
let moved = null;
try { await c.query("update social_accounts set authorization_id=$2 where id=$1", [chA, authB]); }
catch (e) { moved = e.message.split("\n")[0]; }
check(Boolean(moved) && /does not belong to tenant/.test(moved), "re-pointing an existing channel is refused", moved ?? "accepted");

console.log("\n=== E. one authorization, many channels ===");
const chA2 = await mkChannel(orgA, "UC-a2", authA);
const shared = (await c.query("select count(*)::int n from social_accounts where authorization_id=$1", [authA])).rows[0].n;
check(shared === 2, "two channels share one authorization (tokens stored once)", `n=${shared}`);
let dup = null;
try { await mkChannel(orgA, "UC-a1", authA); } catch (e) { dup = e.message.split("\n")[0]; }
check(Boolean(dup), "the same channel cannot be connected twice in one workspace", dup ?? "accepted");
const authA2 = await mkAuth(orgA);
await c.query("update social_accounts set authorization_id=$2 where id=$1", [chA, authA2]);
const rebound = (await c.query("select authorization_id from social_accounts where id=$1", [chA])).rows[0].authorization_id;
check(rebound === authA2, "a reconnect rebinds the existing channel to the new authorization");

console.log("\n=== F. deleting an authorization keeps the channel ===");
await c.query("delete from social_authorizations where id=$1", [authA2]);
const kept = (await c.query("select id, authorization_id from social_accounts where id=$1", [chA])).rows[0];
check(Boolean(kept), "the channel (and its history) survives");
check(kept?.authorization_id === null, "it is detached, so no token path remains");

console.log("\n=== G. the authorization refresh lease ===");
{
  const c2 = await connect();
  const acquire = async (cl, id, org) =>
    (await cl.query("select public.acquire_authorization_refresh_lease($1,$2,60) id", [id, org])).rows[0].id;
  const release = async (cl, id, org, lease) =>
    (await cl.query("select public.release_authorization_refresh_lease($1,$2,$3) ok", [id, org, lease])).rows[0].ok;
  const first = await acquire(c, authA, orgA);
  check(Boolean(first), "the first worker gets the lease");
  check((await acquire(c2, authA, orgA)) === null, "a second worker is refused while it is held");
  check((await release(c2, authA, orgA, "00000000-0000-4000-8000-000000000000")) === false, "only the holder can release");
  check((await release(c, authA, orgA, first)) === true, "the holder releases it");
  await c.query("update social_authorizations set refresh_leased_until=now()-interval '1 second', refresh_lease_id=gen_random_uuid() where id=$1", [authA]);
  check(Boolean(await acquire(c2, authA, orgA)), "an expired lease is taken over");
  await c.query("update social_authorizations set refresh_lease_id=null, refresh_leased_until=null where id=$1", [authA]);
  check((await acquire(c, authA, orgB)) === null, "it cannot be taken with another tenant's id");

  let calls = 0;
  const worker = async (cl) => {
    const lease = await acquire(cl, authB, orgB);
    if (!lease) return "REFRESH_IN_PROGRESS";
    calls++;
    await new Promise((r) => setTimeout(r, 150));
    await release(cl, authB, orgB, lease);
    return "refreshed";
  };
  const results = await Promise.all([worker(c), worker(c2)]);
  check(calls === 1, "two channels refreshing one authorization call the provider once", `calls=${calls}`);
  check(results.includes("REFRESH_IN_PROGRESS"), "the other reports REFRESH_IN_PROGRESS", results.join(","));
  await c2.end();
}

console.log("\n=== H. attempt purpose ===");
for (const good of ["connect", "reconnect", "upgrade"]) {
  let err = null;
  try {
    await c.query(
      `insert into oauth_states (tenant_id, user_id, platform, state_hash, redirect_uri, expires_at, purpose)
       values ($1,$2,'youtube',$3,'https://x.test/api/public/oauth-callback', now()+interval '10 minutes',$4)`,
      [orgA, userA, `h-${good}`, good]);
  } catch (e) { err = e.message.split("\n")[0]; }
  check(err === null, `purpose '${good}' is accepted`, err ?? "");
}
let bad = null;
try {
  await c.query(
    `insert into oauth_states (tenant_id, user_id, platform, state_hash, redirect_uri, expires_at, purpose)
     values ($1,$2,'youtube','h-bad','https://x.test/cb', now()+interval '10 minutes','steal')`, [orgA, userA]);
} catch (e) { bad = e.message.split("\n")[0]; }
check(Boolean(bad), "any other purpose is refused", bad ?? "accepted");

console.log("");
console.log(failures === 0 ? "OK - the authorization/channel model holds." : `FAIL - ${failures} problem(s).`);
await c.end();
await p.stop();
process.exit(failures === 0 ? 0 : 1);
