import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build, buildSync } from "esbuild";

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
const { getDashboardOverviewData: aggregateDashboard } = await loadModule(
  "src/lib/dashboard.server.ts",
);
const getDashboardOverviewData = (client, access = { role: "company_admin" }) =>
  aggregateDashboard(client, access);
const { requireDashboardAccess } = await loadModule("src/lib/dashboard-access.server.ts");

// A PostgREST-shaped adapter exercises the actual production aggregator,
// including filters, head counts and the bounded list query independently.
function dashboardClient({
  failQuery = -1,
  missingCountQuery = -1,
  empty = false,
  messages = [],
  leads = [],
  messageTotal = messages.length,
  leadTotal = leads.length,
} = {}) {
  const calls = [];
  const conversations = Array.from({ length: empty ? 0 : 140 }, (_, index) => ({
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
            } else if (table === "contacts") count = empty ? 0 : 1530;
            else if (table === "messages") count = empty ? 0 : 144;
            else if (table === "social_interactions") count = 0;
          } else if (table === "conversations") {
            data = conversations.slice(0, call.limit ?? conversations.length);
          } else if (table === "messages") {
            data = messages;
            count = messageTotal;
          } else if (table === "leads") {
            data = leads;
            count = leadTotal;
          } else if (table === "social_accounts") {
            count = 0;
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
    null,
    "a recorded inbox alone cannot fabricate three measured factors",
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
  for (const [file, operation, suffix] of [
    ["src/lib/dashboard.functions.ts", "getDashboardOverviewData(context.supabase, access)", ")"],
    ["src/lib/brief.functions.ts", "buildDailyBrief(context.supabase", ', "advisor")'],
  ]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /middleware\(\[requireSupabaseAuth\]\)/);
    const guard = source.indexOf(
      "await requireDashboardAccess(context.supabase, context.userId" + suffix,
    );
    assert.ok(guard >= 0);
    assert.ok(
      source.indexOf(operation) > guard,
      `${file} must authorize before computing or generating`,
    );
  }
});

test("an empty workspace has no invented factor values or risk grade", async () => {
  const result = await getDashboardOverviewData(dashboardClient({ empty: true }));
  assert.equal(result.health.score, null);
  assert.equal(result.health.grade, "Not enough activity yet");
  assert.ok(result.health.factors.every((factor) => factor.score === null));
});

test("real measured activity receives the equal mean of available factors", async () => {
  const now = new Date().toISOString();
  const result = await getDashboardOverviewData(
    dashboardClient({
      messages: [
        { sender: "contact", created_at: now },
        { sender: "bot", created_at: now },
      ],
      leads: [{ created_at: now, consent_given: true }],
    }),
  );
  const measured = result.health.factors.filter((factor) => factor.score !== null);
  assert.ok(measured.length >= 3);
  assert.equal(
    result.health.score,
    Math.round(measured.reduce((sum, factor) => sum + factor.score, 0) / measured.length),
  );
});

test("front-line overview performs no social, marketing-lead or hidden bot-count reads", async () => {
  const client = dashboardClient();
  const result = await getDashboardOverviewData(client, { role: "staff" });
  assert.equal(client.calls.length, 5);
  assert.ok(
    client.calls.every(
      (call) => !["social_accounts", "social_interactions", "leads"].includes(call.table),
    ),
  );
  assert.ok(!client.calls.some((call) => call.table === "messages" && call.options?.head));
  assert.deepEqual(result.visibility, { social: false, leads: false });
  assert.deepEqual(result.social.accounts, []);
  assert.ok(
    result.health.factors.every((factor) => ["responsiveness", "inbox"].includes(factor.key)),
  );
});

test("omitting internal access context defaults to the least-privileged customer role", async () => {
  const client = dashboardClient();
  const result = await aggregateDashboard(client);
  assert.deepEqual(result.visibility, { social: false, leads: false });
  assert.ok(
    client.calls.every(
      (call) => !["social_accounts", "social_interactions", "leads"].includes(call.table),
    ),
  );
});

test("PostgREST row caps are detected by exact coverage and incomplete factors are not scored", async () => {
  const now = new Date().toISOString();
  const client = dashboardClient({
    messages: [{ sender: "contact", created_at: now }],
    messageTotal: 25000,
    leads: [{ created_at: now, consent_given: true }],
    leadTotal: 9000,
  });
  const result = await getDashboardOverviewData(client);
  assert.equal(result.activity.partial, true);
  assert.deepEqual(result.sampling, { messages: true, leads: true, socialAccounts: false });
  assert.equal(result.health.score, null);
  assert.ok(
    result.health.factors
      .filter((factor) => ["responsiveness", "pipeline", "consent"].includes(factor.key))
      .every((factor) => factor.score === null),
  );
  assert.equal(client.calls[5].options.count, "exact");
  assert.equal(client.calls[10].options.count, "exact");
});

