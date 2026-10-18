// The database requires the second sign-in step too: proof, in a real
// PostgreSQL, per role and per assurance level ("aal").
//
//   npm install --no-save --package-lock=false embedded-postgres@17.10.0-beta.17 pg@8.23.0
//   node supabase/verify/verify-mfa-session-gate.mjs
//
// WHAT IS BEING PROVED
// Migration 20261020000000_mfa_session_gate.sql puts a RESTRICTIVE policy
// (mfa_session_gate) on every table with row-level security in `public` and on
// storage.objects, and a guard line in list_subscribers(). A person whose token
// has not entered the code (aal1) but who HAS a verified authenticator-app
// factor must then reach nothing; everybody else must be exactly where they
// were. The two halves of that sentence are both checked, because a mistake in
// either one hurts: too loose leaves the gap open, too tight locks every
// two-factor user out of their data.
//
// HOW (each step runs the real SQL, nothing is read off the page):
//   1. Build the database: shim + Supabase's default privileges + every
//      migration BEFORE the gate. People, two companies, rows, a storage bucket.
//   2. Show the gap first: with the gate not yet applied, a password-only token
//      of a person with a verified factor reads the company's data.
//   3. Show the migration is safe to paste: it stops and changes NOTHING when the
//      rule cannot run (factor table missing; owner not allowed to read it) and
//      when it cannot get its locks in time.
//   4. Apply the migration. Then, for EVERY table found in the catalogue (the list
//      is never typed here) and for ten kinds of caller, try select, insert,
//      update and delete. To see the gate and nothing else, each table gets a
//      throwaway "let everyone in" policy inside a transaction that is rolled
//      back, so the only thing deciding is mfa_session_gate.
//   5. With the real policies and real rows: another company is still refused,
//      profile / role / organization / billing view / storage rows behave, the
//      functions the code prompt needs still answer, list_subscribers is guarded,
//      the service role is unaffected, the helper cannot be abused or swallow an
//      error, and it costs one call per statement, not one per row.
//   6. Run twice, kill switch, one-statement rollback (taken from the migration
//      file itself), a table added later is caught and covered.
//   7. Guards that fail a future pull request: a table without the policy, a
//      table without row-level security, a view that skips policies, and a
//      SECURITY DEFINER function the browser can call that nobody has classified.
//
// NOT PROVABLE HERE: Realtime delivery, Supabase's real grants on `auth`,
// PostgREST turning the Authorization header into claims. Those need a staging
// project.
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(HERE, "..", "migrations");
const PORT = 54975;
const MINE = "20261020000000_mfa_session_gate.sql";

const mineSql = fs.readFileSync(path.join(MIG, MINE), "utf8");
const mineText = mineSql.replace(/\r\n/g, "\n");
/** The SQL between <tag> and </tag> in the migration's own comments, uncommented. */
function snippet(tag) {
  const found = mineText.match(new RegExp(`^-- <${tag}>\\n([\\s\\S]*?)^-- </${tag}>`, "m"));
  if (!found) throw new Error(`${MINE} has no <${tag}> block`);
  return found[1]
    .split("\n")
    .map((line) => line.replace(/^-- ?/, ""))
    .join("\n");
}
const KILL_SWITCH = snippet("killswitch");
const ROLLBACK = snippet("rollback");

// ---------------------------------------------------------------------------
// Reporting

let failures = 0;
let checks = 0;
const check = (label, pass, detail) => {
  checks++;
  if (!pass) failures++;
  console.log(`  ${pass ? "OK  " : "FAIL"}  ${label}${detail ? "  -> " + detail : ""}`);
};
const heading = (text) => console.log(`\n=== ${text} ===`);

// ---------------------------------------------------------------------------
// The throwaway database

const DATA = path.join(HERE, ".pgdata-mfa-gate");
fs.rmSync(DATA, { recursive: true, force: true }); // a run that crashed leaves its directory behind
const server = new EmbeddedPostgres({
  databaseDir: DATA,
  user: "postgres",
  password: "postgres",
  port: PORT,
  persistent: false,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  // Every refused statement below is expected and checked in this script; the
  // server's own log of them would bury the results.
  postgresFlags: ["-c", "log_min_messages=log"],
});
await server.initialise();
await server.start();
const connect = async (user = "postgres", password = "postgres") => {
  const client = new pg.Client({
    host: "localhost",
    port: PORT,
    user,
    password,
    database: "postgres",
  });
  await client.connect();
  await client.query("SET search_path TO public, extensions");
  return client;
};
const c = await connect();

// If the script itself breaks, still stop the database and say so: a run that
// crashes must neither leave a server behind nor look like a pass.
const crash = async (error) => {
  console.log(`FAIL  the script itself stopped: ${error?.stack ?? error}`);
  await c.end().catch(() => {});
  await server.stop().catch(() => {});
  process.exit(1);
};
process.on("uncaughtException", crash);
process.on("unhandledRejection", crash);

