// The requests nobody signs in for: a WhatsApp template send, a lead posted by
// a website, and a plugin activation link. Each test below is a defect a tester
// reproduced against the live site, so a failure names the symptom they saw.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { readFileSync } from "node:fs";

import { createDb } from "./support/db-double.mjs";

import { checkSendPermission } from "../node_modules/.cache/flas-safety.mjs";
import { ingestLead } from "../node_modules/.cache/flas-leads.mjs";
import { requestSiteActivation } from "../node_modules/.cache/flas-plugin-activation.mjs";
import { Route as activateRoute } from "../node_modules/.cache/flas-plugin-activate-route.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

let rows;
const db = createDb();

globalThis.publicIntake = {
  db: db.client,
  audits: [],
  emails: [],
  emailResult: { ok: true },
};

beforeEach(() => {
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
  db.reset(rows);
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

describe("the routed WhatsApp line is read from this workspace's own leads", () => {
  const consented = { id: "c-1", tenant_id: "company-1", consent_given: true };

  it("applies the routing rule even when the contact has several leads", async () => {
    // A contact who used two email addresses has two leads. maybeSingle() then
    // failed, the failure was ignored, and the rule quietly stopped applying --
    // for exactly the customers who deal with a company most.
    rows.contacts.push(consented);
    rows.leads.push(
      {
        id: "l-1",
        contact_id: "c-1",
        tenant_id: "company-1",
        assigned_wa_number_id: "num-2",
        created_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "l-2",
        contact_id: "c-1",
        tenant_id: "company-1",
        assigned_wa_number_id: "num-3",
        created_at: "2026-06-01T00:00:00Z",
      },
    );
    const check = await checkSendPermission({
      contactId: "c-1",
      waNumberId: "num-1",
      isTemplate: false,
    });
    assert.equal(check.allowed, false);
    assert.match(check.reasons.join(" "), /assign this lead to a different WhatsApp number/);
  });

  it("answers from the line the oldest lead was routed to", async () => {
    rows.contacts.push(consented);
    rows.leads.push(
      {
        id: "l-2",
        contact_id: "c-1",
        tenant_id: "company-1",
        assigned_wa_number_id: "num-3",
        created_at: "2026-06-01T00:00:00Z",
      },
      {
        id: "l-1",
        contact_id: "c-1",
        tenant_id: "company-1",
        assigned_wa_number_id: "num-1",
        created_at: "2026-01-01T00:00:00Z",
      },
    );
    const check = await checkSendPermission({
      contactId: "c-1",
      waNumberId: "num-1",
      isTemplate: false,
    });
    assert.deepEqual([...check.reasons], []);
  });

  it("ignores a lead that belongs to another workspace", async () => {
    rows.contacts.push(consented);
    rows.leads.push({
      id: "l-other",
      contact_id: "c-1",
      tenant_id: "company-2",
      assigned_wa_number_id: "num-9",
      created_at: "2026-01-01T00:00:00Z",
    });
    const check = await checkSendPermission({
      contactId: "c-1",
      waNumberId: "num-1",
      isTemplate: false,
    });
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
    db.fail("contacts:insert", "duplicate key value violates unique constraint");
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
