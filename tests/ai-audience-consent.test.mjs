// What the AI is told about who it may write to.
//
//   npm run test:bot-context
//
// gatherLeadSummary counted `consent_given || subscribed` over the leads table
// alone. `subscribed` defaults to true and nothing in the product ever sets it
// false, so every lead counted as consented — while a workspace whose only
// consented person is a contact was told nobody had opted in, and the campaign
// writer refused to write (QA H8). Both halves are wrong, in opposite directions.
//
// The review of that fix (PR #35) found three more ways the number was wrong:
// a website lead and the contact made from it were added together as two
// opt-ins, the total came from the first 500 rows of each table, and the
// advisor was told "Total 0 leads, 1 opted in". These run the real summary
// against a database double, because a number is only proved by counting.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { createDb } from "./support/db-double.mjs";
import { asPostgrest } from "./support/postgrest-double.mjs";
import * as summaryModule from "../node_modules/.cache/flas-onboarding.mjs";

const { gatherLeadSummary, leadSummaryFacts } = summaryModule;

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
    .split("\r\n")
    .join("\n");

// The advisor itself, so what it is told is read from what it builds rather
// than from a pattern over its source.
await build({
  entryPoints: ["src/lib/advisor.server.ts"],
  outfile: "node_modules/.cache/flas-advisor.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "error",
  alias: { "@": "./src" },
  plugins: [
    {
      name: "advisor-boundaries",
      setup(b) {
        b.onResolve({ filter: /client\.server$/ }, () => ({
          path: "client.server",
          namespace: "advisor-stub",
        }));
        b.onLoad({ filter: /.*/, namespace: "advisor-stub" }, () => ({
          contents:
            "export const supabaseAdmin = new Proxy({}, {get: (_, key) => globalThis.advisorDb[key]});",
          loader: "js",
        }));
      },
    },
  ],
});
const { gatherAdvisorSnapshot } = await import("../node_modules/.cache/flas-advisor.mjs");

const db = createDb();
const { client, reads } = asPostgrest(db);
globalThis.advisorDb = client;
// Nothing here may reach a network: the advisor's other sections are best-effort.
globalThis.fetch = async () => {
  throw new Error("no network in this suite");
};

const days = (n) => new Date(Date.UTC(2026, 8, 1) + n * 864e5).toISOString();
const aLead = (i, extra = {}) => ({
  id: `l${String(i).padStart(5, "0")}`,
  contact_id: null,
  source: "wordpress",
  tags: [],
  consent_given: false,
  subscribed: true,
  created_at: days(i / 100),
  ...extra,
});
const aContact = (i, extra = {}) => ({
  id: `c${String(i).padStart(5, "0")}`,
  stage: "new",
  consent_given: false,
  created_at: days(i / 100),
  ...extra,
});
const OPTED_IN = { consent_given: true };

beforeEach(() => {
  db.reset({ leads: [], contacts: [] });
  reads.length = 0;
});

describe("consent counted for the AI is real consent", () => {
  it("requires consent_given, and does not treat subscribed as consent", async () => {
    db.reset({
      leads: [
        aLead(1, { consent_given: false, subscribed: true }), // captured, never ticked the box
        aLead(2, { consent_given: true, subscribed: true }),
        aLead(3, { consent_given: true, subscribed: false }), // opted in, then unsubscribed
      ],
      contacts: [],
    });
    const summary = await gatherLeadSummary(client);
    assert.equal(summary.totalLeads, 3);
    assert.equal(summary.optedInLeads, 1);
    assert.equal(summary.optedInPeople, 1);
  });

  it("counts consented contacts, not only website leads", async () => {
    // The tester's exact case: 0 leads, 1 contact showing "Consented".
    db.reset({ leads: [], contacts: [aContact(1, OPTED_IN), aContact(2)] });
    const summary = await gatherLeadSummary(client);
    assert.equal(summary.optedInPeople, 1);
    assert.equal(summary.optedInContacts, 1);
    assert.equal(summary.totalContacts, 2);
  });

  it("reports each half separately, so the number can be checked", async () => {
    db.reset({
      leads: [aLead(1, OPTED_IN), aLead(2)],
      contacts: [aContact(1, OPTED_IN), aContact(2, OPTED_IN), aContact(3)],
    });
    const summary = await gatherLeadSummary(client);
    assert.equal(summary.optedInLeads, 1);
    assert.equal(summary.optedInContacts, 2);
    assert.equal(summary.optedInPeople, 3);
  });
});

