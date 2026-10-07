// Abuse controls on the endpoints a site key alone can reach: who a website
// visitor is allowed to say they are, how often a public endpoint may be used,
// and whether a captured webhook delivery can be sent again.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createHash, createHmac } from "node:crypto";

import { createDb, secondsAgo } from "./support/db-double.mjs";
import { Route as widgetRoute } from "../node_modules/.cache/flas-widget-chat.mjs";
import { Route as collectRoute } from "../node_modules/.cache/flas-leads-collect.mjs";
import { Route as wordpressRoute } from "../node_modules/.cache/flas-webhook-wordpress.mjs";
import { Route as shopifyRoute } from "../node_modules/.cache/flas-webhook-shopify.mjs";
import { authenticateApiKey } from "../node_modules/.cache/flas-api-keys.mjs";
import {
  LEADS_PER_MINUTE_PER_SITE,
  WIDGET_MESSAGES_PER_MINUTE,
  WIDGET_NEW_SESSIONS_PER_5_MIN,
} from "../node_modules/.cache/flas-public-limits.mjs";

const db = createDb();
const SITE_KEY = "site-key-public-0001";
const SECRET = "webhook-secret-for-tests";
const SESSION = "s".repeat(40);

globalThis.publicIntake = {
  db: db.client,
  audits: [],
  emails: [],
  emailResult: { ok: true },
};

const site = () => ({
  id: "site-1",
  tenant_id: "company-1",
  name: "A to Z",
  platform: "wordpress",
  status: "active",
  active: true,
  domain: null,
  site_key: SITE_KEY,
  webhook_secret: SECRET,
});

beforeEach(() => {
  db.reset({
    lead_sites: [site()],
    contacts: [],
    conversations: [],
    messages: [],
    leads: [],
    lead_routing_rules: [],
    contact_identities: [],
    webhook_dedup: [],
    api_keys: [],
    bot_settings: [],
  });
  // webhook_dedup's primary key is what makes "process this once" safe when two
  // copies of a delivery arrive together.
  db.unique("webhook_dedup", ["event_source", "event_id"]);
  globalThis.publicIntake.audits = [];
});

const chat = (body) =>
  widgetRoute.options.server.handlers.POST({
    request: new Request("https://flas.mobidigisol.com/api/public/widget/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ siteKey: SITE_KEY, sessionId: SESSION, ...body }),
    }),
  });

const collect = (body) =>
  collectRoute.options.server.handlers.POST({
    request: new Request("https://flas.mobidigisol.com/api/public/leads/collect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ siteKey: SITE_KEY, ...body }),
    }),
  });

const postWebhook = (route, rawBody, headers = {}) =>
  route.options.server.handlers.POST({
    request: new Request("https://flas.mobidigisol.com/api/public/webhooks/x", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-flash-site-key": SITE_KEY,
        "x-flash-signature": createHmac("sha256", SECRET).update(rawBody, "utf8").digest("hex"),
        ...headers,
      },
      body: rawBody,
    }),
  });

describe("a website visitor may describe themselves, not somebody else", () => {
  const realCustomer = () => ({
    id: "contact-real",
    tenant_id: "company-1",
    name: "Angelina",
    phone: "+971500000000",
    email: "angelina@real.example",
    consent_given: false,
    created_at: secondsAgo(86400),
  });

  it("does not let a visitor replace an existing customer's email", async () => {
    // Reported: identity was written to whichever contact had this phone
    // number, so typing someone else's number rewrote their record.
    db.table("contacts").push(realCustomer());
    const response = await chat({
      message: "hello",
      phone: "+971500000000",
      email: "attacker@evil.example",
    });
    assert.equal(response.status, 200);
    assert.equal(db.table("contacts")[0].email, "angelina@real.example");
  });

  it("does not let a visitor record marketing consent for an existing customer", async () => {
    db.table("contacts").push(realCustomer());
    await chat({ message: "hello", phone: "+971500000000", marketingConsent: true });
    assert.equal(db.table("contacts")[0].consent_given, false);
    assert.equal(db.table("contacts")[0].consent_at, undefined);
  });

  it("does not let a visitor rename an existing customer", async () => {
    db.table("contacts").push(realCustomer());
    await chat({ message: "hello", phone: "+971500000000", name: "Not Angelina" });
    assert.equal(db.table("contacts")[0].name, "Angelina");
  });

  it("records the refused claim so the team can see it was attempted", async () => {
    db.table("contacts").push(realCustomer());
    await chat({ message: "hello", phone: "+971500000000", marketingConsent: true });
    const claim = globalThis.publicIntake.audits.find(
      (a) => a.action === "widget.identity_claim_ignored",
    );
    assert.ok(claim, "the ignored identity claim must be recorded");
    assert.equal(claim.details.marketingConsent, true);
  });

  it("still saves a new visitor's own email and consent, with evidence", async () => {
    // Guards the fix from breaking the case it exists for: a genuinely new
    // visitor filling in the widget's own form.
    const response = await chat({
      message: "I would like a quote",
      phone: "+971511111111",
      email: "new@visitor.example",
      marketingConsent: true,
      name: "New Visitor",
    });
    assert.equal(response.status, 200);
    const contact = db.table("contacts").at(-1);
    assert.equal(contact.email, "new@visitor.example");
    assert.equal(contact.consent_given, true);
    const consent = globalThis.publicIntake.audits.find((a) => a.action === "consent.capture");
    assert.ok(consent, "recorded consent must leave an audit entry");
    assert.equal(consent.details.source, "website widget");
  });
});

