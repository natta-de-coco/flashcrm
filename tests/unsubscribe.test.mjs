// The unsubscribe link in every marketing email. It is opened by people who are
// not signed in and it writes with the service role, so each test here is a way
// the link could be forged, aimed at the wrong company, or reported as "done"
// when the database refused. The database is a double (tests/support/db-double.mjs);
// the code between the link and the database is what production runs.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import { createDb } from "./support/db-double.mjs";

import { applyUnsubscribe } from "../node_modules/.cache/flas-unsubscribe.mjs";
import {
  generateUnsubscribeToken,
  ingestLead,
  triggerLeadWelcomeAutomation,
  verifyUnsubscribeToken,
} from "../node_modules/.cache/flas-lead-automation.mjs";
import { dispatchDripStepForEnrollment } from "../node_modules/.cache/flas-drip-automation.mjs";

const SETTING = "EMAIL_UNSUBSCRIBE_SECRET";
// Made fresh on every run: no key value is written in this file.
const GOOD_KEY = crypto.randomBytes(32).toString("hex");
const OTHER_KEY = crypto.randomBytes(32).toString("hex");
const SHORT_KEY = crypto.randomBytes(15).toString("hex"); // 30 characters

const A = "company-a";
const B = "company-b";
const EMAIL = "shared@example.com";

const COULD_NOT_UPDATE =
  "We could not update your preferences just now. Please try this link again in a moment.";
const REFUSED = "This unsubscribe link is not valid or has expired.";

const db = createDb();
globalThis.publicIntake = { db: db.client, audits: [], emails: [], alerts: [] };

const setKey = (value) => {
  if (value === undefined) delete process.env[SETTING];
  else process.env[SETTING] = value;
};

const inAnHour = () => Math.floor(Date.now() / 1000) + 3600;

/** A link signed by hand, so a test can forge exactly the payload it wants. */
function link(payload, key = GOOD_KEY) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", key).update(data).digest("base64url");
  return `${data}.${signature}`;
}

const forCompany = (tenantId, key) => link({ email: EMAIL, tenantId, exp: inAnHour() }, key);

const seed = () => ({
  leads: [
    { id: "lead-a", tenant_id: A, email: EMAIL, subscribed: true, consent_given: true },
    { id: "lead-b", tenant_id: B, email: EMAIL, subscribed: true, consent_given: true },
    {
      id: "lead-x",
      tenant_id: A,
      email: "other@example.com",
      subscribed: true,
      consent_given: true,
    },
  ],
  contacts: [
    { id: "contact-a", tenant_id: A, email: EMAIL, consent_given: true },
    { id: "contact-b", tenant_id: B, email: EMAIL, consent_given: true },
    { id: "contact-x", tenant_id: A, email: "other@example.com", consent_given: true },
  ],
  drip_enrollments: [
    { id: "enrol-a", tenant_id: A, email: EMAIL, status: "in_progress" },
    { id: "enrol-b", tenant_id: B, email: EMAIL, status: "in_progress" },
    { id: "enrol-x", tenant_id: A, email: "other@example.com", status: "in_progress" },
  ],
});

const snapshot = () => JSON.stringify(db.state.rows);
const row = (table, id) => db.table(table).find((r) => r.id === id);

let logged;
beforeEach(() => {
  setKey(GOOD_KEY);
  db.reset(seed());
  globalThis.publicIntake.alerts = [];
  logged = [];
  mock.method(console, "error", (...args) => logged.push(args));
});
afterEach(() => {
  mock.restoreAll();
  setKey(undefined);
});

describe("the key that signs the link has no built-in value", () => {
  it("with no setting, no link can be made and none is accepted", () => {
    setKey(undefined);
    assert.throws(() => generateUnsubscribeToken(EMAIL, A), { name: "UnsubscribeNotSetUpError" });
    for (const key of [GOOD_KEY, OTHER_KEY, SHORT_KEY, "", "secret"]) {
      assert.equal(
        verifyUnsubscribeToken(forCompany(A, key)).valid,
        false,
        `signed with "${key.length}" chars`,
      );
    }
  });

  it("a setting shorter than 32 characters is the same as no setting", () => {
    setKey(SHORT_KEY);
    assert.equal(SHORT_KEY.length < 32, true);
    assert.throws(() => generateUnsubscribeToken(EMAIL, A), { name: "UnsubscribeNotSetUpError" });
    assert.equal(verifyUnsubscribeToken(forCompany(A, SHORT_KEY)).valid, false);
  });

  it("a blank setting is the same as no setting", () => {
    setKey("   ");
    assert.throws(() => generateUnsubscribeToken(EMAIL, A), { name: "UnsubscribeNotSetUpError" });
  });

  it("spaces around a good setting are ignored", () => {
    setKey(`  ${GOOD_KEY}\n`);
    const made = generateUnsubscribeToken(EMAIL, A);
    assert.equal(verifyUnsubscribeToken(made).valid, true);
    setKey(GOOD_KEY);
    assert.equal(verifyUnsubscribeToken(made).valid, true);
  });

  it("a link made with a good setting verifies, and carries the company", () => {
    const verified = verifyUnsubscribeToken(generateUnsubscribeToken("Shared@Example.com", A));
    assert.deepEqual(
      { valid: verified.valid, email: verified.email, tenantId: verified.tenantId },
      { valid: true, email: EMAIL, tenantId: A },
    );
  });

  it("a link cannot be made without an address or without a company", () => {
    assert.throws(() => generateUnsubscribeToken(EMAIL, ""), { name: "UnsubscribeNotSetUpError" });
    assert.throws(() => generateUnsubscribeToken("", A), { name: "UnsubscribeNotSetUpError" });
  });
});

