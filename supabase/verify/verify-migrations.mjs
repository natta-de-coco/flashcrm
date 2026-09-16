import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";

import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(HERE, "..", "migrations");
const DATA = path.join(HERE, ".pgdata-throwaway");
const PORT = 54999;

const pgsql = new EmbeddedPostgres({
  databaseDir: DATA,
  user: "postgres",
  password: "postgres",
  port: PORT,
  persistent: false,
  // Real Supabase is UTF8; the Windows default (WIN1252) rejected the box
  // characters in the migration comments. That was the harness, not the SQL.
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});

const connect = async () => {
  const c = new pg.Client({
    host: "localhost",
    port: PORT,
    user: "postgres",
    password: "postgres",
    database: "postgres",
  });
  await c.connect();
  // Supabase ships `extensions` on the search_path, which is why migrations
  // call gen_random_bytes() unqualified in column defaults.
  await c.query("SET search_path TO public, extensions");
  return c;
};

const files = fs
  .readdirSync(MIG)
  .filter((f) => f.endsWith(".sql"))
  .sort();

async function applyAll(client, label) {
  const results = [];
  for (const f of files) {
    const sql = fs.readFileSync(path.join(MIG, f), "utf8");
    try {
      await client.query(sql);
      results.push({ f, ok: true });
    } catch (e) {
      // A failed statement inside an explicit BEGIN leaves the session in an
      // aborted transaction; clear it so the next file gets a fair run.
      try {
        await client.query("ROLLBACK");
      } catch {}
      results.push({
        f,
        ok: false,
        err: `${e.message}${e.hint ? " | hint: " + e.hint : ""}`,
        pos: e.position,
      });
    }
  }
  const bad = results.filter((r) => !r.ok);
  console.log(
    `\n===== ${label}: ${results.length - bad.length}/${results.length} applied clean =====`,
  );
  for (const b of bad) console.log(`  FAIL ${b.f}\n       ${b.err}`);
  return bad;
}

console.log("initialising postgres…");
await pgsql.initialise();
await pgsql.start();
console.log("postgres up on", PORT);

let client = await connect();
const ver = await client.query("select version()");
console.log(ver.rows[0].version.split(",")[0]);

console.log("\napplying shim…");
await client.query(fs.readFileSync(path.join(HERE, "supabase-shim.sql"), "utf8"));
console.log("shim ok");
await client.end();
client = await connect();
console.log("search_path:", (await client.query("show search_path")).rows[0].search_path);

const pass1 = await applyAll(client, "PASS 1 (fresh database)");
const pass2 = await applyAll(client, "PASS 2 (re-run — idempotency check)");

// ── Smoke-calling the critical functions ────────────────────────────────
// Applying DDL is not the same as the DDL being correct. PostgreSQL does not
// resolve table or column references inside a plpgsql body at CREATE time --
// only syntax -- so a function referencing a table that does not exist is
// created without complaint and fails the first time a user triggers it.
// That is exactly the failure mode this harness exists to catch, so the
// functions the app actually depends on get called here.
const smoke = [
  ["integration_oauth_storage_ready", "select public.integration_oauth_storage_ready()"],
  ["current_tenant_id", "select public.current_tenant_id()"],
  ["is_super_admin", "select public.is_super_admin(gen_random_uuid())"],
  ["consume_oauth_state", "select * from public.consume_oauth_state('no-such-state')"],
  ["purge_expired_oauth_states", "select public.purge_expired_oauth_states()"],
  [
    "check_otp_attempt",
    "select * from public.check_otp_attempt('a@b.co','signup_verify','203.0.113.9')",
  ],
  ["check_ai_rate_limit", "select * from public.check_ai_rate_limit(gen_random_uuid())"],
  ["is_tenant_admin", "select public.is_tenant_admin()"],
];
const smokeFail = [];
for (const [name, sql] of smoke) {
  try {
    await client.query(sql);
  } catch (e) {
    // 42501/insufficient privilege is a policy decision, not a broken body.
    if (e.code === "42501") continue;
    smokeFail.push({ name, err: e.message });
    try {
      await client.query("ROLLBACK");
    } catch {}
  }
}
const checkReadiness = async (expected, label) => {
  const result = await client.query("select public.integration_oauth_storage_ready() as ready");
  if (result.rows[0].ready !== expected)
    smokeFail.push({ name: label, err: "Unexpected readiness" });
};
await checkReadiness(true, "secure schema is ready");
await client.query("BEGIN; GRANT SELECT ON public.oauth_states TO authenticated");
await checkReadiness(false, "browser state access blocks readiness");
await client.query("ROLLBACK; BEGIN; DROP INDEX public.social_accounts_one_row_per_channel");
await checkReadiness(false, "missing identity index blocks readiness");
await client.query("ROLLBACK");
console.log("");
console.log("===== SMOKE: calling the functions the app depends on =====");
if (smokeFail.length === 0) console.log("  all " + smoke.length + " callable");
else for (const f of smokeFail) console.log("  BROKEN BODY  " + f.name + "  ->  " + f.err);

fs.writeFileSync(path.join(HERE, "result.json"), JSON.stringify({ pass1, pass2 }, null, 2));

await client.end();
await pgsql.stop();
// Only two things are fatal: anything failing on a fresh database, and a
// PENDING migration that cannot be applied twice. The 2026-08-2x Lovable
// baseline is not idempotent and never gets re-run, so its pass-2 failures
// are expected and deliberately not counted.
// Re-runnability only matters for migrations a human pastes by hand -- the
// ones in RUN_THESE_MIGRATIONS.sql. Lovable's own migrations are UUID-named,
// applied once by its pipeline and never replayed, so they are held to the
// fresh-database bar only.
const isLovableGenerated = (f) => /_[0-9a-f]{8}-[0-9a-f]{4}-/.test(f);
const isPending = (f) => f >= "20260830000000" && !isLovableGenerated(f);
const pendingRerun = pass2.filter((x) => isPending(x.f));
console.log("");
console.log("fresh-database failures : " + pass1.length);
console.log("pending re-run failures : " + pendingRerun.length);
console.log("baseline re-run failures: " + (pass2.length - pendingRerun.length) + " (expected)");
console.log("broken function bodies  : " + smokeFail.length);
const fatal = pass1.length + pendingRerun.length + smokeFail.length;
console.log("");
console.log(fatal ? "FAIL - do not paste this into Supabase yet." : "OK - safe to paste.");
process.exit(fatal ? 1 : 0);
