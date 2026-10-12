// Tests the specific claims a security scan makes about secret exposure, as
// two different roles inside ONE company: a company admin and an ordinary
// staff member. Cross-tenant isolation is covered by verify-tenant-isolation;
// this asks the narrower question that scan raised -- can a rank-and-file
// teammate read the credentials their company stored?
//
//   node supabase/verify/verify-secret-exposure.mjs
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(HERE, "..", "migrations");
const PORT = 54983;

const p = new EmbeddedPostgres({
  databaseDir: path.join(HERE, ".pgdata-secrets"),
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

const org = (
  await c.query("insert into organizations(name,slug) values('Acme','acme') returning id")
).rows[0].id;
const mk = async (email, admin) => {
  const id = (await c.query("insert into auth.users(email) values($1) returning id", [email]))
    .rows[0].id;
  await c.query("update profiles set tenant_id=$2, staff_role=$3 where id=$1", [
    id,
    org,
    admin ? "company_admin" : "staff",
  ]);
  if (admin)
    await c.query(
      "insert into user_roles(user_id,role) values($1,'admin') on conflict do nothing",
      [id],
    );
  return id;
};
const admin = await mk("admin@acme.test", true);
const staff = await mk("staff@acme.test", false);

// Seed one secret-bearing row per table the scan named.
const seed = async (sql, params = []) => {
  try {
    await c.query(sql, params);
  } catch (e) {
    /* table shape varies */
  }
};
await seed(
  `insert into wa_numbers(tenant_id,label,phone_number_id,access_token,app_secret)
            values($1,'Sales','111','WA-TOKEN','APP-SECRET')`,
  [org],
);
await seed(
  `insert into ai_provider_keys(tenant_id,provider,api_key,active)
            values($1,'openai','AI-KEY',true)`,
  [org],
);
await seed(
  `insert into platform_apps(tenant_id,provider,client_id,client_secret)
            values($1,'meta','CID','CLIENT-SECRET')`,
  [org],
);
await seed(
  `insert into social_accounts(tenant_id,platform,label,access_token,refresh_token)
            values($1,'instagram','IG','SOCIAL-TOKEN','REFRESH')`,
  [org],
);
await seed(
  `insert into wordpress_sites(tenant_id,site_url,username,app_password)
            values($1,'https://x.test','u','WP-PASSWORD')`,
  [org],
);

const asRole = async (uid, sql) => {
  await c.query("begin");
  try {
    await c.query("select set_config('request.jwt.claim.sub',$1,true)", [uid]);
    await c.query("set local role authenticated");
    const r = await c.query(sql);
    await c.query("reset role");
    return { ok: true, rows: r.rows, count: r.rowCount ?? 0 };
  } catch (e) {
    return { ok: false, err: e.message.split("\n")[0] };
  } finally {
    await c.query("commit");
  }
};

let leaks = 0;
const secretCheck = async (label, sql, who, uid, shouldSee) => {
  const r = await asRole(uid, sql);
  const got = r.ok && r.rows.length > 0 && Object.values(r.rows[0])[0] != null;
  const pass = got === shouldSee;
  if (!pass && got) leaks++;
  const verdict = pass ? "OK  " : got ? "LEAK" : "note";
  console.log(
    `  ${verdict}  ${who.padEnd(8)} ${label}${r.ok ? "" : "  (blocked: " + r.err.slice(0, 44) + ")"}`,
  );
};

console.log("\n=== can a teammate read the credentials their company stored? ===");
for (const [who, uid] of [
  ["admin", admin],
  ["staff", staff],
]) {
  await secretCheck(
    "wa_numbers.access_token",
    "select access_token from wa_numbers limit 1",
    who,
    uid,
    false,
  );
  await secretCheck(
    "ai_provider_keys.api_key",
    "select api_key from ai_provider_keys limit 1",
    who,
    uid,
    false,
  );
  await secretCheck(
    "platform_apps.client_secret",
    "select client_secret from platform_apps limit 1",
    who,
    uid,
    false,
  );
  await secretCheck(
    "social_accounts.access_token",
    "select access_token from social_accounts limit 1",
    who,
    uid,
    false,
  );
  await secretCheck(
    "wordpress_sites.app_password",
    "select app_password from wordpress_sites limit 1",
    who,
    uid,
    false,
  );
  console.log("");
}

console.log("=== can a non-admin WRITE credentials? ===");
for (const [label, sql] of [
  [
    "ai_provider_keys insert",
    `insert into ai_provider_keys(tenant_id,provider,api_key,active) values('${org}','x','K',true)`,
  ],
  ["ai_provider_keys update", `update ai_provider_keys set api_key='HACKED'`],
  ["ai_provider_keys delete", `delete from ai_provider_keys`],
  ["wa_numbers update", `update wa_numbers set access_token='HACKED'`],
]) {
  const r = await asRole(staff, sql);
  // A write blocked by RLS does not raise -- it simply affects no rows. Only
  // a non-zero rowCount is an actual exposure.
  const wrote = r.ok && (r.count ?? 0) > 0;
  if (wrote) leaks++;
  const how = r.ok ? `${r.count ?? 0} row(s) changed` : "blocked: " + r.err.slice(0, 40);
  console.log(`  ${wrote ? "LEAK" : "OK  "}  staff    ${label.padEnd(26)} ${how}`);
}

console.log("");
console.log(
  leaks === 0
    ? "OK - no secret readable or writable by a non-admin teammate."
    : `FAIL - ${leaks} exposure(s).`,
);
await c.end();
await p.stop();
process.exit(leaks === 0 ? 0 : 1);
