// Local independent review only. Desired security/behavior assertions are
// expected to fail against PR #99 at 72b50f3. No remote services are contacted.
import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import { build } from "esbuild";
import { createDb } from "./support/db-double.mjs";
import { ingestInboundMessage, processWaPayload } from "../node_modules/.cache/flas-whatsapp.mjs";

await build({
  entryPoints: ["src/lib/staff-routing.functions.ts"],
  outfile: "node_modules/.cache/cx-pr99-routing.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "error",
  alias: { "@": "./src" },
  plugins: [
    {
      name: "review-boundaries",
      setup(b) {
        for (const [filter, name] of [
          [/^@tanstack\/react-start$/, "server"],
          [/auth-middleware$/, "auth"],
          [/client\.server$/, "admin"],
        ])
          b.onResolve({ filter }, () => ({ path: name, namespace: "cx-review" }));
        const stubs = {
          server:
            "export function createServerFn(){return {middleware(){return this},validator(){return this},inputValidator(){return this},handler(fn){return fn}}}",
          auth: "export const requireSupabaseAuth={};",
          admin: "export const supabaseAdmin={from:(...a)=>globalThis.__reviewDb.from(...a)};",
        };
        b.onLoad({ filter: /.*/, namespace: "cx-review" }, ({ path }) => ({
          contents: stubs[path],
          loader: "js",
        }));
      },
    },
  ],
});
const routing = await import("../node_modules/.cache/cx-pr99-routing.mjs");
const A = "11111111-1111-4111-8111-111111111111";
const UID = "22222222-2222-4222-8222-222222222222";
const STAFF_ID = "33333333-3333-4333-8333-333333333333";
let db, graphCalls, aiCalls;
beforeEach(() => {
  db = createDb();
  db.unique("tenant_bot_settings", ["tenant_id"]);
  db.unique("webhook_dedup", ["event_source", "event_id"]);
  db.unique("messages", ["wa_message_id"]);
  db.state.rows = {
    profiles: [{ id: UID, tenant_id: A, staff_role: "staff" }],
    organizations: [{ id: A, suspended: false, subscription_status: "active", country: "AE" }],
    tenant_staff_routing_numbers: [
      {
        id: STAFF_ID,
        tenant_id: A,
        name: "Synthetic colleague",
        phone: "+971500000002",
        department: "sales",
        notify_on_lead: true,
        is_active: true,
      },
    ],
    wa_numbers: [
      {
        id: "num-1",
        tenant_id: A,
        phone_number_id: "pn-1",
        access_token: "synthetic-token",
        active: true,
        is_default: true,
      },
    ],
    contacts: [
      {
        id: "contact-1",
        tenant_id: A,
        name: "Synthetic customer",
        phone: "+971500000001",
        consent_given: true,
      },
    ],
    conversations: [
      {
        id: "conv-1",
        tenant_id: A,
        contact_id: "contact-1",
        channel: "whatsapp",
        wa_number_id: "num-1",
        bot_enabled: true,
        status: "open",
        assigned_to: null,
        last_bot_reply_at: null,
      },
    ],
    messages: [],
    tenant_bot_settings: [
      {
        tenant_id: A,
        enabled: true,
        auto_enroll_new_chats: true,
        bot_name: "Test assistant",
        greeting: "Hello",
        instructions: "Use synthetic catalog only.",
        model: "default",
        handoff_keywords: ["human", "agent"],
        debounce_window_seconds: 6,
        multi_crm_coexistence_enabled: true,
        staff_alert_whatsapp_enabled: true,
        auto_department_handoff_enabled: true,
      },
    ],
    business_profiles: [{ tenant_id: A, business_name: "Synthetic business", currency: "AED" }],
    products: [],
    wa_templates: [],
    webhook_dedup: [],
    system_alerts: [],
  };
  db.state.rpcResults.resolve_contact_by_identity = [{ contact_id: "contact-1", branch_id: null }];
  globalThis.__reviewDb = db.client;
  globalThis.waSuite = { db: db.client, audits: [] };
  process.env.LOVABLE_API_KEY = "synthetic-test-key";
  graphCalls = [];
  aiCalls = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("graph.facebook.com")) {
      graphCalls.push(JSON.parse(init.body));
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ messages: [{ id: `synthetic-out-${graphCalls.length}` }] }),
      };
    }
    aiCalls.push(JSON.parse(init.body));
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                text: "A synthetic answer.",
                handoff: false,
                department: "sales",
                customer_requirements: "Synthetic request",
              }),
            },
          },
        ],
      }),
      { status: 200 },
    );
  };
});
const context = () => ({ userId: UID, supabase: db.client });
const add = {
  name: "Synthetic extra",
  phone: "+971500000003",
  department: "sales",
  notifyOnLead: true,
  isActive: true,
};
const config = {
  staffAlertTemplate: "Synthetic {{customer_name}}",
  staffAlertWhatsappEnabled: true,
  autoDepartmentHandoffEnabled: true,
  debounceWindowSeconds: 6,
  multiCrmCoexistenceEnabled: true,
};
for (const [name, data] of [
  ["saveStaffRoutingNumber", add],
  ["deleteStaffRoutingNumber", { id: STAFF_ID }],
  ["toggleStaffRoutingStatus", { id: STAFF_ID, field: "isActive", value: false }],
  ["saveStaffAlertConfig", config],
])
  test(`non-admin must be refused by real ${name} handler`, async () => {
    await assert.rejects(
      routing[name]({ data, context: context() }),
      /admin|permission|forbidden|authorized/i,
    );
  });
