// A quotation could not be saved at all: "column reference \"period\" is ambiguous".
//
// next_document_number declared a plpgsql variable named `period` while
// document_sequences has a column of that name, and the ON CONFLICT target
// resolves both — so Postgres refused the statement and every Save draft and
// Finalise & number failed, showing the raw database message to the user.
//
// These pin the shape of the fix. The behaviour itself needs the database, so
// the migration carries its own verification query.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8").split("\r\n").join("\n");

const FIX = read(
  "supabase/migrations/20260926100000_fix_ambiguous_period_in_document_numbering.sql",
);

describe("document numbering no longer shadows the column it conflicts on", () => {
  it("declares the period variable with a name no column shares", () => {
    assert.match(FIX, /_period text;/);
    assert.ok(
      !/^\s+period text;/m.test(FIX),
      "a variable named `period` is what made the ON CONFLICT target ambiguous",
    );
  });

  it("still conflicts on the real column, and inserts the variable", () => {
    assert.match(FIX, /ON CONFLICT \(tenant_id, doc_type, period\)/);
    assert.match(FIX, /VALUES \(_tenant_id, _doc_type, _period, GREATEST\(start_at, 1\)\)/);
  });

  it("keeps the numbering atomic — one statement, not read-then-write", () => {
    // Two documents created at the same moment must not take the same number.
    assert.match(FIX, /DO UPDATE SET last_number = public\.document_sequences\.last_number \+ 1/);
    assert.match(FIX, /RETURNING last_number INTO n/);
  });

  it("leaves the format and the sequence untouched", () => {
    assert.match(FIX, /lpad\(n::text, padding, '0'\)/);
    assert.match(FIX, /COALESCE\(cfg->>'prefix', upper\(left\(_doc_type,3\)\)\)/);
  });

  it("says what it deliberately did not change", () => {
    // The UTC year is a real defect, but changing it belongs in its own
    // migration rather than in a fix that unblocks invoicing.
    assert.match(FIX, /NOT changed here/);
    assert.match(FIX, /workspace timezone/);
  });
});

describe("the function the app actually calls is the one that was fixed", () => {
  it("allocateNumber calls next_document_number", () => {
    const billing = read("src/lib/billing.server.ts");
    assert.match(billing, /rpc\("next_document_number"/);
  });
});