async function loadHandler(entry, { briefFacts = false } = {}) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    alias: { "@": "./src" },
    logLevel: "error",
    plugins: [
      {
        name: "isolated-server-handler-test",
        setup(builder) {
          const stubs = new Map([
            [
              "@tanstack/react-start",
              "export function createServerFn() { return {middleware(){return this}, inputValidator(){return this}, handler(fn){return fn}} }",
            ],
            ["@/integrations/supabase/auth-middleware", "export const requireSupabaseAuth = {};"],
          ]);
          builder.onResolve({ filter: /.*/ }, (args) => {
            let source = stubs.get(args.path);
            if (/client\.server$/.test(args.path))
              source =
                "export const supabaseAdmin = {from(){throw Error('Unexpected admin import use')}};";
            if (/secret-box\.server$/.test(args.path))
              source =
                "export async function openSecret(){throw Error('Unexpected secret opening')}";
            if (!briefFacts && /brief\.server$/.test(args.path))
              source =
                "export async function buildDailyBrief(){globalThis.__homeBriefCost++;return {headline:'Test only'}}";
            if (briefFacts && /dashboard\.server$/.test(args.path))
              source =
                "export async function getDashboardOverviewData(){return globalThis.__homeOverviewFixture}";
            if (briefFacts && /flash-ai\.server$/.test(args.path))
              source =
                "export async function getBusinessContext(){return null};export async function aiOptionsFor(){return {}};export async function callFlashAi(system,facts){globalThis.__homeBriefFacts=facts;return JSON.stringify({headline:'Test',summary:'Test',actions:[]})}";
            if (source) return { path: source, namespace: "handler-stub" };
          });
          builder.onLoad({ filter: /.*/, namespace: "handler-stub" }, (args) => ({
            contents: args.path,
            loader: "js",
          }));
        },
      },
    ],
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
}

const meta = await loadHandler("src/lib/meta-health.functions.ts");
const briefHandler = await loadHandler("src/lib/brief.functions.ts");
const overviewHandler = await loadHandler("src/lib/dashboard.functions.ts");
const briefData = await loadHandler("src/lib/brief.server.ts", { briefFacts: true });

