import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import Stripe from "stripe";
import {
  resolveStripeLineItem,
  syncStripeOrganization,
  recordStripeSubscriptionInvoice,
  walkTestSubscriptionFlow,
  handleStripeWebhook,
} from "../node_modules/.cache/flas-stripe.mjs";

process.env.NODE_ENV = "test";
process.env.STRIPE_SECRET_KEY = "sk_test_mock_secret_key_123";
const TEST_WEBHOOK_SECRET = "whsec_test_secret_stripe_999";
process.env.STRIPE_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;

const stripeHelper = new Stripe("sk_test_mock_secret_key_123");

function makeSignedRequest(payload, secret = TEST_WEBHOOK_SECRET) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const sig = stripeHelper.webhooks.generateTestHeaderString({
    payload: body,
    secret,
  });
  return new Request("https://flas.mobidigisol.com/api/public/payments/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "stripe-signature": sig,
    },
    body,
  });
}

let rows = {};

// In-memory Supabase Admin double for unit testing
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
  filter(field, op, val) {
    if (field.includes("stripe_invoice_id")) {
      this.filters.push((r) => r.custom_fields?.stripe_invoice_id === val);
    }
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }
  single() {
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
    const table = (rows[this.table] ??= []);
    let found = table.filter((r) => this.filters.every((f) => f(r)));

    if (this.mode === "update") {
      for (const r of found) Object.assign(r, this.patch);
    }
    if (this.mode === "upsert") {
      const existing = table.find((r) => r[this.conflict] === this.payload[this.conflict]);
      if (existing) Object.assign(existing, this.payload);
      else table.push({ ...this.payload });
      found = [existing ?? table.at(-1)];
    }
    if (this.mode === "insert") {
      const row = { id: `doc_${table.length + 1}`, ...this.payload };
      table.push(row);
      found = [row];
    }

    return Promise.resolve({
      data: this.single ? (found[0] ?? null) : found,
      error: null,
    }).then(resolve, reject);
  }
}

