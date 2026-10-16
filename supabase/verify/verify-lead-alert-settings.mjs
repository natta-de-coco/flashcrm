import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
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
const server = new EmbeddedPostgres({
  databaseDir: path.resolve(`node_modules/.cache/pg-settings-${Date.now()}`),
  user: "postgres",
  password: "postgres",
  port: 54982,
  persistent: false,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});
let db;
try {
  await server.initialise();
  await server.start();
  db = new pg.Client({
    host: "localhost",
    port: 54982,
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
    CREATE TABLE public.tenant_alert_settings(tenant_id uuid PRIMARY KEY,lead_alerts_enabled boolean DEFAULT true,alert_email_addresses text[] DEFAULT '{}',alert_whatsapp_enabled boolean DEFAULT false,alert_whatsapp_phone text);
    CREATE TABLE public.lead_alerts_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,alert_channel text,recipient text,status text);
    GRANT ALL ON public.tenant_alert_settings,public.lead_alerts_log TO authenticated,anon,service_role;
    GRANT UPDATE(lead_alerts_enabled) ON public.tenant_alert_settings TO authenticated;
    GRANT UPDATE(status) ON public.lead_alerts_log TO authenticated;
    ALTER TABLE public.tenant_alert_settings ENABLE ROW LEVEL SECURITY; ALTER TABLE public.lead_alerts_log ENABLE ROW LEVEL SECURITY;
    CREATE POLICY tenant_alert_settings_isolation ON public.tenant_alert_settings FOR ALL USING(true);
    CREATE POLICY lead_alerts_log_isolation ON public.lead_alerts_log FOR ALL USING(true);
    INSERT INTO public.profiles VALUES('${ADMIN}','${A}','company_admin'),('${STAFF}','${A}','staff'),('${FOREIGN}','${B}','super_admin');
    INSERT INTO public.tenant_alert_settings(tenant_id) VALUES('${A}'),('${B}');
    INSERT INTO public.lead_alerts_log(tenant_id,alert_channel,recipient,status) VALUES('${A}','email','a@example.test','failed'),('${B}','email','b@example.test','failed');`);
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
    "PASS: both migrations run twice; alert settings/evidence are manager-read/server-write; personal notifications are recipient- and tenant-isolated, read_at-only; cross-company inserts and stale tenant/role access are refused.",
  );
} finally {
  if (db) await db.end();
  await server.stop();
}
