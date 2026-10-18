// What the product says about email it did not send.
//
// These paths call no sender (the HTTP senders in email-dispatch.server.ts are not used by them),
// so nothing here puts a message on the wire. So the
// welcome email, each drip step and a campaign broadcast must not say "sent" or "delivered", must
// not use up a drip step or move a campaign to "sent", and must tell the caller plainly that
// nothing went out. Every test drives the real handler against a database double; the double
// can also refuse the delivery-log call, because a log that fails must not turn into success.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import { createDb } from "./support/db-double.mjs";

import {
  ingestLead,
  triggerLeadWelcomeAutomation,
} from "../node_modules/.cache/flas-lead-automation.mjs";
import { dispatchDripStepForEnrollment } from "../node_modules/.cache/flas-drip-automation.mjs";
import { dispatchSalesLeadAlert } from "../node_modules/.cache/flas-lead-alerts.mjs";
import { sendPlatformTestEmail } from "../node_modules/.cache/flas-platform-email.mjs";
import {
  getStorageBudgetReport,
  sendPortalEmailReply,
} from "../node_modules/.cache/flas-user-email-accounts.mjs";
import {
  dispatchCampaignNow,
  dispatchScheduledCampaigns,
} from "../node_modules/.cache/flas-marketing.mjs";

const SETTING = "EMAIL_UNSUBSCRIBE_SECRET";
// Made fresh on every run: no key value is written in this file.
const GOOD_KEY = crypto.randomBytes(32).toString("hex");

const A = "company-a";
const B = "company-b";
const EMAIL = "new@example.com";
const alertRecipients = [
  { id: "admin-a", tenant_id: A, staff_role: "company_admin", email: "owner@example.com" },
];

const NOT_CONNECTED = "Email sending is not connected yet, so nothing was sent.";
const ALERT_NOT_EMAILED = "Email sending is not connected yet, so this alert was not emailed.";
const TEST_EMAIL_NOT_SENT = "No test email was sent. Email sending is not connected yet.";
const REPLY_NOT_SENT = "Your reply was not sent. Email sending is not connected yet.";
const NO_UNSUBSCRIBE =
  "Not sent: unsubscribe links are not set up on this server, and an email without one must not go out.";

const db = createDb();

// Every call to the delivery log is kept (whether or not the double accepted it), and the log can
// be made to refuse or to be unreachable.
let attempts;
let logFault; // null | "error" | "unreachable"
let unreachableTable; // a table whose reads throw instead of answering
const database = {
  from: (table) => {
    if (table === unreachableTable) throw new Error("the database is unreachable");
    return db.client.from(table);
  },
  rpc: async (name, args) => {
    attempts.push({ name, args });
    if (name === "record_sales_lead_alert" && logFault) {
      const previous = db.state.faults["email_delivery_log:insert"];
      db.fail("email_delivery_log:insert", { message: "Delivery diagnostic unavailable" });
      try {
        return await db.client.rpc(name, args);
      } finally {
        if (previous) db.fail("email_delivery_log:insert", previous);
        else db.recover("email_delivery_log:insert");
      }
    }
    if (logFault === "unreachable") throw new Error("the delivery log is unreachable");
    if (logFault === "error") {
      return { data: null, error: { code: "XX000", message: "the delivery log refused it" } };
    }
    return db.client.rpc(name, args);
  },
};
globalThis.publicIntake = { db: database, audits: [], emails: [], alerts: [] };

const setKey = (value) => {
  if (value === undefined) delete process.env[SETTING];
  else process.env[SETTING] = value;
};

const smtp = (overrides = {}) => ({
  tenant_id: A,
  welcome_email_enabled: true,
  verified: true,
  smtp_host: "smtp.example.com",
  from_email: "hello@example.com",
  from_name: "Acme",
  ...overrides,
});

