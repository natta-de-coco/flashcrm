// Abuse controls on the endpoints a site key alone can reach: who a website
// visitor is allowed to say they are, how often a public endpoint may be used,
// and whether a captured webhook delivery can be sent again.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { createDb, secondsAgo } from "./support/db-double.mjs";
import { Route as widgetRoute } from "../node_modules/.cache/flas-widget-chat.mjs";
import { Route as collectRoute } from "../node_modules/.cache/flas-leads-collect.mjs";
import { Route as wordpressRoute } from "../node_modules/.cache/flas-webhook-wordpress.mjs";
import { Route as shopifyRoute } from "../node_modules/.cache/flas-webhook-shopify.mjs";
import { Route as customRoute } from "../node_modules/.cache/flas-webhook-custom.mjs";
import { authenticateApiKey } from "../node_modules/.cache/flas-api-keys.mjs";
import {
  LEADS_PER_HOUR_PER_SITE,
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

/** Time passing: every row the database holds becomes this many seconds older. */
const timePasses = (seconds) => {
  for (const rows of Object.values(db.state.rows)) {
    for (const row of rows) {
      if (!row.created_at) continue;
      row.created_at = new Date(Date.parse(row.created_at) - seconds * 1000).toISOString();
    }
  }
};

/** How many rows the database holds, in every table. */
const totalRows = () => Object.values(db.state.rows).reduce((sum, rows) => sum + rows.length, 0);

/**
 * Runs a request whose failure the server logs, keeping what it logged: the
 * output stays readable, and a test can check that a failure was not silent.
 */
async function logged(run) {
  const realError = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args.map(String).join(" "));
  try {
    return { response: await run(), lines };
  } finally {
    console.error = realError;
  }
}

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

describe("the widget does not answer when its limits cannot be checked", () => {
  // "Could not count" used to mean "let it through": for as long as the
  // database was struggling, the limits on a free AI endpoint were off.
  const hammered = () =>
    db.table("conversations").push({
      id: "conv-1",
      tenant_id: "company-1",
      channel: "web",
      web_session_id: SESSION,
      created_at: secondsAgo(120),
      bot_enabled: true,
    });

  // The double can refuse one kind of read on a table and not another: looking
  // a session up reads one row, counting new sessions counts them.
  const timeout = { message: "statement timeout" };
  const lookupFails = (query) => (query.counting ? null : timeout);
  const countFails = (query) => (query.counting ? timeout : null);

  it("turns a message away when the session cannot be looked up", async () => {
    // Unchecked, a failed lookup read as "a new visitor".
    db.fail("conversations:read", lookupFails);
    const { response, lines } = await logged(() => chat({ message: "hello" }));
    assert.equal(response.status, 503);
    assert.match(response.headers.get("retry-after"), /^\d+$/);
    assert.equal(db.table("messages").length, 0);
    assert.ok(lines.length > 0, "the failure is logged, not silent");
  });

  it("turns a message away when new sessions cannot be counted", async () => {
    db.fail("conversations:read", countFails);
    const { response } = await logged(() => chat({ message: "hello" }));
    assert.equal(response.status, 503);
    assert.equal(db.table("conversations").length, 0);
    assert.equal(db.table("messages").length, 0);
  });

  it("turns a message away when the session's messages cannot be counted", async () => {
    hammered();
    db.fail("messages:read", { message: "statement timeout" });
    const { response } = await logged(() => chat({ message: "hello" }));
    assert.equal(response.status, 503);
    assert.equal(db.table("messages").length, 0);
  });

  it("answers again once the database does", async () => {
    db.fail("conversations:read", { message: "statement timeout" });
    assert.equal((await logged(() => chat({ message: "hello" }))).response.status, 503);
    db.recover("conversations:read");
    assert.equal((await chat({ message: "hello" })).status, 200);
  });
});

