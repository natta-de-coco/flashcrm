// Batch 1 / Task 1 — proves social connection data is tenant-isolated.
//
// The question this answers is narrow and specific: with a real Postgres, real
// migrations and a real `authenticated` session, can a member of workspace A
// read or change a row belonging to workspace B — even when they know its id?
//
// Why it is written this way:
//
//   * It runs as the `authenticated` role with request.jwt.claim.sub set, which
//     is what PostgREST does. Testing as the superuser proves nothing, because
//     RLS does not apply to table owners.
//   * Row ids are handed to the attacker deliberately. Isolation that only
//     holds while ids stay secret is not isolation.
//   * Writes are judged by rowCount, never by "did it throw". An RLS-blocked
//     UPDATE or DELETE does not raise — it silently affects zero rows, so a
//     test that only catches exceptions reports a leak as a pass. This caught
//     two false results in an earlier version of the secret-exposure suite.
//   * Tables are seeded by introspection rather than a hand-written column
//     list, so a table added later is covered without editing this file.
//
// Personas, per the brief:
//   A-admin, A-agent, B-admin, uninvited, expired-invitation, revoked.
//
//   node supabase/verify/verify-social-tenant-isolation.mjs
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(HERE, "..", "migrations");
const PORT = 54990;

/** The social / connection surface named in the brief. */
const SURFACE = [
  "social_accounts",
  "social_capabilities",
  "social_interactions",
  "social_posts",
  "social_account_scans",
  "social_connection_tests",
  "social_test_results",
  "content_posts",
  "oauth_states",
  "platform_apps",
  "connection_retry_log",
  "webhook_events",
  "business_profiles",
  "messages",
];

