// What a WhatsApp message is allowed to claim about itself.
//
// These drive the real send pipeline, safety gate and webhook processor
// against a database double and a provider the test controls. Each case is a
// way a conversation ends up lying to the business: a message sent twice, a
// timeout shown as "failed", a late receipt turning "read" back into "sent",
// one workspace reaching another's number.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it } from "node:test";

import { createDb, secondsAgo } from "./support/db-double.mjs";

import {
  describeSendContext,
  evidenceOfReceipt,
  evidenceOfSend,
  evidenceProbe,
  mediaOf,
  receiptTime,
  failureReasonForCode,
  generateBotReply,
  ingestInboundMessage,
  newChatAutomation,
  mayAdvance,
  processWaPayload,
  providerStatus,
  readSendResponse,
  resolveRecipientNumber,
  sendConversationMessage,
  sendTemplate,
  statusesThatMayBecome,
} from "../node_modules/.cache/flas-whatsapp.mjs";

const db = createDb();
globalThis.waSuite = { db: db.client, audits: [] };

/** The keys the real schema enforces, and that the code under test relies on. */
function declareKeys() {
  db.unique("webhook_dedup", ["event_source", "event_id"]);
  db.unique("messages", ["id"]);
}
const STATEMENT_TIMEOUT = {
  code: "57014",
  message: "canceling statement due to statement timeout",
};

const A = "tenant-a";
const B = "tenant-b";
const REF_1 = "11111111-1111-4111-8111-111111111111";
const REF_2 = "22222222-2222-4222-8222-222222222222";

/** What the provider was asked, and what it answers next. */
let provider;
/** The same for the AI provider behind the assistant. Down unless a test says otherwise. */
let ai;
const accepted = (id = "wamid.OK") => ({ status: 200, body: { messages: [{ id }] } });
const refused = (code, status = 400) => ({ status, body: { error: { code, message: "x" } } });

function installProvider() {
  provider = { calls: [], next: [], fail: null };
  ai = { calls: [], respond: () => ({ status: 503, body: "down" }) };
  globalThis.fetch = async (url, init) => {
    if (!String(url).includes("graph.facebook.com")) {
      ai.calls.push({ url: String(url), body: JSON.parse(init.body) });
      const answer = ai.respond();
      return new Response(
        typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body),
        { status: answer.status },
      );
    }
    provider.calls.push({ url: String(url), init, body: JSON.parse(init.body) });
    if (provider.fail) throw provider.fail;
    const answer = provider.next.shift() ?? accepted(`wamid.${provider.calls.length}`);
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      text: async () =>
        typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body),
    };
  };
}

let rows;
beforeEach(() => {
  rows = {
    organizations: [
      { id: A, suspended: false, subscription_status: "active", country: "AE" },
      { id: B, suspended: false, subscription_status: "active", country: "GB" },
    ],
    wa_numbers: [
      {
        id: "num-a",
        tenant_id: A,
        label: "Sales line",
        display_phone: "+971 4 000 0001",
        phone_number_id: "pn-a",
        access_token: "token-a",
        active: true,
        is_default: true,
      },
      {
        id: "num-b",
        tenant_id: B,
        label: "B line",
        display_phone: "+44 20 0000 0002",
        phone_number_id: "pn-b",
        access_token: "token-b",
        active: true,
        is_default: true,
      },
    ],
    contacts: [
      { id: "c-a", tenant_id: A, name: "Sara", phone: "+971 50 123 4567", consent_given: true },
      { id: "c-b", tenant_id: B, name: "Tom", phone: "+447700900123", consent_given: true },
    ],
    conversations: [
      { id: "conv-a", tenant_id: A, contact_id: "c-a", channel: "whatsapp", wa_number_id: "num-a" },
      { id: "conv-b", tenant_id: B, contact_id: "c-b", channel: "whatsapp", wa_number_id: "num-b" },
      { id: "web-a", tenant_id: A, contact_id: "c-a", channel: "web", wa_number_id: null },
    ],
    messages: [
      // The customer wrote an hour ago, so the 24-hour window is open.
      {
        id: "in-a",
        tenant_id: A,
        conversation_id: "conv-a",
        direction: "inbound",
        sender: "contact",
        body: "Hi",
        status: "sent",
        wa_message_id: "wamid.IN-A",
        created_at: secondsAgo(3600),
      },
    ],
    wa_templates: [
      {
        id: "tpl-a",
        tenant_id: A,
        name: "order_update",
        language: "en",
        status: "approved",
        body: "Hi {{1}}, your order is ready.",
      },
    ],
    leads: [],
    webhook_dedup: [],
    system_alerts: [],
    tenant_bot_settings: [],
  };
  db.reset(rows);
  declareKeys();
  evidenceProbe.unavailableUntil = 0;
  globalThis.waSuite.audits = [];
  installProvider();
});

const outbound = () => rows.messages.filter((m) => m.direction === "outbound");
const send = (extra = {}) =>
  sendConversationMessage({
    tenantId: A,
    userId: "user-a",
    conversationId: "conv-a",
    body: "Your order is ready",
    ...extra,
  });

describe("a message's status only moves forward", () => {
  it("applies a receipt only when it is later than what is already known", () => {
    assert.equal(mayAdvance("sending", "sent"), true);
    assert.equal(mayAdvance("unconfirmed", "delivered"), true);
    assert.equal(mayAdvance("sent", "read"), true);
    assert.equal(mayAdvance("delivered", "read"), true);
    // The regressions that used to be written straight to the row.
    assert.equal(mayAdvance("read", "sent"), false);
    assert.equal(mayAdvance("read", "delivered"), false);
    assert.equal(mayAdvance("delivered", "sent"), false);
    assert.equal(mayAdvance("sent", "sent"), false);
  });

  it("never marks a delivered or read message failed, and never revives a failed one", () => {
    assert.deepEqual(statusesThatMayBecome("failed"), ["sending", "unconfirmed", "sent"]);
    assert.equal(mayAdvance("delivered", "failed"), false);
    assert.equal(mayAdvance("read", "failed"), false);
    assert.equal(mayAdvance("failed", "delivered"), false);
    assert.equal(mayAdvance("failed", "sent"), false);
  });

  it("accepts only the statuses the provider documents", () => {
    for (const s of ["sent", "delivered", "read", "failed"]) assert.equal(providerStatus(s), s);
    for (const s of ["deleted", "warning", "sending", "unconfirmed", "", null, undefined]) {
      assert.equal(providerStatus(s), null);
    }
  });
});

describe("a provider answer is read for what it says, not for whether it threw", () => {
  it("is accepted only with a message id", () => {
    assert.deepEqual(readSendResponse(200, JSON.stringify(accepted("wamid.X").body)), {
      state: "accepted",
      waMessageId: "wamid.X",
    });
    assert.equal(readSendResponse(200, "{}").state, "unconfirmed");
    assert.equal(readSendResponse(200, "").state, "unconfirmed");
  });

  it("is a refusal only when Meta says why", () => {
    const window = readSendResponse(400, JSON.stringify(refused(131047).body));
    assert.equal(window.state, "rejected");
    assert.equal(window.reason, "window_closed");
    assert.equal(window.providerCode, 131047);
    // A server error that names its code is still Meta saying no.
    assert.equal(readSendResponse(500, JSON.stringify(refused(131016).body)).state, "rejected");
  });

  it("is not known when there is no readable answer", () => {
    assert.equal(readSendResponse(502, "<html>Bad gateway</html>").state, "unconfirmed");
    assert.equal(readSendResponse(500, "").state, "unconfirmed");
  });

  it("groups Meta's codes by what the person has to do", () => {
    assert.equal(failureReasonForCode(190), "credentials");
    assert.equal(failureReasonForCode(10), "permission");
    assert.equal(failureReasonForCode(230), "permission", "200–299 is the permission range");
    assert.equal(failureReasonForCode(132001), "template");
    assert.equal(failureReasonForCode(132015), "template");
    assert.equal(failureReasonForCode(130429), "rate_limited");
    assert.equal(failureReasonForCode(131048), "quality_restricted");
    assert.equal(failureReasonForCode(368), "quality_restricted");
    assert.equal(failureReasonForCode(131026), "recipient_unreachable");
    assert.equal(failureReasonForCode(131030), "recipient_not_allowed");
    assert.equal(failureReasonForCode(133010), "number_not_registered");
    assert.equal(failureReasonForCode(999999), "unknown");
    assert.equal(failureReasonForCode(null), "unknown");
  });
});

describe("the number a message is addressed to", () => {
  it("is the canonical digits, however the number was written", () => {
    for (const written of [
      "+971 50 123 4567",
      "00971501234567",
      "971501234567",
      "+971-50-123-4567",
      "050 123 4567",
    ]) {
      assert.deepEqual(resolveRecipientNumber(written, "971"), {
        ok: true,
        digits: "971501234567",
        international: "+971501234567",
      });
    }
    // A number that says its own country needs no help from the workspace's.
    assert.equal(resolveRecipientNumber("+44 7700 900123", "971").international, "+447700900123");
    assert.equal(resolveRecipientNumber("+971 50 123 4567", null).international, "+971501234567");
  });

  it("does not guess the country of a number that does not say it", () => {
    // Ten digits, no plus, no leading zero. In a US workspace this is a local
    // number written short; it was being sent to +41 55 552 671 in Switzerland.
    const local = resolveRecipientNumber("415 555 2671", "1");
    assert.equal(local.ok, false);
    assert.match(local.reason, /without a country code/);
    // The same shape, and a different truth: a Singapore number without its
    // plus. Prefixing the workspace's code would message a stranger in the US.
    assert.equal(resolveRecipientNumber("65 6123 4567", "1").ok, false);
    // A UAE mobile without its zero is not Belize (+501).
    assert.equal(resolveRecipientNumber("50 123 4567", "971").ok, false);
    // And with no workspace country at all, only a number that says its own.
    assert.equal(resolveRecipientNumber("971501234567", null).ok, false);
    // It is accepted when it already begins with the workspace's own code.
    assert.equal(resolveRecipientNumber("1 415 555 2671", "1").international, "+14155552671");
  });

  it("completes a national number with the workspace's country, and only then", () => {
    const completed = resolveRecipientNumber("050 123 4567", "971");
    assert.equal(completed.ok && completed.international, "+971501234567");
    const refusedNumber = resolveRecipientNumber("050 123 4567", null);
    assert.equal(refusedNumber.ok, false);
    assert.match(refusedNumber.reason, /without a country code/);
  });

  it("refuses what cannot be a phone number instead of guessing", () => {
    assert.equal(resolveRecipientNumber("", "971").ok, false);
    assert.equal(resolveRecipientNumber("12345", null).ok, false);
    assert.equal(resolveRecipientNumber("+1234567890123456", null).ok, false, "longer than E.164");
  });
});

