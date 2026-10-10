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
const OTHER = "tenant-b";
let adminWrites, sessionWrites, rows;
/** "table:op" -> error, to make one write fail. */
let faults = {};

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
        const fault = faults[`${table}:${q.op}`];
        if (fault)
          return Promise.resolve({ data: null, error: fault, count: null }).then(resolve, reject);
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
  faults = {};
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

describe("a role change never reaches into another workspace", () => {
  // The profile write is limited to the caller's workspace. The legacy role
  // table has no workspace in it at all -- and was written regardless.
  beforeEach(() => {
    rows.profiles.push(
      { id: "their-staff", tenant_id: OTHER, staff_role: "staff" },
      { id: "their-admin", tenant_id: OTHER, staff_role: "company_admin" },
    );
    rows.user_roles.push({ user_id: "their-admin", role: "admin" });
  });
  const legacyWrites = () => adminWrites.filter((w) => w.table === "user_roles");
  const legacyAdmin = (userId) =>
    rows.user_roles.some((r) => r.user_id === userId && r.role === "admin");

  it("cannot make someone in another company an admin there", async () => {
    // The takeover: an ordinary member of company B opens a workspace of their
    // own, and from it promotes their company-B account.
    await assert.rejects(
      setStaffRole({
        data: { userId: "their-staff", staffRole: "company_admin" },
        context: context(),
      }),
      /not a member of this workspace/,
    );
    assert.equal(legacyAdmin("their-staff"), false, "they were given admin in the other company");
    assert.equal(legacyWrites().length, 0);
    assert.equal(rows.profiles.find((p) => p.id === "their-staff").staff_role, "staff");
  });

  it("cannot take admin away from another company's admin", async () => {
    await assert.rejects(
      setStaffRole({ data: { userId: "their-admin", staffRole: "staff" }, context: context() }),
      /not a member of this workspace/,
    );
    assert.equal(legacyAdmin("their-admin"), true, "another company's admin lost their role");
    assert.equal(rows.profiles.find((p) => p.id === "their-admin").staff_role, "company_admin");
  });

  it("cannot remove another company's admin", async () => {
    await assert.rejects(
      removeStaff({ data: { userId: "their-admin" }, context: context() }),
      /not a member of this workspace/,
    );
    assert.equal(legacyAdmin("their-admin"), true);
    assert.equal(rows.profiles.find((p) => p.id === "their-admin").tenant_id, OTHER);
    assert.equal(legacyWrites().length, 0);
  });

  it("does nothing for an id that is nobody", async () => {
    await assert.rejects(
      setStaffRole({
        data: { userId: "no-such-user", staffRole: "company_admin" },
        context: context(),
      }),
      /not a member of this workspace/,
    );
    await assert.rejects(removeStaff({ data: { userId: "no-such-user" }, context: context() }));
    assert.equal(legacyWrites().length, 0);
  });

  it("still changes and removes its own members, in both role systems", async () => {
    await setStaffRole({
      data: { userId: "agent-1", staffRole: "company_admin" },
      context: context(),
    });
    assert.equal(legacyAdmin("agent-1"), true);
    await setStaffRole({ data: { userId: "agent-1", staffRole: "staff" }, context: context() });
    assert.equal(legacyAdmin("agent-1"), false);
    await removeStaff({ data: { userId: "admin-2" }, context: context() });
    assert.equal(legacyAdmin("admin-2"), false);
    assert.equal(rows.profiles.find((p) => p.id === "admin-2").tenant_id, null);
  });

  it("does not report success when the legacy admin record could not be changed", async () => {
    // A demotion that leaves the admin row behind is the bug this code exists
    // to prevent; a failed write of it must not pass as done.
    faults["user_roles:delete"] = { code: "57014", message: "statement timeout" };
    await assert.rejects(
      setStaffRole({ data: { userId: "admin-2", staffRole: "staff" }, context: context() }),
      /older admin record could not be updated/,
    );
  });

  it("leaves a person removable when the legacy admin record could not be deleted", async () => {
    // The profile used to be cleared first. A failed delete then left the
    // person out of the workspace but still holding the global admin row, and
    // a retry stopped at "not a member" without ever reaching it.
    faults["user_roles:delete"] = { code: "57014", message: "statement timeout" };
    await assert.rejects(
      removeStaff({ data: { userId: "admin-2" }, context: context() }),
      /could not be removed, so they were not removed/,
    );
    assert.equal(rows.profiles.find((p) => p.id === "admin-2").tenant_id, TENANT, "removed anyway");
    assert.equal(legacyAdmin("admin-2"), true);

    faults = {};
    await removeStaff({ data: { userId: "admin-2" }, context: context() });
    assert.equal(rows.profiles.find((p) => p.id === "admin-2").tenant_id, null);
    assert.equal(legacyAdmin("admin-2"), false, "the admin row outlived the removal");
  });

  it("does not report a promotion as done when its legacy half failed", async () => {
    faults["user_roles:upsert"] = { code: "57014", message: "statement timeout" };
    await assert.rejects(
      setStaffRole({ data: { userId: "agent-1", staffRole: "company_admin" }, context: context() }),
      /older admin record could not be updated/,
    );
  });
});

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

describe("connecting a channel is a company-admin action, enforced on the server", () => {
  // A hidden button is not an authorization control: startConnect is a server
  // function any signed-in staff member can call directly, and connecting a
  // Facebook Page or Google account changes the whole workspace.
  const server = read("src/lib/connections.functions.ts");
  const startConnect = server.slice(
    server.indexOf("export const startConnect"),
    server.indexOf("export const getConnectReadiness"),
  );

  it("reads the caller's role, not just their workspace", () => {
    assert.match(startConnect, /\.select\("tenant_id, staff_role"\)/);
  });

  it("refuses anyone who is not a company or super admin before starting OAuth", () => {
    const check = startConnect.indexOf('["company_admin", "super_admin"].includes');
    const start = startConnect.indexOf("startAuthorization({");
    assert.ok(check > 0, "the role check must exist");
    assert.ok(start > check, "the check must run before an authorization is started");
    assert.match(startConnect, /Only a company admin can connect/);
  });
});