function healthAdmin({ fail = null, missing = null, empty = false, active = false } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const call = { table, filters: [] };
      calls.push(call);
      const query = {
        select(columns, options) {
          call.columns = columns;
          call.options = options;
          return query;
        },
        eq(column, value) {
          call.filters.push([column, value]);
          return query;
        },
        gte(column, value) {
          call.since = [column, value];
          return query;
        },
        order() {
          return query;
        },
        then(resolve, reject) {
          return Promise.resolve({
            data:
              table === "wa_numbers"
                ? empty
                  ? []
                  : [
                      {
                        id: "number-A",
                        label: "Test line",
                        phone_number_id: "test-number",
                        access_token: "synthetic-sealed-value",
                        active,
                      },
                    ]
                : null,
            count:
              table === missing
                ? null
                : table === "conversations"
                  ? 15000
                  : table === "messages"
                    ? 20000
                    : null,
            error: table === fail ? { message: "Synthetic backend error" } : null,
          }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

test("Meta health rejects disallowed roles and failed membership before admin, secret or provider work", async (t) => {
  t.mock.method(console, "error", () => {});
  for (const role of ["staff", "seo_editor", "marketing_manager", "unknown", null]) {
    let imports = 0;
    await assert.rejects(
      meta.getMetaSyncHealthData(
        {
          supabase: profileClient({ staff_role: role, tenant_id: "tenant-A" }),
          userId: "caller-A",
        },
        {
          loadAdmin: async () => {
            imports++;
            throw Error("admin must not open");
          },
        },
      ),
      /Your role cannot/,
    );
    assert.equal(imports, 0);
  }
  let imports = 0;
  await assert.rejects(
    meta.getMetaSyncHealthData(
      {
        supabase: profileClient(null, { message: "Synthetic profile failure" }),
        userId: "caller-A",
      },
      {
        loadAdmin: async () => {
          imports++;
        },
      },
    ),
    /could not check your workspace access/,
  );
  assert.equal(imports, 0);
});

test("Meta counts are exact joined counts constrained to both tenants and one sending number", async () => {
  const admin = healthAdmin();
  const result = await meta.getMetaSyncHealthData(
    {
      supabase: profileClient({ staff_role: "company_admin", tenant_id: "tenant-A" }),
      userId: "caller-A",
    },
    { loadAdmin: async () => admin },
  );
  assert.equal(result.numbers[0].conversations, 15000);
  assert.equal(result.numbers[0].messages24h, 20000);
  assert.deepEqual(admin.calls[0].filters, [["tenant_id", "tenant-A"]]);
  assert.deepEqual(admin.calls[1].filters, [
    ["tenant_id", "tenant-A"],
    ["wa_number_id", "number-A"],
  ]);
  assert.deepEqual(admin.calls[2].filters, [
    ["tenant_id", "tenant-A"],
    ["conversations.tenant_id", "tenant-A"],
    ["conversations.wa_number_id", "number-A"],
  ]);
  assert.match(admin.calls[2].columns, /conversations!inner/);
  assert.deepEqual(admin.calls[2].options, { count: "exact", head: true });
  assert.equal(admin.calls[2].since[0], "created_at");
  assert.ok(!JSON.stringify(result).includes("synthetic-sealed-value"));
});

for (const table of ["wa_numbers", "conversations", "messages"]) {
  test(`Meta ${table} read failure is an error, never no numbers or zero messages`, async (t) => {
    t.mock.method(console, "error", () => {});
    for (const options of [
      { fail: table },
      ...(table === "wa_numbers" ? [] : [{ missing: table }]),
    ]) {
      await assert.rejects(
        meta.getMetaSyncHealthData(
          {
            supabase: profileClient({ staff_role: "super_admin", tenant_id: "tenant-A" }),
            userId: "caller-A",
          },
          { loadAdmin: async () => healthAdmin(options) },
        ),
        /health could not be checked/,
      );
    }
  });
}

test("Meta successful empty read is distinct from failure; API response still never means delivered", async () => {
  const context = {
    supabase: profileClient({ staff_role: "company_admin", tenant_id: "tenant-A" }),
    userId: "caller-A",
  };
  assert.deepEqual(
    (
      await meta.getMetaSyncHealthData(context, {
        loadAdmin: async () => healthAdmin({ empty: true }),
      })
    ).numbers,
    [],
  );
  let providerCalls = 0;
  const result = await meta.getMetaSyncHealthData(context, {
    loadAdmin: async () => healthAdmin({ active: true }),
    openSecret: async () => "synthetic-test-token",
    fetch: async (url, init) => {
      providerCalls++;
      assert.equal(init.headers.Authorization, "Bearer synthetic-test-token");
      assert.ok(!url.includes("synthetic-test-token"));
      return { ok: true, json: async () => ({ quality_rating: "GREEN" }) };
    },
  });
  assert.equal(providerCalls, 1);
  assert.equal(result.numbers[0].apiOk, true);
  assert.ok(!("delivered" in result.numbers[0]));
  assert.ok(!JSON.stringify(result).includes("synthetic-test-token"));
});

test("actual brief handler refuses staff and SEO before AI work, matching advisor access", async () => {
  globalThis.__homeBriefCost = 0;
  for (const role of ["staff", "seo_editor", "unknown"]) {
    await assert.rejects(
      briefHandler.getDailyBrief({
        context: {
          supabase: profileClient({ staff_role: role, tenant_id: "tenant-A" }),
          userId: "caller-A",
        },
        data: { force: true },
      }),
      /Your role cannot/,
    );
  }
  assert.equal(globalThis.__homeBriefCost, 0);
  await briefHandler.getDailyBrief({
    context: {
      supabase: profileClient({ staff_role: "marketing_manager", tenant_id: "tenant-A" }),
      userId: "caller-A",
    },
    data: { force: true },
  });
  assert.equal(globalThis.__homeBriefCost, 1);
  delete globalThis.__homeBriefCost;
});

test("actual overview handler rejects SEO or unknown roles before any customer-table read", async () => {
  for (const role of ["seo_editor", "unknown", null]) {
    const client = profileClient({ staff_role: role, tenant_id: "tenant-A" });
    await assert.rejects(
      overviewHandler.getDashboardOverview({
        context: { supabase: client, userId: "caller-A" },
      }),
      /Your role cannot/,
    );
    assert.deepEqual(client.calls, [["id", "caller-A"]]);
  }
});

test("actual overview handler forwards the caller role to prevent hidden-module reads", async () => {
  const dataClient = dashboardClient();
  const membership = profileClient({ staff_role: "staff", tenant_id: "tenant-A" });
  const client = {
    from: (table) => (table === "profiles" ? membership.from(table) : dataClient.from(table)),
  };
  const result = await overviewHandler.getDashboardOverview({
    context: { supabase: client, userId: "caller-A" },
  });
  assert.deepEqual(result.visibility, { social: false, leads: false });
  assert.ok(
    dataClient.calls.every(
      (call) => !["social_accounts", "social_interactions", "leads"].includes(call.table),
    ),
  );
});

test("actual daily brief gives AI insufficient-data facts instead of a fabricated grade", async () => {
  globalThis.__homeOverviewFixture = await getDashboardOverviewData(
    dashboardClient({ empty: true }),
  );
  const client = {
    rpc: async () => ({ data: "tenant-A", error: null }),
    from: () => ({ upsert: async () => ({ error: null }) }),
  };
  await briefData.buildDailyBrief(client, { force: true });
  assert.match(globalThis.__homeBriefFacts, /not enough measured activity/);
  assert.doesNotMatch(globalThis.__homeBriefFacts, /46\/100|null\/100|At risk|70\/100|60\/100/);
  globalThis.__homeOverviewFixture.sampling.messages = true;
  await briefData.buildDailyBrief(client, { force: true });
  assert.match(globalThis.__homeBriefFacts, /limited sample/);
  delete globalThis.__homeOverviewFixture;
  delete globalThis.__homeBriefFacts;
});