describe("sending a reply", () => {
  it("saves it, sends it once from the conversation's own number, and records the provider's id", async () => {
    provider.next.push(accepted("wamid.SENT"));
    const result = await send();
    assert.equal(result.ok, true);
    assert.equal(result.state, "accepted");
    assert.deepEqual(result.sendingNumber, {
      label: "Sales line",
      displayPhone: "+971 4 000 0001",
    });
    assert.equal(result.recipient, "+971501234567");

    assert.equal(provider.calls.length, 1);
    const call = provider.calls[0];
    assert.match(call.url, /\/pn-a\/messages$/);
    assert.equal(call.init.headers.Authorization, "Bearer token-a");
    assert.equal(call.body.to, "971501234567");
    assert.equal(call.body.text.body, "Your order is ready");

    const [row] = outbound();
    assert.equal(row.status, "sent", "accepted by the provider is sent, not delivered");
    assert.equal(row.wa_message_id, "wamid.SENT");
    assert.equal(row.tenant_id, A);
    // The provider is given FLAS's own id, so a receipt can find this row.
    assert.equal(call.body.biz_opaque_callback_data, row.id);
    assert.equal(globalThis.waSuite.audits.at(-1).details.outcome, "accepted");
  });

  it("stores a website-chat reply without calling WhatsApp", async () => {
    const result = await send({ conversationId: "web-a" });
    assert.equal(result.state, "stored");
    assert.equal(provider.calls.length, 0);
    assert.equal(outbound()[0].status, "sent");
  });
});

describe("one workspace cannot reach into another", () => {
  it("does not find another workspace's conversation", async () => {
    await assert.rejects(send({ conversationId: "conv-b" }), /Conversation not found/);
    assert.equal(provider.calls.length, 0);
    assert.equal(outbound().length, 0);
  });

  it("refuses a conversation bound to another workspace's number", async () => {
    // However the row came to point there, the send must not leave from it.
    rows.conversations[0].wa_number_id = "num-b";
    const result = await send();
    assert.equal(result.state, "blocked");
    assert.deepEqual(
      result.blocks.map((b) => b.code),
      ["number_missing"],
    );
    assert.equal(provider.calls.length, 0, "no request with another workspace's token");
    assert.equal(outbound().length, 0);
  });

  it("does not fall back to another line when the conversation's number is unusable", async () => {
    rows.wa_numbers.push({
      id: "num-a2",
      tenant_id: A,
      label: "Support line",
      phone_number_id: "pn-a2",
      access_token: "token-a2",
      active: true,
      is_default: false,
    });
    rows.wa_numbers[0].active = false;
    const disabled = await send();
    assert.deepEqual(
      disabled.blocks.map((b) => b.code),
      ["number_disabled"],
    );
    assert.match(disabled.blockedReasons[0], /Sales line/);

    rows.wa_numbers[0].active = true;
    rows.wa_numbers[0].access_token = "";
    const disconnected = await send();
    assert.deepEqual(
      disconnected.blocks.map((b) => b.code),
      ["number_needs_reconnect"],
    );
    assert.equal(provider.calls.length, 0);
  });

  it("says so when the workspace has no number at all", async () => {
    rows.conversations[0].wa_number_id = null;
    rows.wa_numbers = rows.wa_numbers.filter((n) => n.tenant_id !== A);
    db.reset(rows);
    declareKeys();
    const result = await send();
    assert.deepEqual(
      result.blocks.map((b) => b.code),
      ["no_number"],
    );
    assert.equal(provider.calls.length, 0);
  });

  it("binds a conversation with no number to the line it was first answered from", async () => {
    rows.conversations[0].wa_number_id = null;
    await send();
    assert.equal(provider.calls.length, 1);
    assert.match(provider.calls[0].url, /\/pn-a\/messages$/);
    assert.equal(rows.conversations[0].wa_number_id, "num-a");
  });
});

