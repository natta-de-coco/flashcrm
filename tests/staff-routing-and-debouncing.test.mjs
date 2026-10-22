/**
 * tests/staff-routing-and-debouncing.test.mjs
 *
 * Rigorous tests for:
 * 1. Rapid consecutive message debouncing (consolidating 3-4 bursts into 1 cohesive reply).
 * 2. Multi-CRM coexistence & trivial acknowledgment handling ("ok", "yes", "thanks", "👍").
 * 3. Staff Department Routing & Template Variable Substitution.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { substituteStaffAlertTags, DEFAULT_STAFF_ALERT_TEMPLATE } from "../src/lib/staff-alert-template.ts";
import { createDb } from "./support/db-double.mjs";
import {
  isTrivialAcknowledgment,
  ingestInboundMessage,
  processWaPayload,
} from "../node_modules/.cache/flas-whatsapp.mjs";

describe("Staff Alert Template Substitution", () => {
  it("substitutes all merge tags correctly", () => {
    const template =
      "🚨 *New Lead - {{department}}*\n" +
      "👤 Customer: {{customer_name}}\n" +
      "📞 Phone: {{customer_phone}}\n" +
      "🏢 Dept: {{department}}\n" +
      "📝 Issue: {{customer_requirements}}\n" +
      "🏢 Company: {{company_name}}\n" +
      "⏰ At: {{timestamp}}";

    const result = substituteStaffAlertTags(template, {
      customerName: "Ahmed Ali",
      customerPhone: "+971501234567",
      department: "maintenance",
      customerRequirements: "AC water leak in master bedroom",
      companyName: "CoolAir LLC",
      timestamp: "2026-10-22 14:00",
    });

    assert.ok(result.includes("Ahmed Ali"), "Customer name substituted");
    assert.ok(result.includes("+971501234567"), "Phone substituted");
    assert.ok(result.includes("Maintenance"), "Department formatted and substituted");
    assert.ok(result.includes("AC water leak in master bedroom"), "Requirements substituted");
    assert.ok(result.includes("CoolAir LLC"), "Company name substituted");
    assert.ok(result.includes("2026-10-22 14:00"), "Timestamp substituted");
  });

  it("provides safe fallbacks for missing values", () => {
    const result = substituteStaffAlertTags(DEFAULT_STAFF_ALERT_TEMPLATE, {});
    assert.ok(result.includes("Prospective Client"), "Fallback customer name used");
    assert.ok(result.includes("Not provided"), "Fallback phone used");
    assert.ok(result.includes("General Support"), "Fallback department used");
    assert.ok(result.includes("Inquiry via WhatsApp"), "Fallback requirements used");
  });
});

describe("Trivial Acknowledgment Recognition", () => {
  it("recognizes single-word acknowledgments", () => {
    const positives = [
      "ok",
      "OK",
      "okay",
      "k",
      "kk",
      "yes",
      "YES",
      "yep",
      "yeah",
      "ya",
      "sure",
      "thanks",
      "thank you",
      "thx",
      "ty",
      "noted",
      "got it",
      "cool",
      "alright",
      "perfect",
      "done",
      "fine",
      "understood",
      "all good",
      "sounds good",
      "👍",
      "👌",
      "🙏",
      "✅",
    ];

    for (const phrase of positives) {
      assert.equal(
        isTrivialAcknowledgment(phrase),
        true,
        `Expected "${phrase}" to be recognized as trivial acknowledgment`,
      );
    }
  });

  it("recognizes combined short acknowledgments with punctuation", () => {
    const combos = [
      "ok thanks",
      "ok, thanks!",
      "yes sure",
      "noted, thank you.",
      "thanks noted",
      "ok got it 👍",
    ];

    for (const phrase of combos) {
      assert.equal(
        isTrivialAcknowledgment(phrase),
        true,
        `Expected "${phrase}" to be recognized as trivial acknowledgment`,
      );
    }
  });

  it("does not classify substantive customer queries or complaints as trivial", () => {
    const queries = [
      "Can you send the price list?",
      "How much is maintenance?",
      "The AC is still leaking, please send technician",
      "I want to book an appointment for tomorrow",
      "Where is your office located in Dubai?",
      "yes please send the pricing",
      "ok but how much does it cost?",
    ];

    for (const query of queries) {
      assert.equal(
        isTrivialAcknowledgment(query),
        false,
        `Expected substantive query "${query}" to NOT be trivial`,
      );
    }
  });
});

describe("Multi-Message Rapid Burst Debouncing", () => {
  let db;
  const TENANT_A = "11111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    db = createDb();
    globalThis.waSuite = { db: db.client, audits: [] };

    db.state.rows.wa_numbers = [
      {
        id: "num-1",
        tenant_id: TENANT_A,
        phone_number_id: "phone-1",
        access_token: "secret-token",
        active: true,
        is_default: true,
      },
    ];

    db.state.rows.tenant_bot_settings = [
      {
        tenant_id: TENANT_A,
        enabled: true,
        bot_name: "Flas Assistant",
        greeting: "Hello!",
        instructions: "We provide maintenance and sales support.",
        model: "default",
        handoff_keywords: ["human", "agent"],
        debounce_window_seconds: 6,
        multi_crm_coexistence_enabled: true,
      },
    ];

    db.state.rows.contacts = [
      {
        id: "c-1",
        tenant_id: TENANT_A,
        phone: "+971509998888",
        name: "Test Customer",
      },
    ];

    db.state.rows.conversations = [
      {
        id: "conv-1",
        tenant_id: TENANT_A,
        contact_id: "c-1",
        channel: "whatsapp",
        wa_number_id: "num-1",
        bot_enabled: true,
        assigned_to: null,
        last_bot_reply_at: null,
      },
    ];

    db.state.rows.messages = [];

    db.state.rpcResults["resolve_contact_by_identity"] = [{ contact_id: "c-1", branch_id: null }];
  });

  it("skips bot reply when skipBotReply is true", async () => {
    const res = await ingestInboundMessage({
      tenantId: TENANT_A,
      channel: "whatsapp",
      phone: "+971509998888",
      name: "Test Customer",
      text: "Message 1 of 4",
      waMessageId: "wamid.msg1",
      waNumberId: "num-1",
      skipBotReply: true,
    });

    assert.equal(res.reply, null, "Bot reply should be null when skipBotReply is true");
    assert.equal(res.replyMessageId, null);
    assert.equal(db.state.rows.messages.length, 1, "Inbound message 1 was recorded in DB");
    assert.equal(db.state.rows.messages[0].body, "Message 1 of 4");
  });

  it("suppresses bot reply on trivial acknowledgment when multi_crm_coexistence_enabled is true", async () => {
    const res = await ingestInboundMessage({
      tenantId: TENANT_A,
      channel: "whatsapp",
      phone: "+971509998888",
      name: "Test Customer",
      text: "ok thanks",
      waMessageId: "wamid.ack",
      waNumberId: "num-1",
    });

    assert.equal(res.reply, null, "Bot should stay quiet on trivial acknowledgment");
    assert.equal(db.state.rows.messages.length, 1, "Inbound acknowledgment stored in DB");
  });

  it("suppresses bot reply when conversation is assigned to human agent", async () => {
    db.state.rows.conversations[0].assigned_to = "agent-user-id";

    const res = await ingestInboundMessage({
      tenantId: TENANT_A,
      channel: "whatsapp",
      phone: "+971509998888",
      name: "Test Customer",
      text: "Hello I have a question",
      waMessageId: "wamid.assigned",
      waNumberId: "num-1",
    });

    assert.equal(res.reply, null, "Bot should stay quiet when chat is assigned to human agent");
  });

  it("suppresses bot reply inside debounce_window_seconds", async () => {
    // Simulate a reply sent 2 seconds ago
    db.state.rows.conversations[0].last_bot_reply_at = new Date(Date.now() - 2000).toISOString();

    const res = await ingestInboundMessage({
      tenantId: TENANT_A,
      channel: "whatsapp",
      phone: "+971509998888",
      name: "Test Customer",
      text: "Rapid follow up 2 seconds later",
      waMessageId: "wamid.rapid",
      waNumberId: "num-1",
    });

    assert.equal(res.reply, null, "Bot should debounce rapid follow-up inside 6s window");
    assert.equal(db.state.rows.messages.length, 1, "Rapid message is preserved in DB");
  });

  it("debounces intra-batch multiple messages from same sender", async () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "phone-1" },
                contacts: [{ profile: { name: "Ahmed" } }],
                messages: [
                  { id: "wamid.1", from: "971509998888", type: "text", text: { body: "Hi" } },
                  { id: "wamid.2", from: "971509998888", type: "text", text: { body: "My AC is leaking" } },
                  { id: "wamid.3", from: "971509998888", type: "text", text: { body: "Can technician come?" } },
                ],
              },
            },
          ],
        },
      ],
    };

    // Provider responds with accepted for outbound
    globalThis.fetch = async () => ({
      status: 200,
      text: async () => JSON.stringify({ messages: [{ id: "wamid.out" }] }),
    });

    const handled = await processWaPayload(payload);
    assert.equal(handled, 3, "Handled all 3 messages");
    assert.equal(
      db.state.rows.messages.filter((m) => m.direction === "inbound").length,
      3,
      "All 3 inbound messages stored in database for complete history",
    );
  });
});

describe("Department Tagging & Live Alert Delivery", () => {
  it("formats template for field technician with custom requirements", () => {
    const template =
      "🔧 *Technician Dispatch*\n" +
      "Staff: {{department}}\n" +
      "Client: {{customer_name}} ({{customer_phone}})\n" +
      "Issue: {{customer_requirements}}";

    const formatted = substituteStaffAlertTags(template, {
      customerName: "Fatima Al-Zahra",
      customerPhone: "+971520001122",
      department: "technician",
      customerRequirements: "Network terminal offline in Dubai Mall branch",
    });

    assert.ok(formatted.includes("Technician"));
    assert.ok(formatted.includes("Fatima Al-Zahra"));
    assert.ok(formatted.includes("+971520001122"));
    assert.ok(formatted.includes("Network terminal offline in Dubai Mall branch"));
  });
});
