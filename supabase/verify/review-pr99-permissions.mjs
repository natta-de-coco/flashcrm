// Disposable PostgreSQL permission characterization; never a remote database.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const requireRuntime = process.env.FLAS_DB_HARNESS_ROOT
  ? createRequire(path.join(process.env.FLAS_DB_HARNESS_ROOT, "package.json"))
  : createRequire(import.meta.url);
const { default: EmbeddedPostgres } = await import(
  pathToFileURL(requireRuntime.resolve("embedded-postgres"))
);
const { default: pg } = await import(pathToFileURL(requireRuntime.resolve("pg")));
const server = new EmbeddedPostgres({
  databaseDir: path.resolve(".pgdata-pr99-permissions"),
  user: "postgres",
  password: "postgres",
  port: 55448,
  persistent: false,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});
let client,
  started = false;
try {
  await server.initialise();
  await server.start();
  started = true;
  client = new pg.Client({
    host: "::1",
    port: 55448,
    user: "postgres",
    password: "postgres",
    database: "postgres",
  });
  await client.connect();
  await client.query(`
    CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claim.sub',true)::uuid $$;
    GRANT USAGE ON SCHEMA public,auth TO authenticated,service_role;
    CREATE TABLE public.organizations(id uuid PRIMARY KEY);
    CREATE TABLE public.profiles(id uuid PRIMARY KEY,tenant_id uuid,staff_role text);
    GRANT SELECT ON public.profiles TO authenticated;
    CREATE TABLE public.tenant_bot_settings(tenant_id uuid PRIMARY KEY);
    CREATE TABLE public.conversations(id uuid PRIMARY KEY);
    INSERT INTO public.organizations VALUES ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002');
    INSERT INTO public.profiles VALUES ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','staff');
  `);
  const migration = fs.readFileSync(
    "supabase/migrations/20261022000000_staff_department_routing_and_alerts.sql",
    "utf8",
  );
  await client.query(migration);
  await client.query(migration);
  await client.query(
    `INSERT INTO public.tenant_staff_routing_numbers(tenant_id,name,phone,department) VALUES ('00000000-0000-4000-8000-000000000002','Synthetic other workspace','+971500000002','sales')`,
  );
  await client.query("SET ROLE authenticated");
  await client.query(
    "SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',false)",
  );
  assert.equal(
    (await client.query("SELECT * FROM public.tenant_staff_routing_numbers")).rowCount,
    0,
    "other workspace SELECT should remain isolated",
  );
  const created = await client.query(
    `INSERT INTO public.tenant_staff_routing_numbers(tenant_id,name,phone,department) VALUES ('00000000-0000-4000-8000-000000000001','Synthetic unauthorized recipient','+971500000003','sales') RETURNING id`,
  );
  assert.equal(created.rowCount, 1);
  console.log(
    "CONFIRMED: RLS permits a non-admin member to add an alert recipient in their own workspace; other-workspace SELECT remains blocked.",
  );
  const rights = (
    await client.query(
      "SELECT has_table_privilege('authenticated','public.tenant_staff_routing_numbers','TRUNCATE') AS allowed",
    )
  ).rows[0];
  assert.equal(rights.allowed, true);
  await client.query("TRUNCATE public.tenant_staff_routing_numbers");
  await client.query("RESET ROLE");
  assert.equal(
    (await client.query("SELECT count(*)::int AS n FROM public.tenant_staff_routing_numbers"))
      .rows[0].n,
    0,
  );
  console.log(
    "CONFIRMED: GRANT ALL also grants TRUNCATE, which bypasses row policies when SQL executes as authenticated. This does not establish a browser REST TRUNCATE endpoint.",
  );
} finally {
  if (client) await client.end();
  if (started) await server.stop();
}
