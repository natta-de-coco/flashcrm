// Contract for the multi-identity contacts migration.
//
// The schema cannot be exercised here — there is no Postgres in this
// environment — so these assert the properties the feature's correctness rests
// on, in the file that will be applied. They are cheap, and each one maps to a
// specific way the feature would break in production if it were edited away.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const MIGRATION = path.join(
  process.cwd(),
  "supabase/migrations/20260910120000_contact_identities_and_branches.sql",
);

const sql = fs.readFileSync(MIGRATION, "utf8");
const flat = sql.replace(/\s+/g, " ");

describe("contact identities migration", () => {
  it("exists and creates both tables", () => {
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.contact_identities/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.contact_branches/);
  });

  it("makes one number resolve to exactly one contact per workspace", () => {
    // Without this unique index the whole feature is decorative: two contacts
    // could hold the same number and an inbound message would pick either.
    assert.match(
      flat,
      /CREATE UNIQUE INDEX IF NOT EXISTS contact_identities_tenant_value_key ON public\.contact_identities \(tenant_id, kind, normalized\)/,
    );
  });

  it("matches on a normalized value, not on what someone typed", () => {
    // "+971 50 963 0506" and "971509630506" are the same customer.
    assert.match(
      flat,
      /normalized text GENERATED ALWAYS AS \(public\.normalize_contact_identity\(kind, value\)\) STORED/,
    );
  });

  it("keeps the normalizer IMMUTABLE, or the index cannot be built", () => {
    const fn = sql.slice(
      sql.indexOf("CREATE OR REPLACE FUNCTION public.normalize_contact_identity"),
    );
    assert.match(fn.slice(0, 400), /IMMUTABLE/);
  });

  it("scopes both tables to the workspace with RLS", () => {
    // These tables carry customer phone numbers. An allow-all policy here would
    // be a cross-tenant leak of exactly the kind this repo has already had.
    for (const table of ["contact_identities", "contact_branches"]) {
      assert.match(sql, new RegExp(`ALTER TABLE public\\.${table}\\s+ENABLE ROW LEVEL SECURITY`));
      assert.match(
        flat,
        new RegExp(
          `CREATE POLICY ${table}_tenant_all ON public\\.${table} FOR ALL TO authenticated USING \\(tenant_id = public\\.current_tenant_id\\(\\)\\)`,
        ),
      );
    }
    assert.doesNotMatch(flat, /USING \(true\)/);
  });

  it("drops each policy before creating it, so it can be re-run", () => {
    // A CREATE POLICY with no guard applies once and fails forever after —
    // a mistake this repo has already had to fix across 17 policies.
    for (const table of ["contact_identities", "contact_branches"]) {
      assert.match(sql, new RegExp(`DROP POLICY IF EXISTS ${table}_tenant_all`));
    }
  });

  it("backfills existing contacts without failing on duplicates", () => {
    // A tenant with two contacts sharing a number must not abort the whole
    // migration; the first keeps it and the duplicate is left for a human.
    const inserts = sql.match(
      /INSERT INTO public\.contact_identities[\s\S]*?ON CONFLICT DO NOTHING;/g,
    );
    assert.equal(inserts?.length, 2, "expected a phone backfill and an email backfill");
  });

  it("keeps a number when its branch is deleted", () => {
    // Closing a branch must not delete the customer's phone number.
    assert.match(
      flat,
      /branch_id uuid REFERENCES public\.contact_branches\(id\) ON DELETE SET NULL/,
    );
  });

  it("removes identities and branches with the contact", () => {
    assert.match(
      flat,
      /contact_id uuid NOT NULL REFERENCES public\.contacts\(id\) ON DELETE CASCADE/,
    );
  });

  it("allows at most one primary of each kind", () => {
    assert.match(
      flat,
      /CREATE UNIQUE INDEX IF NOT EXISTS contact_identities_one_primary_key ON public\.contact_identities \(contact_id, kind\) WHERE is_primary/,
    );
  });

  it("does not expose the resolver to anonymous callers", () => {
    // It takes a tenant id as an argument and is SECURITY DEFINER, so an
    // anonymous caller could otherwise enumerate whose number is whose.
    assert.match(
      flat,
      /REVOKE ALL ON FUNCTION public\.resolve_contact_by_identity\(uuid, text, text\) FROM PUBLIC, anon/,
    );
  });

  it("only accepts the two kinds the resolver understands", () => {
    assert.match(flat, /kind text NOT NULL CHECK \(kind IN \('phone', 'email'\)\)/);
  });
});

describe("the inbound resolver uses identities", () => {
  const wa = fs.readFileSync(path.join(process.cwd(), "src/lib/wa.server.ts"), "utf8");

  it("asks the database who owns the number", () => {
    assert.match(wa, /resolve_contact_by_identity/);
  });

  it("still falls back to the legacy phone column", () => {
    // A contact created between the migration and this deploy has no identity
    // row yet; dropping the fallback would make them a stranger again.
    const block = wa.slice(wa.indexOf("resolve_contact_by_identity"));
    assert.match(block.slice(0, 1600), /\.eq\("phone", phone\)/);
  });

  it("records the number so the next message resolves directly", () => {
    const block = wa.slice(wa.indexOf("resolve_contact_by_identity"));
    assert.match(block.slice(0, 2600), /from\("contact_identities"\)\s*\.insert/);
  });
});
