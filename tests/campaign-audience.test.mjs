// Who a marketing campaign may be sent to, and what counts as a refusal.
//
//   npm run test:campaign-audience
//
// Covers QA finding H8 (26 Sep 2026): the campaign writer reported "no opted-in
// contacts" for a workspace whose only contact was badged "Consented", because
// consent was read from `leads` alone; and it toasted success for what was
// really a refusal.
//
// MUTATION=leads_only        — audience resolved from `leads` only (the old bug).
// MUTATION=subscribed_counts — `subscribed` treated as consent (the old predicate).
// MUTATION=never_refusal     — every draft accepted, refusals included.
// Each MUST make this suite fail.
//
// The second half covers the review of that fix (PR #33): addresses kept in
// `contact_identities` were not read, a failed query was read as an empty
// table, and a campaign could be saved with a recipient count of zero while the
// audience was still loading. Those run the real server code against a database
// double that can be made to fail.
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { build, buildSync } from "esbuild";
import { mkdirSync, readFileSync } from "node:fs";
import { createDb } from "./support/db-double.mjs";
import { asPostgrest } from "./support/postgrest-double.mjs";

mkdirSync("node_modules/.cache", { recursive: true });
for (const [entry, out] of [
  ["src/lib/campaign-audience.ts", "node_modules/.cache/flas-campaign-audience.mjs"],
  ["src/lib/campaign-draft.ts", "node_modules/.cache/flas-campaign-draft.mjs"],
]) {
  buildSync({
    entryPoints: [entry],
    outfile: out,
    format: "esm",
    platform: "node",
    bundle: true,
    logLevel: "error",
  });
}
const audienceMod = await import("../node_modules/.cache/flas-campaign-audience.mjs");
const draftMod = await import("../node_modules/.cache/flas-campaign-draft.mjs");
const { isOptedIn, channelAddress, audienceBlockedReason, describeAudience } = audienceMod;

const MUTATION = process.env.MUTATION ?? "";
if (MUTATION) console.log(`!! MUTATION: ${MUTATION} — the suite must FAIL`);

/** Routes through the mutations so a broken rule is exercised, not just described. */
const resolve = (input) => {
  if (MUTATION === "leads_only") {
    return audienceMod.resolveCampaignAudience({ ...input, contacts: [] });
  }
  if (MUTATION === "subscribed_counts") {
    const relax = (rows) =>
      (rows ?? []).map((r) => ({
        ...r,
        consent_given: r.consent_given === true || r.subscribed !== false,
      }));
    return audienceMod.resolveCampaignAudience({
      ...input,
      contacts: relax(input.contacts),
      leads: relax(input.leads),
    });
  }
  return audienceMod.resolveCampaignAudience(input);
};
const looksLikeRefusal = (text) =>
  MUTATION === "never_refusal" ? false : draftMod.looksLikeRefusal(text);

// The workspace the tester actually had: no leads, one contact who consented.
const CONSENTED_CONTACT = {
  name: "Aisha",
  email: "Aisha@Example.com",
  phone: "+971 50 963 0506",
  consent_given: true,
  consent_at: "2026-09-26T10:00:00.000Z",
};

describe("what counts as an opt-in", () => {
  test("recorded consent, on either table", () => {
    assert.equal(isOptedIn({ consent_given: true }), true);
    // contacts has no `subscribed` column at all — absence is not suppression.
    assert.equal(isOptedIn({ consent_given: true, subscribed: undefined }), true);
  });

  test("a captured lead that never ticked the box is not opted in", () => {
    // `leads.subscribed` DEFAULTS to true and no code path ever clears it, so
    // reading it as consent marked every lead in the database as consented.
    assert.equal(isOptedIn({ consent_given: false, subscribed: true }), false);
    assert.equal(isOptedIn({ subscribed: true }), false);
    assert.equal(isOptedIn({ consent_given: null }), false);
  });

  test("an explicit unsubscribe suppresses an earlier consent", () => {
    assert.equal(isOptedIn({ consent_given: true, subscribed: false }), false);
  });
});

describe("reachability is part of being a recipient", () => {
  test("email needs an address, WhatsApp needs a number", () => {
    // contacts.email is nullable, so consent alone does not make a recipient.
    assert.equal(channelAddress({ email: null, phone: "+971509630506" }, "email"), null);
    assert.equal(channelAddress({ email: "a@b.com", phone: null }, "whatsapp"), null);
  });

  test("addresses normalise, so one person is not two recipients", () => {
    assert.equal(channelAddress({ email: " Aisha@Example.COM " }, "email"), "aisha@example.com");
    assert.equal(channelAddress({ phone: "00971 50 963 0506" }, "whatsapp"), "971509630506");
    assert.equal(channelAddress({ phone: "+971509630506" }, "whatsapp"), "971509630506");
  });
});

describe("H8: a consented contact is a usable audience", () => {
  const audience = () => resolve({ contacts: [CONSENTED_CONTACT], leads: [], channel: "email" });

  test("the workspace from the bug report has an audience of one", () => {
    const a = audience();
    assert.equal(a.total, 1);
    assert.equal(a.fromContacts, 1);
    assert.equal(a.fromLeads, 0);
    assert.deepEqual(
      a.recipients.map((r) => r.address),
      ["aisha@example.com"],
    );
  });

  test("so the writer is not blocked and is told a real number", () => {
    const a = audience();
    assert.equal(audienceBlockedReason(a), null);
    assert.match(describeAudience(a), /^1 opted-in email recipient;/);
    assert.match(describeAudience(a), /1 from CRM contacts/);
  });

  test("a person in both tables is one recipient, not two", () => {
    const a = resolve({
      contacts: [CONSENTED_CONTACT],
      leads: [{ email: "aisha@example.com", consent_given: true, subscribed: true }],
      channel: "email",
    });
    assert.equal(a.total, 1);
    assert.equal(a.fromContacts, 1);
    assert.equal(a.fromLeads, 0);
  });

  test("leads still count on their own", () => {
    const a = resolve({
      contacts: [],
      leads: [
        { email: "one@example.com", consent_given: true, subscribed: true },
        { email: "two@example.com", consent_given: true, subscribed: true },
      ],
      channel: "email",
    });
    assert.equal(a.total, 2);
    assert.equal(a.fromLeads, 2);
  });
});

