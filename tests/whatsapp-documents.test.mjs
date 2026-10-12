// An invoice or a paid receipt sent to a customer over WhatsApp.
//
// These used to call Meta directly. They now follow the rules every other
// message follows -- and one of their own: outside the customer's 24-hour
// window only an approved utility template of this workspace may go, and when
// there is none nothing is sent at all.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it } from "node:test";

import { createDb, secondsAgo } from "./support/db-double.mjs";

import { customerLinkOrigin } from "../node_modules/.cache/flas-customer-link.mjs";
import {
  DOCUMENT_TEMPLATE_NAMES,
  NO_DOCUMENT_TEMPLATE_TEXT,
  sendDocumentOverWhatsApp,
} from "../node_modules/.cache/flas-whatsapp.mjs";

const db = createDb();
globalThis.waSuite = { db: db.client, audits: [] };

const A = "tenant-a";
const B = "tenant-b";
const REF = "11111111-1111-4111-8111-111111111111";
const LINK = "https://flas.example/pay/tok_abc";

let provider;
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
        label: "Accounts",
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
      { id: "c-new", tenant_id: A, name: "Omar", phone: "+971 55 000 1111", consent_given: true },
      { id: "c-b", tenant_id: B, name: "Tom", phone: "+447700900123", consent_given: true },
    ],
    conversations: [
      { id: "conv-a", tenant_id: A, contact_id: "c-a", channel: "whatsapp", wa_number_id: "num-a" },
    ],
    messages: [
      {
        id: "in-a",
        tenant_id: A,
        conversation_id: "conv-a",
        direction: "inbound",
        sender: "contact",
        body: "Please send the invoice",
        status: "sent",
        created_at: secondsAgo(3600),
      },
    ],
    wa_templates: [],
    leads: [],
    webhook_dedup: [],
  };
  db.reset(rows);
  db.unique("messages", ["id"]);
  globalThis.waSuite.audits = [];
  provider = { calls: [] };
  globalThis.fetch = async (url, init) => {
    provider.calls.push({ url: String(url), body: JSON.parse(init.body) });
    if (provider.fail) throw new Error("socket hang up");
    const body = { messages: [{ id: `wamid.${provider.calls.length}` }] };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
});

const outbound = () => rows.messages.filter((m) => m.direction === "outbound");
const closeTheWindow = () => {
  rows.messages.find((m) => m.id === "in-a").created_at = secondsAgo(25 * 3600);
};
const approvedTemplate = (extra = {}) => {
  const template = {
    id: `tpl-${rows.wa_templates.length + 1}`,
    tenant_id: A,
    name: "invoice_notification",
    language: "en",
    category: "UTILITY",
    status: "approved",
    body: "Hello {{1}}, {{2}} for {{3}} is ready: {{4}}",
    wa_number_id: null,
    ...extra,
  };
  rows.wa_templates.push(template);
  return template;
};
const sendInvoice = (extra = {}) =>
  sendDocumentOverWhatsApp({
    tenantId: A,
    userId: "user-a",
    kind: "invoice",
    contactId: "c-a",
    phone: "+971 50 123 4567",
    text: `Invoice INV-7\nAmount: AED 100.00\n\n${LINK}`,
    templateVariables: ["Sara", "Invoice INV-7", "AED 100.00", LINK],
    ...extra,
  });
const codes = (result) => result.blocks.map((b) => b.code);

