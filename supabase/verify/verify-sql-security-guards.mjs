import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

const server = new EmbeddedPostgres({
  databaseDir: path.resolve(`node_modules/.cache/pg-guards-${Date.now()}`),
  user: "postgres",
  password: "postgres",
  port: 54994,
  persistent: false,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});
let db;
try {
  await server.initialise();
  await server.start();
  db = new pg.Client({
    host: "localhost",
    port: 54994,
    user: "postgres",
    password: "postgres",
    database: "postgres",
  });
  await db.connect();
  await db.query(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
    CREATE TABLE profiles(id uuid PRIMARY KEY, full_name text, avatar_url text, last_seen_at timestamptz, staff_role text, tenant_id uuid, suspended boolean, email text);
    INSERT INTO profiles(id, full_name, staff_role, tenant_id, suspended, email) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','Test','agent','aaaaaaaa-0000-0000-0000-000000000002',false,'test@example.invalid');
    GRANT SELECT,UPDATE ON profiles TO service_role;
    CREATE FUNCTION resolve_contact_by_identity(uuid,text,text) RETURNS TABLE(contact_id uuid,branch_id uuid) LANGUAGE sql SECURITY DEFINER AS $$ SELECT 'aaaaaaaa-0000-0000-0000-000000000001'::uuid,NULL::uuid $$;
    GRANT EXECUTE ON FUNCTION resolve_contact_by_identity(uuid,text,text) TO authenticated,service_role;`);
  await db.query(
    fs.readFileSync(
      new URL(
        "../migrations/20260926090000_profiles_privilege_columns_are_server_only.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.query(
    fs.readFileSync(
      new URL(
        "../migrations/20260928020000_profile_guard_and_identity_resolver_hardening.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  // Deliberately restore the broad UPDATE grant to prove the fallback trigger
  // protects all four privilege fields even if a future migration does this.
  await db.query("GRANT SELECT,UPDATE ON profiles TO authenticated; SET ROLE authenticated");
  for (const assignment of [
    "staff_role='super_admin'",
    "tenant_id='bbbbbbbb-0000-0000-0000-000000000002'",
    "suspended=true",
    "email='other@example.invalid'",
  ]) {
    await assert.rejects(db.query(`UPDATE profiles SET ${assignment}`), /changed by the server/);
  }
  await db.query("UPDATE profiles SET full_name='Allowed presentation change'");
  await assert.rejects(
    db.query("SELECT * FROM resolve_contact_by_identity(NULL,'phone','123')"),
    /permission denied/,
  );
  await db.query("RESET ROLE; SET ROLE service_role");
  await db.query("UPDATE profiles SET staff_role='company_admin'");
  assert.equal(
    (await db.query("SELECT * FROM resolve_contact_by_identity(NULL,'phone','123')")).rowCount,
    1,
  );
  await db.query("RESET ROLE");
  assert.equal(
    (await db.query("SELECT staff_role,full_name FROM profiles")).rows[0].staff_role,
    "company_admin",
  );
  console.log(
    "PASS: all four protected profile fields blocked despite broad grant; presentation and server role updates allowed; identity resolver server-only",
  );
} finally {
  if (db) await db.end();
  await server.stop();
}
