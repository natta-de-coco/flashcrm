import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { Route } from "../node_modules/.cache/flas-payments-webhook.mjs";

// Paddle delivers an event again until it gets a 2xx. These tests drive the
// real route; only the signature check and the database are doubles.

let rows, faults, event;
// The Paddle environment each delivery's signature was checked against.
let verifiedAs = [];

class Query {
  constructor(table) {
    this.table = table;
    this.filters = [];
    this.mode = "read";
  }
  select() {
    return this;
  }
  eq(k, v) {
    this.filters.push((r) => r[k] === v);
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }
  update(patch) {
    this.mode = "update";
    this.patch = patch;
    return this;
  }
  upsert(payload, { onConflict } = {}) {
    this.mode = "upsert";
    this.payload = payload;
    this.conflict = onConflict;
    return this;
  }
  insert(payload) {
    this.mode = "insert";
    this.payload = payload;
    return this;
  }
  then(resolve, reject) {
    const fault = faults[`${this.table}:${this.mode}`];
    if (fault)
      return Promise.resolve({ data: null, error: { message: fault } }).then(resolve, reject);
    const table = (rows[this.table] ??= []);
    let found = table.filter((r) => this.filters.every((f) => f(r)));
    if (this.mode === "update") for (const r of found) Object.assign(r, this.patch);
    if (this.mode === "upsert") {
      const existing = table.find((r) => r[this.conflict] === this.payload[this.conflict]);
      if (existing) Object.assign(existing, this.payload);
      else table.push({ ...this.payload });
      found = [existing ?? table.at(-1)];
    }
    if (this.mode === "insert") {
      table.push({ ...this.payload });
      found = [table.at(-1)];
    }
    return Promise.resolve({
      data: this.single ? (found[0] ?? null) : found,
      error: null,
    }).then(resolve, reject);
  }
}

globalThis.paymentsWebhook = {
  db: { from: (table) => new Query(table) },
  verify: async (_request, env) => {
    verifiedAs.push(env);
    if (event instanceof Error) throw event;
    return event;
  },
  alerts: [],
};

beforeEach(() => {
  rows = {
    profiles: [{ id: "user-1", tenant_id: "company-1" }],
    organizations: [
      { id: "company-1", subscription_status: "trial", suspended: false, plan: "flash_monthly" },
    ],
  };
  faults = {};
  verifiedAs = [];
  globalThis.paymentsWebhook.alerts = [];
  process.env.PADDLE_ENV = "live";
});

async function deliver() {
  // The route logs each failure it reports; keep the test output readable.
  const realError = console.error;
  console.error = () => {};
  try {
    return await Route.options.server.handlers.POST({
      request: new Request("https://flas.example.test/api/public/payments/webhook", {
        method: "POST",
        body: "{}",
      }),
    });
  } finally {
    console.error = realError;
  }
}

const subscription = (overrides = {}) => ({
  id: "sub_1",
  customerId: "ctm_1",
  status: "active",
  createdAt: new Date().toISOString(),
  customData: { userId: "user-1" },
  currentBillingPeriod: { startsAt: "2026-09-18T00:00:00Z", endsAt: "2027-09-18T00:00:00Z" },
  items: [
    {
      price: { id: "pri_1", importMeta: { externalId: "flash_yearly" } },
      product: { id: "pro_1", importMeta: { externalId: "flash" } },
    },
  ],
  ...overrides,
});
const company = () => rows.organizations[0];

test("a paid subscription activates the company", async () => {
  event = { eventType: "subscription.created", data: subscription() };
  assert.equal((await deliver()).status, 200);
  assert.equal(company().subscription_status, "active");
  assert.equal(company().plan, "flash_yearly");
  assert.equal(rows.subscriptions.length, 1);
});

test("a payment that could not be saved is not acknowledged, and the retry activates the company", async () => {
  event = { eventType: "subscription.created", data: subscription() };
  faults["subscriptions:upsert"] = "connection reset";
  assert.equal((await deliver()).status, 500, "Paddle must deliver it again");
  assert.equal(company().subscription_status, "trial");
  const [alert] = globalThis.paymentsWebhook.alerts;
  assert.equal(alert.source, "billing");
  assert.equal(alert.severity, "critical");

  delete faults["subscriptions:upsert"];
  assert.equal((await deliver()).status, 200);
  assert.equal(company().subscription_status, "active");
});

