// Two companies, real RLS, driven exactly as a browser client is (role
// authenticated + a JWT sub). Proves company A cannot read or modify company B.
//
// This exists because the owner opened Settings and saw people from another
// company under Team. The policy on profiles was USING (true), and a sweep
// found four more tables with no scoping at all. Isolation here is a
// discipline, not a property: every new table needs its own policy, and
// anything using the service role bypasses RLS entirely. So it gets a test.
//
//   npm install --no-save embedded-postgres@17.10.0-beta.17 pg
//   node supabase/verify/verify-tenant-isolation.mjs
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(HERE, "..", "migrations");
const PORT = 54987;

const p = new EmbeddedPostgres({
  databaseDir: path.join(HERE, ".pgdata-isolation"),
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

const orgA = (
  await c.query("insert into organizations(name,slug) values('Acme','acme') returning id")
).rows[0].id;
const orgB = (
  await c.query("insert into organizations(name,slug) values('Globex','globex') returning id")
).rows[0].id;
const mk = async (email, org, admin) => {
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
const adminA = await mk("admin@acme.test", orgA, true);
const staffA = await mk("staff@acme.test", orgA, false);
const adminB = await mk("admin@globex.test", orgB, true);

await c.query(
  "insert into system_alerts(title,severity,tenant_id) values('Acme alert','warning',$1)",
  [orgA],
);
await c.query(
  "insert into system_alerts(title,severity,tenant_id) values('Globex alert','warning',$1)",
  [orgB],
);
await c.query("insert into system_alerts(title,severity) values('Platform billing','critical')");

const q = async (uid, sql) => {
  await c.query("begin");
  try {
    await c.query("select set_config('request.jwt.claim.sub',$1,true)", [uid]);
    await c.query("set local role authenticated");
    const { rows } = await c.query(sql);
    await c.query("reset role");
    return rows;
  } finally {
    await c.query("commit");
  }
};

let failures = 0;
const check = (label, pass, detail) => {
  if (!pass) failures++;
  console.log(`  ${pass ? "OK  " : "FAIL"}  ${label}${detail ? "  -> " + detail : ""}`);
};

console.log("");
console.log("=== can one company see another? ===");
for (const [who, uid] of [
  ["Acme admin", adminA],
  ["Acme staff", staffA],
]) {
  const seen = (await q(uid, "select email from profiles order by email")).map((r) => r.email);
  check(`${who} reads profiles`, !seen.some((e) => e.includes("globex")), seen.join(", "));
}
const roles = await q(
  adminA,
  `select p.email from user_roles ur join profiles p on p.id=ur.user_id`,
);
check("Acme admin reads user_roles", !roles.some((r) => r.email.includes("globex")));

// The organizations table itself. Added 12 Sep 2026 after a production audit
// found any signed-in company admin could list every company on the platform:
// orgs_read_own was USING (id = current_tenant_id() OR has_role(uid,'admin')),
// and onboarding grants that legacy 'admin' role to whoever creates a
// workspace. This suite already built the very user that exposes it -- it
// simply never asked the question.
const orgsSeen = (await q(adminA, "select name from organizations order by name")).map(
  (r) => r.name,
);
check(
  "Acme admin lists only its own company",
  orgsSeen.length === 1 && orgsSeen[0] === "Acme",
  orgsSeen.join(", ") || "(none)",
);
let paddle = "readable";
try {
  await q(adminA, "select paddle_customer_id, paddle_subscription_id from organizations");
} catch {
  paddle = "denied";
}
check("billing identifiers are not readable by customers", paddle === "denied", paddle);

// ...and the fix must not lock out platform staff, who legitimately see every
// company (orgs_super_admin_all). Without this check, "isolate organizations"
// could be satisfied by breaking the manager portal.
const superUid = await mk("owner@flas.test", orgA, true);
await c.query("update profiles set staff_role='super_admin' where id=$1", [superUid]);
const superSees = (await q(superUid, "select name from organizations order by name")).map(
  (r) => r.name,
);
check("super admin still sees every company", superSees.length === 2, superSees.join(", "));

console.log("");
console.log("=== can one company modify another? ===");
await c.query("begin");
let changed = 0;
try {
  await c.query("select set_config('request.jwt.claim.sub',$1,true)", [adminA]);
  await c.query("set local role authenticated");
  changed = (await c.query("update profiles set full_name='hacked' where id=$1", [adminB]))
    .rowCount;
  await c.query("reset role");
} catch {
  changed = 0;
} finally {
  await c.query("commit");
}
check("Acme admin edits Globex's user", changed === 0, `${changed} row(s) affected`);

console.log("");
console.log("=== alerts and legacy singletons ===");
for (const [who, uid, forbidden] of [
  ["Acme", adminA, "Globex"],
  ["Globex", adminB, "Acme"],
]) {
  const a = (await q(uid, "select title from system_alerts")).map((r) => r.title);
  check(
    `${who} sees only its own alerts`,
    !a.some((t) => t.includes(forbidden)),
    a.join(", ") || "(none)",
  );
}
for (const t of ["bot_settings", "wa_config"]) {
  const n = (await q(adminA, `select count(*)::int as n from ${t}`))[0].n;
  check(`company admin cannot read ${t}`, n === 0, `${n} row(s)`);
}

console.log("");
console.log(
  failures === 0 ? "OK - companies are isolated." : `FAIL - ${failures} isolation check(s) failed.`,
);
await c.end();
await p.stop();
process.exit(failures === 0 ? 0 : 1);
