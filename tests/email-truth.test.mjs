// What the product says about email it did not send.
//
// There is no mail transport in this code yet: nothing here can put a message on the wire. So the
// welcome email, each drip step and a campaign broadcast must not say "sent" or "delivered", must
// not use up a drip step or move a campaign to "sent", and must tell the caller plainly that
// nothing went out. Every test drives the real handler against a database double; the double
// can also refuse the delivery-log call, because a log that fails must not turn into success.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import { createDb } from "./support/db-double.mjs";

import {
  ingestLead,
  triggerLeadWelcomeAutomation,
} from "../node_modules/.cache/flas-lead-automation.mjs";
import { dispatchDripStepForEnrollment } from "../node_modules/.cache/flas-drip-automation.mjs";
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

const NOT_CONNECTED = "Email sending is not connected yet, so nothing was sent.";
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
const statuses = () => claims().map((c) => c._status);
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
  globalThis.publicIntake.alerts = [];
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
    db.reset({ leads: [], tenant_smtp_config: [smtp()] });

    const saved = await ingestLead({ tenantId: A, email: EMAIL, name: "Sam", consentGiven: true });

    assert.equal(saved.email, EMAIL);
    assert.equal(db.table("leads").length, 1);
    assert.equal(globalThis.publicIntake.alerts.length, 1);
    assertNothingClaimedAsSent();
    assert.ok(statuses().length >= 1);
  });

  it("the lead is still captured when the welcome step itself throws", async () => {
    db.reset({ leads: [], tenant_smtp_config: [smtp()] });
    unreachableTable = "tenant_smtp_config";

    const saved = await ingestLead({ tenantId: A, email: EMAIL, name: "Sam", consentGiven: true });

    assert.equal(saved.email, EMAIL);
    assert.equal(db.table("leads").length, 1);
    assert.equal(globalThis.publicIntake.alerts.length, 1);
    assertNothingClaimedAsSent();
  });

  it("the lead is still captured when the delivery log is unreachable", async () => {
    db.reset({ leads: [], tenant_smtp_config: [smtp()] });
    logFault = "unreachable";

    const saved = await ingestLead({ tenantId: A, email: EMAIL, name: "Sam", consentGiven: true });

    assert.equal(saved.email, EMAIL);
    assert.equal(db.table("leads").length, 1);
    assert.equal(globalThis.publicIntake.alerts.length, 1);
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
