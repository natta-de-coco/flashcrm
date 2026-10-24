// Real routing handlers, webhook processor and safe-send pipeline. Synthetic
// identity/DB boundaries only; all provider calls are intercepted.
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
          [/secret-box.server$/, "secret"],
          [/audit.server$/, "audit"],
        ])
          b.onResolve({ filter }, () => ({ path: name, namespace: "cx-review" }));
        const stubs = {
          server:
            "export function createServerFn(){return {middleware(){return this},validator(){return this},inputValidator(){return this},handler(fn){return fn}}}",
          auth: "export const requireSupabaseAuth={};",
          admin: "export const supabaseAdmin=new Proxy({},{get:(_,k)=>globalThis.__reviewDb[k]});",
          secret: "export async function openSecret(v){return v||null}",
          audit: "export async function logAudit(v){globalThis.waSuite.audits.push(v)}",
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
  db.unique("messages", ["id"]);
  db.state.rows = {
    profiles: [{ id: UID, tenant_id: A, staff_role: "staff" }],
    organizations: [
      {
        id: A,
        name: "Synthetic business",
        suspended: false,
        subscription_status: "active",
        country: "AE",
      },
    ],
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
  db.state.rpcHandlers.resolve_contact_by_identity = (args) => ({
    data:
      args._value.replace(/\D/g, "") === "971500000002"
        ? [{ contact_id: "staff-contact", branch_id: null }]
        : [{ contact_id: "contact-1", branch_id: null }],
    error: null,
  });
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
  tenantId: A,
  name: "Synthetic extra",
  phone: "+971500000003",
  department: "sales",
  notifyOnLead: true,
  isActive: true,
};
const config = {
  tenantId: A,
  staffAlertTemplate: "Synthetic {{customer_name}}",
  staffAlertWhatsappEnabled: true,
  autoDepartmentHandoffEnabled: true,
  debounceWindowSeconds: 6,
  multiCrmCoexistenceEnabled: true,
};
for (const [name, data] of [
  ["saveStaffRoutingNumber", add],
  ["deleteStaffRoutingNumber", { tenantId: A, id: STAFF_ID }],
  ["toggleStaffRoutingStatus", { tenantId: A, id: STAFF_ID, field: "isActive", value: false }],
  ["saveStaffAlertConfig", config],
  [
    "sendTestStaffAlert",
    {
      tenantId: A,
      staffId: STAFF_ID,
      clientRef: "44444444-4444-4444-8444-444444444444",
      customTemplate: "Synthetic test alert",
    },
  ],
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
test("an unconfirmed test alert must not be reported as successfully sent", async () => {
  db.state.rows.profiles[0].staff_role = "company_admin";
  staffThread();
  globalThis.fetch = async (url, init) => {
    assert.ok(String(url).includes("graph.facebook.com"));
    graphCalls.push(JSON.parse(init.body));
    throw new Error("Synthetic network timeout");
  };
  const result = await routing.sendTestStaffAlert({
    data: {
      tenantId: A,
      staffId: STAFF_ID,
      clientRef: "44444444-4444-4444-8444-444444444444",
      customTemplate: "Synthetic test alert",
    },
    context: context(),
  });
  assert.equal(graphCalls.length, 1, "positive control: provider boundary was reached");
  assert.equal(result.state, "unconfirmed");
  assert.equal(
    db.state.rows.messages.filter((m) => m.direction === "outbound").length,
    1,
    "uncertain send remains in portal history",
  );
  assert.notEqual(
    result.ok,
    true,
    "uncertain delivery must not claim test alert sent successfully",
  );
});
function staffThread() {
  db.state.rows.contacts.push({
    id: "staff-contact",
    tenant_id: A,
    phone: "+971500000002",
    consent_given: true,
  });
  db.state.rows.conversations.push({
    id: "staff-thread",
    tenant_id: A,
    channel: "whatsapp",
    contact_id: "staff-contact",
    wa_number_id: "num-1",
    bot_enabled: false,
  });
  db.state.rows.messages.push({
    id: "staff-inbound",
    tenant_id: A,
    conversation_id: "staff-thread",
    direction: "inbound",
    sender: "contact",
    body: "I agree to work alerts",
    created_at: new Date().toISOString(),
  });
}
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
  db.state.rows.profiles[0].staff_role = "company_admin";
  db.state.rows.tenant_bot_settings[0].staff_alert_actor_id = UID;
  const result = await inbound("What does this product cost?", "synthetic-alert");
  assert.ok(result.reply, "positive control: assistant generated a reply");
  assert.equal(aiCalls.length, 1, "positive control: actual AI boundary was used");
  assert.equal(
    graphCalls.length,
    0,
    "staff free-text must not bypass the send policy/history pipeline",
  );
});

const testSend = () =>
  routing.sendTestStaffAlert({
    context: context(),
    data: {
      tenantId: A,
      staffId: STAFF_ID,
      clientRef: "44444444-4444-4444-8444-444444444444",
      customTemplate: "Synthetic {{company_name}} alert",
    },
  });
test("accepted staff alert is saved once even with concurrent repeated clicks", async () => {
  db.state.rows.profiles[0].staff_role = "company_admin";
  staffThread();
  const results = await Promise.all([testSend(), testSend()]);
  assert.equal(graphCalls.length, 1);
  const outgoing = db.state.rows.messages.filter((m) => m.direction === "outbound");
  assert.equal(outgoing.length, 1);
  assert.equal(outgoing[0].conversation_id, "staff-thread");
  assert.ok(outgoing[0].body.includes("Synthetic business"));
  assert.equal(outgoing[0].status, "sent");
  assert.ok(outgoing[0].sent_at);
  assert.ok(results.some((r) => r.ok));
});
for (const [name, prepare] of [
  [
    "recipient from another workspace",
    () => {
      db.state.rows.tenant_staff_routing_numbers[0].tenant_id =
        "55555555-5555-4555-8555-555555555555";
    },
  ],
  [
    "inactive staff",
    () => {
      db.state.rows.tenant_staff_routing_numbers[0].is_active = false;
    },
  ],
  [
    "staff alerts not agreed",
    () => {
      db.state.rows.tenant_staff_routing_numbers[0].notify_on_lead = false;
    },
  ],
  [
    "missing recorded consent",
    () => {
      db.state.rows.contacts.find((c) => c.id === "staff-contact").consent_given = false;
    },
  ],
  [
    "expired 24-hour window",
    () => {
      db.state.rows.messages[0].created_at = "2020-01-01T00:00:00.000Z";
    },
  ],
  [
    "disabled sending number",
    () => {
      db.state.rows.wa_numbers[0].active = false;
    },
  ],
  [
    "directory read error",
    () => {
      db.state.faults["tenant_staff_routing_numbers:read"] = "synthetic read error";
    },
  ],
  [
    "message save refused",
    () => {
      db.state.faults["messages:insert"] = "synthetic save error";
    },
  ],
])
  test(`staff alert is refused without a provider call: ${name}`, async () => {
    db.state.rows.profiles[0].staff_role = "company_admin";
    staffThread();
    prepare();
    try {
      const result = await testSend();
      assert.equal(result.ok, false);
    } catch (error) {
      assert.match(error.message, /save|record|check/i);
    }
    assert.equal(graphCalls.length, 0);
  });
test("old workspace form cannot change the current workspace", async () => {
  db.state.rows.profiles[0].staff_role = "company_admin";
  const before = structuredClone(db.state.rows.tenant_staff_routing_numbers);
  await assert.rejects(
    routing.saveStaffRoutingNumber({
      data: { ...add, tenantId: "55555555-5555-4555-8555-555555555555" },
      context: context(),
    }),
    /Workspace changed/,
  );
  assert.deepEqual(db.state.rows.tenant_staff_routing_numbers, before);
});
test("failed directory read is an error, not an empty/default-enabled setup", async () => {
  db.state.rows.profiles[0].staff_role = "company_admin";
  db.state.faults["tenant_staff_routing_numbers:read"] = {
    code: "42P01",
    message: "synthetic missing schema",
  };
  await assert.rejects(
    routing.getStaffRoutingDirectory({ data: { tenantId: A }, context: context() }),
    /could not be loaded/,
  );
});
test("permission denied when reading profile cannot fall back to service authority", async () => {
  db.state.faults["profiles:read"] = "synthetic profile error";
  await assert.rejects(routing.saveStaffAlertConfig({ data: config, context: context() }), /admin/);
});
test("follow-up after a recent reply is answered and assignment alone does not suppress it", async () => {
  db.state.rows.conversations[0].last_bot_reply_at = new Date().toISOString();
  db.state.rows.conversations[0].assigned_to = UID;
  const response = await inbound("Yes, please send the product price", "synthetic-follow-up");
  assert.ok(response.reply);
  assert.equal(aiCalls.length, 1);
});
test("department prompt contains codes only and model cannot choose an unknown department", async () => {
  globalThis.fetch = async (url, init) => {
    aiCalls.push(JSON.parse(init.body));
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                text: "Synthetic answer",
                handoff: false,
                department: "made_up",
                customer_requirements: "Synthetic",
              }),
            },
          },
        ],
      }),
      { status: 200 },
    );
  };
  await inbound("Which department can help?", "synthetic-privacy");
  assert.equal(aiCalls.length, 1);
  const prompt = JSON.stringify(aiCalls[0]);
  assert.ok(prompt.includes("sales"));
  assert.ok(!prompt.includes("971500000002"));
  assert.ok(!prompt.includes("Synthetic colleague"));
  assert.equal(db.state.rows.conversations[0].assigned_department, undefined);
});
test("all later claimed messages are released when earlier ingestion fails", async () => {
  db.state.faults["conversations:read"] = "synthetic read failure";
  const message = (id) => ({
    id,
    from: "971500000001",
    type: "text",
    text: { body: "A synthetic question" },
  });
  const payload = {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: "pn-1" },
              messages: [message("synthetic-a"), message("synthetic-b")],
            },
          },
        ],
      },
    ],
  };
  await assert.rejects(processWaPayload(payload), /Could not read/);
  assert.equal(db.state.rows.webhook_dedup.length, 0);
  delete db.state.faults["conversations:read"];
  await processWaPayload(payload);
  assert.equal(db.state.rows.messages.filter((m) => m.direction === "inbound").length, 2);
  assert.equal(aiCalls.length, 1);
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

