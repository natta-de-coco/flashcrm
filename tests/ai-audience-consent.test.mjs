// What the AI is told about who it may write to.
//
// gatherLeadSummary counted `consent_given || subscribed` over the leads table
// alone. `subscribed` defaults to true and nothing in the product ever sets it
// false, so every lead counted as consented — while a workspace whose only
// consented person is a contact was told nobody had opted in, and the campaign
// writer refused to write (QA H8). Both halves are wrong, in opposite directions.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
    .split("\r\n")
    .join("\n");
const SERVER = read("src/lib/flash-ai.server.ts");
const summary = SERVER.slice(
  SERVER.indexOf("export async function gatherLeadSummary"),
  SERVER.indexOf(
    "export async function",
    SERVER.indexOf("export async function gatherLeadSummary") + 10,
  ),
);

describe("consent counted for the AI is real consent", () => {
  it("requires consent_given, and does not treat subscribed as consent", () => {
    assert.match(summary, /lead\.consent_given === true && lead\.subscribed !== false/);
    assert.ok(
      !/lead\.consent_given \|\| lead\.subscribed/.test(summary),
      "`consent_given || subscribed` marks every lead consented, because subscribed defaults to true",
    );
  });

  it("counts consented contacts, not only website leads", () => {
    // The tester's exact case: 0 leads, 1 contact showing "Consented".
    assert.match(summary, /\.select\("stage, consent_given"\)/);
    assert.match(summary, /if \(c\.consent_given === true\) consentedContacts \+= 1;/);
    assert.match(summary, /consentedLeads: consented \+ consentedContacts/);
  });

  it("reports the contact half separately, so the number can be checked", () => {
    assert.match(SERVER, /consentedContacts: number;/);
  });
});

describe("the prompt does not call contacts leads", () => {
  const fns = read("src/lib/flash-ai.functions.ts");

  it("says what the audience actually is", () => {
    assert.match(fns, /website leads plus your contacts/);
    assert.match(fns, /consentedContacts/);
    assert.ok(
      !/\$\{leads\.totalLeads\} leads \(\$\{leads\.consentedLeads\} consented\)/.test(fns),
      "describing a mixed audience as N leads is what sent the model looking at the wrong table",
    );
  });
});

describe("the advisor reads the same number", () => {
  it("still uses consentedLeads, so both features agree", () => {
    // If these diverge, two screens report different consent counts for one
    // workspace — which is the class of defect the QA report is full of.
    assert.match(read("src/lib/advisor.server.ts"), /leads\.consentedLeads/);
  });
});