describe("the same click is sent once", () => {
  it("sends one message for two simultaneous requests carrying the same reference", async () => {
    const results = await Promise.all([send({ clientRef: REF_1 }), send({ clientRef: REF_1 })]);
    assert.equal(provider.calls.length, 1, "the provider was called once");
    assert.equal(outbound().length, 1, "one message row");
    assert.deepEqual(results.map((r) => r.state).sort(), ["accepted", "duplicate"]);
    assert.deepEqual(results.map((r) => r.repeated).sort(), [false, true]);
    // Both answers name the one message that exists.
    assert.deepEqual(
      results.map((r) => r.messageId),
      [outbound()[0].id, outbound()[0].id],
    );
  });

  it("saves the message under an id made on the server, not the one the browser sent", async () => {
    const result = await send({ clientRef: REF_1 });
    assert.notEqual(result.messageId, REF_1);
    assert.match(
      result.messageId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    // The reference Meta echoes back in receipts is that same id.
    assert.equal(provider.calls[0].body.biz_opaque_callback_data, result.messageId);
  });

  it("does not need any other table to stop a duplicate", async () => {
    // The guard used to be a row in webhook_dedup, and a failure to write it
    // let both copies through. The message row is the guard now.
    db.fail("webhook_dedup:insert", { code: "42501", message: "permission denied" });
    db.fail("webhook_dedup:delete", { code: "42501", message: "permission denied" });
    const results = await Promise.all([send({ clientRef: REF_1 }), send({ clientRef: REF_1 })]);
    assert.equal(provider.calls.length, 1);
    assert.equal(outbound().length, 1);
    assert.deepEqual(results.map((r) => r.state).sort(), ["accepted", "duplicate"]);
    assert.equal(rows.webhook_dedup.length, 0, "a send leaves nothing there to expire");
  });

  it("answers a repeat with the saved message, whatever the gate would say by then", async () => {
    const first = await send({ clientRef: REF_1 });
    // The 24-hour window closes before the repeat arrives.
    rows.messages.find((m) => m.id === "in-a").created_at = secondsAgo(25 * 3600);
    const audits = globalThis.waSuite.audits.length;
    const again = await send({ clientRef: REF_1 });
    assert.equal(again.state, "duplicate");
    assert.equal(again.messageId, first.messageId);
    assert.equal(provider.calls.length, 1);
    assert.equal(
      globalThis.waSuite.audits.length,
      audits,
      "a repeat is not audited as a second send or a block",
    );
  });

  it("keeps a website-chat reply to one message too", async () => {
    const web = () =>
      sendConversationMessage({
        tenantId: A,
        userId: "user-a",
        conversationId: "web-a",
        body: "On our way",
        clientRef: REF_1,
      });
    const results = await Promise.all([web(), web()]);
    assert.deepEqual(results.map((r) => r.state).sort(), ["duplicate", "stored"]);
    assert.equal(outbound().length, 1);
    assert.equal(provider.calls.length, 0);
  });

  it("treats the same reference in another conversation as another message", async () => {
    const whatsapp = await send({ clientRef: REF_1 });
    const web = await sendConversationMessage({
      tenantId: A,
      userId: "user-a",
      conversationId: "web-a",
      body: "Your order is ready",
      clientRef: REF_1,
    });
    assert.equal(web.state, "stored");
    assert.notEqual(web.messageId, whatsapp.messageId);
  });

  it("still sends two different messages", async () => {
    await send({ clientRef: REF_1 });
    await send({ clientRef: REF_2 });
    assert.equal(provider.calls.length, 2);
    assert.equal(outbound().length, 2);
  });

  it("keeps one workspace's reference from blocking another's", async () => {
    await send({ clientRef: REF_1 });
    rows.messages.push({
      id: "in-b",
      tenant_id: B,
      conversation_id: "conv-b",
      direction: "inbound",
      created_at: secondsAgo(60),
    });
    const other = await sendConversationMessage({
      tenantId: B,
      userId: "user-b",
      conversationId: "conv-b",
      body: "Hello",
      clientRef: REF_1,
    });
    assert.equal(other.state, "accepted");
    assert.match(provider.calls[1].url, /\/pn-b\/messages$/);
  });
});

describe("a send that got no answer is not called failed, and is not sent again", () => {
  it("records it as unconfirmed after a timeout", async () => {
    provider.fail = Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    const result = await send({ clientRef: REF_1 });
    assert.equal(result.ok, false);
    assert.equal(result.state, "unconfirmed");
    assert.equal(result.failureReason, "unconfirmed");
    assert.match(result.deliveryError, /Do not send it again yet/);
    assert.equal(provider.calls.length, 1, "no automatic retry");
    assert.equal(outbound()[0].status, "unconfirmed");
    assert.equal(outbound()[0].wa_message_id, null);
  });

  it("does not resend when the same click arrives again", async () => {
    provider.fail = new Error("socket hang up");
    await send({ clientRef: REF_1 });
    provider.fail = null;
    const again = await send({ clientRef: REF_1 });
    // The repeat is told what happened to the saved message: still not known.
    assert.equal(again.repeated, true);
    assert.equal(again.state, "unconfirmed");
    assert.equal(again.ok, false);
    assert.equal(again.failureReason, "unconfirmed");
    assert.equal(provider.calls.length, 1);
    assert.equal(outbound().length, 1);
  });

  it("tells a repeat that the message was refused, when it was", async () => {
    // The first answer was lost on its way to the browser, so the same send
    // arrives again. "Already saved" used to be answered as "fine".
    provider.next.push(refused(131026));
    const first = await send({ clientRef: REF_1 });
    assert.equal(first.state, "rejected");
    const again = await send({ clientRef: REF_1 });
    assert.equal(again.repeated, true);
    assert.equal(again.state, "rejected");
    assert.equal(again.ok, false);
    assert.equal(again.messageId, first.messageId);
    assert.ok(again.deliveryError);
    assert.equal(provider.calls.length, 1, "and it is not sent again");
  });

  it("does not audit a copy that lost the race as a second send", async () => {
    provider.next.push(refused(131026));
    await send({ clientRef: REF_1 });
    const sends = () =>
      globalThis.waSuite.audits.filter((entry) => entry.action === "message.send").length;
    assert.equal(sends(), 1);
    // As in a real race: this copy's first look finds no row yet, it is
    // allowed by the gate, and it meets the saved message at the insert.
    let looks = 0;
    db.fail("messages:read", () => (++looks === 1 ? { empty: true } : null));
    const again = await send({ clientRef: REF_1 });
    assert.deepEqual([again.repeated, again.state], [true, "rejected"]);
    assert.equal(sends(), 1, "one message, one audit line");
    assert.equal(provider.calls.length, 1);
    assert.equal(outbound().length, 1);
  });

  it("tells a repeat that the message went, when it did", async () => {
    const first = await send({ clientRef: REF_1 });
    const again = await send({ clientRef: REF_1 });
    assert.deepEqual([again.repeated, again.state, again.ok], [true, "duplicate", true]);
    assert.equal(again.messageId, first.messageId);
    // Later receipts do not change that.
    outbound()[0].status = "read";
    assert.equal((await send({ clientRef: REF_1 })).ok, true);
  });

  it("does not call a message sent while its first copy is still on its way", async () => {
    const first = await send({ clientRef: REF_1 });
    // As the second copy of a double request finds it: saved, not yet answered.
    outbound()[0].status = "sending";
    outbound()[0].created_at = secondsAgo(5);
    const during = await send({ clientRef: REF_1 });
    assert.deepEqual([during.repeated, during.state, during.ok], [true, "duplicate", false]);
    // And one whose answer was never recorded is not "on its way" for ever.
    outbound()[0].created_at = secondsAgo(600);
    const later = await send({ clientRef: REF_1 });
    assert.deepEqual([later.state, later.ok], ["unconfirmed", false]);
    assert.equal(later.messageId, first.messageId);
    assert.equal(provider.calls.length, 1);
  });

  it("treats an unreadable gateway answer the same way", async () => {
    provider.next.push({ status: 502, body: "<html>Bad gateway</html>" });
    const result = await send();
    assert.equal(result.state, "unconfirmed");
    assert.equal(outbound()[0].status, "unconfirmed");
  });

  it("matches the later receipt to the message by FLAS's own reference", async () => {
    provider.fail = new Error("timeout");
    await send({ clientRef: REF_1 });
    const row = outbound()[0];
    assert.equal(row.status, "unconfirmed");
    assert.equal(provider.calls[0].body.biz_opaque_callback_data, row.id);
    await processWaPayload(
      statusPayload("pn-a", {
        id: "wamid.LATE",
        status: "delivered",
        biz_opaque_callback_data: row.id,
      }),
    );
    assert.equal(row.status, "delivered");
    assert.equal(row.wa_message_id, "wamid.LATE");
  });
});

describe("a send stops when the database cannot vouch for it", () => {
  it("sends nothing while the message cannot be saved, then sends once when storage recovers", async () => {
    db.fail("messages:insert", STATEMENT_TIMEOUT);
    await assert.rejects(send({ clientRef: REF_1 }), /so it was not sent\. Try again\./);
    await assert.rejects(send({ clientRef: REF_1 }), /so it was not sent/);
    assert.equal(provider.calls.length, 0, "the provider was never called");
    assert.equal(outbound().length, 0, "no message was saved");

    db.recover("messages:insert");
    const retry = await send({ clientRef: REF_1 });
    assert.equal(retry.state, "accepted");
    assert.equal((await send({ clientRef: REF_1 })).state, "duplicate");
    assert.equal(provider.calls.length, 1, "sent exactly once");
    assert.equal(outbound().length, 1);
  });

  it("sends nothing when it cannot tell whether this is a repeat", async () => {
    await send({ clientRef: REF_1 });
    // Messages cannot be read: the first copy may be there or not. Guessing
    // "not" is how a customer gets the same message twice.
    db.fail("messages:read", STATEMENT_TIMEOUT);
    await assert.rejects(send({ clientRef: REF_1 }), /so it was not sent/);
    await assert.rejects(send({ clientRef: REF_2 }), /so it was not sent/);
    assert.equal(provider.calls.length, 1, "no second copy, and no unverified new send");

    db.recover("messages:read");
    assert.equal((await send({ clientRef: REF_1 })).state, "duplicate");
    assert.equal(provider.calls.length, 1);
  });

  it("says a safe, retryable thing, and nothing from the database", async () => {
    db.fail("messages:insert", {
      code: "XX000",
      message: "FATAL: password authentication failed for user postgres",
    });
    await assert.rejects(send({ clientRef: REF_1 }), (error) => {
      assert.equal(
        error.message,
        "Could not save this message in the CRM, so it was not sent. Try again.",
      );
      return true;
    });
  });

  it("does not report an error for a message the provider already accepted", async () => {
    // Saving the provider's answer fails after the message has gone. Throwing
    // here told the sender "error" and invited a second copy.
    db.fail("messages:update", "connection reset");
    const result = await send();
    assert.equal(result.ok, true);
    assert.equal(result.state, "accepted");
    assert.equal(provider.calls.length, 1);
  });
});

describe("the gate does not decide on what it could not read", () => {
  for (const [what, table] of [
    ["whether the workspace is suspended", "organizations"],
    ["which line the customer is routed to", "leads"],
    ["the customer's consent and number", "contacts"],
  ]) {
    it(`sends nothing when it cannot read ${what}`, async () => {
      db.fail(`${table}:read`, STATEMENT_TIMEOUT);
      await assert.rejects(
        send({ clientRef: REF_1 }),
        /Could not check whether this message may be sent/,
      );
      assert.equal(provider.calls.length, 0);
      assert.equal(outbound().length, 0);
      // And the same send goes through once it can be checked.
      db.recover(`${table}:read`);
      assert.equal((await send({ clientRef: REF_1 })).state, "accepted");
      assert.equal(provider.calls.length, 1);
    });
  }

  it("used to treat an unreadable workspace as one in good standing", async () => {
    rows.organizations[0].suspended = true;
    const blockedNow = await send();
    assert.deepEqual(
      blockedNow.blocks.map((b) => b.code),
      ["workspace_suspended"],
    );
    db.fail("organizations:read", STATEMENT_TIMEOUT);
    await assert.rejects(send());
    assert.equal(
      provider.calls.length,
      0,
      "a suspended workspace sent while its row could not be read",
    );
  });
});

describe("a refusal says why", () => {
  const cases = [
    [131047, "window_closed", /24-hour/],
    [190, "credentials", /reconnected/],
    [10, "permission", /permission/],
    [130429, "rate_limited", /limiting/],
    [131048, "quality_restricted", /restricted/],
    [131026, "recipient_unreachable", /could not reach/],
  ];
  for (const [code, reason, text] of cases) {
    it(`${code} is ${reason}`, async () => {
      provider.next.push(refused(code));
      const result = await send();
      assert.equal(result.ok, false);
      assert.equal(result.state, "rejected");
      assert.equal(result.failureReason, reason);
      assert.match(result.deliveryError, text);
      assert.equal(outbound()[0].status, "failed");
      assert.equal(provider.calls.length, 1);
    });
  }

  it("never shows the provider's raw error text or the token", async () => {
    provider.next.push({
      status: 400,
      body: { error: { code: 131009, message: "Invalid parameter token-a at /v21.0/pn-a" } },
    });
    const result = await send();
    assert.ok(!result.deliveryError.includes("token-a"));
    assert.ok(!result.deliveryError.includes("pn-a"));
  });
});

describe("the gate explains a block before anything is saved or sent", () => {
  it("blocks a free-form reply once the 24-hour window has closed", async () => {
    rows.messages[0].created_at = secondsAgo(25 * 3600);
    const result = await send();
    assert.equal(result.state, "blocked");
    assert.deepEqual(
      result.blocks.map((b) => b.code),
      ["window_closed"],
    );
    assert.equal(provider.calls.length, 0);
    assert.equal(outbound().length, 0);
    const audit = globalThis.waSuite.audits.at(-1);
    assert.equal(audit.action, "message.blocked");
    assert.deepEqual(audit.details.codes, ["window_closed"]);
  });

  it("does not open the window with another workspace's inbound message", async () => {
    rows.messages[0].tenant_id = B;
    const result = await send();
    assert.deepEqual(
      result.blocks.map((b) => b.code),
      ["window_closed"],
    );
  });

  it("refuses a number that does not say its country, before anything is saved", async () => {
    // No plus, no leading zero, and not this workspace's country code.
    rows.contacts[0].phone = "50 123 4567";
    const result = await send();
    assert.deepEqual(
      result.blocks.map((b) => b.code),
      ["recipient_invalid"],
    );
    assert.match(result.blockedReasons[0], /without a country code/);
    assert.equal(provider.calls.length, 0);
    assert.equal(outbound().length, 0);
  });

  it("completes a number written the local way with the workspace's own country", async () => {
    rows.contacts[0].phone = "050 123 4567";
    const result = await send();
    assert.equal(result.state, "accepted");
    assert.equal(result.recipient, "+971501234567");
    assert.equal(provider.calls[0].body.to, "971501234567");
  });

  it("blocks a suspended workspace and an inactive subscription", async () => {
    rows.organizations[0].suspended = true;
    assert.deepEqual(
      (await send()).blocks.map((b) => b.code),
      ["workspace_suspended"],
    );
    rows.organizations[0].suspended = false;
    rows.organizations[0].subscription_status = "past_due";
    assert.deepEqual(
      (await send()).blocks.map((b) => b.code),
      ["subscription_inactive"],
    );
  });

  it("tells the composer the same thing before anyone types", async () => {
    const open = await describeSendContext(A, "conv-a");
    assert.deepEqual(open.sendingNumber, { label: "Sales line", displayPhone: "+971 4 000 0001" });
    assert.equal(open.recipient, "+971501234567");
    assert.deepEqual(open.blocks, []);

    rows.wa_numbers[0].active = false;
    const blockedContext = await describeSendContext(A, "conv-a");
    assert.deepEqual(
      blockedContext.blocks.map((b) => b.code),
      ["number_disabled"],
    );
    // And it reveals nothing about a conversation in another workspace.
    const foreign = await describeSendContext(A, "conv-b");
    assert.equal(foreign.sendingNumber, null);
    assert.equal(foreign.recipient, null);
    assert.deepEqual(
      foreign.blocks.map((b) => b.code),
      ["conversation_not_found"],
    );
  });
});

describe("a template", () => {
  const template = (extra = {}) =>
    sendTemplate({
      tenantId: A,
      userId: "user-a",
      templateId: "tpl-a",
      conversationId: "conv-a",
      variables: ["Sara"],
      ...extra,
    });

  it("goes out as a template and is stored as the customer reads it", async () => {
    provider.next.push(accepted("wamid.TPL"));
    const result = await template();
    assert.equal(result.state, "accepted");
    assert.equal(result.rendered, "Hi Sara, your order is ready.");
    const call = provider.calls[0].body;
    assert.equal(call.type, "template");
    assert.equal(call.template.name, "order_update");
    assert.deepEqual(call.template.components[0].parameters, [{ type: "text", text: "Sara" }]);
    assert.equal(outbound()[0].body, "Hi Sara, your order is ready.");
    assert.equal(outbound()[0].status, "sent");
  });

  it("may be sent after the 24-hour window, but never without consent", async () => {
    rows.messages[0].created_at = secondsAgo(40 * 3600);
    assert.equal((await template()).state, "accepted");
    rows.contacts[0].consent_given = false;
    const result = await template();
    assert.deepEqual(
      result.blocks.map((b) => b.code),
      ["no_consent"],
    );
    assert.equal(provider.calls.length, 1);
  });

  it("is refused for a number that is not a saved contact", async () => {
    const result = await template({ conversationId: null, phone: "+971 55 000 0000" });
    assert.equal(result.state, "blocked");
    assert.ok(result.blocks.some((b) => b.code === "contact_not_saved"));
    assert.equal(provider.calls.length, 0);
    assert.equal(outbound().length, 0);
  });

  it("sent to a saved contact's number lands in that contact's conversation", async () => {
    // It used to leave an audit line and no message anywhere.
    rows.conversations = rows.conversations.filter((c) => c.id !== "conv-a");
    db.reset(rows);
    declareKeys();
    db.state.rpcResults["resolve_contact_by_identity"] = [{ contact_id: "c-a", branch_id: null }];
    const result = await template({ conversationId: null, phone: "971501234567" });
    assert.equal(result.state, "accepted", JSON.stringify(result.blocks));
    const opened = rows.conversations.find(
      (c) => c.contact_id === "c-a" && c.channel === "whatsapp",
    );
    assert.ok(opened, "a WhatsApp conversation was opened for the contact");
    assert.equal(opened.tenant_id, A);
    assert.equal(outbound()[0].conversation_id, opened.id);
    assert.equal(provider.calls[0].body.to, "971501234567");
  });

  describe("sent to a number rather than a conversation", () => {
    const secondLine = (extra = {}) => {
      const line = {
        id: "num-a2",
        tenant_id: A,
        label: "Support line",
        display_phone: "+971 4 000 0009",
        phone_number_id: "pn-a2",
        access_token: "token-a2",
        active: true,
        is_default: false,
        ...extra,
      };
      rows.wa_numbers.push(line);
      return line;
    };
    const toNumber = () => template({ conversationId: null, phone: "971501234567" });
    beforeEach(() => {
      db.state.rpcResults["resolve_contact_by_identity"] = [{ contact_id: "c-a", branch_id: null }];
    });

    it("goes in the customer's existing conversation, from the line that conversation uses", async () => {
      // It used to take the workspace default and file the message under the
      // other line's conversation.
      secondLine();
      rows.conversations[0].wa_number_id = "num-a2";
      const result = await toNumber();
      assert.equal(result.state, "accepted");
      assert.match(provider.calls[0].url, /\/pn-a2\/messages$/);
      assert.equal(provider.calls[0].init.headers.Authorization, "Bearer token-a2");
      assert.equal(outbound()[0].conversation_id, "conv-a");
      assert.equal(
        rows.conversations.filter((c) => c.contact_id === "c-a" && c.channel === "whatsapp").length,
        1,
      );
    });

    it("follows the routing decision for a customer who has no conversation yet", async () => {
      // The default was picked first, then refused for not being the routed line.
      secondLine();
      rows.conversations = rows.conversations.filter((c) => c.id !== "conv-a");
      rows.leads.push({
        id: "lead-1",
        tenant_id: A,
        contact_id: "c-a",
        assigned_wa_number_id: "num-a2",
        created_at: secondsAgo(86400),
      });
      db.reset(rows);
      declareKeys();
      db.state.rpcResults["resolve_contact_by_identity"] = [{ contact_id: "c-a", branch_id: null }];
      const result = await toNumber();
      assert.equal(result.state, "accepted");
      assert.match(provider.calls[0].url, /\/pn-a2\/messages$/);
      const opened = rows.conversations.find(
        (c) => c.contact_id === "c-a" && c.channel === "whatsapp",
      );
      assert.equal(opened.wa_number_id, "num-a2");
    });

    it("does not fall back to another line when the routed one is switched off", async () => {
      secondLine({ active: false });
      rows.conversations = rows.conversations.filter((c) => c.id !== "conv-a");
      rows.leads.push({
        id: "lead-1",
        tenant_id: A,
        contact_id: "c-a",
        assigned_wa_number_id: "num-a2",
        created_at: secondsAgo(86400),
      });
      db.reset(rows);
      declareKeys();
      db.state.rpcResults["resolve_contact_by_identity"] = [{ contact_id: "c-a", branch_id: null }];
      const result = await toNumber();
      assert.equal(result.state, "blocked");
      assert.deepEqual(
        result.blocks.map((b) => b.code),
        ["number_disabled"],
      );
      assert.equal(provider.calls.length, 0);
    });

    it("still refuses a reply from a line the customer is not routed to", async () => {
      secondLine();
      rows.leads.push({
        id: "lead-1",
        tenant_id: A,
        contact_id: "c-a",
        assigned_wa_number_id: "num-a2",
        created_at: secondsAgo(86400),
      });
      const result = await send();
      assert.ok(result.blocks.some((b) => b.code === "routed_to_other_number"));
      assert.equal(provider.calls.length, 0);
    });

    it("stops when it cannot read whether the customer has a conversation", async () => {
      db.fail("conversations:read", STATEMENT_TIMEOUT);
      await assert.rejects(toNumber(), /so it was not sent/);
      assert.equal(provider.calls.length, 0);
      assert.equal(outbound().length, 0);
    });
  });

  it("is audited once when a second copy loses the race", async () => {
    provider.next.push(refused(132001));
    await template({ clientRef: REF_1 });
    const sends = () =>
      globalThis.waSuite.audits.filter((entry) => entry.action === "message.template_send").length;
    assert.equal(sends(), 1);
    let looks = 0;
    db.fail("messages:read", () => (++looks === 1 ? { empty: true } : null));
    const again = await template({ clientRef: REF_1 });
    assert.deepEqual([again.repeated, again.state], [true, "rejected"]);
    assert.equal(sends(), 1);
    assert.equal(provider.calls.length, 1);
  });

  it("cannot use another workspace's template", async () => {
    rows.wa_templates[0].tenant_id = B;
    await assert.rejects(template(), /Template not found/);
    assert.equal(provider.calls.length, 0);
  });

  it("is refused by the provider with the template reason", async () => {
    provider.next.push(refused(132001));
    const result = await template();
    assert.equal(result.failureReason, "template");
    assert.equal(outbound()[0].status, "failed");
  });
});

function statusPayload(phoneNumberId, ...statuses) {
  return {
    entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneNumberId }, statuses } }] }],
  };
}