const dripRows = (extra = {}) => ({
  drip_enrollments: [
    {
      id: "en-1",
      sequence_id: "seq-1",
      tenant_id: A,
      email: EMAIL,
      status: "in_progress",
      current_step: 1,
      next_run_at: "2026-10-13T00:00:00.000Z",
    },
  ],
  drip_steps: [
    {
      id: "s1",
      sequence_id: "seq-1",
      step_number: 1,
      delay_days: 0,
      template_id: "welcome_discount",
      subject: "Hi {{name}}",
    },
    {
      id: "s2",
      sequence_id: "seq-1",
      step_number: 2,
      delay_days: 3,
      template_id: "product_showcase",
      subject: "Next",
    },
  ],
  tenant_smtp_config: [smtp()],
  ...extra,
});

const claims = () => attempts.filter((c) => c.name === "log_email_delivery").map((c) => c.args);
const statuses = () => [
  ...claims().map((c) => c._status),
  ...db.table("email_delivery_log").map((r) => r.status),
];
const enrolment = () => db.table("drip_enrollments").find((r) => r.id === "en-1");

const stepOne = () =>
  dispatchDripStepForEnrollment({
    enrollmentId: "en-1",
    tenantId: A,
    email: EMAIL,
    name: null,
    stepNumber: 1,
  });

/** Nothing may say sent/delivered; whatever was recorded says it was not sent. */
function assertNothingClaimedAsSent() {
  for (const status of statuses()) {
    assert.ok(!["sent", "delivered", "opened", "clicked"].includes(status), `claimed ${status}`);
  }
}

beforeEach(() => {
  setKey(GOOD_KEY);
  attempts = [];
  logFault = null;
  unreachableTable = null;
  globalThis.publicIntake.audits = [];
  mock.method(console, "error", () => {});
  mock.method(console, "warn", () => {});
});
afterEach(() => {
  mock.restoreAll();
  setKey(undefined);
});

describe("welcome email", () => {
  const welcome = () =>
    triggerLeadWelcomeAutomation({ tenantId: A, email: EMAIL, name: "Sam", sourceUrl: "" });

  it("with verified mail settings it is not claimed as sent, and the caller is told so", async () => {
    db.reset({ tenant_smtp_config: [smtp()] });
    const result = await welcome();

    assert.deepEqual(result, { ok: false, error: NOT_CONNECTED });
    assert.deepEqual(statuses(), ["failed"]);
    assert.equal(claims()[0]._error, NOT_CONNECTED);
  });

  it("with unverified mail settings it is not claimed as sent either", async () => {
    db.reset({ tenant_smtp_config: [smtp({ verified: false })] });
    const result = await welcome();

    assert.equal(result.ok, false);
    assert.deepEqual(statuses(), ["failed"]);
    assertNothingClaimedAsSent();
  });

  it("a delivery log that refuses the record does not turn the answer into success", async () => {
    db.reset({ tenant_smtp_config: [smtp()] });
    logFault = "error";
    assert.deepEqual(await welcome(), { ok: false, error: NOT_CONNECTED });

    logFault = "unreachable";
    assert.deepEqual(await welcome(), { ok: false, error: NOT_CONNECTED });
  });

  it("the lead is still captured, with the sales alert, when the email cannot be sent", async () => {
    db.reset({ leads: [], tenant_smtp_config: [smtp()], profiles: alertRecipients });

    const saved = await ingestLead({ tenantId: A, email: EMAIL, name: "Sam", consentGiven: true });

    assert.equal(saved.email, EMAIL);
    assert.equal(db.table("leads").length, 1);
    assert.equal(
      db.table("workspace_notifications").length,
      1,
      "the in-app sales alert is still raised",
    );
    assertNothingClaimedAsSent();
    assert.ok(statuses().length >= 1);
  });

  it("the lead is still captured when the welcome step itself throws", async () => {
    db.reset({ leads: [], tenant_smtp_config: [smtp()], profiles: alertRecipients });
    unreachableTable = "tenant_smtp_config";

    const saved = await ingestLead({ tenantId: A, email: EMAIL, name: "Sam", consentGiven: true });

    assert.equal(saved.email, EMAIL);
    assert.equal(db.table("leads").length, 1);
    assert.equal(
      db.table("workspace_notifications").length,
      1,
      "the in-app sales alert is still raised",
    );
    assertNothingClaimedAsSent();
  });

  it("the lead is still captured when the delivery log is unreachable", async () => {
    db.reset({ leads: [], tenant_smtp_config: [smtp()], profiles: alertRecipients });
    logFault = "unreachable";

    const saved = await ingestLead({ tenantId: A, email: EMAIL, name: "Sam", consentGiven: true });

    assert.equal(saved.email, EMAIL);
    assert.equal(db.table("leads").length, 1);
    assert.equal(
      db.table("workspace_notifications").length,
      1,
      "the in-app sales alert is still raised",
    );
  });
});