describe("PR #35: one person is one opt-in", () => {
  it("a website lead and the contact made from it are counted once", async () => {
    // The website form writes both rows with the same consent and links them
    // through leads.contact_id. Adding the two tables made this one person two.
    db.reset({
      contacts: [aContact(1, OPTED_IN)],
      leads: [aLead(1, { ...OPTED_IN, contact_id: "c00001" })],
    });
    const summary = await gatherLeadSummary(client);
    assert.equal(summary.optedInPeople, 1);
    // Each table still reports its own row truthfully.
    assert.equal(summary.optedInLeads, 1);
    assert.equal(summary.optedInContacts, 1);
  });

  it("ten sign-ups through the website form are ten people, not twenty", async () => {
    const contacts = Array.from({ length: 10 }, (_, i) => aContact(i, OPTED_IN));
    const leads = contacts.map((c, i) => aLead(i, { ...OPTED_IN, contact_id: c.id }));
    db.reset({ contacts, leads });
    assert.equal((await gatherLeadSummary(client)).optedInPeople, 10);
  });

  it("a lead that is not linked to a contact is its own person", async () => {
    db.reset({ contacts: [aContact(1, OPTED_IN)], leads: [aLead(1, OPTED_IN)] });
    assert.equal((await gatherLeadSummary(client)).optedInPeople, 2);
  });

  it("a consented lead still counts when its contact has not consented", async () => {
    db.reset({
      contacts: [aContact(1)],
      leads: [aLead(1, { ...OPTED_IN, contact_id: "c00001" })],
    });
    const summary = await gatherLeadSummary(client);
    assert.equal(summary.optedInPeople, 1);
    assert.equal(summary.optedInContacts, 0);
  });

  it("an unsubscribed lead does not un-count the contact, and is not counted itself", async () => {
    db.reset({
      contacts: [aContact(1, OPTED_IN)],
      leads: [aLead(1, { ...OPTED_IN, subscribed: false, contact_id: "c00001" })],
    });
    const summary = await gatherLeadSummary(client);
    assert.equal(summary.optedInLeads, 0);
    assert.equal(summary.optedInPeople, 1);
  });

  it("two leads pointing at one contact are one person", async () => {
    db.reset({
      contacts: [aContact(1)],
      leads: [
        aLead(1, { ...OPTED_IN, contact_id: "c00001" }),
        aLead(2, { ...OPTED_IN, contact_id: "c00001" }),
      ],
    });
    assert.equal((await gatherLeadSummary(client)).optedInPeople, 1);
  });
});