function inboundPayload(phoneNumberId, message) {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: phoneNumberId },
              contacts: [{ profile: { name: "Sara" } }],
              messages: [message],
            },
          },
        ],
      },
    ],
  };
}

describe("delivery receipts", () => {
  const sentRow = (extra = {}) => {
    const row = {
      id: "out-a",
      tenant_id: A,
      conversation_id: "conv-a",
      direction: "outbound",
      sender: "agent",
      body: "Hello",
      status: "sent",
      wa_message_id: "wamid.OUT-A",
      ...extra,
    };
    rows.messages.push(row);
    return row;
  };

  it("advance sent to delivered to read", async () => {
    const row = sentRow();
    await processWaPayload(statusPayload("pn-a", { id: "wamid.OUT-A", status: "delivered" }));
    assert.equal(row.status, "delivered");
    await processWaPayload(statusPayload("pn-a", { id: "wamid.OUT-A", status: "read" }));
    assert.equal(row.status, "read");
  });

  it("arriving out of order never move a message backwards", async () => {
    const row = sentRow();
    await processWaPayload(statusPayload("pn-a", { id: "wamid.OUT-A", status: "read" }));
    await processWaPayload(statusPayload("pn-a", { id: "wamid.OUT-A", status: "delivered" }));
    await processWaPayload(statusPayload("pn-a", { id: "wamid.OUT-A", status: "sent" }));
    assert.equal(row.status, "read");
  });

  it("delivered twice are handled once", async () => {
    sentRow();
    const first = await processWaPayload(
      statusPayload("pn-a", { id: "wamid.OUT-A", status: "delivered" }),
    );
    const second = await processWaPayload(
      statusPayload("pn-a", { id: "wamid.OUT-A", status: "delivered" }),
    );
    assert.equal(first, 1);
    assert.equal(second, 0, "the replay does nothing");
  });

  it("mark a sent message failed, but not one that already arrived", async () => {
    const pending = sentRow();
    await processWaPayload(
      statusPayload("pn-a", { id: "wamid.OUT-A", status: "failed", errors: [{ code: 131026 }] }),
    );
    assert.equal(pending.status, "failed");
    assert.match(rows.system_alerts.at(-1).message, /could not reach/);

    const arrived = sentRow({ id: "out-a2", wa_message_id: "wamid.OUT-A2", status: "delivered" });
    await processWaPayload(statusPayload("pn-a", { id: "wamid.OUT-A2", status: "failed" }));
    assert.equal(arrived.status, "delivered");
  });

  it("ignore a status the provider does not document", async () => {
    const row = sentRow();
    const handled = await processWaPayload(
      statusPayload("pn-a", { id: "wamid.OUT-A", status: "deleted" }),
    );
    assert.equal(handled, 0);
    assert.equal(row.status, "sent");
  });

  it("for one workspace's number never touch another workspace's message", async () => {
    const theirs = sentRow({
      id: "out-b",
      tenant_id: B,
      conversation_id: "conv-b",
      wa_message_id: "wamid.OUT-B",
    });
    // The receipt names B's message id but arrives on A's number.
    await processWaPayload(statusPayload("pn-a", { id: "wamid.OUT-B", status: "read" }));
    assert.equal(theirs.status, "sent");
    // Nor can A's receipt claim B's row through the callback reference.
    const unconfirmed = sentRow({
      id: "33333333-3333-4333-8333-333333333333",
      tenant_id: B,
      conversation_id: "conv-b",
      status: "unconfirmed",
      wa_message_id: null,
    });
    await processWaPayload(
      statusPayload("pn-a", {
        id: "wamid.NEW",
        status: "delivered",
        biz_opaque_callback_data: unconfirmed.id,
      }),
    );
    assert.equal(unconfirmed.status, "unconfirmed");
    assert.equal(unconfirmed.wa_message_id, null);
  });

  it("with a reference that is not a FLAS id are ignored", async () => {
    const row = sentRow({ status: "unconfirmed", wa_message_id: null });
    await processWaPayload(
      statusPayload("pn-a", {
        id: "wamid.X",
        status: "delivered",
        biz_opaque_callback_data: "out-a' OR 1=1",
      }),
    );
    assert.equal(row.status, "unconfirmed");
  });

  it("for a number FLAS does not know are dropped, not guessed", async () => {
    const row = sentRow();
    await processWaPayload(statusPayload("pn-unknown", { id: "wamid.OUT-A", status: "read" }));
    assert.equal(row.status, "sent");
  });

  const failureAlerts = () =>
    rows.system_alerts.filter((a) => a.title === "WhatsApp message delivery failed");

  it("announce a failure once, however many times it is delivered", async () => {
    sentRow();
    const failed = statusPayload("pn-a", {
      id: "wamid.OUT-A",
      status: "failed",
      errors: [{ code: 131026 }],
    });
    await processWaPayload(failed);
    await processWaPayload(failed);
    assert.equal(failureAlerts().length, 1);
  });

  it("announce a failure once for a message FLAS holds no row for", async () => {
    const failed = statusPayload("pn-a", { id: "wamid.ELSEWHERE", status: "failed" });
    await processWaPayload(failed);
    await processWaPayload(failed);
    assert.equal(failureAlerts().length, 1);
  });
});

