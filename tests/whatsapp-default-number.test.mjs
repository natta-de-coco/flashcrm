// Switching a workspace's default WhatsApp number.
//
// The default number is what a send uses when a conversation has no number of
// its own. The switch was two separate writes -- clear the old one, set the
// new one -- so a failure between them left the workspace with no default at
// all, and it stayed that way after the database recovered. These tests drive
// the real server function against a database double that can refuse any one
// of those writes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { setDefaultWhatsAppNumber } from "../node_modules/.cache/flas-onboarding.mjs";

// The caller's own profile decides the workspace and whether they are an admin.
function context(role = "company_admin", tenant = "tenant-a") {
  return {
    userId: "user-1",
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: role ? { tenant_id: tenant, staff_role: role } : null,
            }),
          }),
        }),
      }),
    },
  };
}

const STATEMENT_TIMEOUT = {
  code: "57014",
  message: "canceling statement due to statement timeout",
};
const CONFLICT = { code: "23505", message: "duplicate key value violates unique constraint" };
const NO_SUCH_FUNCTION = {
  code: "PGRST202",
  message:
    "Could not find the function public.set_default_wa_number(_number_id, _tenant_id) in the schema cache",
};

// Service-role double for wa_numbers: filtered reads and updates, and the
// default-number function, each able to fail the way the database does.
//
//  defaultFunction  an error    the call fails with it. The default here is
//                               "no such function": its migration is not applied
//                   "installed" it switches the default, all or nothing
//                   "silent"    it answers with no error and no number
//  failUpdate       (patch, filters) => error | null, asked before each update
//                   is applied
//  failRead         an error every single-row read returns
function database(
  rows = [],
  { defaultFunction = NO_SUCH_FUNCTION, failUpdate = null, failRead = null } = {},
) {
  const updates = [];
  const rpcCalls = [];
  // Only the columns that were asked for come back, as from the database.
  const only = (columns, row) =>
    Object.fromEntries(
      String(columns ?? "*")
        .split(",")
        .map((c) => c.trim())
        .flatMap((c) => (c === "*" ? Object.entries(row) : c in row ? [[c, row[c]]] : [])),
    );
  globalThis.onboardingDb = {
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      assert.equal(name, "set_default_wa_number");
      if (defaultFunction === "silent") return { data: null, error: null };
      if (defaultFunction !== "installed") return { data: null, error: defaultFunction };
      for (const row of rows) {
        if (row.tenant_id === args._tenant_id) row.is_default = row.id === args._number_id;
      }
      return { data: args._number_id, error: null };
    },
    from(table) {
      assert.equal(table, "wa_numbers");
      const filters = [];
      const q = {
        select(columns) {
          q.columns = columns;
          return q;
        },
        eq(column, value) {
          filters.push([column, value]);
          return q;
        },
        maybeSingle() {
          q.one = true;
          return q;
        },
        update(patch) {
          q.patch = patch;
          return q;
        },
        then(resolve, reject) {
          const answer = (result) => Promise.resolve(result).then(resolve, reject);
          const match = rows.filter((r) => filters.every(([c, v]) => r[c] === v));
          if (q.patch) {
            const refusal = failUpdate?.(q.patch, filters) ?? null;
            updates.push({ filters: [...filters], patch: q.patch, refused: Boolean(refusal) });
            if (refusal) return answer({ data: null, error: refusal });
            for (const row of match) Object.assign(row, q.patch);
            return answer({ data: match.map((row) => only(q.columns, row)), error: null });
          }
          if (q.one) {
            if (failRead) return answer({ data: null, error: failRead });
            return answer({ data: match[0] ? only(q.columns, match[0]) : null, error: null });
          }
          return answer({ data: match.map((row) => only(q.columns, row)), error: null });
        },
      };
      return q;
    },
  };
  return { updates, rows, rpcCalls };
}

const twoNumbers = () => [
  { id: "wa-1", tenant_id: "tenant-a", is_default: true },
  { id: "wa-2", tenant_id: "tenant-a", is_default: false },
  { id: "wb-1", tenant_id: "tenant-b", is_default: true },
];
const defaultsOf = (rows, tenant = "tenant-a") =>
  rows.filter((r) => r.tenant_id === tenant && r.is_default).map((r) => r.id);
const makeDefault = (id = "wa-2") => setDefaultWhatsAppNumber({ data: { id }, context: context() });
/** Refuses the write that makes `id` the default, and nothing else. */
const refuseSetting = (id, error) => (patch, filters) =>
  patch.is_default === true && filters.some(([c, v]) => c === "id" && v === id) ? error : null;