describe("inside the customer's 24-hour window", () => {
  it("goes as an ordinary message, in the customer's own conversation", async () => {
    const result = await sendInvoice();
    assert.equal(result.state, "accepted");
    assert.equal(result.via, "text");
    assert.equal(provider.calls.length, 1);
    assert.match(provider.calls[0].url, /\/pn-a\/messages$/);
    assert.equal(provider.calls[0].body.type, "text");
    assert.equal(provider.calls[0].body.to, "971501234567");
    // It used to leave nothing behind: now it is a message in the thread.
    const [saved] = outbound();
    assert.equal(saved.conversation_id, "conv-a");
    assert.equal(saved.status, "sent");
    assert.match(saved.body, /INV-7/);
    assert.equal(result.recipient, "+971501234567");
  });

  it("is one message for two clicks", async () => {
    const results = await Promise.all([
      sendInvoice({ clientRef: REF }),
      sendInvoice({ clientRef: REF }),
    ]);
    assert.equal(provider.calls.length, 1);
    assert.equal(outbound().length, 1);
    assert.deepEqual(results.map((r) => r.state).sort(), ["accepted", "duplicate"]);
  });

  it("is not called sent on the strength of a repeat", async () => {
    // The answer to the first click was lost, so the same send arrives again.
    provider.fail = true;
    const first = await sendInvoice({ clientRef: REF });
    assert.equal(first.state, "unconfirmed");
    provider.fail = false;
    const again = await sendInvoice({ clientRef: REF });
    assert.equal(again.repeated, true);
    assert.equal(again.state, "unconfirmed", "an unanswered invoice was reported as sent");
    assert.equal(again.ok, false);
    assert.equal(provider.calls.length, 1);
  });

  it("is not called sent while the first copy is still on its way", async () => {
    await sendInvoice({ clientRef: REF });
    outbound()[0].status = "sending";
    outbound()[0].created_at = secondsAgo(3);
    const during = await sendInvoice({ clientRef: REF });
    assert.equal(during.state, "unconfirmed");
    assert.equal(during.via, "text");
    assert.equal(provider.calls.length, 1);
  });

  it("is reported as sent by a repeat only when WhatsApp accepted the first copy", async () => {
    await sendInvoice({ clientRef: REF });
    const again = await sendInvoice({ clientRef: REF });
    assert.deepEqual([again.state, again.ok, again.repeated], ["duplicate", true, true]);
    assert.equal(provider.calls.length, 1);
  });

  it("is stopped by the same things that stop a reply", async () => {
    rows.wa_numbers[0].active = false;
    const result = await sendInvoice();
    assert.equal(result.state, "blocked");
    assert.deepEqual(codes(result), ["number_disabled"]);
    assert.equal(provider.calls.length, 0);
    assert.equal(outbound().length, 0);
  });
});

describe("outside the 24-hour window", () => {
  beforeEach(closeTheWindow);

  it("sends nothing when the workspace has no approved template for it, and says why", async () => {
    const result = await sendInvoice();
    assert.equal(result.state, "blocked");
    assert.equal(result.via, null);
    assert.deepEqual(codes(result), ["no_document_template"]);
    assert.equal(result.blocks[0].message, NO_DOCUMENT_TEMPLATE_TEXT);
    assert.match(result.blocks[0].message, /Download the PDF/);
    assert.equal(provider.calls.length, 0, "it is not sent some other way");
    assert.equal(outbound().length, 0);
  });

  it("goes as the workspace's approved utility template", async () => {
    approvedTemplate();
    const result = await sendInvoice();
    assert.equal(result.state, "accepted");
    assert.equal(result.via, "template");
    const sent = provider.calls[0].body;
    assert.equal(sent.type, "template");
    assert.equal(sent.template.name, "invoice_notification");
    assert.deepEqual(
      sent.template.components[0].parameters.map((p) => p.text),
      ["Sara", "Invoice INV-7", "AED 100.00", LINK],
    );
    // What the customer was sent is on record, in their conversation.
    assert.equal(outbound()[0].conversation_id, "conv-a");
    assert.equal(outbound()[0].body, `Hello Sara, Invoice INV-7 for AED 100.00 is ready: ${LINK}`);
  });

  it("uses the receipt's own template for a paid copy, never the invoice one", async () => {
    approvedTemplate();
    const receipt = await sendInvoice({ kind: "receipt" });
    assert.deepEqual(codes(receipt), ["no_document_template"]);
    approvedTemplate({ name: DOCUMENT_TEMPLATE_NAMES.receipt });
    const again = await sendInvoice({ kind: "receipt" });
    assert.equal(again.via, "template");
    assert.equal(provider.calls[0].body.template.name, "payment_receipt");
  });

  for (const [why, template] of [
    ["is still waiting for Meta's approval", { status: "pending" }],
    ["was rejected", { status: "rejected" }],
    ["is a marketing template", { category: "MARKETING" }],
    ["does not take the four values this message fills", { body: "Hello {{1}}, see {{2}}" }],
    ["belongs to a different number", { wa_number_id: "num-other" }],
    ["belongs to another workspace", { tenant_id: B }],
    ["has another name", { name: "invoice_promo" }],
  ]) {
    it(`does not use a template that ${why}`, async () => {
      approvedTemplate(template);
      const result = await sendInvoice();
      assert.deepEqual(codes(result), ["no_document_template"]);
      assert.equal(provider.calls.length, 0);
    });
  }

  it("needs the customer's consent, template or not", async () => {
    approvedTemplate();
    rows.contacts[0].consent_given = false;
    const result = await sendInvoice();
    assert.equal(result.state, "blocked");
    // The real reason, not "no template".
    assert.deepEqual(codes(result), ["no_consent"]);
    assert.equal(provider.calls.length, 0);
    assert.equal(outbound().length, 0);
  });

  it("gives the real reason first: no consent, not a missing template", async () => {
    // No template AND no consent. Adding a template would not make this
    // sendable, so "add a template" must not be what the person is told.
    rows.contacts[0].consent_given = false;
    const result = await sendInvoice();
    assert.deepEqual(codes(result), ["no_consent"]);
    assert.equal(provider.calls.length, 0);
  });

  it("does not treat a template it sent as a reason to send free text next", async () => {
    approvedTemplate();
    await sendInvoice();
    // Sending a template does not re-open the window: the next one is a
    // template again, not an ordinary message.
    const next = await sendInvoice();
    assert.equal(next.via, "template");
    assert.equal(provider.calls[1].body.type, "template");
  });
});