describe("drip step", () => {
  for (const [label, config] of [
    ["verified mail settings", smtp()],
    ["unverified mail settings", smtp({ verified: false })],
    ["no mail settings at all", null],
  ]) {
    it(`with ${label}: nothing is claimed as sent and the enrolment does not move`, async () => {
      db.reset(dripRows({ tenant_smtp_config: config ? [config] : [] }));
      const before = JSON.stringify(db.table("drip_enrollments"));

      const done = await stepOne();

      assert.equal(done, false);
      assertNothingClaimedAsSent();
      assert.deepEqual(statuses(), ["failed"]);
      assert.equal(claims()[0]._error, NOT_CONNECTED);
      assert.equal(JSON.stringify(db.table("drip_enrollments")), before);
      assert.equal(enrolment().current_step, 1);
      assert.equal(enrolment().last_sent_at, undefined);
    });
  }

  it("running the same step twice makes no 'sent' claim and still leaves the step to be sent later", async () => {
    db.reset(dripRows());
    const before = JSON.stringify(db.table("drip_enrollments"));

    assert.equal(await stepOne(), false);
    assert.equal(await stepOne(), false);

    assert.equal(statuses().filter((s) => s === "sent").length, 0);
    assertNothingClaimedAsSent();
    assert.equal(JSON.stringify(db.table("drip_enrollments")), before);
  });

  it("a delivery log that refuses the record does not turn the answer into success", async () => {
    db.reset(dripRows());
    const before = JSON.stringify(db.table("drip_enrollments"));

    logFault = "error";
    assert.equal(await stepOne(), false);
    logFault = "unreachable";
    assert.equal(await stepOne(), false);

    assert.equal(JSON.stringify(db.table("drip_enrollments")), before);
  });

  it("a step or enrolment that cannot be read is not treated as finished", async () => {
    db.reset(dripRows());
    const before = JSON.stringify(db.table("drip_enrollments"));

    db.fail("drip_steps:read", { message: "database unavailable" });
    assert.equal(await stepOne(), false);
    db.recover("drip_steps:read");

    db.fail("drip_enrollments:read", { message: "database unavailable" });
    assert.equal(await stepOne(), false);
    db.recover("drip_enrollments:read");

    assert.equal(JSON.stringify(db.table("drip_enrollments")), before);
    assert.equal(enrolment().status, "in_progress");
    assert.deepEqual(claims(), []);
  });

  it("past the last step the enrolment is completed, and a refused update is not reported as done", async () => {
    db.reset(dripRows());
    const lastStep = () =>
      dispatchDripStepForEnrollment({
        enrollmentId: "en-1",
        tenantId: A,
        email: EMAIL,
        name: null,
        stepNumber: 9,
      });

    db.fail("drip_enrollments:update", { message: "database unavailable" });
    assert.equal(await lastStep(), false);
    assert.equal(enrolment().status, "in_progress");
    db.recover("drip_enrollments:update");

    assert.equal(await lastStep(), true);
    assert.equal(enrolment().status, "completed");
    assert.deepEqual(claims(), []);
  });

  it("with unsubscribe links not set up it says that, not that mail is not connected", async () => {
    db.reset(dripRows());
    setKey(undefined);

    assert.equal(await stepOne(), false);
    assert.equal(claims()[0]._error, NO_UNSUBSCRIBE);
    assert.equal(enrolment().current_step, 1);
  });
});

