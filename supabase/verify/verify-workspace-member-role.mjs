// Runs the workspace-member migration in a real Postgres and checks, per role,
// what each function does. Both functions are SECURITY DEFINER and exist to
// close a race (a person accepting an invitation to another workspace while an
// admin removes or re-roles them here), so the claims that matter are proved by
// doing them: who may call them, what they refuse, and what two overlapping
// sessions end up with -- not by reading the SQL.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

const PORT = 54972;
const server = new EmbeddedPostgres({
  databaseDir: path.resolve(`node_modules/.cache/pg-workspace-member-role-${Date.now()}`),
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

const sql = (name) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
const MIGRATION = "20261014100000_workspace_member_role_atomic.sql";

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const TENANT_A = "aaaaaaaa-0000-0000-0000-000000000001";
const TENANT_B = "bbbbbbbb-0000-0000-0000-000000000001";
const TENANT_C = "cccccccc-0000-0000-0000-000000000001";
const U = {
  adminA1: id(1),
  adminA2: id(2),
  staffA: id(3),
  mktA: id(4),
  adminB1: id(5),
  staffB: id(6),
  loner: id(7), // belongs to no workspace
  mover: id(8), // staff of A; the invitation to B lands while A removes them
  mover2: id(9), // same, the other way round
  onlyC: id(10), // the one and only admin of C
  staffC: id(11),
  ghost: id(99), // never had a profile
};

let passed = 0;
const step = (name) => {
  passed += 1;
  console.log(`  ok ${String(passed).padStart(2, " ")}  ${name}`);
};

let db;
const open = [];
try {
  await server.initialise();
  await server.start();
  db = new pg.Client(config);
  await db.connect();

  // The tables as the earlier migrations leave them, and the real trigger that
  // refuses a change of staff_role / tenant_id from anything but the server:
  // the functions run as their owner, so this proves they get past it.
  await db.query(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('test.user_id', true), '')::uuid $$;
    CREATE TYPE public.app_role AS ENUM ('admin','agent');
    CREATE TYPE public.staff_role AS ENUM
      ('super_admin','company_admin','marketing_manager','staff','seo_editor');
    CREATE TABLE public.organizations (id uuid PRIMARY KEY);
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      full_name text, email text, avatar_url text, last_seen_at timestamptz,
      suspended boolean NOT NULL DEFAULT false,
      tenant_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
      staff_role public.staff_role NOT NULL DEFAULT 'staff'
    );
    GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
    GRANT ALL ON public.profiles TO service_role;
    CREATE TABLE public.user_roles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      role public.app_role NOT NULL,
      UNIQUE (user_id, role)
    );
    GRANT SELECT ON public.user_roles TO authenticated;
    GRANT ALL ON public.user_roles TO service_role;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
  `);
  await db.query(sql("20260926090000_profiles_privilege_columns_are_server_only.sql"));
  const migration = sql(MIGRATION);
  await db.query(migration);

  const seed = async () => {
    await db.query("TRUNCATE public.user_roles, public.profiles, auth.users, public.organizations CASCADE");
    await db.query(
      `INSERT INTO public.organizations VALUES ('${TENANT_A}'), ('${TENANT_B}'), ('${TENANT_C}')`,
    );
    const people = [
      [U.adminA1, TENANT_A, "company_admin", "admin"],
      [U.adminA2, TENANT_A, "company_admin", "admin"],
      [U.staffA, TENANT_A, "staff", "agent"],
      [U.mktA, TENANT_A, "marketing_manager", "agent"],
      [U.adminB1, TENANT_B, "company_admin", "admin"],
      [U.staffB, TENANT_B, "staff", "agent"],
      [U.loner, null, "staff", "agent"],
      [U.mover, TENANT_A, "staff", "agent"],
      [U.mover2, TENANT_A, "staff", "agent"],
      [U.onlyC, TENANT_C, "company_admin", "admin"],
      [U.staffC, TENANT_C, "staff", "agent"],
    ];
    for (const [user, tenant, staffRole, legacy] of people) {
      await db.query("INSERT INTO auth.users (id) VALUES ($1)", [user]);
      await db.query("INSERT INTO public.profiles (id, tenant_id, staff_role) VALUES ($1, $2, $3)", [
        user,
        tenant,
        staffRole,
      ]);
      await db.query("INSERT INTO public.user_roles (user_id, role) VALUES ($1, $2)", [user, legacy]);
    }
  };
  const profile = async (user) =>
    (await db.query("SELECT tenant_id, staff_role FROM public.profiles WHERE id = $1", [user]))
      .rows[0];
  const legacyAdmin = async (user) =>
    (
      await db.query(
        "SELECT count(*)::int AS n FROM public.user_roles WHERE user_id = $1 AND role = 'admin'",
        [user],
      )
    ).rows[0].n === 1;
  const everything = async () =>
    JSON.stringify([
      (await db.query("SELECT id, tenant_id, staff_role FROM public.profiles ORDER BY id")).rows,
      (await db.query("SELECT user_id, role FROM public.user_roles ORDER BY user_id, role")).rows,
    ]);

  const connect = async (role) => {
    const client = new pg.Client(config);
    await client.connect();
    open.push(client);
    if (role) await client.query(`SET ROLE ${role}`);
    const pid = (await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    return { client, pid };
  };
  const remove = (tenant, user) => `SELECT public.remove_workspace_member('${tenant}', '${user}') AS r`;
  const setRole = (tenant, user, role) =>
    `SELECT public.set_workspace_member_role('${tenant}', '${user}', ${role === null ? "NULL" : `'${role}'`}) AS r`;
  const outcome = (client, text) =>
    client.query(text).then(
      (result) => ({ result }),
      (error) => ({ error }),
    );
  const untilBlocked = async (pid) => {
    for (let i = 0; i < 200; i += 1) {
      const waiting = await db.query(
        "SELECT 1 FROM pg_stat_activity WHERE pid = $1 AND wait_event_type = 'Lock'",
        [pid],
      );
      if (waiting.rowCount > 0) return;
      await sleep(25);
    }
    assert.fail("the second session was never made to wait: the row lock is not doing its job");
  };

  console.log("workspace member functions");

  // 1. Who may call them. Not the signed-in browser role, not an anonymous
  //    visitor, not PUBLIC: only the server's role.
  await seed();
  const before = await everything();
  for (const role of ["anon", "authenticated"]) {
    const { client } = await connect(role);
    await assert.rejects(client.query(remove(TENANT_A, U.staffA)), /permission denied/);
    await assert.rejects(client.query(setRole(TENANT_A, U.staffA, "company_admin")), /permission denied/);
  }
  assert.equal(await everything(), before, "a refused call changed something");
  const catalog = (
    await db.query(`
      SELECT p.proname, p.prosecdef, p.proconfig, p.proacl::text AS acl,
             has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_run,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_run,
             has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_run
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname IN ('remove_workspace_member', 'set_workspace_member_role')
       ORDER BY p.proname`)
  ).rows;
  assert.equal(catalog.length, 2);
  for (const fn of catalog) {
    assert.equal(fn.prosecdef, true, `${fn.proname} is not SECURITY DEFINER`);
    assert.ok(
      fn.proconfig?.some((c) => c.replace(/\s/g, "") === "search_path=public,pg_temp"),
      `${fn.proname} does not pin its search_path`,
    );
    assert.equal(fn.anon_run, false);
    assert.equal(fn.authenticated_run, false);
    assert.equal(fn.service_run, true);
    assert.ok(!/(^\{|,)=X\//.test(fn.acl), `${fn.proname} is executable by PUBLIC: ${fn.acl}`);
  }
  step("anon, authenticated and PUBLIC cannot execute either function; service_role can; definer with pinned search_path");

  // 2. A member is removed: profile cleared and admin row gone, in one call.
  const server1 = await connect("service_role");
  let r = await server1.client.query(remove(TENANT_A, U.adminA2));
  assert.equal(r.rows[0].r, true);
  assert.deepEqual(await profile(U.adminA2), { tenant_id: null, staff_role: "staff" });
  assert.equal(await legacyAdmin(U.adminA2), false, "the admin row outlived the removal");
  assert.deepEqual(await profile(U.adminA1), { tenant_id: TENANT_A, staff_role: "company_admin" });
  assert.equal(await legacyAdmin(U.adminA1), true, "the other admin was touched");
  r = await server1.client.query(remove(TENANT_A, U.staffA));
  assert.equal(r.rows[0].r, true);
  assert.deepEqual(await profile(U.staffA), { tenant_id: null, staff_role: "staff" });
  assert.deepEqual(await profile(U.mktA), { tenant_id: TENANT_A, staff_role: "marketing_manager" });
  step("a member is removed: profile cleared and legacy admin row deleted in one call, nobody else touched");

  // 3. The finding itself, in sequence: the person already moved to another
  //    company (profile there, admin row there). Nothing of that company is touched.
  await seed();
  const moveElsewhere = async (user) => {
    await db.query("UPDATE public.profiles SET tenant_id = $1, staff_role = 'company_admin' WHERE id = $2", [
      TENANT_B,
      user,
    ]);
    await db.query("INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'admin')", [user]);
  };
  await moveElsewhere(U.mover);
  const moved = await everything();
  r = await server1.client.query(remove(TENANT_A, U.mover));
  assert.equal(r.rows[0].r, false);
  r = await server1.client.query(setRole(TENANT_A, U.mover, "staff"));
  assert.equal(r.rows[0].r, false);
  r = await server1.client.query(setRole(TENANT_A, U.mover, "company_admin"));
  assert.equal(r.rows[0].r, false);
  assert.equal(await everything(), moved, "a person of another company was changed");
  assert.deepEqual(await profile(U.mover), { tenant_id: TENANT_B, staff_role: "company_admin" });
  assert.equal(await legacyAdmin(U.mover), true, "the other company's admin row was deleted");
  step("target already moved to another company: false from both, that company's profile and admin row untouched");

  // 4. The same thing as a real overlap. Session 1 plays claimInvites: it moves
  //    the profile first (and holds that row until it commits), then writes the
  //    admin row. Session 2 is the admin's removal, started in between.
  await seed();
  const claim = await connect("service_role");
  const admin = await connect("service_role");
  await claim.client.query("BEGIN");
  await claim.client.query(
    `UPDATE public.profiles SET tenant_id = '${TENANT_B}', staff_role = 'company_admin' WHERE id = '${U.mover}'`,
  );
  const removal = outcome(admin.client, remove(TENANT_A, U.mover));
  await untilBlocked(admin.pid);
  await claim.client.query(
    `INSERT INTO public.user_roles (user_id, role) VALUES ('${U.mover}', 'admin') ON CONFLICT (user_id, role) DO NOTHING`,
  );
  await claim.client.query("COMMIT");
  const settled = await removal;
  assert.equal(settled.error, undefined);
  assert.equal(settled.result.rows[0].r, false, "removed someone who had already joined another company");
  assert.deepEqual(await profile(U.mover), { tenant_id: TENANT_B, staff_role: "company_admin" });
  assert.equal(await legacyAdmin(U.mover), true, "the invitation's admin role was deleted by the removal");
  step("removal overlapping an invitation being accepted waits for it, then answers false: the new company keeps its admin");

  //    ...and a role change in the same overlap.
  await seed();
  await claim.client.query("BEGIN");
  await claim.client.query(
    `UPDATE public.profiles SET tenant_id = '${TENANT_B}', staff_role = 'company_admin' WHERE id = '${U.mover}'`,
  );
  const demotion = outcome(admin.client, setRole(TENANT_A, U.mover, "staff"));
  await untilBlocked(admin.pid);
  await claim.client.query(
    `INSERT INTO public.user_roles (user_id, role) VALUES ('${U.mover}', 'admin') ON CONFLICT (user_id, role) DO NOTHING`,
  );
  await claim.client.query("COMMIT");
  const demoted = await demotion;
  assert.equal(demoted.result.rows[0].r, false);
  assert.deepEqual(await profile(U.mover), { tenant_id: TENANT_B, staff_role: "company_admin" });
  assert.equal(await legacyAdmin(U.mover), true, "a role change here demoted them in the new company");
  step("role change overlapping an invitation being accepted waits, then answers false: the new company keeps its admin");

  //    The other order: the removal gets there first. The invitation then lands
  //    on a person who is simply unattached, and ends up whole.
  await seed();
  await admin.client.query("BEGIN");
  r = await admin.client.query(remove(TENANT_A, U.mover2));
  assert.equal(r.rows[0].r, true);
  const late = outcome(
    claim.client,
    `UPDATE public.profiles SET tenant_id = '${TENANT_B}', staff_role = 'company_admin' WHERE id = '${U.mover2}'`,
  );
  await untilBlocked(claim.pid);
  await admin.client.query("COMMIT");
  assert.equal((await late).error, undefined);
  await db.query("INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'admin')", [U.mover2]);
  assert.deepEqual(await profile(U.mover2), { tenant_id: TENANT_B, staff_role: "company_admin" });
  assert.equal(await legacyAdmin(U.mover2), true);
  step("removal first, invitation second: the invitation waits for the removal and then lands whole");

  // 5. Nobody to act on: never a member, no workspace, someone else's, no such id.
  await seed();
  const untouched = await everything();
  for (const user of [U.ghost, U.loner, U.staffB, U.adminB1]) {
    r = await server1.client.query(remove(TENANT_A, user));
    assert.equal(r.rows[0].r, false, `removed ${user}, who is not a member`);
    r = await server1.client.query(setRole(TENANT_A, user, "company_admin"));
    assert.equal(r.rows[0].r, false, `re-roled ${user}, who is not a member`);
  }
  r = await server1.client.query(
    `SELECT public.remove_workspace_member(NULL, '${U.staffA}') AS a, public.remove_workspace_member('${TENANT_A}', NULL) AS b`,
  );
  assert.deepEqual(r.rows[0], { a: false, b: false });
  assert.equal(await everything(), untouched, "a call for a non-member changed something");
  step("an id that was never a member, an unattached profile, another company's people, NULLs: false and nothing changed");

  // 6. The last admin of a company cannot be removed or demoted.
  await assert.rejects(server1.client.query(remove(TENANT_C, U.onlyC)), /last_company_admin/);
  await assert.rejects(server1.client.query(setRole(TENANT_C, U.onlyC, "staff")), /last_company_admin/);
  await assert.rejects(server1.client.query(setRole(TENANT_C, U.onlyC, "seo_editor")), /last_company_admin/);
  assert.equal(await everything(), untouched, "a refused call left something changed");
  r = await server1.client.query(setRole(TENANT_C, U.onlyC, "company_admin"));
  assert.equal(r.rows[0].r, true, "keeping the only admin an admin must be allowed");
  r = await server1.client.query(remove(TENANT_C, U.staffC));
  assert.equal(r.rows[0].r, true, "removing a non-admin must not be blocked by the rule");
  r = await server1.client.query(setRole(TENANT_A, U.adminA2, "staff"));
  assert.equal(r.rows[0].r, true, "with two admins one can be demoted");
  await assert.rejects(server1.client.query(remove(TENANT_A, U.adminA1)), /last_company_admin/);
  await seed();
  r = await server1.client.query(remove(TENANT_A, U.adminA2));
  assert.equal(r.rows[0].r, true, "with two admins one can be removed");
  await assert.rejects(server1.client.query(remove(TENANT_A, U.adminA1)), /last_company_admin/);
  assert.equal(await legacyAdmin(U.adminA1), true);
  step("last company admin refused by name (remove and demote), nothing changed; with two admins one can go");

  //    Two admins at the same moment, each acting on the other.
  for (const [label, act] of [
    ["removing each other", (target) => remove(TENANT_A, target)],
    ["demoting each other", (target) => setRole(TENANT_A, target, "staff")],
  ]) {
    await seed();
    await admin.client.query("BEGIN");
    r = await admin.client.query(act(U.adminA2));
    assert.equal(r.rows[0].r, true);
    const other = outcome(claim.client, act(U.adminA1));
    await untilBlocked(claim.pid);
    await admin.client.query("COMMIT");
    const second = await other;
    assert.match(second.error?.message ?? "", /last_company_admin/, `${label} left a company with none`);
    const admins = (
      await db.query(
        "SELECT count(*)::int AS n FROM public.profiles WHERE tenant_id = $1 AND staff_role = 'company_admin'",
        [TENANT_A],
      )
    ).rows[0].n;
    assert.equal(admins, 1, `${label}: a company ended up with ${admins} admins`);
    assert.equal(await legacyAdmin(U.adminA1), true);
  }
  step("two admins removing, or demoting, each other at the same moment: the second is refused, one admin remains");

  // 7. Role changes keep the two role systems in line.
  await seed();
  const states = [];
  for (const role of ["company_admin", "company_admin", "marketing_manager", "company_admin", "seo_editor", "staff"]) {
    r = await server1.client.query(setRole(TENANT_A, U.staffA, role));
    assert.equal(r.rows[0].r, true);
    const now = await profile(U.staffA);
    assert.equal(now.staff_role, role);
    assert.equal(await legacyAdmin(U.staffA), role === "company_admin", `legacy admin row wrong after ${role}`);
    states.push(role);
  }
  assert.equal(
    (await db.query("SELECT count(*)::int AS n FROM public.user_roles WHERE user_id = $1", [U.staffA])).rows[0].n,
    1,
    "only the agent row should be left after the last demotion",
  );
  r = await server1.client.query(setRole(TENANT_A, U.adminA2, "marketing_manager"));
  assert.equal(r.rows[0].r, true);
  assert.equal(await legacyAdmin(U.adminA2), false, "a demoted admin kept the legacy admin row");
  assert.equal(await legacyAdmin(U.adminA1), true, "someone else's admin row was removed");
  step("role change to and from company admin keeps the legacy row in line (idempotent, nobody else touched)");

  // 8. A role the app does not use is refused, before anything is looked up.
  const roles = await everything();
  for (const bad of ["super_admin", "owner", "Company_Admin", "", "admin", null]) {
    await assert.rejects(
      server1.client.query(setRole(TENANT_A, U.staffA, bad)),
      /invalid_role/,
      `accepted the role ${JSON.stringify(bad)}`,
    );
  }
  await assert.rejects(server1.client.query(setRole(TENANT_B, U.ghost, "owner")), /invalid_role/);
  assert.equal(await everything(), roles, "a refused role changed something");
  step("a role the app does not use (super_admin, unknown, wrong case, empty, NULL) is refused, nothing changed");

  // 9. Running the migration again changes no one's data and keeps the grants.
  const beforeRerun = await everything();
  const rerun = await db.query(migration);
  assert.equal(await everything(), beforeRerun);
  const final = Array.isArray(rerun) ? rerun.at(-1) : rerun;
  assert.equal(final.rowCount, 2, "the migration's closing check did not report both functions");
  for (const row of final.rows) {
    assert.equal(row.service_role_can_run, true);
    assert.equal(row.anon_can_run, false);
    assert.equal(row.authenticated_can_run, false);
  }
  const { client: anon } = await connect("anon");
  await assert.rejects(anon.query(remove(TENANT_A, U.staffA)), /permission denied/);
  r = await server1.client.query(setRole(TENANT_A, U.staffA, "staff"));
  assert.equal(r.rows[0].r, true);
  step("the migration runs twice without error, changes no data, keeps the grants, and its closing check reports both functions");

  console.log(`PASS: ${passed} cases`);
} finally {
  for (const client of open) await client.end().catch(() => {});
  if (db) await db.end();
  await server.stop();
}
