// Runs the "Open WhatsApp" fix in a real Postgres, on the schema the earlier
// migrations really leave, and checks what each role gets.
//
// The bug: open_contact_whatsapp refused a contact whose phone is held only as
// a phone identity (contacts.phone is empty), although the contact card shows
// that number. The fix has to open that contact AND keep every other refusal:
// another company's contact, no recorded consent, a paused workspace, no active
// default number, a conflicting routing rule, and a visitor who is not signed in.
//
// Also here: the read-only proposal that reports whether the contact-identity
// unique index exists and which rows collide, run in a read-only transaction so
// that "it only reads" is proved by the database and not by looking at it.
//
//   npm install --no-save --package-lock=false embedded-postgres@17.10.0-beta.17 pg@8.23.0
//   node supabase/verify/verify-open-contact-identities.mjs
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(HERE, "..", "migrations");
const PROPOSAL = path.join(
  HERE,
  "..",
  "proposals",
  "20261007_contact_identity_unique_index_check.sql",
);
const OLD = "20260927210000_open_contact_whatsapp.sql";
const NEW = "20261007130000_open_contact_whatsapp_phone_identity.sql";
const PORT = 54998;

const server = new EmbeddedPostgres({
  databaseDir: path.resolve(`node_modules/.cache/pg-open-contact-identities-${Date.now()}`),
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
const USER_A = "aaaaaaaa-0000-0000-0000-0000000000ff";
const USER_NO_WORKSPACE = "cccccccc-0000-0000-0000-0000000000ff";
const NUMBER_A = "aaaaaaaa-0000-0000-0000-0000000000a1";
const NUMBER_A_OTHER = "aaaaaaaa-0000-0000-0000-0000000000a2";
const NUMBER_B = "bbbbbbbb-0000-0000-0000-0000000000b1";
// Contacts of workspace A, one per shape of "where the number lives".
const C = {
  identityOnly: "aaaaaaaa-0000-0000-0000-0000000000c1", // no contacts.phone; a non-primary phone identity
  primaryIdentity: "aaaaaaaa-0000-0000-0000-0000000000c2", // no contacts.phone; a primary phone identity
  legacyOnly: "aaaaaaaa-0000-0000-0000-0000000000c3", // contacts.phone, no identities
  noNumber: "aaaaaaaa-0000-0000-0000-0000000000c4", // an email identity only
  blankPhone: "aaaaaaaa-0000-0000-0000-0000000000c5", // contacts.phone is spaces; no identities
  foreignIdentity: "aaaaaaaa-0000-0000-0000-0000000000c6", // the only phone identity is another workspace's
  junkIdentity: "aaaaaaaa-0000-0000-0000-0000000000c7", // a "phone" with no digits in it
  noConsent: "aaaaaaaa-0000-0000-0000-0000000000c8",
  routed: "aaaaaaaa-0000-0000-0000-0000000000c9",
  concurrent: "aaaaaaaa-0000-0000-0000-0000000000ca",
};
const OTHER_COMPANY_CONTACT = "bbbbbbbb-0000-0000-0000-0000000000c1";

const connect = async () => {
  const client = new pg.Client(config);
  await client.connect();
  await client.query("SET search_path TO public, extensions");
  return client;
};

let db;
try {
  await server.initialise();
  await server.start();
  db = await connect();

  await db.query(readFileSync(path.join(HERE, "supabase-shim.sql"), "utf8"));
  // What Supabase does for every function created in public: callable by
  // anon, authenticated and service_role unless the migration revokes it. The
  // shim alone leaves these roles without it, which would let a missing
  // REVOKE go unnoticed.
  await db.query(
    "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role",
  );
  const apply = async (file) => {
    try {
      await db.query(readFileSync(path.join(MIGRATIONS, file), "utf8"));
    } catch (error) {
      await db.query("ROLLBACK").catch(() => {});
      throw new Error(`${file} did not apply: ${error.message}`);
    }
  };
  // Every migration up to this fix: the schema production has when it is applied.
  const before = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql") && f < NEW)
    .sort();
  assert.ok(before.includes(OLD), "the migration this one builds on is part of the history");
  for (const file of before) await apply(file);

  await db.query(`
    INSERT INTO public.organizations (id, name, slug) VALUES ('${A}','Alpha','alpha'), ('${B}','Beta','beta');
    INSERT INTO auth.users (id, email) VALUES ('${USER_A}','a@alpha.test'), ('${USER_NO_WORKSPACE}','x@nowhere.test');
    -- A trigger on auth.users has already created a profile for each user.
    INSERT INTO public.profiles (id, tenant_id) VALUES ('${USER_A}','${A}'), ('${USER_NO_WORKSPACE}', NULL)
      ON CONFLICT (id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id;
    INSERT INTO public.wa_numbers (id, tenant_id, label, phone_number_id, access_token, is_default, active) VALUES
      ('${NUMBER_A}','${A}','A line','pn-a','t',true,true),
      ('${NUMBER_A_OTHER}','${A}','A second line','pn-a2','t',false,true),
      ('${NUMBER_B}','${B}','B line','pn-b','t',true,true);
  `);
  const contact = (id, tenant, name, phone, consent = true) =>
    db.query(
      "INSERT INTO public.contacts (id, tenant_id, name, phone, consent_given) VALUES ($1,$2,$3,$4,$5)",
      [id, tenant, name, phone, consent],
    );
  const identity = (tenant, contactId, kind, value, primary = false) =>
    db.query(
      "INSERT INTO public.contact_identities (tenant_id, contact_id, kind, value, is_primary) VALUES ($1,$2,$3,$4,$5)",
      [tenant, contactId, kind, value, primary],
    );
  await contact(C.identityOnly, A, "Email only, number added on the card", null);
  await identity(A, C.identityOnly, "email", "ali@alpha.test", true);
  await identity(A, C.identityOnly, "phone", "+971 50 000 0001", false); // addContactIdentity never sets is_primary
  await contact(C.primaryIdentity, A, "Primary identity", null);
  await identity(A, C.primaryIdentity, "phone", "+971 50 000 0002", true);
  await contact(C.legacyOnly, A, "Legacy phone column", "+971500000003");
  await contact(C.noNumber, A, "No number at all", null);
  await identity(A, C.noNumber, "email", "nonumber@alpha.test", true);
  // A row from before the reachability guard existed: the guard turns a blank
  // phone into NULL, so it is stepped around to model the old data.
  await db.query("ALTER TABLE public.contacts DISABLE TRIGGER contacts_reachability_guard");
  await contact(C.blankPhone, A, "Blank phone", "   ");
  await db.query("ALTER TABLE public.contacts ENABLE TRIGGER contacts_reachability_guard");
  assert.equal(
    (await db.query("SELECT phone FROM public.contacts WHERE id=$1", [C.blankPhone])).rows[0].phone,
    "   ",
  );
  await contact(C.foreignIdentity, A, "Another company's identity", null);
  await identity(B, C.foreignIdentity, "phone", "+971 50 000 0006"); // row says workspace B, contact is A's
  await contact(C.junkIdentity, A, "Junk identity", null);
  await identity(A, C.junkIdentity, "phone", "call the office");
  await contact(C.noConsent, A, "No consent", null, false);
  await identity(A, C.noConsent, "phone", "+971 50 000 0008", true);
  await contact(C.routed, A, "Routed elsewhere", null);
  await identity(A, C.routed, "phone", "+971 50 000 0009", true);
  await contact(C.concurrent, A, "Opened twice at once", null);
  await identity(A, C.concurrent, "phone", "+971 50 000 0010");
  await contact(OTHER_COMPANY_CONTACT, B, "Beta's customer", "+971500000011");

  // ── As a signed-in user of workspace A, the way the API calls it ──────────
  const session = async (role, uid) => {
    const client = await connect();
    await client.query(`SET ROLE ${role}`);
    if (uid) await client.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [uid]);
    return client;
  };
  const open = (client, id) => client.query("SELECT public.open_contact_whatsapp($1) AS id", [id]);
  const refused = (client, id, pattern) => assert.rejects(open(client, id), pattern);
  const conversations = async (contactId) =>
    (
      await db.query(
        "SELECT id, wa_number_id, bot_enabled FROM public.conversations WHERE contact_id=$1 AND channel='whatsapp'",
        [contactId],
      )
    ).rows;

  // ── BEFORE the fix: the bug, reproduced ───────────────────────────────────
  let user = await session("authenticated", USER_A);
  await refused(user, C.identityOnly, /Add a WhatsApp phone number to this contact first/);
  await refused(user, C.primaryIdentity, /Add a WhatsApp phone number to this contact first/);
  await open(user, C.legacyOnly); // the legacy column always worked
  await user.end();
  assert.equal((await conversations(C.identityOnly)).length, 0, "the old function opened nothing");

  // The new migration refuses to run without the one it builds on.
  await db.query("DROP FUNCTION public.open_contact_whatsapp(uuid)");
  await assert.rejects(
    db.query(readFileSync(path.join(MIGRATIONS, NEW), "utf8")),
    /Apply 20260927210000_open_contact_whatsapp\.sql first/,
  );
  await db.query("ROLLBACK").catch(() => {});
  assert.equal(
    (await db.query("SELECT to_regprocedure('public.open_contact_whatsapp(uuid)') AS f")).rows[0].f,
    null,
    "a refused migration changed nothing",
  );
  await apply(OLD);
  await db.query("DELETE FROM public.conversations WHERE contact_id=$1", [C.legacyOnly]);

  // ── AFTER the fix ─────────────────────────────────────────────────────────
  await apply(NEW);
  await apply(NEW); // safe to run twice

  user = await session("authenticated", USER_A);
  try {
    // The reported flow: a number added from the card, nothing in contacts.phone.
    const opened = (await open(user, C.identityOnly)).rows[0].id;
    const [thread] = await conversations(C.identityOnly);
    assert.equal(thread.id, opened);
    assert.equal(thread.wa_number_id, NUMBER_A, "on the workspace's active default number");
    assert.equal(thread.bot_enabled, false, "the assistant stays off");
    assert.equal((await open(user, C.identityOnly)).rows[0].id, opened, "opening again reuses it");
    assert.equal((await conversations(C.identityOnly)).length, 1);

    await open(user, C.primaryIdentity);
    await open(user, C.legacyOnly);
    assert.equal((await conversations(C.primaryIdentity)).length, 1);
    assert.equal((await conversations(C.legacyOnly)).length, 1);

    // No usable number anywhere is still refused with the same words.
    const NO_NUMBER = /Add a WhatsApp phone number to this contact first/;
    await refused(user, C.noNumber, NO_NUMBER);
    await refused(user, C.blankPhone, NO_NUMBER);
    await refused(user, C.junkIdentity, NO_NUMBER);
    // Another workspace's identity row does not count as this contact's number.
    await refused(user, C.foreignIdentity, NO_NUMBER);
    for (const id of [C.noNumber, C.blankPhone, C.junkIdentity, C.foreignIdentity]) {
      assert.equal((await conversations(id)).length, 0, "a refusal opens nothing");
    }

    // Another company's contact is still not found, whatever number it holds.
    await refused(user, OTHER_COMPANY_CONTACT, /Contact not found/);
    await refused(user, "00000000-0000-0000-0000-000000000000", /Contact not found/);
    assert.equal((await conversations(OTHER_COMPANY_CONTACT)).length, 0);

    // The other checks, unchanged, on a contact that does have a number.
    await refused(user, C.noConsent, /Record this contact's permission/);

    await db.query("UPDATE public.organizations SET suspended = true WHERE id = $1", [A]);
    await refused(user, C.routed, /Sending is paused for this workspace/);
    await db.query(
      "UPDATE public.organizations SET suspended = false, subscription_status = 'cancelled' WHERE id = $1",
      [A],
    );
    await refused(user, C.routed, /Sending is paused for this workspace/);
    await db.query("UPDATE public.organizations SET subscription_status = 'active' WHERE id = $1", [
      A,
    ]);

    await db.query("UPDATE public.wa_numbers SET active = false WHERE id = $1", [NUMBER_A]);
    await refused(user, C.routed, /Choose an active default WhatsApp number/);
    await db.query("UPDATE public.wa_numbers SET active = true, is_default = false WHERE id = $1", [
      NUMBER_A,
    ]);
    await refused(user, C.routed, /Choose an active default WhatsApp number/);
    await db.query("UPDATE public.wa_numbers SET is_default = true WHERE id = $1", [NUMBER_A]);

    // Routing: the contact is assigned to one line but already talks on another.
    await db.query(
      "INSERT INTO public.conversations (tenant_id, contact_id, channel, wa_number_id) VALUES ($1,$2,'whatsapp',$3)",
      [A, C.routed, NUMBER_A],
    );
    await db.query(
      "INSERT INTO public.leads (email, tenant_id, contact_id, assigned_wa_number_id) VALUES ('routed@alpha.test',$1,$2,$3)",
      [A, C.routed, NUMBER_A_OTHER],
    );
    await refused(user, C.routed, /assigned to a different WhatsApp line/);

    // Two people press the button for the same contact at the same moment.
    const second = await session("authenticated", USER_A);
    try {
      const [one, two] = await Promise.all([open(user, C.concurrent), open(second, C.concurrent)]);
      assert.equal(one.rows[0].id, two.rows[0].id);
      assert.equal((await conversations(C.concurrent)).length, 1);
    } finally {
      await second.end();
    }
  } finally {
    await user.end();
  }

  // Not signed in; signed in with no workspace; a visitor.
  const noUser = await session("authenticated", null);
  await refused(noUser, C.identityOnly, /Please sign in again/);
  await noUser.end();
  const noWorkspace = await session("authenticated", USER_NO_WORKSPACE);
  await refused(noWorkspace, C.identityOnly, /Your workspace is not ready/);
  await noWorkspace.end();
  const visitor = await session("anon", null);
  await refused(visitor, C.identityOnly, /permission denied for function open_contact_whatsapp/);
  await visitor.end();
  const privileges = (
    await db.query(`
      SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
             p.prosecdef AS runs_as_owner,
             p.proconfig AS settings
        FROM pg_proc p WHERE p.oid = 'public.open_contact_whatsapp(uuid)'::regprocedure`)
  ).rows[0];
  assert.equal(privileges.anon, false);
  assert.equal(privileges.authenticated, true);
  assert.equal(privileges.runs_as_owner, true);
  assert.ok(privileges.settings.some((s) => /^search_path=public, pg_temp$/.test(s)));
  assert.equal(
    (
      await db.query(
        "SELECT has_function_privilege('public', 'public.open_contact_whatsapp(uuid)', 'EXECUTE') AS ok",
      )
    ).rows[0].ok,
    false,
    "PUBLIC may not call it",
  );

  // ── The proposal about contact_identities_tenant_value_key ────────────────
  // Run inside a read-only transaction: a statement that wrote anything would
  // be refused by the database itself.
  const proposal = readFileSync(PROPOSAL, "utf8");
  const report = async () => {
    const client = await connect();
    try {
      await client.query("BEGIN READ ONLY");
      const results = await client.query(proposal);
      await client.query("ROLLBACK");
      assert.equal(results.length, 3, "three read-only reports: the index, the groups, the rows");
      return { index: results[0].rows, groups: results[1].rows, rows: results[2].rows };
    } finally {
      await client.end();
    }
  };
  const indexName = "contact_identities_tenant_value_key";
  const expectedIndex = (r) => r.index.find((i) => i.index_name === indexName);

  // The index is there and nothing collides.
  let result = await report();
  assert.ok(expectedIndex(result)?.is_unique && expectedIndex(result)?.is_valid);
  assert.match(expectedIndex(result).definition, /\(tenant_id, kind, normalized\)/);
  assert.equal(result.groups.length, 0);
  assert.equal(result.rows.length, 0);

  // The state the migration could leave behind: no index, and a number held
  // twice -- once by two contacts, once by the same contact written two ways.
  await db.query(`DROP INDEX public.${indexName}`);
  await contact("dddddddd-0000-0000-0000-0000000000d1", A, "Held by two", null);
  await identity(A, "dddddddd-0000-0000-0000-0000000000d1", "phone", "971500000099");
  await contact("dddddddd-0000-0000-0000-0000000000d2", A, "Also claims it", null);
  await identity(A, "dddddddd-0000-0000-0000-0000000000d2", "phone", "+971500000099");
  await identity(A, C.primaryIdentity, "phone", "00971500000002"); // the same contact, a second way
  result = await report();
  assert.equal(expectedIndex(result), undefined, "reports the index as missing");
  assert.equal(result.groups.length, 2);
  const byKey = Object.fromEntries(result.groups.map((g) => [g.normalized, g]));
  assert.equal(Number(byKey["971500000099"].contacts), 2, "two different contacts claim it");
  assert.equal(Number(byKey["971500000099"].identity_rows), 2);
  assert.equal(byKey["971500000099"].workspace, "Alpha");
  assert.equal(Number(byKey["971500000002"].contacts), 1, "one contact holds it twice");
  assert.equal(Number(byKey["971500000002"].identity_rows), 2);
  assert.equal(result.rows.length, 4, "every colliding row is listed");
  assert.deepEqual([...new Set(result.rows.map((r) => r.contact_name))].sort(), [
    "Also claims it",
    "Held by two",
    "Primary identity",
  ]);
  const primary = result.rows.find((r) => r.contact_id === C.primaryIdentity && r.is_primary);
  assert.equal(Number(primary.conversations), 1, "shows what hangs off the contact");
  // A statement in the file that tried to write would have failed above; this
  // confirms the data is exactly as it was left.
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM public.contact_identities WHERE normalized = '971500000099'",
      )
    ).rows[0].n,
    2,
  );

  console.log(
    "PASS: identity-only contact refused before and opened after, primary / legacy / non-primary numbers all open, no-number / blank / junk / foreign identity refused, other company's contact not found, consent / suspension / inactive default / routing refusals unchanged, concurrent opens share one thread, anon and PUBLIC denied, migration safe to run twice and refuses to run without its predecessor, proposal reads only and reports missing index and colliding rows",
  );
} finally {
  if (db) await db.end();
  await server.stop();
}
