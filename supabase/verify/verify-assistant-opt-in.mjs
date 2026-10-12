// Runs the assistant opt-in migration in a real Postgres and checks, per role,
// what each one can and cannot do afterwards. The migration adds a SECURITY
// DEFINER trigger, changes two defaults and hands existing workspaces over:
// each of those is proved by doing it, not by reading the SQL.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

const PORT = 54996;
const server = new EmbeddedPostgres({
  databaseDir: path.resolve(`node_modules/.cache/pg-assistant-opt-in-${Date.now()}`),
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

const A = "aaaaaaaa-0000-0000-0000-000000000001"; // on, wrote its own instructions
const B = "bbbbbbbb-0000-0000-0000-000000000001"; // on only because ON was the default
const C = "cccccccc-0000-0000-0000-000000000001"; // switched off
const D = "dddddddd-0000-0000-0000-000000000001"; // never opened the Chatbot page
const ADMIN_A = "aaaaaaaa-0000-0000-0000-00000000000a";
const AGENT_A = "aaaaaaaa-0000-0000-0000-00000000000b";
const ADMIN_D = "dddddddd-0000-0000-0000-00000000000a";
const SEEDED =
  "You are a helpful WhatsApp support assistant. Be concise, friendly and professional. Answer in the customer''s language.";

let db;
try {
  await server.initialise();
  await server.start();
  db = new pg.Client(config);
  await db.connect();

  // The tables, grants and policies as the earlier migrations leave them.
  await db.query(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('test.user_id', true), '')::uuid $$;
    CREATE FUNCTION public.current_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('test.tenant', true), '')::uuid $$;
    CREATE FUNCTION public.is_tenant_admin() RETURNS boolean LANGUAGE sql STABLE AS
      $$ SELECT coalesce(current_setting('test.admin', true), '') = 'true' $$;
    CREATE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

    CREATE TABLE public.organizations (id uuid PRIMARY KEY, name text NOT NULL);
    CREATE TABLE public.tenant_bot_settings (
      tenant_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
      enabled boolean NOT NULL DEFAULT true,
      bot_name text NOT NULL DEFAULT 'Flash Assistant',
      greeting text NOT NULL DEFAULT 'Hi! Thanks for reaching out. How can I help you today?',
      instructions text NOT NULL DEFAULT '${SEEDED}',
      model text NOT NULL DEFAULT 'google/gemini-3.7-flash',
      handoff_keywords text[] NOT NULL DEFAULT ARRAY['human','agent','representative','complaint'],
      business_hours_only boolean NOT NULL DEFAULT false,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    GRANT SELECT, INSERT, UPDATE ON public.tenant_bot_settings TO authenticated;
    GRANT ALL ON public.tenant_bot_settings TO service_role;
    ALTER TABLE public.tenant_bot_settings ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "tenant_bot_settings_read" ON public.tenant_bot_settings FOR SELECT TO authenticated
      USING (tenant_id = public.current_tenant_id());
    CREATE POLICY "tenant_bot_settings_write" ON public.tenant_bot_settings FOR ALL TO authenticated
      USING (tenant_id = public.current_tenant_id() AND public.is_tenant_admin())
      WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_tenant_admin());
    CREATE TRIGGER tenant_bot_settings_updated BEFORE UPDATE ON public.tenant_bot_settings
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

    CREATE TABLE public.conversations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      bot_enabled boolean NOT NULL DEFAULT true
    );
    GRANT ALL ON public.conversations TO service_role;

    CREATE TABLE public.messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid, sender text, direction text, created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE public.audit_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
      actor_id uuid, actor_label text, action text NOT NULL,
      entity_type text, entity_id text,
      details jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    GRANT SELECT ON public.audit_log TO authenticated;   -- INSERT was revoked from company users
    GRANT ALL ON public.audit_log TO service_role;
    ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "members read own tenant audit" ON public.audit_log FOR SELECT TO authenticated
      USING (tenant_id = public.current_tenant_id());

    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;

    INSERT INTO public.organizations VALUES
      ('${A}', 'Alpha'), ('${B}', 'Beta'), ('${C}', 'Gamma'), ('${D}', 'Delta');
    INSERT INTO public.tenant_bot_settings (tenant_id, enabled, instructions) VALUES
      ('${A}', true, 'We sell CCTV kits in Dubai and install on Saturdays.');
    INSERT INTO public.tenant_bot_settings (tenant_id) VALUES ('${B}');
    INSERT INTO public.tenant_bot_settings (tenant_id, enabled) VALUES ('${C}', false);
    INSERT INTO public.conversations (id, tenant_id) VALUES
      ('aaaaaaaa-0000-0000-0000-00000000000c', '${A}');
  `);

  const migration = readFileSync(
    new URL("../migrations/20261006160000_assistant_explicit_opt_in.sql", import.meta.url),
    "utf8",
  );
  await db.query(migration);

  const settings = async (tenant) =>
    (await db.query("SELECT * FROM public.tenant_bot_settings WHERE tenant_id = $1", [tenant]))
      .rows[0];
  const audit = async (tenant, action = "assistant.automation_changed") =>
    (
      await db.query(
        "SELECT * FROM public.audit_log WHERE tenant_id = $1 AND action = $2 ORDER BY created_at",
        [tenant, action],
      )
    ).rows;

  // 1. Nothing was switched off, and what was on still answers new chats.
  for (const tenant of [A, B]) {
    const row = await settings(tenant);
    assert.equal(row.enabled, true, "an existing workspace was switched off");
    assert.equal(row.auto_enroll_new_chats, true, "its new chats would stop being answered");
    assert.equal((await audit(tenant, "assistant.automation_carried_over")).length, 1);
  }
  assert.equal((await settings(C)).enabled, false);
  assert.equal((await settings(C)).auto_enroll_new_chats, false);
  assert.equal((await audit(C, "assistant.automation_carried_over")).length, 0);
  assert.equal(
    (await db.query("SELECT bot_enabled FROM public.conversations")).rows[0].bot_enabled,
    true,
    "an existing conversation was changed",
  );

  // 2. Off is the default for anything new.
  const fresh = await db.query(
    `INSERT INTO public.conversations (tenant_id) VALUES ('${A}') RETURNING bot_enabled`,
  );
  assert.equal(fresh.rows[0].bot_enabled, false);

  const as = async (tenant, user, admin) => {
    const client = new pg.Client(config);
    await client.connect();
    await client.query(
      `SET ROLE authenticated; SET test.tenant = '${tenant}'; SET test.user_id = '${user}'; SET test.admin = '${admin}'`,
    );
    return client;
  };

  // 3. A company admin changes the policy: recorded, with who and from what to what.
  const adminA = await as(A, ADMIN_A, true);
  const agentA = await as(A, AGENT_A, false);
  const adminD = await as(D, ADMIN_D, true);
  try {
    const changed = await adminA.query(
      `UPDATE public.tenant_bot_settings SET auto_enroll_new_chats = false WHERE tenant_id = '${A}' RETURNING automation_changed_by`,
    );
    assert.equal(changed.rowCount, 1);
    assert.equal(changed.rows[0].automation_changed_by, ADMIN_A);
    let lines = await audit(A);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].actor_id, ADMIN_A);
    assert.deepEqual(lines[0].details, {
      enabled: true,
      auto_enroll_new_chats: false,
      was_enabled: true,
      was_auto_enroll_new_chats: true,
    });

    // 4. Editing anything else records nothing, and "who changed it" cannot be forged.
    const stamped = (await settings(A)).automation_changed_at;
    await adminA.query(
      `UPDATE public.tenant_bot_settings
          SET greeting = 'Hello', automation_changed_by = '${AGENT_A}', automation_changed_at = '2001-01-01'
        WHERE tenant_id = '${A}'`,
    );
    const afterEdit = await settings(A);
    assert.equal(afterEdit.greeting, "Hello");
    assert.equal(afterEdit.automation_changed_by, ADMIN_A, "the writer chose who changed it");
    assert.equal(afterEdit.automation_changed_at.getTime(), stamped.getTime());
    assert.equal((await audit(A)).length, 1);

    // 5. Someone who is not an admin changes nothing and leaves no audit line.
    const byAgent = await agentA.query(
      `UPDATE public.tenant_bot_settings SET enabled = false WHERE tenant_id = '${A}'`,
    );
    assert.equal(byAgent.rowCount, 0);
    assert.equal((await settings(A)).enabled, true);
    assert.equal((await audit(A)).length, 1);
    // They can still read their own company's setting.
    assert.equal(
      (await agentA.query("SELECT enabled FROM public.tenant_bot_settings")).rowCount,
      1,
    );

    // 6. An admin of one company cannot touch another's, by update or insert.
    const across = await adminA.query(
      `UPDATE public.tenant_bot_settings SET enabled = false WHERE tenant_id = '${B}'`,
    );
    assert.equal(across.rowCount, 0);
    await assert.rejects(
      adminA.query(
        `INSERT INTO public.tenant_bot_settings (tenant_id, enabled) VALUES ('${D}', true)`,
      ),
      /row-level security/,
    );
    assert.equal((await settings(D)) ?? null, null);
    assert.equal((await audit(D)).length, 0, "a refused write left an audit line behind");
    assert.equal((await audit(B)).length, 0);
    assert.equal((await adminA.query("SELECT * FROM public.audit_log")).rows.length, 2);

    // 7. The audit log is still not writable by a company user, and the
    //    trigger's function is not something they can call.
    await assert.rejects(
      adminA.query(
        `INSERT INTO public.audit_log (tenant_id, action) VALUES ('${A}', 'assistant.automation_changed')`,
      ),
      /permission denied/,
    );
    await assert.rejects(
      adminA.query("SELECT public.note_assistant_automation_change()"),
      /permission denied|can only be called as triggers/,
    );

    // 8. A new workspace: nothing is on until its admin turns it on, and that is recorded.
    await adminD.query(
      `INSERT INTO public.tenant_bot_settings (tenant_id, greeting) VALUES ('${D}', 'Hi')`,
    );
    let d = await settings(D);
    assert.equal(d.enabled, false, "a new workspace starts with the assistant on");
    assert.equal(d.auto_enroll_new_chats, false);
    assert.equal(d.automation_changed_by, null);
    assert.equal((await audit(D)).length, 0);
    await adminD.query(
      `UPDATE public.tenant_bot_settings SET enabled = true, auto_enroll_new_chats = true WHERE tenant_id = '${D}'`,
    );
    d = await settings(D);
    assert.equal(d.automation_changed_by, ADMIN_D);
    lines = await audit(D);
    assert.equal(lines.length, 1);
    assert.deepEqual(lines[0].details, {
      enabled: true,
      auto_enroll_new_chats: true,
      was_enabled: false,
      was_auto_enroll_new_chats: false,
    });
  } finally {
    await adminA.end();
    await agentA.end();
    await adminD.end();
  }

  // 9. The server's own role is recorded as a change with no person behind it;
  //    an anonymous visitor reaches nothing.
  const other = new pg.Client(config);
  await other.connect();
  try {
    await other.query("SET ROLE service_role");
    await other.query(
      `UPDATE public.tenant_bot_settings SET enabled = false WHERE tenant_id = '${C}'`,
    );
    assert.equal((await audit(C)).length, 0, "no change, no line");
    await other.query(
      `UPDATE public.tenant_bot_settings SET enabled = true WHERE tenant_id = '${C}'`,
    );
    const byServer = await audit(C);
    assert.equal(byServer.length, 1);
    assert.equal(byServer[0].actor_id, null);
    await other.query("RESET ROLE; SET ROLE anon");
    await assert.rejects(
      other.query("SELECT enabled FROM public.tenant_bot_settings"),
      /permission denied/,
    );
    await assert.rejects(
      other.query("UPDATE public.tenant_bot_settings SET enabled = true"),
      /permission denied/,
    );
  } finally {
    await other.end();
  }

  // 10. Running it again undoes no one's choice.
  const linesBefore = (await db.query("SELECT count(*)::int AS n FROM public.audit_log")).rows[0].n;
  await db.query(migration);
  assert.equal(
    (await settings(A)).auto_enroll_new_chats,
    false,
    "a re-run turned an admin's choice back on",
  );
  assert.equal(
    (await db.query("SELECT count(*)::int AS n FROM public.audit_log")).rows[0].n,
    linesBefore,
    "a re-run wrote audit lines",
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid = 'public.tenant_bot_settings'::regclass AND tgname = 'tenant_bot_settings_automation_audit'",
      )
    ).rows[0].n,
    1,
  );

  // 11. The owner's inventory tells the three kinds of "on" apart.
  const proposal = readFileSync(
    new URL("../proposals/20261006_assistant_opt_in_backfill.sql", import.meta.url),
    "utf8",
  );
  const classify = async () => {
    const [inventory] = await db.query(proposal);
    return Object.fromEntries(inventory.rows.map((r) => [r.workspace, r.classification]));
  };
  // Beta was never edited and never answered anyone; Alpha and Delta chose; Gamma was set by the server.
  assert.deepEqual(await classify(), {
    Alpha: "chosen",
    Beta: "default only",
    Delta: "chosen",
    Gamma: "default only",
  });
  await db.query(
    `INSERT INTO public.messages (tenant_id, sender, direction) VALUES ('${B}', 'bot', 'outbound')`,
  );
  assert.equal((await classify()).Beta, "in use");
  // The proposal file changes nothing by being run.
  assert.equal((await settings(B)).enabled, true);

  console.log(
    "PASS: no workspace switched off, new chats still answered where they were, off by default for new rows, admin change audited with before/after, unrelated edits not audited, changed-by cannot be forged, non-admin and other-company writes refused with no audit line, audit log and trigger function closed to users, server change recorded, anonymous denied, repeat run keeps choices, inventory classification",
  );
} finally {
  if (db) await db.end();
  await server.stop();
}