describe("the widget cannot be used as a free AI endpoint", () => {
  it("turns away a session that is being hammered", async () => {
    db.table("conversations").push({
      id: "conv-1",
      tenant_id: "company-1",
      channel: "web",
      web_session_id: SESSION,
      created_at: secondsAgo(120),
      bot_enabled: true,
    });
    for (let i = 0; i < WIDGET_MESSAGES_PER_MINUTE; i += 1) {
      db.table("messages").push({
        id: `m-${i}`,
        conversation_id: "conv-1",
        created_at: secondsAgo(10),
      });
    }
    const response = await chat({ message: "again" });
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "60");
    assert.match((await response.json()).error, /Too many messages/);
  });

  it("turns away a bot that uses a fresh session id every time", async () => {
    for (let i = 0; i < WIDGET_NEW_SESSIONS_PER_5_MIN; i += 1) {
      db.table("conversations").push({
        id: `conv-${i}`,
        tenant_id: "company-1",
        channel: "web",
        web_session_id: `other-session-${i}`,
        created_at: secondsAgo(30),
      });
    }
    const response = await chat({ message: "hello" });
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "300");
  });

  it("lets an ordinary visitor through", async () => {
    const response = await chat({ message: "hello" });
    assert.equal(response.status, 200);
  });

  it("does not count another workspace's chats against this one", async () => {
    for (let i = 0; i < WIDGET_NEW_SESSIONS_PER_5_MIN + 5; i += 1) {
      db.table("conversations").push({
        id: `other-${i}`,
        tenant_id: "company-2",
        channel: "web",
        web_session_id: `x-${i}`,
        created_at: secondsAgo(30),
      });
    }
    assert.equal((await chat({ message: "hello" })).status, 200);
  });
});

describe("public lead collection has a ceiling", () => {
  const seedLeads = (count, at) => {
    for (let i = 0; i < count; i += 1) {
      db.table("leads").push({
        id: `lead-${i}`,
        tenant_id: "company-1",
        site_id: "site-1",
        email: `x${i}@spam.example`,
        created_at: at,
      });
    }
  };

  it("accepts an ordinary submission", async () => {
    const response = await collect({ email: "buyer@example.com", consent: true });
    assert.equal(response.status, 200);
    assert.equal(db.table("leads").length, 1);
  });

  it("turns away a site flooding leads this minute", async () => {
    seedLeads(LEADS_PER_MINUTE_PER_SITE, secondsAgo(10));
    const response = await collect({ email: "one-more@spam.example" });
    assert.equal(response.status, 429);
    assert.match(response.headers.get("retry-after"), /^\d+$/);
    assert.equal(db.table("leads").length, LEADS_PER_MINUTE_PER_SITE);
  });

  it("does not count yesterday's leads against today's limit", async () => {
    seedLeads(LEADS_PER_MINUTE_PER_SITE, secondsAgo(86400));
    assert.equal((await collect({ email: "buyer@example.com" })).status, 200);
  });
});

