// Runs the unsubscribe migration in a real Postgres and checks, per role, what each one can and
// cannot do. The migration adds a SECURITY DEFINER function that writes to other people's rows,
// so each claim is proved by doing it: who can call it, which rows it changes, which it leaves
// alone, that it is one transaction, and that it runs twice.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

const PORT = 54978;
const server = new EmbeddedPostgres({
  databaseDir: path.resolve(`node_modules/.cache/pg-withdraw-consent-${Date.now()}`),
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
const FN = "public.withdraw_marketing_consent";

const migration = readFileSync(
  new URL("../migrations/20261014110000_withdraw_marketing_consent.sql", import.meta.url),
  "utf8",
);

let db;
const asRole = async (role) => {
  const client = new pg.Client(config);
  await client.connect();
  await client.query(`SET ROLE ${role}`);
  return client;
};

try {
  await server.initialise();
  await server.start();
  db = new pg.Client(config);
  await db.connect();

  // The roles and tables as the earlier migrations and Supabase leave them. Supabase gives every
  // new function to anon, authenticated and service_role on top of Postgres's own "everyone"
  // (PUBLIC) default; the same default privileges are set here so the REVOKE has work to do.
  await db.query(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE ROLE bystander NOLOGIN; -- a role nobody granted anything to
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, bystander;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

    CREATE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

    CREATE TABLE public.leads (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      email text NOT NULL,
      name text,
      subscribed boolean NOT NULL DEFAULT true,
      consent_given boolean NOT NULL DEFAULT false,
      consent_at timestamptz
    );
    CREATE UNIQUE INDEX leads_tenant_email_key ON public.leads (tenant_id, email);

    CREATE TABLE public.contacts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      email text,
      name text NOT NULL DEFAULT '',
      consent_given boolean NOT NULL DEFAULT false,
      consent_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TRIGGER contacts_updated BEFORE UPDATE ON public.contacts
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

    ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
    GRANT ALL ON public.leads, public.contacts TO service_role;

    -- A control: a function made the ordinary way IS callable by the outside roles, so the
    -- denials below come from the migration and not from the way this database was set up.
    CREATE FUNCTION public.control_fn() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
  `);
  for (const role of ["anon", "authenticated", "bystander", "service_role"]) {
    const c = await asRole(role);
    try {
      assert.equal((await c.query("SELECT public.control_fn() AS n")).rows[0].n, 1, role);
    } finally {
      await c.end();
    }
  }

  // Company A holds the address in many spellings; company B holds it too.
  // `name` says which row is which. Everything starts subscribed with consent.
  const lead = (tenant, email, name) =>
    db.query(
      "INSERT INTO public.leads (tenant_id, email, name, subscribed, consent_given) VALUES ($1, $2, $3, true, true)",
      [tenant, email, name],
    );
  const contact = (tenant, email, name) =>
    db.query(
      "INSERT INTO public.contacts (tenant_id, email, name, consent_given) VALUES ($1, $2, $3, true)",
      [tenant, email, name],
    );
  const seed = async () => {
    await db.query("TRUNCATE public.leads, public.contacts");
    await lead(A, "sam@example.com", "a-exact");
    await lead(A, "Sam@Example.COM", "a-upper");
    await lead(A, " sam@example.com ", "a-spaced");
    await lead(A, "sam@example.com\t", "a-tab");
    await lead(A, "xsam@example.com", "a-longer-before");
    await lead(A, "sam@example.com.au", "a-longer-after");
    await lead(A, "other@example.com", "a-other");
    await lead(B, "sam@example.com", "b-exact");
    await lead(B, "SAM@example.com ", "b-spaced");
    await contact(A, "Sam@Example.com", "a-contact-mixed");
    await contact(A, "sam@example.com ", "a-contact-spaced");
    await contact(A, "xsam@example.com", "a-contact-longer");
    await contact(A, null, "a-contact-no-email");
    await contact(B, "sam@example.com", "b-contact");
  };
  const named = async (table) =>
    Object.fromEntries(
      (await db.query(`SELECT * FROM public.${table}`)).rows.map((r) => [r.name, r]),
    );
  const leadsDone = (r) => r.subscribed === false && r.consent_given === false;
  const leadsUntouched = (r) => r.subscribed === true && r.consent_given === true;
  const everything = async () =>
    JSON.stringify([
      (await db.query("SELECT * FROM public.leads ORDER BY name")).rows,
      (await db.query("SELECT * FROM public.contacts ORDER BY name")).rows,
    ]);
  const call = async (client, tenant, email) =>
    (await client.query(`SELECT ${FN}($1::uuid, $2::text) AS r`, [tenant, email])).rows[0].r;

  await seed();
  const results = await db.query(migration);

  // 1. The migration's own closing check says what the catalog says.
  const closing = results.at(-1).rows[0];
  assert.equal(closing.security_definer, true);
  assert.deepEqual(closing.settings, ["search_path=public, pg_temp"]);
  assert.equal(closing.anon_can_run, false);
  assert.equal(closing.authenticated_can_run, false);
  assert.equal(closing.service_role_can_run, true);
  const acl = (
    await db.query(
      `SELECT proacl::text AS acl FROM pg_proc WHERE oid = '${FN}(uuid, text)'::regprocedure`,
    )
  ).rows[0].acl;
  // An entry with no role name before the "=" is PUBLIC ("everyone").
  assert.equal(/(^|[{,])=X/.test(acl), false, `PUBLIC can still run it: ${acl}`);
  assert.match(acl, /service_role=X/);

  // 2. Per role. Only the server's role can call it; nobody else, and nothing changes.
  const before = await everything();
  for (const role of ["anon", "authenticated", "bystander"]) {
    const c = await asRole(role);
    try {
      await assert.rejects(call(c, A, "sam@example.com"), /permission denied for function/, role);
    } finally {
      await c.end();
    }
  }
  assert.equal(await everything(), before, "a refused call changed something");

  // 3. The server's role: only company A's spellings of the address change, in both tables.
  const server_ = await asRole("service_role");
  try {
    const first = await call(server_, A, "sam@example.com");
    assert.deepEqual(first, { leads: 4, contacts: 2, drip_enrollments: 0 });

    const leads = await named("leads");
    for (const name of ["a-exact", "a-upper", "a-spaced", "a-tab"]) {
      assert.equal(leadsDone(leads[name]), true, `${name} should be withdrawn`);
    }
    // An address that merely CONTAINS this one is someone else; so is another company's row.
    for (const name of ["a-longer-before", "a-longer-after", "a-other", "b-exact", "b-spaced"]) {
      assert.equal(leadsUntouched(leads[name]), true, `${name} must not change`);
    }
    const contacts = await named("contacts");
    for (const name of ["a-contact-mixed", "a-contact-spaced"]) {
      assert.equal(contacts[name].consent_given, false, `${name} should be withdrawn`);
    }
    for (const name of ["a-contact-longer", "a-contact-no-email", "b-contact"]) {
      assert.equal(contacts[name].consent_given, true, `${name} must not change`);
    }

    // 4. Running it again changes nothing and says so.
    const afterFirst = await everything();
    assert.deepEqual(await call(server_, A, "sam@example.com"), {
      leads: 0,
      contacts: 0,
      drip_enrollments: 0,
    });
    assert.equal(await everything(), afterFirst, "the second call changed something");

    // 5. The other company's call, with the address typed in capitals and spaces, changes only
    //    the other company; company A's rows are exactly as they were.
    const aRows = JSON.stringify(
      (await db.query("SELECT * FROM public.leads WHERE tenant_id = $1 ORDER BY name", [A])).rows,
    );
    assert.deepEqual(await call(server_, B, "  SAM@Example.com "), {
      leads: 2,
      contacts: 1,
      drip_enrollments: 0,
    });
    assert.equal(
      JSON.stringify(
        (await db.query("SELECT * FROM public.leads WHERE tenant_id = $1 ORDER BY name", [A])).rows,
      ),
      aRows,
    );
    assert.equal(leadsDone((await named("leads"))["b-exact"]), true);

    // 6. The address is compared whole: part of an address, or a pattern, matches nothing.
    await seed();
    const untouched = await everything();
    for (const odd of [
      "am@example.com",
      "sam@example",
      "%",
      "_",
      "%@example.com",
      "sam@example.co_",
      "sam@%",
    ]) {
      assert.deepEqual(
        await call(server_, A, odd),
        { leads: 0, contacts: 0, drip_enrollments: 0 },
        odd,
      );
    }
    assert.equal(await everything(), untouched, "a partial address or a pattern changed rows");

    // 7. Missing input is refused, not treated as "everyone".
    for (const [tenant, email] of [
      [null, "sam@example.com"],
      [A, null],
      [A, ""],
      [A, "   "],
    ]) {
      await assert.rejects(call(server_, tenant, email), /needs a company and an address/);
    }
    assert.equal(await everything(), untouched);

    // 8. A table of the same name in the caller's own temporary schema cannot stand in for ours.
    await server_.query(
      "CREATE TEMP TABLE leads (tenant_id uuid, email text, name text, subscribed boolean, consent_given boolean)",
    );
    await server_.query(
      "INSERT INTO pg_temp.leads VALUES ($1, 'sam@example.com', 'temp-decoy', true, true)",
      [A],
    );
    await call(server_, A, "sam@example.com");
    assert.equal(
      (await server_.query("SELECT subscribed FROM pg_temp.leads")).rows[0].subscribed,
      true,
      "the temporary decoy was written instead of the real table",
    );
    await server_.query("DROP TABLE pg_temp.leads");
    assert.equal(leadsDone((await named("leads"))["a-exact"]), true);

    // 9. With the drip table present: active enrolments for that address and company are
    //    cancelled (any spelling); finished ones, other addresses and other companies are not.
    await db.query(`
      CREATE TABLE public.drip_sequences (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
      CREATE TABLE public.drip_enrollments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        sequence_id uuid NOT NULL REFERENCES public.drip_sequences(id) ON DELETE CASCADE,
        email text NOT NULL,
        current_step int NOT NULL DEFAULT 1,
        status text NOT NULL DEFAULT 'enrolled'
          CHECK (status IN ('enrolled', 'in_progress', 'completed', 'unsubscribed', 'paused')),
        next_run_at timestamptz NOT NULL DEFAULT now(),
        last_sent_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO public.drip_sequences (id) VALUES ('5e5e5e5e-0000-0000-0000-000000000001');
    `);
    const enrol = (tenant, email, status, label) =>
      db.query(
        "INSERT INTO public.drip_enrollments (tenant_id, sequence_id, email, status, current_step) VALUES ($1, '5e5e5e5e-0000-0000-0000-000000000001', $2, $3, $4)",
        [tenant, email, status, label],
      );
    const seedDrip = async () => {
      await seed();
      await db.query("TRUNCATE public.drip_enrollments");
      await enrol(A, "sam@example.com", "in_progress", 1);
      await enrol(A, "Sam@Example.com ", "enrolled", 2);
      await enrol(A, "sam@example.com", "completed", 3);
      await enrol(A, "sam@example.com", "paused", 4);
      await enrol(A, "xsam@example.com", "in_progress", 5);
      await enrol(B, "sam@example.com", "in_progress", 6);
    };
    const dripStatus = async () =>
      Object.fromEntries(
        (await db.query("SELECT current_step AS n, status FROM public.drip_enrollments")).rows.map(
          (r) => [r.n, r.status],
        ),
      );

    // 10. One transaction: when the last step fails, the first two are undone too.
    await seedDrip();
    await db.query(`
      CREATE FUNCTION public.refuse_drip_update() RETURNS trigger LANGUAGE plpgsql AS
        $$ BEGIN RAISE EXCEPTION 'drip table refused the update' USING ERRCODE = 'XX000'; END $$;
      CREATE TRIGGER refuse_drip_update BEFORE UPDATE ON public.drip_enrollments
        FOR EACH ROW EXECUTE FUNCTION public.refuse_drip_update();
    `);
    const untouchedDrip = await everything();
    await assert.rejects(call(server_, A, "sam@example.com"), /drip table refused the update/);
    assert.equal(
      await everything(),
      untouchedDrip,
      "leads/contacts stayed withdrawn although the call failed",
    );
    assert.deepEqual(await dripStatus(), {
      1: "in_progress",
      2: "enrolled",
      3: "completed",
      4: "paused",
      5: "in_progress",
      6: "in_progress",
    });
    await db.query("DROP TRIGGER refuse_drip_update ON public.drip_enrollments");

    // 11. And with nothing in the way, all three change together.
    assert.deepEqual(await call(server_, A, "sam@example.com"), {
      leads: 4,
      contacts: 2,
      drip_enrollments: 2,
    });
    assert.deepEqual(await dripStatus(), {
      1: "unsubscribed",
      2: "unsubscribed",
      3: "completed",
      4: "paused",
      5: "in_progress",
      6: "in_progress",
    });
    assert.deepEqual(await call(server_, A, "sam@example.com"), {
      leads: 0,
      contacts: 0,
      drip_enrollments: 0,
    });
  } finally {
    await server_.end();
  }

  // 12. Applying the migration again is harmless and leaves the grants as they were.
  await db.query(migration);
  const again = (await db.query(migration)).at(-1).rows[0];
  assert.deepEqual(
    [
      again.security_definer,
      again.anon_can_run,
      again.authenticated_can_run,
      again.service_role_can_run,
    ],
    [true, false, false, true],
  );
  const anon = await asRole("anon");
  try {
    await assert.rejects(call(anon, A, "sam@example.com"), /permission denied for function/);
  } finally {
    await anon.end();
  }
  assert.equal(
    (
      await db.query(
        `SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'withdraw_marketing_consent'`,
      )
    ).rows[0].n,
    1,
    "a second copy of the function exists",
  );

  console.log(
    "PASS: callable by service_role only (anon, authenticated and an ungranted role refused, PUBLIC revoked, control function proves the defaults); only the named company's spellings of the address change (case, spaces, tab) in leads, contacts and active drip enrolments; longer or partial addresses, patterns and other companies untouched; works with the drip table absent and present; one transaction (a failing last step undoes the first two); empty input refused; temp-schema decoy ignored; second call changes nothing; migration re-runs cleanly",
  );
} finally {
  if (db) await db.end();
  await server.stop();
}