describe("PR #35: totals are counts of the whole table, not of the first rows", () => {
  it("counts consent held by contacts beyond the first 500", async () => {
    // 1,700 contacts; the 1,100 who opted in are all outside the first 500 rows
    // and spread over more than one response.
    const contacts = Array.from({ length: 1700 }, (_, i) =>
      aContact(i, { consent_given: i >= 600 }),
    );
    db.reset({ contacts, leads: [] });
    const summary = await gatherLeadSummary(client);
    assert.equal(summary.totalContacts, 1700);
    assert.equal(summary.optedInContacts, 1100);
    assert.equal(summary.optedInPeople, 1100);
    assert.equal(summary.optedInIsFloor, false);
  });

  it("counts every lead, and every lead's consent", async () => {
    const leads = Array.from({ length: 1340 }, (_, i) => aLead(i, { consent_given: i % 2 === 0 }));
    db.reset({ leads, contacts: [] });
    const summary = await gatherLeadSummary(client);
    assert.equal(summary.totalLeads, 1340);
    assert.equal(summary.optedInLeads, 670);
    assert.equal(summary.optedInPeople, 670);
  });

  it("de-duplicates across responses as well as within one", async () => {
    const contacts = Array.from({ length: 1200 }, (_, i) => aContact(i, OPTED_IN));
    const leads = contacts.map((c, i) => aLead(i, { ...OPTED_IN, contact_id: c.id }));
    db.reset({ contacts, leads: [...leads, aLead(5000, OPTED_IN)] });
    const summary = await gatherLeadSummary(client);
    assert.equal(summary.optedInPeople, 1201);
  });

  it("the breakdowns are a sample, and say so", async () => {
    const leads = Array.from({ length: 620 }, (_, i) =>
      // The 120 oldest came from Shopify; the newest 500 are all WordPress.
      aLead(i, { source: i < 120 ? "shopify" : "wordpress", tags: i < 120 ? ["old"] : ["new"] }),
    );
    const contacts = Array.from({ length: 530 }, (_, i) =>
      aContact(i, { stage: i < 30 ? "won" : "new" }),
    );
    db.reset({ leads, contacts });
    const summary = await gatherLeadSummary(client);
    assert.equal(summary.totalLeads, 620);
    assert.equal(summary.sampledLeads, 500);
    assert.deepEqual(summary.bySource, { wordpress: 500 });
    assert.equal(summary.sampledContacts, 500);
    assert.deepEqual(summary.contactsByStage, { new: 500 });

    const facts = leadSummaryFacts(summary).join("\n");
    assert.match(facts, /Website leads: 620 in total/);
    assert.match(facts, /Lead sources \(from the 500 most recent of 620 leads\): wordpress=500/);
    assert.match(facts, /Top tags \(from the 500 most recent of 620 leads\): new/);
    assert.match(facts, /Pipeline stages \(from the 500 most recent of 530 contacts\): new=500/);
  });

  it("a breakdown that covers everyone is not called a sample", async () => {
    db.reset({
      leads: [aLead(1, { source: "shopify", tags: ["vip"] })],
      contacts: [aContact(1, { stage: "won" })],
    });
    const facts = leadSummaryFacts(await gatherLeadSummary(client)).join("\n");
    assert.match(facts, /Lead sources: shopify=1/);
    assert.match(facts, /Top tags: vip/);
    assert.match(facts, /Pipeline stages: won=1/);
    assert.doesNotMatch(facts, /most recent/);
  });

  it("totals are asked of the database as counts, not read off a page of rows", async () => {
    db.reset({ leads: [aLead(1)], contacts: [aContact(1)] });
    await gatherLeadSummary(client);
    for (const table of ["leads", "contacts"]) {
      assert.ok(
        reads.some((r) => r.table === table && r.head),
        `${table} must be counted with a head request`,
      );
    }
  });

  it("the people figure is given as a floor when the scan was cut short", () => {
    const facts = leadSummaryFacts({
      totalLeads: 90000,
      totalContacts: 90000,
      optedInLeads: 20000,
      optedInContacts: 20000,
      optedInPeople: 20000,
      optedInIsFloor: true,
      sampledLeads: 500,
      bySource: {},
      topTags: [],
      sampledContacts: 500,
      contactsByStage: {},
    }).join("\n");
    // The database counted these two, so they are not floors; only the figure
    // that needs the rows themselves is.
    assert.match(facts, /Website leads: 90000 in total, 20000 opted in/);
    assert.match(facts, /Contacts: 90000 in total, 20000 opted in/);
    assert.match(facts, /Opted-in people overall: at least 20000/);
  });

  it("a scan that hits its ceiling reports a floor, and never more than it found", async () => {
    // 2,500 opted-in contacts, 600 website leads linked to the first 600 of them
    // and 100 unlinked ones; the scan is allowed to read 1,500 rows of a table.
    const contacts = Array.from({ length: 2500 }, (_, i) => aContact(i, OPTED_IN));
    const leads = [
      ...contacts.slice(0, 600).map((c, i) => aLead(i, { ...OPTED_IN, contact_id: c.id })),
      ...Array.from({ length: 100 }, (_, i) => aLead(1000 + i, OPTED_IN)),
    ];
    db.reset({ contacts, leads });
    const summary = await gatherLeadSummary(client, { scanLimit: 1500 });
    assert.equal(summary.optedInContacts, 2500);
    assert.equal(summary.optedInLeads, 700);
    assert.equal(summary.optedInIsFloor, true);
    // True answer: 2,600. It may be lower than that, never higher, and it is
    // never lower than the contacts alone.
    assert.ok(summary.optedInPeople >= 2500, String(summary.optedInPeople));
    assert.ok(summary.optedInPeople <= 2600, String(summary.optedInPeople));
    assert.match(leadSummaryFacts(summary).join("\n"), /Opted-in people overall: at least /);

    // Given room to finish, the same data is exact.
    const exact = await gatherLeadSummary(client, { scanLimit: 5000 });
    assert.equal(exact.optedInIsFloor, false);
    assert.equal(exact.optedInPeople, 2600);
  });
});