describe("public lead collection has a ceiling", () => {
  /** Sends this many submissions, one after another, and expects each to be accepted. */
  const submit = async (count, body = (i) => ({ email: `x${i}@visitor.example` })) => {
    for (let i = 0; i < count; i += 1) {
      const response = await collect(body(i));
      assert.equal(response.status, 200, `submission ${i + 1} of ${count}`);
    }
  };

  it("accepts an ordinary submission", async () => {
    const response = await collect({ email: "buyer@example.com", consent: true });
    assert.equal(response.status, 200);
    assert.equal(db.table("leads").length, 1);
  });

  it("turns away a site flooding leads this minute", async () => {
    await submit(LEADS_PER_MINUTE_PER_SITE);
    const response = await collect({ email: "one-more@spam.example" });
    assert.equal(response.status, 429);
    assert.match(response.headers.get("retry-after"), /^\d+$/);
    assert.equal(db.table("leads").length, LEADS_PER_MINUTE_PER_SITE);
  });

  it("counts every submission, not every different email address", async () => {
    // Reported: the limit counted rows in leads, and one email address only
    // ever has one row there. The same address could be submitted for ever,
    // each time writing to the contact, the lead and the audit log.
    await submit(LEADS_PER_MINUTE_PER_SITE, (i) => ({
      email: "same@visitor.example",
      name: `Name ${i}`,
    }));
    assert.equal(db.table("leads").length, 1);

    const response = await collect({ email: "same@visitor.example", name: "One too many" });
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "60");
    assert.notEqual(db.table("leads")[0].name, "One too many");
  });

  it("counts webhook deliveries for one email address the same way", async () => {
    const delivery = (i) => JSON.stringify({ email: "same@shop.example", name: `Name ${i}` });
    for (let i = 0; i < LEADS_PER_MINUTE_PER_SITE; i += 1) {
      const response = await postWebhook(wordpressRoute, delivery(i));
      assert.equal(response.status, 200, `delivery ${i + 1}`);
    }
    const response = await postWebhook(wordpressRoute, delivery("one too many"));
    assert.equal(response.status, 429);
    assert.equal(db.table("leads").length, 1);
  });

  it("applies the hourly limit to one address submitted again and again", async () => {
    // Slowly enough to stay under the minute limit, for as long as it takes.
    const rounds = LEADS_PER_HOUR_PER_SITE / LEADS_PER_MINUTE_PER_SITE;
    for (let round = 0; round < rounds; round += 1) {
      await submit(LEADS_PER_MINUTE_PER_SITE, () => ({ email: "same@visitor.example" }));
      timePasses(61);
    }
    const response = await collect({ email: "same@visitor.example" });
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "3600");
  });

  it("does not count yesterday's submissions against today's limit", async () => {
    await submit(LEADS_PER_MINUTE_PER_SITE);
    timePasses(86400);
    assert.equal((await collect({ email: "buyer@example.com" })).status, 200);
  });

  it("does not count another site's submissions against this one", async () => {
    db.table("lead_sites").push(
      { ...site(), id: "site-2", site_key: "site-key-public-0002" },
      { ...site(), id: "site-3", site_key: "site-key-public-0003", tenant_id: "company-2" },
    );
    await submit(LEADS_PER_MINUTE_PER_SITE);
    assert.equal((await collect({ email: "one-more@visitor.example" })).status, 429);
    for (const siteKey of ["site-key-public-0002", "site-key-public-0003"]) {
      const response = await collect({ siteKey, email: "buyer@example.com" });
      assert.equal(response.status, 200, siteKey);
    }
  });

  it("writes nothing for a submission it turns away", async () => {
    // Counting submissions means recording them. A flood that is already
    // being refused must not be able to fill the database with those records.
    await submit(LEADS_PER_MINUTE_PER_SITE);
    const rowsBefore = totalRows();
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await collect({ email: `flood${i}@spam.example` })).status, 429);
    }
    assert.equal(totalRows(), rowsBefore);
  });

  it("does not accept a submission it could not count", async () => {
    // A submission that leaves no record is one the limit can never see.
    db.fail("audit_log:insert", { message: "connection reset" });
    const { response, lines } = await logged(() => collect({ email: "buyer@example.com" }));
    assert.equal(response.status, 503);
    assert.match(response.headers.get("retry-after"), /^\d+$/);
    assert.equal(db.table("leads").length, 0);
    assert.ok(lines.length > 0, "the failure is logged, not silent");

    db.recover("audit_log:insert");
    assert.equal((await collect({ email: "buyer@example.com" })).status, 200);
  });
});

