// Proves multi-identity contacts actually work against the migrated schema.
//
// The contract tests assert what the migration file says; this asserts what the
// database does. It exercises the case the feature exists for: one customer
// messaging from three different numbers, across two branches, landing on one
// contact instead of three.
//
//   npm install --no-save embedded-postgres@17.10.0-beta.17 pg
//   node supabase/verify/verify-contact-identities.mjs

import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(HERE, "..", "migrations");
const PORT = 54994;

const p = new EmbeddedPostgres({
  databaseDir: path.join(HERE, ".pgdata-identities"),
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

for (const f of fs.readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort()) {
  try {
    await c.query(fs.readFileSync(path.join(MIG, f), "utf8"));
  } catch {
    try {
      await c.query("ROLLBACK");
    } catch {
      /* a baseline migration re-running is expected to fail; keep going */
    }
  }
}

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const org = (
  await c.query("insert into public.organizations(name,slug) values('Acme','acme') returning id")
).rows[0].id;
const other = (
  await c.query("insert into public.organizations(name,slug) values('Rival','rival') returning id")
).rows[0].id;

console.log("\n--- normalization ---");
const norm = async (kind, value) =>
  (await c.query("select public.normalize_contact_identity($1,$2) v", [kind, value])).rows[0].v;

const a = await norm("phone", "+971 50 963 0506");
const b = await norm("phone", "+971509630506");
check("spacing is ignored", a === b, `${a} vs ${b}`);
check("a leading + is kept", a.startsWith("+"), a);
check("email is lowercased", (await norm("email", "  Sales@ACME.com ")) === "sales@acme.com");
check("empty is null", (await norm("phone", "   ")) === null);

console.log("\n--- one customer, three numbers, two branches ---");
const contact = (
  await c.query(
    "insert into public.contacts(name,phone,tenant_id) values('Acme Trading','+971509630506',$1) returning id",
    [org],
  )
).rows[0].id;

const deira = (
  await c.query(
    "insert into public.contact_branches(tenant_id,contact_id,name,city,is_primary) values($1,$2,'Deira','Dubai',true) returning id",
    [org, contact],
  )
).rows[0].id;
await c.query(
  "insert into public.contact_branches(tenant_id,contact_id,name,city) values($1,$2,'Sharjah','Sharjah')",
  [org, contact],
);

await c.query(
  "insert into public.contact_identities(tenant_id,contact_id,kind,value,label,is_primary) values($1,$2,'phone','+971509630506','Mobile',true)",
  [org, contact],
);
await c.query(
  "insert into public.contact_identities(tenant_id,contact_id,branch_id,kind,value,label) values($1,$2,$3,'phone','04 123 4567','Deira office')",
  [org, contact, deira],
);
await c.query(
  "insert into public.contact_identities(tenant_id,contact_id,kind,value,label) values($1,$2,'email','Sales@Acme.com','Accounts')",
  [org, contact],
);

const resolve = async (tenant, kind, value) =>
  (await c.query("select * from public.resolve_contact_by_identity($1,$2,$3)", [tenant, kind, value]))
    .rows[0] ?? null;

const r1 = await resolve(org, "phone", "+971 50 963 0506");
check("the mobile resolves to the contact", r1?.contact_id === contact);
check("with no branch attributed", r1?.branch_id === null);

const r2 = await resolve(org, "phone", "041234567");
check("the office landline resolves to the SAME contact", r2?.contact_id === contact);
check("and names the branch it belongs to", r2?.branch_id === deira);

const r3 = await resolve(org, "email", "SALES@acme.com");
check("email resolves regardless of case", r3?.contact_id === contact);

console.log("\n--- isolation and integrity ---");
check("another workspace gets nothing", (await resolve(other, "phone", "041234567")) === null);

// The same number in a different workspace is a different customer, and must
// be allowed — this is what the old global UNIQUE on contacts.phone broke.
const rivalContact = (
  await c.query(
    "insert into public.contacts(name,tenant_id) values('Rival customer',$1) returning id",
    [other],
  )
).rows[0].id;
let ok = true;
try {
  await c.query(
    "insert into public.contact_identities(tenant_id,contact_id,kind,value) values($1,$2,'phone','04 123 4567')",
    [other, rivalContact],
  );
} catch (e) {
  ok = false;
  console.log("      " + e.message);
}
check("the same number may exist in another workspace", ok);

// Within one workspace it may not: that is what stops a duplicate stranger.
let rejected = false;
const second = (
  await c.query("insert into public.contacts(name,tenant_id) values('Duplicate',$1) returning id", [
    org,
  ])
).rows[0].id;
try {
  await c.query(
    "insert into public.contact_identities(tenant_id,contact_id,kind,value) values($1,$2,'phone','+971-50-963-0506')",
    [org, second],
  );
} catch {
  rejected = true;
}
check("the same number twice in one workspace is rejected", rejected);

let twoPrimaries = false;
try {
  await c.query(
    "insert into public.contact_identities(tenant_id,contact_id,kind,value,is_primary) values($1,$2,'phone','0555555555',true)",
    [org, contact],
  );
} catch {
  twoPrimaries = true;
}
check("a second primary phone is rejected", twoPrimaries);

console.log("\n--- deletion behaviour ---");
await c.query("delete from public.contact_branches where id=$1", [deira]);
const kept = await c.query(
  "select branch_id from public.contact_identities where value='04 123 4567' and tenant_id=$1",
  [org],
);
check("closing a branch keeps its number", kept.rows.length === 1);
check("and detaches it rather than deleting it", kept.rows[0]?.branch_id === null);

await c.query("delete from public.contacts where id=$1", [contact]);
const gone = await c.query("select 1 from public.contact_identities where contact_id=$1", [contact]);
check("deleting a contact removes its identities", gone.rows.length === 0);

console.log("\n--- backfill ---");
const bf = (
  await c.query(
    "insert into public.contacts(name,phone,email,tenant_id) values('Backfill Me','+971 4 000 1111','X@Y.com',$1) returning id",
    [org],
  )
).rows[0].id;
await c.query(
  fs.readFileSync(path.join(MIG, "20260910120000_contact_identities_and_branches.sql"), "utf8"),
);
const bfRows = await c.query(
  "select kind, normalized from public.contact_identities where contact_id=$1 order by kind",
  [bf],
);
check("re-running the migration backfills existing contacts", bfRows.rows.length === 2, JSON.stringify(bfRows.rows));
check(
  "and normalizes what it backfills",
  bfRows.rows.find((r) => r.kind === "email")?.normalized === "x@y.com",
);

await c.end();
await p.stop();
console.log(`\n${failures === 0 ? "OK - multi-identity contacts work." : `FAILED: ${failures}`}`);
process.exit(failures === 0 ? 0 : 1);