describe("a receipt the database refused is not lost", () => {
  const REF_ROW = "55555555-5555-4555-8555-555555555555";
  const outboundRow = (extra = {}) => {
    const row = {
      id: "out-r",
      tenant_id: A,
      conversation_id: "conv-a",
      direction: "outbound",
      sender: "agent",
      body: "Hello",
      status: "sent",
      wa_message_id: "wamid.OUT-R",
      ...extra,
    };
    rows.messages.push(row);
    return row;
  };
  const refused = /Could not record a WhatsApp delivery receipt/;

  it("is applied by the identical webhook once the write works (matched by Meta's id)", async () => {
    const row = outboundRow();
    const receipt = statusPayload("pn-a", { id: "wamid.OUT-R", status: "delivered" });

    db.fail("messages:update", STATEMENT_TIMEOUT);
    await assert.rejects(processWaPayload(receipt), refused);
    assert.equal(row.status, "sent", "nothing was written");
    // It used to be marked as seen before it was saved, so this retry was
    // thrown away as a repeat and the message stayed "sent" for good.
    await assert.rejects(processWaPayload(receipt), refused);

    db.recover("messages:update");
    assert.equal(await processWaPayload(receipt), 1, "applied, not discarded");
    assert.equal(row.status, "delivered");
    assert.equal(await processWaPayload(receipt), 0, "and applied exactly once");
    assert.equal(row.status, "delivered");
    assert.equal(provider.calls.length, 0, "none of this sent the customer anything");
  });

  it("is applied by the identical webhook once the write works (matched by FLAS's reference)", async () => {
    // A send that timed out: no provider id, and still waiting for an answer.
    const row = outboundRow({ id: REF_ROW, status: "unconfirmed", wa_message_id: null });
    const receipt = statusPayload("pn-a", {
      id: "wamid.LATE",
      status: "read",
      biz_opaque_callback_data: REF_ROW,
    });

    db.fail("messages:update", STATEMENT_TIMEOUT);
    await assert.rejects(processWaPayload(receipt), refused);
    assert.equal(row.status, "unconfirmed");
    assert.equal(row.wa_message_id, null);

    db.recover("messages:update");
    assert.equal(await processWaPayload(receipt), 1);
    assert.equal(row.status, "read");
    assert.equal(row.wa_message_id, "wamid.LATE");
    assert.equal(await processWaPayload(receipt), 0, "exactly once");
    assert.equal(provider.calls.length, 0);
  });

  it("does not move a message backwards when the refused receipt is retried late", async () => {
    // "delivered" is refused by the database. Before anyone retries it, "read"
    // arrives and is saved. The retry of "delivered" must then change nothing.
    const row = outboundRow();
    const delivered = statusPayload("pn-a", { id: "wamid.OUT-R", status: "delivered" });
    const read = statusPayload("pn-a", { id: "wamid.OUT-R", status: "read" });

    db.fail("messages:update", STATEMENT_TIMEOUT);
    await assert.rejects(processWaPayload(delivered), refused);
    db.recover("messages:update");

    assert.equal(await processWaPayload(read), 1);
    assert.equal(row.status, "read");
    assert.equal(await processWaPayload(delivered), 0, "the late retry is a no-op, not an error");
    assert.equal(row.status, "read");
    assert.equal(provider.calls.length, 0);
  });

  it("is retried when the message could not even be looked up", async () => {
    const row = outboundRow();
    const receipt = statusPayload("pn-a", { id: "wamid.OUT-R", status: "delivered" });
    db.fail("messages:read", STATEMENT_TIMEOUT);
    await assert.rejects(processWaPayload(receipt), refused);
    db.recover("messages:read");
    await processWaPayload(receipt);
    assert.equal(row.status, "delivered");
  });

  it("does not depend on the dedupe table", async () => {
    const row = outboundRow();
    db.fail("webhook_dedup:insert", { code: "42501", message: "permission denied" });
    db.fail("webhook_dedup:delete", { code: "42501", message: "permission denied" });
    const receipt = statusPayload("pn-a", { id: "wamid.OUT-R", status: "delivered" });
    assert.equal(await processWaPayload(receipt), 1);
    assert.equal(await processWaPayload(receipt), 0);
    assert.equal(row.status, "delivered");
    assert.equal(rows.webhook_dedup.length, 0, "a saved receipt leaves no claim behind");
  });

  it("tells a late receipt from a refused one: late is a quiet no-op", async () => {
    const row = outboundRow({ status: "read" });
    const late = statusPayload("pn-a", { id: "wamid.OUT-R", status: "delivered" });
    assert.equal(await processWaPayload(late), 0);
    assert.equal(row.status, "read");
    // The same for a receipt naming, by reference, a message already settled.
    const settled = outboundRow({ id: REF_ROW, status: "failed", wa_message_id: null });
    const afterwards = statusPayload("pn-a", {
      id: "wamid.AFTER",
      status: "failed",
      biz_opaque_callback_data: REF_ROW,
    });
    assert.equal(await processWaPayload(afterwards), 0);
    assert.equal(settled.status, "failed");
    assert.equal(
      rows.system_alerts.filter((a) => a.title === "WhatsApp message delivery failed").length,
      0,
      "a failure already on the message is not announced again",
    );
  });

  it("still saves a customer's message from the same delivery, and the retry repeats nothing", async () => {
    const row = outboundRow();
    db.state.rpcResults["resolve_contact_by_identity"] = [{ contact_id: "c-a", branch_id: null }];
    const delivery = statusPayload("pn-a", { id: "wamid.OUT-R", status: "delivered" });
    const value = delivery.entry[0].changes[0].value;
    value.contacts = [{ profile: { name: "Sara" } }];
    value.messages = [
      { id: "wamid.IN-SAME", from: "971501234567", type: "text", text: { body: "Thanks" } },
    ];
    const stored = () => rows.messages.filter((m) => m.wa_message_id === "wamid.IN-SAME").length;

    db.fail("messages:update", STATEMENT_TIMEOUT);
    await assert.rejects(processWaPayload(delivery), refused);
    assert.equal(stored(), 1, "the customer's message was not held up by the receipt");
    assert.equal(row.status, "sent");

    db.recover("messages:update");
    await processWaPayload(delivery);
    assert.equal(row.status, "delivered");
    assert.equal(stored(), 1, "and it is not stored a second time");
    assert.equal(provider.calls.length, 0);
  });
});

describe("an inbound message", () => {
  const message = {
    id: "wamid.IN-NEW",
    from: "971501234567",
    type: "text",
    text: { body: "Any update?" },
  };

  it("delivered twice is stored once and counted unread once", async () => {
    db.state.rpcResults["resolve_contact_by_identity"] = [{ contact_id: "c-a", branch_id: null }];
    await processWaPayload(inboundPayload("pn-a", message));
    await processWaPayload(inboundPayload("pn-a", message));
    const stored = rows.messages.filter((m) => m.wa_message_id === "wamid.IN-NEW");
    assert.equal(stored.length, 1);
    assert.equal(stored[0].tenant_id, A);
    assert.equal(stored[0].direction, "inbound");
    assert.equal(stored[0].conversation_id, "conv-a", "no second thread for the same contact");
    const unread = db.state.rpcCalls.filter((c) => c.name === "increment_unread_count");
    assert.equal(unread.length, 1);
  });

  it("is filed under the workspace that owns the number it arrived on", async () => {
    // The same customer number writes to B's line: it must not land in A.
    await processWaPayload(inboundPayload("pn-b", { ...message, id: "wamid.IN-B" }));
    const stored = rows.messages.find((m) => m.wa_message_id === "wamid.IN-B");
    assert.equal(stored.tenant_id, B);
    const conversation = rows.conversations.find((c) => c.id === stored.conversation_id);
    assert.equal(conversation.tenant_id, B);
  });
});

