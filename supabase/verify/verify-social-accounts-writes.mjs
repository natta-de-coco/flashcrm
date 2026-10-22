// CX-00 hold on PR #86: verification evidence must be written by the server only. Proved in a
// real Postgres, role by role, starting from the grants the live database really has.
//
// The whole migration history is applied first, WITHOUT the hardening file. Then the table is put
// where the review found the live database: the browser role holds broad TABLE-level INSERT and
// UPDATE on social_accounts (a column REVOKE cannot override that, and ADD COLUMN inherits it),
// next to the live row-level policy that only decides whose rows. The counterexample from the
// review is run and shown to WORK (so a green run cannot mean "the test never looked"); then the
// hardening file goes on and the same people try the same things.
//
// What is proved, each by doing it as the real role:
//   A  before: an admin of a company writes both evidence columns of their own company's account,
//      by UPDATE and by INSERT; with a same-company policy any member can; with an open policy
//      even anon can. The only thing in the way of anon was the policy.
//   B  after: none of that works for authenticated or anon, and the refusal is the privilege
//      check ("permission denied"), not a row-level policy, even with those policies in place.
//      Table-level and every column-level INSERT/UPDATE grant is gone. SELECT and DELETE still
//      work for the browser role. The service role still reads and writes everything, which is
//      what the two writers that moved to the server (disconnect, paste a token) and the health
//      check use. No row was touched and none was marked verified. A second run changes nothing.
//   C  recovery: the statements the file's own pre-check prints put the previous grants back
//      exactly, and the file closes them again.
//   D  order: with the evidence columns not added yet, the hardening file first and the evidence
//      migration second leaves the new columns with no browser grant, while the evidence migration
//      on its own (the control) hands the new columns to the browser role through the table grant.
//
// Writes are judged by rows affected or by the SQLSTATE and message, never by "did it throw": a
// row-level-security refusal on UPDATE does not throw, it affects zero rows.
//
//   npm install --no-save --package-lock=false --no-audit --no-fund embedded-postgres@17.10.0-beta.17 pg@8.23.0
//   node supabase/verify/verify-social-accounts-writes.mjs
//   npm ci --no-audit --no-fund     # puts node_modules back the way the lockfile says
//
// MUTATION=<name> puts one bug back; the run must then FAIL (the names are in the pull request):
//   restore-table-update  restore-column-update  restore-service-role-revoke
//   fix-without-table-revoke  fix-without-public
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(HERE, "..", "migrations");
const FIX_FILE = "20261022090000_social_accounts_browser_writes_server_only.sql";
const EVIDENCE_FILE = "20261015120000_social_account_validation_evidence.sql";
const PORT = 54962;
const MUTATION = process.env.MUTATION ?? "";
if (MUTATION) console.log(`!! MUTATION: ${MUTATION} - this run must FAIL`);

const server = new EmbeddedPostgres({
  databaseDir: path.resolve(`node_modules/.cache/pg-social-writes-${Date.now()}`),
  user: "postgres",
  password: "postgres",
  port: PORT,
  persistent: false,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  // The refusals this script provokes are logged by Postgres as errors; they are the point.
  onLog: process.env.PG_LOG ? console.log : () => {},
  onError: process.env.PG_LOG ? console.error : () => {},
});
const config = {
  host: "localhost",
  port: PORT,
  user: "postgres",
  password: "postgres",
  database: "postgres",
};

const read = (file) => fs.readFileSync(path.join(MIG, file), "utf8").split("\r\n").join("\n");
let fix = read(FIX_FILE);
const evidenceMigration = read(EVIDENCE_FILE);

// The pre-check / recovery query is printed in the file's own header; the script runs exactly it.
const fixLines = fix.split("\n");
const from = fixLines.indexOf("--   begin-precheck-and-recovery");
const to = fixLines.indexOf("--   end-precheck-and-recovery");
assert.ok(from > 0 && to > from, "the file no longer prints its pre-check and recovery query");
const precheckSql = fixLines
  .slice(from + 1, to)
  .map((l) => l.replace(/^--\s?/, ""))
  .join("\n")
  .replace(/;\s*$/, "");

// Bugs put back into the file itself, to prove the checks below can fail.
if (MUTATION === "fix-without-table-revoke") {
  const line = "REVOKE INSERT, UPDATE ON public.social_accounts FROM PUBLIC, anon, authenticated;";
  assert.ok(fix.includes(line));
  fix = fix.replace(line, "");
}
if (MUTATION === "fix-without-public") {
  assert.ok(fix.includes("FROM PUBLIC, anon, authenticated"));
  fix = fix.replaceAll("FROM PUBLIC, anon, authenticated", "FROM anon, authenticated");
}

