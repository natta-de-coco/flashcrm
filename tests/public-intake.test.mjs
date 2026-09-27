// The requests nobody signs in for: a WhatsApp template send, a lead posted by
// a website, and a plugin activation link. Each test below is a defect a tester
// reproduced against the live site, so a failure names the symptom they saw.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { readFileSync } from "node:fs";

import { checkSendPermission } from "../node_modules/.cache/flas-safety.mjs";
import { ingestLead } from "../node_modules/.cache/flas-leads.mjs";
import { requestSiteActivation } from "../node_modules/.cache/flas-plugin-activation.mjs";
import { Route as activateRoute } from "../node_modules/.cache/flas-plugin-activate-route.mjs";

// Windows checkouts of this repo have CRLF line endings (core.autocrlf), so a
// pattern describing two lines of source would not match the very file it
// describes. The source is normalized here, once, not in every pattern below.
const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
    .split("\r\n")
    .join("\n");

let rows, faults, ids;

class Query {
  constructor(table) {
    this.table = table;
    this.filters = [];
    this.mode = "read";
  }
  select(_columns, options) {
    if (options?.count) this.counting = true;
    return this;
  }
  eq(key, value) {
    this.filters.push((r) => r[key] === value);
    return this;
  }
  gte(key, value) {
    this.filters.push((r) => String(r[key] ?? "") >= value);
    return this;
  }
  not(key, operator, value) {
    if (operator === "is" && value === null) this.filters.push((r) => r[key] != null);
    return this;
  }
  order() {
    return this;
  }
  limit(n) {
    this.take = n;
    return this;
  }
  maybeSingle() {
    this.one = true;
    return this;
  }
  single() {
    this.one = true;
    this.required = true;
    return this;
  }
  insert(payload) {
    this.mode = "insert";
    this.payload = payload;
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
    this.conflict = (onConflict ?? "id").split(",").map((k) => k.trim());
    return this;
  }
  then(resolve, reject) {
    const fault = faults[`${this.table}:${this.mode}`];
    if (fault) {
      return Promise.resolve({ data: null, error: { message: fault }, count: null }).then(
        resolve,
        reject,
      );
    }
    const table = (rows[this.table] ??= []);
    let found = table.filter((r) => this.filters.every((f) => f(r)));
    if (this.mode === "update") for (const r of found) Object.assign(r, this.patch);
    if (this.mode === "insert") {
      const row = { id: `${this.table}-${++ids}`, ...this.payload };
      table.push(row);
      found = [row];
    }
    if (this.mode === "upsert") {
      const existing = table.find((r) => this.conflict.every((k) => r[k] === this.payload[k]));
      if (existing) Object.assign(existing, this.payload);
      else table.push({ id: `${this.table}-${++ids}`, ...this.payload });
      found = [existing ?? table.at(-1)];
    }
    if (this.take) found = found.slice(0, this.take);
    const error = this.required && !found[0] ? { message: "no rows returned" } : null;
    return Promise.resolve({
      data: this.one ? (found[0] ?? null) : found,
      error,
      count: this.counting ? found.length : null,
    }).then(resolve, reject);
  }
}

globalThis.publicIntake = {
  db: { from: (table) => new Query(table) },
  audits: [],
  emails: [],
  emailResult: { ok: true },
};

beforeEach(() => {
  ids = 0;
  faults = {};
  rows = {
    organizations: [{ id: "company-1", suspended: false, subscription_status: "active" }],
    wa_numbers: [{ id: "num-1", label: "Sales line", active: true, tenant_id: "company-1" }],
    contacts: [],
    messages: [],
    leads: [],
    lead_routing_rules: [],
    lead_sites: [],
    audit_log: [],
  };
  globalThis.publicIntake.audits = [];
  globalThis.publicIntake.emails = [];
  globalThis.publicIntake.emailResult = { ok: true };
});

describe("a WhatsApp template needs recorded consent, whoever it is addressed to", () => {
  // Reported: a template sent to a typed-in number that is not in Contacts passed
  // every check, because the consent rule only ran when a contact existed.
  it("refuses a template to a number that is not a saved contact", async () => {
    const check = await checkSendPermission({ waNumberId: "num-1", isTemplate: true });
    assert.equal(check.allowed, false);
    assert.match(check.reasons.join(" "), /not saved as a contact with recorded opt-in consent/i);
  });

  it("refuses a template to a contact who never opted in", async () => {
    rows.contacts.push({ id: "c-1", tenant_id: "company-1", consent_given: false });
    const check = await checkSendPermission({
      contactId: "c-1",
      waNumberId: "num-1",
      isTemplate: true,
    });
    assert.equal(check.allowed, false);
    assert.match(check.reasons.join(" "), /No recorded opt-in consent/i);
  });

  it("still allows a template to a contact who did opt in", async () => {
    // Guards the fix from over-blocking: consent is recorded, so it may go.
    rows.contacts.push({ id: "c-1", tenant_id: "company-1", consent_given: true });
    const check = await checkSendPermission({
      contactId: "c-1",
      waNumberId: "num-1",
      isTemplate: true,
    });
    assert.deepEqual([...check.reasons], []);
    assert.equal(check.allowed, true);
  });

  it("does not apply the consent rule to an ordinary reply", async () => {
    const check = await checkSendPermission({ waNumberId: "num-1", isTemplate: false });
    assert.equal(check.allowed, true);
  });
});

