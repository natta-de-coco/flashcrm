import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
const prerequisite = fs.readFileSync(
  new URL("../migrations/20261016142000_settings_alert_prerequisites.sql", import.meta.url),
  "utf8",
);
const legacyMigration = fs.readFileSync(
  new URL("../migrations/20261010010000_enterprise_growth_pillars.sql", import.meta.url),
  "utf8",
);
const legacyAlertTables = ["tenant_alert_settings", "lead_alerts_log"].map((table) => {
  const statement = legacyMigration.match(
    new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table} \\([\\s\\S]*?\\n\\);`),
  )?.[0];
  assert.ok(statement, `Historical ${table} schema is available for the compatibility test`);
  return statement;
});
const migration = fs.readFileSync(
  new URL("../migrations/20261014180000_lead_alert_preferences_server_only.sql", import.meta.url),
  "utf8",
);
const notificationMigration = fs.readFileSync(
  new URL("../migrations/20261014181000_workspace_notifications.sql", import.meta.url),
  "utf8",
);
const A = "aaaaaaaa-0000-0000-0000-000000000001",
  B = "bbbbbbbb-0000-0000-0000-000000000001";
const ADMIN = "aaaaaaaa-0000-0000-0000-000000000002",
  STAFF = "aaaaaaaa-0000-0000-0000-000000000003",
  FOREIGN = "bbbbbbbb-0000-0000-0000-000000000002";
const port = Number(process.env["FLAS_SETTINGS_TEST_PORT"] ?? 54982);
assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535, "Invalid local test port");
const server = new EmbeddedPostgres({
  databaseDir: path.resolve(`node_modules/.cache/pg-settings-${Date.now()}`),
  user: "postgres",
  password: "postgres",
  port,
  persistent: false,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});
let db;
async function rejectedPrerequisite(pattern) {
  try {
    await assert.rejects(db.query(prerequisite), pattern);
  } finally {
    // A rejected transactional migration must be rolled back before inspection.
    await db.query("ROLLBACK");
  }
}
async function alertRows() {
  return (
    await db.query(`SELECT jsonb_build_object(
      'settings',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY tenant_id),'[]'::jsonb) FROM public.tenant_alert_settings t),
      'evidence',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM public.lead_alerts_log t)) AS rows`)
  ).rows[0].rows;
}
async function assertAlertIsolation() {
  for (const [user, tenant, count] of [
    [ADMIN, A, 1],
    [STAFF, A, 0],
    [FOREIGN, B, 1],
  ]) {
    await db.query(`SET "test.user"='${user}'; SET ROLE authenticated`);
    for (const table of ["tenant_alert_settings", "lead_alerts_log"]) {
      const result = await db.query(`SELECT tenant_id FROM public.${table}`);
      assert.equal(result.rowCount, count);
      if (count) assert.equal(result.rows[0].tenant_id, tenant);
    }
    for (const sql of [
      "UPDATE public.tenant_alert_settings SET lead_alerts_enabled=false",
      "DELETE FROM public.tenant_alert_settings",
      `INSERT INTO public.tenant_alert_settings(tenant_id) VALUES('${STAFF}')`,
      "UPDATE public.lead_alerts_log SET status='sent'",
      "DELETE FROM public.lead_alerts_log",
      `INSERT INTO public.lead_alerts_log(tenant_id,status) VALUES('${A}','sent')`,
    ])
      await assert.rejects(db.query(sql), /permission denied/);
    await db.query("RESET ROLE");
  }
  await db.query("SET ROLE anon");
  for (const table of ["tenant_alert_settings", "lead_alerts_log"])
    await assert.rejects(db.query(`SELECT * FROM public.${table}`), /permission denied/);
  await db.query("RESET ROLE");
  const grants = (
    await db.query(`SELECT
    has_column_privilege('authenticated','public.tenant_alert_settings','lead_alerts_enabled','UPDATE') AS preferences,
    has_column_privilege('authenticated','public.lead_alerts_log','status','UPDATE') AS evidence`)
  ).rows[0];
  assert.equal(grants.preferences, false);
  assert.equal(grants.evidence, false);
}
try {
  await server.initialise();
  await server.start();
  db = new pg.Client({
    host: "localhost",
    port,
    user: "postgres",
    password: "postgres",
    database: "postgres",
  });
  await db.connect();
  await db.query(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.user',true),'')::uuid$$;
    CREATE TABLE public.profiles(id uuid PRIMARY KEY,tenant_id uuid,staff_role text); GRANT SELECT ON public.profiles TO authenticated;
    CREATE TABLE public.organizations(id uuid PRIMARY KEY);
    INSERT INTO public.organizations VALUES('${A}'),('${B}');
    CREATE TABLE public.leads(id uuid PRIMARY KEY,tenant_id uuid);
    INSERT INTO public.leads VALUES('${ADMIN}','${A}'),('${FOREIGN}','${B}');
    ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY; CREATE POLICY own_profile ON public.profiles FOR SELECT TO authenticated USING(id=auth.uid());
    INSERT INTO public.profiles VALUES('${ADMIN}','${A}','company_admin'),('${STAFF}','${A}','staff'),('${FOREIGN}','${B}','super_admin');
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated,anon,service_role;`);

  // The first table created in a failed prerequisite must not survive when an
  // incompatible second table is already present. No partial permission state.
  await db.query("CREATE TABLE public.lead_alerts_log(id uuid PRIMARY KEY)");
  await rejectedPrerequisite(/column\/default drift/);
  assert.equal(
    (await db.query("SELECT to_regclass('public.tenant_alert_settings') AS relation")).rows[0]
      .relation,
    null,
  );
  await db.query("DROP TABLE public.lead_alerts_log");

  // Fresh live state: both alert tables absent, permissive platform defaults.
  await db.query(prerequisite);
  // Compare canonical definitions exactly: case and spaces inside SQL string
  // literals are meaningful, so text normalization must not hide this drift.
  await db.query(
    "ALTER TABLE public.lead_alerts_log DROP CONSTRAINT lead_alerts_log_alert_channel_check; ALTER TABLE public.lead_alerts_log ADD CONSTRAINT lead_alerts_log_alert_channel_check CHECK(alert_channel IN ('EMAIL','WHATSAPP','IN_APP'))",
  );
  await rejectedPrerequisite(/constraint drift/);
  await db.query(
    "ALTER TABLE public.lead_alerts_log DROP CONSTRAINT lead_alerts_log_alert_channel_check; ALTER TABLE public.lead_alerts_log ADD CONSTRAINT lead_alerts_log_alert_channel_check CHECK(alert_channel IN ('email','whatsapp','in_app'))",
  );
  await db.query(
    "ALTER TABLE public.lead_alerts_log DROP CONSTRAINT lead_alerts_log_status_check; ALTER TABLE public.lead_alerts_log ADD CONSTRAINT lead_alerts_log_status_check CHECK(status IN ('s ent','failed'))",
  );
  await rejectedPrerequisite(/constraint drift/);
  await db.query(
    "ALTER TABLE public.lead_alerts_log DROP CONSTRAINT lead_alerts_log_status_check; ALTER TABLE public.lead_alerts_log ADD CONSTRAINT lead_alerts_log_status_check CHECK(status IN ('sent','failed'))",
  );
  await db.query("ALTER TABLE public.lead_alerts_log ALTER COLUMN status SET DEFAULT 's ent'");
  await rejectedPrerequisite(/column\/default drift/);
  await db.query("ALTER TABLE public.lead_alerts_log ALTER COLUMN status SET DEFAULT 'sent'");
  await db.query(`SET ROLE service_role;
    INSERT INTO public.tenant_alert_settings(tenant_id) VALUES('${A}'),('${B}');
    INSERT INTO public.lead_alerts_log(tenant_id,alert_channel,recipient,status) VALUES('${A}','email','a@example.test','failed'),('${B}','email','b@example.test','failed');
    RESET ROLE;`);
  const freshRows = await alertRows();
  await db.query(prerequisite);
  assert.deepEqual(
    await alertRows(),
    freshRows,
    "Prerequisite rerun must preserve every existing alert row",
  );
  await assertAlertIsolation();
  assert.equal(
    (
      await db.query(
        `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('drip_sequences','drip_steps','drip_enrollments','tenant_chat_routing_settings','workspace_notifications')`,
      )
    ).rows[0].n,
    0,
  );
  await db.query("DROP TABLE public.tenant_alert_settings,public.lead_alerts_log");

  // Historical full table shape, old tenant-wide policies and separate legacy
  // column grants. No other part of the broad historical migration is run.
  for (const statement of legacyAlertTables) await db.query(statement);
  await db.query(`
    GRANT ALL ON public.tenant_alert_settings,public.lead_alerts_log TO authenticated,anon,service_role;
    GRANT UPDATE(lead_alerts_enabled) ON public.tenant_alert_settings TO authenticated;
    GRANT UPDATE(status) ON public.lead_alerts_log TO authenticated;
    ALTER TABLE public.tenant_alert_settings ENABLE ROW LEVEL SECURITY; ALTER TABLE public.lead_alerts_log ENABLE ROW LEVEL SECURITY;
    CREATE POLICY tenant_alert_settings_isolation ON public.tenant_alert_settings FOR ALL USING(true);
    CREATE POLICY lead_alerts_log_isolation ON public.lead_alerts_log FOR ALL USING(true);
    INSERT INTO public.tenant_alert_settings(tenant_id) VALUES('${A}'),('${B}');
    INSERT INTO public.lead_alerts_log(tenant_id,alert_channel,recipient,status) VALUES('${A}','email','a@example.test','failed'),('${B}','email','b@example.test','failed');`);
  const legacyRows = await alertRows();
  await db.query(prerequisite);
  await db.query(prerequisite);
  assert.deepEqual(
    await alertRows(),
    legacyRows,
    "Legacy settings and delivery history must remain unchanged",
  );
  await assertAlertIsolation();

  // Drift is rejected, not silently erased or rewritten by a permissive rerun.
  await db.query(
    "CREATE POLICY unexpected_alert_policy ON public.lead_alerts_log FOR SELECT USING(true)",
  );
  await rejectedPrerequisite(/policy drift/);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='public' AND policyname='unexpected_alert_policy'",
      )
    ).rows[0].n,
    1,
  );
  await db.query("DROP POLICY unexpected_alert_policy ON public.lead_alerts_log");
  await db.query("ALTER TABLE public.tenant_alert_settings ADD COLUMN unexpected_column text");
  await rejectedPrerequisite(/column\/default drift/);
  await db.query("ALTER TABLE public.tenant_alert_settings DROP COLUMN unexpected_column");
  await db.query(
    "ALTER TABLE public.tenant_alert_settings ALTER COLUMN alert_whatsapp_phone TYPE varchar(30)",
  );
  await rejectedPrerequisite(/column\/default drift/);
  await db.query(
    "ALTER TABLE public.tenant_alert_settings ALTER COLUMN alert_whatsapp_phone TYPE text",
  );
  await db.query(
    "ALTER TABLE public.lead_alerts_log DROP CONSTRAINT lead_alerts_log_status_check; ALTER TABLE public.lead_alerts_log ADD CONSTRAINT lead_alerts_log_status_check CHECK(status IN ('sent','failed','fabricated'))",
  );
  await rejectedPrerequisite(/constraint drift/);
  await db.query(
    "ALTER TABLE public.lead_alerts_log DROP CONSTRAINT lead_alerts_log_status_check; ALTER TABLE public.lead_alerts_log ADD CONSTRAINT lead_alerts_log_status_check CHECK(status IN ('sent','failed'))",
  );
  await db.query(
    "DROP INDEX public.idx_lead_alerts_tenant_created; CREATE INDEX idx_lead_alerts_tenant_created ON public.lead_alerts_log(tenant_id)",
  );
  await rejectedPrerequisite(/index drift/);
  await db.query(
    "DROP INDEX public.idx_lead_alerts_tenant_created; CREATE INDEX idx_lead_alerts_tenant_created ON public.lead_alerts_log(tenant_id,created_at DESC)",
  );
  await db.query(prerequisite);
  assert.deepEqual(await alertRows(), legacyRows, "Failed drift checks must not modify alert rows");
  // The older two Settings migrations remain independently compatible/rerunnable.
  await db.query(migration);
  await db.query(migration);
  await db.query(notificationMigration);
  await db.query("GRANT UPDATE(body) ON public.workspace_notifications TO authenticated");
  await db.query(notificationMigration);
  await db.query("SET ROLE service_role");
  await db.query(`INSERT INTO public.workspace_notifications(tenant_id,recipient_user_id,lead_id,title,body) VALUES
    ('${A}','${ADMIN}','${ADMIN}','New lead','Sample A'),('${A}','${STAFF}',null,'New lead','Sample staff'),('${B}','${FOREIGN}',null,'New lead','Sample B')`);
  await assert.rejects(
    db.query(
      `INSERT INTO public.workspace_notifications(tenant_id,recipient_user_id,title,body) VALUES('${A}','${FOREIGN}','Forbidden','Cross-company')`,
    ),
    /recipient does not belong/,
  );
  await assert.rejects(
    db.query(
      `INSERT INTO public.workspace_notifications(tenant_id,recipient_user_id,lead_id,title,body) VALUES('${A}','${ADMIN}','${FOREIGN}','Forbidden','Cross-company lead')`,
    ),
    /lead does not belong/,
  );
  await db.query("RESET ROLE");
  for (const [user, tenant] of [
    [ADMIN, A],
    [STAFF, A],
    [FOREIGN, B],
  ]) {
    await db.query(`SET "test.user"='${user}'; SET ROLE authenticated`);
    const own = await db.query("SELECT * FROM public.workspace_notifications");
    assert.equal(own.rowCount, 1);
    assert.equal(own.rows[0].recipient_user_id, user);
    assert.equal(own.rows[0].tenant_id, tenant);
    const marked = await db.query(
      "UPDATE public.workspace_notifications SET read_at=now() RETURNING recipient_user_id",
    );
    assert.equal(marked.rowCount, 1);
    assert.equal(marked.rows[0].recipient_user_id, user);
    for (const sql of [
      "UPDATE public.workspace_notifications SET body='forged'",
      `UPDATE public.workspace_notifications SET tenant_id='${B}'`,
      "DELETE FROM public.workspace_notifications",
      `INSERT INTO public.workspace_notifications(tenant_id,recipient_user_id,title,body) VALUES('${tenant}','${user}','forged','forged')`,
    ])
      await assert.rejects(db.query(sql), /permission denied/);
    await db.query("RESET ROLE");
  }
  // A role or tenant change immediately removes access to the old notification.
  await db.query(
    `UPDATE public.profiles SET tenant_id='${B}' WHERE id='${STAFF}'; SET "test.user"='${STAFF}'; SET ROLE authenticated`,
  );
  assert.equal((await db.query("SELECT * FROM public.workspace_notifications")).rowCount, 0);
  assert.equal(
    (await db.query("UPDATE public.workspace_notifications SET read_at=now() RETURNING id"))
      .rowCount,
    0,
  );
  await db.query("RESET ROLE");
  await db.query(
    `UPDATE public.profiles SET tenant_id='${A}',staff_role='seo_editor' WHERE id='${STAFF}'; SET ROLE authenticated`,
  );
  assert.equal((await db.query("SELECT * FROM public.workspace_notifications")).rowCount, 0);
  await db.query("RESET ROLE");
  await db.query(`UPDATE public.profiles SET staff_role='staff' WHERE id='${STAFF}'`);
  for (const [user, tenant, count] of [
    [ADMIN, A, 1],
    [STAFF, A, 0],
    [FOREIGN, B, 1],
  ]) {
    await db.query(`SET "test.user"='${user}'; SET ROLE authenticated`);
    for (const table of ["tenant_alert_settings", "lead_alerts_log"]) {
      const result = await db.query(`SELECT tenant_id FROM public.${table}`);
      assert.equal(result.rowCount, count);
      if (count) assert.equal(result.rows[0].tenant_id, tenant);
    }
    for (const sql of [
      "UPDATE public.tenant_alert_settings SET lead_alerts_enabled=false",
      "DELETE FROM public.tenant_alert_settings",
      `INSERT INTO public.tenant_alert_settings(tenant_id) VALUES('${STAFF}')`,
      "UPDATE public.lead_alerts_log SET status='sent'",
      "DELETE FROM public.lead_alerts_log",
      `INSERT INTO public.lead_alerts_log(tenant_id,status) VALUES('${A}','sent')`,
    ])
      await assert.rejects(db.query(sql), /permission denied/);
    await db.query("RESET ROLE");
  }
  await db.query("SET ROLE anon");
  for (const table of ["tenant_alert_settings", "lead_alerts_log", "workspace_notifications"])
    await assert.rejects(db.query(`SELECT * FROM public.${table}`), /permission denied/);
  await db.query("RESET ROLE");
  const columnGrants = await db.query(
    `SELECT has_column_privilege('authenticated','public.tenant_alert_settings','lead_alerts_enabled','UPDATE') AS preferences,has_column_privilege('authenticated','public.lead_alerts_log','status','UPDATE') AS evidence`,
  );
  assert.equal(columnGrants.rows[0].preferences, false);
  assert.equal(columnGrants.rows[0].evidence, false);
  await db.query("SET ROLE service_role");
  await db.query(
    `UPDATE public.tenant_alert_settings SET lead_alerts_enabled=false WHERE tenant_id='${A}'`,
  );
  await db.query(
    `INSERT INTO public.lead_alerts_log(tenant_id,alert_channel,recipient,status) VALUES('${A}','email','test@example.test','failed')`,
  );
  await db.query("RESET ROLE");
  assert.equal(
    (
      await db.query(
        `SELECT lead_alerts_enabled FROM public.tenant_alert_settings WHERE tenant_id='${A}'`,
      )
    ).rows[0].lead_alerts_enabled,
    false,
  );
  console.log(
    "PASS: narrow prerequisite creates fresh storage and repairs legacy grants, reruns without changing rows, refuses policy/column/type/constraint/index drift and rolls back partial setup; older Settings migrations rerun; manager-only alert reads, server writes, recipient/tenant-isolated notifications and read_at-only updates are enforced.",
  );
} finally {
  if (db) await db.end();
  await server.stop();
}
