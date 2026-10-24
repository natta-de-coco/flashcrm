// Local, disposable PostgreSQL only. Never connects to the live FLAS database.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const runtime = process.env.FLAS_DB_HARNESS_ROOT
  ? createRequire(path.join(process.env.FLAS_DB_HARNESS_ROOT, "package.json"))
  : createRequire(import.meta.url);
const { default: EmbeddedPostgres } = await import(
  pathToFileURL(runtime.resolve("embedded-postgres"))
);
const { default: pg } = await import(pathToFileURL(runtime.resolve("pg")));
const port = Number(process.env.FLAS_STAFF_TEST_PORT ?? 55449);
const server = new EmbeddedPostgres({
  databaseDir: path.resolve(`node_modules/.cache/pg-staff-${Date.now()}`),
  user: "postgres",
  password: "postgres",
  port,
  persistent: false,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});
const sql = fs.readFileSync(
  new URL("../migrations/20261022000000_staff_department_routing_and_alerts.sql", import.meta.url),
  "utf8",
);
const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222";
const ADMIN = "33333333-3333-4333-8333-333333333333",
  STAFF = "44444444-4444-4444-8444-444444444444",
  FOREIGN = "55555555-5555-4555-8555-555555555555";
let db,
  started = false,
  checks = 0;
