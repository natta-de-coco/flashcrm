// Runs the message-evidence migration in a real Postgres and checks, per role,
// what it lets each one do. A column that exists but that the application
// cannot write, or that a second company can read, is found here rather than
// in production.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

const PORT = 54995;
const server = new EmbeddedPostgres({
  databaseDir: path.resolve(`node_modules/.cache/pg-message-evidence-${Date.now()}`),
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
const MSG_A = "aaaaaaaa-0000-0000-0000-0000000000aa";
const MSG_B = "bbbbbbbb-0000-0000-0000-0000000000bb";
const NEW_COLUMNS = [
  "origin",
  "failure_reason",
  "failure_code",
  "sent_at",
  "delivered_at",
  "read_at",
  "failed_at",
  "media",
];

let db;
try {
  await server.initialise();
  await server.start();
  db = new pg.Client(config);
  await db.connect();

  // The table as the earlier migrations leave it: same columns, grants and
  // tenant policy as production.
  await db.query(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE FUNCTION public.current_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('test.tenant', true), '')::uuid $$;
    CREATE TABLE public.organizations (id uuid PRIMARY KEY);
    CREATE TABLE public.conversations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL);
    CREATE TABLE public.messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
      direction text NOT NULL,
      sender text NOT NULL,
      sender_id uuid,
      body text NOT NULL DEFAULT '',
      media_url text,
      wa_message_id text,
      status text NOT NULL DEFAULT 'sent',
      created_at timestamptz NOT NULL DEFAULT now(),
      translated_body text,
      detected_language text,
      tenant_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE
    );
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
    GRANT ALL ON public.messages TO service_role;
    ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "messages_tenant_all" ON public.messages FOR ALL TO authenticated
      USING (tenant_id = public.current_tenant_id())
      WITH CHECK (tenant_id = public.current_tenant_id());
    INSERT INTO public.organizations VALUES ('${A}'), ('${B}');
    INSERT INTO public.conversations (id, tenant_id) VALUES
      ('aaaaaaaa-0000-0000-0000-00000000000c', '${A}'), ('bbbbbbbb-0000-0000-0000-00000000000c', '${B}');
    INSERT INTO public.messages (id, conversation_id, direction, sender, body, tenant_id) VALUES
      ('${MSG_A}', 'aaaaaaaa-0000-0000-0000-00000000000c', 'outbound', 'agent', 'Hello', '${A}'),
      ('${MSG_B}', 'bbbbbbbb-0000-0000-0000-00000000000c', 'outbound', 'agent', 'Hi', '${B}');
  `);

  const migration = readFileSync(
    new URL("../migrations/20261006150000_message_delivery_evidence.sql", import.meta.url),
    "utf8",
  );
  await db.query(migration);

  // 1. Nothing about an existing row was invented.
  const existing = await db.query(`SELECT ${NEW_COLUMNS.join(", ")} FROM public.messages`);
  assert.equal(existing.rows.length, 2);
  for (const row of existing.rows) {
    for (const column of NEW_COLUMNS) assert.equal(row[column], null, `${column} was backfilled`);
  }
  const shape = await db.query(
    `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = ANY($1)`,
    [NEW_COLUMNS],
  );
  assert.equal(shape.rows.length, NEW_COLUMNS.length);
  for (const column of shape.rows) {
    assert.equal(column.is_nullable, "YES", `${column.column_name} must be nullable`);
    assert.equal(column.column_default, null, `${column.column_name} must have no default`);
  }
  const validated = await db.query(
    `SELECT convalidated FROM pg_constraint WHERE conname = 'messages_origin_known'`,
  );
  assert.equal(validated.rows[0].convalidated, true);

  // 2. A company's user records evidence on its own message, and only its own.
  const asTenant = async (tenant) => {
    const client = new pg.Client(config);
    await client.connect();
    await client.query(`SET ROLE authenticated; SET test.tenant = '${tenant}'`);
    return client;
  };
  const a = await asTenant(A);
  try {
    const own = await a.query(
      `UPDATE public.messages
          SET origin = 'inbox', failure_reason = 'window_closed', failure_code = 131047,
              failed_at = now(), media = '{"kind":"image","mime_type":"image/jpeg"}'::jsonb
        WHERE id = $1 RETURNING id`,
      [MSG_A],
    );
    assert.equal(own.rowCount, 1);
    const others = await a.query(
      `UPDATE public.messages SET delivered_at = now() WHERE id = $1 RETURNING id`,
      [MSG_B],
    );
    assert.equal(others.rowCount, 0, "company A wrote company B's message");
    const seen = await a.query(`SELECT id, failure_reason FROM public.messages`);
    assert.deepEqual(
      seen.rows.map((r) => r.id),
      [MSG_A],
      "company A can see company B's evidence",
    );
    // A row cannot be moved into another company by writing evidence on it.
    await assert.rejects(
      a.query(`UPDATE public.messages SET tenant_id = '${B}', read_at = now() WHERE id = $1`, [
        MSG_A,
      ]),
      /row-level security/,
    );

    // 3. Only a known origin is accepted; "not recorded" stays allowed.
    await assert.rejects(
      a.query(`UPDATE public.messages SET origin = 'anything' WHERE id = $1`, [MSG_A]),
      /messages_origin_known/,
    );
    for (const origin of [
      "inbox",
      "template",
      "document",
      "assistant",
      "webhook",
      "widget",
      "import",
      "system",
    ]) {
      await a.query(`UPDATE public.messages SET origin = $2 WHERE id = $1`, [MSG_A, origin]);
    }
    await a.query(`UPDATE public.messages SET origin = NULL WHERE id = $1`, [MSG_A]);

    // 4. Code written before the columns existed still inserts.
    const legacy = await a.query(
      `INSERT INTO public.messages (conversation_id, direction, sender, body, tenant_id, status)
       VALUES ('aaaaaaaa-0000-0000-0000-00000000000c', 'outbound', 'agent', 'Old code', '${A}', 'sending')
       RETURNING origin, sent_at`,
    );
    assert.equal(legacy.rows[0].origin, null);
    assert.equal(legacy.rows[0].sent_at, null);
  } finally {
    await a.end();
  }

  // 5. The server's own role writes them; an anonymous visitor cannot touch the table.
  const service = new pg.Client(config);
  await service.connect();
  try {
    await service.query("SET ROLE service_role");
    const written = await service.query(
      `UPDATE public.messages SET sent_at = now(), delivered_at = now(), read_at = now()
        WHERE id = $1 RETURNING id`,
      [MSG_B],
    );
    assert.equal(written.rowCount, 1);
    await service.query("RESET ROLE; SET ROLE anon");
    await assert.rejects(service.query("SELECT origin FROM public.messages"), /permission denied/);
    await assert.rejects(
      service.query("UPDATE public.messages SET origin = 'inbox'"),
      /permission denied/,
    );
  } finally {
    await service.end();
  }

  // 6. Running it again changes nothing and loses nothing.
  await db.query(migration);
  const after = await db.query(
    `SELECT failure_reason, failure_code, media FROM public.messages WHERE id = $1`,
    [MSG_A],
  );
  assert.equal(after.rows[0].failure_reason, "window_closed");
  assert.equal(after.rows[0].failure_code, 131047);
  assert.deepEqual(after.rows[0].media, { kind: "image", mime_type: "image/jpeg" });

  console.log(
    "PASS: nullable with no backfill, validated origin check, own-company writes only, cross-company read and write denied, legacy insert, service role, anonymous denial, repeat migration",
  );
} finally {
  if (db) await db.end();
  await server.stop();
}