describe("the count shown is the count a sender would use", () => {
  const MIXED = {
    contacts: [
      CONSENTED_CONTACT,
      { email: "nocons@example.com", phone: "+971500000001", consent_given: false },
      { email: null, phone: null, consent_given: true }, // consented, unreachable
    ],
    leads: [
      { email: "lead-ok@example.com", consent_given: true, subscribed: true },
      { email: "lead-unsub@example.com", consent_given: true, subscribed: false },
      { email: "lead-raw@example.com", consent_given: false, subscribed: true },
    ],
  };

  test("only consented, reachable people are counted", () => {
    const a = resolve({ ...MIXED, channel: "email" });
    assert.equal(a.total, 2); // the contact + the one consented lead
    assert.deepEqual(a.recipients.map((r) => r.address).sort(), [
      "aisha@example.com",
      "lead-ok@example.com",
    ]);
    assert.equal(a.total, a.recipients.length);
  });

  test("the people left out are counted separately, so the UI can say why", () => {
    const a = resolve({ ...MIXED, channel: "email" });
    assert.equal(a.optedInUnreachable, 1);
    // nocons + lead-unsub + lead-raw — all reachable, none sendable.
    assert.equal(a.withoutConsent, 3);
  });

  test("switching channel re-counts rather than reusing the email figure", () => {
    const a = resolve({ ...MIXED, channel: "whatsapp" });
    assert.equal(a.total, 1); // only the contact has a phone number
    assert.deepEqual(
      a.recipients.map((r) => r.address),
      ["971509630506"],
    );
  });

  test("a full page of rows is reported as a floor, not an exact figure", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      email: `l${i}@example.com`,
      consent_given: true,
    }));
    const a = resolve({ contacts: [], leads: many, channel: "email", rowLimit: 5 });
    assert.equal(a.truncated, true);
    assert.match(describeAudience(a), /at least 5/);
  });
});

describe("an empty audience is explained, not guessed at", () => {
  test("nobody at all", () => {
    const reason = audienceBlockedReason(resolve({ contacts: [], leads: [], channel: "email" }));
    assert.match(reason, /nobody to send to yet/i);
  });

  test("consent recorded but no address for this channel", () => {
    const a = resolve({
      contacts: [{ name: "No email", email: null, phone: null, consent_given: true }],
      leads: [],
      channel: "email",
    });
    const reason = audienceBlockedReason(a);
    assert.match(reason, /given consent/i);
    assert.match(reason, /email address/i);
  });

  test("people exist but nobody consented — says where to record it", () => {
    const a = resolve({
      contacts: [{ email: "x@example.com", consent_given: false }],
      leads: [{ email: "y@example.com", consent_given: false, subscribed: true }],
      channel: "email",
    });
    const reason = audienceBlockedReason(a);
    assert.match(reason, /No one has consented yet/i);
    assert.match(reason, /Contacts page/);
  });

  test("a real audience is never blocked", () => {
    assert.equal(
      audienceBlockedReason(resolve({ contacts: [CONSENTED_CONTACT], channel: "email" })),
      null,
    );
  });
});

describe("a refusal is not a draft", () => {
  test("the wording the tester was shown", () => {
    assert.equal(
      looksLikeRefusal(
        "I can't draft this campaign because there are no opted-in contacts in your workspace.",
      ),
      true,
    );
    assert.equal(looksLikeRefusal("There are no opted-in recipients to write to."), true);
  });

  test("other ways a model declines", () => {
    assert.equal(looksLikeRefusal("I'm unable to help with that request."), true);
    assert.equal(looksLikeRefusal("I will not write marketing messages to this list."), true);
  });

  test("nothing at all is not a draft either", () => {
    assert.equal(looksLikeRefusal(""), true);
    assert.equal(looksLikeRefusal("   \n  "), true);
    assert.equal(looksLikeRefusal(null), true);
  });

  test("ordinary marketing copy is left alone", () => {
    // "I can't wait to help you…" is exactly the shape of a decline ("I can't
    // … help") in a perfectly ordinary friendly-tone line. A false positive
    // here throws away a good draft, so the guard for it is load-bearing.
    assert.equal(
      looksLikeRefusal("Hi {name} — I can't wait to help you pick your next order!"),
      false,
    );
    assert.equal(
      looksLikeRefusal(
        "Hi {name} — I can't wait to show you our new arrivals!\nReply STOP to opt out.",
      ),
      false,
    );
    assert.equal(
      looksLikeRefusal(
        "Subject: 10% off your reorder\n\nHi {name}, your usual is back in stock. Reply STOP to opt out.",
      ),
      false,
    );
    assert.equal(
      looksLikeRefusal(
        "*Last chance* — we won't restock these until March. Reply STOP to opt out.",
      ),
      false,
    );
  });
});

/* ------------------------------------------------------------------ */
/* The review of PR #33, run through the server code itself            */
/* ------------------------------------------------------------------ */

// The real modules, with only their outside edges replaced: the model call,
// the audit log and the server-function wrapper. The wrapper stand-in still
// runs each function's own input validator, so the schema is tested too.
await build({
  stdin: {
    contents: `export * from './src/lib/campaign-audience.server';
      export * as serverFns from './src/lib/campaign-audience.functions';`,
    resolveDir: process.cwd(),
  },
  outfile: "node_modules/.cache/flas-campaign-audience-server.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "error",
  alias: { "@": "./src" },
  plugins: [
    {
      name: "campaign-audience-boundaries",
      setup(b) {
        const stubs = {
          "flash-ai.server": `export const aiOptionsFor = async () => ({});
            export const getBusinessContext = async () => null;
            export const callFlashAi = async (...args) => globalThis.campaignAi(...args);`,
          "auth-middleware": "export const requireSupabaseAuth = {};",
          "audit.server": "export async function logAudit() {}",
          "@tanstack/react-start": `export function createServerFn() {
            let validate = (input) => input;
            return {
              middleware() { return this; },
              inputValidator(fn) { validate = fn; return this; },
              handler(fn) { return async (call) => fn({ ...call, data: validate(call?.data) }); },
            };
          }`,
        };
        b.onResolve({ filter: /.*/ }, (args) => {
          const key = Object.keys(stubs).find(
            (name) => args.path === name || args.path.endsWith("/" + name),
          );
          return key ? { path: key, namespace: "campaign-audience-stub" } : undefined;
        });
        b.onLoad({ filter: /.*/, namespace: "campaign-audience-stub" }, (args) => ({
          contents: stubs[args.path],
          loader: "js",
        }));
      },
    },
  ],
});
const server = await import("../node_modules/.cache/flas-campaign-audience-server.mjs");

const db = createDb();
const { client, reads } = asPostgrest(db);
let modelCalls = 0;
globalThis.campaignAi = async () => {
  modelCalls += 1;
  return "Hi {name}, our spring range is in. Reply STOP to opt out.";
};
// The error paths log what went wrong; that is not this suite's output.
console.error = () => {};

