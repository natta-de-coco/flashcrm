// Two permission holes, proved in a real Postgres, role by role:
//
//   1. webhook_events DELETE. The policy "Admins can delete webhook events" asked only
//      has_role(auth.uid(), 'admin'), a global role, so a user holding it in company A
//      could delete company B's events.
//   2. record_integration_error(). SECURITY DEFINER, writes the tenant id the caller
//      passes, and EXECUTE was granted to `authenticated`.
//
// The whole migration history is applied first, WITHOUT the fix, and both holes are shown
// to be open (so a green run cannot mean "the test never looked"). Then the fix goes on
// and the same people try the same things. Writes are judged by rows affected or by the
// error code, never by "did it throw": a row-level-security refusal on DELETE does not
// throw, it affects zero rows.
//
//   npm install --no-save --package-lock=false embedded-postgres@17.10.0-beta.17 pg@8.23.0
//   node supabase/verify/verify-webhook-delete-and-integration-error.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(HERE, "..", "migrations");
const FIX_FILE = "20261019120000_webhook_events_delete_and_integration_error_scope.sql";
const PORT = 54966;

const server = new EmbeddedPostgres({
  databaseDir: path.resolve(`node_modules/.cache/pg-webhook-delete-${Date.now()}`),
  user: "postgres",
  password: "postgres",
  port: PORT,
  persistent: false,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});
const config = {
  host: "localhost",
  port: PORT,
  user: "postgres",
  password: "postgres",
  database: "postgres",
};

const fix = fs.readFileSync(path.join(MIG, FIX_FILE), "utf8").split("\r\n").join("\n");
// The rollback is printed in the migration's own header; the script runs exactly that text.
const fixLines = fix.split("\n");
const rollback = fixLines
  .slice(fixLines.findIndex((l) => l.startsWith("-- Rollback")) + 1, fixLines.indexOf("BEGIN;"))
  .map((l) => l.replace(/^--   /, ""))
  .join("\n");
assert.match(rollback, /GRANT DELETE ON public\.webhook_events TO authenticated;/);
assert.match(rollback, /CREATE POLICY "Admins can delete webhook events"/);
assert.match(rollback, /GRANT EXECUTE ON FUNCTION public\.record_integration_error/);

const FN_ARGS =
  "uuid,uuid,text,text,text,integer,text,text,text,text,text,text,text,text,text,boolean,text,text";
