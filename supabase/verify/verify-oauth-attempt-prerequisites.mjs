// Reproduce an older live schema without enabling the whole channel model.
// Everything runs in a disposable local PostgreSQL instance, never a remote DB.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const harness = process.env.FLAS_DB_HARNESS_ROOT
  ? createRequire(path.join(process.env.FLAS_DB_HARNESS_ROOT, "package.json"))
  : createRequire(import.meta.url);
const { default: EmbeddedPostgres } = await import(
  pathToFileURL(harness.resolve("embedded-postgres"))
);
const { default: pg } = await import(pathToFileURL(harness.resolve("pg")));
const migration = fs.readFileSync(
  path.join(here, "../migrations/20261022073000_oauth_attempt_write_prerequisites.sql"),
  "utf8",
);
const providerMigration = fs.readFileSync(
  path.join(here, "../migrations/20261022080000_oauth_provider_write_prerequisite.sql"),
  "utf8",
);
// Exercise the actual starter against Postgres. A copied insert omitted
// provider and code_verifier, so the first version missed a live failure.
fs.mkdirSync("node_modules/.cache", { recursive: true });
await build({
  entryPoints: ["src/lib/oauth.server.ts"],
  outfile: "node_modules/.cache/oauth-starter-postgres.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  alias: { "@": "./src" },
  logLevel: "error",
  plugins: [
    {
      name: "starter-io-boundaries",
      setup(b) {
        for (const [filter, name] of [
          [/client\.server$/, "admin"],
          [/oauth-preflight\.server$/, "preflight"],
          [/secret-box\.server$/, "secrets"],
          [/social-secrets\.server$/, "sealed"],
          [/connection-state\.server$/, "bookkeeping"],
        ])
          b.onResolve({ filter }, () => ({ path: name, namespace: "starter-test" }));
        const modules = {
          admin: "export const supabaseAdmin={from:(...a)=>globalThis.__starterDb.from(...a)};",
          preflight:
            "export async function oauthPreflight(){return {ready:true,allowedOrigin:'https://flas.example',credentials:{id:'synthetic-client',secret:'synthetic-secret',source:'shared'}}}",
          secrets:
            "export async function openSecret(){throw new Error('No real credentials in this test')}",
          sealed:
            "export async function encryptSecret(){return 'synthetic-sealed-verifier'} export function tokenAad(){return 'synthetic-aad'}",
          bookkeeping:
            "export async function beginAuthorization(){} export async function sweepAbandonedAttempts(){}",
        };
        b.onLoad({ filter: /.*/, namespace: "starter-test" }, ({ path }) => ({
          contents: modules[path],
          loader: "js",
        }));
      },
    },
  ],
});
const { startAuthorization } = await import("../../node_modules/.cache/oauth-starter-postgres.mjs");
const port = 55444;
const database = new EmbeddedPostgres({
  databaseDir: path.join(here, ".pgdata-oauth-attempt-prerequisites"),
  user: "postgres",
  password: "postgres",
  port,
  persistent: false,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});