describe("Stripe Checkout & Billing Integration", () => {
  beforeEach(() => {
    rows = {
      organizations: [
        {
          id: "tenant-1",
          name: "Acme Corp",
          subscription_status: "trial",
          plan: "flash_monthly",
          suspended: false,
          billing_provider: "stripe",
        },
      ],
      profiles: [
        {
          id: "user-1",
          tenant_id: "tenant-1",
        },
      ],
      subscriptions: [],
      sales_documents: [],
      sales_document_items: [],
    };

    // Mock client.server for tests
    globalThis.paymentsWebhook = {
      db: { from: (table) => new Query(table) },
      alerts: [],
    };
  });

  it("resolves monthly and yearly line items with correct recurring intervals and amounts", () => {
    const monthlyItem = resolveStripeLineItem("flash_monthly");
    assert.equal(monthlyItem.quantity, 1);
    assert.equal(monthlyItem.price_data?.recurring?.interval, "month");
    assert.equal(monthlyItem.price_data?.unit_amount, 4900);

    const yearlyItem = resolveStripeLineItem("flash_yearly");
    assert.equal(yearlyItem.quantity, 1);
    assert.equal(yearlyItem.price_data?.recurring?.interval, "year");
    assert.equal(yearlyItem.price_data?.unit_amount, 49000);
  });

  it("synchronizes tenant organization status and renewal date when subscription updates", async () => {
    await syncStripeOrganization({
      tenantId: "tenant-1",
      status: "active",
      plan: "flash_yearly",
      customerId: "cus_123",
      subscriptionId: "sub_123",
      periodEnd: "2027-10-08T00:00:00Z",
    });

    const org = rows.organizations.find((o) => o.id === "tenant-1");
    assert.equal(org.subscription_status, "active");
    assert.equal(org.plan, "flash_yearly");
    assert.equal(org.stripe_customer_id, "cus_123");
    assert.equal(org.stripe_subscription_id, "sub_123");
    assert.equal(org.subscription_renews_at, "2027-10-08T00:00:00Z");
    assert.equal(org.suspended, false);
  });

  it("records a paid subscription invoice into sales_documents and sales_document_items", async () => {
    const docId = await recordStripeSubscriptionInvoice({
      tenantId: "tenant-1",
      userId: "user-1",
      customerId: "cus_123",
      customerEmail: "admin@acme.test",
      customerName: "Acme Admin",
      stripeInvoiceId: "in_test_999",
      stripeSubscriptionId: "sub_123",
      amountPaid: 49,
      currency: "USD",
      planName: "Monthly Plan",
      invoiceNumber: "INV-2026-0099",
    });

    assert.ok(docId);
    const invoice = rows.sales_documents.find((d) => d.id === docId);
    assert.ok(invoice);
    assert.equal(invoice.kind, "invoice");
    assert.equal(invoice.status, "paid");
    assert.equal(invoice.balance, 0);
    assert.equal(invoice.grand_total, 49);
    assert.equal(invoice.paid_amount, 49);
    assert.equal(invoice.custom_fields?.stripe_invoice_id, "in_test_999");
    assert.equal(invoice.custom_fields?.provider, "stripe");

    const item = rows.sales_document_items.find((i) => i.document_id === docId);
    assert.ok(item);
    assert.equal(item.unit_price, 49);
    assert.equal(item.line_total, 49);
  });

  it("walks a test subscription from checkout to a saved invoice cleanly", async () => {
    const res = await walkTestSubscriptionFlow({
      tenantId: "tenant-1",
      userId: "user-1",
      userEmail: "admin@acme.test",
      plan: "flash_monthly",
    });

    assert.equal(res.ok, true);
    assert.ok(res.subscriptionId.startsWith("sub_test_"));
    assert.ok(res.customerId.startsWith("cus_test_"));
    assert.ok(res.salesDocumentId);
    assert.ok(res.docNumber);

    // Verify organization is now active
    const org = rows.organizations.find((o) => o.id === "tenant-1");
    assert.equal(org.subscription_status, "active");
    assert.equal(org.stripe_subscription_id, res.subscriptionId);

    // Verify invoice is saved in sales_documents
    const savedDoc = rows.sales_documents.find((d) => d.id === res.salesDocumentId);
    assert.ok(savedDoc);
    assert.equal(savedDoc.status, "paid");
    assert.equal(savedDoc.balance, 0);
  });

  it("rejects webhook without stripe-signature header with 400", async () => {
    const req = new Request("https://flas.mobidigisol.com/api/public/payments/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "checkout.session.completed" }),
    });

    const res = await handleStripeWebhook(req);
    assert.equal(res.status, 400);
    const text = await res.text();
    assert.match(text, /Missing stripe-signature header/);
  });

  it("rejects webhook with invalid or tampered signature with 400", async () => {
    const req = makeSignedRequest({ type: "checkout.session.completed" }, "whsec_wrong_signature_secret");
    const res = await handleStripeWebhook(req);
    assert.equal(res.status, 400);
    const text = await res.text();
    assert.match(text, /Webhook signature verification failed/);
  });

  it("fails closed with 500 when server STRIPE_WEBHOOK_SECRET is missing", async () => {
    const savedSecret = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    try {
      const req = new Request("https://flas.mobidigisol.com/api/public/payments/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "stripe-signature": "t=123,v1=abc",
        },
        body: JSON.stringify({ type: "checkout.session.completed" }),
      });
      const res = await handleStripeWebhook(req);
      assert.equal(res.status, 500);
      const text = await res.text();
      assert.match(text, /Stripe webhook secret not configured/);
    } finally {
      process.env.STRIPE_WEBHOOK_SECRET = savedSecret;
    }
  });

  it("handles verified checkout.session.completed webhook and activates subscription", async () => {
    const payload = {
      type: "checkout.session.completed",
      data: {
        object: {
          client_reference_id: "user-1",
          customer: "cus_checkout_1",
          subscription: "sub_checkout_1",
          metadata: { plan: "flash_yearly" },
          amount_total: 49000,
          currency: "usd",
          livemode: false,
        },
      },
    };

    const req = makeSignedRequest(payload);
    const res = await handleStripeWebhook(req);
    assert.equal(res.status, 200);

    const org = rows.organizations.find((o) => o.id === "tenant-1");
    assert.equal(org.subscription_status, "active");
    assert.equal(org.plan, "flash_yearly");
  });

  it("handles verified invoice.payment_succeeded webhook and creates a saved invoice", async () => {
    // Pre-insert subscription row
    rows.subscriptions.push({
      stripe_subscription_id: "sub_rec_1",
      user_id: "user-1",
      status: "active",
    });

    const payload = {
      type: "invoice.payment_succeeded",
      data: {
        object: {
          id: "in_rec_1",
          subscription: "sub_rec_1",
          customer: "cus_rec_1",
          amount_paid: 4900,
          total: 4900,
          currency: "usd",
          number: "INV-STRIPE-001",
          lines: {
            data: [
              {
                description: "Flas CRM Monthly",
                period: { end: Math.floor(Date.now() / 1000) + 30 * 86400 },
              },
            ],
          },
        },
      },
    };

    const req = makeSignedRequest(payload);
    const res = await handleStripeWebhook(req);
    assert.equal(res.status, 200);

    const saved = rows.sales_documents.find(
      (d) => d.custom_fields?.stripe_invoice_id === "in_rec_1",
    );
    assert.ok(saved);
    assert.equal(saved.status, "paid");
    assert.equal(saved.grand_total, 49);
  });
});