const batch = (messages) => ({
  entry: [
    {
      changes: [
        {
          value: {
            metadata: { phone_number_id: "pn-1" },
            messages: messages.map(([id, text]) => ({
              id,
              from: "971500000001",
              type: "text",
              text: { body: text },
            })),
          },
        },
      ],
    },
  ],
});
test("a human request followed by another message keeps the entire batch pending", async () => {
  await processWaPayload(
    batch([
      ["human-first", "Please get me a human agent"],
      ["detail-second", "It concerns my product order"],
    ]),
  );
  assert.equal(aiCalls.length, 0);
  assert.equal(graphCalls.length, 1, "one stored handoff acknowledgement, no AI reply");
  assert.equal(db.state.rows.conversations[0].bot_enabled, false);
  assert.equal(db.state.rows.conversations[0].status, "pending");
  assert.equal(db.state.rows.messages.filter((m) => m.direction === "inbound").length, 2);
});
test("saved duplicate without a webhook claim cannot strand a new batch message", async () => {
  db.state.rows.messages.push({
    id: "previous",
    tenant_id: A,
    conversation_id: "conv-1",
    wa_message_id: "seen-before",
    direction: "inbound",
    sender: "contact",
    body: "Previously processed",
    created_at: new Date(0).toISOString(),
  });
  await processWaPayload(
    batch([
      ["brand-new", "A new product question"],
      ["seen-before", "Previously processed"],
    ]),
  );
  assert.equal(aiCalls.length, 1);
  assert.equal(db.state.rows.messages.filter((m) => m.direction === "inbound").length, 2);
});
test("a staff contact whose primary phone changed is refused before sending", async () => {
  db.state.rows.profiles[0].staff_role = "company_admin";
  staffThread();
  db.state.rows.contacts.find((c) => c.id === "staff-contact").phone = "+971500000009";
  const response = await testSend();
  assert.equal(response.ok, false);
  assert.equal(graphCalls.length, 0);
  assert.match(response.error, /does not match/);
});