const FN = `public.record_integration_error(${FN_ARGS})`;

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
  // Supabase gives every role in the Data API a blanket grant on whatever the
  // postgres role creates. The shim does not, and without it "anon has no
  // DELETE" would be true for the wrong reason.
  await db.query(`
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
  `);

  // Everything that exists before the fix. A file that fails here is a real failure.
  // Migrations dated AFTER the fix (today the second-sign-in gate, 20261020000000) are not
  // part of the state the fix sees: they are applied last, in section 6, to prove that they
  // leave both holes closed.
  const applyFile = async (f) => {
    try {
      await db.query(fs.readFileSync(path.join(MIG, f), "utf8"));
    } catch (e) {
      throw new Error(`${f} did not apply: ${e.message}`);
    }
  };
  const all = fs
    .readdirSync(MIG)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const history = all.filter((f) => f < FIX_FILE);
  const newer = all.filter((f) => f > FIX_FILE);
  for (const f of history) await applyFile(f);

  // ── people and rows ───────────────────────────────────────────────────────
  const org = async (name, slug) =>
    (
      await db.query("INSERT INTO organizations(name, slug) VALUES ($1, $2) RETURNING id", [
        name,
        slug,
      ])
    ).rows[0].id;
  const A = await org("Alpha", "alpha");
  const B = await org("Beta", "beta");
  const person = async (email, tenant, staffRole, legacyRole) => {
    const id = (await db.query("INSERT INTO auth.users(email) VALUES ($1) RETURNING id", [email]))
      .rows[0].id;
    await db.query("UPDATE profiles SET tenant_id = $2, staff_role = $3 WHERE id = $1", [
      id,
      tenant,
      staffRole,
    ]);
    if (legacyRole) {
      await db.query(
        "INSERT INTO user_roles(user_id, role) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [id, legacyRole],
      );
    }
    return id;
  };
  const people = {
    // company admin of A, who also carries the legacy global admin role
    adminA: await person("admin@alpha.test", A, "company_admin", "admin"),
    // an ordinary member of A who only carries the legacy global admin role
    legacyA: await person("legacy@alpha.test", A, "staff", "admin"),
    agentA: await person("agent@alpha.test", A, "staff", "agent"),
    adminB: await person("admin@beta.test", B, "company_admin", "admin"),
    superAdmin: await person("root@platform.test", null, "super_admin", null),
  };
  const personas = Object.keys(people);
  const ev = {
    a1: "aaaaaaaa-1111-0000-0000-000000000001",
    a2: "aaaaaaaa-1111-0000-0000-000000000002",
    b1: "bbbbbbbb-1111-0000-0000-000000000001",
    b2: "bbbbbbbb-1111-0000-0000-000000000002",
    old: "00000000-1111-0000-0000-000000000001", // historical row, no company
  };
  const seedEvents = async () => {
    await db.query("TRUNCATE public.webhook_events");
    await db.query(
      `INSERT INTO public.webhook_events (id, tenant_id) VALUES
         ($1, $6), ($2, $6), ($3, $7), ($4, $7), ($5, NULL)`,
      [ev.a1, ev.a2, ev.b1, ev.b2, ev.old, A, B],
    );
  };
  const eventIds = async () =>
    (await db.query("SELECT id FROM public.webhook_events ORDER BY id")).rows.map((r) => r.id);
  const allEvents = Object.values(ev).sort();

  /** One session in a given role, the way PostgREST opens one. */
  const session = async (role, uid) => {
    const c = new pg.Client(config);
    await c.connect();
    await c.query("SET search_path TO public, extensions");
    if (uid) await c.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [uid]);
    await c.query(`SET ROLE ${role}`);
    return c;
  };
  /** Rows affected, or the SQLSTATE if the database refused outright. */
  const attempt = async (c, sql, params = []) => {
    try {
      const r = await c.query(sql, params);
      return { n: r.rowCount, rows: r.rows };
    } catch (e) {
      return { code: e.code, message: e.message.split("\n")[0] };
    }
  };
  const asRole = async (role, uid, fn) => {
    const c = await session(role, uid);
    try {
      return await fn(c);
    } finally {
      await c.end();
    }
  };

  const recordSql = `SELECT public.record_integration_error(
      $1::uuid, NULL::uuid, 'meta', 'channels', 'health_check', 401, '190', '463',
      'OAuthException', 'The access token has expired.', 'Token expired',
      'The token expired.', 'Password changed', 'Reconnect the account',
      'action_required', false, 'v20.0', $2) AS id`;
  const errorsOf = async (tenant) =>
    (
      await db.query(
        "SELECT id, occurrence_count FROM public.integration_errors WHERE tenant_id = $1 ORDER BY id",
        [tenant],
      )
    ).rows;

  // ── what the database says about the two objects ──────────────────────────
  const snapshot = async () => {
    const sortedAcl = (a) => (a ? [...a].sort() : []);
    const table = (
      await db.query(
        `SELECT relacl::text[] AS acl, relrowsecurity FROM pg_class
          WHERE oid = 'public.webhook_events'::regclass`,
      )
    ).rows[0];
    const policies = (
      await db.query(
        `SELECT policyname, cmd, permissive, roles::text AS roles, qual, with_check
           FROM pg_policies WHERE schemaname = 'public' AND tablename = 'webhook_events'
          ORDER BY policyname`,
      )
    ).rows;
    const fns = (
      await db.query(
        `SELECT oid::int AS oid, proacl::text[] AS acl, prosecdef, proconfig,
                md5(prosrc) AS body, pg_get_function_identity_arguments(oid) AS args
           FROM pg_proc WHERE proname = 'record_integration_error'`,
      )
    ).rows;
    return {
      webhookAcl: sortedAcl(table.acl),
      rls: table.relrowsecurity,
      policies,
      functions: fns.map((f) => ({ ...f, acl: sortedAcl(f.acl) })),
    };
  };
  const can = async (sql) => (await db.query(sql)).rows[0].v;
  const privileges = async () => ({
    authDelete: await can(
      "SELECT has_table_privilege('authenticated','public.webhook_events','DELETE') AS v",
    ),
    serviceDelete: await can(
      "SELECT has_table_privilege('service_role','public.webhook_events','DELETE') AS v",
    ),
    authExec: await can(`SELECT has_function_privilege('authenticated','${FN}','EXECUTE') AS v`),
    anonExec: await can(`SELECT has_function_privilege('anon','${FN}','EXECUTE') AS v`),
    serviceExec: await can(`SELECT has_function_privilege('service_role','${FN}','EXECUTE') AS v`),
  });

  /** What each person can see and change on webhook_events, apart from DELETE. */
  const readWriteMatrix = async () => {
    const matrix = {};
    for (const [who, uid] of Object.entries(people)) {
      matrix[who] = await asRole("authenticated", uid, async (c) => ({
        visible: (await c.query("SELECT id FROM public.webhook_events ORDER BY id")).rows.map(
          (r) => r.id,
        ),
        updateA1: (
          await attempt(c, "UPDATE public.webhook_events SET attempts = attempts WHERE id = $1", [
            ev.a1,
          ])
        ).n,
        updateB1: (
          await attempt(c, "UPDATE public.webhook_events SET attempts = attempts WHERE id = $1", [
            ev.b1,
          ])
        ).n,
        updateOld: (
          await attempt(c, "UPDATE public.webhook_events SET attempts = attempts WHERE id = $1", [
            ev.old,
          ])
        ).n,
        insert: (await attempt(c, "INSERT INTO public.webhook_events (tenant_id) VALUES ($1)", [A]))
          .code,
      }));
    }
    return matrix;
  };

  /**
   * Can this person delete? Returns rows affected, or the refusal code.
   * `target` is one event id, or "everything" for a DELETE with no WHERE clause.
   * The two differ: a WHERE on a column makes Postgres also apply the SELECT policy, which
   * hides other companies' rows; a DELETE that names no column is judged by the DELETE
   * policy alone.
   */
  const deleteAs = async (role, uid, target) =>
    asRole(role, uid, async (c) => {
      const r =
        target === "everything"
          ? await attempt(c, "DELETE FROM public.webhook_events")
          : await attempt(c, "DELETE FROM public.webhook_events WHERE id = $1", [target]);
      return r.code ?? r.n;
    });
  const recordAs = async (role, uid, tenant, fingerprint) =>
    asRole(role, uid, async (c) => {
      const r = await attempt(c, recordSql, [tenant, fingerprint]);
      return r.code ?? "recorded";
    });

  // ═══ 1. BEFORE: both holes are open ═════════════════════════════════════════
  const before = await snapshot();
  same(before.functions.length, 1, "record_integration_error has exactly one signature");
  ok(
    before.policies.some((p) => p.policyname === "Admins can delete webhook events"),
    "the legacy delete policy is present before the fix",
  );
  ok(
    before.functions[0].acl.some((e) => e.startsWith("authenticated=X")),
    "authenticated can execute before the fix",
  );
  ok(
    before.webhookAcl.some((e) => /^authenticated=[a-zA-Z]*d/.test(e)),
    "authenticated holds DELETE before the fix",
  );
  await seedEvents();
  const beforeMatrix = await readWriteMatrix();
  // Sanity of the matrix itself: it must tell the people apart.
  same(beforeMatrix.adminA.visible, [ev.a1, ev.a2].sort(), "A's admin sees A's events");
  same(beforeMatrix.adminB.visible, [ev.b1, ev.b2].sort(), "B's admin sees B's events");
  same(beforeMatrix.superAdmin.visible, allEvents, "the platform admin sees all");
  same(
    [beforeMatrix.adminA.updateA1, beforeMatrix.adminA.updateB1, beforeMatrix.adminA.updateOld],
    [1, 0, 0],
    "A's admin updates only A's",
  );
  same(beforeMatrix.adminA.insert, "42501", "nobody inserts through the browser role");

  // Naming another company's row by id removes nothing: the WHERE makes Postgres apply the
  // tenant-scoped SELECT policy too. That is why the hole is easy to miss.
  await seedEvents();
  same(
    await deleteAs("authenticated", people.legacyA, ev.b1),
    0,
    "BEFORE: deleting B's event by id removes nothing (the SELECT policy hides it)",
  );
  same(
    await deleteAs("authenticated", people.legacyA, ev.a1),
    1,
    "BEFORE: but A's legacy admin deletes A's own events (the rule names no company)",
  );
  same(
    await deleteAs("authenticated", people.agentA, ev.a2),
    0,
    "BEFORE: a member without the legacy role deletes nothing",
  );
  same(await deleteAs("anon", null, ev.a2), 0, "BEFORE: anon deletes nothing (no policy lets it)");
  // A DELETE that names no column is judged by the DELETE policy alone.
  await seedEvents();
  same(
    await deleteAs("authenticated", people.agentA, "everything"),
    0,
    "BEFORE: a member without the legacy role still deletes nothing",
  );
  same(await deleteAs("anon", null, "everything"), 0, "BEFORE: anon still deletes nothing");
  same(
    await deleteAs("authenticated", people.legacyA, "everything"),
    allEvents.length,
    "BEFORE: A's legacy admin deleted every company's events with one statement (hole 1)",
  );
  await seedEvents();
  same(
    await deleteAs("authenticated", people.adminA, "everything"),
    allEvents.length,
    "BEFORE: so did A's company admin (hole 1)",
  );
  await seedEvents();

  same(
    await recordAs("authenticated", people.agentA, B, "hole-2-before"),
    "recorded",
    "BEFORE: a member of A wrote an integration error into B (hole 2)",
  );
  same((await errorsOf(B)).length, 1, "BEFORE: the row really is in B");
  await db.query("TRUNCATE public.integration_errors");

  // ═══ 2. THE FIX ═══════════════════════════════════════════════════════════
  const applied = await db.query(fix);
  const verdict = applied.at(-1).rows[0];
  same(
    { ...verdict, webhook_delete_policies: Number(verdict.webhook_delete_policies) },
    {
      webhook_delete_policies: 0,
      authenticated_can_delete: false,
      authenticated_can_record: false,
      anon_can_record: false,
      server_can_delete: true,
      server_can_record: true,
    },
    "the migration's own closing SELECT reports the closed state",
  );
  const after = await snapshot();
  const afterPrivileges = await privileges();
  same(
    afterPrivileges,
    {
      authDelete: false,
      serviceDelete: true,
      authExec: false,
      anonExec: false,
      serviceExec: true,
    },
    "privileges after the fix",
  );

  // 2a. webhook_events: nobody in the browser role deletes anything, own company included.
  await seedEvents();
  for (const who of personas) {
    for (const target of [...allEvents, "everything"]) {
      same(
        await deleteAs("authenticated", people[who], target),
        "42501",
        `AFTER: ${who} deleting ${target} is refused outright`,
      );
    }
  }
  for (const target of [...allEvents, "everything"]) {
    // anon keeps the table grant Supabase hands it by default; no policy lets it delete a row.
    same(await deleteAs("anon", null, target), 0, "AFTER: anon still deletes nothing");
  }
  same(await eventIds(), allEvents, "AFTER: every event is still there");
  // The server keeps it.
  same(await deleteAs("service_role", null, ev.b1), 1, "AFTER: the server role deletes an event");
  same(
    await deleteAs("service_role", null, ev.old),
    1,
    "AFTER: and a historical event with no company",
  );
  same((await eventIds()).length, 3, "AFTER: exactly those two went");
  await seedEvents();

  // 2b. SELECT, UPDATE, INSERT and the policies that govern them are exactly as before.
  same(
    await readWriteMatrix(),
    beforeMatrix,
    "AFTER: what each person reads, updates and cannot insert is unchanged",
  );
  const keep = (s) => s.policies.filter((p) => p.policyname !== "Admins can delete webhook events");
  same(
    after.policies,
    keep(before),
    "AFTER: the other policies are untouched, down to their expressions",
  );
  same(
    after.policies.map((p) => p.policyname),
    ["webhook_events_read_tenant", "webhook_events_update_tenant"],
    "AFTER: only the tenant-scoped read and update policies are left",
  );
  same(
    before.webhookAcl.filter((e) => !e.startsWith("authenticated=")),
    after.webhookAcl.filter((e) => !e.startsWith("authenticated=")),
    "AFTER: nobody but `authenticated` had a table grant changed",
  );
  ok(
    after.webhookAcl.some((e) => /^authenticated=[a-zA-Z]*r/.test(e)) &&
      after.webhookAcl.some((e) => /^authenticated=[a-zA-Z]*w/.test(e)),
    "AFTER: authenticated keeps SELECT and UPDATE",
  );
  ok(after.rls, "AFTER: row-level security is still on");

  // 2c. record_integration_error: the browser roles cannot call it, for any company.
  await db.query("TRUNCATE public.integration_errors");
  for (const who of personas) {
    for (const [name, tenant] of [
      ["its own company", A],
      ["another company", B],
    ]) {
      same(
        await recordAs("authenticated", people[who], tenant, `after-${who}`),
        "42501",
        `AFTER: ${who} calling it for ${name} is refused`,
      );
    }
  }
  same(await recordAs("anon", null, B, "after-anon"), "42501", "AFTER: anon is refused");
  same(
    (await db.query("SELECT count(*)::int AS n FROM public.integration_errors")).rows[0].n,
    0,
    "AFTER: nothing was written",
  );
  // Writing the row by hand is still refused too (row-level security), as before.
  same(
    await asRole(
      "authenticated",
      people.legacyA,
      async (c) =>
        (
          await attempt(
            c,
            `INSERT INTO public.integration_errors (tenant_id, platform, friendly_title, friendly_message, fingerprint)
                         VALUES ($1, 'meta', 't', 'm', 'direct')`,
            [B],
          )
        ).code,
    ),
    "42501",
    "AFTER: a direct insert into another company is still refused",
  );
  // The server path works, repeats collapse into one row and count up.
  const first = await asRole(
    "service_role",
    null,
    async (c) => (await c.query(recordSql, [B, "server-1"])).rows[0].id,
  );
  const second = await asRole(
    "service_role",
    null,
    async (c) => (await c.query(recordSql, [B, "server-1"])).rows[0].id,
  );
  same(second, first, "AFTER: the server path still collapses a repeat into the same row");
  same(
    (await errorsOf(B)).map((r) => r.occurrence_count),
    [2],
    "AFTER: and counts the occurrence",
  );
  await asRole("service_role", null, async (c) => c.query(recordSql, [A, "server-2"]));
  // Each company still reads only its own errors.
  for (const [who, expected] of [
    ["adminA", 1],
    ["agentA", 1],
    ["adminB", 1],
  ]) {
    const seen = await asRole(
      "authenticated",
      people[who],
      async (c) => (await c.query("SELECT tenant_id FROM public.integration_errors")).rows,
    );
    same(seen.length, expected, `AFTER: ${who} reads exactly its own company's errors`);
    same(
      seen[0].tenant_id,
      who.endsWith("B") ? B : A,
      `AFTER: ${who} reads the right company's row`,
    );
  }
  await db.query("TRUNCATE public.integration_errors");

  // 2d. The function itself is the same function: body, signature, security mode, pinned search_path.
  same(after.functions.length, 1, "AFTER: still exactly one signature");
  same(
    after.functions.map(({ acl, ...rest }) => rest),
    before.functions.map(({ acl, ...rest }) => rest),
    "AFTER: same oid, same body, still SECURITY DEFINER, search_path still pinned",
  );
  ok(after.functions[0].prosecdef, "AFTER: still SECURITY DEFINER");
  ok(
    after.functions[0].proconfig?.some((c) => c === "search_path=public"),
    "AFTER: search_path is still pinned",
  );
  same(
    after.functions[0].acl.filter((e) => e.startsWith("authenticated=")),
    [],
    "AFTER: no entry for authenticated",
  );
  same(
    after.functions[0].acl.some((e) => e.startsWith("=") || e.startsWith("anon=")),
    false,
    "AFTER: no entry for PUBLIC or anon",
  );

  // ═══ 3. Running it again changes nothing ═════════════════════════════════
  const again = await db.query(fix);
  same(again.at(-1).rows[0], verdict, "a second run reports the same closed state");
  same(await snapshot(), after, "a second run leaves the catalogue exactly as the first did");
  same(await readWriteMatrix(), beforeMatrix, "a second run changes nobody's read or update");

  // ═══ 4. Safe whether or not the second-sign-in gate (a RESTRICTIVE ALL policy) exists ═══
  await db.query(`
    CREATE POLICY mfa_session_gate ON public.webhook_events AS RESTRICTIVE FOR ALL TO authenticated USING (true);
    CREATE POLICY mfa_session_gate ON public.integration_errors AS RESTRICTIVE FOR ALL TO authenticated USING (true);
  `);
  const gated = await db.query(fix);
  same(
    Number(gated.at(-1).rows[0].webhook_delete_policies),
    0,
    "with the gate present, its restrictive ALL policy is not mistaken for a delete grant",
  );
  const gateRows = (
    await db.query(
      "SELECT tablename, permissive, cmd, roles::text AS roles, qual FROM pg_policies WHERE policyname = 'mfa_session_gate' ORDER BY tablename",
    )
  ).rows;
  same(
    gateRows,
    [
      {
        tablename: "integration_errors",
        permissive: "RESTRICTIVE",
        cmd: "ALL",
        roles: "{authenticated}",
        qual: "true",
      },
      {
        tablename: "webhook_events",
        permissive: "RESTRICTIVE",
        cmd: "ALL",
        roles: "{authenticated}",
        qual: "true",
      },
    ],
    "with the gate present, the fix leaves it exactly as it was",
  );
  same(
    await deleteAs("authenticated", people.legacyA, ev.b1),
    "42501",
    "with the gate present, delete is still refused",
  );
  same(
    await recordAs("authenticated", people.agentA, B, "gate"),
    "42501",
    "with the gate present, the function is still closed",
  );
  same(
    await readWriteMatrix(),
    beforeMatrix,
    "with the gate present, reads and updates are unchanged",
  );
  await db.query(`
    DROP POLICY mfa_session_gate ON public.webhook_events;
    DROP POLICY mfa_session_gate ON public.integration_errors;
  `);

  // ═══ 5. Rollback: the text printed in the file restores the old state exactly ═════
  await db.query(rollback);
  same(await snapshot(), before, "ROLLBACK: the catalogue is exactly what it was before the fix");
  same(
    await privileges(),
    {
      authDelete: true,
      serviceDelete: true,
      authExec: true,
      anonExec: false,
      serviceExec: true,
    },
    "ROLLBACK: the privileges are the old ones",
  );
  same(
    await deleteAs("authenticated", people.legacyA, "everything"),
    allEvents.length,
    "ROLLBACK: the hole is open again (so the rollback is real)",
  );
  same(
    await recordAs("authenticated", people.agentA, B, "rolled-back"),
    "recorded",
    "ROLLBACK: the function is open again",
  );
  await seedEvents();
  await db.query("TRUNCATE public.integration_errors");

  // While another session holds a read lock on the table, the file must give up after its own
  // 10 s timeout and change nothing, not queue behind it. The 30 s cap turns "waits for ever"
  // into a failure instead of a hang.
  const holder = new pg.Client(config);
  await holder.connect();
  const blocked = new pg.Client(config);
  await blocked.connect();
  let outcome;
  try {
    await holder.query("BEGIN");
    await holder.query("SELECT count(*) FROM public.webhook_events"); // holds ACCESS SHARE
    const started = Date.now();
    let cap;
    outcome = await Promise.race([
      blocked.query(fix).then(
        () => ({ finished: true }),
        (error) => ({ error }),
      ),
      new Promise((resolve) => {
        cap = setTimeout(() => resolve({ hung: true }), 30000);
      }),
    ]);
    clearTimeout(cap);
    outcome.waited = Date.now() - started;
  } finally {
    await holder.query("ROLLBACK"); // also lets a statement that was still waiting finish
    await holder.end();
  }
  try {
    ok(!outcome.hung, "LOCK TIMEOUT: the file queued behind another session's lock for 30 s");
    ok(!outcome.finished, "LOCK TIMEOUT: the file ran to the end although the table was locked");
    assert.match(outcome.error.message, /lock timeout/);
    checks++;
    ok(
      outcome.waited >= 9000 && outcome.waited < 25000,
      `LOCK TIMEOUT: the file gave up after its own 10 s timeout, not ${outcome.waited} ms`,
    );
    await blocked.query("ROLLBACK");
  } finally {
    await blocked.end();
  }
  same(await snapshot(), before, "LOCK TIMEOUT: nothing at all was changed when the file gave up");
  same(
    await deleteAs("authenticated", people.legacyA, "everything"),
    allEvents.length,
    "LOCK TIMEOUT: the old state is intact",
  );
  await seedEvents();

  // And it closes again once the lock is gone, to the very same end state.
  await db.query(fix);
  same(await snapshot(), after, "RE-APPLY: back to the closed state, identical to the first time");
  same(
    await deleteAs("authenticated", people.legacyA, "everything"),
    "42501",
    "RE-APPLY: delete refused",
  );
  same(
    await recordAs("authenticated", people.agentA, B, "reapplied"),
    "42501",
    "RE-APPLY: function closed",
  );

  // ═══ 6. Migrations dated after the fix leave both holes closed ═════════════════════
  // Today that is the second-sign-in gate: a RESTRICTIVE policy on every table, which must
  // neither be counted as a delete grant by the fix's own check nor reopen anything.
  for (const f of newer) await applyFile(f);
  const verdictAfterNewer = (await db.query(fix)).at(-1).rows[0];
  same(
    Number(verdictAfterNewer.webhook_delete_policies),
    0,
    `with ${newer.length} newer migration(s) applied (${newer.join(", ") || "none"}), no permissive policy grants DELETE`,
  );
  same(
    [verdictAfterNewer.authenticated_can_delete, verdictAfterNewer.authenticated_can_record],
    [false, false],
    "with the newer migrations applied, the browser role still has neither privilege",
  );
  same(
    (
      await db.query(
        `SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'webhook_events'
            AND permissive = 'PERMISSIVE' ORDER BY policyname`,
      )
    ).rows.map((r) => r.policyname),
    ["webhook_events_read_tenant", "webhook_events_update_tenant"],
    "with the newer migrations applied, the permissive policies are still only the tenant-scoped read and update",
  );
  for (const who of personas) {
    same(
      await deleteAs("authenticated", people[who], "everything"),
      "42501",
      `with the newer migrations applied, ${who} deleting every event is still refused outright`,
    );
  }
  same(
    await deleteAs("authenticated", people.legacyA, ev.b1),
    "42501",
    "with the newer migrations applied, deleting another company's event by id is still refused",
  );
  same(
    await recordAs("authenticated", people.agentA, B, "newer"),
    "42501",
    "with the newer migrations applied, record_integration_error is still closed to the browser role",
  );
  same(await eventIds(), allEvents, "with the newer migrations applied, every event is still there");
  same(
    await deleteAs("service_role", null, ev.b1),
    1,
    "with the newer migrations applied, the server role still deletes an event",
  );
  await seedEvents();

  console.log(
    `PASS (${checks} checks): before the fix, one unfiltered DELETE by a legacy admin of company A removed company B's webhook events, and a member of A wrote integration errors into company B; after it the browser roles can do neither (own company included), the server role still does both, read/update/insert behaviour and the other policies are identical, the function body/search_path are unchanged, a second run and a run beside a RESTRICTIVE gate change nothing, the rollback text restores the old state exactly, and a lock timeout leaves everything untouched`,
  );
} finally {
  if (db) await db.end().catch(() => {});
  await server.stop();
}
