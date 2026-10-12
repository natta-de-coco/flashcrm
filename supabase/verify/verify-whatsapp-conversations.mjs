import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

const server = new EmbeddedPostgres({
  databaseDir: path.resolve(`node_modules/.cache/pg-wa-open-${Date.now()}`),
  user: "postgres",
  password: "postgres",
  port: 54993,
  persistent: false,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});
const config = {
  host: "localhost",
  port: 54993,
  user: "postgres",
  password: "postgres",
  database: "postgres",
};
let db;
try {
  await server.initialise();
  await server.start();
  db = new pg.Client(config);
  await db.connect();
  await db.query(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.user_id', true), '')::uuid $$;
    CREATE FUNCTION public.current_tenant_id() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.tenant', true), '')::uuid $$;
    CREATE TABLE organizations(id uuid PRIMARY KEY, suspended boolean DEFAULT false, subscription_status text DEFAULT 'active');
    CREATE TABLE contacts(id uuid PRIMARY KEY, tenant_id uuid NOT NULL, phone text, consent_given boolean);
    CREATE TABLE wa_numbers(id uuid PRIMARY KEY, tenant_id uuid NOT NULL, active boolean, is_default boolean);
    CREATE TABLE leads(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, contact_id uuid, assigned_wa_number_id uuid, created_at timestamptz DEFAULT now());
    CREATE TABLE conversations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, contact_id uuid NOT NULL, channel text, wa_number_id uuid, bot_enabled boolean DEFAULT true);
    GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
    INSERT INTO organizations(id) VALUES ('aaaaaaaa-0000-0000-0000-000000000001'), ('bbbbbbbb-0000-0000-0000-000000000001');
    INSERT INTO contacts VALUES ('aaaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', '+971500000001', true), ('bbbbbbbb-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', '+971500000002', true);
    INSERT INTO wa_numbers VALUES ('aaaaaaaa-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', true, true);
  `);
  const migration = readFileSync(
    new URL("../migrations/20260927210000_open_contact_whatsapp.sql", import.meta.url),
    "utf8",
  );
  await db.query(migration);
  const connectUser = async () => {
    const c = new pg.Client(config);
    await c.connect();
    await c.query(
      "SET ROLE authenticated; SET test.user_id = 'aaaaaaaa-0000-0000-0000-000000000009'; SET test.tenant = 'aaaaaaaa-0000-0000-0000-000000000001'",
    );
    return c;
  };
  const a = await connectUser(),
    b = await connectUser();
  const open = (c, id = "aaaaaaaa-0000-0000-0000-000000000002") =>
    c.query("select public.open_contact_whatsapp($1) as id", [id]);
  try {
    const [first, second] = await Promise.all([open(a), open(b)]);
    assert.equal(first.rows[0].id, second.rows[0].id, "concurrent opens reuse one thread");
    assert.equal((await db.query("select count(*)::int as n from conversations")).rows[0].n, 1);
    assert.equal(
      (await db.query("select bot_enabled from conversations")).rows[0].bot_enabled,
      false,
    );
    await assert.rejects(open(a, "bbbbbbbb-0000-0000-0000-000000000002"), /Contact not found/);
    await db.query("update contacts set consent_given=false");
    await assert.rejects(open(a), /permission/);
    await db.query("update contacts set consent_given=true; update wa_numbers set active=false");
    await assert.rejects(open(a), /active default/);
    await db.query("update wa_numbers set active=true; update organizations set suspended=true");
    await assert.rejects(open(a), /Sending is paused/);
    await db.query("update organizations set suspended=false");
    await db.query(
      "insert into leads(tenant_id,contact_id,assigned_wa_number_id) values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000003')",
    );
    await assert.rejects(open(a), /different WhatsApp line/);
    await a.query("RESET ROLE; SET ROLE anon");
    await assert.rejects(open(a), /permission denied/);
    await db.query(migration); // Safe to rerun.
    console.log(
      "PASS: concurrent reuse, AI off, cross-company denial, consent, disabled line, suspension, routing, anonymous denial, repeat migration",
    );
  } finally {
    await a.end();
    await b.end();
  }
} finally {
  if (db) await db.end();
  await server.stop();
}