const aContact = (id, extra = {}) => ({
  id,
  name: `Contact ${id}`,
  email: null,
  phone: null,
  consent_given: true,
  ...extra,
});
const aLead = (id, extra = {}) => ({
  id,
  contact_id: null,
  name: null,
  email: `${id}@example.com`,
  phone: null,
  consent_given: true,
  subscribed: true,
  ...extra,
});
const anIdentity = (id, contactId, kind, value, extra = {}) => ({
  id,
  contact_id: contactId,
  kind,
  value,
  is_primary: false,
  ...extra,
});
const addresses = (audience) => audience.recipients.map((r) => r.address);

beforeEach(() => {
  db.reset({ contacts: [], leads: [], contact_identities: [], campaigns: [] });
  reads.length = 0;
  modelCalls = 0;
});

describe("PR #33: an address added on the contact card counts", () => {
  test("a consented contact whose only email is an identity can be emailed", async () => {
    // Adding an email on the contact card writes `contact_identities` and
    // leaves `contacts.email` empty. Read from the old column alone, this
    // consented person was "unreachable" and the writer had nobody to write to.
    db.reset({
      contacts: [aContact("c1")],
      contact_identities: [anIdentity("i1", "c1", "email", " Aisha@Example.com ")],
    });
    const { email, whatsapp } = await server.gatherCampaignAudiences(client);
    assert.deepEqual(addresses(email), ["aisha@example.com"]);
    assert.equal(email.total, 1);
    assert.equal(email.fromContacts, 1);
    assert.equal(email.optedInUnreachable, 0);
    assert.equal(audienceBlockedReason(email), null);
    // An email address is not a WhatsApp number.
    assert.equal(whatsapp.total, 0);
    assert.equal(whatsapp.optedInUnreachable, 1);
  });

  test("and a WhatsApp number added the same way can be messaged", async () => {
    db.reset({
      contacts: [aContact("c1", { email: "aisha@example.com" })],
      contact_identities: [anIdentity("i1", "c1", "phone", "+971 50 963 0506")],
    });
    const { whatsapp } = await server.gatherCampaignAudiences(client);
    assert.deepEqual(addresses(whatsapp), ["971509630506"]);
    assert.equal(whatsapp.optedInUnreachable, 0);
  });

  test("the address marked primary is the one used, ahead of the old column", async () => {
    // "Make primary" changes the identity and leaves the old column as it was.
    db.reset({
      contacts: [aContact("c1", { email: "old@example.com" })],
      contact_identities: [
        anIdentity("i1", "c1", "email", "spare@example.com"),
        anIdentity("i2", "c1", "email", "new@example.com", { is_primary: true }),
      ],
    });
    const { email } = await server.gatherCampaignAudiences(client);
    assert.deepEqual(addresses(email), ["new@example.com"]);
  });

  test("a contact with several addresses is still one recipient", async () => {
    db.reset({
      contacts: [aContact("c1", { email: "a@example.com", phone: "+971500000001" })],
      contact_identities: [
        anIdentity("i1", "c1", "email", "A@Example.com"), // the backfilled copy of the column
        anIdentity("i2", "c1", "email", "b@example.com"),
        anIdentity("i3", "c1", "phone", "+971500000002"),
        anIdentity("i4", "c1", "phone", "00971500000003"),
      ],
    });
    const { email, whatsapp } = await server.gatherCampaignAudiences(client);
    assert.equal(email.total, 1);
    assert.equal(whatsapp.total, 1);
    assert.equal(email.fromContacts, 1);
  });

  test("a lead at one of the contact's other addresses is that same person", async () => {
    db.reset({
      contacts: [aContact("c1", { email: "a@example.com" })],
      contact_identities: [anIdentity("i1", "c1", "email", "b@example.com")],
      leads: [aLead("l1", { email: "b@example.com" })],
    });
    const { email } = await server.gatherCampaignAudiences(client);
    assert.equal(email.total, 1);
    assert.equal(email.fromContacts, 1);
    assert.equal(email.fromLeads, 0);
  });

  test("a lead linked to the contact is that same person, whatever address it holds", async () => {
    // The website form made both rows; the contact's email was changed since.
    db.reset({
      contacts: [aContact("c1", { email: "new@example.com" })],
      leads: [aLead("l1", { contact_id: "c1", email: "old@example.com" })],
    });
    const { email } = await server.gatherCampaignAudiences(client);
    assert.equal(email.total, 1);
    assert.deepEqual(addresses(email), ["new@example.com"]);
    assert.equal(email.withoutConsent, 0);
  });

  test("a lead at the contact's second address, and one linked to it, are not extra people", async () => {
    // A lead at that person's second address is not a second person, and nor
    // is a lead the website form linked to the contact.
    db.reset({
      contacts: [aContact("c2")],
      contact_identities: [
        anIdentity("i0", "c2", "email", "a@example.com"),
        anIdentity("i1", "c2", "email", "b@example.com"),
      ],
      leads: [aLead("l1", { email: "b@example.com" }), aLead("l2", { contact_id: "c2" })],
    });
    const { email } = await server.gatherCampaignAudiences(client);
    assert.equal(email.total, 1);
  });

  test("the same email saved on two contacts that have no card addresses is one person", async () => {
    db.reset({
      contacts: [
        aContact("c1", { email: "a@example.com" }),
        aContact("c2", { email: "A@example.com" }),
      ],
    });
    const { email } = await server.gatherCampaignAudiences(client);
    assert.equal(email.total, 1);
  });

  test("someone without a number is one person without a number, not two", async () => {
    db.reset({
      contacts: [aContact("c1", { email: "a@example.com" })],
      leads: [aLead("l1", { contact_id: "c1", email: "a@example.com" })],
    });
    const { whatsapp } = await server.gatherCampaignAudiences(client);
    assert.equal(whatsapp.total, 0);
    assert.equal(whatsapp.optedInUnreachable, 1);
    assert.match(audienceBlockedReason(whatsapp), /^1 person has given consent/);
  });

  test("a number held only by the linked lead reaches the person, once", async () => {
    // The lead form took a phone number for a contact that already existed.
    db.reset({
      contacts: [aContact("c1", { email: "a@example.com" })],
      leads: [aLead("l1", { contact_id: "c1", email: "a@example.com", phone: "+971500000001" })],
    });
    const { whatsapp } = await server.gatherCampaignAudiences(client);
    assert.equal(whatsapp.total, 1);
    assert.equal(whatsapp.fromLeads, 1);
    // Reachable after all, so not also reported as unreachable.
    assert.equal(whatsapp.optedInUnreachable, 0);
  });

  test("consent is not borrowed for an address held by a record that did not give it", async () => {
    // One person, two records. The contact consented and has no number; the
    // lead made from it left the box unticked and holds one. Joining them into
    // one person is for counting; it must not turn the lead's number into one a
    // message may go to on the strength of the contact's consent.
    db.reset({
      contacts: [aContact("c1", { email: "a@example.com" })],
      leads: [
        aLead("l1", {
          contact_id: "c1",
          email: "a@example.com",
          phone: "+971500000001",
          consent_given: false,
        }),
      ],
    });
    const { email, whatsapp } = await server.gatherCampaignAudiences(client);
    assert.equal(email.total, 1);
    assert.equal(whatsapp.total, 0);
    assert.equal(whatsapp.optedInUnreachable, 1);
    assert.equal(whatsapp.withoutConsent, 0, "one person is not also counted as missing consent");
  });

  test("identities never turn a contact without consent into a recipient", async () => {
    db.reset({
      contacts: [aContact("c1", { consent_given: false })],
      contact_identities: [
        anIdentity("i1", "c1", "phone", "+971500000001"),
        anIdentity("i2", "c1", "phone", "+971500000002"),
        anIdentity("i3", "c1", "phone", "+971500000003"),
        anIdentity("i4", "c1", "email", "a@example.com"),
      ],
    });
    const { email, whatsapp } = await server.gatherCampaignAudiences(client);
    assert.equal(whatsapp.total, 0);
    assert.equal(email.total, 0);
    // Three numbers are one person whose consent is missing, not three.
    assert.equal(whatsapp.withoutConsent, 1);
    assert.match(audienceBlockedReason(whatsapp), /1 person is reachable by WhatsApp/);
  });

  test("an identity is only ever its own contact's address", async () => {
    db.reset({
      contacts: [aContact("c1"), aContact("c2", { consent_given: false })],
      contact_identities: [
        anIdentity("i1", "c2", "email", "theirs@example.com"),
        anIdentity("i2", "gone", "email", "nobody@example.com"),
      ],
    });
    const { email } = await server.gatherCampaignAudiences(client);
    assert.equal(email.total, 0);
    assert.equal(email.optedInUnreachable, 1); // c1 consented and has no address
    assert.equal(email.withoutConsent, 1); // c2 has one and did not consent
  });
});