async function finish() {
  await c.end().catch(() => {});
  await server.stop().catch(() => {});
  console.log("");
  console.log(
    failures === 0
      ? `OK - the second sign-in step is enforced by the database (${checks} checks).`
      : `FAIL - ${failures} of ${checks} checks failed.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

await c.query(fs.readFileSync(path.join(HERE, "supabase-shim.sql"), "utf8"));
// Supabase gives its three API roles everything on whatever the postgres role
// creates in `public`, so what a person may reach is decided by policies alone.
// The shim does not, so say it here: the proof then holds for the worst case.
await c.query(`
  GRANT ALL ON ALL TABLES IN SCHEMA storage TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
`);

const files = fs
  .readdirSync(MIG)
  .filter((f) => f.endsWith(".sql"))
  .sort();
if (!files.includes(MINE)) {
  console.log(`FAIL  ${MINE} is not in ${MIG}`);
  process.exit(1);
}
const before = files.filter((f) => f < MINE);
const after = files.filter((f) => f > MINE);

/** Runs a file the way the harness always has; returns the error or null. A failed file leaves its transaction open, so end it. */
async function apply(client, sql) {
  try {
    return { results: await client.query(sql), error: null };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    return { results: null, error };
  }
}

heading("the database before the gate");
const brokenBefore = [];
for (const f of before) {
  const { error } = await apply(c, fs.readFileSync(path.join(MIG, f), "utf8"));
  if (error) brokenBefore.push(`${f}: ${error.message}`);
}
check(
  `${before.length} earlier migrations apply clean`,
  brokenBefore.length === 0,
  brokenBefore.join("; "),
);

// ---------------------------------------------------------------------------
// People, companies, rows

const one = async (sql, params) => (await c.query(sql, params)).rows[0];
const orgA = (await one("insert into organizations(name,slug) values('Acme','acme') returning id"))
  .id;
const orgB = (
  await one("insert into organizations(name,slug) values('Globex','globex') returning id")
).id;

/** factors: [{ type: 'totp' | 'phone' | 'webauthn', status: 'verified' | 'unverified' }] */
async function person(email, org, { staffRole = "staff", admin = false, factors = [] } = {}) {
  const id = (await one("insert into auth.users(email) values($1) returning id", [email])).id;
  await c.query("update profiles set tenant_id=$2, staff_role=$3 where id=$1", [
    id,
    org,
    staffRole,
  ]);
  if (admin)
    await c.query(
      "insert into user_roles(user_id,role) values($1,'admin') on conflict do nothing",
      [id],
    );
  for (const f of factors)
    await c.query(
      "insert into auth.mfa_factors(user_id,factor_type,status) values($1,$2::auth.factor_type,$3::auth.factor_status)",
      [id, f.type, f.status],
    );
  return { id, email, org };
}
const TOTP = { type: "totp", status: "verified" };
const alice = await person("alice@acme.test", orgA, {
  staffRole: "company_admin",
  admin: true,
  factors: [TOTP],
});
const bob = await person("bob@acme.test", orgA); // no factor at all
const carol = await person("carol@acme.test", orgA, {
  factors: [{ type: "totp", status: "unverified" }],
});
const dave = await person("dave@acme.test", orgA, {
  factors: [{ type: "phone", status: "verified" }],
});
const erin = await person("erin@acme.test", orgA, {
  factors: [TOTP, { type: "phone", status: "verified" }],
});
const frank = await person("frank@globex.test", orgB, { staffRole: "company_admin", admin: true });
const gina = await person("gina@globex.test", orgB, { factors: [TOTP] });
const sam = await person("sam@flas.test", orgA, {
  staffRole: "super_admin",
  admin: true,
  factors: [TOTP],
});
const sue = await person("sue@flas.test", orgA, { staffRole: "super_admin", admin: true });

const contactIds = {};
for (const [org, names] of [
  [orgA, ["A contact 1", "A contact 2"]],
  [orgB, ["B contact 1"]],
])
  for (const name of names)
    contactIds[name] = (
      await one("insert into contacts(name,tenant_id) values($1,$2) returning id", [name, org])
    ).id;
for (const [org, title] of [
  [orgA, "Acme alert"],
  [orgB, "Globex alert"],
])
  await c.query("insert into system_alerts(title,severity,tenant_id) values($1,'warning',$2)", [
    title,
    org,
  ]);
for (const [org, name] of [
  [orgA, "A contact 1"],
  [orgB, "B contact 1"],
]) {
  const conv = (
    await one("insert into conversations(contact_id,tenant_id) values($1,$2) returning id", [
      contactIds[name],
      org,
    ])
  ).id;
  await c.query(
    "insert into messages(conversation_id,direction,sender,body,tenant_id) values($1,'inbound','contact','hello',$2)",
    [conv, org],
  );
}
await c.query("insert into storage.buckets(id,name) values('invoices','invoices')");
for (const org of [orgA, orgB])
  await c.query("insert into storage.objects(bucket_id,name) values('invoices',$1)", [
    `${org}/invoice.pdf`,
  ]);

// ---------------------------------------------------------------------------
// Acting as somebody

const ident = (sub, aal, extra = {}) =>
  JSON.stringify({
    role: "authenticated",
    ...(sub ? { sub } : {}),
    ...(aal ? { aal } : {}),
    ...extra,
  });
/** Browser-role callers. aal: "aal1" | "aal2" | "aal3" | undefined (a token that says nothing). */
const AT = (user, aal) => ({ role: "authenticated", sub: user.id, claims: ident(user.id, aal) });
const NOBODY = (aal) => ({ role: "authenticated", sub: "", claims: ident(null, aal) });
const SERVICE = { role: "service_role", sub: "", claims: JSON.stringify({ role: "service_role" }) };
const ANON = { role: "anon", sub: "", claims: JSON.stringify({ role: "anon" }) };

/** Both claim settings, because the shim's auth.uid() reads one and auth.jwt() the other. */
const becomeSql = (who) =>
  `select set_config('request.jwt.claim.sub', ${c.escapeLiteral(who.sub)}, true), ` +
  `set_config('request.jwt.claims', ${c.escapeLiteral(who.claims)}, true); ` +
  `set local role ${who.role}`;

/** One statement that may fail: success or { code, message }, and the transaction survives either way. */
async function attempt(sql, params) {
  await c.query("savepoint attempt_point");
  try {
    const r = await c.query(sql, params);
    await c.query("release attempt_point");
    return { ok: true, rows: r.rows, rowCount: r.rowCount };
  } catch (e) {
    await c.query("rollback to attempt_point");
    await c.query("release attempt_point");
    return { ok: false, code: e.code, message: e.message };
  }
}
/** Runs fn(run) as somebody inside a transaction that is always rolled back. */
async function as(who, fn, { beforeBecoming = [] } = {}) {
  await c.query("begin");
  try {
    for (const sql of beforeBecoming) await c.query(sql);
    await c.query(becomeSql(who));
    return await fn(attempt);
  } finally {
    await c.query("rollback");
  }
}
const countOf = async (who, table) =>
  as(who, async (run) => {
    const r = await run(`select count(*)::int as n from ${table}`);
    return r.ok ? r.rows[0].n : `error ${r.code}: ${r.message}`;
  });
const refusedByPolicy = (r) => !r.ok && r.code === "42501" && /row-level security/i.test(r.message);

const AAL1 = "aal1";
const AAL2 = "aal2";

// ---------------------------------------------------------------------------
heading("the gap, before the migration");
for (const [label, who] of [
  ["a person WITH a verified factor, password only (aal1)", AT(alice, AAL1)],
  ["the same person, token with no aal claim", AT(alice, undefined)],
]) {
  const n = await countOf(who, "contacts");
  check(`${label}, reads their company's contacts`, n === 2, `${n} row(s): this is the gap`);
}
const gapWrite = await as(AT(alice, AAL1), (run) =>
  run("delete from contacts where name = 'A contact 2'"),
);
check("...and could delete them (rolled back here)", gapWrite.ok && gapWrite.rowCount === 1);

// ---------------------------------------------------------------------------
// The tables, from the catalogue

const listProtected = async () =>
  (
    await c.query(`
      select n.nspname as schema, c.relname as name
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where c.relkind in ('r','p') and c.relrowsecurity
         and (n.nspname = 'public' or (n.nspname = 'storage' and c.relname = 'objects'))
       order by 1, 2`)
  ).rows;
const qname = (t) => `"${t.schema}"."${t.name}"`;

/** Everything about a table the matrix needs to put one row in it and try the four verbs. */
async function describe(t) {
  const cols = (
    await c.query(
      `select a.attname as name, format_type(a.atttypid, a.atttypmod) as type, ty.typname, ty.typtype,
              a.attnotnull as notnull, a.attgenerated as generated, a.attidentity as identity,
              exists (select 1 from pg_index i where i.indrelid = a.attrelid and i.indisprimary
                         and a.attnum = any (i.indkey)) as in_pk
         from pg_attribute a join pg_type ty on ty.oid = a.atttypid
        where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped
        order by a.attnum`,
      [qname(t)],
    )
  ).rows;
  const checkNames = (
    await c.query(
      "select conname from pg_constraint where conrelid = $1::regclass and contype = 'c'",
      [qname(t)],
    )
  ).rows.map((r) => r.conname);
  return { cols, checkNames };
}
const ident_ = (s) => `"${s.replace(/"/g, '""')}"`;
/** A value for a primary-key column; `seed` tells two rows apart. */
function dummy(col, seed) {
  if (col.typtype === "e")
    return `(select enumlabel from pg_enum where enumtypid = ${c.escapeLiteral(col.type)}::regtype order by enumsortorder limit 1)`;
  switch (col.typname) {
    case "uuid":
      return "gen_random_uuid()";
    case "text":
    case "varchar":
    case "bpchar":
    case "citext":
      return `'pk-${seed}'`;
    case "int2":
    case "int4":
    case "int8":
    case "numeric":
      return String(seed);
    case "bool":
      return seed === 1 ? "true" : "false";
    case "date":
      return `current_date + ${seed}`;
    case "timestamp":
    case "timestamptz":
      return `now() + interval '${seed} day'`;
    default:
      throw new Error(
        `the matrix has no sample value for ${col.name} (${col.type}); add one in dummy()`,
      );
  }
}
const insertSql = (t, d, seed) => {
  const pk = d.cols.filter((col) => col.in_pk && col.identity !== "a" && col.generated === "");
  return pk.length
    ? `insert into ${qname(t)} (${pk.map((col) => ident_(col.name)).join(", ")}) values (${pk.map((col) => dummy(col, seed)).join(", ")})`
    : `insert into ${qname(t)} default values`;
};

/**
 * Who may do what to a table. Each caller tries select, insert, update and delete
 * on a table that holds one sample row and a throwaway permissive policy that
 * lets any browser caller in, so the only thing deciding is mfa_session_gate.
 *   expect "blocked": nothing is visible, writes are refused or touch no row.
 *   expect "open":    everything the sample policy allows goes through.
 */
function scenarios() {
  return [
    ["verified app, no code (aal1)", AT(alice, AAL1), "blocked"],
    ["verified app, token without an aal claim", AT(alice, undefined), "blocked"],
    ["verified app, aal3 (not aal2)", AT(alice, "aal3"), "blocked"],
    ["verified app AND verified phone, aal1", AT(erin, AAL1), "blocked"],
    ["no identity at all (no sub), aal1", NOBODY(AAL1), "blocked"],
    ["no identity at all, but an aal2 claim", NOBODY(AAL2), "blocked"],
    ["verified app, code entered (aal2)", AT(alice, AAL2), "open"],
    ["no factor, aal1", AT(bob, AAL1), "open"],
    ["only an unverified app, aal1", AT(carol, AAL1), "open"],
    ["only a verified phone, aal1", AT(dave, AAL1), "open"],
    ["service role", SERVICE, "open"],
  ];
}

/**
 * Tries the four verbs for every caller on one table. Returns one line per
 * caller and verb that did not behave: [] means all as expected.
 * Everything here is undone: one transaction, rolled back.
 */
async function probe(t, list, { blockedOnly = false } = {}) {
  const d = await describe(t);
  const wrong = [];
  let clean = 0;
  let passedPolicyThenFailed = 0;
  await c.query("begin");
  try {
    await c.query("set local session_replication_role = replica"); // no triggers, no foreign-key checks
    for (const col of d.cols)
      if (col.notnull && !col.in_pk && col.identity === "" && col.generated === "")
        await c.query(`alter table ${qname(t)} alter column ${ident_(col.name)} drop not null`);
    for (const name of d.checkNames)
      await c.query(`alter table ${qname(t)} drop constraint ${ident_(name)}`);
    await c.query(`grant all on ${qname(t)} to authenticated, service_role`);
    await c.query(
      `create policy zz_probe on ${qname(t)} as permissive for all to authenticated using (true) with check (true)`,
    );
    // Some tables already hold their one fixed row (the migrations insert it), so a clash is fine.
    await c.query(`${insertSql(t, d, 1)} on conflict do nothing`);
    const total = (await c.query(`select count(*)::int as n from ${qname(t)}`)).rows[0].n;
    const settable = d.cols.find((col) => col.generated === "" && col.identity !== "a");
    for (const [label, who, expect] of list) {
      if (blockedOnly && expect !== "blocked") continue;
      const verbs = {
        select: `select count(*)::int as n from ${qname(t)}`,
        insert: insertSql(t, d, 2),
        update: settable
          ? `update ${qname(t)} set ${ident_(settable.name)} = ${ident_(settable.name)}`
          : null,
        delete: `delete from ${qname(t)}`,
      };
      for (const [verb, sql] of Object.entries(verbs)) {
        if (!sql) continue;
        await c.query("savepoint verb");
        await c.query(becomeSql(who));
        let outcome;
        try {
          const r = await c.query(sql);
          outcome = { ok: true, rowCount: r.rowCount, n: verb === "select" ? r.rows[0].n : null };
        } catch (e) {
          outcome = { ok: false, code: e.code, message: e.message };
        }
        await c.query("rollback to verb");
        await c.query("release verb");

        let behaved;
        if (verb === "select")
          behaved = outcome.ok && (expect === "blocked" ? outcome.n === 0 : outcome.n === total);
        else if (verb === "insert") {
          behaved =
            expect === "blocked"
              ? refusedByPolicy(outcome)
              : outcome.ok || !refusedByPolicy(outcome);
          if (expect === "open" && behaved) outcome.ok ? clean++ : passedPolicyThenFailed++;
        } else
          behaved =
            outcome.ok &&
            (expect === "blocked" ? outcome.rowCount === 0 : outcome.rowCount === total);
        if (!behaved)
          wrong.push(
            `${qname(t)} / ${label} / ${verb}: ` +
              (outcome.ok
                ? `ok rows=${outcome.n ?? outcome.rowCount} (total ${total})`
                : `${outcome.code} ${outcome.message}`),
          );
      }
    }
  } finally {
    await c.query("rollback");
  }
  return { wrong, clean, passedPolicyThenFailed };
}

async function matrix(tables, list, options) {
  const wrong = [];
  let clean = 0;
  let late = 0;
  for (const t of tables) {
    const r = await probe(t, list, options);
    wrong.push(...r.wrong);
    clean += r.clean;
    late += r.passedPolicyThenFailed;
  }
  return { wrong, clean, late };
}

const tablesBefore = await listProtected();
heading(`before the migration: the same probe reaches all ${tablesBefore.length} tables at aal1`);
{
  const open = scenarios().map(([label, who]) => [label, who, "open"]);
  const r = await matrix(
    tablesBefore,
    open.filter(([label]) => /^verified app, no code|AND verified phone/.test(label)),
  );
  check(
    `a person with a verified factor and no code can select, insert, update and delete on all ${tablesBefore.length} tables (the probe is sound)`,
    r.wrong.length === 0,
    r.wrong.slice(0, 3).join(" | "),
  );
}

// ---------------------------------------------------------------------------
heading("the migration stops and changes nothing when it cannot do its job");
const snapshot = async () =>
  JSON.stringify(
    (
      await c.query(`
        select
          (select count(*) from pg_policies where policyname = 'mfa_session_gate')::int as gate_policies,
          (select count(*) from pg_proc where proname in ('session_meets_mfa','apply_mfa_session_gate')
              and pronamespace = 'public'::regnamespace)::int as functions,
          (select md5(pg_get_functiondef('public.list_subscribers()'::regprocedure))) as list_subscribers`)
    ).rows[0],
  );
const untouched = await snapshot();
check(
  "nothing is installed yet",
  JSON.parse(untouched).gate_policies === 0 && JSON.parse(untouched).functions === 0,
);

{
  // (a) the factor table is not there
  await c.query("alter table auth.mfa_factors rename to mfa_factors_hidden");
  const r = await apply(c, mineSql);
  await c.query("alter table auth.mfa_factors_hidden rename to mfa_factors");
  check(
    "factor table missing: the file fails, naming the table",
    r.error && /mfa_factors/.test(r.error.message),
    r.error ? r.error.message : "it did NOT fail",
  );
  check("...and nothing was installed", (await snapshot()) === untouched);
}
{
  // (b) the owner of the file is not allowed to read the factor table
  await c.query("create role migrator login password 'migrator'");
  await c.query("grant create, usage on schema public to migrator");
  await c.query("grant usage on schema auth, extensions to migrator");
  const m = await connect("migrator", "migrator");
  const r = await apply(m, mineSql);
  await m.end();
  await c.query("drop owned by migrator");
  await c.query("drop role migrator");
  check(
    "owner may not read the factor table: the file fails before creating a policy",
    r.error && /permission denied for table mfa_factors/.test(r.error.message),
    r.error ? r.error.message : "it did NOT fail",
  );
  check("...and nothing was installed", (await snapshot()) === untouched);
}
{
  // (c) another session holds a lock the file needs, for longer than 10 seconds
  const holder = await connect();
  await holder.query("begin");
  await holder.query("lock table storage.objects in access share mode");
  const started = Date.now();
  const r = await apply(c, mineSql);
  const waited = (Date.now() - started) / 1000;
  await holder.query("rollback");
  await holder.end();
  check(
    "a lock held elsewhere: the file gives up after about 10 seconds",
    r.error?.code === "55P03" && waited >= 9 && waited < 25,
    r.error ? `${r.error.code} after ${waited.toFixed(1)}s` : "it did NOT fail",
  );
  check(
    "...having created gates on every earlier table first, all undone",
    (await snapshot()) === untouched,
  );
}

// ---------------------------------------------------------------------------
heading("applying the migration");
const first = await apply(c, mineSql);
check("the migration applies", first.error === null, first.error?.message);
const verification = first.results?.[first.results.length - 1]?.rows?.[0];
const protectedNow = await listProtected();
const publicCount = protectedNow.filter((t) => t.schema === "public").length;
check(
  "its own closing query reports every table gated and none missing",
  verification &&
    Number(verification.rls_tables) === publicCount &&
    Number(verification.gated) === publicCount + 1 &&
    Number(verification.missing) === 0,
  JSON.stringify(verification),
);
console.log(`  (${publicCount} tables with row-level security in public, plus storage.objects)`);

heading("the policy itself, on every table from the catalogue");
// Postgres prints the policy's `(SELECT public.session_meets_mfa())` back as a sub-select.
const ONCE_PER_STATEMENT = /\(\s*SELECT\s+(public\.)?session_meets_mfa\(\)/i;
{
  const rows = (
    await c.query(`
      select n.nspname as schema, c.relname as name, p.polpermissive as permissive, p.polcmd as cmd,
             (select array_agg(r.rolname::text order by r.rolname) from pg_roles r where r.oid = any (p.polroles)) as roles,
             pg_get_expr(p.polqual, p.polrelid) as using_sql, pg_get_expr(p.polwithcheck, p.polrelid) as check_sql
        from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
       where p.polname = 'mfa_session_gate'
       order by 1, 2`)
  ).rows;
  const names = new Set(rows.map((r) => `${r.schema}.${r.name}`));
  const wanted = protectedNow.map((t) => `${t.schema}.${t.name}`);
  check(
    `exactly one policy per table: ${rows.length} policies for ${wanted.length} tables`,
    rows.length === wanted.length &&
      wanted.every((w) => names.has(w)) &&
      names.size === rows.length,
    wanted.filter((w) => !names.has(w)).join(", "),
  );
  check(
    "every one is RESTRICTIVE",
    rows.every((r) => r.permissive === false),
  );
  check(
    "every one covers all commands (select, insert, update, delete)",
    rows.every((r) => r.cmd === "*"),
  );
  check(
    "every one is for the browser role only (anon and service_role are not touched)",
    rows.every((r) => r.roles.length === 1 && r.roles[0] === "authenticated"),
  );
  check(
    "every one asks the helper for reading AND for writing, once per statement",
    rows.every(
      (r) =>
        ONCE_PER_STATEMENT.test(r.using_sql ?? "") && ONCE_PER_STATEMENT.test(r.check_sql ?? ""),
    ),
    rows.find((r) => !ONCE_PER_STATEMENT.test(r.using_sql ?? ""))?.using_sql,
  );
}

heading("the helper");
{
  const fn = (
    await c.query(
      `select p.prosrc, p.prosecdef, p.provolatile, p.proconfig,
              has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
              has_function_privilege('service_role', p.oid, 'EXECUTE') as svc,
              has_function_privilege('public', p.oid, 'EXECUTE') as pub
         from pg_proc p where p.proname = 'session_meets_mfa' and p.pronamespace = 'public'::regnamespace`,
    )
  ).rows[0];
  check(
    "SECURITY DEFINER with an empty search_path",
    fn.prosecdef && (fn.proconfig ?? []).some((x) => /^search_path=("")?$/.test(x)),
    JSON.stringify(fn.proconfig),
  );
  check("STABLE (so a policy may evaluate it once per statement)", fn.provolatile === "s");
  check("swallows no error: its body has no EXCEPTION handler", !/exception/i.test(fn.prosrc));
  check("callable by the browser role and the service role", fn.auth && fn.svc);
  check("not callable by anon or by everybody", !fn.anon && !fn.pub);
  const apply_ = (
    await c.query(
      `select has_function_privilege('anon', p.oid, 'EXECUTE') as anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
              has_function_privilege('service_role', p.oid, 'EXECUTE') as svc, has_function_privilege('public', p.oid, 'EXECUTE') as pub,
              has_function_privilege('postgres', p.oid, 'EXECUTE') as owner
         from pg_proc p where p.proname = 'apply_mfa_session_gate' and p.pronamespace = 'public'::regnamespace`,
    )
  ).rows[0];
  check(
    "apply_mfa_session_gate() is callable by the owner and by nobody else",
    apply_.owner && !apply_.anon && !apply_.auth && !apply_.svc && !apply_.pub,
    JSON.stringify(apply_),
  );
  for (const [label, who] of [
    ["anon", ANON],
    ["a signed-in person", AT(alice, AAL2)],
    ["the service role", SERVICE],
  ]) {
    const r = await as(who, (run) => run("select public.apply_mfa_session_gate()"));
    check(
      `${label} cannot run apply_mfa_session_gate()`,
      !r.ok && r.code === "42501",
      r.ok ? "it ran" : r.code,
    );
  }
  const anonCall = await as(ANON, (run) => run("select public.session_meets_mfa()"));
  check("anon cannot call the helper", !anonCall.ok && anonCall.code === "42501");
}

heading("what the helper answers (the rule, case by case)");
const mfaAnswer = async (who) => {
  const r = await as(who, (run) => run("select public.session_meets_mfa() as ok"));
  return r.ok ? r.rows[0].ok : `error ${r.code}`;
};
for (const [label, who, want] of [
  ["verified app, aal1", AT(alice, AAL1), false],
  ["verified app, aal2", AT(alice, AAL2), true],
  ["verified app, no aal claim", AT(alice, undefined), false],
  ["verified app, aal3", AT(alice, "aal3"), false],
  ["verified app, claim of another shape (AAL2 upper case)", AT(alice, "AAL2"), false],
  ["verified app AND verified phone, aal1", AT(erin, AAL1), false],
  ["no factor, aal1", AT(bob, AAL1), true],
  ["no factor, no aal claim", AT(bob, undefined), true],
  ["only an unverified app, aal1", AT(carol, AAL1), true],
  [
    "only a verified phone, aal1 (the app cannot ask for a phone code, so it must not lock out)",
    AT(dave, AAL1),
    true,
  ],
  ["no identity (no sub), aal1", NOBODY(AAL1), false],
  ["no identity (no sub), aal2", NOBODY(AAL2), false],
])
  check(`${label} -> ${want}`, (await mfaAnswer(who)) === want, String(await mfaAnswer(who)));

heading("every table, every kind of caller, every verb (generated from the catalogue)");
const list = scenarios();
const full = await matrix(protectedNow, list);
check(
  `${protectedNow.length} tables x ${list.length} callers x 4 verbs: ${protectedNow.length * list.length * 4} cases behave as expected`,
  full.wrong.length === 0,
  full.wrong.slice(0, 5).join(" | "),
);
console.log(
  `  (writes that were let through by the gate: ${full.clean} inserts succeeded; ${full.late} stopped at a table constraint AFTER the policy had let them through)`,
);
for (const w of full.wrong.slice(0, 40)) console.log("    " + w);

// ---------------------------------------------------------------------------
heading("real policies, real rows: nothing else changed");
for (const [label, who, table, want] of [
  ["Acme admin, verified app, aal1", AT(alice, AAL1), "contacts", 0],
  ["Acme admin, verified app, aal2", AT(alice, AAL2), "contacts", 2],
  ["Acme staff, no factor, aal1", AT(bob, AAL1), "contacts", 2],
  ["Acme staff with an unverified app, aal1", AT(carol, AAL1), "contacts", 2],
  ["Acme staff with a verified phone only, aal1", AT(dave, AAL1), "contacts", 2],
  ["Globex staff, verified app, aal2", AT(gina, AAL2), "contacts", 1],
  ["Globex staff, verified app, aal1", AT(gina, AAL1), "contacts", 0],
  ["Acme admin, aal2", AT(alice, AAL2), "messages", 1],
  ["Acme admin, aal1", AT(alice, AAL1), "messages", 0],
  ["Acme admin, aal2", AT(alice, AAL2), "conversations", 1],
  ["Acme admin, aal1", AT(alice, AAL1), "conversations", 0],
  ["Acme admin, aal2", AT(alice, AAL2), "system_alerts", 1],
  ["Acme admin, aal1", AT(alice, AAL1), "system_alerts", 0],
]) {
  const n = await countOf(who, table);
  check(`${label}: ${table} -> ${want}`, n === want, String(n));
}
{
  // Another company stays out, at every level, with every kind of factor.
  for (const [label, who] of [
    ["Acme admin, aal2", AT(alice, AAL2)],
    ["Acme staff, no factor", AT(bob, AAL1)],
  ]) {
    const n = (
      await as(who, (run) => run("select count(*)::int as n from contacts where name like 'B %'"))
    ).rows[0].n;
    check(`${label} still sees 0 of Globex's contacts`, n === 0, String(n));
  }
  const write = await as(AT(alice, AAL2), (run) =>
    run("update contacts set name = 'hacked' where name = 'B contact 1'"),
  );
  check(
    "Acme admin at aal2 still cannot change a Globex contact",
    write.ok && write.rowCount === 0,
  );
}
{
  // Writes at aal1 with a verified factor.
  const w = await as(AT(alice, AAL1), async (run) => ({
    insert: await run("insert into contacts(name) values('planted')"),
    update: await run("update contacts set name = 'changed' where name = 'A contact 1'"),
    remove: await run("delete from contacts"),
  }));
  check(
    "password-only token of a two-factor person: insert is refused by the policy",
    refusedByPolicy(w.insert),
    w.insert.message,
  );
  check("...update changes no row", w.update.ok && w.update.rowCount === 0);
  check("...delete removes no row", w.remove.ok && w.remove.rowCount === 0);
  const left = (await c.query("select count(*)::int as n from contacts")).rows[0].n;
  check("...and all 3 contacts are still there", left === 3, String(left));
  const ok = await as(AT(alice, AAL2), (run) =>
    run("insert into contacts(name) values('allowed')"),
  );
  check("the same person with the code can write", ok.ok && ok.rowCount === 1);
}
{
  const own = (who, sql) => as(who, async (run) => (await run(sql)).rows?.length ?? -1);
  check(
    "own profile row: hidden at aal1 with a verified factor",
    (await own(AT(alice, AAL1), `select 1 from profiles where id = '${alice.id}'`)) === 0,
  );
  check(
    "own profile row: visible at aal2",
    (await own(AT(alice, AAL2), `select 1 from profiles where id = '${alice.id}'`)) === 1,
  );
  check(
    "own profile row: visible without a factor at aal1",
    (await own(AT(bob, AAL1), `select 1 from profiles where id = '${bob.id}'`)) === 1,
  );
  check(
    "own role row (user_roles): hidden at aal1 with a verified factor",
    (await own(AT(alice, AAL1), `select 1 from user_roles where user_id = '${alice.id}'`)) === 0,
  );
  check(
    "own role row (user_roles): visible at aal2",
    (await own(AT(alice, AAL2), `select 1 from user_roles where user_id = '${alice.id}'`)) >= 1,
  );
  check(
    "own company (organizations): hidden at aal1 with a verified factor",
    (await own(AT(alice, AAL1), "select 1 from organizations")) === 0,
  );
  check(
    "own company (organizations): exactly one at aal2",
    (await own(AT(alice, AAL2), "select 1 from organizations")) === 1,
  );
  check(
    "view company_billing_overview: hidden at aal1 with a verified factor",
    (await own(AT(alice, AAL1), "select 1 from company_billing_overview")) === 0,
  );
  check(
    "view company_billing_overview: own company only at aal2",
    (await own(AT(alice, AAL2), "select 1 from company_billing_overview")) === 1,
  );
  check(
    "view company_billing_overview: own company only without a factor",
    (await own(AT(bob, AAL1), "select 1 from company_billing_overview")) === 1,
  );
  check(
    "platform staff with a verified factor at aal1 see no company",
    (await own(AT(sam, AAL1), "select 1 from organizations")) === 0,
  );
  check(
    "platform staff with a verified factor at aal2 see every company",
    (await own(AT(sam, AAL2), "select 1 from organizations")) === 2,
  );
  check(
    "platform staff without a factor see every company at aal1",
    (await own(AT(sue, AAL1), "select 1 from organizations")) === 2,
  );
}
{
  const objects = (who) =>
    as(who, async (run) => {
      const r = await run(
        "select name from storage.objects where bucket_id = 'invoices' order by name",
      );
      return r.ok ? r.rows.map((x) => x.name) : null; // null: the read itself failed
    });
  const howMany = (names) => (names === null ? "the read failed" : names.length);
  check(
    "storage: invoice file hidden at aal1 with a verified factor",
    howMany(await objects(AT(alice, AAL1))) === 0,
  );
  const seen = await objects(AT(alice, AAL2));
  check(
    "storage: own company's invoice file only, at aal2",
    seen?.length === 1 && seen[0].startsWith(orgA),
    String(seen),
  );
  check("storage: visible without a factor at aal1", howMany(await objects(AT(bob, AAL1))) === 1);
  check(
    "storage: platform staff with a factor see all at aal2",
    howMany(await objects(AT(sam, AAL2))) === 2,
  );
  check("storage: ...and none at aal1", howMany(await objects(AT(sam, AAL1))) === 0);
  check(
    "storage: another company's invoice file is not visible to Acme at aal2",
    !(seen ?? []).some((n) => n.startsWith(orgB)),
  );
}

heading("what must stay reachable at aal1 for the code prompt and the layout");
{
  const call = (who, sql) => as(who, (run) => run(sql));
  const t = await call(AT(alice, AAL1), "select public.current_tenant_id() as v");
  check(
    "current_tenant_id() answers for a verified-factor person at aal1",
    t.ok && t.rows[0].v === orgA,
    t.ok ? "" : t.message,
  );
  const my = await call(AT(alice, AAL1), "select public.my_tenant_id() as v");
  check("my_tenant_id() answers", my.ok && my.rows[0].v === orgA, my.ok ? "" : my.message);
  const st = await call(AT(alice, AAL1), `select public.access_state('${alice.id}') as v`);
  check("access_state() answers", st.ok && st.rows[0].v === "ok", st.ok ? "" : st.message);
  const flags = await call(
    AT(alice, AAL1),
    "select public.am_i_super_admin() as a, public.am_i_tenant_admin() as b, public.is_tenant_admin('" +
      alice.id +
      "') as c",
  );
  check(
    "am_i_super_admin() / am_i_tenant_admin() / is_tenant_admin() answer",
    flags.ok,
    flags.ok ? "" : flags.message,
  );
  const factors = await call(AT(alice, AAL2), "select count(*) from auth.mfa_factors");
  check(
    "the browser role cannot read auth.mfa_factors (so the helper has to be a definer)",
    !factors.ok && factors.code === "42501",
    factors.ok ? "it can" : factors.code,
  );
  const anonRows = await call(ANON, "select count(*)::int as n from contacts");
  check(
    "anon is still refused (no policy lets it in)",
    (anonRows.ok && anonRows.rows[0].n === 0) || (!anonRows.ok && anonRows.code === "42501"),
  );
}

heading("list_subscribers(): a definer function skips policies, so it asks the rule itself");
{
  const probeRows = (who) =>
    as(who, (run) => run("select count(*)::int as n from public.list_subscribers()"));
  const s1 = await probeRows(AT(sam, AAL1));
  check(
    "platform admin with a verified factor, aal1: refused",
    !s1.ok && s1.code === "42501" && /Two-factor/.test(s1.message),
    s1.ok ? "it answered" : `${s1.code} ${s1.message}`,
  );
  const s2 = await probeRows(AT(sam, AAL2));
  check(
    "...with the code (aal2): answers, both companies",
    s2.ok && s2.rows[0].n === 2,
    s2.ok ? String(s2.rows[0].n) : s2.message,
  );
  const s3 = await probeRows(AT(sue, AAL1));
  check(
    "platform admin without a factor, aal1: answers",
    s3.ok && s3.rows[0].n === 2,
    s3.ok ? String(s3.rows[0].n) : s3.message,
  );
  const s4 = await probeRows(AT(alice, AAL2));
  check(
    "a company admin (not platform staff) at aal2: still 'Super admin only'",
    !s4.ok && /Super admin only/.test(s4.message),
    s4.ok ? "it answered" : s4.message,
  );
  const s5 = await probeRows(AT(alice, AAL1));
  check("a company admin with a factor at aal1: refused", !s5.ok);
  const s6 = await probeRows(SERVICE);
  check(
    "service role has no identity and was never a platform admin: still refused",
    !s6.ok,
    s6.ok ? String(s6.rows[0].n) : s6.message,
  );
}

heading("the service role is unaffected");
{
  const n = await countOf(SERVICE, "contacts");
  check("service role sees both companies' contacts", n === 3, String(n));
  const w = await as(SERVICE, (run) =>
    run("insert into contacts(name,tenant_id) values('server write', $1)", [orgB]),
  );
  check("...and can write for either company", w.ok && w.rowCount === 1, w.ok ? "" : w.message);
}

heading("it costs one call per statement, not one per row");
{
  const calls = await as(
    AT(bob, AAL1),
    async (run) => {
      const r = await run("select count(*)::int as n from contacts");
      const s = await run(
        "select calls from pg_stat_xact_user_functions where funcname = 'session_meets_mfa'",
      );
      return {
        n: r.ok ? r.rows[0].n : r.message,
        calls: s.ok ? (s.rows[0]?.calls ?? 0) : s.message,
      };
    },
    {
      beforeBecoming: [
        "set local track_functions = 'all'",
        `insert into contacts(name,tenant_id) select 'bulk ' || g, '${orgA}' from generate_series(1,2000) g`,
      ],
    },
  );
  check(
    "reading 2000+ rows calls the helper once",
    calls.n > 2000 && Number(calls.calls) === 1,
    `rows=${calls.n}, helper calls=${calls.calls}`,
  );
  const plan = await as(AT(bob, AAL1), async (run) => {
    const r = await run("explain select * from contacts");
    return r.ok ? r.rows.map((x) => x["QUERY PLAN"]).join("\n") : r.message;
  });
  check("the plan shows an InitPlan (evaluated once)", /InitPlan/.test(plan), plan.split("\n")[0]);
}

heading("the helper cannot fail open");
{
  await c.query("alter table auth.mfa_factors rename to mfa_factors_hidden");
  const blocked = await as(AT(bob, AAL1), (run) => run("select count(*)::int as n from contacts"));
  const withCode = await as(AT(alice, AAL2), (run) =>
    run("select count(*)::int as n from contacts"),
  );
  const nobody = await as(NOBODY(AAL1), (run) => run("select count(*)::int as n from contacts"));
  await c.query("alter table auth.mfa_factors_hidden rename to mfa_factors");
  check(
    "factor table unreadable: a request that needs it ERRORS, it does not pass",
    !blocked.ok,
    blocked.ok ? `returned ${blocked.rows[0].n} rows` : blocked.code,
  );
  check(
    "...a request with the code never needs it and still works",
    withCode.ok && withCode.rows[0].n === 2,
  );
  check(
    "...a request with no identity is refused without needing it",
    nobody.ok && nobody.rows[0].n === 0,
    nobody.ok ? "" : nobody.message,
  );
}

// ---------------------------------------------------------------------------
heading("run twice");
const snapshotAll = async () =>
  JSON.stringify(
    (
      await c.query(`
        select (select count(*) from pg_policies where policyname = 'mfa_session_gate')::int as policies,
               (select md5(string_agg(pg_get_functiondef(p.oid), '' order by p.proname)) from pg_proc p
                 where p.pronamespace = 'public'::regnamespace
                   and p.proname in ('session_meets_mfa','apply_mfa_session_gate','list_subscribers')) as functions,
               (select md5(string_agg(polrelid::regclass::text || pg_get_expr(polqual, polrelid) || pg_get_expr(polwithcheck, polrelid), '' order by polrelid::regclass::text))
                  from pg_policy where polname = 'mfa_session_gate') as policies_md5`)
    ).rows[0],
  );
const afterFirst = await snapshotAll();
const second = await apply(c, mineSql);
check("applying the file a second time succeeds", second.error === null, second.error?.message);
check(
  "...and leaves the policies and functions exactly as they were",
  (await snapshotAll()) === afterFirst,
);

// ---------------------------------------------------------------------------
heading("migrations dated after the gate");
for (const f of after) {
  const { error } = await apply(c, fs.readFileSync(path.join(MIG, f), "utf8"));
  check(`${f} applies`, error === null, error?.message);
}
if (after.length === 0) console.log("  (none yet)");

heading(
  "guard: every table with row-level security has the gate; every table has row-level security",
);
const gateMissing = async () =>
  (
    await c.query(`
      select n.nspname || '.' || c.relname as t
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r','p') and c.relrowsecurity
         and not exists (select 1 from pg_policy p where p.polrelid = c.oid
                           and p.polname = 'mfa_session_gate' and not p.polpermissive)
       order by 1`)
  ).rows.map((r) => r.t);
{
  const missing = await gateMissing();
  check(
    "no table in public with row-level security lacks the gate",
    missing.length === 0,
    missing.length
      ? `${missing.join(", ")} -- end the migration that adds it with: SELECT public.apply_mfa_session_gate();`
      : "",
  );
  const noRls = (
    await c.query(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity order by 1`)
  ).rows.map((r) => r.relname);
  check(
    "no table in public lacks row-level security (a table without it is open to every signed-in person, gate or not)",
    noRls.length === 0,
    noRls.length ? `${noRls.join(", ")} -- enable row-level security on it` : "",
  );
  const views = (
    await c.query(`
      select c.relname, c.reloptions::text as opts, has_table_privilege('authenticated', c.oid, 'SELECT') as readable
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('v','m','f') order by 1`)
  ).rows;
  const leaky = views.filter((v) => v.readable && !/security_invoker=(on|true)/.test(v.opts ?? ""));
  check(
    `no view the browser role can read skips the policies (${views.filter((v) => v.readable).length} readable, all security_invoker)`,
    leaky.length === 0,
    leaky.map((v) => v.relname).join(", ") +
      (leaky.length ? " -- create it WITH (security_invoker = on)" : ""),
  );
}

heading("guard: SECURITY DEFINER functions the browser role can call");
{
  // A definer function runs as its owner and skips every policy, gate included.
  // So each one the browser can call must either ask the rule itself, return only
  // the caller's own flags, or be named below with the reason it is allowed to be
  // open. A new one that is none of those fails here, in the pull request that adds it.
  const OPEN_BY_DESIGN = new Set([
    "access_state", // the account's own state; the layout and the generated middleware ask it at aal1
    "am_i_super_admin", // own flag, used inside policies
    "am_i_tenant_admin", // own flag, used inside policies
    "current_tenant_id", // own company id, used inside policies and by the settings page
    "is_tenant_admin", // own flag, used inside policies
    "my_tenant_id", // own company id, used inside policies
    "session_meets_mfa", // the rule itself: answers only about the caller's own session
  ]);
  const KNOWN_GAPS = new Map([
    [
      "open_contact_whatsapp",
      "PR #66 redefines it; guard it in a follow-up once #66 is applied live",
    ],
    [
      "record_integration_error",
      "accepts any tenant id: a separate, older problem, not a two-factor one",
    ],
    ["check_and_prune_tenant_email_storage", "PR #81 revokes it from the browser role"],
  ]);
  const fns = (
    await c.query(`
      select p.proname, p.prosrc
        from pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.prorettype <> 'trigger'::regtype
         and has_function_privilege('authenticated', p.oid, 'EXECUTE')
       order by 1`)
  ).rows;
  const unclassified = [];
  for (const f of fns) {
    if (/session_meets_mfa/.test(f.prosrc)) continue;
    if (OPEN_BY_DESIGN.has(f.proname)) continue;
    if (KNOWN_GAPS.has(f.proname)) {
      console.log(`  KNOWN GAP  ${f.proname}: ${KNOWN_GAPS.get(f.proname)}`);
      continue;
    }
    unclassified.push(f.proname);
  }
  check(
    `every one of the ${fns.length} definer functions callable by the browser role is guarded, open by design, or a named known gap`,
    unclassified.length === 0,
    unclassified.length
      ? `${unclassified.join(", ")} -- start it with IF NOT public.session_meets_mfa() THEN RAISE ... ERRCODE 'insufficient_privilege', or list it in this script with the reason`
      : "",
  );
  const guarded = fns.filter((f) => /session_meets_mfa/.test(f.prosrc)).map((f) => f.proname);
  check(
    "list_subscribers is among the guarded ones",
    guarded.includes("list_subscribers"),
    guarded.join(", "),
  );
}

// ---------------------------------------------------------------------------
heading("a table added later");
{
  await c.query(
    "create table public.zz_added_later (id uuid primary key default gen_random_uuid(), tenant_id uuid)",
  );
  await c.query("alter table public.zz_added_later enable row level security");
  await c.query(
    "create policy zz_added_all on public.zz_added_later for all to authenticated using (true) with check (true)",
  );
  await c.query(`insert into public.zz_added_later(tenant_id) values ('${orgA}')`);
  const missing = await gateMissing();
  check(
    "the new-table guard names it",
    missing.length === 1 && missing[0] === "public.zz_added_later",
    missing.join(","),
  );
  const open = await countOf(AT(alice, AAL1), "zz_added_later");
  check(
    "until covered, a verified-factor person at aal1 can read it (what the guard prevents)",
    open === 1,
    String(open),
  );
  const covered = await c.query("select public.apply_mfa_session_gate() as n");
  check(
    "apply_mfa_session_gate() covers it and reports the count",
    covered.rows[0].n === protectedNow.length + 1,
    String(covered.rows[0].n),
  );
  check("the guard is quiet again", (await gateMissing()).length === 0);
  check(
    "...and the new table is closed at aal1 with a factor",
    (await countOf(AT(alice, AAL1), "zz_added_later")) === 0,
  );
  check("...and open at aal2", (await countOf(AT(alice, AAL2), "zz_added_later")) === 1);
  await c.query("drop table public.zz_added_later");
}

// ---------------------------------------------------------------------------
heading("kill switch (the statement printed in the file)");
{
  check("blocked before", (await countOf(AT(alice, AAL1), "contacts")) === 0);
  const k = await apply(c, KILL_SWITCH);
  check("the statement runs", k.error === null, k.error?.message);
  check(
    "a verified-factor person at aal1 reads again at once",
    (await countOf(AT(alice, AAL1), "contacts")) === 2,
  );
  const again = await apply(c, mineSql);
  check(
    "re-running the file restores the real rule",
    again.error === null && (await countOf(AT(alice, AAL1), "contacts")) === 0,
    again.error?.message,
  );
  check("...and the functions are as after the first run", (await snapshotAll()) === afterFirst);
}

heading("full rollback (the single statement printed in the file)");
{
  const r = await apply(c, ROLLBACK);
  check("the statement runs", r.error === null, r.error?.message);
  const left = (
    await c.query(`
      select (select count(*) from pg_policies where policyname = 'mfa_session_gate')::int as policies,
             (select count(*) from pg_proc where proname in ('session_meets_mfa','apply_mfa_session_gate')
                and pronamespace = 'public'::regnamespace)::int as functions`)
  ).rows[0];
  check(
    "no mfa_session_gate policy and neither function is left",
    left.policies === 0 && left.functions === 0,
    JSON.stringify(left),
  );
  check(
    "a verified-factor person at aal1 reads again",
    (await countOf(AT(alice, AAL1), "contacts")) === 2,
  );
  const s = await as(AT(sam, AAL1), (run) =>
    run("select count(*)::int as n from public.list_subscribers()"),
  );
  check(
    "list_subscribers() works again (it no longer calls the dropped function)",
    s.ok && s.rows[0].n === 2,
    s.ok ? "" : s.message,
  );
  const def = (
    await c.query("select pg_get_functiondef('public.list_subscribers()'::regprocedure) as d")
  ).rows[0].d;
  check("...and is the original body", !/session_meets_mfa/.test(def));
  const again = await apply(c, mineSql);
  check("the file applies again after a rollback", again.error === null, again.error?.message);
  check("...and everything is as after the first run", (await snapshotAll()) === afterFirst);
  check("...and it blocks again", (await countOf(AT(alice, AAL1), "contacts")) === 0);
}

await finish();
