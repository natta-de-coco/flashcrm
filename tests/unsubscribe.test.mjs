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
// Until the SQL is pasted into the live database the function is not there: every database this
// file builds starts that way, and a test that wants the function in place says so with onRpc().
const functionIsNotThere = async () => ({
  data: null,
  error: { code: "PGRST202", message: "Could not find the function in the schema cache" },
});
const resetWithoutFunction = db.reset;
db.reset = (rows) => {
  resetWithoutFunction(rows);
  db.onRpc("withdraw_marketing_consent", functionIsNotThere);
};
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

// The withdrawal is one database function (supabase/migrations/20261014110000_...). Until someone
// pastes that SQL into the live database the function does not exist, and the link must still
// work completely. beforeEach() above makes the function "not there", so every test that does
// not say otherwise runs the fallback; the tests below that name the function run the other
// world, where it exists.
describe("a result the database cut short never counts as done", () => {
  const CAP = 5; // PostgREST stops a read at 1,000 rows without saying so; the double stops at 5
  const SPACED = " Shared@Example.COM ";

  // Eight addresses that CONTAIN the one in the link (so a substring search finds them) but are
  // other people, then the person themself in two spellings. The double lists them in this order,
  // so a single read of CAP rows never reaches the last two.
  const crowd = {
    leads: {
      each: (id, email, tenant_id = A) => ({
        id,
        tenant_id,
        email,
        subscribed: true,
        consent_given: true,
      }),
      done: (r) => r.subscribed === false && r.consent_given === false,
    },
    contacts: {
      each: (id, email, tenant_id = A) => ({ id, tenant_id, email, consent_given: true }),
      done: (r) => r.consent_given === false,
    },
    drip_enrollments: {
      each: (id, email, tenant_id = A) => ({ id, tenant_id, email, status: "in_progress" }),
      done: (r) => r.status === "unsubscribed",
    },
  };

  const fill = (table) => {
    const { each } = crowd[table];
    const rows = [];
    for (let i = 1; i <= 8; i++) rows.push(each(`look-${i}`, `x${i}${EMAIL}`));
    rows.push(each("target-1", SPACED), each("target-2", EMAIL), each("target-b", EMAIL, B));
    return rows;
  };

  for (const table of Object.keys(crowd)) {
    it(`${table}: the person is withdrawn even when more rows match than one read returns`, async () => {
      db.reset({ ...seed(), [table]: fill(table) });
      db.onRpc("withdraw_marketing_consent", async () => ({
        data: null,
        error: { code: "PGRST202", message: "not there" },
      }));
      db.state.rowCap = CAP;

      const result = await applyUnsubscribe(generateUnsubscribeToken(EMAIL, A));

      assert.deepEqual(result, { ok: true, email: EMAIL });
      const { done } = crowd[table];
      assert.equal(done(row(table, "target-1")), true, "the spaced, mixed-case spelling");
      assert.equal(done(row(table, "target-2")), true, "the exact spelling");
      for (let i = 1; i <= 8; i++) {
        assert.equal(done(row(table, `look-${i}`)), false, `look-${i} is someone else`);
      }
      assert.equal(done(row(table, "target-b")), false, "the other company is untouched");
    });
  }

  it("does not say unsubscribed when a later page cannot be read, and changes nothing on that table", async () => {
    db.reset({ ...seed(), leads: fill("leads") });
    db.onRpc("withdraw_marketing_consent", async () => ({
      data: null,
      error: { code: "PGRST202", message: "not there" },
    }));
    db.state.rowCap = CAP;
    let reads = 0;
    db.fail("leads:read", () =>
      ++reads === 2 ? { code: "57014", message: `timeout on ${EMAIL}` } : undefined,
    );

    const result = await applyUnsubscribe(generateUnsubscribeToken(EMAIL, A));

    assert.deepEqual(result, { ok: false, error: COULD_NOT_UPDATE });
    assert.equal(crowd.leads.done(row("leads", "target-2")), false, "nothing was half-done");
    assert.equal(JSON.stringify(logged).includes(EMAIL), false, "the address is not logged");
  });

  for (const table of ["leads", "contacts", "drip_enrollments"]) {
    it(`${table}: a refused read is "could not update"`, async () => {
      db.fail(`${table}:read`, { code: "XX000", message: "down" });
      const result = await applyUnsubscribe(generateUnsubscribeToken(EMAIL, A));
      assert.deepEqual(result, { ok: false, error: COULD_NOT_UPDATE });
    });
  }

  it("a write that reports fewer rows changed than asked is not done", async () => {
    db.fail("leads:update", () => ({ empty: true })); // the statement "succeeds" and changes nothing
    const result = await applyUnsubscribe(generateUnsubscribeToken(EMAIL, A));
    assert.deepEqual(result, { ok: false, error: COULD_NOT_UPDATE });
    assert.equal(row("leads", "lead-a").subscribed, true);
  });

  it("reads the rows again afterwards, and is not done if one is subscribed again", async () => {
    // Someone re-subscribes the address between the write and the check.
    let flipped = false;
    db.fail("leads:read", () => {
      const r = row("leads", "lead-a");
      if (!flipped && r.subscribed === false) {
        r.subscribed = true;
        flipped = true;
      }
      return undefined;
    });

    const result = await applyUnsubscribe(generateUnsubscribeToken(EMAIL, A));

    assert.equal(flipped, true, "the rows were read again after the write");
    assert.deepEqual(result, { ok: false, error: COULD_NOT_UPDATE });
  });

  it("is not done if the rows cannot be read again afterwards", async () => {
    // The write went through; the check that it did cannot be made.
    db.fail("leads:read", () =>
      row("leads", "lead-a").subscribed === false
        ? { code: "57014", message: "canceling statement due to statement timeout" }
        : undefined,
    );
    const result = await applyUnsubscribe(generateUnsubscribeToken(EMAIL, A));
    assert.deepEqual(result, { ok: false, error: COULD_NOT_UPDATE });
  });

  it("an address that is on file nowhere is simply done", async () => {
    db.reset({ leads: [], contacts: [] });
    db.onRpc("withdraw_marketing_consent", async () => ({
      data: null,
      error: { code: "PGRST202", message: "not there" },
    }));
    const result = await applyUnsubscribe(generateUnsubscribeToken("nobody@example.com", A));
    assert.deepEqual(result, { ok: true, email: "nobody@example.com" });
  });

  it("a database that has no drip tables yet is not a failure", async () => {
    for (const code of ["42P01", "PGRST205"]) {
      db.reset(seed());
      db.fail("drip_enrollments:read", { code, message: "relation does not exist" });
      db.fail("drip_enrollments:update", { code, message: "relation does not exist" });
      const result = await applyUnsubscribe(generateUnsubscribeToken(EMAIL, A));
      assert.deepEqual(result, { ok: true, email: EMAIL }, code);
      assert.equal(row("leads", "lead-a").subscribed, false, code);
    }
  });

  it("changes a large number of rows in small groups, so no request names thousands of ids", async () => {
    const leads = [];
    for (let i = 0; i < 250; i++) {
      leads.push({
        id: `many-${String(i).padStart(3, "0")}`,
        tenant_id: A,
        email: i % 2 ? EMAIL : SPACED,
        subscribed: true,
        consent_given: true,
      });
    }
    db.reset({ ...seed(), leads });
    db.onRpc("withdraw_marketing_consent", async () => ({
      data: null,
      error: { code: "42883", message: "function does not exist" },
    }));
    let writes = 0;
    db.fail("leads:update", () => {
      writes++;
      return undefined;
    });

    const result = await applyUnsubscribe(generateUnsubscribeToken(EMAIL, A));

    assert.deepEqual(result, { ok: true, email: EMAIL });
    assert.equal(
      db.table("leads").every((r) => r.subscribed === false),
      true,
    );
    assert.equal(writes, 3);
  });
});