let client;
let started = false;
try {
  await database.initialise();
  await database.start();
  started = true;
  client = new pg.Client({
    host: "127.0.0.1",
    port,
    user: "postgres",
    password: "postgres",
    database: "postgres",
  });
  await client.connect();
  globalThis.__starterDb = {
    from(table) {
      assert.equal(table, "oauth_states");
      return {
        async insert(row) {
          const columns = Object.keys(row);
          assert.ok(columns.every((column) => /^[a-z_]+$/.test(column)));
          try {
            await client.query(
              `INSERT INTO public.oauth_states (${columns.join(",")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(",")})`,
              Object.values(row),
            );
            return { error: null };
          } catch (error) {
            return { error: { message: error.message } };
          }
        },
      };
    },
  };
  const start = () =>
    startAuthorization({
      platform: "youtube",
      origin: "https://flas.example",
      tenantId: "00000000-0000-4000-8000-000000000001",
      userId: "00000000-0000-4000-8000-000000000002",
    });
  await client.query(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    CREATE TABLE public.oauth_states (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
      user_id uuid NOT NULL, platform text NOT NULL, state_hash text NOT NULL UNIQUE,
      redirect_uri text NOT NULL, code_verifier text, used_at timestamptz,
      attempt_state text NOT NULL DEFAULT 'started'
    );
    ALTER TABLE public.oauth_states ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.oauth_states FROM PUBLIC, anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.oauth_states TO service_role;
    INSERT INTO public.oauth_states(tenant_id,user_id,platform,state_hash,redirect_uri)
    VALUES ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002',
      'youtube','synthetic-old-hash','https://flas.example/api/public/oauth-callback');
  `);
  const before = (await client.query("SELECT id, state_hash FROM public.oauth_states")).rows;
  const aclBefore = (
    await client.query(
      "SELECT relacl::text FROM pg_class WHERE oid='public.oauth_states'::regclass",
    )
  ).rows;
  await client.query(migration);
  await client.query(migration);
  await client.query("SET ROLE service_role");
  const incomplete = await start();
  assert.equal(incomplete.ready, false);
  assert.match(incomplete.reason, /provider.*does not exist/);
  await client.query("RESET ROLE");
  await client.query(providerMigration);
  await client.query(providerMigration);
  const after = (await client.query("SELECT id, state_hash FROM public.oauth_states ORDER BY id"))
    .rows;
  assert.deepEqual(after, before, "Repair must retain existing OAuth attempts");
  assert.deepEqual(
    (
      await client.query(
        "SELECT relacl::text FROM pg_class WHERE oid='public.oauth_states'::regclass",
      )
    ).rows,
    aclBefore,
  );
  const columns = (
    await client.query(`SELECT attname, format_type(atttypid,atttypmod) AS type
    FROM pg_attribute WHERE attrelid='public.oauth_states'::regclass AND NOT attisdropped
    AND attname IN ('provider','purpose','target_account_id','requested_scopes') ORDER BY attname`)
  ).rows;
  assert.deepEqual(columns, [
    { attname: "provider", type: "text" },
    { attname: "purpose", type: "text" },
    { attname: "requested_scopes", type: "text[]" },
    { attname: "target_account_id", type: "uuid" },
  ]);
  for (const role of ["anon", "authenticated"])
    assert.equal(
      (
        await client.query(
          "SELECT has_table_privilege($1,'public.oauth_states','SELECT,INSERT,UPDATE,DELETE') AS allowed",
          [role],
        )
      ).rows[0].allowed,
      false,
    );
  await client.query("SET ROLE service_role");
  const complete = await start();
  assert.equal(complete.ready, true);
  const authorizeUrl = new URL(complete.url);
  assert.equal(authorizeUrl.origin, "https://accounts.google.com");
  assert.equal(authorizeUrl.searchParams.get("code_challenge_method"), "S256");
  const attempt = (
    await client.query(
      "SELECT provider, purpose, code_verifier, requested_scopes, state_hash FROM public.oauth_states WHERE provider='google'",
    )
  ).rows[0];
  assert.equal(attempt.purpose, "connect");
  assert.equal(attempt.code_verifier, "synthetic-sealed-verifier");
  assert.ok(attempt.requested_scopes.includes("https://www.googleapis.com/auth/youtube.readonly"));
  assert.match(attempt.state_hash, /^[0-9a-f]{64}$/);
  assert.notEqual(attempt.state_hash, authorizeUrl.searchParams.get("state"));
  await assert.rejects(
    client.query("UPDATE public.oauth_states SET purpose='invalid'"),
    /oauth_states_purpose_check/,
  );
  await client.query("RESET ROLE");
  assert.equal(
    (await client.query("SELECT count(*)::int AS count FROM public.oauth_states")).rows[0].count,
    2,
  );
  assert.equal(
    (
      await client.query(
        "SELECT count(*)::int AS count FROM pg_class WHERE relname='social_authorizations'",
      )
    ).rows[0].count,
    0,
  );
  console.log(
    "PASS: partial schema repaired; rerun safe; existing attempts retained; exact service-role starter insert works; browser grants unchanged; no channel-model tables activated.",
  );

  // Schema drift must roll the entire forward migration back, not force a cast.
  await client.query(
    "DROP TABLE public.oauth_states; CREATE TABLE public.oauth_states(id uuid, purpose integer)",
  );
  await assert.rejects(client.query(migration), /unexpected types/);
  await client.query("ROLLBACK");
  const drift = (
    await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='oauth_states' ORDER BY column_name",
    )
  ).rows;
  assert.deepEqual(drift, [{ column_name: "id" }, { column_name: "purpose" }]);
  console.log(
    "PASS: incompatible existing types refuse atomically without leaving partial columns.",
  );
  await client.query(
    "DROP TABLE public.oauth_states; CREATE TABLE public.oauth_states(id uuid, provider integer)",
  );
  await assert.rejects(client.query(providerMigration), /unexpected type/);
  await client.query("ROLLBACK");
  assert.equal(
    (
      await client.query(
        "SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='oauth_states' AND column_name='provider'",
      )
    ).rows[0].data_type,
    "integer",
  );
  console.log("PASS: incompatible provider type refuses without casting or changing history.");
} finally {
  if (client) await client.end();
  if (started) await database.stop();
}
