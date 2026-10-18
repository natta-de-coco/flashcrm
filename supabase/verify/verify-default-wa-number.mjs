// Runs the default-number migration in a real Postgres, on the schema the
// earlier migrations really leave, and checks what each role can do with it.
//
// The claim to prove is "all or nothing": switching a workspace's default
// WhatsApp number either moves the default or leaves it exactly where it was.
// That is shown by making the second write fail, in the old way (two separate
// statements, which leaves the workspace with no default) and in the new way
// (one call, which does not). Roles, other workspaces, a second administrator
// switching at the same moment, and running the file twice are checked too.
//
//   npm install --no-save --package-lock=false embedded-postgres@17.10.0-beta.17 pg@8.23.0
//   node supabase/verify/verify-default-wa-number.mjs
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(HERE, "..", "migrations");
const MIGRATION = "20261007120000_set_default_wa_number.sql";
const PORT = 54997;

const server = new EmbeddedPostgres({
  databaseDir: path.resolve(`node_modules/.cache/pg-default-wa-number-${Date.now()}`),
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

const A = "aaaaaaaa-0000-0000-0000-000000000001";
const B = "bbbbbbbb-0000-0000-0000-000000000001";
const A1 = "aaaaaaaa-0000-0000-0000-0000000000a1";
const A2 = "aaaaaaaa-0000-0000-0000-0000000000a2";
const A3 = "aaaaaaaa-0000-0000-0000-0000000000a3";
const B1 = "bbbbbbbb-0000-0000-0000-0000000000b1";
const B2 = "bbbbbbbb-0000-0000-0000-0000000000b2";

const connect = async () => {
  const client = new pg.Client(config);
  await client.connect();
  await client.query("SET search_path TO public, extensions");
  return client;
};

let db;
try {
  await server.initialise();
  await server.start();
  db = await connect();

  // The schema as every migration before this one leaves it -- real grants,
  // real policies, the real per-workspace index -- not a hand-built copy.
  await db.query(readFileSync(path.join(HERE, "supabase-shim.sql"), "utf8"));
  // What Supabase does for every function created in public: callable by
  // anon, authenticated and service_role unless the migration revokes it. The
  // shim alone leaves these roles without it, which would let a missing
  // REVOKE go unnoticed.
  await db.query(
    "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role",
  );
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql") && f < MIGRATION)
    .sort();
  for (const file of files) {
    try {
      await db.query(readFileSync(path.join(MIGRATIONS, file), "utf8"));
    } catch (error) {
      await db.query("ROLLBACK").catch(() => {});
      throw new Error(`${file} did not apply: ${error.message}`);
    }
  }

  const index = await db.query(
    "SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='wa_numbers' AND indexname='wa_numbers_single_default_per_tenant'",
  );
  assert.equal(index.rowCount, 1, "the per-workspace default index is the schema under test");

  await db.query(
    `INSERT INTO public.organizations (id, name, slug) VALUES ('${A}','Alpha','alpha'), ('${B}','Beta','beta')`,
  );
  const seed = () =>
    db.query(`
      DELETE FROM public.wa_numbers;
      INSERT INTO public.wa_numbers (id, tenant_id, label, phone_number_id, access_token, is_default) VALUES
        ('${A1}','${A}','A one','pn-a1','t',true),
        ('${A2}','${A}','A two','pn-a2','t',false),
        ('${A3}','${A}','A three','pn-a3','t',false),
        ('${B1}','${B}','B one','pn-b1','t',true),
        ('${B2}','${B}','B two','pn-b2','t',false);
    `);
  const defaultsOf = async (tenant) =>
    (
      await db.query(
        "SELECT id FROM public.wa_numbers WHERE tenant_id=$1 AND is_default ORDER BY id",
        [tenant],
      )
    ).rows.map((r) => r.id);

  // The migration itself, twice.
  const migration = readFileSync(path.join(MIGRATIONS, MIGRATION), "utf8");
  await db.query(migration);
  await db.query(migration);

  const signature = "public.set_default_wa_number(uuid, uuid)";
  const as = async (role, sql, params = []) => {
    const client = await connect();
    try {
      await client.query(`SET ROLE ${role}`);
      return await client.query(sql, params);
    } finally {
      await client.end();
    }
  };
  const call = (role, tenant, number) =>
    as(role, "SELECT public.set_default_wa_number($1, $2) AS id", [tenant, number]);

  // ── 1. Who may call it ────────────────────────────────────────────────────
  await seed();
  for (const role of ["anon", "authenticated"]) {
    await assert.rejects(call(role, A, A2), /permission denied for function set_default_wa_number/);
  }
  assert.deepEqual(await defaultsOf(A), [A1], "a refused call changed nothing");
  const privileges = (
    await db.query(
      `SELECT has_function_privilege('anon', '${signature}', 'EXECUTE') AS anon,
              has_function_privilege('authenticated', '${signature}', 'EXECUTE') AS authenticated,
              has_function_privilege('service_role', '${signature}', 'EXECUTE') AS service_role,
              p.prosecdef AS runs_as_owner
         FROM pg_proc p WHERE p.oid = '${signature}'::regprocedure`,
    )
  ).rows[0];
  assert.deepEqual(privileges, {
    anon: false,
    authenticated: false,
    service_role: true,
    runs_as_owner: false,
  });

  // ── 2. The switch itself, for the server's role ───────────────────────────
  assert.equal((await call("service_role", A, A2)).rows[0].id, A2);
  assert.deepEqual(await defaultsOf(A), [A2], "one default, the new one");
  assert.deepEqual(await defaultsOf(B), [B1], "another workspace is untouched");
  // Switching to the number that is already the default changes nothing.
  assert.equal((await call("service_role", A, A2)).rows[0].id, A2);
  assert.deepEqual(await defaultsOf(A), [A2]);
  // A workspace with no default at all gets one.
  await db.query(`UPDATE public.wa_numbers SET is_default=false WHERE tenant_id='${A}'`);
  assert.equal((await call("service_role", A, A3)).rows[0].id, A3);
  assert.deepEqual(await defaultsOf(A), [A3]);

  // ── 3. Whose number it is ─────────────────────────────────────────────────
  await seed();
  await assert.rejects(call("service_role", A, B2), (error) => {
    assert.equal(error.code, "P0002");
    assert.match(error.message, /not connected to this workspace/);
    return true;
  });
  await assert.rejects(call("service_role", B, A2), (error) => error.code === "P0002");
  await assert.rejects(
    call("service_role", A, "00000000-0000-0000-0000-000000000000"),
    (error) => error.code === "P0002",
  );
  await assert.rejects(call("service_role", A, null), (error) => error.code === "22004");
  await assert.rejects(call("service_role", null, A2), (error) => error.code === "22004");
  assert.deepEqual(await defaultsOf(A), [A1], "a refused switch leaves the default where it was");
  assert.deepEqual(await defaultsOf(B), [B1]);

  // ── 4. All or nothing: the second write fails ─────────────────────────────
  // A trigger that refuses to make A2 the default, standing in for any reason
  // the second write can fail (a timeout, a lock, a constraint).
  await db.query(`
    CREATE FUNCTION public.refuse_a2_default() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.id = '${A2}' AND NEW.is_default THEN
        RAISE EXCEPTION 'the second write failed' USING ERRCODE = '57014';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER refuse_a2_default BEFORE UPDATE ON public.wa_numbers
      FOR EACH ROW EXECUTE FUNCTION public.refuse_a2_default();
  `);
  await seed();

  // The way it used to be done: two statements, each its own transaction.
  const old = await connect();
  await old.query(
    "UPDATE public.wa_numbers SET is_default=false WHERE tenant_id=$1 AND is_default",
    [A],
  );
  await assert.rejects(
    old.query("UPDATE public.wa_numbers SET is_default=true WHERE id=$1", [A2]),
    /the second write failed/,
  );
  await old.end();
  assert.deepEqual(
    await defaultsOf(A),
    [],
    "two separate writes leave the workspace with no default",
  );

  // The same failure inside the function.
  await seed();
  await assert.rejects(call("service_role", A, A2), (error) => {
    assert.equal(error.code, "57014");
    return true;
  });
  assert.deepEqual(await defaultsOf(A), [A1], "one call keeps the previous default");
  assert.deepEqual(await defaultsOf(B), [B1]);
  await db.query("DROP TRIGGER refuse_a2_default ON public.wa_numbers");
  await db.query("DROP FUNCTION public.refuse_a2_default()");

  // ── 5. Two administrators at the same moment ──────────────────────────────
  // Each call clears and then sets. Without taking turns, the second one's
  // "set" collides with the first one's: a unique violation for the loser.
  // A pause inside the "set" keeps the first call open long enough for the
  // second to arrive in the middle of it, which is what a busy moment does.
  await db.query(`
    CREATE FUNCTION public.slow_default() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.is_default AND NOT OLD.is_default THEN PERFORM pg_sleep(0.3); END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER slow_default BEFORE UPDATE ON public.wa_numbers
      FOR EACH ROW EXECUTE FUNCTION public.slow_default();
  `);
  const admins = [await connect(), await connect()];
  for (const admin of admins) await admin.query("SET ROLE service_role");
  try {
    for (let round = 0; round < 6; round += 1) {
      await seed();
      const targets = round % 2 ? [A2, A3] : [A3, A2];
      const results = await Promise.allSettled(
        admins.map((admin, i) =>
          admin.query("SELECT public.set_default_wa_number($1, $2) AS id", [A, targets[i]]),
        ),
      );
      for (const result of results) {
        assert.equal(result.status, "fulfilled", `round ${round}: ${result.reason?.message}`);
      }
      const defaults = await defaultsOf(A);
      assert.equal(defaults.length, 1, `round ${round}: exactly one default, got ${defaults}`);
      assert.ok(targets.includes(defaults[0]), "the default is one of the two that were asked for");
      assert.deepEqual(await defaultsOf(B), [B1]);
    }
  } finally {
    for (const admin of admins) await admin.end();
  }
  await db.query("DROP TRIGGER slow_default ON public.wa_numbers");
  await db.query("DROP FUNCTION public.slow_default()");

  // ── 6. Run again: nothing changes ─────────────────────────────────────────
  await seed();
  await db.query(migration);
  assert.deepEqual(await defaultsOf(A), [A1]);
  assert.deepEqual(await defaultsOf(B), [B1]);

  console.log(
    "PASS: anon and signed-in users denied, server role switches, other workspaces and unknown numbers refused, a failing second write keeps the previous default (two separate writes lose it), overlapping switches take turns and leave one default, migration safe to run twice",
  );
} finally {
  if (db) await db.end();
  await server.stop();
}
