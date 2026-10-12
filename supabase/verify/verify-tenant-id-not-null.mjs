// Red-team finding B-2 — tenant_id is NOT NULL on customer-data tables.
//
//   node supabase/verify/verify-tenant-id-not-null.mjs
//
// Proves three things against a real Postgres:
//   1. the seven constrained tables reject a NULL tenant_id
//   2. the tables deliberately left nullable still accept one
//   3. the migration refuses to run while orphan rows exist, naming the table
//
// SABOTAGE=1 drops the constraints. The run must fail.
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(HERE, "..", "migrations");
const PORT = 54993;

const DATA_DIR = path.join(HERE, ".pgdata-tenantnn");
fs.rmSync(DATA_DIR, { recursive: true, force: true });

const p = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
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

const CONSTRAINED = [
  "contacts",
  "conversations",
  "messages",
  "leads",
  "wa_numbers",
  "campaigns",
  "wa_templates",
];
// Left nullable on purpose. If a later change constrains one of these, this
// suite fails and the reason has to be argued rather than assumed.
const NULLABLE_BY_DESIGN = ["profiles", "audit_log", "system_alerts"];

if (process.env.SABOTAGE) {
  for (const t of CONSTRAINED) {
    try {
      await c.query(`ALTER TABLE public.${t} ALTER COLUMN tenant_id DROP NOT NULL`);
    } catch {}
  }
  console.log("!! SABOTAGE: NOT NULL dropped - the suite must now FAIL");
}

let failures = 0;
const check = (ok, label, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${label}${detail ? "  -- " + detail : ""}`);
};

const nullability = async (table) => {
  const { rows } = await c.query(
    `select is_nullable from information_schema.columns
      where table_schema='public' and table_name=$1 and column_name='tenant_id'`,
    [table],
  );
  return rows[0]?.is_nullable ?? null;
};

// ── 1. The constrained tables ───────────────────────────────────────────────
console.log("\n=== customer-data tables reject a NULL tenant_id ===");
for (const t of CONSTRAINED) {
  const n = await nullability(t);
  if (n === null) {
    check(false, `${t}.tenant_id exists`, "column or table missing");
    continue;
  }
  check(n === "NO", `${t}.tenant_id is NOT NULL`, `is_nullable=${n}`);
}

// ── 2. A NULL insert is actually refused, not merely declared ───────────────
console.log("\n=== the constraint is enforced on write ===");
{
  // information_schema can be right while something else lets a write through;
  // attempting the write is the claim that matters.
  const org = (await c.query("insert into organizations(name,slug) values('NN','nn') returning id"))
    .rows[0].id;
  void org;
  let refused = false;
  try {
    await c.query("insert into contacts (tenant_id, name) values (null, 'orphan')");
  } catch (e) {
    refused = /not-null|null value/i.test(e.message);
  }
  check(refused, "inserting a contact with a NULL tenant_id raises");
}

// ── 3. The deliberate exclusions stay nullable ──────────────────────────────
console.log("\n=== tables excluded on purpose are still nullable ===");
for (const t of NULLABLE_BY_DESIGN) {
  const n = await nullability(t);
  if (n === null) {
    console.log(`  SKIP  ${t} (not present)`);
    continue;
  }
  check(n === "YES", `${t}.tenant_id is still nullable`, `is_nullable=${n}`);
}

// ── 4. The migration refuses to run over orphan rows ────────────────────────
console.log("\n=== the migration names the table rather than failing generically ===");
{
  await c.query("alter table public.contacts alter column tenant_id drop not null");
  await c.query("insert into contacts (tenant_id, name) values (null, 'orphan')");

  let message = "";
  try {
    await c.query(fs.readFileSync(path.join(MIG, "20260909120000_tenant_id_not_null.sql"), "utf8"));
  } catch (e) {
    message = e.message;
    try {
      await c.query("ROLLBACK");
    } catch {}
  }
  check(
    /contacts/.test(message) && /NULL tenant_id/i.test(message),
    "it refuses, and says which table and how many rows",
    message.slice(0, 120),
  );

  await c.query("delete from contacts where tenant_id is null");
  await c.query(fs.readFileSync(path.join(MIG, "20260909120000_tenant_id_not_null.sql"), "utf8"));
  check((await nullability("contacts")) === "NO", "and applies cleanly once the orphans are gone");
}

console.log("");
console.log(
  failures === 0
    ? "OK - customer data cannot be written without an owner."
    : `FAIL - ${failures} problem(s).`,
);
await c.end();
await p.stop();
process.exit(failures === 0 ? 0 : 1);