test("a failed company update is not acknowledged either", async () => {
  event = { eventType: "subscription.created", data: subscription() };
  faults["organizations:update"] = "timeout";
  assert.equal((await deliver()).status, 500);
});

test("a failed subscriber lookup is not mistaken for 'no company'", async () => {
  event = { eventType: "subscription.created", data: subscription() };
  faults["profiles:read"] = "timeout";
  assert.equal((await deliver()).status, 500);
  assert.equal(company().subscription_status, "trial");
});

test("a change that arrives before its subscription is recorded is delivered again, then applied", async () => {
  const pastDue = { eventType: "subscription.updated", data: subscription({ status: "past_due" }) };
  event = pastDue;
  assert.equal((await deliver()).status, 500);

  event = { eventType: "subscription.created", data: subscription() };
  assert.equal((await deliver()).status, 200);
  event = pastDue; // Paddle's redelivery
  assert.equal((await deliver()).status, 200);
  assert.equal(company().subscription_status, "past_due");
});

test("a change for a subscription FLAS never recorded is acknowledged, not retried for days", async () => {
  event = { eventType: "subscription.updated", data: subscription({ customData: null }) };
  assert.equal((await deliver()).status, 200, "not started from FLAS checkout");
  event = {
    eventType: "subscription.canceled",
    data: subscription({ createdAt: "2025-01-01T00:00:00Z" }),
  };
  assert.equal((await deliver()).status, 200, "too old to be waiting for its creation");
  assert.equal(company().subscription_status, "trial");
});

test("cancelling suspends the company", async () => {
  event = { eventType: "subscription.created", data: subscription() };
  await deliver();
  event = { eventType: "subscription.canceled", data: subscription({ status: "canceled" }) };
  assert.equal((await deliver()).status, 200);
  assert.equal(company().subscription_status, "canceled");
  assert.equal(company().suspended, true);
});

test("a failed renewal marks the company past due, and a failed write is retried", async () => {
  event = { eventType: "subscription.created", data: subscription() };
  await deliver();
  event = { eventType: "transaction.payment_failed", data: { subscriptionId: "sub_1" } };
  faults["organizations:update"] = "timeout";
  assert.equal((await deliver()).status, 500);
  delete faults["organizations:update"];
  assert.equal((await deliver()).status, 200);
  assert.equal(company().subscription_status, "past_due");
});

test("an event with a bad signature is refused with 400 and raises no billing alert", async () => {
  event = new Error("Invalid signature");
  assert.equal((await deliver()).status, 400);
  assert.equal(globalThis.paymentsWebhook.alerts.length, 0);
});

// .env.example tells a deployment to set PADDLE_ENV to "sandbox" or
// "production". Only the literal "live" used to count as live, so a deployment
// that followed the instructions had its live deliveries checked against the
// sandbox secret: every one failed, and paid subscriptions stopped syncing.
for (const [setting, expected] of [
  ["production", "live"],
  ["Production", "live"],
  ["live", "live"],
  ["LIVE", "live"],
  [" production ", "live"],
  ["sandbox", "sandbox"],
  ["", "sandbox"],
  [undefined, "sandbox"],
  // Anything not recognised must never be treated as live.
  ["prod", "sandbox"],
  ["staging", "sandbox"],
]) {
  test(`PADDLE_ENV ${JSON.stringify(setting) ?? "unset"} checks a delivery against the ${expected} secret`, async () => {
    if (setting === undefined) delete process.env.PADDLE_ENV;
    else process.env.PADDLE_ENV = setting;
    event = { eventType: "subscription.created", data: subscription() };
    assert.equal((await deliver()).status, 200);
    assert.deepEqual(verifiedAs, [expected]);
    assert.equal(rows.subscriptions[0].environment, expected);
  });
}
