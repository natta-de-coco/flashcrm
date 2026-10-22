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
const dedupMigration = fs.readFileSync(
  new URL("../migrations/20261017100000_lead_alert_dispatch_dedup.sql", import.meta.url),
  "utf8",
);
const emailAuditSource = fs.readFileSync(
  new URL("../migrations/20260830000000_email_audit_otp_smtp.sql", import.meta.url),
  "utf8",
);
const emailAuditTable = emailAuditSource.match(
  /CREATE TABLE IF NOT EXISTS public\.email_delivery_log \([\s\S]*?\n\);/,
)?.[0];
const emailAuditFunction = emailAuditSource.match(
  /CREATE OR REPLACE FUNCTION public\.log_email_delivery\([\s\S]*?\$\$;/,
)?.[0];
assert.ok(
  emailAuditTable && emailAuditFunction,
  "Real local email audit storage/function are available",
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
  // Add only the actual email audit prerequisite used by the new transaction.
  await db.query(
    "CREATE TABLE auth.users(id uuid PRIMARY KEY); ALTER TABLE public.profiles ADD COLUMN email text",
  );
  await db.query(emailAuditTable);
  await db.query(emailAuditFunction);
  await db.query(
    "REVOKE ALL ON public.email_delivery_log FROM PUBLIC,anon,authenticated; GRANT ALL ON public.email_delivery_log TO service_role",
  );
  const lateManager = "ffffffff-0000-0000-0000-000000000001";
  const listedMarketing = "cccccccc-0000-0000-0000-000000000001";
  const unlistedMarketing = "cccccccc-0000-0000-0000-000000000002";
  const leadIds = [101, 102, 103, 104, 105].map(
    (n) => `aaaaaaaa-0000-0000-0000-${String(n).padStart(12, "0")}`,
  );
  for (const id of leadIds)
    await db.query("INSERT INTO public.leads(id,tenant_id) VALUES($1,$2)", [id, A]);
  await db.query(
    "UPDATE public.profiles SET email=CASE id WHEN $1 THEN 'owner@example.test' WHEN $2 THEN 'Listed-Staff@example.test' ELSE 'foreign@example.test' END",
    [ADMIN, STAFF],
  );
  // More than 100 eligible rows, including an administrator after those rows.
  await db.query(`INSERT INTO public.profiles(id,tenant_id,staff_role,email)
    SELECT ('dddddddd-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'${A}','staff','unlisted-'||n||'@example.test' FROM generate_series(1,130)n`);
  await db.query(`INSERT INTO public.profiles(id,tenant_id,staff_role,email) VALUES
    ('${lateManager}','${A}','company_admin','late-owner@example.test'),
    ('${listedMarketing}','${A}','marketing_manager','listed-marketing@example.test'),
    ('${unlistedMarketing}','${A}','marketing_manager','unlisted-marketing@example.test')`);
  await db.query(`UPDATE public.tenant_alert_settings SET lead_alerts_enabled=true,
    alert_email_addresses=ARRAY[' listed-staff@EXAMPLE.test ','listed-marketing@example.test','foreign@example.test','outside@example.test'],
    alert_whatsapp_enabled=true,alert_whatsapp_phone='+971500000001' WHERE tenant_id='${A}'`);
  const oldRowsBeforeDedup = await alertRows();
  const oldNotificationsBeforeDedup = (
    await db.query("SELECT * FROM public.workspace_notifications ORDER BY id")
  ).rows;
  async function rejectDedupFixture(statement, values, pattern) {
    await db.query("BEGIN");
    try {
      await db.query(statement, values);
      await assert.rejects(db.query(dedupMigration), pattern);
    } finally {
      await db.query("ROLLBACK");
    }
  }
  await rejectDedupFixture(
    "INSERT INTO public.workspace_notifications(tenant_id,recipient_user_id,lead_id,title,body) VALUES($1,$2,$2,'Legacy duplicate','Keep both rows for review')",
    [A, ADMIN],
    /duplicate notifications/,
  );
  await rejectDedupFixture(
    "INSERT INTO public.lead_alerts_log(tenant_id,lead_id,alert_channel,recipient,status) VALUES($1,$2,'email','duplicate@example.test','failed'),($1,$2,'email','DUPLICATE@example.test','failed')",
    [A, leadIds[0]],
    /duplicate diagnostics/,
  );
  await rejectDedupFixture(
    "INSERT INTO public.email_delivery_log(tenant_id,recipient,provider,template,provider_msg_id,status) VALUES($1,'duplicate@example.test','platform_smtp','internal_sales_lead_alert','alert_unsent_duplicate','failed'),($1,'DUPLICATE@example.test','platform_smtp','internal_sales_lead_alert','alert_unsent_duplicate','failed')",
    [A],
    /duplicate email diagnostics/,
  );
  // A same-name index must have the exact semantics needed by ON CONFLICT.
  // NULLS NOT DISTINCT changes historical null-lead behavior; a deferrable
  // constraint cannot serve as an ON CONFLICT arbiter at runtime.
  await rejectDedupFixture(
    "CREATE UNIQUE INDEX workspace_notifications_lead_recipient_unique ON public.workspace_notifications(tenant_id,recipient_user_id,lead_id) NULLS NOT DISTINCT",
    [],
    /index differs/,
  );
  await rejectDedupFixture(
    "ALTER TABLE public.workspace_notifications ADD CONSTRAINT workspace_notifications_lead_recipient_unique UNIQUE(tenant_id,recipient_user_id,lead_id) DEFERRABLE INITIALLY IMMEDIATE",
    [],
    /index differs/,
  );
  assert.deepEqual(await alertRows(), oldRowsBeforeDedup);
  assert.deepEqual(
    (await db.query("SELECT * FROM public.workspace_notifications ORDER BY id")).rows,
    oldNotificationsBeforeDedup,
  );
  assert.equal(
    (
      await db.query(
        "SELECT to_regclass('public.workspace_notifications_lead_recipient_unique') AS idx",
      )
    ).rows[0].idx,
    null,
  );
  await db.query(dedupMigration);
  await db.query(dedupMigration);
  assert.deepEqual(await alertRows(), oldRowsBeforeDedup);
  assert.deepEqual(
    (await db.query("SELECT * FROM public.workspace_notifications ORDER BY id")).rows,
    oldNotificationsBeforeDedup,
  );
  const callAlert = async (
    client,
    id,
    tenant = A,
    title = "New lead captured",
    body = "Synthetic lead details.",
  ) =>
    (
      await client.query("SELECT public.record_sales_lead_alert($1,$2,$3,$4) AS result", [
        tenant,
        id,
        title,
        body,
      ])
    ).rows[0].result;
  const storedCounts = async (id) =>
    (
      await db.query(
        `SELECT
    (SELECT count(*)::int FROM public.workspace_notifications WHERE tenant_id=$1 AND lead_id=$2) AS notifications,
    (SELECT count(*)::int FROM public.lead_alerts_log WHERE tenant_id=$1 AND lead_id=$2) AS alerts,
    (SELECT count(*)::int FROM public.email_delivery_log WHERE tenant_id=$1 AND template='internal_sales_lead_alert' AND provider_msg_id='alert_unsent_'||$2::text) AS emails`,
        [A, id],
      )
    ).rows[0];
  for (const role of ["anon", "authenticated"]) {
    await db.query(`SET ROLE ${role}`);
    await assert.rejects(callAlert(db, leadIds[0]), /permission denied/);
    await db.query("RESET ROLE");
  }
  const rpcAcl = (
    await db.query(
      "SELECT has_function_privilege('anon','public.record_sales_lead_alert(uuid,uuid,text,text)','EXECUTE') AS anon,has_function_privilege('authenticated','public.record_sales_lead_alert(uuid,uuid,text,text)','EXECUTE') AS browser,has_function_privilege('service_role','public.record_sales_lead_alert(uuid,uuid,text,text)','EXECUTE') AS server",
    )
  ).rows[0];
  assert.deepEqual(rpcAcl, { anon: false, browser: false, server: true });
  await db.query("SET ROLE service_role");
  const firstAlert = await callAlert(db, leadIds[0]);
  assert.deepEqual(firstAlert, {
    notification_count: 4,
    created_notification_count: 4,
    email_recipient_count: 4,
    diagnostics_pending: false,
  });
  assert.equal((await callAlert(db, leadIds[0])).created_notification_count, 0);
  await db.query("RESET ROLE");
  assert.deepEqual(await storedCounts(leadIds[0]), { notifications: 4, alerts: 5, emails: 4 });
  assert.deepEqual(
    (
      await db.query(
        "SELECT recipient_user_id FROM public.workspace_notifications WHERE lead_id=$1 ORDER BY recipient_user_id",
        [leadIds[0]],
      )
    ).rows
      .map((r) => r.recipient_user_id)
      .sort(),
    [ADMIN, STAFF, listedMarketing, lateManager].sort(),
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM public.lead_alerts_log WHERE lead_id=$1 AND status<>'failed'",
        [leadIds[0]],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM public.email_delivery_log WHERE provider_msg_id=$1 AND status<>'failed'",
        [`alert_unsent_${leadIds[0]}`],
      )
    ).rows[0].n,
    0,
  );
  await db.query(
    "UPDATE public.workspace_notifications SET read_at=now() WHERE lead_id=$1 AND recipient_user_id=$2",
    [leadIds[0], ADMIN],
  );
  const acknowledged = (
    await db.query("SELECT * FROM public.workspace_notifications WHERE lead_id=$1 ORDER BY id", [
      leadIds[0],
    ])
  ).rows;
  await callAlert(
    db,
    leadIds[0],
    A,
    "Different title on retry",
    "Must not overwrite history or read state.",
  );
  assert.deepEqual(
    (
      await db.query("SELECT * FROM public.workspace_notifications WHERE lead_id=$1 ORDER BY id", [
        leadIds[0],
      ])
    ).rows,
    acknowledged,
  );
  // Current role and membership determine recipients on every retry.
  await db.query("UPDATE public.profiles SET tenant_id=$1 WHERE id=$2;", [B, STAFF]);
  assert.equal((await callAlert(db, leadIds[0])).notification_count, 3);
  await db.query("UPDATE public.profiles SET staff_role='seo_editor' WHERE id=$1", [
    listedMarketing,
  ]);
  assert.equal((await callAlert(db, leadIds[0])).notification_count, 2);
  await db.query("UPDATE public.profiles SET tenant_id=$1 WHERE id=$2", [A, STAFF]);
  await db.query("UPDATE public.profiles SET staff_role='marketing_manager' WHERE id=$1", [
    listedMarketing,
  ]);
  // Actual concurrent PostgreSQL connections race on one lead; the DB lock and
  // unique key, not a JavaScript pre-read, keep notifications and both logs once.
  const raceClients = await Promise.all(
    Array.from({ length: 8 }, async () => {
      const client = new pg.Client({
        host: "localhost",
        port,
        user: "postgres",
        password: "postgres",
        database: "postgres",
      });
      await client.connect();
      await client.query("SET ROLE service_role");
      return client;
    }),
  );
  try {
    const raced = await Promise.all(raceClients.map((client) => callAlert(client, leadIds[1])));
    assert.equal(
      raced.reduce((total, result) => total + result.created_notification_count, 0),
      4,
    );
    assert.ok(
      raced.every((result) => result.notification_count === 4 && !result.diagnostics_pending),
    );
  } finally {
    await Promise.all(raceClients.map((client) => client.end()));
  }
  assert.deepEqual(await storedCounts(leadIds[1]), { notifications: 4, alerts: 5, emails: 4 });
  // A primary notification failure is not acknowledged and leaves no diagnostics.
  await db.query(`CREATE FUNCTION public.test_refuse_notification() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.lead_id='${leadIds[2]}' THEN RAISE EXCEPTION 'notification unavailable'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER test_refuse_notification BEFORE INSERT ON public.workspace_notifications FOR EACH ROW EXECUTE FUNCTION public.test_refuse_notification()`);
  await assert.rejects(callAlert(db, leadIds[2]), /notification unavailable/);
  assert.deepEqual(await storedCounts(leadIds[2]), { notifications: 0, alerts: 0, emails: 0 });
  await db.query(
    "DROP TRIGGER test_refuse_notification ON public.workspace_notifications; DROP FUNCTION public.test_refuse_notification()",
  );
  assert.equal((await callAlert(db, leadIds[2])).created_notification_count, 4);
  // A diagnostics failure preserves real notifications; retries repair evidence
  // without creating another unread notification or multiplying historical logs.
  await db.query(
    "CREATE FUNCTION public.test_refuse_email_diagnostic() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'email diagnostics unavailable'; END $$; CREATE TRIGGER test_refuse_email_diagnostic BEFORE INSERT ON public.email_delivery_log FOR EACH ROW EXECUTE FUNCTION public.test_refuse_email_diagnostic()",
  );
  assert.equal((await callAlert(db, leadIds[3])).diagnostics_pending, true);
  assert.deepEqual(await storedCounts(leadIds[3]), { notifications: 4, alerts: 0, emails: 0 });
  await db.query(
    "DROP TRIGGER test_refuse_email_diagnostic ON public.email_delivery_log; DROP FUNCTION public.test_refuse_email_diagnostic()",
  );
  const diagnosticRetry = await callAlert(db, leadIds[3]);
  assert.equal(diagnosticRetry.created_notification_count, 0);
  assert.equal(diagnosticRetry.diagnostics_pending, false);
  await callAlert(db, leadIds[3]);
  assert.deepEqual(await storedCounts(leadIds[3]), { notifications: 4, alerts: 5, emails: 4 });
  await assert.rejects(callAlert(db, FOREIGN, A), /does not belong/);
  await assert.rejects(callAlert(db, leadIds[4], A, "X".repeat(201)), /bounded text/);
  await assert.rejects(callAlert(db, leadIds[4], A, "Title", "X".repeat(1001)), /bounded text/);
  await db.query(
    "UPDATE public.tenant_alert_settings SET lead_alerts_enabled=false WHERE tenant_id=$1",
    [A],
  );
  assert.equal((await callAlert(db, leadIds[4])).notification_count, 0);
  assert.deepEqual(await storedCounts(leadIds[4]), { notifications: 0, alerts: 0, emails: 0 });
  // New dedupe storage remains compatible with previous reviewed reruns.
  await db.query(prerequisite);
  await db.query(migration);
  await db.query(notificationMigration);
  await db.query(dedupMigration);
  console.log(
    "PASS: real lead-alert RPC denies browsers and cross-tenant leads; uncapped manager/listed-recipient selection, sequential/eight-way concurrent dedupe, preserved read history, current role/membership, notification-failure retry, diagnostics-savepoint retry and non-destructive legacy-duplicate stops.",
  );
  console.log(
    "PASS: narrow prerequisite creates fresh storage and repairs legacy grants, reruns without changing rows, refuses policy/column/type/constraint/index drift and rolls back partial setup; older Settings migrations rerun; manager-only alert reads, server writes, recipient/tenant-isolated notifications and read_at-only updates are enforced.",
  );
} finally {
  if (db) await db.end();
  await server.stop();
}