describe("once the database function is in place", () => {
  const FUNCTION = "withdraw_marketing_consent";
  const counts = { leads: 1, contacts: 1, drip_enrollments: 1 };
  const answer =
    (data, error = null) =>
    async () => ({ data, error });

  it("hands the whole job to the function, for this company and this address, and writes nothing itself", async () => {
    db.onRpc(FUNCTION, answer(counts));
    const before = snapshot();

    const result = await applyUnsubscribe(generateUnsubscribeToken("Shared@Example.com", A));

    assert.deepEqual(result, { ok: true, email: EMAIL });
    assert.deepEqual(
      db.state.rpcCalls.filter((c) => c.name === FUNCTION),
      [{ name: FUNCTION, args: { _tenant_id: A, _email: EMAIL } }],
    );
    assert.equal(snapshot(), before, "nothing was read-then-written around the function");
  });

  for (const error of [
    { code: "42501", message: `permission denied for ${EMAIL}` },
    { code: "XX000", message: "boom" },
    { code: "57014", message: "canceling statement due to statement timeout" },
    { code: "PGRST301", message: "JWT expired" },
    { message: "no code at all" },
  ]) {
    it(`an error from the function (${error.code ?? "no code"}) is "could not update", with no second attempt around it`, async () => {
      db.onRpc(FUNCTION, answer(null, error));
      const before = snapshot();

      const result = await applyUnsubscribe(generateUnsubscribeToken(EMAIL, A));

      assert.deepEqual(result, { ok: false, error: COULD_NOT_UPDATE });
      assert.equal(snapshot(), before, "the fallback did not run");
      assert.equal(logged.length > 0, true);
      assert.equal(JSON.stringify(logged).includes(EMAIL), false, "the address is not logged");
    });
  }

  it("a dropped connection is not done either", async () => {
    db.onRpc(FUNCTION, async () => {
      throw Object.assign(new Error(`fetch failed for ${EMAIL}`), { code: "ECONNRESET" });
    });
    const result = await applyUnsubscribe(generateUnsubscribeToken(EMAIL, A));
    assert.deepEqual(result, { ok: false, error: COULD_NOT_UPDATE });
    assert.equal(JSON.stringify(logged).includes(EMAIL), false);
  });

  it("an answer that is not the function's counts is not done", async () => {
    for (const data of [null, undefined, "ok", 7, [], { leads: "1" }]) {
      db.onRpc(FUNCTION, answer(data));
      const result = await applyUnsubscribe(generateUnsubscribeToken(EMAIL, A));
      assert.deepEqual(result, { ok: false, error: COULD_NOT_UPDATE }, JSON.stringify(data));
    }
  });

  it("only 'the function does not exist' (PGRST202, 42883) switches to the complete fallback", async () => {
    for (const code of ["PGRST202", "42883"]) {
      db.reset(seed());
      db.onRpc(FUNCTION, answer(null, { code, message: "not there" }));
      const result = await applyUnsubscribe(generateUnsubscribeToken(EMAIL, A));
      assert.deepEqual(result, { ok: true, email: EMAIL }, code);
      assert.equal(row("leads", "lead-a").subscribed, false, code);
      assert.equal(row("contacts", "contact-a").consent_given, false, code);
      assert.equal(row("drip_enrollments", "enrol-a").status, "unsubscribed", code);
      assert.equal(row("leads", "lead-b").subscribed, true, code);
    }
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
    assert.equal(db.table("notifications").length, 1, "the in-app sales alert is still raised");

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

describe("lead capture is limited to the company that received it", () => {
  // The double holds the real key (one lead per company and address) and refuses any other
  // ON CONFLICT, as Postgres does.
  const leadsOf = (tenantId) => db.table("leads").filter((r) => r.tenant_id === tenantId);

  beforeEach(() => {
    db.reset({
      leads: [
        // Withdrew from company B some time ago.
        {
          id: "lead-b",
          tenant_id: B,
          email: EMAIL,
          subscribed: false,
          consent_given: false,
          name: "Sam at B",
        },
      ],
    });
  });

  it("a company capturing an address another company holds saves its own row and leaves the other alone", async () => {
    const saved = await ingestLead({ tenantId: A, email: EMAIL, name: "Sam", consentGiven: true });

    assert.equal(saved.tenant_id, A);
    assert.equal(leadsOf(A).length, 1);
    assert.equal(leadsOf(A)[0].consent_given, true);
    assert.deepEqual(
      { ...row("leads", "lead-b") },
      {
        id: "lead-b",
        tenant_id: B,
        email: EMAIL,
        subscribed: false,
        consent_given: false,
        name: "Sam at B",
      },
      "company B's row is exactly as it was: still unsubscribed there",
    );
  });

  it("consent given to another company is not read as consent given here", async () => {
    db.reset({
      leads: [{ id: "lead-b", tenant_id: B, email: EMAIL, subscribed: true, consent_given: true }],
    });

    const saved = await ingestLead({ tenantId: A, email: EMAIL, name: "Sam", consentGiven: false });

    assert.equal(saved.tenant_id, A);
    assert.equal(saved.consent_given, false);
    assert.equal(saved.subscribed, false);
    assert.equal(row("leads", "lead-b").consent_given, true, "B's row is untouched");
  });

  it("asking for consent here counts as new consent even though another company already has it", async () => {
    db.reset({
      leads: [{ id: "lead-b", tenant_id: B, email: EMAIL, subscribed: true, consent_given: true }],
    });

    const saved = await ingestLead({ tenantId: A, email: EMAIL, name: "Sam", consentGiven: true });

    assert.equal(saved.tenant_id, A);
    assert.equal(typeof saved.consent_at, "string", "the moment of consent is recorded for A");
    assert.equal(row("leads", "lead-b").consent_at, undefined);
  });

  it("someone who already consented here is never downgraded, even when two companies hold the address", async () => {
    db.reset({
      leads: [
        { id: "lead-a", tenant_id: A, email: EMAIL, subscribed: true, consent_given: true },
        { id: "lead-b", tenant_id: B, email: EMAIL, subscribed: true, consent_given: true },
      ],
    });

    const saved = await ingestLead({ tenantId: A, email: EMAIL, name: "Sam", consentGiven: false });

    assert.equal(saved.id, "lead-a");
    assert.equal(saved.consent_given, true);
    assert.equal(saved.subscribed, true);
    assert.equal(leadsOf(A).length, 1);
  });

  it("a lookup the database refuses stops the capture and writes nothing", async () => {
    db.reset({ leads: [] });
    db.fail("leads:read", { code: "XX000", message: "down" });
    const before = snapshot();

    await assert.rejects(
      ingestLead({ tenantId: A, email: EMAIL, name: "Sam", consentGiven: true }),
      (thrown) => thrown?.code === "XX000",
    );
    assert.equal(snapshot(), before);
  });
});

describe("the address is matched however it was stored", () => {
  const BACKSLASH = String.fromCharCode(92);
  // Addresses reach the database in whatever form they were typed or imported: mixed case, a
  // stray space. The link always carries the plain lower-case form.
  const mixedSeed = () => ({
    leads: [
      {
        id: "lead-mixed",
        tenant_id: A,
        email: "Sam@Example.com",
        subscribed: true,
        consent_given: true,
      },
      {
        id: "lead-space",
        tenant_id: A,
        email: "sam@example.com ",
        subscribed: true,
        consent_given: true,
      },
      {
        id: "lead-plain",
        tenant_id: A,
        email: "sam@example.com",
        subscribed: true,
        consent_given: true,
      },
      {
        id: "lead-other-co",
        tenant_id: B,
        email: "Sam@Example.com",
        subscribed: true,
        consent_given: true,
      },
      {
        id: "lead-longer",
        tenant_id: A,
        email: "sam@example.com.au",
        subscribed: true,
        consent_given: true,
      },
      {
        id: "lead-prefix",
        tenant_id: A,
        email: "xsam@example.com",
        subscribed: true,
        consent_given: true,
      },
    ],
    contacts: [
      { id: "contact-mixed", tenant_id: A, email: "Sam@Example.com", consent_given: true },
      { id: "contact-space", tenant_id: A, email: " sam@example.com", consent_given: true },
      { id: "contact-other-co", tenant_id: B, email: "SAM@EXAMPLE.COM", consent_given: true },
      { id: "contact-longer", tenant_id: A, email: "sam@example.com.au", consent_given: true },
    ],
  });
  const linkFor = (email) => link({ email, tenantId: A, exp: inAnHour() });

  it("withdraws consent from every spelling of the address in that company, and from nothing else", async () => {
    db.reset(mixedSeed());

    const result = await applyUnsubscribe(linkFor("sam@example.com"));

    assert.deepEqual(result, { ok: true, email: "sam@example.com" });
    for (const id of ["lead-mixed", "lead-space", "lead-plain"]) {
      assert.equal(row("leads", id).consent_given, false, id);
      assert.equal(row("leads", id).subscribed, false, id);
    }
    for (const id of ["contact-mixed", "contact-space"]) {
      assert.equal(row("contacts", id).consent_given, false, id);
    }
    // Another company's customer, and different addresses that merely contain this one.
    for (const id of ["lead-other-co", "lead-longer", "lead-prefix"]) {
      assert.equal(row("leads", id).consent_given, true, id);
      assert.equal(row("leads", id).subscribed, true, id);
    }
    for (const id of ["contact-other-co", "contact-longer"]) {
      assert.equal(row("contacts", id).consent_given, true, id);
    }
  });

  it("a link written in capitals reaches the same rows", async () => {
    db.reset(mixedSeed());
    const result = await applyUnsubscribe(linkFor("  SAM@example.COM "));
    assert.equal(result.ok, true);
    assert.equal(row("leads", "lead-mixed").consent_given, false);
    assert.equal(row("contacts", "contact-space").consent_given, false);
    assert.equal(row("leads", "lead-other-co").consent_given, true);
  });

  it("the characters % _ and backslash in an address mean themselves, not 'anything'", async () => {
    db.reset({
      leads: [
        {
          id: "under",
          tenant_id: A,
          email: "a_b@example.com",
          subscribed: true,
          consent_given: true,
        },
        {
          id: "under-lookalike",
          tenant_id: A,
          email: "axb@example.com",
          subscribed: true,
          consent_given: true,
        },
        {
          id: "percent",
          tenant_id: A,
          email: "A%b@example.com",
          subscribed: true,
          consent_given: true,
        },
        {
          id: "percent-lookalike",
          tenant_id: A,
          email: "aXXb@example.com",
          subscribed: true,
          consent_given: true,
        },
        {
          id: "slash",
          tenant_id: A,
          email: `a${BACKSLASH}b@example.com`,
          subscribed: true,
          consent_given: true,
        },
        {
          id: "slash-lookalike",
          tenant_id: A,
          email: "ab@example.com",
          subscribed: true,
          consent_given: true,
        },
      ],
      contacts: [],
    });

    for (const address of ["a_b@example.com", "a%b@example.com", `a${BACKSLASH}b@example.com`]) {
      assert.equal((await applyUnsubscribe(linkFor(address))).ok, true, address);
    }
    for (const id of ["under", "percent", "slash"]) {
      assert.equal(row("leads", id).consent_given, false, id);
    }
    for (const id of ["under-lookalike", "percent-lookalike", "slash-lookalike"]) {
      assert.equal(row("leads", id).consent_given, true, id);
    }
  });

  it("is not told 'unsubscribed' when the rows could not be found", async () => {
    db.reset(mixedSeed());
    for (const table of ["leads", "contacts"]) {
      db.fail(`${table}:read`, { code: "XX000", message: `broke for ${EMAIL}` });
      const result = await applyUnsubscribe(linkFor("sam@example.com"));
      assert.deepEqual(result, { ok: false, error: COULD_NOT_UPDATE }, table);
      assert.equal(JSON.stringify(logged).includes("sam@example.com"), false, "not in the log");
      db.recover(`${table}:read`);
    }
  });

  it("is not told 'unsubscribed' when the database changed fewer rows than it found", async () => {
    for (const table of ["leads", "contacts"]) {
      db.reset(mixedSeed());
      db.fail(`${table}:update`, { empty: true });
      const result = await applyUnsubscribe(linkFor("sam@example.com"));
      assert.deepEqual(result, { ok: false, error: COULD_NOT_UPDATE }, table);
    }
  });

  it("an address nobody holds in that company is a plain success and changes nothing", async () => {
    db.reset(mixedSeed());
    const held = () => JSON.stringify([db.table("leads"), db.table("contacts")]);
    const before = held();
    const result = await applyUnsubscribe(linkFor("nobody@example.com"));
    assert.deepEqual(result, { ok: true, email: "nobody@example.com" });
    assert.equal(held(), before);
  });
});

describe("a database without the drip tables", () => {
  // The drip tables come from a later migration than the leads and contacts tables. Where it has
  // not been applied there can be no enrolments, so there is nothing to cancel and nothing failed.
  const link = () => generateUnsubscribeToken(EMAIL, A);

  for (const [name, code] of [
    ["Postgres: relation does not exist", "42P01"],
    ["PostgREST: table not found in the schema cache", "PGRST205"],
  ]) {
    it(`${name} (${code}) means no enrolments, and the withdrawal is complete`, async () => {
      db.fail("drip_enrollments:update", { code, message: "the table is not there" });

      assert.deepEqual(await applyUnsubscribe(link()), { ok: true, email: EMAIL });
      assert.equal(row("leads", "lead-a").consent_given, false);
      assert.equal(row("contacts", "contact-a").consent_given, false);
      assert.equal(logged.length, 0, "nothing is reported as a failure");
    });
  }

  for (const code of ["42501", "XX000", "PGRST301", "08006"]) {
    it(`any other refusal (${code}) is still a failure`, async () => {
      db.fail("drip_enrollments:update", { code, message: "refused" });
      assert.deepEqual(await applyUnsubscribe(link()), { ok: false, error: COULD_NOT_UPDATE });
    });
  }

  it("a refusal with no code is still a failure", async () => {
    db.fail("drip_enrollments:update", { message: "relation does not exist" });
    assert.deepEqual(await applyUnsubscribe(link()), { ok: false, error: COULD_NOT_UPDATE });
  });
});

describe("a link is only valid with an expiry that has not passed", () => {
  it("refuses a signed link with no expiry, a zero expiry, or an expiry that is not a number", async () => {
    const before = snapshot();
    const payloads = [
      { email: EMAIL, tenantId: A },
      { email: EMAIL, tenantId: A, exp: 0 },
      { email: EMAIL, tenantId: A, exp: null },
      { email: EMAIL, tenantId: A, exp: "soon" },
      { email: EMAIL, tenantId: A, exp: String(inAnHour()) },
      { email: EMAIL, tenantId: A, exp: [inAnHour()] },
      { email: EMAIL, tenantId: A, exp: { at: inAnHour() } },
      { email: EMAIL, tenantId: A, exp: true },
    ];
    for (const payload of payloads) {
      const token = link(payload);
      assert.equal(verifyUnsubscribeToken(token).valid, false, JSON.stringify(payload));
      assert.deepEqual(await applyUnsubscribe(token), { ok: false, error: REFUSED });
      assert.equal(snapshot(), before);
    }
  });

  it("still accepts a link whose expiry is a number that has not passed", () => {
    assert.equal(
      verifyUnsubscribeToken(link({ email: EMAIL, tenantId: A, exp: inAnHour() })).valid,
      true,
    );
  });
});
