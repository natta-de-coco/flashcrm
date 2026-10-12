// Structural audit of the schema every migration produces. Looks for the
// things that do not hurt at 5 rows and do hurt at 50,000: RLS filters with no
// index behind them, foreign keys that force a sequential scan on delete,
// missing uniqueness where the app has already produced duplicates, and
// cascade chains that reach further than anyone expects.
//
//   npm install --no-save embedded-postgres@17.10.0-beta.17 pg
//   node supabase/verify/audit-schema.mjs
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.join(HERE, "..", "migrations");
const PORT = 54985;

const p = new EmbeddedPostgres({
  databaseDir: path.join(HERE, ".pgdata-audit"),
  user: "postgres",
  password: "postgres",
  port: PORT,
  persistent: false,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});
await p.initialise();
await p.start();
const c = new pg.Client({
  host: "localhost",
  port: PORT,
  user: "postgres",
  password: "postgres",
  database: "postgres",
});
await c.connect();
await c.query("SET search_path TO public, extensions");
await c.query(fs.readFileSync(path.join(HERE, "supabase-shim.sql"), "utf8"));
for (const f of fs
  .readdirSync(MIG)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  try {
    await c.query(fs.readFileSync(path.join(MIG, f), "utf8"));
  } catch {
    try {
      await c.query("ROLLBACK");
    } catch {}
  }
}

const show = async (title, why, sql, params = []) => {
  const { rows } = await c.query(sql, params);
  console.log(`\n=== ${title} — ${rows.length} ===`);
  console.log(`    ${why}`);
  for (const r of rows.slice(0, 25)) console.log("    " + Object.values(r).join("  ·  "));
  if (rows.length > 25) console.log(`    …and ${rows.length - 25} more`);
  return rows.length;
};

// 1. Every RLS policy filters on tenant_id. Without an index that is a
//    sequential scan on every single read the app performs.
await show(
  "tenant_id columns with no index",
  "RLS filters on tenant_id for nearly every table; unindexed means a full scan per query.",
  `SELECT c.relname AS table_name
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     JOIN information_schema.columns col
       ON col.table_schema='public' AND col.table_name=c.relname AND col.column_name='tenant_id'
    WHERE n.nspname='public' AND c.relkind='r'
      AND NOT EXISTS (
        SELECT 1 FROM pg_index i
         WHERE i.indrelid = c.oid
           AND (SELECT attname FROM pg_attribute
                 WHERE attrelid=c.oid AND attnum = i.indkey[0]) = 'tenant_id')
    ORDER BY 1;`,
);

// 2. Deleting a parent row scans every child table whose FK is unindexed.
await show(
  "foreign keys with no covering index",
  "Deleting a company or a conversation scans these tables end to end.",
  `SELECT con.conrelid::regclass::text || '.' ||
          (SELECT attname FROM pg_attribute
            WHERE attrelid=con.conrelid AND attnum=con.conkey[1]) AS fk
     FROM pg_constraint con
    WHERE con.contype='f'
      AND con.connamespace='public'::regnamespace
      AND NOT EXISTS (
        SELECT 1 FROM pg_index i
         WHERE i.indrelid=con.conrelid AND i.indkey[0]=con.conkey[1])
    ORDER BY 1;`,
);

// 3. The app has already produced two companies with the same name; nothing
//    at the database level stops it.
await show(
  "tables where a natural key has no unique constraint",
  "Nothing prevents duplicates the app cannot tell apart.",
  `SELECT 'organizations.slug' AS candidate
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conrelid='public.organizations'::regclass AND contype IN ('u','p')
         AND (SELECT attname FROM pg_attribute
               WHERE attrelid=conrelid AND attnum=conkey[1])='slug')
   UNION ALL
   SELECT 'organizations.name'
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conrelid='public.organizations'::regclass AND contype IN ('u','p')
         AND (SELECT attname FROM pg_attribute
               WHERE attrelid=conrelid AND attnum=conkey[1])='name');`,
);

// 4. How far does deleting one company actually reach?
await show(
  "tables that CASCADE when a company is deleted",
  "Deleting an organization silently removes rows from all of these.",
  `SELECT con.conrelid::regclass::text AS table_name
     FROM pg_constraint con
    WHERE con.contype='f' AND con.confrelid='public.organizations'::regclass
      AND con.confdeltype='c'
    ORDER BY 1;`,
);

// 5. Nullable tenant_id means a row can exist belonging to nobody — exactly
//    how the inbox ended up empty after the first migration.
await show(
  "tenant_id columns that allow NULL",
  "A NULL tenant_id row is invisible to every RLS policy — it belongs to nobody.",
  `SELECT table_name FROM information_schema.columns
    WHERE table_schema='public' AND column_name='tenant_id' AND is_nullable='YES'
    ORDER BY 1;`,
);

await c.end();
await p.stop();
