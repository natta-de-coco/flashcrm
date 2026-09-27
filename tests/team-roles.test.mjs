// Who may change a role, and which client is allowed to write it.
//
// The browser role held table-wide UPDATE on `profiles` plus a policy letting a
// user update their own row, and `is_super_admin()` is simply "does my own row
// say super_admin". One PATCH to /rest/v1/profiles was therefore enough to
// become the platform owner. Closing that means the browser role loses UPDATE
// on staff_role — so the server has to write it, which is what these tests pin.
//
// The second half is the legacy role table: `is_tenant_admin()` accepts either
// system, and `user_roles` has no tenant column, so an admin row left behind by
// a demotion or a removal followed the person into their next workspace.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { readFileSync } from "node:fs";

import { removeStaff, setStaffRole } from "../node_modules/.cache/flas-onboarding.mjs";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
    .split("\r\n")
    .join("\n");

const TENANT = "tenant-a";
let adminWrites, sessionWrites, rows;

/** Records every write and which client made it. */
function client(label, writes) {
  const query = (table) => {
    const q = {
      filters: [],
      select() {
        return q;
      },
      eq(column, value) {
        q.filters.push([column, value]);
        return q;
      },
      update(patch) {
        q.op = "update";
        q.patch = patch;
        return q;
      },
      upsert(payload) {
        q.op = "upsert";
        q.patch = payload;
        return q;
      },
      delete() {
        q.op = "delete";
        return q;
      },
      maybeSingle: async () => ({ data: q.rowFor(), error: null }),
      single: async () => ({ data: q.rowFor(), error: null }),
      rowFor() {
        const match = (rows[table] ?? []).filter((r) => q.filters.every(([c, v]) => r[c] === v));
        return match[0] ?? null;
      },
      then(resolve, reject) {
        const match = (rows[table] ?? []).filter((r) => q.filters.every(([c, v]) => r[c] === v));
        if (q.op)
          writes.push({ client: label, table, op: q.op, patch: q.patch, filters: q.filters });
        if (q.op === "update") for (const r of match) Object.assign(r, q.patch);
        if (q.op === "delete") {
          rows[table] = (rows[table] ?? []).filter((r) => !match.includes(r));
        }
        if (q.op === "upsert") (rows[table] ??= []).push({ ...q.patch });
        return Promise.resolve({
          data: q.counting ? null : match,
          error: null,
          count: match.length,
        }).then(resolve, reject);
      },
    };
    // `select("id", { count: "exact", head: true })` shape
    const select = q.select;
    q.select = (_cols, options) => {
      if (options?.count) q.counting = true;
      return select();
    };
    return q;
  };
  return { from: query };
}

const context = (userId = "admin-1") => ({
  userId,
  supabase: client("session", sessionWrites),
});

beforeEach(() => {
  adminWrites = [];
  sessionWrites = [];
  rows = {
    profiles: [
      { id: "admin-1", tenant_id: TENANT, staff_role: "company_admin" },
      { id: "admin-2", tenant_id: TENANT, staff_role: "company_admin" },
      { id: "agent-1", tenant_id: TENANT, staff_role: "agent" },
    ],
    user_roles: [
      { user_id: "admin-1", role: "admin" },
      { user_id: "admin-2", role: "admin" },
    ],
  };
  globalThis.onboardingDb = client("service_role", adminWrites).from;
  // The bundle stubs client.server as a Proxy onto globalThis.onboardingDb, so
  // it needs the client shape, not just `from`.
  globalThis.onboardingDb = { from: client("service_role", adminWrites).from };
});

const profileWrites = (writes) => writes.filter((w) => w.table === "profiles" && w.op === "update");