describe("once the database has the function, the switch is one call", () => {
  it("switches in one database call, for the caller's own workspace", async () => {
    const { rows, updates, rpcCalls } = database(twoNumbers(), { defaultFunction: "installed" });
    assert.deepEqual(await makeDefault(), { ok: true });
    assert.deepEqual(rpcCalls, [
      { name: "set_default_wa_number", args: { _tenant_id: "tenant-a", _number_id: "wa-2" } },
    ]);
    assert.equal(updates.length, 0, "no separate clear and set that could be torn apart");
    assert.deepEqual(defaultsOf(rows), ["wa-2"]);
    assert.deepEqual(defaultsOf(rows, "tenant-b"), ["wb-1"]);
  });

  it("keeps the previous default when the call fails, and does not try it in two steps", async () => {
    const { rows, updates } = database(twoNumbers(), { defaultFunction: STATEMENT_TIMEOUT });
    await assert.rejects(makeDefault(), /Could not change the default number/);
    assert.equal(updates.length, 0, "the function is there and said no: nothing else is tried");
    assert.deepEqual(defaultsOf(rows), ["wa-1"]);
  });

  it("says a database update is needed while the old database-wide index refuses it", async () => {
    const { rows, updates } = database(twoNumbers(), { defaultFunction: CONFLICT });
    await assert.rejects(makeDefault(), /needs a database update/);
    assert.equal(updates.length, 0);
    assert.deepEqual(defaultsOf(rows), ["wa-1"]);
  });

  it("says the number is not this workspace's when the database finds it gone", async () => {
    const gone = { code: "P0002", message: "That number is not connected to this workspace." };
    const { rows, updates } = database(twoNumbers(), { defaultFunction: gone });
    await assert.rejects(makeDefault(), /not connected to this workspace/);
    assert.equal(updates.length, 0);
    assert.deepEqual(defaultsOf(rows), ["wa-1"]);
  });

  it("is not done until the database names the number that is now the default", async () => {
    const { rows } = database(twoNumbers(), { defaultFunction: "silent" });
    await assert.rejects(makeDefault(), /Could not change the default number/);
    assert.deepEqual(defaultsOf(rows), ["wa-1"]);
  });
});

describe("until the database has the function, a failed switch is undone", () => {
  it("asks for the function first, then switches in two steps", async () => {
    for (const code of ["PGRST202", "42883"]) {
      const missing = { code, message: "function public.set_default_wa_number does not exist" };
      const { rows, updates, rpcCalls } = database(twoNumbers(), { defaultFunction: missing });
      assert.deepEqual(await makeDefault(), { ok: true });
      assert.equal(rpcCalls.length, 1, code);
      assert.deepEqual(
        updates.map((u) => u.patch.is_default),
        [false, true],
        "clear, then set",
      );
      assert.deepEqual(defaultsOf(rows), ["wa-2"]);
      assert.deepEqual(defaultsOf(rows, "tenant-b"), ["wb-1"]);
    }
  });

  it("puts the previous default back when the new one cannot be set", async () => {
    const { rows, updates } = database(twoNumbers(), {
      failUpdate: refuseSetting("wa-2", STATEMENT_TIMEOUT),
    });
    await assert.rejects(makeDefault(), /Could not set that number as the default/);
    // The workspace used to be left with no default number here.
    assert.deepEqual(defaultsOf(rows), ["wa-1"]);
    assert.deepEqual(defaultsOf(rows, "tenant-b"), ["wb-1"]);
    // Cleared, refused, put back -- and every one of them inside the workspace.
    assert.deepEqual(
      updates.map((u) => [u.patch.is_default, u.refused]),
      [
        [false, false],
        [true, true],
        [true, false],
      ],
    );
    for (const update of updates) {
      assert.ok(update.filters.some(([c, v]) => c === "tenant_id" && v === "tenant-a"));
    }
    assert.ok(updates[2].filters.some(([c, v]) => c === "id" && v === "wa-1"));
  });

  it("puts it back, too, when it is the old database-wide index that refuses", async () => {
    const { rows } = database(twoNumbers(), { failUpdate: refuseSetting("wa-2", CONFLICT) });
    await assert.rejects(makeDefault(), /needs a database update/);
    assert.deepEqual(defaultsOf(rows), ["wa-1"]);
  });

  it("still reports the failure when the previous default cannot be put back either", async () => {
    const { rows, updates } = database(twoNumbers(), {
      failUpdate: (patch) => (patch.is_default === true ? STATEMENT_TIMEOUT : null),
    });
    await assert.rejects(makeDefault(), /Could not set that number as the default/);
    assert.equal(updates.filter((u) => u.refused).length, 2, "the set, and the attempt to undo");
    // Nothing is marked as the default that is not: the list shows the truth.
    assert.deepEqual(defaultsOf(rows), []);
  });

  it("changes nothing when the old default cannot be cleared", async () => {
    const { rows, updates } = database(twoNumbers(), {
      failUpdate: (patch) => (patch.is_default === false ? STATEMENT_TIMEOUT : null),
    });
    await assert.rejects(makeDefault(), /Could not change the default number/);
    assert.equal(updates.length, 1, "the new default is not set over an old one still in place");
    assert.deepEqual(defaultsOf(rows), ["wa-1"]);
  });

  it("does not take the default away from the number that already has it", async () => {
    // It used to be cleared in order to be set again, and lost when that failed.
    const { rows, updates } = database(twoNumbers(), {
      failUpdate: refuseSetting("wa-1", STATEMENT_TIMEOUT),
    });
    assert.deepEqual(await makeDefault("wa-1"), { ok: true });
    assert.equal(updates.length, 0, "it is the default already: there is nothing to write");
    assert.deepEqual(defaultsOf(rows), ["wa-1"]);
  });

  it("has nothing to put back for a workspace that had no default", async () => {
    const { rows, updates } = database([{ id: "wa-2", tenant_id: "tenant-a", is_default: false }], {
      failUpdate: refuseSetting("wa-2", STATEMENT_TIMEOUT),
    });
    await assert.rejects(makeDefault(), /Could not set that number as the default/);
    assert.equal(updates.length, 2, "cleared nothing, was refused, and wrote nothing else");
    assert.deepEqual(defaultsOf(rows), []);
  });
});