describe("PR #35: the advisor is given figures it can state", () => {
  it("consent held only by a contact is not reported as leads who opted in", async () => {
    // Was: "Total 0 leads, 1 opted in".
    db.reset({ leads: [], contacts: [aContact(1, OPTED_IN)] });
    const { facts } = await gatherAdvisorSnapshot(client);
    assert.doesNotMatch(facts, /Total 0 leads, 1 opted in/);
    assert.match(facts, /Website leads: 0 in total, 0 opted in/);
    assert.match(facts, /Contacts: 1 in total, 1 opted in/);
    assert.match(facts, /Opted-in people overall: 1 /);
  });

  it("no line ever claims more opt-ins than there are people on it", async () => {
    db.reset({
      contacts: [aContact(1, OPTED_IN), aContact(2, OPTED_IN), aContact(3)],
      leads: [aLead(1, { ...OPTED_IN, contact_id: "c00001" })],
    });
    const { facts } = await gatherAdvisorSnapshot(client);
    const pairs = [...facts.matchAll(/: (\d+) in total, (\d+) opted in/g)];
    assert.equal(pairs.length, 2, "one line for website leads, one for contacts");
    for (const [line, total, optedIn] of pairs) {
      assert.ok(Number(optedIn) <= Number(total), line);
    }
    assert.match(facts, /Opted-in people overall: 2 /);
  });

  it("the campaign writer's prompt uses the same lines", () => {
    // If these diverge, two features report different consent counts for one
    // workspace — which is the class of defect the QA report is full of.
    const fns = read("src/lib/flash-ai.functions.ts");
    assert.match(fns, /leadSummaryFacts\(leads\)/);
    assert.match(read("src/lib/advisor.server.ts"), /leadSummaryFacts\(leads\)/);
    assert.ok(
      !/\$\{leads\.totalLeads\} leads \(\$\{leads\.consentedLeads\} consented\)/.test(fns),
      "describing a mixed audience as N leads is what sent the model looking at the wrong table",
    );
  });
});

describe("a failed read is not a count of zero", () => {
  const refused = { message: "permission denied for table" };

  for (const table of ["leads", "contacts"]) {
    it(`when ${table} cannot be read there is no summary`, async () => {
      db.reset({ leads: [aLead(1, OPTED_IN)], contacts: [aContact(1, OPTED_IN)] });
      db.fail(`${table}:read`, refused);
      await assert.rejects(gatherLeadSummary(client), /permission denied/);
    });

    it(`and the advisor is told it is unknown, not that nobody opted in (${table})`, async () => {
      db.reset({ leads: [aLead(1, OPTED_IN)], contacts: [aContact(1, OPTED_IN)] });
      db.fail(`${table}:read`, refused);
      const { facts } = await gatherAdvisorSnapshot(client);
      assert.match(facts, /## Leads & pipeline\nNot available/);
      assert.doesNotMatch(facts, /opted in/);
    });
  }
});