test("positive control: company admin can save a routing number", async () => {
  db.state.rows.profiles[0].staff_role = "company_admin";
  assert.equal((await routing.saveStaffRoutingNumber({ data: add, context: context() })).ok, true);
  assert.equal(db.state.rows.tenant_staff_routing_numbers.length, 2);
});
const inbound = (text, id, extra = {}) =>
  ingestInboundMessage({
    tenantId: A,
    channel: "whatsapp",
    phone: "+971500000001",
    name: "Synthetic customer",
    text,
    waMessageId: id,
    waNumberId: "num-1",
    ...extra,
  });
test("an earlier message asking for a human must still pause automation", async () => {
  await inbound("Please give me a human agent", "synthetic-human", { skipBotReply: true });
  assert.equal(db.state.rows.conversations[0].bot_enabled, false);
  assert.equal(db.state.rows.conversations[0].status, "pending");
});
test("no unsolicited staff provider call without a safe send path and saved evidence", async () => {
  const result = await inbound("What does this product cost?", "synthetic-alert");
  assert.ok(result.reply, "positive control: assistant generated a reply");
  assert.equal(aiCalls.length, 1, "positive control: actual AI boundary was used");
  assert.equal(
    graphCalls.length,
    0,
    "staff free-text must not bypass the send policy/history pipeline",
  );
});
test("a known duplicate at the end of a batch must not suppress a fresh message", async () => {
  db.state.rows.tenant_bot_settings[0].staff_alert_whatsapp_enabled = false;
  db.state.rows.webhook_dedup.push({
    event_source: "whatsapp:message",
    event_id: "synthetic-seen",
    created_at: new Date().toISOString(),
  });
  await processWaPayload({
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: "pn-1" },
              contacts: [{ profile: { name: "Synthetic customer" } }],
              messages: [
                {
                  id: "synthetic-fresh",
                  from: "971500000001",
                  type: "text",
                  text: { body: "Please send current product details" },
                },
                {
                  id: "synthetic-seen",
                  from: "971500000001",
                  type: "text",
                  text: { body: "Already processed" },
                },
              ],
            },
          },
        ],
      },
    ],
  });
  assert.equal(
    db.state.rows.messages.filter((m) => m.direction === "inbound").length,
    1,
    "fresh inbound history was stored",
  );
  assert.equal(aiCalls.length, 1, "fresh message needs an answer despite the final duplicate");
});
