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
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { mkdirSync } from "node:fs";

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