describe("who an invoice can be sent to", () => {
  it("opens the contact's conversation when they have none, for a template with consent", async () => {
    approvedTemplate();
    db.state.rpcResults["resolve_contact_by_identity"] = [{ contact_id: "c-new", branch_id: null }];
    const result = await sendInvoice({ contactId: "c-new", phone: "+971 55 000 1111" });
    assert.equal(result.via, "template");
    assert.equal(provider.calls[0].body.to, "971550001111");
    const opened = rows.conversations.find((c) => c.contact_id === "c-new");
    assert.ok(opened, "a conversation now holds the message");
    assert.equal(opened.tenant_id, A);
    assert.equal(outbound()[0].conversation_id, opened.id);
  });

  it("is not sent to a number that is nobody's saved contact", async () => {
    const result = await sendInvoice({ contactId: null, phone: "+971 58 999 0000" });
    assert.deepEqual(codes(result), ["contact_not_saved"]);
    assert.equal(provider.calls.length, 0);
  });

  it("cannot reach another workspace's contact", async () => {
    approvedTemplate();
    const result = await sendInvoice({ contactId: "c-b", phone: "+447700900123" });
    assert.deepEqual(codes(result), ["contact_not_saved"]);
    assert.equal(provider.calls.length, 0);
    assert.equal(outbound().length, 0);
  });

  it("stops, and sends nothing, when the contact cannot be read", async () => {
    db.fail("contacts:read", { code: "57014", message: "statement timeout" });
    await assert.rejects(sendInvoice(), /Could not read this customer's contact/);
    assert.equal(provider.calls.length, 0);
  });

  it("stops when the templates cannot be read, rather than deciding there are none", async () => {
    closeTheWindow();
    db.fail("wa_templates:read", { code: "57014", message: "statement timeout" });
    await assert.rejects(sendInvoice(), /Could not read this workspace's WhatsApp templates/);
    assert.equal(provider.calls.length, 0);
  });
});

describe("the link a customer is sent", () => {
  const before = { ...process.env };
  afterEach(() => {
    process.env.PUBLIC_APP_URL = before.PUBLIC_APP_URL;
    process.env.OAUTH_ALLOWED_ORIGINS = before.OAUTH_ALLOWED_ORIGINS;
    if (before.PUBLIC_APP_URL === undefined) delete process.env.PUBLIC_APP_URL;
    if (before.OAUTH_ALLOWED_ORIGINS === undefined) delete process.env.OAUTH_ALLOWED_ORIGINS;
  });
  const own = "https://flas.example/_serverFn/abc";

  it("points at the deployment's configured origin", () => {
    process.env.PUBLIC_APP_URL = "https://flas.example";
    assert.equal(customerLinkOrigin("https://flas.example", null), "https://flas.example");
    assert.equal(
      customerLinkOrigin("https://flas.example/sales?x=1", null),
      "https://flas.example",
    );
  });

  it("or at the very origin the request was made to", () => {
    delete process.env.PUBLIC_APP_URL;
    delete process.env.OAUTH_ALLOWED_ORIGINS;
    assert.equal(customerLinkOrigin("https://flas.example", own), "https://flas.example");
  });

  it("and nowhere else, whatever the request claims", () => {
    process.env.PUBLIC_APP_URL = "https://flas.example";
    for (const claimed of [
      "https://flas.example.attacker.test",
      "https://attacker.test",
      "http://flas.example",
      "https://user:pass@flas.example",
      "javascript:alert(1)",
      "not a url",
    ]) {
      assert.throws(() => customerLinkOrigin(claimed, own), /nothing was sent/, claimed);
    }
  });
});

describe("the invoice screens use the pipeline", () => {
  const read = (path) =>
    readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
      .split("\r\n")
      .join("\n");

  it("no longer has a way to call WhatsApp without it", () => {
    const billing = read("src/lib/billing.functions.ts");
    assert.ok(!billing.includes("sendWhatsAppText"));
    assert.ok(!billing.includes("resolveWaCredentials"));
    assert.equal(billing.split("sendDocumentOverWhatsApp({").length - 1, 2, "invoice and receipt");
    // The door itself is gone.
    const wa = read("src/lib/wa.server.ts");
    assert.ok(!wa.includes("export async function sendWhatsAppText"));
    assert.ok(!wa.includes("export async function sendWhatsAppTemplate"));
  });

  it("reads every row inside the sender's own workspace", () => {
    // The gate behind this refuses another workspace's contact too, so a
    // missing filter here would not change an answer -- it would only mean
    // another company's customer number had been read. Held by the source.
    const documents = read("src/lib/billing-whatsapp.server.ts");
    const reads = documents.split('.from("').length - 1;
    assert.equal(reads, 3);
    assert.equal(documents.split('.eq("tenant_id", tenantId)').length - 1, reads);
  });

  it("builds the customer's link from a checked origin, not from what the browser said", () => {
    const billing = read("src/lib/billing.functions.ts");
    assert.match(billing, /customerLinkOrigin\(data\.origin, getRequest\(\)\?\.url\)/);
    assert.ok(!billing.includes("data.origin.replace("), "the claimed origin is used as given");
  });

  it("marks a document sent only when WhatsApp accepted it", () => {
    const billing = read("src/lib/billing.functions.ts");
    assert.match(
      billing,
      /const accepted = sent\.state === "accepted" \|\| sent\.state === "duplicate";\n\s+if \(accepted\) \{\n\s+await supabase\n\s+\.from\("sales_documents"\)/,
    );
  });

  it("shows why it was not sent, and offers the PDF instead", () => {
    const sales = read("src/routes/_authenticated/sales.tsx");
    assert.match(sales, /if \(result\.state === "blocked"\) \{/);
    assert.match(sales, /setSendBlocks\(result\.blocks\);/);
    assert.match(sales, /tx\(`inbox\.block\.\$\{b\.code\}`, b\.message\)/);
    assert.match(sales, /t\("sales\.downloadPdfToSendYourself"\)/);
    assert.match(sales, /onClick=\{\(\) => sendFor && download\.mutate\(sendFor\.id\)\}/);
    // A refusal or an unanswered request is never toasted as "sent".
    assert.match(sales, /t\("sales\.notSentOnWhatsappReason"/);
    assert.match(sales, /clientRef: sendRef\.current\.ref/);
  });

  it("has words in every language for the new reason", () => {
    const inbox = read("src/lib/i18n/screens/inbox.ts");
    assert.equal(inbox.split('"inbox.block.no_document_template"').length - 1, 5);
    assert.ok(inbox.includes(JSON.stringify(NO_DOCUMENT_TEMPLATE_TEXT)));
  });
});
