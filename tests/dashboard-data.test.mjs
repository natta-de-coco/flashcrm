import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildSync } from "esbuild";

async function loadModule(entry) {
  const result = buildSync({
    entryPoints: [entry],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    alias: { "@": "./src" },
    logLevel: "error",
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
}
const { getDashboardOverviewData } = await loadModule("src/lib/dashboard.server.ts");
const { requireDashboardAccess } = await loadModule("src/lib/dashboard-access.server.ts");

// A PostgREST-shaped adapter exercises the actual production aggregator,
// including filters, head counts and the bounded list query independently.
function dashboardClient({ failQuery = -1, missingCountQuery = -1 } = {}) {
  const calls = [];
  const conversations = Array.from({ length: 140 }, (_, index) => ({
    id: `chat-${index}`,
    status: "open",
    channel: "whatsapp",
    unread_count: index < 125 ? 2 : 0,
    last_message_at: new Date().toISOString(),
    last_message_preview: "Synthetic test message",
    contacts: { name: "Test person" },
  }));
  return {
    calls,
    from(table) {
      const call = { table, filters: [], limit: null, options: null };
      const queryIndex = calls.push(call) - 1;
      const query = {
        select(columns, options) {
          call.columns = columns;
          call.options = options;
          return query;
        },
        eq(column, value) {
          call.filters.push(["eq", column, value]);
          return query;
        },
        gt(column, value) {
          call.filters.push(["gt", column, value]);
          return query;
        },
        gte(column, value) {
          call.filters.push(["gte", column, value]);
          return query;
        },
        order() {
          return query;
        },
        limit(value) {
          call.limit = value;
          return query;
        },
        then(resolve, reject) {
          let data = [];
          let count = null;
          if (call.options?.head) {
            if (table === "conversations") {
              count = conversations.filter((row) =>
                call.filters.every(([method, field, value]) =>
                  method === "eq" ? row[field] === value : row[field] > value,
                ),
              ).length;
            } else if (table === "contacts") count = 1530;
            else if (table === "messages") count = 144;
            else if (table === "social_interactions") count = 0;
          } else if (table === "conversations") {
            data = conversations.slice(0, call.limit ?? conversations.length);
          }
          const result = {
            data: call.options?.head ? null : data,
            count: queryIndex === missingCountQuery ? null : count,
            error: queryIndex === failQuery ? { message: "Synthetic database detail" } : null,
          };
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

test("overview totals count beyond the 100 recent rows, with unread chats distinct from messages", async () => {
  const client = dashboardClient();
  const result = await getDashboardOverviewData(client);
  assert.equal(result.stats.open, 140);
  assert.equal(result.stats.unreadConversations, 125);
  assert.equal(result.stats.unread, 200, "legacy sum remains a bounded message count");
  assert.equal(result.stats.contacts, 1530);
  assert.equal(result.stats.botReplies, 144);
  assert.equal(result.recentConversations.length, 8);
  assert.equal(client.calls[0].limit, 100, "recent previews remain bounded");
  assert.deepEqual(client.calls[1].options, { count: "exact", head: true });
  assert.deepEqual(client.calls[1].filters, [["eq", "status", "open"]]);
  assert.deepEqual(client.calls[2].filters, [["gt", "unread_count", 0]]);
  assert.equal(
    result.health.score,
    Math.round(result.health.factors.reduce((sum, factor) => sum + factor.score, 0) / 5),
  );
});

for (let queryIndex = 0; queryIndex < 11; queryIndex += 1) {
  test(`overview rejects failed read ${queryIndex + 1} rather than returning clean or zero figures`, async (t) => {
    const logged = [];
    t.mock.method(console, "error", (...args) => logged.push(args));
    await assert.rejects(
      getDashboardOverviewData(dashboardClient({ failQuery: queryIndex })),
      (error) => {
        assert.match(error.message, /overview is unavailable/i);
        assert.doesNotMatch(error.message, /Synthetic database detail/);
        return true;
      },
    );
    assert.ok(logged.some((args) => args.includes("Synthetic database detail")));
  });
}

for (const queryIndex of [1, 2, 3, 4, 8, 9]) {
  test(`an absent exact count ${queryIndex} cannot silently become zero`, async (t) => {
    t.mock.method(console, "error", () => {});
    await assert.rejects(
      getDashboardOverviewData(dashboardClient({ missingCountQuery: queryIndex })),
      /overview is unavailable/i,
    );
  });
}

function profileClient(profile, error = null) {
  const calls = [];
  return {
    calls,
    from(table) {
      assert.equal(table, "profiles");
      return {
        select(columns) {
          assert.equal(columns, "staff_role, tenant_id");
          return this;
        },
        eq(column, value) {
          calls.push([column, value]);
          return this;
        },
        async maybeSingle() {
          return { data: profile, error };
        },
      };
    },
  };
}

test("customer dashboard access reads only the authenticated own profile and allows customer-facing roles", async () => {
  for (const role of ["super_admin", "company_admin", "marketing_manager", "staff"]) {
    const client = profileClient({ staff_role: role, tenant_id: "test-workspace" });
    assert.deepEqual(await requireDashboardAccess(client, "authenticated-user"), {
      tenantId: "test-workspace",
      role,
    });
    assert.deepEqual(client.calls, [["id", "authenticated-user"]]);
  }
});

test("SEO editors, unknown roles, missing tenants and missing profiles cannot read customer activity", async () => {
  for (const profile of [
    { staff_role: "seo_editor", tenant_id: "test-workspace" },
    { staff_role: "unknown", tenant_id: "test-workspace" },
    { staff_role: null, tenant_id: "test-workspace" },
    { staff_role: "company_admin", tenant_id: null },
    null,
  ]) {
    await assert.rejects(
      requireDashboardAccess(profileClient(profile), "authenticated-user"),
      /Your role cannot/i,
    );
  }
});

test("a failed role lookup is denied with a plain error before any aggregation", async (t) => {
  const logged = [];
  t.mock.method(console, "error", (...args) => logged.push(args));
  await assert.rejects(
    requireDashboardAccess(
      profileClient(null, { message: "Synthetic role lookup failure" }),
      "authenticated-user",
    ),
    /could not check your workspace access/i,
  );
  assert.ok(logged.some((args) => args.includes("Synthetic role lookup failure")));
  const client = profileClient({ staff_role: "staff", tenant_id: "test-workspace" });
  await assert.rejects(requireDashboardAccess(client, ""), /Sign in again/i);
  assert.deepEqual(client.calls, []);
});

test("both authenticated dashboard handlers check the middleware user before data or AI work", () => {
  for (const [file, operation] of [
    ["src/lib/dashboard.functions.ts", "getDashboardOverviewData(context.supabase)"],
    ["src/lib/brief.functions.ts", "buildDailyBrief(context.supabase"],
  ]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /middleware\(\[requireSupabaseAuth\]\)/);
    const guard = source.indexOf("await requireDashboardAccess(context.supabase, context.userId)");
    assert.ok(guard >= 0);
    assert.ok(
      source.indexOf(operation) > guard,
      `${file} must authorize before computing or generating`,
    );
  }
});
