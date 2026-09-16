// Proves the OAuth state round trip actually works against the migrated
// schema -- not just that consume_oauth_state() exists, but that the flow the
// app performs succeeds end to end. This is the check that would have caught
// the connector being broken: the column oauth.server.ts inserts on every
// connect (code_verifier) was missing from the table, so the flow failed at
// both the start and the callback while TypeScript stayed happy, because
// types.ts is hand-maintained and claimed the column existed.
//
//   npm install --no-save embedded-postgres@17.10.0-beta.17 pg
//   node supabase/verify/verify-oauth-roundtrip.mjs

import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(HERE, "..", "migrations");
const BUNDLE = path.join(HERE, "..", "RUN_THESE_MIGRATIONS.sql");
const PORT = 54992;
const p = new EmbeddedPostgres({
  databaseDir: path.join(HERE, ".pgdata-oauth"),
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
  .filter((f) => f.endsWith(".sql") && f < "20260830")
  .sort()) {
  try {
    await c.query(fs.readFileSync(path.join(MIG, f), "utf8"));
  } catch (e) {
    try {
      await c.query("ROLLBACK");
    } catch {}
  }
}
await c.query(fs.readFileSync(BUNDLE, "utf8"));

// Minimal tenant + user, the way onboarding would create them.
const u = (await c.query("insert into auth.users(email) values('e2e@example.com') returning id"))
  .rows[0].id;
const o = (
  await c.query(
    "insert into public.organizations(name,slug) values('E2E Co','e2e-co') returning id",
  )
).rows[0].id;

console.log("\n--- OAuth round trip, exactly as oauth.server.ts does it ---");
// 1. Flow start: oauth.server.ts:195 inserts the state row incl. code_verifier.
await c.query(
  `insert into public.oauth_states(tenant_id,user_id,platform,state,redirect_uri,code_verifier)
               values($1,$2,'twitter','state-abc','https://app.example/cb','verifier-xyz')`,
  [o, u],
);
console.log("  1. state row inserted with code_verifier   OK");

// 2. Callback: oauth.server.ts:383 consumes it once.
const r1 = await c.query("select * from public.consume_oauth_state('state-abc')");
console.log(
  "  2. consume_oauth_state returned            ",
  r1.rows.length === 1
    ? `OK  platform=${r1.rows[0].platform} verifier=${r1.rows[0].code_verifier}`
    : "NO ROW",
);

// 3. Single-use: a replayed callback must get nothing.
const r2 = await c.query("select * from public.consume_oauth_state('state-abc')");
console.log(
  "  3. replay of the same state                ",
  r2.rows.length === 0 ? "OK  rejected (single-use)" : "LEAK - returned a row again",
);

// 4. Expired states must not be consumable.
await c.query(
  `insert into public.oauth_states(tenant_id,user_id,platform,state,redirect_uri,expires_at)
               values($1,$2,'meta','state-old','https://app.example/cb', now() - interval '1 hour')`,
  [o, u],
);
const r3 = await c.query("select * from public.consume_oauth_state('state-old')");
console.log(
  "  4. expired state                           ",
  r3.rows.length === 0 ? "OK  rejected" : "BUG - expired state accepted",
);
const ok = r1.rows.length === 1 && r2.rows.length === 0 && r3.rows.length === 0;
console.log("");
console.log(ok ? "OK - OAuth state round trip works." : "FAIL - the OAuth flow is broken.");
await c.end();
await p.stop();
process.exit(ok ? 0 : 1);