describe("campaign broadcast", () => {
  const user = { supabase: db.client, userId: "user-1" };
  const campaign = (overrides = {}) => ({
    id: "camp-1",
    tenant_id: A,
    name: "Spring",
    subject: "Hello",
    status: "scheduled",
    ...overrides,
  });
  const seed = (campaigns) => ({
    profiles: [{ id: "user-1", tenant_id: A }],
    leads: [
      { id: "l1", tenant_id: A, email: "x@example.com", subscribed: true },
      { id: "l2", tenant_id: B, email: "y@example.com", subscribed: true },
    ],
    campaigns,
  });
  const snapshot = () => JSON.stringify(db.table("campaigns"));

  it("send now: rejected with the plain sentence, and the campaign is not marked sent", async () => {
    db.reset(seed([campaign()]));
    const before = snapshot();

    await assert.rejects(dispatchCampaignNow({ data: { campaignId: "camp-1" }, context: user }), {
      message: NOT_CONNECTED,
    });

    assert.equal(snapshot(), before);
    assert.equal(db.table("campaigns")[0].status, "scheduled");
    assert.equal(db.table("campaigns")[0].sent_at, undefined);
    assert.deepEqual(globalThis.publicIntake.audits, [], "no 'dispatched' record is written");
  });

  it("send now: with unsubscribe links not set up it is refused for that reason", async () => {
    db.reset(seed([campaign()]));
    setKey(undefined);
    const before = snapshot();

    await assert.rejects(dispatchCampaignNow({ data: { campaignId: "camp-1" }, context: user }), {
      message: NO_UNSUBSCRIBE,
    });
    assert.equal(snapshot(), before);
  });

  it("send now: another company's campaign is not found and is not touched", async () => {
    db.reset(seed([campaign({ id: "camp-b", tenant_id: B })]));
    const before = snapshot();

    await assert.rejects(dispatchCampaignNow({ data: { campaignId: "camp-b" }, context: user }), {
      message: /not found/i,
    });
    assert.equal(snapshot(), before);
  });

  it("send now: a database error reading the campaign stops it", async () => {
    db.reset(seed([campaign()]));
    db.fail("campaigns:read", { message: "database unavailable" });

    await assert.rejects(dispatchCampaignNow({ data: { campaignId: "camp-1" }, context: user }));
    assert.equal(db.table("campaigns")[0].status, "scheduled");
  });

  it("scheduled run: rejected, and every scheduled campaign keeps its status", async () => {
    db.reset(
      seed([
        campaign(),
        campaign({ id: "camp-2", name: "Summer" }),
        campaign({ id: "camp-b", tenant_id: B }),
        campaign({ id: "camp-draft", status: "draft" }),
      ]),
    );
    const before = snapshot();

    await assert.rejects(dispatchScheduledCampaigns({ context: user }), { message: NOT_CONNECTED });

    assert.equal(snapshot(), before);
    assert.ok(db.table("campaigns").every((c) => c.status !== "sent" && c.sent_at === undefined));
  });

  it("scheduled run: with unsubscribe links not set up it is refused for that reason", async () => {
    db.reset(seed([campaign()]));
    setKey(undefined);
    const before = snapshot();

    await assert.rejects(dispatchScheduledCampaigns({ context: user }), {
      message: NO_UNSUBSCRIBE,
    });
    assert.equal(snapshot(), before);
  });

  it("scheduled run: nothing scheduled is a true 'nothing to send', not a refusal", async () => {
    db.reset(seed([campaign({ status: "draft" })]));
    assert.deepEqual(await dispatchScheduledCampaigns({ context: user }), {
      ok: true,
      dispatchedCount: 0,
    });
  });

  it("scheduled run: a database error reading the list is not reported as 'nothing to send'", async () => {
    db.reset(seed([campaign()]));
    db.fail("campaigns:read", { message: "database unavailable" });

    await assert.rejects(dispatchScheduledCampaigns({ context: user }));
    assert.equal(db.table("campaigns")[0].status, "scheduled");
  });
});