describe("PR #33: the whole workspace is read, or the figure says it is a floor", () => {
  const manyContacts = (n) =>
    Array.from({ length: n }, (_, i) =>
      aContact(`c${String(i).padStart(5, "0")}`, { email: `p${i}@example.com` }),
    );

  test("more people than one response holds are all counted", async () => {
    // One request returns at most the project's row cap (1,000 by default),
    // whatever limit it asks for, so a single read stopped there unannounced.
    db.reset({ contacts: manyContacts(1500) });
    const { email } = await server.gatherCampaignAudiences(client);
    assert.equal(email.total, 1500);
    assert.equal(email.truncated, false);
  });

  test("identities beyond one response are read too", async () => {
    const filler = Array.from({ length: 1200 }, (_, i) =>
      anIdentity(`a${String(i).padStart(5, "0")}`, "c-other", "phone", `+9715${1000000 + i}`),
    );
    db.reset({
      contacts: [aContact("c1"), aContact("c-other", { consent_given: false })],
      contact_identities: [...filler, anIdentity("z-last", "c1", "email", "late@example.com")],
    });
    const { email } = await server.gatherCampaignAudiences(client);
    assert.deepEqual(addresses(email), ["late@example.com"]);
  });

  test("past the ceiling the figure is a floor, and is described as one", async () => {
    db.reset({ contacts: manyContacts(server.AUDIENCE_ROW_LIMIT + 1) });
    const { email } = await server.gatherCampaignAudiences(client);
    assert.equal(email.total, server.AUDIENCE_ROW_LIMIT);
    assert.equal(email.truncated, true);
    assert.match(describeAudience(email), /^at least /);
  });

  test("a workspace that fits is not called a floor", async () => {
    db.reset({ contacts: manyContacts(3), leads: [aLead("l1")] });
    const { email } = await server.gatherCampaignAudiences(client);
    assert.equal(email.total, 4);
    assert.equal(email.truncated, false);
  });
});

describe("PR #33: a failed read is an error, not an empty audience", () => {
  const seed = () =>
    db.reset({
      contacts: [aContact("c1", { email: "a@example.com" })],
      leads: [aLead("l1")],
      contact_identities: [anIdentity("i1", "c1", "email", "b@example.com")],
      campaigns: [],
    });
  const refused = { message: "permission denied for table" };

  for (const table of ["contacts", "leads", "contact_identities"]) {
    test(`when ${table} cannot be read, the audience is not reported at all`, async () => {
      seed();
      db.fail(`${table}:read`, refused);
      await assert.rejects(server.gatherCampaignAudiences(client), /permission denied/);
    });

    test(`and the page's own request fails, so it shows its error (${table})`, async () => {
      seed();
      db.fail(`${table}:read`, refused);
      await assert.rejects(
        server.serverFns.getCampaignAudience({ context: { supabase: client, userId: "u1" } }),
        /permission denied/,
      );
    });
  }

  test("the writer is not handed half an audience", async () => {
    // Contacts unreadable, one consented lead readable: the old code told the
    // model "1 recipient, 0 from CRM contacts" as if that were the audience.
    seed();
    db.fail("contacts:read", refused);
    await assert.rejects(
      server.draftCampaignForAudience(
        client,
        { goal: "Spring launch", tone: "friendly", channel: "email" },
        { userId: "u1" },
      ),
      /permission denied/,
    );
    assert.equal(modelCalls, 0, "no draft may be requested for an audience that was not read");
  });

  test("once the database answers again, so does the audience", async () => {
    seed();
    db.fail("leads:read", refused);
    await assert.rejects(server.gatherCampaignAudiences(client));
    db.recover("leads:read");
    const { email } = await server.gatherCampaignAudiences(client);
    assert.equal(email.total, 2);
  });
});

