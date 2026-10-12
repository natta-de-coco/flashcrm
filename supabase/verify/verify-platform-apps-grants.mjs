// Guards the platform_apps privilege contract, after a company admin hit
// "permission denied for table platform_apps" while saving Meta App ID and
// Secret.
//
// That message is a GRANT failure, not RLS -- an RLS denial either returns no
// rows or says "violates row-level security policy".
//
// The contract this locks in:
//
//   - `authenticated` may read every column of platform_apps EXCEPT
//     client_secret. 20260901000000 revoked table-wide SELECT and re-granted it
//     column by column for exactly this reason.
//   - Because of that, an upsert is NOT reachable as `authenticated`:
//     ON CONFLICT DO UPDATE SET client_secret = excluded.client_secret is
//     treated by Postgres as a read of client_secret. A plain INSERT and a
//     plain UPDATE of the same column both succeed; it is specifically the
//     upsert that needs SELECT on it.
//   - So savePlatformApp writes as service_role instead. If someone ever
//     "fixes" the original error by granting SELECT (client_secret) back, the
//     first check below starts passing and this script fails -- which is the
//     point, because that grant would undo the hardening.
//
//   node supabase/verify/verify-platform-apps-grants.mjs
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(HERE, "..", "migrations");
const PORT = 54987;

const p = new EmbeddedPostgres({
  databaseDir: path.join(HERE, ".pgdata-grants"),
  user: "postgres",
  password: "postgres",
  port: PORT,
  persistent: false,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});
await p.initialise();
await p.start();
const c = new pg.Client({
  host: "localhost",
  port: PORT,
  user: "postgres",
  password: "postgres",
  database: "postgres",
});
await c.connect();
await c.query("SET search_path TO public, extensions");
await c.query(fs.readFileSync(path.join(HERE, "supabase-shim.sql"), "utf8"));
for (const f of fs
  .readdirSync(MIG)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  try {
    await c.query(fs.readFileSync(path.join(MIG, f), "utf8"));
  } catch {
    try {
      await c.query("ROLLBACK");
    } catch {}
  }
}

// ── what privileges does `authenticated` actually hold? ─────────────────────
const cols = await c.query(`
  SELECT privilege_type, column_name FROM information_schema.column_privileges
   WHERE grantee='authenticated' AND table_schema='public' AND table_name='platform_apps'
   ORDER BY 1,2`);
console.log("\n=== privileges held by `authenticated` on platform_apps ===");
const byPriv = {};
for (const r of cols.rows) (byPriv[r.privilege_type] ??= []).push(r.column_name);
for (const [k, v] of Object.entries(byPriv)) console.log(`  ${k.padEnd(10)}:`, v.join(", "));

// ── seed a company and a company admin ──────────────────────────────────────
const org = (
  await c.query("insert into organizations(name,slug) values('Acme','acme') returning id")
).rows[0].id;
const uid = (await c.query("insert into auth.users(email) values('admin@acme.test') returning id"))
  .rows[0].id;
await c.query("update profiles set tenant_id=$2, staff_role='company_admin' where id=$1", [
  uid,
  org,
]);
await c.query("insert into user_roles(user_id,role) values($1,'admin') on conflict do nothing", [
  uid,
]);

const asRole = async (role, sql, params = []) => {
  await c.query("begin");
  try {
    await c.query("select set_config('request.jwt.claim.sub',$1,true)", [uid]);
    await c.query(`set local role ${role}`);
    await c.query(sql, params);
    await c.query("reset role");
    return { ok: true };
  } catch (e) {
    return { ok: false, err: e.message.split("\n")[0] };
  } finally {
    await c.query("commit");
  }
};

const UPSERT = `insert into platform_apps (tenant_id, provider, client_id, client_secret, label, updated_at)
   values ($1,'meta','APP-ID-123','APP-SECRET-456',null, now())
   on conflict (tenant_id, provider) do update
     set client_id = excluded.client_id,
         client_secret = excluded.client_secret,
         label = excluded.label,
         updated_at = excluded.updated_at`;

let failures = 0;
const expect = async (label, role, sql, shouldSucceed, params = []) => {
  const r = await asRole(role, sql, params);
  const pass = r.ok === shouldSucceed;
  if (!pass) failures++;
  const verdict = pass ? "OK  " : "FAIL";
  const detail = r.ok ? "" : `  (${r.err})`;
  console.log(`  ${verdict}  ${label}${pass && !r.ok ? "  — correctly refused" : detail}`);
};

console.log("\n=== the contract savePlatformApp relies on ===");
await expect("upsert as authenticated must be refused", "authenticated", UPSERT, false, [org]);
await expect("upsert as service_role must succeed", "service_role", UPSERT, true, [org]);
await expect(
  "list non-secret columns as authenticated",
  "authenticated",
  "select id, provider, client_id, label, updated_at from platform_apps",
  true,
);

console.log("\n=== the secret must stay unreadable from the browser ===");
await expect(
  "select client_secret",
  "authenticated",
  "select client_secret from platform_apps",
  false,
);
await expect("select *", "authenticated", "select * from platform_apps", false);

console.log("");
console.log(
  failures === 0
    ? "OK - the secret is unreadable from the browser, and the service role can still save it."
    : `FAIL - ${failures} problem(s).`,
);
await c.end();
await p.stop();
process.exit(failures === 0 ? 0 : 1);