describe("opening the link", () => {
  it("withdraws consent for that company only, even when another company holds the same address", async () => {
    const result = await applyUnsubscribe(generateUnsubscribeToken(EMAIL, A));
    assert.deepEqual(result, { ok: true, email: EMAIL });

    assert.equal(row("leads", "lead-a").subscribed, false);
    assert.equal(row("leads", "lead-a").consent_given, false);
    assert.equal(row("contacts", "contact-a").consent_given, false);
    assert.equal(row("drip_enrollments", "enrol-a").status, "unsubscribed");

    // The other company's customer, and another address in the same company, are untouched.
    assert.equal(row("leads", "lead-b").subscribed, true);
    assert.equal(row("leads", "lead-b").consent_given, true);
    assert.equal(row("contacts", "contact-b").consent_given, true);
    assert.equal(row("drip_enrollments", "enrol-b").status, "in_progress");
    assert.equal(row("leads", "lead-x").consent_given, true);
    assert.equal(row("contacts", "contact-x").consent_given, true);
    assert.equal(row("drip_enrollments", "enrol-x").status, "in_progress");
  });

  it("the other company's link changes the other company's rows only", async () => {
    await applyUnsubscribe(generateUnsubscribeToken(EMAIL, B));
    assert.equal(row("leads", "lead-b").consent_given, false);
    assert.equal(row("leads", "lead-a").consent_given, true);
  });

  it("refuses a link signed with a different key, and writes nothing", async () => {
    const before = snapshot();
    const result = await applyUnsubscribe(forCompany(A, OTHER_KEY));
    assert.deepEqual(result, { ok: false, error: REFUSED });
    assert.equal(snapshot(), before);
  });

  it("with no setting, refuses every link and writes nothing", async () => {
    const good = generateUnsubscribeToken(EMAIL, A);
    setKey(undefined);
    const before = snapshot();
    for (const token of [good, forCompany(A, GOOD_KEY), forCompany(A, OTHER_KEY)]) {
      const result = await applyUnsubscribe(token);
      assert.equal(result.ok, false);
      assert.equal(snapshot(), before);
    }
  });

  it("with a setting that is too short, refuses a link signed with it", async () => {
    setKey(SHORT_KEY);
    const before = snapshot();
    const result = await applyUnsubscribe(forCompany(A, SHORT_KEY));
    assert.equal(result.ok, false);
    assert.equal(snapshot(), before);
  });

  it("refuses a link that carries no company, and writes nothing", async () => {
    const before = snapshot();
    const noCompany = [
      { email: EMAIL, exp: inAnHour() },
      { email: EMAIL, tenantId: "", exp: inAnHour() },
      { email: EMAIL, tenantId: null, exp: inAnHour() },
      { email: EMAIL, tenantId: 42, exp: inAnHour() },
    ];
    for (const payload of noCompany) {
      const result = await applyUnsubscribe(link(payload));
      assert.deepEqual(result, { ok: false, error: REFUSED }, JSON.stringify(payload));
      assert.equal(snapshot(), before);
    }
  });

  it("refuses a link with no address, an expired link and a garbled link", async () => {
    const before = snapshot();
    const tokens = [
      link({ tenantId: A, exp: inAnHour() }),
      link({ email: "", tenantId: A, exp: inAnHour() }),
      link({ email: EMAIL, tenantId: A, exp: Math.floor(Date.now() / 1000) - 5 }),
      "",
      "garbage",
      "one.two.three",
      `${Buffer.from("not json").toString("base64url")}.abc`,
    ];
    for (const token of tokens) {
      const result = await applyUnsubscribe(token);
      assert.deepEqual(result, { ok: false, error: REFUSED }, token);
      assert.equal(snapshot(), before);
    }
  });

  it("never repeats back an address from a link that did not verify", async () => {
    const forged = link({ email: "victim@example.com", tenantId: A, exp: inAnHour() }, OTHER_KEY);
    const result = await applyUnsubscribe(forged);
    assert.equal(JSON.stringify(result).includes("victim@example.com"), false);
  });
});

