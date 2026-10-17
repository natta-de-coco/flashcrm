// Runs the validation-evidence migration in a real Postgres and proves, by doing it, the three
// things it claims: it can be run twice, it changes no existing row, and it works whether the two
// columns already exist or not. It also proves it hands out no new privilege.
//
//   npm install --no-save --package-lock=false --no-audit --no-fund embedded-postgres@17.10.0-beta.17 pg@8.23.0
//   node supabase/verify/verify-validation-evidence.mjs
//   npm ci --no-audit --no-fund     # puts node_modules back the way the lockfile says
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

const PORT = 54961;
const server = new EmbeddedPostgres({
  databaseDir: path.resolve(`node_modules/.cache/pg-validation-evidence-${Date.now()}`),
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

const TENANT_A = "aaaaaaaa-0000-0000-0000-000000000001";
const TENANT_B = "bbbbbbbb-0000-0000-0000-000000000001";
const row = (n) => `00000000-0000-0000-0000-00000000000${n}`;

const migration = readFileSync(
  new URL("../migrations/20261015120000_social_account_validation_evidence.sql", import.meta.url),
  "utf8",
);
const foundation = readFileSync(
  new URL("../migrations/20260910100000_social_batch1_foundation.sql", import.meta.url),
  "utf8",
);

const EVIDENCE = ["last_validation_attempt_at", "last_validation_success_at"];

let db;
try {
  await server.initialise();
  await server.start();
  db = new pg.Client(config);
  await db.connect();

  await db.query(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  `);

  // The table as a workspace without the foundation migration has it: no evidence columns.
  const without = `
    DROP TABLE IF EXISTS public.social_accounts;
    CREATE TABLE public.social_accounts (
      id uuid PRIMARY KEY,
      tenant_id uuid NOT NULL,
      platform text NOT NULL,
      label text NOT NULL,
      external_id text,
      active boolean NOT NULL DEFAULT true,
      health text NOT NULL DEFAULT 'connected',
      connection_state text NOT NULL DEFAULT 'not_configured',
      last_synced_at timestamptz
    );
    GRANT ALL ON public.social_accounts TO service_role;
    INSERT INTO public.social_accounts
      (id, tenant_id, platform, label, external_id, active, health, connection_state, last_synced_at)
    VALUES
      ('${row(1)}', '${TENANT_A}', 'facebook',  'Page one',  '111', true,  'connected',    'connected',    now()),
      ('${row(2)}', '${TENANT_A}', 'instagram', 'IG one',    '222', true,  'connected',    'connected',    now()),
      ('${row(3)}', '${TENANT_A}', 'facebook',  'Pending',   NULL,  true,  'connected',    'connected',    NULL),
      ('${row(4)}', '${TENANT_A}', 'youtube',   'Revoked',   '333', false, 'disconnected', 'revoked',      now() - interval '9 days'),
      ('${row(5)}', '${TENANT_B}', 'linkedin',  'Other co.', '444', true,  'attention',    'refresh_failed', NULL),
      ('${row(6)}', '${TENANT_B}', 'tiktok',    'Unplugged', '555', false, 'disconnected', 'disconnected', NULL);
  `;

  // Every column of every row plus the system column xmin, which changes whenever a row is
  // rewritten or updated. Equal xmin before and after is the proof that no row was touched.
  const snapshot = async () =>
    (
      await db.query(
        `SELECT to_jsonb(t) - 'last_validation_attempt_at' - 'last_validation_success_at' AS data,
                t.xmin::text AS xmin
           FROM public.social_accounts t ORDER BY t.id`,
      )
    ).rows;
  const evidenceColumns = async () =>
    (
      await db.query(
        `SELECT column_name, data_type, is_nullable, column_default
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'social_accounts'
            AND column_name = ANY($1) ORDER BY column_name`,
        [EVIDENCE],
      )
    ).rows;
  const verifiedCount = async () =>
    Number(
      (
        await db.query(
          "SELECT count(*) AS n FROM public.social_accounts WHERE last_validation_success_at IS NOT NULL",
        )
      ).rows[0].n,
    );

  /* ── Case 1: the columns do not exist yet ─────────────────────────────────── */
  await db.query(without);
  assert.equal((await evidenceColumns()).length, 0, "the fixture already has the columns");
  const before = await snapshot();
  assert.equal(before.length, 6);

  const first = await db.query(migration);
  const afterFirst = await snapshot();
  assert.deepEqual(afterFirst, before, "the migration changed or rewrote an existing row");

  const columns = await evidenceColumns();
  assert.deepEqual(
    columns.map((c) => c.column_name),
    EVIDENCE,
  );
  for (const c of columns) {
    assert.equal(c.data_type, "timestamp with time zone", `${c.column_name} has the wrong type`);
    assert.equal(c.is_nullable, "YES", `${c.column_name} must start empty`);
    assert.equal(c.column_default, null, `${c.column_name} must have no default`);
  }
  assert.equal(await verifiedCount(), 0, "an account started out verified");
  const unmarked = await db.query(
    "SELECT count(*) AS n FROM public.social_accounts WHERE last_validation_attempt_at IS NOT NULL",
  );
  assert.equal(Number(unmarked.rows[0].n), 0, "an account started out with an attempt on record");

  // The read-only check at the end of the file reports the same thing.
  const results = Array.isArray(first) ? first : [first];
  const report = results.at(-1).rows[0];
  assert.equal(Number(report.accounts), 6);
  assert.equal(Number(report.marked_verified), 0);
  assert.deepEqual(
    results.at(-2).rows.map((r) => r.column_name),
    EVIDENCE,
  );

  /* ── Case 2: run it a second time ─────────────────────────────────────────── */
  await db.query(migration);
  assert.deepEqual(await snapshot(), before, "running twice changed a row");
  assert.equal((await evidenceColumns()).length, 2);
  assert.equal(await verifiedCount(), 0);

  /* ── Case 3: it hands out nothing ─────────────────────────────────────────── */
  // The table grant above is to service_role only. A browser session must not have gained access
  // to either column; the server writes them with the service role.
  for (const column of EVIDENCE) {
    for (const role of ["anon", "authenticated"]) {
      const allowed = await db.query(
        "SELECT has_column_privilege($1, 'public.social_accounts', $2, 'SELECT, UPDATE') AS ok",
        [role, column],
      );
      assert.equal(allowed.rows[0].ok, false, `${role} gained access to ${column}`);
    }
  }
  // And the server can use them: one checked write, as the service role.
  const service = new pg.Client(config);
  await service.connect();
  try {
    await service.query("SET ROLE service_role");
    const written = await service.query(
      `UPDATE public.social_accounts
          SET last_validation_attempt_at = now(), last_validation_success_at = now()
        WHERE id = '${row(1)}' AND tenant_id = '${TENANT_A}' RETURNING id`,
    );
    assert.equal(written.rowCount, 1);
    const wrongTenant = await service.query(
      `UPDATE public.social_accounts SET last_validation_success_at = now()
        WHERE id = '${row(5)}' AND tenant_id = '${TENANT_A}' RETURNING id`,
    );
    assert.equal(wrongTenant.rowCount, 0, "the tenant guard must find nothing for another company");
  } finally {
    await service.end();
  }
  assert.equal(await verifiedCount(), 1, "exactly the one account that was written is verified");

  /* ── Case 4: the foundation migration adds the same two columns ───────────── */
  // 20260910100000 uses ADD COLUMN IF NOT EXISTS for both. Prove it finds them there, keeps the
  // value just written, and leaves the type alone, so applying the two files in either order is safe.
  const foundationLines = EVIDENCE.map((name) => {
    const line = foundation.split("\n").find((l) => l.includes(`ADD COLUMN IF NOT EXISTS ${name}`));
    assert.ok(line, `the foundation migration no longer declares ${name}`);
    return line.trim().replace(/,$/, "");
  });
  await db.query(`ALTER TABLE public.social_accounts ${foundationLines.join(", ")}`);
  assert.equal(await verifiedCount(), 1, "the foundation statement disturbed the stored evidence");
  assert.deepEqual(
    (await evidenceColumns()).map((c) => c.data_type),
    ["timestamp with time zone", "timestamp with time zone"],
  );

  /* ── Case 5: the columns already exist and hold values ────────────────────── */
  await db.query(without);
  await db.query(`
    ALTER TABLE public.social_accounts
      ADD COLUMN last_validation_attempt_at timestamptz,
      ADD COLUMN last_validation_success_at timestamptz;
    UPDATE public.social_accounts
       SET last_validation_attempt_at = '2026-10-01T10:00:00Z',
           last_validation_success_at = '2026-10-01T10:00:00Z'
     WHERE id = '${row(1)}';
    UPDATE public.social_accounts
       SET last_validation_attempt_at = '2026-10-02T10:00:00Z'
     WHERE id = '${row(2)}';
  `);
  const withValues = async () =>
    (
      await db.query(
        `SELECT id, last_validation_attempt_at::text AS attempt, last_validation_success_at::text AS success,
                xmin::text AS xmin
           FROM public.social_accounts ORDER BY id`,
      )
    ).rows;
  const seeded = await withValues();
  assert.equal(seeded.filter((r) => r.success).length, 1);
  await db.query(migration);
  assert.deepEqual(await withValues(), seeded, "existing evidence was changed or cleared");
  await db.query(migration);
  assert.deepEqual(await withValues(), seeded, "running twice over existing evidence changed it");

  console.log(
    "verify-validation-evidence: OK (twice-safe, no row touched, works with and without the columns, no new privilege)",
  );
} finally {
  await db?.end().catch(() => {});
  await server.stop().catch(() => {});
}
