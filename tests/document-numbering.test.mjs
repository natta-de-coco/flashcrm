// A quotation could not be saved at all: "column reference \"period\" is ambiguous".
//
// next_document_number declared a plpgsql variable named `period` while
// document_sequences has a column of that name, so the ON CONFLICT target
// resolved to both and Postgres refused the statement. Every Save draft and
// Finalise & number failed, and the raw database message was shown to the user.
//
// The fix landed on main as a new definition of the function. These tests read
// whichever migration defines it LAST, so they keep protecting the behaviour no
// matter who edits the function next — a regenerated definition that
// reintroduces the shadowed variable fails here rather than in front of a
// customer.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const MIGRATIONS = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
const read = (file) => readFileSync(path.join(MIGRATIONS, file), "utf8").split("\r\n").join("\n");

/** The definition Postgres would end up with: the last one applied. */
function currentDefinition() {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  let latest = null;
  for (const file of files) {
    const sql = read(file);
    const at = sql.search(/CREATE OR REPLACE FUNCTION public\.next_document_number\s*\(/);
    if (at >= 0) latest = { file, body: sql.slice(at) };
  }
  assert.ok(latest, "no migration defines next_document_number");
  return latest;
}

describe("document numbering does not shadow the column it conflicts on", () => {
  const { file, body } = currentDefinition();

  it(`the definition in force (${file}) declares no variable named period`, () => {
    // This is the whole bug: a variable called `period`, with a column of the
    // same name in the ON CONFLICT target.
    assert.ok(
      !/^\s*period\s+text\s*;/m.test(body),
      "a plpgsql variable named `period` makes ON CONFLICT (…, period) ambiguous",
    );
    assert.match(body, /^\s*(?:v_|_)period\s+text\s*;/m);
  });

  it("still conflicts on the real column", () => {
    assert.match(body, /ON CONFLICT \(tenant_id, doc_type, period\)/);
  });

  it("inserts the variable, not the column name", () => {
    assert.match(body, /VALUES \(_tenant_id, _doc_type, (?:v_|_)period, GREATEST\(start_at, 1\)\)/);
  });

  it("keeps the allocation atomic — two documents cannot take one number", () => {
    assert.match(body, /DO UPDATE SET last_number = public\.document_sequences\.last_number \+ 1/);
    assert.match(body, /RETURNING last_number INTO n/);
  });

  it("keeps the number format", () => {
    assert.match(body, /lpad\(n::text, padding, '0'\)/);
    assert.match(body, /COALESCE\(cfg->>'prefix', upper\(left\(_doc_type,3\)\)\)/);
  });

  it("runs as the definer with a pinned search_path", () => {
    assert.match(body, /SECURITY DEFINER/);
    assert.match(body, /SET search_path/);
  });
});

describe("the function the app calls is the one under test", () => {
  it("allocateNumber calls next_document_number", () => {
    const billing = readFileSync(new URL("../src/lib/billing.server.ts", import.meta.url), "utf8");
    assert.match(billing, /rpc\("next_document_number"/);
  });
});

describe("known and still open", () => {
  it("the year and the annual reset still use UTC, not the workspace timezone", () => {
    // Not a failure — a record. A Dubai document raised just after midnight on
    // 1 January carries the previous year's number, because the function uses
    // now() while issue dates use the workspace timezone. Changing it moves
    // numbering at a year boundary, so it needs its own migration and a decision
    // about documents already numbered. If someone fixes it, this test tells
    // them to delete this block.
    const { body } = currentDefinition();
    assert.match(body, /to_char\(now\(\), 'YYYY'\)/);
  });
});