describe("the chatbot's reply on WhatsApp", () => {
  const askForHuman = {
    id: "wamid.IN-BOT",
    from: "971501234567",
    type: "text",
    text: { body: "I want to talk to a human" },
  };
  beforeEach(() => {
    rows.tenant_bot_settings.push({
      tenant_id: A,
      enabled: true,
      bot_name: "Flas",
      greeting: "Hello!",
      instructions: "We sell CCTV kits in Dubai and install on Saturdays.",
      model: "default",
      handoff_keywords: [],
    });
    rows.conversations[0].bot_enabled = true;
    db.state.rpcResults["resolve_contact_by_identity"] = [{ contact_id: "c-a", branch_id: null }];
  });
  const botRows = () => rows.messages.filter((m) => m.sender === "bot");

  it("is sent only once Meta accepts it", async () => {
    provider.next.push(accepted("wamid.BOT"));
    await processWaPayload(inboundPayload("pn-a", askForHuman));
    assert.equal(provider.calls.length, 1);
    const [reply] = botRows();
    assert.equal(reply.status, "sent");
    assert.equal(reply.wa_message_id, "wamid.BOT");
    assert.equal(provider.calls[0].body.biz_opaque_callback_data, reply.id);
  });

  it("is marked not delivered, with the real reason, when Meta refuses it", async () => {
    provider.next.push(refused(131047));
    await processWaPayload(inboundPayload("pn-a", askForHuman));
    const [reply, notice] = botRows();
    assert.equal(reply.status, "failed");
    assert.match(notice.body, /Not delivered: The 24-hour WhatsApp reply window has closed/);
    assert.ok(!notice.body.includes("credentials"), "it used to blame credentials for everything");
    // Said to the team as an alert, since the event itself is not failed.
    const alert = rows.system_alerts.find(
      (a) => a.title === "WhatsApp reply could not be delivered",
    );
    assert.ok(alert, "nobody is told the reply was refused");
    assert.equal(alert.severity, "critical");
  });

  it("does not offer a retry that cannot send the refused reply", async () => {
    // The event used to be failed, which put Retry on it in Monitoring. The
    // retry skipped the already-saved message and was then marked processed,
    // as if the reply had gone.
    provider.next.push(refused(131047));
    await assert.doesNotReject(processWaPayload(inboundPayload("pn-a", askForHuman)));
    assert.equal(provider.calls.length, 1);
    // Running the same event again sends nothing and adds nothing.
    await processWaPayload(inboundPayload("pn-a", askForHuman));
    assert.equal(provider.calls.length, 1);
    assert.equal(botRows().length, 2, "the reply and its note, once");
  });

  it("is unconfirmed after a timeout, and the event is not failed for retry", async () => {
    provider.fail = new Error("timeout");
    await processWaPayload(inboundPayload("pn-a", askForHuman));
    assert.equal(botRows()[0].status, "unconfirmed");
    assert.equal(provider.calls.length, 1);
    // Replaying the webhook does not produce a second reply.
    provider.fail = null;
    await processWaPayload(inboundPayload("pn-a", askForHuman));
    assert.equal(provider.calls.length, 1);
  });
});

describe("when the AI cannot answer", () => {
  const question = {
    id: "wamid.IN-Q",
    from: "971501234567",
    type: "text",
    text: { body: "How much is the 4-camera kit?" },
  };
  const settings = {
    tenant_id: A,
    enabled: true,
    bot_name: "Flas",
    greeting: "Hello!",
    instructions: "We sell CCTV kits in Dubai and install on Saturdays.",
    model: "default",
    handoff_keywords: [],
  };
  const modelSays = (content) => () => ({
    status: 200,
    body: { choices: [{ message: { content } }] },
  });
  const botRows = () => rows.messages.filter((m) => m.sender === "bot");
  const conversation = () => rows.conversations.find((c) => c.id === "conv-a");

  beforeEach(() => {
    process.env.LOVABLE_API_KEY = "test-gateway";
    rows.tenant_bot_settings.push({ ...settings });
    conversation().bot_enabled = true;
    db.state.rpcResults["resolve_contact_by_identity"] = [{ contact_id: "c-a", branch_id: null }];
  });
  afterEach(() => {
    delete process.env.LOVABLE_API_KEY;
  });

  /** The workspace opted in to backups: its own OpenAI key behind the built-in AI. */
  function withBackupProvider() {
    db.state.rpcResults["get_tenant_ai_resilience"] = true;
    rows.ai_provider_keys = [
      { tenant_id: A, provider: "openai", api_key: "own-backup", active: true },
      { tenant_id: B, provider: "anthropic", api_key: "other-workspace", active: true },
    ];
  }

  /** The one fixed sentence, and the conversation handed to a person. */
  function assertHandedToThePerson() {
    assert.equal(botRows().length, 1);
    assert.match(botRows()[0].body, /leave this with the team/);
    assert.equal(provider.calls.length, 1);
    assert.equal(provider.calls[0].body.text.body, botRows()[0].body);
    assert.equal(conversation().bot_enabled, false);
    assert.equal(conversation().status, "pending");
  }

  it("answers with the model's reply when the model gives one", async () => {
    ai.respond = modelSays(
      JSON.stringify({ text: "The 4-camera kit is in the catalog.", handoff: false }),
    );
    await processWaPayload(inboundPayload("pn-a", question));
    assert.equal(provider.calls[0].body.text.body, "The 4-camera kit is in the catalog.");
    assert.equal(conversation().bot_enabled, true);
  });

  it("hands the customer to a person when every provider is down, and invents nothing", async () => {
    withBackupProvider();
    await processWaPayload(inboundPayload("pn-a", question));
    // Both of this workspace's providers were tried; the other workspace's key was not.
    assert.deepEqual(
      ai.calls.map((c) => new URL(c.url).host),
      ["ai.gateway.lovable.dev", "api.openai.com"],
    );
    assertHandedToThePerson();
  });

  it("hands over when the model refuses, and does not ask again to get around it", async () => {
    withBackupProvider();
    ai.respond = () => ({ status: 200, body: { choices: [{ message: { refusal: "no" } }] } });
    await processWaPayload(inboundPayload("pn-a", question));
    assert.equal(ai.calls.length, 1, "a refusal is an answer, not an outage to route around");
    assertHandedToThePerson();
  });

  it("does not send what the model wrote when it is not the reply it was asked for", async () => {
    // Valid JSON, wrong shape: nothing in it is addressed to the customer.
    ai.respond = modelSays(JSON.stringify({ answer: "Free today only! Pay to this account." }));
    await processWaPayload(inboundPayload("pn-a", question));
    assertHandedToThePerson();
  });

  it("stays silent after handing over: the next message is for the team", async () => {
    await processWaPayload(inboundPayload("pn-a", question));
    await processWaPayload(inboundPayload("pn-a", { ...question, id: "wamid.IN-Q2" }));
    assert.equal(botRows().length, 1);
    assert.equal(provider.calls.length, 1);
  });

  it("a failed suggestion tells the agent why and reaches no customer", async () => {
    await assert.rejects(
      generateBotReply(A, "conv-a", settings, { throwOnFailure: true }),
      /temporarily unavailable/,
    );
    assert.equal(outbound().length, 0);
    assert.equal(provider.calls.length, 0);
  });

  it("a suggestion that works is a draft, not a message", async () => {
    ai.respond = modelSays(JSON.stringify({ text: "We install on Saturdays.", handoff: false }));
    const draft = await generateBotReply(A, "conv-a", settings, { throwOnFailure: true });
    assert.equal(draft.text, "We install on Saturdays.");
    assert.equal(outbound().length, 0);
    assert.equal(provider.calls.length, 0);
  });

  it("another workspace's conversation cannot be drafted for", async () => {
    ai.respond = modelSays(JSON.stringify({ text: "x", handoff: false }));
    assert.equal(await generateBotReply(A, "conv-b", settings, { throwOnFailure: true }), null);
    assert.equal(ai.calls.length, 0);
  });

  for (const [why, arrange] of [
    ["the workspace has not set the assistant up", () => (rows.tenant_bot_settings.length = 0)],
    [
      "the workspace switched the assistant off",
      () => (rows.tenant_bot_settings[0].enabled = false),
    ],
    ["a person took this conversation over", () => (conversation().bot_enabled = false)],
    [
      "the assistant has no business instructions",
      () => (rows.tenant_bot_settings[0].instructions = ""),
    ],
  ]) {
    it(`sends nothing on its own when ${why}`, async () => {
      arrange();
      ai.respond = modelSays(JSON.stringify({ text: "Hello there", handoff: false }));
      await processWaPayload(inboundPayload("pn-a", question));
      assert.equal(ai.calls.length, 0);
      assert.equal(provider.calls.length, 0);
      assert.equal(botRows().length, 0);
    });
  }
});