describe("a lead is never stored without the contact it belongs to", () => {
  const lead = {
    tenantId: "company-1",
    siteId: "site-1",
    sitePlatform: "wordpress",
    email: "Buyer@Example.com",
    name: "Buyer",
    consent: true,
    tags: ["pricing"],
  };

  it("refuses the lead when the contact cannot be created", async () => {
    // Reported: the contact insert failed, the lead was written anyway with no
    // contact_id, and the website was told the submission had succeeded.
    faults["contacts:insert"] = "duplicate key value violates unique constraint";
    await assert.rejects(ingestLead(lead), /Could not save the contact for this lead/);
    assert.equal(rows.leads.length, 0);
  });

  it("stores the contact and the lead together on success", async () => {
    await ingestLead(lead);
    assert.equal(rows.contacts.length, 1);
    assert.equal(rows.contacts[0].email, "buyer@example.com");
    assert.equal(rows.leads.length, 1);
    assert.equal(rows.leads[0].contact_id, rows.contacts[0].id);
    assert.equal(rows.leads[0].tenant_id, "company-1");
  });

  it("reuses an existing contact and records consent on it", async () => {
    rows.contacts.push({ id: "c-9", tenant_id: "company-1", email: "buyer@example.com" });
    await ingestLead(lead);
    assert.equal(rows.contacts.length, 1);
    assert.equal(rows.contacts[0].consent_given, true);
    assert.equal(rows.leads[0].contact_id, "c-9");
  });
});

describe("an active site's own settings are not the public endpoint's to change", () => {
  const activeSite = () => ({
    id: "site-1",
    tenant_id: "company-1",
    status: "active",
    activation_token: "token-that-is-long-enough-000",
    admin_email: "owner@shop.example",
    domain: "shop.example",
    platform: "wordpress",
    name: "Shop",
    active: true,
  });

  it("keeps the domain and platform of an activated site", async () => {
    // The site key sits in public website code, so anyone who reads it could
    // otherwise repoint the site at a domain of their own.
    rows.lead_sites.push(activeSite());
    const result = await requestSiteActivation({
      siteId: "site-1",
      origin: "https://flas.mobidigisol.com",
      domain: "attacker.example",
      adminEmail: "attacker@evil.example",
      platform: "custom",
    });
    assert.equal(result.status, "active");
    assert.equal(rows.lead_sites[0].domain, "shop.example");
    assert.equal(rows.lead_sites[0].platform, "wordpress");
    assert.equal(rows.lead_sites[0].admin_email, "owner@shop.example");
  });

  it("lets a site still being set up record its domain and platform", async () => {
    rows.lead_sites.push({ ...activeSite(), status: "pending", admin_email: null, domain: null });
    const result = await requestSiteActivation({
      siteId: "site-1",
      origin: "https://flas.mobidigisol.com",
      domain: "shop.example",
      adminEmail: "owner@shop.example",
      platform: "shopify",
    });
    assert.equal(result.status, "pending");
    assert.equal(rows.lead_sites[0].domain, "shop.example");
    assert.equal(rows.lead_sites[0].platform, "shopify");
    assert.equal(globalThis.publicIntake.emails.length, 1);
  });
});

describe("the activation page prints no markup that was typed into a site name", () => {
  const get = (token) =>
    activateRoute.options.server.handlers.GET({
      request: new Request(
        `https://flas.mobidigisol.com/api/public/plugin/activate?token=${token}`,
      ),
    });

  it("escapes a site name instead of letting it become a script", async () => {
    const token = "token-that-is-long-enough-000";
    rows.lead_sites.push({
      id: "site-1",
      name: "Tau Italia</title><script>alert(document.cookie)</script>",
      status: "pending",
      activation_token: token,
    });
    const body = await (await get(token)).text();
    assert.ok(!body.includes("<script"), "the page must not contain a script tag");
    assert.match(body, /&lt;script&gt;/);
    assert.match(body, /Tau Italia/);
    assert.equal(rows.lead_sites[0].status, "active");
  });

  it("still refuses a link too short to be a token", async () => {
    const response = await get("short");
    assert.equal(response.status, 400);
    assert.match(await response.text(), /not valid/);
  });
});

describe("a WhatsApp message the provider refused is not shown as delivered", () => {
  it("stores an agent's message with the status the send actually had", () => {
    const wa = read("src/lib/wa.server.ts");
    assert.match(wa, /status: "sent" \| "failed" = "sent"/);
    assert.match(wa, /tenant_id: tenantId,\n\s+status,/);
    assert.match(read("src/lib/crm.functions.ts"), /deliveryError \? "failed" : "sent"/);
  });

  it("marks the bot's already-stored reply failed when the send is refused", () => {
    const monitoring = read("src/lib/monitoring.server.ts");
    assert.match(
      monitoring,
      /update\(\{ status: "failed" \}\)\s*\n\s*\.eq\("id", replyMessageId\)/,
    );
    assert.match(monitoring, /"bot",\n\s+null,\n\s+null,\n\s+"failed",/);
  });

  it("shows a failed message as not delivered in the inbox", () => {
    const inbox = read("src/routes/_authenticated/inbox.tsx");
    assert.match(inbox, /m\.status === "failed"/);
    assert.match(inbox, /Not delivered/);
  });
});