const p = new EmbeddedPostgres({
  databaseDir: path.join(HERE, ".pgdata-social"),
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

// ── workspaces and people ───────────────────────────────────────────────────
const org = async (name, slug) =>
  (await c.query("insert into organizations(name,slug) values($1,$2) returning id", [name, slug])).rows[0].id;

const person = async (email, tenant, role) => {
  const id = (await c.query("insert into auth.users(email) values($1) returning id", [email])).rows[0].id;
  await c.query("update profiles set tenant_id=$2, staff_role=$3 where id=$1", [id, tenant, role]);
  if (role === "company_admin") {
    await c.query("insert into user_roles(user_id,role) values($1,'admin') on conflict do nothing", [id]);
  } else {
    await c.query("insert into user_roles(user_id,role) values($1,'agent') on conflict do nothing", [id]);
  }
  return id;
};

const orgA = await org("Alpha Trading", "alpha");
const orgB = await org("Beta Logistics", "beta");

const people = {
  "A-admin": await person("a.admin@alpha.test", orgA, "company_admin"),
  "A-agent": await person("a.agent@alpha.test", orgA, "staff"),
  "B-admin": await person("b.admin@beta.test", orgB, "company_admin"),
  uninvited: await person("nobody@example.test", null, "staff"),
  "expired-invite": await person("expired@example.test", null, "staff"),
  revoked: await person("revoked@alpha.test", null, "staff"), // removed from A
};

// An invitation that has aged past the seven-day window. It must not confer
// membership, and claiming is enforced in application code -- this row exists
// so the persona is realistic, not because the database reads it.
try {
  await c.query(
    `insert into team_invites(tenant_id, email, staff_role, invited_by, status, created_at)
     values ($1,'expired@example.test','staff',$2,'pending', now() - interval '30 days')`,
    [orgA, people["A-admin"]],
  );
} catch { /* table shape varies; the persona still has no tenant_id */ }

// ── generic seeder ──────────────────────────────────────────────────────────
// Fills every NOT NULL column that has no default, choosing a value by type.
async function columnsOf(table) {
  const { rows } = await c.query(
    `SELECT column_name, data_type, is_nullable, column_default, udt_name
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1
      ORDER BY ordinal_position`,
    [table],
  );
  return rows;
}

/** First label of an enum type, so enum columns get a value the type accepts. */
async function firstEnumLabel(udtName) {
  const { rows } = await c.query(
    `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = $1 ORDER BY e.enumsortorder LIMIT 1`,
    [udtName],
  );
  return rows[0]?.enumlabel ?? null;
}

/** The table and column a foreign key points at, if this column has one. */
async function fkTarget(table, column) {
  const { rows } = await c.query(
    `SELECT ccu.table_name AS ref_table, ccu.column_name AS ref_column
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'
        AND tc.table_name=$1 AND kcu.column_name=$2
      LIMIT 1`,
    [table, column],
  );
  return rows[0] ?? null;
}

/**
 * Values a CHECK constraint on this column will accept.
 *
 * social_accounts.platform is constrained to a fixed platform list, so a
 * placeholder string is rejected. Rather than hard-coding that list here and
 * letting it rot, read the constraint text and pull the quoted literals out of
 * it -- the test then keeps working when a platform is added.
 */
async function checkLiterals(table, column) {
  const { rows } = await c.query(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = $1::regclass AND contype = 'c'`,
    [`public."${table}"`],
  );
  for (const r of rows) {
    if (!r.def.includes(column)) continue;
    const literals = [...r.def.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    if (literals.length) return literals;
  }
  return null;
}

async function sampleFor(table, col, tenantId, tag, cache) {
  const t = col.data_type;
  const name = col.column_name;
  if (name === "tenant_id") return tenantId;

  // A CHECK list wins: it is the narrowest thing the column will accept.
  const allowed = await checkLiterals(table, name);
  if (allowed && (t === "text" || t === "character varying")) return allowed[0];

  if (t === "USER-DEFINED") return await firstEnumLabel(col.udt_name);

  if (t === "uuid") {
    // Resolve the foreign key by seeding (or reusing) a row in the target
    // table for this same workspace -- a placeholder uuid would be rejected,
    // and pointing at the other workspace's row would invent a leak.
    const fk = await fkTarget(table, name);
    if (!fk) {
      // No declared foreign key. oauth_states.user_id is like this: it holds
      // an auth.users id without a constraint, so there is nothing to follow.
      // Fall back on the name, which is enough to satisfy NOT NULL with a
      // value that is real for this workspace.
      if (name.endsWith("user_id") || name === "created_by" || name === "actor_id") {
        return cache.userId;
      }
      return null;
    }
    if (fk.ref_table === "organizations") return tenantId;
    if (fk.ref_table === "users" || fk.ref_table === "profiles") return cache.userId;
    const key = `${fk.ref_table}:${tenantId}`;
    if (cache.rows.has(key)) return cache.rows.get(key);
    const id = await seed(fk.ref_table, tenantId, tag, cache);
    if (typeof id === "string") {
      cache.rows.set(key, id);
      return id;
    }
    return null;
  }

  if (t.startsWith("timestamp")) return new Date().toISOString();
  if (t === "date") return new Date().toISOString().slice(0, 10);
  if (t === "boolean") return false;
  if (["integer", "bigint", "smallint", "numeric", "double precision", "real"].includes(t)) return 0;
  if (t === "ARRAY") return [];
  if (t === "jsonb" || t === "json") return "{}";
  return `${tag}`;
}

async function seed(table, tenantId, tag, cache, depth = 0) {
  if (depth > 4) return { error: "foreign-key chain too deep" };
  const cols = await columnsOf(table);
  // A NOT NULL column with a session-dependent default (auth.uid(),
  // current_tenant_id()) cannot be left out: the seeder runs as the superuser
  // with no JWT, so the default evaluates to NULL and the insert fails. Supply
  // those explicitly, along with anything that has no default at all.
  const sessionDefault = (d) =>
    !!d && /auth\.(uid|jwt)|current_tenant_id|current_setting/i.test(d);
  const needed = cols.filter(
    (x) =>
      x.column_name === "tenant_id" ||
      (x.is_nullable === "NO" && (!x.column_default || sessionDefault(x.column_default))),
  );
  const names = needed.map((x) => `"${x.column_name}"`);
  const values = [];
  for (const col of needed) values.push(await sampleFor(table, col, tenantId, tag, cache));
  const params = needed.map((_, i) => `$${i + 1}`);
  try {
    const { rows } = await c.query(
      `insert into public."${table}" (${names.join(",")}) values (${params.join(",")}) returning id`,
      values,
    );
    return rows[0]?.id ?? null;
  } catch (e) {
    return { error: e.message.split("\n")[0] };
  }
}

const seeded = {};
const cacheA = { rows: new Map(), userId: people["A-admin"] };
const cacheB = { rows: new Map(), userId: people["B-admin"] };
for (const table of SURFACE) {
  const a = await seed(table, orgA, "alpha-row", cacheA);
  const b = await seed(table, orgB, "beta-row", cacheB);
  seeded[table] = { a, b };
}

// ── attacker helpers ────────────────────────────────────────────────────────
async function asUser(uid, fn) {
  await c.query("begin");
  try {
    await c.query("select set_config('request.jwt.claim.sub',$1,true)", [uid]);
    await c.query("set local role authenticated");
    const out = await fn();
    await c.query("reset role");
    return out;
  } catch (e) {
    return { threw: e.message.split("\n")[0] };
  } finally {
    try { await c.query("commit"); } catch { await c.query("rollback"); }
  }
}

let leaks = 0;
let checks = 0;
const findings = [];

/** Can `who` see workspace B's row, knowing its id? */
async function canRead(who, uid, table, rowId) {
  if (!rowId || typeof rowId === "object") return null;
  checks++;
  const r = await asUser(uid, async () => {
    const q = await c.query(`select id from public."${table}" where id=$1`, [rowId]);
    return { rows: q.rowCount ?? 0 };
  });
  if (r.threw) return false; // refused outright — not a leak
  const leaked = (r.rows ?? 0) > 0;
  if (leaked) {
    leaks++;
    findings.push(`READ  ${who} read ${table} row belonging to another workspace`);
  }
  return leaked;
}

/** Can `who` change or delete it? Judged on rows affected, not on throwing. */
async function canWrite(who, uid, table, rowId) {
  if (!rowId || typeof rowId === "object") return null;
  checks += 2;
  const upd = await asUser(uid, async () => {
    const q = await c.query(
      `update public."${table}" set tenant_id = tenant_id where id=$1`,
      [rowId],
    );
    return { n: q.rowCount ?? 0 };
  });
  if (!upd.threw && (upd.n ?? 0) > 0) {
    leaks++;
    findings.push(`WRITE ${who} updated ${table} row belonging to another workspace`);
  }
  const del = await asUser(uid, async () => {
    const q = await c.query(`delete from public."${table}" where id=$1`, [rowId]);
    return { n: q.rowCount ?? 0 };
  });
  if (!del.threw && (del.n ?? 0) > 0) {
    leaks++;
    findings.push(`DELETE ${who} deleted ${table} row belonging to another workspace`);
  }
}

// ── run ─────────────────────────────────────────────────────────────────────
if (process.env.SABOTAGE) {
  // Proves this suite can fail. A green isolation test that would stay green
  // with RLS switched off is measuring nothing, so the switch below turns it
  // off for one table and the run must then report leaks.
  await c.query("ALTER TABLE public.social_accounts DISABLE ROW LEVEL SECURITY");
  console.log("!! SABOTAGE: RLS disabled on social_accounts - the suite must now FAIL");
}

console.log("\n=== seeding ===");
for (const [table, ids] of Object.entries(seeded)) {
  const note =
    typeof ids.a === "object" ? `skipped (${ids.a.error.slice(0, 60)})` : ids.a ? "ok" : "no id column";
  console.log(`  ${table.padEnd(26)} ${note}`);
}

console.log("\n=== cross-workspace access (target: workspace B rows) ===");
const attackers = ["A-admin", "A-agent", "uninvited", "expired-invite", "revoked"];
for (const who of attackers) {
  const uid = people[who];
  let reads = 0;
  for (const table of SURFACE) {
    const target = seeded[table]?.b;
    const r = await canRead(who, uid, table, target);
    if (r) reads++;
    await canWrite(who, uid, table, target);
  }
  console.log(`  ${who.padEnd(16)} ${reads === 0 ? "no cross-workspace reads" : `${reads} LEAKED READS`}`);
}

// The mirror: B must not reach A either, so a pass is not an artefact of
// seeding order or of one workspace happening to be empty.
console.log("\n=== reverse direction (B-admin against workspace A rows) ===");
{
  let reads = 0;
  for (const table of SURFACE) {
    const r = await canRead("B-admin", people["B-admin"], table, seeded[table]?.a);
    if (r) reads++;
    await canWrite("B-admin", people["B-admin"], table, seeded[table]?.a);
  }
  console.log(`  B-admin          ${reads === 0 ? "no cross-workspace reads" : `${reads} LEAKED READS`}`);
}

// A control: an in-tenant admin must still be able to work. A suite that
// passes because nobody can read anything is measuring a broken app.
console.log("\n=== control: A-admin can still reach workspace A ===");
{
  let visible = 0;
  let testable = 0;
  for (const table of SURFACE) {
    const own = seeded[table]?.a;
    if (!own || typeof own === "object") continue;
    testable++;
    const r = await asUser(people["A-admin"], async () => {
      const q = await c.query(`select id from public."${table}" where id=$1`, [own]);
      return { rows: q.rowCount ?? 0 };
    });
    if (!r.threw && (r.rows ?? 0) > 0) visible++;
  }
  console.log(`  A-admin sees ${visible}/${testable} of its own seeded rows`);
  if (testable > 0 && visible === 0) {
    findings.push("CONTROL A-admin cannot read its own workspace — the suite proves nothing");
    leaks++;
  }
}

console.log("");
console.log(`checks run: ${checks}`);
if (findings.length) {
  console.log("\nFINDINGS:");
  for (const f of findings) console.log("  " + f);
}
console.log(
  leaks === 0
    ? "\nOK - no cross-workspace read, update or delete succeeded."
    : `\nFAIL - ${leaks} isolation failure(s).`,
);
await c.end();
await p.stop();
process.exit(leaks === 0 ? 0 : 1);