describe("whose number it is comes first, either way", () => {
  it("does not call a number someone else's because it could not be read", async () => {
    const { updates, rpcCalls } = database(twoNumbers(), {
      defaultFunction: "installed",
      failRead: STATEMENT_TIMEOUT,
    });
    await assert.rejects(makeDefault(), (error) => {
      assert.match(error.message, /Could not change the default number/);
      assert.doesNotMatch(error.message, /not connected/);
      return true;
    });
    assert.equal(rpcCalls.length, 0);
    assert.equal(updates.length, 0);
  });

  it("never asks the database to switch to another workspace's number", async () => {
    for (const defaultFunction of ["installed", NO_SUCH_FUNCTION]) {
      const { rows, updates, rpcCalls } = database(twoNumbers(), { defaultFunction });
      await assert.rejects(makeDefault("wb-1"), /not connected to this workspace/);
      assert.equal(rpcCalls.length, 0);
      assert.equal(updates.length, 0);
      assert.deepEqual(defaultsOf(rows), ["wa-1"]);
      assert.deepEqual(defaultsOf(rows, "tenant-b"), ["wb-1"]);
    }
  });

  it("refuses anyone who is not a company admin, before anything is read", async () => {
    const { updates, rpcCalls } = database(twoNumbers(), { defaultFunction: "installed" });
    await assert.rejects(
      setDefaultWhatsAppNumber({ data: { id: "wa-2" }, context: context("agent") }),
      /Only company admins/,
    );
    assert.equal(rpcCalls.length, 0);
    assert.equal(updates.length, 0);
  });
});

describe("the function the switch relies on", () => {
  const sql = readFileSync(
    new URL("../supabase/migrations/20261007120000_set_default_wa_number.sql", import.meta.url),
    "utf8",
  )
    .split("\r\n")
    .join("\n");

  // What the function does is proved by running it, per role, in a real
  // database: supabase/verify/verify-default-wa-number.mjs. This only pins the
  // name and arguments the code above calls it by, and who may call it.
  it("has the name and arguments the server calls it with", () => {
    assert.match(
      sql,
      /CREATE OR REPLACE FUNCTION public\.set_default_wa_number\(_tenant_id uuid, _number_id uuid\)/,
    );
  });

  it("is for the server's own role only", () => {
    assert.match(
      sql,
      /REVOKE ALL ON FUNCTION public\.set_default_wa_number\(uuid, uuid\)\s+FROM PUBLIC, anon, authenticated;/,
    );
    assert.match(
      sql,
      /GRANT EXECUTE ON FUNCTION public\.set_default_wa_number\(uuid, uuid\) TO service_role;/,
    );
  });
});