describe("a teammate's role is written by the server, not by the browser session", () => {
  it("changes staff_role through the service role", async () => {
    await setStaffRole({
      data: { userId: "agent-1", staffRole: "company_admin" },
      context: context(),
    });
    assert.deepEqual(
      profileWrites(adminWrites).map((w) => w.patch),
      [{ staff_role: "company_admin" }],
    );
    assert.deepEqual(
      profileWrites(sessionWrites),
      [],
      "the caller's own session must not write it",
    );
  });

  it("still keeps the write inside the caller's workspace", async () => {
    await setStaffRole({ data: { userId: "agent-1", staffRole: "agent" }, context: context() });
    const write = profileWrites(adminWrites)[0];
    assert.ok(
      write.filters.some(([c, v]) => c === "tenant_id" && v === TENANT),
      "a role change must name the workspace, whatever id the browser sent",
    );
    assert.ok(write.filters.some(([c, v]) => c === "id" && v === "agent-1"));
  });

  it("refuses a caller who is not a company admin", async () => {
    rows.profiles[0].staff_role = "agent";
    await assert.rejects(
      setStaffRole({ data: { userId: "agent-1", staffRole: "company_admin" }, context: context() }),
      /Only company admins/,
    );
    assert.deepEqual(profileWrites(adminWrites), []);
  });

  it("refuses to demote the last company admin", async () => {
    // A super admin is the caller, because a workspace with exactly one company
    // admin cannot demote them from inside itself.
    rows.profiles = [
      { id: "boss", tenant_id: TENANT, staff_role: "super_admin" },
      { id: "only-admin", tenant_id: TENANT, staff_role: "company_admin" },
    ];
    await assert.rejects(
      setStaffRole({
        data: { userId: "only-admin", staffRole: "agent" },
        context: context("boss"),
      }),
      /only company admin/i,
    );
    assert.deepEqual(profileWrites(adminWrites), [], "nothing may be written when it is refused");
  });
});

describe("both role systems are revoked together", () => {
  const legacy = () => rows.user_roles.filter((r) => r.role === "admin").map((r) => r.user_id);

  it("a demotion removes the legacy admin row that outlived it", async () => {
    // Without this, is_tenant_admin() stayed true and the person could set their
    // own staff_role back through the tenant-admin policy.
    await setStaffRole({ data: { userId: "admin-2", staffRole: "agent" }, context: context() });
    assert.deepEqual(legacy(), ["admin-1"]);
  });

  it("a promotion adds it, so the two systems agree", async () => {
    await setStaffRole({
      data: { userId: "agent-1", staffRole: "company_admin" },
      context: context(),
    });
    assert.ok(legacy().includes("agent-1"));
  });

  it("removing someone from the workspace revokes it too", async () => {
    // It has no tenant column, so it followed them into the next workspace.
    await removeStaff({ data: { userId: "admin-2" }, context: context() });
    assert.deepEqual(legacy(), ["admin-1"]);
    const cleared = profileWrites(adminWrites)[0];
    assert.deepEqual(cleared.patch, { tenant_id: null, staff_role: "staff" });
  });
});

describe("the migration that closes the escalation", () => {
  const sql = read(
    "supabase/migrations/20260926090000_profiles_privilege_columns_are_server_only.sql",
  );

  it("takes table-wide UPDATE away from the browser role", () => {
    assert.match(sql, /REVOKE UPDATE ON public\.profiles FROM authenticated;/);
  });

  it("grants back only the fields a person edits about themselves", () => {
    assert.match(
      sql,
      /GRANT UPDATE \(full_name, avatar_url, last_seen_at\) ON public\.profiles TO authenticated;/,
    );
    // The presence check that matters: no blanket re-grant sneaking back in.
    assert.ok(
      !/GRANT UPDATE ON public\.profiles TO authenticated/.test(sql),
      "a table-level grant would reopen the hole the column grant closes",
    );
  });

  it("guards the privileged columns a second time, in case a grant returns", () => {
    assert.match(sql, /CREATE TRIGGER profiles_guard_privilege_columns/);
    for (const column of ["staff_role", "tenant_id", "suspended", "email"]) {
      assert.match(
        sql,
        new RegExp(`NEW\\.${column} IS DISTINCT FROM OLD\\.${column}`),
        `${column} must be refused from a browser session`,
      );
    }
    assert.match(sql, /service_role/);
  });

  it("says which order to deploy in, because the code has to land first", () => {
    assert.match(sql, /ORDER OF DEPLOYMENT/);
  });
});