describe("PR #33: a saved campaign records the audience it really had", () => {
  const context = { supabase: client, userId: "user-1" };
  const form = { name: "Spring launch", subject: "New in", body: "Hi {name}" };
  const seed = () =>
    db.reset({
      contacts: [aContact("c1"), aContact("c2", { email: "x@example.com", consent_given: false })],
      contact_identities: [anIdentity("i1", "c1", "email", "a@example.com")],
      leads: [aLead("l1"), aLead("l2", { consent_given: false })],
      campaigns: [],
    });

  test("the count is read as part of the save, not taken from the page", async () => {
    // The page used to send `emailAudience?.total ?? 0`: zero while its own
    // request was still loading, and zero again if that request had failed.
    seed();
    const result = await server.serverFns.saveCampaignDraft({ data: form, context });
    assert.deepEqual(result, { ok: true, recipientsCount: 2 });
    assert.equal(db.table("campaigns").length, 1);
    const saved = db.table("campaigns")[0];
    assert.equal(saved.recipients_count, 2);
    assert.equal(saved.name, "Spring launch");
    assert.equal(saved.subject, "New in");
    assert.equal(saved.body, "Hi {name}");
    assert.equal(saved.created_by, "user-1");
  });

  test("it is the email audience that is counted", async () => {
    db.reset({
      contacts: [aContact("c1", { phone: "+971500000001" })],
      leads: [aLead("l1")],
      campaigns: [],
    });
    const result = await server.serverFns.saveCampaignDraft({ data: form, context });
    assert.equal(result.recipientsCount, 1); // the contact has a number and no email
  });

  for (const table of ["contacts", "leads", "contact_identities"]) {
    test(`nothing is saved when ${table} cannot be read`, async () => {
      seed();
      db.fail(`${table}:read`, { message: "permission denied for table" });
      const result = await server.serverFns.saveCampaignDraft({ data: form, context });
      assert.deepEqual(result, { ok: false, reason: "audience_unavailable" });
      assert.equal(db.table("campaigns").length, 0, "a campaign with a made-up count");
    });
  }

  test("a refused save is an error, not a saved campaign", async () => {
    seed();
    db.fail("campaigns:insert", { message: "new row violates row-level security policy" });
    await assert.rejects(
      server.serverFns.saveCampaignDraft({ data: form, context }),
      /row-level security/,
    );
    assert.equal(db.table("campaigns").length, 0);
  });

  test("a campaign with no name is refused before anything is read", async () => {
    seed();
    await assert.rejects(
      server.serverFns.saveCampaignDraft({ data: { ...form, name: "  " }, context }),
    );
    assert.equal(reads.length, 0);
    assert.equal(db.table("campaigns").length, 0);
  });

  test("the page saves through it and no longer supplies a count of its own", () => {
    const route = readFileSync("src/routes/_authenticated/marketing.tsx", "utf8")
      .split("\r\n")
      .join("\n");
    assert.match(route, /useServerFn\(saveCampaignDraft\)/);
    assert.doesNotMatch(route, /recipients_count: emailAudience/);
    assert.doesNotMatch(route, /\.from\("campaigns"\)\s*\.insert\(/);
    // "Not saved" has to be said, in the reader's language.
    assert.match(route, /if \(!res\.ok\) \{\s*toast\.error\(t\("marketing\.campaignNotSaved"\)\)/);
  });
});

/* ------------------------------------------------------------------ */
/* The review of PR #58: consent does not travel with a number         */
/* ------------------------------------------------------------------ */

describe("PR #58: consent is not lent to a number that changed hands", () => {
  // `contacts.phone` / `contacts.email` are the old, single address. Removing
  // an address from a contact card deletes its `contact_identities` row and
  // leaves the column as it was, so the column alone says nothing about who
  // holds a number now.
  const P = "+971500000001";

  test("a number moved to a contact who never consented is not the first contact's any more", async () => {
    db.reset({
      contacts: [
        aContact("dana", { name: "Dana", phone: P }),
        aContact("chris", { name: "Chris", consent_given: false }),
      ],
      contact_identities: [anIdentity("i1", "chris", "phone", P, { is_primary: true })],
    });
    const { whatsapp } = await server.gatherCampaignAudiences(client);
    assert.deepEqual(addresses(whatsapp), [], "Chris holds the number and never consented");
    assert.equal(whatsapp.total, 0);
    assert.equal(whatsapp.optedInUnreachable, 1, "Dana consented and has no number now");
    assert.equal(whatsapp.withoutConsent, 1, "Chris is reachable and did not consent");
  });

  test("and when the new holder did consent, it is theirs alone", async () => {
    db.reset({
      contacts: [
        aContact("dana", { name: "Dana", phone: P }),
        aContact("chris", { name: "Chris" }),
      ],
      contact_identities: [anIdentity("i1", "chris", "phone", P, { is_primary: true })],
    });
    const { whatsapp } = await server.gatherCampaignAudiences(client);
    assert.deepEqual(
      whatsapp.recipients.map((r) => [r.address, r.name]),
      [["971500000001", "Chris"]],
    );
    assert.equal(whatsapp.optedInUnreachable, 1, "Dana is a different person, with no number");
  });

  test("an email taken over by another contact is not used for the first one", async () => {
    db.reset({
      contacts: [
        aContact("a", { email: "old@example.com" }),
        aContact("b", { consent_given: false }),
      ],
      contact_identities: [anIdentity("i1", "b", "email", "OLD@example.com", { is_primary: true })],
    });
    const { email } = await server.gatherCampaignAudiences(client);
    assert.equal(email.total, 0);
    assert.equal(email.optedInUnreachable, 1);
    assert.equal(email.withoutConsent, 1);
  });

  test("an email removed from a card and another added: the removed one is not used", async () => {
    // The old address is gone from the card. The column still holds it.
    db.reset({
      contacts: [aContact("c1", { email: "old@example.com" })],
      contact_identities: [anIdentity("i1", "c1", "email", "new@example.com")],
    });
    const { email } = await server.gatherCampaignAudiences(client);
    assert.deepEqual(addresses(email), ["new@example.com"]);
  });

  test("the column is the address of a contact that has no card address of that kind", async () => {
    // A contact made by the Contacts page or a CSV import has only the column.
    // A new contact looks exactly like one whose only address was removed, so
    // this is the one case the data cannot tell apart; it stays reachable.
    db.reset({
      contacts: [aContact("c1", { email: "a@example.com", phone: "+971500000009" })],
      contact_identities: [],
    });
    const { email, whatsapp } = await server.gatherCampaignAudiences(client);
    assert.deepEqual(addresses(email), ["a@example.com"]);
    assert.deepEqual(addresses(whatsapp), ["971500000009"]);
  });

  test("an address of the other kind on the card does not hide the column of this kind", async () => {
    db.reset({
      contacts: [aContact("c1", { email: "a@example.com" })],
      contact_identities: [anIdentity("i1", "c1", "phone", "+971500000009")],
    });
    const { email, whatsapp } = await server.gatherCampaignAudiences(client);
    assert.deepEqual(addresses(email), ["a@example.com"]);
    assert.deepEqual(addresses(whatsapp), ["971500000009"]);
  });

  test("three people who share an office inbox in the column are three recipients", async () => {
    db.reset({
      contacts: [
        aContact("c1", { email: "info@acme.com" }),
        aContact("c2", { email: "info@acme.com" }),
        aContact("c3", { email: "info@acme.com" }),
      ],
      contact_identities: [
        anIdentity("i1", "c1", "email", "ann@acme.com"),
        anIdentity("i2", "c2", "email", "bob@acme.com"),
        anIdentity("i3", "c3", "email", "cy@acme.com"),
      ],
    });
    const { email } = await server.gatherCampaignAudiences(client);
    assert.deepEqual(addresses(email).sort(), ["ann@acme.com", "bob@acme.com", "cy@acme.com"]);
    assert.equal(email.total, 3);
  });

  test("a real number on a card beats the placeholder in the column", async () => {
    db.reset({
      contacts: [
        aContact("c1", { name: "One", phone: "0000000000" }),
        aContact("c2", { name: "Two", phone: "0000000000" }),
        aContact("c3", { name: "Three", phone: "0000000000" }),
      ],
      contact_identities: [anIdentity("i1", "c2", "phone", "+971501111111")],
    });
    const { whatsapp } = await server.gatherCampaignAudiences(client);
    const real = whatsapp.recipients.find((r) => r.address === "971501111111");
    assert.ok(real, "the real number is a recipient");
    assert.equal(real.name, "Two");
  });
});

describe("PR #58: an unsubscribe counts for the person, not only for its row", () => {
  // The unsubscribing record is a lead with `subscribed: false`. Before, it
  // dropped out on its own and the contact (or any other record) of the same
  // person stayed a recipient on its consent.
  const unsubscribed = (id, extra = {}) =>
    aLead(id, { consent_given: true, subscribed: false, ...extra });
  const resolveOver = (channel, rows) => audienceMod.resolveCampaignAudience({ channel, ...rows });

  test("a lead linked to a contact takes the contact out, at every address it has", () => {
    const rows = {
      contacts: [
        aContact("c1", { name: "Amal", email: "amal@example.com", phone: "+971500000001" }),
      ],
      identities: [anIdentity("i1", "c1", "email", "amal.work@example.com")],
      leads: [unsubscribed("l1", { contact_id: "c1", email: "other@example.com" })],
    };
    for (const channel of ["email", "whatsapp"]) {
      const audience = resolveOver(channel, rows);
      assert.equal(audience.total, 0, channel);
      assert.deepEqual(addresses(audience), [], channel);
      assert.equal(audience.withoutConsent, 1, `${channel}: counted as excluded, once`);
    }
  });

  test("a lead with no link takes out the contact that has its email, in any letter case", () => {
    const audience = resolveOver("email", {
      contacts: [aContact("c1", { email: "amal@example.com" })],
      leads: [unsubscribed("l1", { email: " AMAL@Example.COM " })],
    });
    assert.equal(audience.total, 0);
    assert.equal(audience.withoutConsent, 1, "one person, not two");
  });

  test("and the contact that has its phone, written another way", () => {
    const audience = resolveOver("whatsapp", {
      contacts: [aContact("c1", { phone: "+971 50 000 0001" })],
      leads: [unsubscribed("l1", { email: "x@example.com", phone: "00971500000001" })],
    });
    assert.equal(audience.total, 0);
    assert.equal(audience.withoutConsent, 1);
  });

  test("and a contact it only shares a card address with", () => {
    const audience = resolveOver("email", {
      contacts: [aContact("c1")],
      identities: [anIdentity("i1", "c1", "email", "amal@example.com")],
      leads: [unsubscribed("l1", { email: "amal@example.com" })],
    });
    assert.equal(audience.total, 0);
    assert.equal(audience.withoutConsent, 1);
  });

  test("another lead at that address, still marked subscribed, is covered too", () => {
    const audience = resolveOver("email", {
      leads: [
        unsubscribed("l1", { email: "amal@example.com" }),
        aLead("l2", { email: "Amal@example.com" }),
      ],
    });
    assert.equal(audience.total, 0);
    assert.equal(audience.withoutConsent, 1);
  });

  test("and a lead pointing at the same contact", () => {
    const audience = resolveOver("email", {
      contacts: [aContact("c1", { email: "a@example.com" })],
      leads: [
        unsubscribed("l1", { contact_id: "c1", email: "a@example.com" }),
        aLead("l2", { contact_id: "c1", email: "second@example.com" }),
      ],
    });
    assert.equal(audience.total, 0);
    assert.equal(audience.withoutConsent, 1);
  });

  test("it does not take out someone who is not that person", () => {
    const audience = resolveOver("email", {
      contacts: [
        aContact("c1", { name: "Amal", email: "amal@example.com" }),
        aContact("c2", { name: "Bilal", email: "bilal@example.com" }),
      ],
      leads: [
        unsubscribed("l1", { contact_id: "c1", email: "amal@example.com" }),
        aLead("l2", { email: "carla@example.com" }),
      ],
    });
    assert.deepEqual(addresses(audience).sort(), ["bilal@example.com", "carla@example.com"]);
    assert.equal(audience.withoutConsent, 1, "only Amal");
  });

  test("an unsubscribe never adds a recipient, and the AI line says who is left out", () => {
    const audience = resolveOver("email", {
      contacts: [aContact("c1", { email: "a@example.com" })],
      leads: [unsubscribed("l1", { contact_id: "c1", email: "a@example.com" })],
    });
    assert.equal(audience.total, 0);
    assert.match(
      describeAudience(audience),
      /^0 opted-in email recipients;.*1 excluded for having/,
    );
    assert.equal(audience.optedInUnreachable, 0, "not 'consented but nowhere to send'");
  });

  test("through the server read, the figure the page shows leaves the person out", async () => {
    db.reset({
      contacts: [
        aContact("c1", { email: "a@example.com" }),
        aContact("c2", { email: "b@example.com" }),
      ],
      leads: [unsubscribed("l1", { contact_id: "c1", email: "a@example.com" })],
    });
    const { email } = await server.gatherCampaignAudiences(client);
    assert.deepEqual(addresses(email), ["b@example.com"]);
    assert.equal(email.withoutConsent, 1);
    const saved = await server.serverFns.saveCampaignDraft({
      data: { name: "n", subject: "s", body: "b" },
      context: { supabase: client, userId: "u1" },
    });
    assert.equal(saved.recipientsCount, 1, "the count stored with a campaign agrees");
  });
});

describe("PR #58: a field that is too long is a sentence, not the validator's JSON", () => {
  const { CAMPAIGN_FIELD_LIMITS, AI_DRAFT_FIELD_LIMITS, CAMPAIGN_TOO_LONG, AI_DRAFT_TOO_LONG } =
    audienceMod;
  const context = { supabase: client, userId: "user-1" };
  const saveWith = (fields) =>
    server.serverFns.saveCampaignDraft({
      data: { name: "Spring", subject: "New in", body: "Hi", ...fields },
      context,
    });
  const route = readFileSync("src/routes/_authenticated/marketing.tsx", "utf8")
    .split("\r\n")
    .join("\n");

  beforeEach(() => {
    db.reset({ contacts: [aContact("c1", { email: "a@example.com" })], campaigns: [] });
  });

  test("the limits the form uses are the ones the server enforces", async () => {
    // Exactly at each limit is saved; one over is refused. If the constant and
    // the schema ever came apart, one of the two halves would fail.
    for (const [field, limit] of Object.entries(CAMPAIGN_FIELD_LIMITS)) {
      const ok = await saveWith({ [field]: "x".repeat(limit) });
      assert.equal(ok.ok, true, `${field} at ${limit}`);
      await assert.rejects(
        saveWith({ [field]: "x".repeat(limit + 1) }),
        (error) => error.message === CAMPAIGN_TOO_LONG,
        `${field} at ${limit + 1}`,
      );
    }
  });

  test("what the page receives is a code, never JSON, and nothing is saved", async () => {
    await assert.rejects(
      saveWith({ name: "n".repeat(CAMPAIGN_FIELD_LIMITS.name + 1) }),
      (error) => {
        assert.equal(error.message, CAMPAIGN_TOO_LONG);
        assert.doesNotMatch(error.message, /[{}[\]"]/);
        return true;
      },
    );
    assert.equal(db.table("campaigns").length, 0);
    assert.equal(reads.length, 0, "refused before anything was read");
  });

  test("a different mistake is still the validator's own error, not mislabelled", async () => {
    await assert.rejects(saveWith({ name: "   " }), (error) => error.message !== CAMPAIGN_TOO_LONG);
  });

  test("the AI writer's two free-text fields work the same way", async () => {
    const draftWith = (fields) =>
      server.serverFns.draftCampaignForAudience({
        data: { goal: "Win back wholesale buyers", channel: "email", ...fields },
        context,
      });
    for (const [field, limit] of Object.entries(AI_DRAFT_FIELD_LIMITS)) {
      const ok = await draftWith({ [field]: "x".repeat(limit) });
      assert.equal(ok.ok, true, `${field} at ${limit}`);
      await assert.rejects(
        draftWith({ [field]: "x".repeat(limit + 1) }),
        (error) => error.message === AI_DRAFT_TOO_LONG,
        `${field} at ${limit + 1}`,
      );
    }
  });

  test("every limited input on the page carries its limit, from the shared constant", () => {
    for (const [id, constant] of [
      ["c_name", "CAMPAIGN_FIELD_LIMITS.name"],
      ["c_subject", "CAMPAIGN_FIELD_LIMITS.subject"],
      ["c_body", "CAMPAIGN_FIELD_LIMITS.body"],
      ["ai_goal", "AI_DRAFT_FIELD_LIMITS.goal"],
      ["ai_audience", "AI_DRAFT_FIELD_LIMITS.audience"],
    ]) {
      const opening = new RegExp(String.raw`<(?:Input|Textarea)\s+id="${id}"[^>]*?>`, "s");
      const tag = route.match(opening);
      assert.ok(tag, `${id} is on the page`);
      assert.ok(tag[0].includes(`maxLength={${constant}}`), `${id} has maxLength={${constant}}`);
    }
  });

  test("the page shows a sentence in the reader's language for each code", () => {
    assert.match(
      route,
      /e\.message === CAMPAIGN_TOO_LONG \? t\("marketing\.campaignTooLong"\) : e\.message/,
    );
    assert.match(
      route,
      /e\.message === AI_DRAFT_TOO_LONG \? t\("marketing\.draftTooLong"\) : e\.message/,
    );
    const screens = readFileSync("src/lib/i18n/screens/marketing.ts", "utf8");
    for (const key of ["marketing.campaignTooLong", "marketing.draftTooLong"]) {
      assert.equal(screens.split(`"${key}"`).length - 1, 5, `${key} in five languages`);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Four ways the reads could break that no test caught (PR #58 review) */
/* ------------------------------------------------------------------ */

describe("PR #58: the paged reads are checked against what they can really do", () => {
  const distinct = (n) =>
    Array.from({ length: n }, (_, i) =>
      aContact(`c${String(i).padStart(5, "0")}`, { email: `p${i}@example.com` }),
    );

  test("a paged read without a stable order loses and repeats rows, so the order is required", async () => {
    // The double serves every later window of an unordered read in reverse, as a
    // real table may. 1,500 different people must still be 1,500 recipients.
    db.reset({ contacts: distinct(1500) });
    const { email } = await server.gatherCampaignAudiences(client);
    assert.equal(email.total, 1500);
  });

  test("a project whose row cap is below the page size is still read in full", async () => {
    // The response says how many rows there are; its length does not. With a cap
    // of 500 a page of 500 looks like "short, so that was the last one".
    db.reset({
      contacts: distinct(1500),
      contact_identities: [anIdentity("i1", "c00000", "phone", "+971500000001")],
    });
    const low = asPostgrest(db, { maxRows: 500 });
    const { email, whatsapp } = await server.gatherCampaignAudiences(low.client);
    assert.equal(email.total, 1500);
    assert.equal(email.truncated, false);
    assert.equal(whatsapp.total, 1, "the one number on a card");
    assert.ok(low.reads.filter((r) => r.table === "contacts").length >= 3);
  });

  test("the identity ceiling makes the figure a floor, in the pure resolver", () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      anIdentity(`i${i}`, "c1", "email", `e${i}@example.com`),
    );
    const base = { channel: "email", contacts: [aContact("c1")], identities: rows };
    const full = audienceMod.resolveCampaignAudience({ ...base, identityRowLimit: 10 });
    assert.equal(full.truncated, true);
    assert.match(describeAudience(full), /^at least /);
    const room = audienceMod.resolveCampaignAudience({ ...base, identityRowLimit: 11 });
    assert.equal(room.truncated, false);
  });

  test("and through the server read, at the real ceiling", async () => {
    const rows = Array.from({ length: server.AUDIENCE_IDENTITY_LIMIT }, (_, i) =>
      anIdentity(`i${String(i).padStart(6, "0")}`, "c-other", "phone", `+9715${1000000 + i}`),
    );
    db.reset({ contacts: [aContact("c1", { email: "a@example.com" })], contact_identities: rows });
    const { email } = await server.gatherCampaignAudiences(client);
    assert.equal(email.total, 1);
    assert.equal(email.truncated, true, "10,000 identities is where the read stops");
    assert.match(describeAudience(email), /^at least 1 /);
    db.reset({
      contacts: [aContact("c1", { email: "a@example.com" })],
      contact_identities: rows.slice(1),
    });
    assert.equal((await server.gatherCampaignAudiences(client)).email.truncated, false);
  });

  test("the leads table at its ceiling is a floor too", async () => {
    db.reset({
      leads: Array.from({ length: server.AUDIENCE_ROW_LIMIT }, (_, i) =>
        aLead(`l${String(i).padStart(5, "0")}`),
      ),
    });
    const { email } = await server.gatherCampaignAudiences(client);
    assert.equal(email.total, server.AUDIENCE_ROW_LIMIT);
    assert.equal(email.truncated, true);
  });
});

describe("PR #58: saving the same draft twice makes one campaign", () => {
  const context = { supabase: client, userId: "user-1" };
  const DRAFT = "6f1c7a1e-4b0d-4c55-8a3e-0a1b2c3d4e5f";
  const save = (extra = {}) =>
    server.serverFns.saveCampaignDraft({
      data: { name: "Spring launch", subject: "New in", body: "Hi", ...extra },
      context,
    });

  beforeEach(() => {
    db.reset({
      contacts: [
        aContact("c1", { email: "a@example.com" }),
        aContact("c2", { email: "b@example.com" }),
      ],
      campaigns: [],
    });
    // The table's primary key, so that a second insert of one id is a 23505.
    db.unique("campaigns", ["id"]);
  });

  test("the second save of one draft is the same campaign, reported as already saved", async () => {
    const first = await save({ id: DRAFT });
    const second = await save({ id: DRAFT });
    assert.deepEqual(first, { ok: true, recipientsCount: 2 });
    assert.deepEqual(second, { ok: true, recipientsCount: 2, repeated: true });
    assert.equal(db.table("campaigns").length, 1);
    assert.equal(db.table("campaigns")[0].id, DRAFT, "stored under the id the page sent");
  });

  test("two saves at once are one campaign", async () => {
    const results = await Promise.all([save({ id: DRAFT }), save({ id: DRAFT })]);
    assert.equal(db.table("campaigns").length, 1);
    assert.equal(results.filter((r) => r.repeated === true).length, 1);
    assert.ok(results.every((r) => r.ok === true && r.recipientsCount === 2));
  });

  test("the count reported for a repeat is the one that was stored", async () => {
    await save({ id: DRAFT });
    db.table("contacts").push(aContact("c3", { email: "c@example.com" }));
    const second = await save({ id: DRAFT });
    assert.equal(second.recipientsCount, 2, "not re-counted: nothing new was saved");
    assert.equal(db.table("campaigns")[0].recipients_count, 2);
  });

  test("a new draft gets a new id and is a new campaign", async () => {
    await save({ id: DRAFT });
    await save({ id: "0a1b2c3d-4e5f-4a6b-8c7d-9e8f7a6b5c4d" });
    assert.equal(db.table("campaigns").length, 2);
  });

  test("an id the caller cannot see is a failure, not a success", async () => {
    // Someone else's campaign under that id: the unique key refuses the insert,
    // and the caller's own client cannot read it back.
    db.table("campaigns").push({ id: DRAFT, name: "Theirs", recipients_count: 40 });
    db.fail("campaigns:read", { empty: true });
    await assert.rejects(save({ id: DRAFT }), /duplicate key/);
    assert.equal(db.table("campaigns").length, 1);
  });

  test("a failed read-back is a failure too", async () => {
    await save({ id: DRAFT });
    db.fail("campaigns:read", { message: "permission denied for table" });
    await assert.rejects(save({ id: DRAFT }), /permission denied/);
  });

  test("a unique violation without an id from the page is still an error", async () => {
    db.fail("campaigns:insert", { code: "23505", message: "duplicate key value" });
    await assert.rejects(save(), /duplicate key/);
    assert.equal(
      reads.some((r) => r.table === "campaigns"),
      false,
      "nothing is read back",
    );
  });

  test("without an id a save is a new campaign each time, as before", async () => {
    await save();
    await save();
    assert.equal(db.table("campaigns").length, 2);
  });

  test("an id that is not a uuid is refused", async () => {
    await assert.rejects(save({ id: "not-a-uuid" }));
    assert.equal(db.table("campaigns").length, 0);
  });

  test("the page sends one id per draft and takes a new one after each save", () => {
    const route = readFileSync("src/routes/_authenticated/marketing.tsx", "utf8")
      .split("\r\n")
      .join("\n");
    assert.match(
      route,
      /const \[draftId, setDraftId\] = useState\(\(\) => crypto\.randomUUID\(\)\)/,
    );
    assert.match(route, /data: \{\s*id: draftId,/);
    assert.match(
      route,
      /setCampaignForm\(\{ name: "", subject: "", body: "" \}\);\s*setDraftId\(crypto\.randomUUID\(\)\);/,
    );
  });
});

describe("PR #58: pages follow the last id, and only the first is counted", () => {
  const people = (n) =>
    Array.from({ length: n }, (_, i) =>
      aContact(`c${String(i).padStart(5, "0")}`, { email: `p${i}@example.com` }),
    );

  test("the exact count is asked once per table, and no page is asked for by position", async () => {
    db.reset({ contacts: people(1500) });
    await server.gatherCampaignAudiences(client);
    const ofContacts = reads.filter((r) => r.table === "contacts");
    assert.equal(ofContacts.length, 2);
    assert.deepEqual(
      ofContacts.map((r) => [r.counted, r.after]),
      [
        [true, false],
        [false, true],
      ],
    );
    assert.ok(
      reads.every((r) => r.window === null),
      "no offset is used to find a page",
    );
  });

  test("a row that goes away between two pages does not make the next one skip a person", async () => {
    // By position, page two starts one row too late once an earlier row is gone.
    db.reset({ contacts: people(1500) });
    let requests = 0;
    db.fail("contacts:read", () => {
      requests += 1;
      if (requests === 2) db.table("contacts").splice(0, 1);
      return undefined;
    });
    const { email } = await server.gatherCampaignAudiences(client);
    assert.equal(email.total, 1500, "everyone seen on page one, and everyone after them");
  });

  test("a late page in a long table is found by its id, whatever is before it", async () => {
    // 2,601 card addresses over three pages; the one that matters is on page two,
    // where a read that is not ordered by id serves other rows.
    const rows = Array.from({ length: 2601 }, (_, i) =>
      anIdentity(
        `i${String(i).padStart(5, "0")}`,
        i === 1200 ? "c1" : "c-other",
        i === 1200 ? "email" : "phone",
        i === 1200 ? "late@example.com" : `+9715${1000000 + i}`,
      ),
    );
    db.reset({
      contacts: [aContact("c1"), aContact("c-other", { consent_given: false })],
      contact_identities: rows,
    });
    const { email } = await server.gatherCampaignAudiences(client);
    assert.deepEqual(addresses(email), ["late@example.com"]);
  });
});