describe("what is kept about a message, beyond its status", () => {
  const EVIDENCE = ["origin", "failure_reason", "failure_code", "sent_at", "failed_at"];
  /** Refuses any write that touches an evidence column, as a database without them does. */
  const columnsMissing = (query) =>
    query.patch && Object.keys(query.patch).some((k) => EVIDENCE.includes(k) || k.endsWith("_at"))
      ? { code: "PGRST204", message: "Could not find the 'origin' column of 'messages'" }
      : null;
  const recent = (iso) => Math.abs(Date.now() - new Date(iso).getTime()) < 60_000;

  it("records where an accepted reply came from and when Meta took it", async () => {
    await send();
    const [row] = outbound();
    assert.equal(row.origin, "inbox");
    assert.ok(recent(row.sent_at));
    assert.equal(row.failure_reason, undefined);
    assert.equal(row.failed_at, undefined);
  });

  it("keeps why a refused message was refused, on the message", async () => {
    provider.next.push(refused(131026));
    await send();
    const [row] = outbound();
    assert.equal(row.status, "failed");
    assert.equal(row.failure_reason, "recipient_unreachable");
    assert.equal(row.failure_code, 131026);
    assert.ok(recent(row.failed_at));
    assert.equal(row.sent_at, undefined, "a refused message was never sent");
  });

  it("claims no time for a send that got no answer", async () => {
    provider.fail = new Error("timeout");
    await send();
    const [row] = outbound();
    assert.equal(row.status, "unconfirmed");
    assert.equal(row.origin, "inbox");
    assert.equal(row.sent_at, undefined);
    assert.equal(row.failed_at, undefined);
  });

  it("marks a template as a template and the assistant's reply as the assistant's", async () => {
    await sendTemplate({
      tenantId: A,
      userId: "user-a",
      templateId: "tpl-a",
      conversationId: "conv-a",
      variables: ["Sara"],
    });
    assert.equal(outbound()[0].origin, "template");

    rows.tenant_bot_settings.push({
      tenant_id: A,
      enabled: true,
      bot_name: "Flas",
      greeting: "Hello!",
      instructions: "We sell CCTV kits in Dubai and install on Saturdays.",
      model: "default",
      handoff_keywords: [],
    });
    rows.conversations[0].bot_enabled = true;
    db.state.rpcResults["resolve_contact_by_identity"] = [{ contact_id: "c-a", branch_id: null }];
    await processWaPayload(
      inboundPayload("pn-a", {
        id: "wamid.IN-EV",
        from: "971501234567",
        type: "text",
        text: { body: "I want to talk to a human" },
      }),
    );
    const reply = rows.messages.find((m) => m.sender === "bot");
    assert.equal(reply.origin, "assistant");
    assert.ok(recent(reply.sent_at));
  });

  it("records an inbound message as arriving by webhook, with what it carried", async () => {
    db.state.rpcResults["resolve_contact_by_identity"] = [{ contact_id: "c-a", branch_id: null }];
    await processWaPayload(
      inboundPayload("pn-a", {
        id: "wamid.IN-DOC",
        from: "971501234567",
        type: "document",
        document: {
          id: "media-77",
          mime_type: "application/pdf",
          filename: "order.pdf",
          sha256: "abc123",
          caption: "My order",
        },
      }),
    );
    const row = rows.messages.find((m) => m.wa_message_id === "wamid.IN-DOC");
    assert.equal(row.origin, "webhook");
    assert.deepEqual(row.media, {
      kind: "document",
      id: "media-77",
      mime_type: "application/pdf",
      filename: "order.pdf",
      sha256: "abc123",
    });
    // Metadata only: no link to the file is stored.
    assert.ok(!JSON.stringify(row.media).includes("http"));
  });

  it("stamps a receipt with Meta's own time, on the message it moved", async () => {
    await send();
    const [row] = outbound();
    const deliveredAt = Math.floor(Date.now() / 1000) - 90;
    await processWaPayload(
      statusPayload("pn-a", {
        id: row.wa_message_id,
        status: "delivered",
        timestamp: String(deliveredAt),
      }),
    );
    assert.equal(row.delivered_at, new Date(deliveredAt * 1000).toISOString());
    await processWaPayload(statusPayload("pn-a", { id: row.wa_message_id, status: "read" }));
    assert.ok(recent(row.read_at), "no timestamp on the receipt: the time it arrived");
    // A copy of the first receipt, arriving late, rewrites nothing.
    await processWaPayload(
      statusPayload("pn-a", { id: row.wa_message_id, status: "delivered", timestamp: "1" }),
    );
    assert.equal(row.delivered_at, new Date(deliveredAt * 1000).toISOString());
  });

  it("keeps the reason from a failure receipt", async () => {
    await send();
    const [row] = outbound();
    await processWaPayload(
      statusPayload("pn-a", {
        id: row.wa_message_id,
        status: "failed",
        errors: [{ code: 131047 }],
      }),
    );
    assert.equal(row.status, "failed");
    assert.equal(row.failure_reason, "window_closed");
    assert.equal(row.failure_code, 131047);
    assert.ok(recent(row.failed_at));
  });

  it("works exactly as before on a database that does not have the columns yet", async () => {
    db.fail("messages:update", columnsMissing);
    const result = await send({ clientRef: REF_1 });
    assert.equal(result.state, "accepted", "the send is not failed by a missing detail");
    const [row] = outbound();
    assert.equal(row.status, "sent");
    assert.equal(row.wa_message_id, result.waId);
    assert.equal(row.origin, undefined);

    await processWaPayload(statusPayload("pn-a", { id: row.wa_message_id, status: "delivered" }));
    assert.equal(row.status, "delivered", "receipts still move the status");
    assert.equal(row.delivered_at, undefined);
  });

  it("stops asking a database that has said it has no such column", async () => {
    let attempts = 0;
    db.fail("messages:update", (query) => {
      const refusal = columnsMissing(query);
      if (refusal) attempts += 1;
      return refusal;
    });
    await send();
    await send();
    await send();
    assert.equal(attempts, 1, "asked once, then left alone for a while");
    assert.equal(outbound().length, 3);
    assert.ok(outbound().every((m) => m.status === "sent"));
  });

  it("does not fail a send whose detail could not be kept for another reason", async () => {
    db.fail("messages:update", (query) =>
      query.patch?.origin ? { code: "57014", message: "statement timeout" } : null,
    );
    const result = await send();
    assert.equal(result.state, "accepted");
    assert.equal(outbound()[0].status, "sent");
  });

  it("reads Meta's receipt time, and distrusts one that cannot be right", () => {
    const now = Date.UTC(2026, 9, 6, 12, 0, 0);
    assert.equal(receiptTime("1791288000", now), new Date(1791288000 * 1000).toISOString());
    for (const bad of [undefined, null, "", "soon", "1", "99999999999999"]) {
      assert.equal(receiptTime(bad, now), new Date(now).toISOString(), String(bad));
    }
  });

  it("says nothing it does not know", () => {
    const at = "2026-10-06T12:00:00.000Z";
    assert.deepEqual(evidenceOfSend({ state: "accepted", waMessageId: "w" }, at), { sent_at: at });
    assert.deepEqual(evidenceOfSend({ state: "unconfirmed", message: "x" }, at), {});
    assert.deepEqual(evidenceOfReceipt("read", at), { read_at: at });
    assert.deepEqual(evidenceOfReceipt("failed", at, 190), {
      failed_at: at,
      failure_reason: "credentials",
      failure_code: 190,
    });
    assert.equal(mediaOf({ text: { body: "hi" } }), null);
    assert.deepEqual(mediaOf({ image: { id: "m1", mime_type: "image/jpeg" } }), {
      kind: "image",
      id: "m1",
      mime_type: "image/jpeg",
    });
  });

  it("writes evidence only inside the message's own workspace", () => {
    const source = readFileSync(new URL("../src/lib/wa.server.ts", import.meta.url), "utf8")
      .split("\r\n")
      .join("\n");
    const writer = source.slice(
      source.indexOf("export async function recordMessageEvidence("),
      source.indexOf("export async function completeOutboundDelivery("),
    );
    assert.match(writer, /\.eq\("id", messageId\)\s*\n\s*\.eq\("tenant_id", tenantId\);/);
  });
});