const equal = (actual, expected) => {
  assert.deepEqual(actual, expected);
  checks++;
};
async function denied(statement) {
  await assert.rejects(db.query(statement), /permission denied|row-level security/);
  checks++;
}
async function role(name, id) {
  await db.query("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.query(`SET ROLE ${name}`);
}
try {
  await server.initialise();
  await server.start();
  started = true;
  db = new pg.Client({
    host: process.platform === "win32" ? "::1" : "127.0.0.1",
    port,
    user: "postgres",
    password: "postgres",
    database: "postgres",
  });
  await db.connect();
  await db.query(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claim.sub',true)::uuid $$;
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
    CREATE TABLE public.organizations(id uuid PRIMARY KEY);
    CREATE TABLE public.profiles(id uuid PRIMARY KEY, tenant_id uuid, staff_role text);
    GRANT SELECT ON public.profiles TO authenticated;
    CREATE TABLE public.tenant_bot_settings(tenant_id uuid PRIMARY KEY);
    CREATE TABLE public.conversations(id uuid PRIMARY KEY);
    INSERT INTO public.organizations VALUES ('${A}'),('${B}');
    INSERT INTO public.profiles VALUES ('${ADMIN}','${A}','company_admin'),('${STAFF}','${A}','staff'),('${FOREIGN}','${B}','company_admin');`);
  await db.query(sql);
  await db.query(sql);
  await db.query(`INSERT INTO public.tenant_staff_routing_numbers(tenant_id,name,phone,department) VALUES
    ('${A}','Synthetic A','+971500000001','sales'),('${B}','Synthetic B','+971500000002','sales');
    INSERT INTO public.tenant_bot_settings(tenant_id) VALUES('${A}');`);
  const defaults = (
    await db.query(
      `SELECT staff_alert_whatsapp_enabled,staff_alert_actor_id,auto_department_handoff_enabled,debounce_window_seconds,multi_crm_coexistence_enabled FROM public.tenant_bot_settings`,
    )
  ).rows;
  equal(defaults, [
    {
      staff_alert_whatsapp_enabled: false,
      staff_alert_actor_id: null,
      auto_department_handoff_enabled: false,
      debounce_window_seconds: 0,
      multi_crm_coexistence_enabled: false,
    },
  ]);
  equal(
    (
      await db.query(
        "SELECT bool_and(notify_on_lead = false) AS off FROM public.tenant_staff_routing_numbers",
      )
    ).rows[0].off,
    true,
  );
  const before = (
    await db.query("SELECT * FROM public.tenant_staff_routing_numbers ORDER BY tenant_id")
  ).rows;
  // Model inherited table, column and PUBLIC grants, plus an overly broad
  // permissive read policy. The rerun must remove every browser write path.
  await db.query(`GRANT ALL ON public.tenant_staff_routing_numbers TO authenticated;
    GRANT UPDATE(phone), INSERT(phone) ON public.tenant_staff_routing_numbers TO authenticated;
    GRANT SELECT(phone) ON public.tenant_staff_routing_numbers TO PUBLIC;
    CREATE POLICY inherited_wide_read ON public.tenant_staff_routing_numbers FOR SELECT TO authenticated USING(true);`);
  await db.query(sql);
  equal(
    (await db.query("SELECT * FROM public.tenant_staff_routing_numbers ORDER BY tenant_id")).rows,
    before,
  );
  for (const [id, tenant, count] of [
    [ADMIN, A, 1],
    [STAFF, A, 0],
    [FOREIGN, B, 1],
  ]) {
    await role("authenticated", id);
    const visible = (await db.query("SELECT tenant_id FROM public.tenant_staff_routing_numbers"))
      .rows;
    equal(visible.length, count);
    if (count) equal(visible[0].tenant_id, tenant);
    await denied(
      `INSERT INTO public.tenant_staff_routing_numbers(tenant_id,name,phone,department) VALUES('${tenant}','Synthetic','+971500000099','sales')`,
    );
    await denied("UPDATE public.tenant_staff_routing_numbers SET phone='+971500000099'");
    await denied("DELETE FROM public.tenant_staff_routing_numbers");
    await denied("TRUNCATE public.tenant_staff_routing_numbers");
    equal(
      (
        await db.query(
          "SELECT has_column_privilege('authenticated','public.tenant_staff_routing_numbers','phone','UPDATE') AS allowed",
        )
      ).rows[0].allowed,
      false,
    );
  }
  await role("anon", STAFF);
  await denied("SELECT phone FROM public.tenant_staff_routing_numbers");
  await role("service_role", ADMIN);
  const row = (
    await db.query(
      `INSERT INTO public.tenant_staff_routing_numbers(tenant_id,name,phone,department) VALUES('${A}','Synthetic server-created','+971500000003','reception') RETURNING id`,
    )
  ).rows[0];
  equal(Boolean(row.id), true);
  equal(
    (
      await db.query(
        "UPDATE public.tenant_staff_routing_numbers SET name='Synthetic updated' WHERE id=$1 RETURNING id",
        [row.id],
      )
    ).rowCount,
    1,
  );
  equal(
    (
      await db.query("DELETE FROM public.tenant_staff_routing_numbers WHERE id=$1 RETURNING id", [
        row.id,
      ])
    ).rowCount,
    1,
  );
  await assert.rejects(
    db.query(
      `INSERT INTO public.tenant_staff_routing_numbers(tenant_id,name,phone,department) VALUES('${A}','Synthetic duplicate','971 500 000 001','sales')`,
    ),
    /duplicate key/,
  );
  checks++;
  await db.query("RESET ROLE");
  // Existing duplicates stop the whole transaction; customer rows are never merged/deleted.
  await db.query("DROP INDEX public.staff_routing_tenant_phone_unique");
  await db.query(
    `INSERT INTO public.tenant_staff_routing_numbers(tenant_id,name,phone,department) VALUES('${A}','Synthetic collision','971 500 000 001','sales')`,
  );
  const collisionRows = (
    await db.query("SELECT * FROM public.tenant_staff_routing_numbers ORDER BY id")
  ).rows;
  await assert.rejects(db.query(sql), /unique index|duplicate/);
  checks++;
  await db.query("ROLLBACK");
  equal(
    (await db.query("SELECT * FROM public.tenant_staff_routing_numbers ORDER BY id")).rows,
    collisionRows,
  );
  console.log(
    `Staff routing database checks: ${checks} passed; fresh/rerun, real roles, column grants, restrictive isolation, service CRUD and non-destructive duplicate refusal.`,
  );
} finally {
  if (db) await db.end();
  if (started) await server.stop();
}