describe("alert to the sales team", () => {
  // The RPC only records an alert for a persisted lead in the same workspace.
  const seedAlert = (rows) =>
    db.reset({ leads: [{ id: "lead-1", tenant_id: A, email: EMAIL }], ...rows });
  const settings = (overrides = {}) => ({
    tenant_id: A,
    lead_alerts_enabled: true,
    alert_email_addresses: ["boss@example.com", "rep@example.com"],
    ...overrides,
  });
  const alertLog = () => db.table("lead_alerts_log");
  const alert = () =>
    dispatchSalesLeadAlert({ tenantId: A, leadId: "lead-1", email: EMAIL, name: "Sam" });

  it("is not recorded as sent, is not counted, and says plainly that it was not emailed", async () => {
    seedAlert({ tenant_alert_settings: [settings()], profiles: alertRecipients });

    const result = await alert();

    assert.equal(result.notifiedEmails, 0);
    assert.equal(result.emailNotSent, ALERT_NOT_EMAILED);
    assert.deepEqual(statuses(), ["failed", "failed"]);
    assert.deepEqual(
      alertLog().map((r) => [r.alert_channel, r.status, r.error]),
      [
        ["email", "failed", ALERT_NOT_EMAILED],
        ["email", "failed", ALERT_NOT_EMAILED],
      ],
    );
    assertNothingClaimedAsSent();
  });

  it("falls back to the company's staff, and is still not claimed as sent", async () => {
    seedAlert({
      profiles: [
        { id: "u1", tenant_id: A, staff_role: "company_admin", email: "owner@example.com" },
      ],
    });

    const result = await alert();

    assert.equal(result.notifiedEmails, 0);
    assert.deepEqual(statuses(), ["failed"]);
    assert.deepEqual(
      alertLog().map((r) => r.status),
      ["failed"],
    );
  });

  it("the in-app notification, which really is written, is still raised", async () => {
    seedAlert({ tenant_alert_settings: [settings()], profiles: alertRecipients });
    await alert();
    assert.equal(db.table("workspace_notifications").length, 1);
  });

  it("with nobody to email there is nothing to refuse", async () => {
    seedAlert({ tenant_alert_settings: [settings({ alert_email_addresses: [] })] });
    const result = await alert();
    assert.equal(result.emailNotSent, undefined);
    assert.deepEqual(statuses(), []);
  });

  it("alerts switched off write nothing", async () => {
    seedAlert({ tenant_alert_settings: [settings({ lead_alerts_enabled: false })] });
    const result = await alert();
    assert.deepEqual(result, { notifiedEmails: 0, notifiedWhatsApp: false, notifiedInApp: false });
    assert.deepEqual(statuses(), []);
    assert.equal(db.table("workspace_notifications").length, 0);
  });

  it("a delivery log or alert log that refuses the record does not break the alert", async () => {
    seedAlert({ tenant_alert_settings: [settings()], profiles: alertRecipients });
    logFault = "unreachable";
    db.fail("lead_alerts_log:insert", { code: "XX000", message: "down" });

    const result = await alert();

    assert.equal(result.notifiedEmails, 0);
    assert.equal(result.emailNotSent, ALERT_NOT_EMAILED);
    assert.equal(db.table("workspace_notifications").length, 1);
    assert.equal(result.diagnosticsPending, true);
    assert.equal(alertLog().length, 0, "failed diagnostics roll back together");
    logFault = null;
    db.recover("lead_alerts_log:insert");
    const retried = await alert();
    assert.equal(retried.diagnosticsPending, undefined);
    assert.equal(db.table("workspace_notifications").length, 1, "retry retains one notification");
    assert.equal(alertLog().length, 2);
    assert.deepEqual(statuses(), ["failed", "failed"]);
    assertNothingClaimedAsSent();
  });

  it("a captured lead raises it with no 'sent' claim anywhere", async () => {
    db.reset({
      leads: [],
      tenant_alert_settings: [settings()],
      tenant_smtp_config: [smtp()],
    });

    await ingestLead({ tenantId: A, email: EMAIL, name: "Sam", consentGiven: true });

    assert.equal(db.table("leads").length, 1);
    assertNothingClaimedAsSent();
    assert.ok(alertLog().length >= 2);
    for (const entry of alertLog()) assert.equal(entry.status, "failed");
  });
});