describe("the assistant answers only where the workspace has opted in", () => {
  const NEW_CUSTOMER = "971559990000";
  const settings = (extra = {}) => ({
    tenant_id: A,
    enabled: true,
    bot_name: "Flas",
    greeting: "Hello!",
    instructions: "We sell CCTV kits in Dubai and install on Saturdays.",
    model: "default",
    handoff_keywords: [],
    auto_enroll_new_chats: false,
    ...extra,
  });
  const firstMessage = (id = "wamid.NEW-1", from = NEW_CUSTOMER) =>
    processWaPayload(
      inboundPayload("pn-a", { id, from, type: "text", text: { body: "Do you deliver?" } }),
    );
  /** The conversation the first message from a number opened. */
  const opened = () =>
    rows.conversations.find((c) => !["conv-a", "conv-b", "web-a"].includes(c.id));
  const botRows = () => rows.messages.filter((m) => m.sender === "bot");

  beforeEach(() => {
    process.env.LOVABLE_API_KEY = "test-gateway";
    ai.respond = () => ({
      status: 200,
      body: {
        choices: [
          { message: { content: JSON.stringify({ text: "Yes, we do.", handoff: false }) } },
        ],
      },
    });
  });
  afterEach(() => {
    delete process.env.LOVABLE_API_KEY;
  });

  it("does not answer a new customer of a workspace that never set the assistant up", async () => {
    await firstMessage();
    assert.equal(opened().bot_enabled, false);
    assert.equal(ai.calls.length, 0);
    assert.equal(provider.calls.length, 0);
  });

  it("does not answer a new customer when the assistant is on but new chats were not opted in", async () => {
    rows.tenant_bot_settings.push(settings());
    await firstMessage();
    assert.equal(opened().bot_enabled, false, "the conversation was enrolled without an opt-in");
    assert.equal(ai.calls.length, 0);
    assert.equal(provider.calls.length, 0);
    assert.equal(botRows().length, 0);
  });

  it("answers a new customer once the workspace has opted in to that", async () => {
    rows.tenant_bot_settings.push(settings({ auto_enroll_new_chats: true }));
    await firstMessage();
    assert.equal(opened().bot_enabled, true);
    assert.equal(ai.calls.length, 1);
    assert.equal(provider.calls.length, 1);
    assert.equal(provider.calls[0].body.text.body, "Yes, we do.");
  });

  it("does not enrol new chats for an assistant that is switched off, whatever the policy says", async () => {
    rows.tenant_bot_settings.push(settings({ enabled: false, auto_enroll_new_chats: true }));
    await firstMessage();
    assert.equal(opened().bot_enabled, false);
    assert.equal(provider.calls.length, 0);
  });

  it("still answers a conversation a person switched the assistant on for", async () => {
    // The policy is about NEW conversations. This one was turned on in the Inbox.
    rows.tenant_bot_settings.push(settings());
    rows.conversations[0].bot_enabled = true;
    db.state.rpcResults["resolve_contact_by_identity"] = [{ contact_id: "c-a", branch_id: null }];
    await firstMessage("wamid.EXISTING", "971501234567");
    assert.equal(provider.calls.length, 1);
  });

  it("stays out of a conversation a person took over, even with new chats opted in", async () => {
    rows.tenant_bot_settings.push(settings({ auto_enroll_new_chats: true }));
    rows.conversations[0].bot_enabled = false;
    db.state.rpcResults["resolve_contact_by_identity"] = [{ contact_id: "c-a", branch_id: null }];
    await firstMessage("wamid.TAKEN", "971501234567");
    assert.equal(rows.conversations[0].bot_enabled, false, "the hand-over was undone");
    assert.equal(ai.calls.length, 0);
    assert.equal(provider.calls.length, 0);
  });

  it("applies the same rule to a new website visitor", async () => {
    rows.tenant_bot_settings.push(settings());
    await ingestInboundMessage({ tenantId: A, channel: "web", sessionId: "s-1", text: "Hi" });
    const first = rows.conversations.find((c) => c.web_session_id === "s-1");
    assert.equal(first.bot_enabled, false);

    rows.tenant_bot_settings[0].auto_enroll_new_chats = true;
    const second = await ingestInboundMessage({
      tenantId: A,
      channel: "web",
      sessionId: "s-2",
      text: "Do you deliver?",
    });
    assert.equal(rows.conversations.find((c) => c.web_session_id === "s-2").bot_enabled, true);
    assert.equal(second.reply, "Yes, we do.");
  });

  it("does not enrol a conversation a person opened to send something", async () => {
    rows.tenant_bot_settings.push(settings({ auto_enroll_new_chats: true }));
    rows.conversations = rows.conversations.filter((c) => c.id !== "conv-a");
    db.reset(rows);
    declareKeys();
    db.state.rpcResults["resolve_contact_by_identity"] = [{ contact_id: "c-a", branch_id: null }];
    await sendTemplate({
      tenantId: A,
      userId: "user-a",
      templateId: "tpl-a",
      phone: "971501234567",
      variables: ["Sara"],
    });
    const byPerson = rows.conversations.find(
      (c) => c.contact_id === "c-a" && c.channel === "whatsapp",
    );
    assert.equal(byPerson.bot_enabled, false);
  });

  it("does not take a failed settings read for a workspace that has not opted in", async () => {
    rows.tenant_bot_settings.push(settings({ auto_enroll_new_chats: true }));
    // One blip: the first read fails, the second works.
    let reads = 0;
    db.fail("tenant_bot_settings:read", () => (++reads === 1 ? STATEMENT_TIMEOUT : null));
    await firstMessage();
    assert.equal(
      opened().bot_enabled,
      true,
      "an opted-in workspace's new chat was created with the assistant off",
    );
    assert.equal(provider.calls.length, 1);
  });

  it("opens no conversation while the settings cannot be read, and opens it correctly on retry", async () => {
    rows.tenant_bot_settings.push(settings({ auto_enroll_new_chats: true }));
    db.fail("tenant_bot_settings:read", STATEMENT_TIMEOUT);
    await assert.rejects(firstMessage(), /Could not read this workspace's assistant settings/);
    assert.equal(opened(), undefined, "a conversation was created with a guessed setting");
    assert.equal(rows.messages.filter((m) => m.wa_message_id === "wamid.NEW-1").length, 0);
    assert.equal(provider.calls.length, 0);

    db.recover("tenant_bot_settings:read");
    await firstMessage();
    assert.equal(opened().bot_enabled, true);
    assert.equal(rows.messages.filter((m) => m.wa_message_id === "wamid.NEW-1").length, 1);
    assert.equal(provider.calls.length, 1, "answered once, on the retry");
  });

  it("keeps the customer's message when the settings cannot be read for an existing conversation", async () => {
    // Nothing permanent depends on the settings here, so nothing is refused:
    // the message is saved and the assistant simply does not answer this one.
    rows.tenant_bot_settings.push(settings({ auto_enroll_new_chats: true }));
    rows.conversations[0].bot_enabled = true;
    db.state.rpcResults["resolve_contact_by_identity"] = [{ contact_id: "c-a", branch_id: null }];
    db.fail("tenant_bot_settings:read", STATEMENT_TIMEOUT);
    await firstMessage("wamid.KEPT", "971501234567");
    assert.equal(rows.messages.filter((m) => m.wa_message_id === "wamid.KEPT").length, 1);
    assert.equal(
      rows.conversations[0].bot_enabled,
      true,
      "the conversation was switched off by a failed read",
    );
    assert.equal(provider.calls.length, 0);
  });

  it("leaves the choice to the database on one that has no opt-in column yet", async () => {
    // Deployed before the migration: there is no policy to read, so nothing
    // is said and the column's own default applies, exactly as before.
    const legacy = settings();
    delete legacy.auto_enroll_new_chats;
    rows.tenant_bot_settings.push(legacy);
    await firstMessage();
    assert.ok(!("bot_enabled" in opened()), "the code overrode the database default");
    assert.deepEqual(newChatAutomation(legacy), {});
  });

  it("says off unless both switches are on", () => {
    assert.deepEqual(newChatAutomation(null), { bot_enabled: false });
    assert.deepEqual(newChatAutomation(settings()), { bot_enabled: false });
    assert.deepEqual(newChatAutomation(settings({ auto_enroll_new_chats: true })), {
      bot_enabled: true,
    });
    assert.deepEqual(newChatAutomation(settings({ enabled: false, auto_enroll_new_chats: true })), {
      bot_enabled: false,
    });
  });

  describe("in the source", () => {
    const read = (path) =>
      readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
        .split("\r\n")
        .join("\n");

    it("every conversation the code creates says whether the assistant answers it", () => {
      const wa = read("src/lib/wa.server.ts");
      const inserts = wa
        .split('.from("conversations")')
        .slice(1)
        .map((after) => after.slice(0, 400))
        .filter((after) => /^\s*\.insert\(\{/.test(after));
      assert.equal(inserts.length, 3, "a conversation is created somewhere new");
      for (const insert of inserts) {
        assert.ok(
          insert.includes("...(await newChatPolicy())") || insert.includes("bot_enabled: false"),
          "a conversation is created without saying whether the assistant answers it",
        );
      }
      // No other file creates conversations.
      for (const file of [
        "src/lib/wa-send.server.ts",
        "src/lib/crm.functions.ts",
        "src/lib/monitoring.server.ts",
      ]) {
        assert.ok(!/from\("conversations"\)\s*\.insert/.test(read(file)), file);
      }
    });

    it("the Chatbot page starts off, asks before turning on, and only saves a policy the database has", () => {
      const page = read("src/routes/_authenticated/chatbot.tsx");
      assert.match(page, /enabled: false,\n\s+auto_enroll_new_chats: false,/);
      assert.ok(
        !/useState\(\{\s*enabled: true/.test(page),
        "the form starts with automatic replies on",
      );
      assert.match(
        page,
        /v && !form\.enabled \? setConfirmingOn\(true\) : setForm\(\{ \.\.\.form, enabled: v \}\)/,
      );
      assert.match(
        page,
        /<AlertDialogAction onClick=\{\(\) => setForm\(\{ \.\.\.form, enabled: true \}\)\}>/,
      );
      assert.match(
        page,
        /\? \{ auto_enroll_new_chats: form\.enabled && form\.auto_enroll_new_chats \}/,
      );
      assert.match(page, /\{policyAvailable && \(/);
    });

    it("the migration switches nothing off and hands existing workspaces over once", () => {
      const sql = read("supabase/migrations/20261006160000_assistant_explicit_opt_in.sql");
      assert.match(
        sql,
        /ALTER TABLE public\.tenant_bot_settings ALTER COLUMN enabled SET DEFAULT false;/,
      );
      assert.match(
        sql,
        /ALTER TABLE public\.conversations ALTER COLUMN bot_enabled SET DEFAULT false;/,
      );
      assert.match(
        sql,
        /UPDATE public\.tenant_bot_settings SET auto_enroll_new_chats = true WHERE enabled;/,
      );
      // Nothing in it turns a workspace or a conversation off.
      assert.ok(!/SET\s+enabled\s*=\s*false/i.test(sql));
      assert.ok(!/UPDATE\s+public\.conversations/i.test(sql));
      // The hand-over is inside the "column does not exist yet" guard.
      const guard = sql.slice(sql.indexOf("IF NOT EXISTS ("), sql.indexOf("END IF;"));
      assert.ok(guard.includes("SET auto_enroll_new_chats = true WHERE enabled"));
      assert.match(
        sql,
        /REVOKE ALL ON FUNCTION public\.note_assistant_automation_change\(\) FROM PUBLIC, anon, authenticated;/,
      );
      assert.match(sql, /SET search_path = public, pg_temp/);
    });
  });
});

describe("nothing reaches a customer around the pipeline", () => {
  const read = (path) =>
    readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
      .split("\r\n")
      .join("\n");

  it("sends the assistant's approved WhatsApp action the way the Inbox sends a reply", () => {
    // It called the provider directly: no 24-hour check, no subscription or
    // routing check, and no message left in the conversation.
    const agent = read("src/lib/agent.server.ts");
    assert.match(agent, /sendConversationMessage\(\{/);
    assert.ok(!agent.includes("sendWhatsAppText("), "a direct provider call is back");
    // And it still needs a person's approval before it runs at all.
    assert.match(agent, /if \(spec\.risk !== "read" && !confirmed\) \{/);
  });

  it("keeps the API functions as thin doors onto the pipeline", () => {
    const crm = read("src/lib/crm.functions.ts");
    assert.ok(!crm.includes("sendWhatsAppText("));
    assert.ok(!crm.includes("sendWhatsAppTemplate("));
    assert.match(crm, /sendConversationMessage\(\{/);
    assert.match(crm, /sendTemplate\(\{/);
    assert.match(crm, /describeSendContext\(tenantId, data\.conversationId\)/);
  });
});
