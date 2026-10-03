// whatsapp_campaign_recipients is evidence of what a campaign sent. Executed
// against a real Postgres, not pattern-matched: a regex over SQL text cannot
// tell whether a grant or a policy actually holds.
//
// Proves: the migration runs twice without error (the re-run guard that
// failed it on 3 Oct); the browser role can read its own workspace's rows
// only; it cannot insert, update or delete one -- so it cannot mark a message
// delivered or erase the record of a send; and the server role can write.
//
// The marketing suppression list is checked the same way, with one deliberate
// asymmetry: the browser may ADD a suppression (that only stops messages) but
// may not edit or remove one, because removing it messages someone who asked
// not to be.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

const OWN = "aaaaaaaa-0000-0000-0000-00000000000a";
const OTHER = "bbbbbbbb-0000-0000-0000-00000000000b";
const read = (name) => fs.readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
const migration = read("20261003110000_whatsapp_broadcast_recipients.sql");
const suppressions = read("20261003113000_whatsapp_marketing_safety_controls.sql");

const server = new EmbeddedPostgres({
  databaseDir: path.resolve(`node_modules/.cache/pg-broadcast-${Date.now()}`),
  user: "postgres",
  password: "postgres",
  port: 54995,
  persistent: false,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});
let db;
try {
  await server.initialise();
  await server.start();
  db = new pg.Client({
    host: "localhost",
    port: 54995,
    user: "postgres",
    password: "postgres",
    database: "postgres",
  });
  await db.connect();

  // Only what the migration references. The caller's workspace comes from a
  // session setting, standing in for the JWT claim current_tenant_id() reads.
  // service_role is BYPASSRLS, as it is on Supabase: without that it would be
  // filtered by the browser's policy and the server could not write either.
  await db.query(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA IF NOT EXISTS public;
    CREATE TABLE public.organizations(id uuid PRIMARY KEY);
    CREATE TABLE public.campaigns(id uuid PRIMARY KEY, tenant_id uuid);
    CREATE TABLE public.contacts(id uuid PRIMARY KEY, tenant_id uuid);
    CREATE TABLE public.wa_numbers(id uuid PRIMARY KEY, tenant_id uuid);
    CREATE FUNCTION public.current_tenant_id() RETURNS uuid LANGUAGE sql STABLE
      AS $$ SELECT nullif(current_setting('test.tenant', true), '')::uuid $$;
    GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO authenticated, service_role;
    GRANT USAGE ON SCHEMA public TO authenticated, anon, service_role;
    INSERT INTO public.organizations VALUES ('${OWN}'), ('${OTHER}');
    INSERT INTO public.campaigns VALUES ('${OWN}', '${OWN}'), ('${OTHER}', '${OTHER}');`);

  // Twice: the first copy of this file failed CI's re-run guard on its policy.
  await db.query(migration);
  await db.query(migration);

  // Rows are seeded by the owner, as the server would write them.
  await db.query(`INSERT INTO public.whatsapp_campaign_recipients
      (tenant_id, campaign_id, recipient_phone, template_name, template_language)
    VALUES ('${OWN}', '${OWN}', '+971500000001', 'welcome', 'en'),
           ('${OTHER}', '${OTHER}', '+971500000002', 'welcome', 'en')`);

  await db.query(`SET test.tenant = '${OWN}'; SET ROLE authenticated`);
  const visible = await db.query("SELECT tenant_id FROM public.whatsapp_campaign_recipients");
  assert.equal(visible.rowCount, 1, "a workspace reads its own recipients only");
  assert.equal(visible.rows[0].tenant_id, OWN);

  for (const [what, sql] of [
    [
      "mark a message delivered",
      "UPDATE public.whatsapp_campaign_recipients SET status='delivered'",
    ],
    ["erase the record of a send", "DELETE FROM public.whatsapp_campaign_recipients"],
    [
      "invent a recipient",
      `INSERT INTO public.whatsapp_campaign_recipients
         (tenant_id, campaign_id, recipient_phone, template_name, template_language)
       VALUES ('${OWN}', '${OWN}', '+971500000009', 'welcome', 'en')`,
    ],
  ]) {
    await assert.rejects(db.query(sql), /permission denied/, `the browser must not ${what}`);
  }

  await db.query("RESET ROLE; SET ROLE service_role");
  await db.query(
    `UPDATE public.whatsapp_campaign_recipients SET status='sent', sent_at=now() WHERE tenant_id='${OWN}'`,
  );
  await db.query("RESET ROLE");
  const written = await db.query(
    `SELECT status FROM public.whatsapp_campaign_recipients WHERE tenant_id='${OWN}'`,
  );
  assert.equal(written.rows[0].status, "sent", "the server records the provider's answer");

  // ── The opt-out list ──────────────────────────────────────────────────────
  // It also adds columns to the recipients table, so it runs after it. Twice,
  // for the same re-run guard.
  await db.query(suppressions);
  await db.query(suppressions);
  await db.query(`INSERT INTO public.whatsapp_marketing_suppressions (tenant_id, normalized_phone, reason)
    VALUES ('${OTHER}', '+971500000002', 'unsubscribe')`);

  await db.query(`SET test.tenant = '${OWN}'; SET ROLE authenticated`);
  // Adding one is allowed: it only ever stops messages.
  await db.query(`INSERT INTO public.whatsapp_marketing_suppressions (tenant_id, normalized_phone, reason)
    VALUES ('${OWN}', '+971500000001', 'unsubscribe')`);
  const own = await db.query("SELECT tenant_id FROM public.whatsapp_marketing_suppressions");
  assert.equal(own.rowCount, 1, "a workspace reads its own suppressions only");
  assert.equal(own.rows[0].tenant_id, OWN);
  await assert.rejects(
    db.query(`INSERT INTO public.whatsapp_marketing_suppressions (tenant_id, normalized_phone, reason)
      VALUES ('${OTHER}', '+971500000003', 'manual')`),
    /row-level security/,
    "the browser must not write into another workspace's list",
  );
  for (const [what, sql] of [
    ["re-subscribe someone who opted out", "DELETE FROM public.whatsapp_marketing_suppressions"],
    [
      "rewrite why someone was suppressed",
      "UPDATE public.whatsapp_marketing_suppressions SET reason='manual'",
    ],
  ]) {
    await assert.rejects(db.query(sql), /permission denied/, `the browser must not ${what}`);
  }

  await db.query("RESET ROLE; SET ROLE service_role");
  await db.query(
    `DELETE FROM public.whatsapp_marketing_suppressions WHERE tenant_id='${OWN}' AND reason='unsubscribe'`,
  );
  await db.query("RESET ROLE");
  assert.equal(
    (
      await db.query(
        `SELECT 1 FROM public.whatsapp_marketing_suppressions WHERE tenant_id='${OWN}'`,
      )
    ).rowCount,
    0,
    "the server can still remove one, deliberately and with its own audit",
  );

  console.log(
    "PASS: broadcast recipients and suppression migrations re-run cleanly; browser reads own workspace only, cannot write recipients, may add but not edit or remove a suppression; server writes",
  );
} finally {
  if (db) await db.end();
  await server.stop();
}