describe("test email from the platform settings", () => {
  const manager = { supabase: db.client, userId: "root-1" };
  const rows = (extra = {}) => ({
    profiles: [{ id: "root-1", staff_role: "super_admin" }],
    platform_email_config: [
      { id: "cfg-1", smtp_host: "smtp.example.com", smtp_user: "flas@example.com" },
    ],
    ...extra,
  });
  const send = (context = manager) =>
    sendPlatformTestEmail({ data: { recipient: "someone@example.com" }, context });

  it("says no email was sent, and records no 'sent'", async () => {
    db.reset(rows());

    const result = await send();

    assert.deepEqual(result, { ok: false, message: TEST_EMAIL_NOT_SENT });
    assert.deepEqual(statuses(), ["failed"]);
    assert.equal(claims()[0]._error, TEST_EMAIL_NOT_SENT);
    assertNothingClaimedAsSent();
  });

  it("a delivery log that refuses the record does not change the answer", async () => {
    db.reset(rows());
    logFault = "error";
    assert.deepEqual(await send(), { ok: false, message: TEST_EMAIL_NOT_SENT });
  });

  it("is still refused for anyone who is not the platform manager", async () => {
    db.reset(rows({ profiles: [{ id: "root-1", staff_role: "agent" }] }));
    await assert.rejects(send(), /only available to the Flas platform manager/);
    assert.deepEqual(statuses(), []);
  });

  it("still says the settings are missing when they are", async () => {
    db.reset(rows({ platform_email_config: [] }));
    await assert.rejects(send(), { message: "Platform SMTP is not configured yet" });
  });
});

describe("reply written in the portal", () => {
  const staff = { supabase: db.client, userId: "user-1" };
  const MINE = "11111111-1111-4111-8111-111111111111";
  const THEIRS = "22222222-2222-4222-8222-222222222222";
  const rows = (extra = {}) => ({
    profiles: [{ id: "user-1", tenant_id: A }],
    user_email_accounts: [
      { id: MINE, tenant_id: A, from_email: "me@example.com" },
      { id: THEIRS, tenant_id: B, from_email: "them@example.com" },
    ],
    ...extra,
  });
  const reply = (accountId = MINE) =>
    sendPortalEmailReply({
      data: { accountId, to: "customer@example.com", subject: "Re: hi", bodyText: "Thanks!" },
      context: staff,
    });

  it("is refused with the plain sentence, and is never stored as sent", async () => {
    db.reset(rows());

    await assert.rejects(reply(), { message: REPLY_NOT_SENT });

    assert.equal(db.table("portal_email_messages").length, 1, "the unsent text is kept");
    for (const message of db.table("portal_email_messages")) {
      assert.equal(message.status, "failed");
      assert.equal(message.tenant_id, A);
      assert.equal(message.error_message, REPLY_NOT_SENT, "the kept row says why it was not sent");
    }
  });

  it("an unsent reply deletes nothing: it does not start the storage pruning", async () => {
    // A mailbox over 85% full, with old mail that the pruning would delete.
    db.reset(
      rows({
        portal_email_messages: [
          {
            id: "old",
            tenant_id: A,
            storage_bytes: 950_000_000,
            created_at: "2025-01-01T00:00:00Z",
          },
        ],
      }),
    );
    let deletes = 0;
    db.fail("portal_email_messages:delete", () => {
      deletes++;
      return undefined;
    });

    await assert.rejects(reply(), { message: REPLY_NOT_SENT });

    assert.deepEqual(
      attempts.filter((a) => a.name === "check_and_prune_tenant_email_storage"),
      [],
    );
    assert.equal(deletes, 0);
    assert.equal(
      db.table("portal_email_messages").some((m) => m.id === "old"),
      true,
    );
  });

  it("is refused even when saving the unsent copy fails", async () => {
    db.reset(rows());
    db.fail("portal_email_messages:insert", { code: "XX000", message: "down" });
    await assert.rejects(reply(), { message: REPLY_NOT_SENT });
    assert.equal(db.table("portal_email_messages").length, 0);
  });

  it("another company's mailbox is still not found", async () => {
    db.reset(rows());
    await assert.rejects(reply(THEIRS), { message: "Selected sender email account not found." });
    assert.equal(db.table("portal_email_messages").length, 0);
  });
});