describe("requests that arrive together cannot all slip under a lead limit", () => {
  // Reported: every request counted first and wrote later, so requests arriving
  // together all saw the same count and all went through, however many there
  // were. Each one now records itself before it counts, and counts itself.
  const together = (count, send) => Promise.all(Array.from({ length: count }, (_, i) => send(i)));

  it("does not accept more than the limit from a burst of form submissions", async () => {
    const responses = await together(LEADS_PER_MINUTE_PER_SITE * 2, (i) =>
      collect({ email: `burst${i}@visitor.example` }),
    );
    const accepted = responses.filter((r) => r.status === 200).length;
    assert.ok(accepted <= LEADS_PER_MINUTE_PER_SITE, `${accepted} were accepted`);
    assert.equal(db.table("leads").length, accepted);
    for (const r of responses) assert.ok(r.status === 200 || r.status === 429, String(r.status));
  });

  it("does not accept more than the limit from a burst of webhook deliveries", async () => {
    const responses = await together(LEADS_PER_MINUTE_PER_SITE * 2, (i) =>
      postWebhook(wordpressRoute, JSON.stringify({ email: `burst${i}@shop.example` })),
    );
    const accepted = responses.filter((r) => r.status === 200).length;
    assert.ok(accepted <= LEADS_PER_MINUTE_PER_SITE, `${accepted} were accepted`);
    assert.equal(db.table("leads").length, accepted);
    // A delivery that was turned away can be sent again: its claim is not kept.
    assert.equal(db.table("webhook_dedup").length, accepted);
  });

  it("still accepts a burst that fits within the limit", async () => {
    // Counting itself must not make a request refuse what is allowed.
    const responses = await together(LEADS_PER_MINUTE_PER_SITE, (i) =>
      collect({ email: `burst${i}@visitor.example` }),
    );
    assert.deepEqual(
      responses.map((r) => r.status),
      Array(LEADS_PER_MINUTE_PER_SITE).fill(200),
    );
  });

  it("does not accept a submission when the limit cannot be counted", async () => {
    // "Could not count" used to mean "let it through".
    db.fail("audit_log:read", { message: "statement timeout" });
    const { response, lines } = await logged(() => collect({ email: "buyer@example.com" }));
    assert.equal(response.status, 503);
    assert.match(response.headers.get("retry-after"), /^\d+$/);
    assert.equal(db.table("leads").length, 0);
    assert.ok(lines.length > 0, "the failure is logged, not silent");

    db.recover("audit_log:read");
    assert.equal((await collect({ email: "buyer@example.com" })).status, 200);
  });

  it("asks a webhook delivery to come back when the limit cannot be counted, and takes it then", async () => {
    const delivery = JSON.stringify({ email: "lead@shop.example", name: "Lead" });
    db.fail("audit_log:read", { message: "statement timeout" });
    const { response } = await logged(() => postWebhook(wordpressRoute, delivery));
    assert.equal(response.status, 503);
    assert.match(response.headers.get("retry-after"), /^\d+$/);
    assert.equal(db.table("leads").length, 0);
    assert.equal(db.table("webhook_dedup").length, 0, "the claim was given back");

    db.recover("audit_log:read");
    const retry = await postWebhook(wordpressRoute, delivery);
    assert.deepEqual(await retry.json(), { ok: true });
    assert.equal(db.table("leads").length, 1);
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

describe("a delivery that was not finished can be sent again", () => {
  // Reported: a delivery was remembered as seen before anything had been done
  // with it. When the site was then told to slow down, or the lead could not be
  // saved, the provider's retry was answered "duplicate" and the lead was gone.
  const body = JSON.stringify({ email: "lead@shop.example", name: "Lead", consent: true });
  const routes = { wordpress: wordpressRoute, shopify: shopifyRoute, custom: customRoute };
  const taken = () =>
    globalThis.publicIntake.audits.filter((a) => a.action === "webhook.platform_lead").length;

  for (const [platform, route] of Object.entries(routes)) {
    it(`saves the lead when ${platform} retries after a failed save`, async () => {
      db.fail("leads:upsert", { message: "connection reset" });
      const { response: failed } = await logged(() => postWebhook(route, body));
      assert.equal(failed.status, 500);
      assert.equal(db.table("leads").length, 0);
      assert.equal(db.table("webhook_dedup").length, 0, "the claim was given back");

      // The database recovers and the provider sends the delivery again.
      db.recover("leads:upsert");
      const retry = await postWebhook(route, body);
      assert.equal(retry.status, 200);
      assert.deepEqual(await retry.json(), { ok: true });
      assert.equal(db.table("leads").length, 1);

      // Now that it is done, one more copy is a repeat.
      const again = await postWebhook(route, body);
      assert.deepEqual(await again.json(), { ok: true, duplicate: true });
      assert.equal(taken(), 1);
    });
  }

  it("saves the lead when the provider retries after being told to slow down", async () => {
    // A busy minute on the same site uses the limit up.
    for (let i = 0; i < LEADS_PER_MINUTE_PER_SITE; i += 1) {
      assert.equal((await collect({ email: `x${i}@busy.example` })).status, 200);
    }
    const limited = await postWebhook(wordpressRoute, body);
    assert.equal(limited.status, 429);
    assert.match(limited.headers.get("retry-after"), /^\d+$/);
    assert.equal(db.table("webhook_dedup").length, 0, "the claim was given back");

    // The minute passes and the provider sends the delivery again.
    timePasses(61);
    const retry = await postWebhook(wordpressRoute, body);
    assert.equal(retry.status, 200);
    assert.deepEqual(await retry.json(), { ok: true });
    assert.equal(taken(), 1);
  });

  it("still does the work once when two copies arrive at the same moment", async () => {
    // What the claim is for, and what giving it back must not undo.
    const answers = await Promise.all(
      [postWebhook(wordpressRoute, body), postWebhook(wordpressRoute, body)].map(async (r) =>
        (await r).json(),
      ),
    );
    assert.equal(answers.filter((a) => a.duplicate === true).length, 1);
    assert.equal(taken(), 1);
    assert.equal(db.table("leads").length, 1);
  });

  it("does not take a delivery in when it cannot be remembered", async () => {
    // A database error is not "go ahead": without the claim nothing stops the
    // same delivery being taken in twice, so the sender is asked to try again.
    db.fail("webhook_dedup:insert", { code: "57014", message: "statement timeout" });
    const { response, lines } = await logged(() => postWebhook(wordpressRoute, body));
    assert.equal(response.status, 503);
    assert.match(response.headers.get("retry-after"), /^\d+$/);
    assert.equal(db.table("leads").length, 0);
    assert.equal(taken(), 0);
    assert.ok(lines.length > 0, "the failure is logged, not silent");

    db.recover("webhook_dedup:insert");
    const retry = await postWebhook(wordpressRoute, body);
    assert.deepEqual(await retry.json(), { ok: true });
    assert.equal(db.table("leads").length, 1);
  });

  it("says so when a claim cannot be given back", async () => {
    // The live database may refuse the delete. That must be visible in the
    // logs, and the answer must still be the failure it was.
    db.fail("leads:upsert", { message: "connection reset" });
    db.fail("webhook_dedup:delete", { code: "42501", message: "permission denied" });
    const { response, lines } = await logged(() => postWebhook(wordpressRoute, body));
    assert.equal(response.status, 500);
    assert.ok(
      lines.some((line) => /could not give back/i.test(line)),
      `the stuck claim is logged: ${lines.join(" | ")}`,
    );
  });

  it("refuses a delivery with no email address as invalid, every time", async () => {
    // It can never be saved, so it is not a failure to retry and not a repeat:
    // it used to be answered 500 and then, on the retry, "duplicate".
    const nameless = JSON.stringify({ name: "No Email", phone: "+971500000001" });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await postWebhook(customRoute, nameless);
      assert.equal(response.status, 400, `attempt ${attempt + 1}`);
      assert.match((await response.json()).error, /email address/i);
    }
    assert.equal(db.table("webhook_dedup").length, 0, "nothing was claimed");
    assert.equal(db.table("leads").length, 0);
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

describe("the website popup's chat messages reach the chat endpoint", () => {
  // Reported: the popup made a session id of about 23 characters, the endpoint
  // requires 32, and so every chat message from the popup was refused -- while
  // the popup told the visitor a team member would reply shortly.
  const popupSource = readFileSync(new URL("../public/flas-popup.js", import.meta.url), "utf8");
  const storeKey = `flas_popup_${SITE_KEY}`;

  /**
   * Runs the real popup script in a page that has just enough of a browser for
   * it, with its chat requests answered by the real chat endpoint.
   */
  function openPopup({ stored, page = {} } = {}) {
    const storage = new Map(stored ? [[storeKey, JSON.stringify(stored)]] : []);
    const chatRequests = [];
    const inFlight = [];
    const element = () => {
      const el = {
        style: {},
        value: "",
        textContent: "",
        checked: true,
        children: [],
        found: {},
        handlers: {},
        classList: { add() {}, remove() {} },
        get childElementCount() {
          return el.children.length;
        },
        appendChild(child) {
          el.children.push(child);
          return child;
        },
        addEventListener(type, handler) {
          el.handlers[type] = handler;
        },
        querySelector(selector) {
          return (el.found[selector] ??= element());
        },
      };
      return el;
    };
    const elements = [];
    const fetch = (url, init) => {
      const answer = url.endsWith("/api/public/widget/chat")
        ? widgetRoute.options.server.handlers
            .POST({ request: new Request(url, { method: "POST", body: init.body }) })
            .then((response) => {
              chatRequests.push({ body: JSON.parse(init.body), status: response.status });
              return response;
            })
        : Promise.resolve(new Response("{}", { status: 200 }));
      inFlight.push(answer);
      return answer;
    };
    vm.runInNewContext(popupSource, {
      document: {
        currentScript: {
          src: "https://flas.mobidigisol.com/flas-popup.js",
          getAttribute: (name) => (name === "data-site-key" ? SITE_KEY : null),
        },
        createElement: () => {
          const el = element();
          elements.push(el);
          return el;
        },
        head: element(),
        body: element(),
      },
      window: { location: { origin: "https://shop.example", href: "https://shop.example/" } },
      localStorage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, String(value)),
      },
      fetch,
      URL,
      ...page,
    });
    // The popup's own root is the element it asked for its parts.
    const root = elements.find((el) => el.found[".flasp-foot"]);
    return {
      chatRequests,
      saved: () => JSON.parse(storage.get(storeKey) ?? "{}"),
      /** Types a message, sends it, and returns what the visitor is then shown. */
      async say(text) {
        root.found[".flasp-input"].value = text;
        root.found[".flasp-foot"].handlers.submit({ preventDefault() {} });
        await Promise.all(inFlight);
        await new Promise((resolve) => setImmediate(resolve));
        return root.found[".flasp-body"].children.at(-1).textContent;
      },
    };
  }

  const returning = (sessionId) => ({ sessionId, captured: true, name: "Sara", pinged: true });

  it("a new visitor's message is accepted", async () => {
    const popup = openPopup();
    const shown = await popup.say("Do you deliver to Sharjah?");
    assert.equal(popup.chatRequests.length, 1);
    assert.equal(popup.chatRequests[0].status, 200);
    assert.ok(popup.chatRequests[0].body.sessionId.length >= 32);
    assert.equal(popup.saved().sessionId, popup.chatRequests[0].body.sessionId);
    assert.doesNotMatch(shown, /couldn't send/);
  });

  it("a returning visitor whose saved id is too short gets a new one, and it is saved", async () => {
    // What the earlier version of this script left in every visitor's browser.
    const popup = openPopup({ stored: returning("web-k3j9x0a7q2lz8f1ab") });
    await popup.say("Hello again");
    assert.equal(popup.chatRequests[0].status, 200);
    const { sessionId } = popup.chatRequests[0].body;
    assert.ok(sessionId.length >= 32);
    assert.equal(popup.saved().sessionId, sessionId, "the next visit uses the same id");
    assert.equal(popup.saved().name, "Sara", "the rest of what was saved is kept");
  });

  it("a saved id that is already long enough is kept, so the conversation continues", async () => {
    const popup = openPopup({ stored: returning(SESSION) });
    await popup.say("Hello again");
    assert.equal(popup.chatRequests[0].body.sessionId, SESSION);
    assert.equal(popup.chatRequests[0].status, 200);
  });

  it("makes an id long enough even from the shortest random values, in an old browser", async () => {
    // 0.5 is "0.i" in base 36: one usable character per call, and no
    // crypto.getRandomValues to fall back on.
    const popup = openPopup({ page: { Math: { random: () => 0.5 } } });
    await popup.say("Hello");
    assert.equal(popup.chatRequests[0].status, 200);
    assert.ok(popup.chatRequests[0].body.sessionId.length >= 32);
    assert.ok(popup.chatRequests[0].body.sessionId.length <= 80);
  });

  it("takes the id from the browser's secure random source when there is one", async () => {
    const popup = openPopup({
      page: {
        window: {
          location: { origin: "https://shop.example", href: "https://shop.example/" },
          crypto: globalThis.crypto,
        },
      },
    });
    await popup.say("Hello");
    assert.equal(popup.chatRequests[0].status, 200);
    assert.match(popup.chatRequests[0].body.sessionId, /^web-[0-9a-f]{48}$/);
  });

  it("does not tell the visitor a refused message was sent", async () => {
    // The session is being hammered, so the endpoint answers 429.
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
    const popup = openPopup({ stored: returning(SESSION) });
    const shown = await popup.say("again");
    assert.equal(popup.chatRequests[0].status, 429);
    assert.match(shown, /couldn't send/);
    assert.doesNotMatch(shown, /will reply/);
  });
});