const TABLE = "public.social_accounts";
const EVIDENCE = ["last_validation_attempt_at", "last_validation_success_at"];
const BROWSER = ["anon", "authenticated"];

let checks = 0;
const ok = (value, label) => {
  checks++;
  assert.ok(value, label);
};
const same = (actual, expected, label) => {
  checks++;
  assert.deepEqual(actual, expected, label);
};

let db;
try {
  await server.initialise();
  await server.start();
  db = new pg.Client(config);
  await db.connect();
  await db.query("SET search_path TO public, extensions");
  await db.query(fs.readFileSync(path.join(HERE, "supabase-shim.sql"), "utf8"));
  // Supabase gives every role in the Data API a blanket grant on whatever the postgres role
  // creates. The shim does not, and without it "anon has no INSERT" would be true for the wrong
  // reason.
  await db.query(`
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
  `);

  // Everything that exists today, except the hardening. A file that fails here is a real failure.
  const history = fs
    .readdirSync(MIG)
    .filter((f) => f.endsWith(".sql") && f !== FIX_FILE)
    .sort();
  for (const f of history) {
    try {
      await db.query(read(f));
    } catch (e) {
      throw new Error(`${f} did not apply: ${e.message}`);
    }
  }
  ok(history.includes(EVIDENCE_FILE), "the evidence migration is part of the history");
  // Later migrations are part of the baseline too; the role-level checks below prove the
  // hardening's effect, so a newer unrelated migration must not stop them from running.

  /* ── helpers ────────────────────────────────────────────────────────────── */
  const session = async (role, uid) => {
    const c = new pg.Client(config);
    await c.connect();
    await c.query("SET search_path TO public, extensions");
    if (uid) await c.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [uid]);
    await c.query(`SET ROLE ${role}`);
    return c;
  };
  /**
   * One statement as one role, rolled back afterwards so the table is never changed by a probe.
   * Returns the rows affected, or the SQLSTATE and message if the database refused outright.
   */
  const probe = async (role, uid, sql, params = []) => {
    const c = await session(role, uid);
    try {
      await c.query("BEGIN");
      try {
        const r = await c.query(sql, params);
        return { n: r.rowCount, rows: r.rows };
      } catch (e) {
        return { code: e.code, message: e.message.split("\n")[0] };
      } finally {
        await c.query("ROLLBACK");
      }
    } finally {
      await c.end();
    }
  };
  /** A refusal by the privilege check, which is not the row-level policy (also SQLSTATE 42501). */
  const deniedByPrivilege = (r) =>
    r.code === "42501" &&
    /permission denied/.test(r.message) &&
    !/row-level security/.test(r.message);
  const deniedByPolicy = (r) => r.code === "42501" && /row-level security/.test(r.message);

  const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
  const roleName = (grantee) =>
    `CASE WHEN ${grantee} = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(${grantee}) END`;
  const aclRows = async () => {
    const rows = (
      await db.query(`
        SELECT 'table' AS level, ''::text AS col, ${roleName("a.grantee")} AS role,
               a.privilege_type, a.is_grantable
          FROM pg_class c, LATERAL aclexplode(c.relacl) a
         WHERE c.oid = '${TABLE}'::regclass
        UNION ALL
        SELECT 'column', t.attname::text, ${roleName("a.grantee")}, a.privilege_type, a.is_grantable
          FROM pg_attribute t, LATERAL aclexplode(t.attacl) a
         WHERE t.attrelid = '${TABLE}'::regclass AND t.attnum > 0 AND NOT t.attisdropped`)
    ).rows;
    return rows.sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
  };
  const isWrite = (r) => r.privilege_type === "INSERT" || r.privilege_type === "UPDATE";
  const isBrowser = (r) => r.role === "PUBLIC" || BROWSER.includes(r.role);
  const browserWriteGrants = async () =>
    (await aclRows()).filter((r) => isWrite(r) && isBrowser(r));
  const everythingElse = async () => (await aclRows()).filter((r) => !(isWrite(r) && isBrowser(r)));

  const columns = async () =>
    (
      await db.query(
        `SELECT attname FROM pg_attribute
          WHERE attrelid = '${TABLE}'::regclass AND attnum > 0 AND NOT attisdropped ORDER BY attnum`,
      )
    ).rows.map((r) => r.attname);
  /** Columns the role can INSERT or UPDATE, by whatever route (table, column, PUBLIC). */
  const writableColumns = async (role, privilege) =>
    (
      await db.query(
        `SELECT a.attname FROM pg_attribute a
          WHERE a.attrelid = '${TABLE}'::regclass AND a.attnum > 0 AND NOT a.attisdropped
            AND has_column_privilege($1, a.attrelid, a.attnum, $2) ORDER BY a.attnum`,
        [role, privilege],
      )
    ).rows.map((r) => r.attname);
  const tablePrivilege = async (role, privilege) =>
    (await one("SELECT has_table_privilege($1, $2, $3) AS v", [role, TABLE, privilege])).v;

  // Every committed column of every row, plus xmin, which changes when a row is rewritten.
  const snapshot = async () =>
    (
      await db.query(
        `SELECT to_jsonb(t) AS data, t.xmin::text AS xmin FROM ${TABLE} t ORDER BY t.id`,
      )
    ).rows;
  const verifiedCount = async () =>
    Number(
      (await one(`SELECT count(*) AS n FROM ${TABLE} WHERE last_validation_success_at IS NOT NULL`))
        .n,
    );
  const attemptCount = async () =>
    Number(
      (await one(`SELECT count(*) AS n FROM ${TABLE} WHERE last_validation_attempt_at IS NOT NULL`))
        .n,
    );

  /* ── people and accounts ────────────────────────────────────────────────── */
  const org = async (name, slug) =>
    (await one("INSERT INTO organizations(name, slug) VALUES ($1, $2) RETURNING id", [name, slug]))
      .id;
  const A = await org("Alpha Trading", "alpha");
  const B = await org("Beta Logistics", "beta");
  const person = async (email, tenant, staffRole, legacyRole) => {
    const id = (await one("INSERT INTO auth.users(email) VALUES ($1) RETURNING id", [email])).id;
    await db.query("UPDATE profiles SET tenant_id = $2, staff_role = $3 WHERE id = $1", [
      id,
      tenant,
      staffRole,
    ]);
    await db.query("INSERT INTO user_roles(user_id, role) VALUES ($1, $2) ON CONFLICT DO NOTHING", [
      id,
      legacyRole,
    ]);
    return id;
  };
  const adminA = await person("admin@alpha.test", A, "company_admin", "admin");
  const memberA = await person("member@alpha.test", A, "staff", "agent");
  const adminB = await person("admin@beta.test", B, "company_admin", "admin");

  const acc = {
    a1: "aaaaaaaa-2222-0000-0000-000000000001",
    a2: "aaaaaaaa-2222-0000-0000-000000000002",
    a3: "aaaaaaaa-2222-0000-0000-000000000003",
    b1: "bbbbbbbb-2222-0000-0000-000000000001",
  };
  const seed = async () => {
    await db.query(`TRUNCATE ${TABLE} CASCADE`);
    await db.query(
      `INSERT INTO ${TABLE} (id, tenant_id, platform, label, external_id, active, health) VALUES
         ($1, $5, 'facebook',  'Alpha page',   '111', true,  'connected'),
         ($2, $5, 'instagram', 'Alpha IG',     '222', true,  'connected'),
         ($3, $5, 'facebook',  'Alpha pending', NULL, true,  'unknown'),
         ($4, $6, 'facebook',  'Beta page',    '444', true,  'connected')`,
      [acc.a1, acc.a2, acc.a3, acc.b1, A, B],
    );
  };

  /**
   * The grants the review found on the live database: Supabase's blanket grant to the browser
   * roles, which the revokes in the migration history evidently did not leave in force there
   * (deleteSocialAccount, which runs as the signed-in user, only works with the table DELETE).
   * Put on top of whatever the history left.
   */
  const liveGrants = async ({ publicToo = false } = {}) => {
    await db.query(`GRANT ALL ON ${TABLE} TO anon, authenticated`);
    if (publicToo) await db.query(`GRANT INSERT, UPDATE ON ${TABLE} TO PUBLIC`);
  };

  // The evidence columns exist (the history includes the migration that adds them), start empty,
  // and the live policy is the one the history created.
  same(
    (await columns()).filter((c) => EVIDENCE.includes(c)),
    EVIDENCE,
    "evidence columns exist",
  );
  await seed();
  const policies = (
    await db.query(
      `SELECT policyname, cmd, roles::text AS roles, qual, with_check
         FROM pg_policies WHERE schemaname = 'public' AND tablename = 'social_accounts'
        ORDER BY policyname`,
    )
  ).rows;
  const live = policies.find((p) => p.policyname === "Admins manage social accounts");
  ok(
    live && live.cmd === "ALL" && /authenticated/.test(live.roles),
    "the live admin policy exists",
  );
  ok(
    /current_tenant_id/.test(live.qual) && /is_tenant_admin/.test(live.qual),
    "and is per company",
  );
  ok(
    !policies.some((p) => /anon/.test(p.roles)),
    "no policy lets anon write; its only wall before the fix is the row-level policy",
  );

  // What the history alone leaves the browser role: column-level grants that do not include the
  // columns the two browser-role writers (connectSocialAccount, disconnectConnection) used. So on a
  // database that followed the history they could not run as the user; the review's database is
  // the other case, below.
  const historyInsert = await writableColumns("authenticated", "INSERT");
  const historyUpdate = await writableColumns("authenticated", "UPDATE");
  ok(
    !["platform", "label", "external_id", "access_token"].every((c) => historyInsert.includes(c)),
    "history alone: the paste-a-token insert is not covered by the browser role's grants",
  );
  ok(
    !["active", "health"].every((c) => historyUpdate.includes(c)),
    "history alone: the disconnect update is not covered by the browser role's grants",
  );
  ok(
    !historyUpdate.some((c) => EVIDENCE.includes(c)),
    "history alone: the evidence columns are not browser-writable either",
  );

  /* ═══ A. BEFORE: the live grants, and the counterexample works ═══════════════ */
  await liveGrants();
  ok(await tablePrivilege("authenticated", "INSERT"), "authenticated holds table INSERT (live)");
  ok(await tablePrivilege("authenticated", "UPDATE"), "authenticated holds table UPDATE (live)");
  const allColumns = await columns();
  same(await writableColumns("authenticated", "UPDATE"), allColumns, "every column is writable");
  same(await writableColumns("authenticated", "INSERT"), allColumns, "every column is insertable");

  const forgeUpdate = (sql = "") =>
    `UPDATE ${TABLE} SET last_validation_attempt_at = now(), last_validation_success_at = now() WHERE id = $1 ${sql}`;
  const forgeInsert = `INSERT INTO ${TABLE}
      (tenant_id, platform, label, external_id, last_validation_attempt_at, last_validation_success_at)
    VALUES ($1, 'facebook', 'Forged', '999', now(), now())`;

  // The exact counterexample: an admin of the company, the live policy, the existing grant.
  const before = {
    adminUpdate: await probe("authenticated", adminA, forgeUpdate(), [acc.a3]),
    adminInsert: await probe("authenticated", adminA, forgeInsert, [A]),
    adminOtherCompany: await probe("authenticated", adminA, forgeUpdate(), [acc.b1]),
    memberUpdate: await probe("authenticated", memberA, forgeUpdate(), [acc.a3]),
    anonUpdate: await probe("anon", null, forgeUpdate(), [acc.a3]),
    anonInsert: await probe("anon", null, forgeInsert, [A]),
  };
  same(before.adminUpdate.n, 1, "BEFORE: an admin forged a verification on their own account");
  same(before.adminInsert.n, 1, "BEFORE: an admin created an account that is already verified");
  same(before.adminOtherCompany.n, 0, "the live policy already keeps the admin to their company");
  same(before.memberUpdate.n, 0, "the live policy already keeps a plain member out");
  same(before.anonUpdate.n, 0, "anon's only wall was the policy: zero rows");
  ok(deniedByPolicy(before.anonInsert), "and the policy refused anon's insert, not a privilege");

  // The review's own reproduction: add a same-company policy and the member writes too; add an
  // open policy and anon does. The grant, not the policy, is what lets the write through.
  await db.query(`
    CREATE POLICY cx00_same_company ON ${TABLE} FOR ALL TO authenticated
      USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
    CREATE POLICY cx00_open_to_anon ON ${TABLE} FOR ALL TO anon USING (true) WITH CHECK (true);
  `);
  same(
    (await probe("authenticated", memberA, forgeUpdate(), [acc.a3])).n,
    1,
    "BEFORE: with a same-company policy a plain member forges one",
  );
  same(
    (await probe("anon", null, forgeUpdate(), [acc.a3])).n,
    1,
    "BEFORE: with an open policy even anon forges one",
  );
  same(
    (await probe("anon", null, forgeInsert, [A])).n,
    1,
    "BEFORE: and anon inserts a verified account",
  );
  // An upsert needs INSERT and UPDATE: the same hole by the third door.
  same(
    (
      await probe(
        "authenticated",
        adminA,
        `INSERT INTO ${TABLE} (id, tenant_id, platform, label, last_validation_success_at)
           VALUES ($1, $2, 'facebook', 'x', now())
         ON CONFLICT (id) DO UPDATE SET last_validation_success_at = EXCLUDED.last_validation_success_at`,
        [acc.a3, A],
      )
    ).n,
    1,
    "BEFORE: and an upsert forges one",
  );

  /* ── the facts to compare after ─────────────────────────────────────────── */
  // What the browser roles do with SELECT and DELETE (untouched by the hardening), with the same
  // policies in place, so the comparison after is like for like.
  const readsAndDeletes = async () => ({
    adminSees: (
      await probe(
        "authenticated",
        adminA,
        `SELECT id, active, health, last_validation_attempt_at, last_validation_success_at FROM ${TABLE} ORDER BY id`,
      )
    ).rows,
    adminBSees: (await probe("authenticated", adminB, `SELECT id FROM ${TABLE} ORDER BY id`)).rows,
    anonSees: (await probe("anon", null, `SELECT id FROM ${TABLE} ORDER BY id`)).rows,
    adminDeletesOwn: (
      await probe("authenticated", adminA, `DELETE FROM ${TABLE} WHERE id = $1`, [acc.a3])
    ).n,
    adminDeletesOther: (
      await probe("authenticated", adminA, `DELETE FROM ${TABLE} WHERE id = $1`, [acc.b1])
    ).n,
    adminBDeletesOwn: (
      await probe("authenticated", adminB, `DELETE FROM ${TABLE} WHERE id = $1`, [acc.b1])
    ).n,
    memberDeletes: (
      await probe("authenticated", memberA, `DELETE FROM ${TABLE} WHERE id = $1`, [acc.a3])
    ).n,
  });
  const browserBefore = await readsAndDeletes();
  same(
    browserBefore.adminSees.map((r) => r.id),
    [acc.a1, acc.a2, acc.a3],
    "BEFORE: an admin sees their own company's accounts",
  );
  same(
    browserBefore.adminBSees.map((r) => r.id),
    [acc.b1],
    "BEFORE: another company's admin sees theirs",
  );
  same(browserBefore.adminDeletesOwn, 1, "BEFORE: an admin deletes their own company's account");
  same(browserBefore.adminDeletesOther, 0, "BEFORE: and not another company's");
  same(browserBefore.adminBDeletesOwn, 1, "BEFORE: and the other company's admin deletes theirs");
  const rowsBefore = await snapshot();
  same(rowsBefore.length, 4);
  same(await verifiedCount(), 0, "no account starts verified");
  same(await attemptCount(), 0, "no account starts with an attempt on record");
  const aclBefore = await aclRows();
  const writeGrantsBefore = await browserWriteGrants();
  const elseBefore = await everythingElse();
  ok(
    writeGrantsBefore.some((g) => g.level === "table" && g.role === "authenticated"),
    "the live table-level grant is in the snapshot",
  );
  ok(
    writeGrantsBefore.some((g) => g.level === "column" && g.role === "authenticated"),
    "and so are the legacy column-level grants the history left",
  );

  // The pre-check / recovery query the file prints, run BEFORE applying it, as an operator would.
  const precheck = (await db.query(precheckSql)).rows;
  // PRINT_PRECHECK=1 shows what the file's pre-check prints on this database (the review's state).
  if (process.env.PRINT_PRECHECK) {
    console.table(
      precheck.map(({ level, column, role, privilege_type, grantable }) => ({
        level,
        column,
        role,
        privilege_type,
        grantable,
      })),
    );
  }
  ok(precheck.length >= writeGrantsBefore.length, "the pre-check lists every browser write grant");
  ok(
    precheck.every((r) => /^GRANT (INSERT|UPDATE) /.test(r.restore_with)),
    "each row carries the statement that restores it",
  );
  same(
    precheck.map((r) => `${r.level}|${r.column ?? ""}|${r.role}|${r.privilege_type}`).sort(),
    writeGrantsBefore.map((g) => `${g.level}|${g.col}|${g.role}|${g.privilege_type}`).sort(),
    "the pre-check lists exactly the grants the catalogue holds",
  );

  /* ═══ B. AFTER: the hardening goes on ═══════════════════════════════════════ */
  const applyFix = async () => {
    const results = await db.query(fix);
    return Array.isArray(results) ? results : [results];
  };
  const first = await applyFix();
  if (MUTATION === "restore-table-update") {
    await db.query(`GRANT UPDATE ON ${TABLE} TO authenticated`);
  }
  if (MUTATION === "restore-column-update") {
    await db.query(`GRANT UPDATE (last_validation_success_at) ON ${TABLE} TO authenticated`);
  }
  if (MUTATION === "restore-service-role-revoke") {
    await db.query(`REVOKE ALL ON ${TABLE} FROM service_role`);
  }

  // The file's own read-only checks say what it claims.
  const checkRows = first.at(-3).rows;
  same(
    Object.fromEntries(
      checkRows.map((r) => [
        r.role,
        [r.table_insert, r.table_update, r.any_column_insert, r.any_column_update],
      ]),
    ),
    {
      anon: [false, false, false, false],
      authenticated: [false, false, false, false],
      service_role: [true, true, true, true],
    },
    "the file's check 1: browser roles all false, service_role all true",
  );
  same(first.at(-2).rows, [], "the file's check 2: no column is writable by the browser roles");
  same(Number(first.at(-1).rows[0].accounts), 4, "the file's check 3: the same four accounts");

  // Privileges, every route.
  for (const role of BROWSER) {
    for (const privilege of ["INSERT", "UPDATE"]) {
      same(await tablePrivilege(role, privilege), false, `${role} table ${privilege}`);
      same(await writableColumns(role, privilege), [], `${role} column ${privilege}`);
    }
  }
  same(
    await browserWriteGrants(),
    [],
    "no INSERT or UPDATE entry is left for PUBLIC, anon or authenticated",
  );
  for (const privilege of ["INSERT", "UPDATE", "DELETE", "SELECT"]) {
    ok(await tablePrivilege("service_role", privilege), `service_role keeps table ${privilege}`);
  }
  same(
    await everythingElse(),
    elseBefore,
    "every other grant is exactly as it was (SELECT, DELETE, the service role, the owner)",
  );
  ok(await tablePrivilege("authenticated", "DELETE"), "authenticated still holds DELETE");

  // The counterexample, with the same policies still in place, now fails on the privilege.
  const after = {
    adminUpdate: await probe("authenticated", adminA, forgeUpdate(), [acc.a3]),
    adminInsert: await probe("authenticated", adminA, forgeInsert, [A]),
    memberUpdate: await probe("authenticated", memberA, forgeUpdate(), [acc.a3]),
    anonUpdate: await probe("anon", null, forgeUpdate(), [acc.a3]),
    anonInsert: await probe("anon", null, forgeInsert, [A]),
  };
  for (const [who, result] of Object.entries(after)) {
    ok(
      deniedByPrivilege(result),
      `AFTER: ${who} is refused by the privilege check (${JSON.stringify(result)})`,
    );
  }
  // One column at a time, both kinds of write, both roles: not just the pair the review used.
  for (const column of EVIDENCE) {
    for (const [role, uid] of [
      ["authenticated", adminA],
      ["authenticated", memberA],
      ["anon", null],
    ]) {
      const update = await probe(role, uid, `UPDATE ${TABLE} SET ${column} = now() WHERE id = $1`, [
        acc.a3,
      ]);
      ok(
        deniedByPrivilege(update),
        `AFTER: ${role} cannot UPDATE ${column} (${JSON.stringify(update)})`,
      );
      const insert = await probe(
        role,
        uid,
        `INSERT INTO ${TABLE} (tenant_id, platform, label, ${column}) VALUES ($1, 'facebook', 'x', now())`,
        [A],
      );
      ok(
        deniedByPrivilege(insert),
        `AFTER: ${role} cannot INSERT ${column} (${JSON.stringify(insert)})`,
      );
    }
  }
  const upsert = await probe(
    "authenticated",
    adminA,
    `INSERT INTO ${TABLE} (id, tenant_id, platform, label, last_validation_success_at)
       VALUES ($1, $2, 'facebook', 'x', now())
     ON CONFLICT (id) DO UPDATE SET last_validation_success_at = EXCLUDED.last_validation_success_at`,
    [acc.a3, A],
  );
  ok(deniedByPrivilege(upsert), `AFTER: an upsert is refused (${JSON.stringify(upsert)})`);
  // Nothing else is writable by the browser role either: the other columns the old grants named.
  for (const [role, uid] of [
    ["authenticated", adminA],
    ["anon", null],
  ]) {
    for (const set of [
      "active = false",
      "health = 'disconnected'",
      "label = 'renamed'",
      "access_token = 'x'",
      "connection_state = 'revoked'",
    ]) {
      const r = await probe(role, uid, `UPDATE ${TABLE} SET ${set} WHERE id = $1`, [acc.a3]);
      ok(deniedByPrivilege(r), `AFTER: ${role} cannot UPDATE ${set} (${JSON.stringify(r)})`);
    }
  }

  // What the browser role may still do: read, and delete, exactly as before.
  same(await readsAndDeletes(), browserBefore, "AFTER: SELECT and DELETE behave exactly as before");
  ok(
    browserBefore.adminSees.every((r) => r.last_validation_success_at === null),
    "and the evidence columns are still readable, and empty",
  );

  // What the server does with the service role: connect (paste a token), disconnect, verify.
  const service = {
    connect: await probe(
      "service_role",
      null,
      `INSERT INTO ${TABLE} (tenant_id, platform, label, external_id, access_token)
         VALUES ($1, 'instagram', 'Pasted', '17841', 'sealed:x') RETURNING id, tenant_id`,
      [A],
    ),
    disconnect: await probe(
      "service_role",
      null,
      `UPDATE ${TABLE} SET active = false, health = 'disconnected' WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [acc.a1, A],
    ),
    disconnectWrongCompany: await probe(
      "service_role",
      null,
      `UPDATE ${TABLE} SET active = false, health = 'disconnected' WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [acc.b1, A],
    ),
    verify: await probe(
      "service_role",
      null,
      `UPDATE ${TABLE} SET last_validation_attempt_at = now(), last_validation_success_at = now()
        WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [acc.a1, A],
    ),
    insertVerified: await probe(
      "service_role",
      null,
      `INSERT INTO ${TABLE} (tenant_id, platform, label, external_id, last_validation_attempt_at, last_validation_success_at)
         VALUES ($1, 'facebook', 'Server made', '555', now(), now())`,
      [A],
    ),
    read: await probe("service_role", null, `SELECT count(*) AS n FROM ${TABLE}`),
  };
  same(service.connect.n, 1, "SERVER: the paste-a-token insert works with the service role");
  same(service.connect.rows[0].tenant_id, A);
  same(service.disconnect.n, 1, "SERVER: the disconnect update works");
  same(
    service.disconnectWrongCompany.n,
    0,
    "SERVER: and its company guard finds nothing for another company",
  );
  same(service.verify.n, 1, "SERVER: the health check writes the evidence");
  same(service.insertVerified.n, 1, "SERVER: and may create a row with it");
  same(Number(service.read.rows[0].n), 4, "SERVER: and reads everything");

  // No row was touched by the file, and none was marked verified.
  same(await snapshot(), rowsBefore, "the hardening changed or rewrote no row (data and xmin)");
  same(await verifiedCount(), 0, "nothing was backfilled as verified");
  same(await attemptCount(), 0, "nothing was backfilled with an attempt");

  // Twice.
  const aclAfterFirst = await aclRows();
  await applyFix();
  same(await aclRows(), aclAfterFirst, "running it twice leaves every grant exactly as it was");
  same(await snapshot(), rowsBefore, "and touches no row");

  /* ═══ C. RECOVERY: the printed statements put the previous grants back ═════ */
  for (const r of precheck) await db.query(r.restore_with);
  same(
    await aclRows(),
    aclBefore,
    "RECOVERY: the pre-check's statements restore every grant exactly",
  );
  same(
    (await probe("authenticated", adminA, forgeUpdate(), [acc.a3])).n,
    1,
    "RECOVERY: and the old behaviour is back, so the pre-check really was the old state",
  );
  await applyFix();
  same(await browserWriteGrants(), [], "RECOVERY: the file closes it again");
  ok(
    deniedByPrivilege(await probe("authenticated", adminA, forgeUpdate(), [acc.a3])),
    "and the write is refused again",
  );
  same(await snapshot(), rowsBefore, "and no row ever changed");

  /* ═══ D. ORDER: the evidence columns do not exist yet ═══════════════════════ */
  await db.query(`
    DROP POLICY cx00_same_company ON ${TABLE};
    DROP POLICY cx00_open_to_anon ON ${TABLE};
  `);
  const withoutEvidenceColumns = async () => {
    await db.query(
      `ALTER TABLE ${TABLE} DROP COLUMN IF EXISTS last_validation_attempt_at, DROP COLUMN IF EXISTS last_validation_success_at`,
    );
    // The live-like state again: the broad INSERT and UPDATE grants, PUBLIC included, on top of
    // the SELECT and DELETE grants the history left.
    await db.query(`REVOKE INSERT, UPDATE ON ${TABLE} FROM PUBLIC, anon, authenticated`);
    await liveGrants({ publicToo: true });
  };

  // D1, the control: the evidence migration alone. The new columns inherit the table grant.
  await withoutEvidenceColumns();
  same(
    (await columns()).filter((c) => EVIDENCE.includes(c)),
    [],
    "the columns are gone",
  );
  await db.query(evidenceMigration);
  same(
    await writableColumns("authenticated", "UPDATE"),
    await columns(),
    "CONTROL: without the hardening, the new evidence columns are writable by the browser role",
  );
  same(
    (await probe("authenticated", adminA, forgeUpdate(), [acc.a2])).n,
    1,
    "CONTROL: and an admin forges a verification on them",
  );

  // D2: the hardening first, then the evidence migration (the order the pull request gives).
  await withoutEvidenceColumns();
  const early = await applyFix();
  same(
    early.at(-2).rows,
    [],
    "hardening before the columns exist: its own check finds nothing writable",
  );
  same(await browserWriteGrants(), [], "and it did not need the columns to exist");
  await db.query(evidenceMigration);
  same(
    (await columns()).filter((c) => EVIDENCE.includes(c)),
    EVIDENCE,
    "the evidence migration then adds them",
  );
  for (const role of BROWSER) {
    same(
      await writableColumns(role, "UPDATE"),
      [],
      `ORDER: ${role} has no UPDATE on the new columns`,
    );
    same(
      await writableColumns(role, "INSERT"),
      [],
      `ORDER: ${role} has no INSERT on the new columns`,
    );
  }
  ok(
    deniedByPrivilege(await probe("authenticated", adminA, forgeUpdate(), [acc.a2])),
    "ORDER: the forged update is refused",
  );
  ok(
    deniedByPrivilege(await probe("authenticated", adminA, forgeInsert, [A])),
    "ORDER: the forged insert is refused",
  );
  ok(
    (await probe("service_role", null, forgeUpdate("AND tenant_id = '" + A + "'"), [acc.a2])).n ===
      1,
    "ORDER: and the server writes them",
  );
  await applyFix();
  same(
    await browserWriteGrants(),
    [],
    "ORDER: the hardening is still closed when run again afterwards",
  );
  same(await verifiedCount(), 0, "ORDER: nothing is marked verified by any of it");

  /* ═══ E. LEGACY COLUMN-LEVEL GRANTS ONLY, the evidence columns among them ═══ */
  // No table-level grant at all, as the history leaves some databases: only the column-level
  // INSERT and UPDATE the earlier migrations made, plus (the review's wording) a legacy grant on
  // the two evidence columns themselves. A table-level REVOKE must take these away too.
  await db.query(`REVOKE INSERT, UPDATE ON ${TABLE} FROM PUBLIC, anon, authenticated`);
  await db.query(`
    GRANT INSERT (tenant_id, platform, label, external_id, access_token, active, connection_state,
                  state_reason, stats, last_validation_attempt_at, last_validation_success_at)
      ON ${TABLE} TO authenticated, anon;
    GRANT UPDATE (platform, label, external_id, access_token, active, connection_state,
                  state_reason, stats, last_validation_attempt_at, last_validation_success_at)
      ON ${TABLE} TO authenticated, anon;
  `);
  same(
    (await browserWriteGrants()).filter((g) => g.level === "table"),
    [],
    "the legacy state has no table-level write grant",
  );
  ok(
    (await writableColumns("authenticated", "UPDATE")).includes("last_validation_success_at"),
    "but the evidence column is writable by a column-level grant",
  );
  same(
    (await probe("authenticated", adminA, forgeUpdate(), [acc.a2])).n,
    1,
    "LEGACY, before: an admin forges a verification through the column-level grant alone",
  );
  await applyFix();
  same(await browserWriteGrants(), [], "LEGACY: the column-level grants are gone too");
  for (const role of BROWSER) {
    same(await writableColumns(role, "UPDATE"), [], `LEGACY: ${role} has no UPDATE on any column`);
    same(await writableColumns(role, "INSERT"), [], `LEGACY: ${role} has no INSERT on any column`);
  }
  ok(
    deniedByPrivilege(await probe("authenticated", adminA, forgeUpdate(), [acc.a2])),
    "LEGACY: and the forged update is refused",
  );

  console.log(
    `verify-social-accounts-writes: OK (${checks} checks - the review's counterexample works before and is refused by the privilege check after, for authenticated and anon, with and without policies; table and column grants gone; SELECT/DELETE and the service role untouched; no row touched or backfilled; twice-safe; recovery exact; either order with the evidence columns)`,
  );
} finally {
  await db?.end().catch(() => {});
  await server.stop().catch(() => {});
}