describe("the storage report only reads", () => {
  const staff = { supabase: db.client, userId: "user-1" };
  const GB = 1073741824;
  const report = () => getStorageBudgetReport({ context: staff });
  const message = (id, tenant_id, storage_bytes, created_at = "2025-01-01T00:00:00Z") => ({
    id,
    tenant_id,
    storage_bytes,
    created_at,
  });
  const base = (messages) => ({
    profiles: [{ id: "user-1", tenant_id: A }],
    portal_email_messages: messages,
  });
  // Every kind of write to the mailbox table is counted, so a delete, an update or an insert
  // anywhere in the report is seen however it is made.
  let writes;
  const watch = () => {
    writes = 0;
    for (const op of ["insert", "update", "delete", "upsert"]) {
      db.fail(`portal_email_messages:${op}`, () => {
        writes++;
        return undefined;
      });
    }
  };
  const prunes = () => attempts.filter((a) => a.name === "check_and_prune_tenant_email_storage");

  it("over 85% full, with old mail, it reports the usage and deletes nothing", async () => {
    db.reset(
      base([message("old", A, 950_000_000), message("new", A, 1000, new Date().toISOString())]),
    );
    watch();

    const result = await report();

    assert.equal(result.usedBytes, 950_001_000);
    assert.equal(result.maxCapBytes, GB);
    assert.equal(result.usagePercent, 88.48);
    assert.equal(result.isCritical, true);
    assert.equal(result.purgedCount, 0);
    assert.equal(writes, 0, "the report wrote to the mailbox table");
    assert.deepEqual(prunes(), [], "the report started the pruning");
    assert.equal(db.table("portal_email_messages").length, 2);
  });

  it("counts every message even when one read returns fewer rows than exist, and only this company's", async () => {
    const mine = [];
    for (let i = 0; i < 12; i++) mine.push(message(`m-${i}`, A, 100));
    db.reset(base([...mine, message("theirs", B, 5000)]));
    db.state.rowCap = 5;

    const result = await report();

    assert.equal(result.usedBytes, 1200);
    assert.equal(result.isCritical, false);
  });

  it("a read that fails is an error, not an empty mailbox", async () => {
    db.reset(base([message("old", A, 950_000_000)]));
    db.fail("portal_email_messages:read", { code: "XX000", message: "down" });
    await assert.rejects(report(), /could not be read/);
  });

  it("with no workspace it reports nothing and touches nothing", async () => {
    db.reset({ profiles: [{ id: "user-1", tenant_id: null }], portal_email_messages: [] });
    watch();
    const result = await report();
    assert.equal(result.usedBytes, 0);
    assert.equal(writes, 0);
    assert.deepEqual(prunes(), []);
  });
});