describe("a write that fails is never reported as done", () => {
  for (const table of ["leads", "contacts", "drip_enrollments"]) {
    it(`${table}: the answer is "could not update", and the address is not logged`, async () => {
      db.fail(`${table}:update`, { code: "XX000", message: `broke for ${EMAIL}` });
      const result = await applyUnsubscribe(generateUnsubscribeToken(EMAIL, A));

      assert.deepEqual(result, { ok: false, error: COULD_NOT_UPDATE });
      assert.equal(logged.length > 0, true, "the failure is logged");
      assert.equal(JSON.stringify(logged).includes(EMAIL), false, "the address is not in the log");
    });

    it(`${table}: the other withdrawals still happen, and trying the link again finishes the job`, async () => {
      const token = generateUnsubscribeToken(EMAIL, A);
      db.fail(`${table}:update`, { message: "down" });
      await applyUnsubscribe(token);

      const done = {
        leads: row("leads", "lead-a").consent_given === false,
        contacts: row("contacts", "contact-a").consent_given === false,
        drip_enrollments: row("drip_enrollments", "enrol-a").status === "unsubscribed",
      };
      for (const [name, isDone] of Object.entries(done)) assert.equal(isDone, name !== table, name);

      db.recover(`${table}:update`);
      assert.deepEqual(await applyUnsubscribe(token), { ok: true, email: EMAIL });
      assert.equal(row("leads", "lead-a").consent_given, false);
      assert.equal(row("contacts", "contact-a").consent_given, false);
      assert.equal(row("drip_enrollments", "enrol-a").status, "unsubscribed");
    });
  }

  it("when the link cannot be checked because the key is not set up, the visitor is told to try again", async () => {
    const token = generateUnsubscribeToken(EMAIL, A);
    setKey(undefined);
    assert.deepEqual(await applyUnsubscribe(token), { ok: false, error: COULD_NOT_UPDATE });
    assert.equal(JSON.stringify(logged).includes(EMAIL), false);
  });
});

describe("a marketing email is never sent without a working unsubscribe link", () => {
  const welcomeConfig = (overrides = {}) => ({
    tenant_id: A,
    welcome_email_enabled: true,
    verified: true,
    smtp_host: "smtp.example.com",
    from_email: "hello@example.com",
    from_name: "Acme",
    ...overrides,
  });
  const deliveries = () =>
    db.state.rpcCalls.filter((c) => c.name === "log_email_delivery").map((c) => c.args);
  const statuses = () => deliveries().map((d) => d._status);

  it("welcome email: with no key it is not sent, and is recorded as not sent with a plain reason", async () => {
    db.reset({ ...seed(), tenant_smtp_config: [welcomeConfig()] });
    setKey(undefined);

    const result = await triggerLeadWelcomeAutomation({
      tenantId: A,
      email: "new@example.com",
      name: "Sam",
      sourceUrl: "",
    });

    assert.equal(result.ok, false);
    assert.deepEqual(statuses(), ["failed"]);
    assert.match(deliveries()[0]._error, /unsubscribe links are not set up/i);
  });

  it("capturing a lead still works with no key; the welcome and the first drip email are held back", async () => {
    db.reset({ leads: [], tenant_smtp_config: [welcomeConfig()] });
    setKey(undefined);

    const saved = await ingestLead({
      tenantId: A,
      email: "new@example.com",
      name: "Sam",
      consentGiven: true,
    });

    assert.equal(saved.email, "new@example.com");
    assert.equal(db.table("leads").length, 1);
    assert.equal(globalThis.publicIntake.alerts.length, 1, "the sales alert still goes out");

    assert.equal(statuses().length >= 2, true);
    assert.deepEqual([...new Set(statuses())], ["failed"], "no email is recorded as sent");
    for (const d of deliveries()) assert.match(d._error, /unsubscribe links are not set up/i);

    // The first drip step was not used up, so it can still go out once the key is set.
    const [enrolment] = db.table("drip_enrollments");
    assert.equal(enrolment.status, "in_progress");
    assert.equal(enrolment.current_step, 1);
    assert.equal(enrolment.last_sent_at, undefined);
  });

  it("drip step: with no key it is recorded as not sent and the sequence does not move on", async () => {
    db.reset({
      drip_enrollments: [
        {
          id: "en-1",
          sequence_id: "seq-1",
          tenant_id: A,
          email: EMAIL,
          status: "in_progress",
          current_step: 1,
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
      tenant_smtp_config: [welcomeConfig()],
    });
    setKey(undefined);

    const sent = await dispatchDripStepForEnrollment({
      enrollmentId: "en-1",
      tenantId: A,
      email: EMAIL,
      stepNumber: 1,
    });

    assert.equal(sent, false);
    assert.deepEqual(statuses(), ["failed"]);
    assert.match(deliveries()[0]._error, /unsubscribe links are not set up/i);
    assert.equal(row("drip_enrollments", "en-1").current_step, 1);
    assert.equal(row("drip_enrollments", "en-1").last_sent_at, undefined);
  });
});
