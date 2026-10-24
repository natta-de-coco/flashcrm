import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

// Exercise the authenticated handlers, their real snapshot and real dashboard
// aggregation. Only AI/provider calls and framework transport are replaced.
const result = await build({
  entryPoints: ["src/lib/advisor.functions.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  alias: { "@": "./src" },
  plugins: [
    {
      name: "advisor-health-boundaries",
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path }) => {
          let contents;
          if (path === "@tanstack/react-start")
            contents =
              "export function createServerFn(){return {middleware(){return this},inputValidator(){return this},handler(fn){return fn}}}";
          else if (path.endsWith("auth-middleware"))
            contents = "export const requireSupabaseAuth = {}";
          else if (path.endsWith("flash-ai.server"))
            contents =
              "export async function aiOptionsFor(){return {}}; export async function gatherLeadSummary(){return null}; export async function gatherMessagingAnalytics(){return null}; export async function callFlashAi(system,facts){globalThis.__advisorFacts.push(facts); return JSON.stringify({verdict:'Measured test review',questions:[],actions:[]})}";
          else if (path.endsWith("audit.server")) contents = "export async function logAudit(){}";
          return contents ? { path: contents, namespace: "advisor-stub" } : undefined;
        });
        builder.onLoad({ filter: /.*/, namespace: "advisor-stub" }, ({ path }) => ({
          contents: path,
          loader: "js",
        }));
      },
    },
  ],
});
const advisor = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);

function workspaceClient(role) {
  const now = new Date().toISOString();
  const calls = [];
  const rows = {
    profiles: [{ id: "signed-in-user", staff_role: role, tenant_id: "test-workspace" }],
    conversations: [{ id: "chat", status: "open", unread_count: 0, last_message_at: now }],
    messages: [
      { sender: "contact", created_at: now },
      { sender: "bot", created_at: now },
    ],
    contacts: [{ id: "contact" }],
    leads: Array.from({ length: 3 }, (_, i) => ({
      id: `lead-${i}`,
      created_at: now,
      consent_given: true,
    })),
    social_accounts: [
      {
        id: "social",
        platform: "facebook",
        label: "Test page",
        stats: { followers: 100 },
        active: true,
      },
    ],
    social_interactions: Array.from({ length: 12 }, (_, i) => ({
      id: `interaction-${i}`,
      account_id: "social",
      direction: "in",
      status: "open",
      created_at: now,
    })),
  };
  return {
    calls,
    async rpc() {
      return { data: "test-workspace", error: null };
    },
    from(table) {
      const call = { table, filters: [], options: {} };
      calls.push(call);
      const query = {
        select(columns, options = {}) {
          call.options = options;
          return query;
        },
        eq(key, value) {
          call.filters.push((row) => row[key] === value);
          return query;
        },
        gt(key, value) {
          call.filters.push((row) => row[key] > value);
          return query;
        },
        gte(key, value) {
          call.filters.push((row) => row[key] >= value);
          return query;
        },
        order() {
          return query;
        },
        limit() {
          return query;
        },
        maybeSingle() {
          call.single = true;
          return query;
        },
        insert() {
          return query;
        },
        then(resolve, reject) {
          const data = (rows[table] ?? []).filter((row) =>
            call.filters.every((filter) => filter(row)),
          );
          return Promise.resolve({
            data: call.options.head ? null : call.single ? (data[0] ?? null) : data,
            count: data.length,
            error: null,
          }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

const operations = [
  ["review", advisor.runAdvisorAnalysis, undefined],
  ["question", advisor.askAdvisor, { question: "What should we improve?", history: [] }],
  ["interview", advisor.startAdvisorFollowUp, undefined],
  [
    "follow-up plan",
    advisor.completeAdvisorFollowUp,
    { answers: [{ question: "What is your goal?", answer: "More opted-in leads" }] },
  ],
];

for (const [name, handler, data] of operations) {
  test(`Advisor ${name} includes measured social activity and lead flow for authorized roles`, async () => {
    for (const role of ["company_admin", "super_admin", "marketing_manager"]) {
      globalThis.__advisorFacts = [];
      const supabase = workspaceClient(role);
      await handler({ context: { supabase, userId: "signed-in-user" }, data });
      assert.equal(globalThis.__advisorFacts.length, 1);
      const facts = globalThis.__advisorFacts[0];
      assert.match(facts, /Lead flow: 30\/100 — 3 new leads/);
      assert.match(facts, /Social activity: 48\/100 — 12 incoming interactions/);
      assert.match(facts, /CRM activity score: 76\/100/);
      assert.match(facts, /New leads 3 vs 0/);
      assert.ok(supabase.calls.some((call) => call.table === "social_interactions"));
      assert.ok(supabase.calls.some((call) => call.table === "leads"));
    }
  });

  test(`Advisor ${name} denies staff and unknown roles before reading health or generating AI`, async () => {
    for (const role of ["staff", "seo_editor", "unknown"]) {
      globalThis.__advisorFacts = [];
      const supabase = workspaceClient(role);
      await assert.rejects(
        handler({ context: { supabase, userId: "signed-in-user" }, data }),
        /Your role cannot/,
      );
      assert.deepEqual(
        supabase.calls.map((call) => call.table),
        ["profiles"],
      );
      assert.deepEqual(globalThis.__advisorFacts, []);
    }
  });
}