describe("campaign board", () => {
  const board = readFileSync(
    new URL("../src/components/marketing/CampaignBoard.tsx", import.meta.url),
    "utf8",
  )
    .split("\r\n")
    .join("\n");

  it("never says a scheduled campaign was scheduled successfully, because nothing will send it", () => {
    assert.doesNotMatch(board, /Campaign scheduled successfully/);
    assert.match(board, /t\("marketing\.markedAsQueuedFlasCrm"\)/);
    const translations = readFileSync(
      new URL("../src/lib/i18n/screens/marketing.ts", import.meta.url),
      "utf8",
    );
    assert.match(translations, /Flas CRM does not send campaigns itself yet/);
  });

  it("shows that sentence everywhere a campaign is saved or moved to 'scheduled'", () => {
    const uses = board.match(/toast\.success\([^;]*t\("marketing\.markedAsQueuedFlasCrm"\)/g) ?? [];
    // A new campaign and an edited one are saved by the same server call (PR #58
    // re-review), so they share one use; the other is a card moved to scheduled.
    assert.equal(uses.length, 2, "campaign saved as scheduled, and a card moved to scheduled");
    assert.match(board, /isScheduled\s*\?\s*t\("marketing\.markedAsQueuedFlasCrm"\)/);
  });
});

describe("welcome step runs when consent is newly given, not on every message", () => {
  const welcomes = () => claims().filter((c) => c._template === "welcome_discount");
  const capture = (consentGiven = true) =>
    ingestLead({ tenantId: A, email: EMAIL, name: "Sam", consentGiven });

  it("three messages from the same consented visitor make one welcome attempt", async () => {
    db.reset({ leads: [], tenant_smtp_config: [smtp()], profiles: alertRecipients });

    await capture();
    await capture();
    await capture();

    assert.equal(db.table("leads").length, 1);
    assert.equal(welcomes().length, 1);
    assert.equal(
      db.table("workspace_notifications").length,
      1,
      "later messages reuse the lead alert",
    );
    assert.equal(
      db.table("lead_alerts_log").length,
      1,
      "the unsent alert diagnostic is not spammed",
    );
  });

  it("a visitor who was already consented here gets no welcome step at all", async () => {
    db.reset({
      leads: [{ id: "lead-a", tenant_id: A, email: EMAIL, consent_given: true, subscribed: true }],
      tenant_smtp_config: [smtp()],
    });

    await capture();
    await capture(false);

    assert.equal(welcomes().length, 0);
  });

  it("messages without consent never start it; the message that gives consent does, once", async () => {
    db.reset({ leads: [], tenant_smtp_config: [smtp()], profiles: alertRecipients });

    await capture(false);
    await capture(false);
    assert.equal(welcomes().length, 0);

    await capture(true);
    await capture(true);
    assert.equal(welcomes().length, 1);
  });

  it("someone who withdrew consent and gives it again is a new consent", async () => {
    db.reset({
      leads: [
        { id: "lead-a", tenant_id: A, email: EMAIL, consent_given: false, subscribed: false },
      ],
      tenant_smtp_config: [smtp()],
    });

    await capture(true);
    await capture(true);

    assert.equal(welcomes().length, 1);
  });

  it("another company holding the same consented address does not use up this company's welcome", async () => {
    db.reset({
      leads: [{ id: "lead-b", tenant_id: B, email: EMAIL, consent_given: true, subscribed: true }],
      tenant_smtp_config: [smtp()],
    });

    await capture(true);

    assert.equal(welcomes().length, 1);
  });
});

describe("saved website-chat leads retry alerts without duplicating them", () => {
  const capture = () => ingestLead({ tenantId: A, email: EMAIL, name: "Sam", consentGiven: false });
  const seed = () => db.reset({ leads: [], profiles: alertRecipients });
  const assertStoredOnce = () => {
    assert.equal(db.table("leads").length, 1);
    assert.equal(db.table("workspace_notifications").length, 1);
    assert.equal(db.table("lead_alerts_log").length, 1);
    assert.equal(db.table("email_delivery_log").length, 1);
    assertNothingClaimedAsSent();
    assert.equal(claims().length, 0, "without consent there is no welcome attempt");
  };

  it("later messages without marketing consent reuse the same lead notification", async () => {
    seed();
    await capture();
    await capture();
    await capture();
    assertStoredOnce();
  });

  it("concurrent captures pass the same persisted lead into the deduplicating RPC", async () => {
    seed();
    await Promise.all(Array.from({ length: 8 }, capture));
    assertStoredOnce();
    const alertCalls = attempts.filter((call) => call.name === "record_sales_lead_alert");
    assert.equal(alertCalls.length, 8);
    assert.ok(
      alertCalls.every(
        (call) => call.args._tenant_id === A && call.args._lead_id === db.table("leads")[0].id,
      ),
    );
  });

  it("a saved lead whose notification failed can recover on a later capture", async () => {
    seed();
    db.fail("workspace_notifications:insert", { message: "storage unavailable" });
    const saved = await capture();
    assert.ok(saved.id);
    assert.equal(db.table("workspace_notifications").length, 0);
    db.recover("workspace_notifications:insert");
    await capture();
    await capture();
    assertStoredOnce();
  });

  it("pending diagnostics recover without multiplying the already saved notification", async () => {
    seed();
    db.fail("email_delivery_log:insert", { message: "diagnostics unavailable" });
    await capture();
    assert.equal(db.table("workspace_notifications").length, 1);
    assert.equal(db.table("lead_alerts_log").length, 0);
    db.recover("email_delivery_log:insert");
    await capture();
    await capture();
    assertStoredOnce();
  });
});