describe("a captured webhook delivery cannot be replayed", () => {
  const body = JSON.stringify({ email: "lead@shop.example", name: "Lead", consent: true });

  it("processes the same signed delivery once, however many times it arrives", async () => {
    // HMAC proves who sent a body, not that it is the first time it arrived.
    const first = await postWebhook(wordpressRoute, body);
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { ok: true });

    const again = await postWebhook(wordpressRoute, body);
    assert.equal(again.status, 200);
    assert.deepEqual(await again.json(), { ok: true, duplicate: true });

    assert.equal(db.table("leads").length, 1);
    assert.equal(db.table("webhook_dedup").length, 1);
  });

  it("still accepts a different lead from the same site", async () => {
    await postWebhook(wordpressRoute, body);
    const other = JSON.stringify({ email: "second@shop.example", consent: false });
    const response = await postWebhook(wordpressRoute, other);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(db.table("leads").length, 2);
  });

  it("recognises a replay whatever delivery id is sent in its headers", async () => {
    // The signature covers the body and nothing else, so a header naming the
    // delivery is only the sender's word. It used to be believed in preference
    // to the body, and a captured request went through again every time it was
    // replayed with a new id.
    const first = await postWebhook(shopifyRoute, body, {
      "x-shopify-webhook-id": "shopify-delivery-000001",
    });
    assert.deepEqual(await first.json(), { ok: true });

    for (const header of ["x-shopify-webhook-id", "x-flas-event-id", "x-flash-event-id"]) {
      const replay = await postWebhook(shopifyRoute, body, { [header]: `rotated-${header}` });
      assert.equal(replay.status, 200, header);
      assert.deepEqual(await replay.json(), { ok: true, duplicate: true }, header);
    }
    assert.equal(db.table("webhook_dedup").length, 1);
    assert.equal(
      globalThis.publicIntake.audits.filter((a) => a.action === "webhook.platform_lead").length,
      1,
      "the lead was taken in once",
    );
  });

  it("does not let a delivery id in a header make two different leads count as one", async () => {
    // The other half of the same rule. What was signed decides what a delivery
    // is, so a repeated id cannot make a second, different lead disappear.
    const headers = { "x-shopify-webhook-id": "shopify-delivery-123456" };
    await postWebhook(shopifyRoute, body, headers);
    const second = await postWebhook(
      shopifyRoute,
      JSON.stringify({ email: "second@shop.example", name: "Second", consent: true }),
      headers,
    );
    assert.deepEqual(await second.json(), { ok: true });
    assert.equal(db.table("leads").length, 2);
  });

  it("refuses a body whose signature does not match, before remembering it", async () => {
    const response = await wordpressRoute.options.server.handlers.POST({
      request: new Request("https://flas.mobidigisol.com/api/public/webhooks/wordpress", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-flash-site-key": SITE_KEY,
          "x-flash-signature": "0".repeat(64),
        },
        body,
      }),
    });
    assert.equal(response.status, 401);
    assert.equal(db.table("webhook_dedup").length, 0);
  });
});

describe("an API key's last-use stamp is not rewritten on every call", () => {
  const key = "flas_" + "a".repeat(48);
  const request = () =>
    new Request("https://flas.mobidigisol.com/api/public/v1/contacts", {
      headers: { authorization: `Bearer ${key}` },
    });

  const seed = (lastUsedAt) => {
    db.table("api_keys").push({
      id: "key-1",
      tenant_id: "company-1",
      scopes: ["contacts:read"],
      revoked_at: null,
      last_used_at: lastUsedAt,
      key_hash: createHash("sha256").update(key).digest("hex"),
    });
  };

  it("leaves a stamp from a moment ago alone", async () => {
    const fresh = secondsAgo(30);
    seed(fresh);
    const auth = await authenticateApiKey(request());
    assert.equal(auth?.tenantId, "company-1");
    assert.equal(db.table("api_keys")[0].last_used_at, fresh);
  });

  it("refreshes a stamp that is genuinely old", async () => {
    const old = secondsAgo(3600);
    seed(old);
    await authenticateApiKey(request());
    assert.notEqual(db.table("api_keys")[0].last_used_at, old);
  });

  it("records the first use of a brand-new key", async () => {
    seed(null);
    await authenticateApiKey(request());
    assert.ok(db.table("api_keys")[0].last_used_at);
  });
});
