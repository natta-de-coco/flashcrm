// The three QA findings from 26 Sep 2026, each pinned by a test that fails if
// the fix is reverted.
//
//   H12  a contact holding +971509630506 was described as having "Nothing
//        recorded yet", because the dialog read contact_identities alone
//   H13  a contact card could not be opened into a detail view at all
//   L1   the pipeline board totalled nothing per stage
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const {
  draftAfterSave,
  formatStageMoney,
  hasUnsavedNotes,
  inboxConversationHref,
  normalizeIdentityValue,
  notesFieldValue,
  reachLines,
  reachSummary,
  stageTotal,
} = await import("../node_modules/.cache/flas-contacts.mjs");

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

const identity = (over = {}) => ({
  id: "11111111-1111-1111-1111-111111111111",
  kind: "phone",
  value: "+971559876543",
  label: null,
  is_primary: false,
  branch_id: null,
  ...over,
});

describe("H12 — the contact's own number is listed", () => {
  it("shows contacts.phone when no identity row exists", () => {
    // The exact report: a contact with +971509630506 and no identity rows, which
    // is every contact the New contact form has ever created.
    const lines = reachLines({ phone: "+971509630506", email: null }, []);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].value, "+971509630506");
  });

  it("labels it so the user knows it is the primary", () => {
    const [line] = reachLines({ phone: "+971509630506" }, []);
    assert.equal(line.isPrimary, true);
    assert.match(line.label, /primary/i);
  });

  it("shows the email the same way", () => {
    const lines = reachLines({ email: "sara@example.com" }, []);
    assert.deepEqual(
      lines.map((l) => [l.kind, l.value]),
      [["email", "sara@example.com"]],
    );
  });

  it("carries no identity id, so the row cannot be deleted or re-flagged", () => {
    // There is no contact_identities row behind it. A delete button here would
    // send a null id at the server and fail.
    const [line] = reachLines({ phone: "+971509630506" }, []);
    assert.equal(line.id, null);
    assert.equal(line.fromContactRow, true);
  });

  it("does not list the same number twice", () => {
    const lines = reachLines({ phone: "+971509630506" }, [
      identity({ value: "+971509630506", is_primary: true }),
    ]);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].fromContactRow, false, "the real identity row must win");
  });

  it("matches across spellings, the way the database does", () => {
    // "+971 50 963 0506" and "+971509630506" are one number. Listing both would
    // look like the duplicate-contact problem this whole feature exists to fix.
    const lines = reachLines({ phone: "+971 50 963 0506" }, [identity({ value: "+971509630506" })]);
    assert.equal(lines.length, 1);
  });

  it("keeps a genuinely different number", () => {
    const lines = reachLines({ phone: "+971509630506" }, [identity({ value: "+971559876543" })]);
    assert.equal(lines.length, 2);
  });

  it("ignores a blank or whitespace-only phone column", () => {
    assert.deepEqual(reachLines({ phone: "   ", email: "" }, []), []);
    assert.deepEqual(reachLines({}, []), []);
  });

  it("puts the contact record's own number first", () => {
    const lines = reachLines({ phone: "+971509630506" }, [identity({ value: "+971559876543" })]);
    assert.equal(lines[0].value, "+971509630506");
  });

  it("drops a kind the UI cannot render", () => {
    // kind is CHECK-constrained to phone/email in the database, but the column
    // is text; an unknown kind must not reach the icon switch.
    assert.deepEqual(reachLines({}, [identity({ kind: "fax" })]), []);
  });

  it("summarises the lines for the card", () => {
    const lines = reachLines({ phone: "+971509630506", email: "s@e.com" }, [
      identity({ value: "+971559876543" }),
    ]);
    assert.equal(reachSummary(lines), "2 numbers · 1 email");
    assert.equal(reachSummary([]), "");
  });

  it("normalises exactly as the SQL function does", () => {
    // Mirrors public.normalize_contact_identity. The bare-digits case for a
    // number without a leading + is the SQL's behaviour, not an oversight.
    assert.equal(normalizeIdentityValue("phone", "+971 50 963 0506"), "+971509630506");
    assert.equal(normalizeIdentityValue("phone", "0509630506"), "0509630506");
    assert.equal(normalizeIdentityValue("email", "  Sara@Example.COM "), "sara@example.com");
    assert.equal(normalizeIdentityValue("phone", null), "");
  });
});

describe("one primary of each kind (review of PR #32)", () => {
  // The report: a contact made with the New contact form has its number only in
  // contacts.phone. Add a second number, press "Make primary" — and the card
  // showed two primary numbers, because the line built from the contact row was
  // marked primary whatever the identities said.
  const primaries = (lines, kind) => lines.filter((l) => l.kind === kind && l.isPrimary);

  it("shows the chosen number as the only primary", () => {
    const lines = reachLines({ phone: "+971509630506" }, [
      identity({ value: "+971559876543", is_primary: true }),
    ]);
    assert.deepEqual(
      primaries(lines, "phone").map((l) => l.value),
      ["+971559876543"],
      "exactly one primary phone, and it is the one the person chose",
    );
  });

  it("stops calling the number on the record primary once another is", () => {
    const lines = reachLines({ phone: "+971509630506" }, [
      identity({ value: "+971559876543", is_primary: true }),
    ]);
    const onRecord = lines.find((l) => l.fromContactRow);
    assert.equal(onRecord.isPrimary, false);
    assert.doesNotMatch(onRecord.label, /primary/i);
    assert.equal(onRecord.value, "+971509630506", "the number itself is still listed");
  });

  it("keeps the number on the record as primary while no identity is", () => {
    const lines = reachLines({ phone: "+971509630506" }, [identity({ value: "+971559876543" })]);
    assert.deepEqual(
      primaries(lines, "phone").map((l) => l.value),
      ["+971509630506"],
    );
  });

  it("decides phones and emails separately", () => {
    // A primary email says nothing about which phone is primary, and the other
    // way round.
    const lines = reachLines({ phone: "+971509630506", email: "sara@example.com" }, [
      identity({ id: "e1", kind: "email", value: "accounts@example.com", is_primary: true }),
    ]);
    assert.deepEqual(
      primaries(lines, "phone").map((l) => l.value),
      ["+971509630506"],
    );
    assert.deepEqual(
      primaries(lines, "email").map((l) => l.value),
      ["accounts@example.com"],
    );
  });

  it("never shows two primaries of a kind, whichever rows it is given", () => {
    for (const phone of [null, "+971509630506"]) {
      for (const first of [false, true]) {
        for (const second of [false, true]) {
          if (first && second) continue; // the database's unique index forbids it
          const lines = reachLines({ phone }, [
            identity({ id: "p1", value: "+971559876543", is_primary: first }),
            identity({ id: "p2", value: "+971501112222", is_primary: second }),
          ]);
          const count = primaries(lines, "phone").length;
          const expected = phone || first || second ? 1 : 0;
          assert.equal(count, expected, JSON.stringify({ phone, first, second }));
        }
      }
    }
  });
});

describe("what the notes box shows (review of PR #32)", () => {
  const SARA = "contact-sara";
  const OMAR = "contact-omar";

  it("shows the saved note when nothing has been typed", () => {
    assert.equal(notesFieldValue(SARA, "Call before 10am", null), "Call before 10am");
    assert.equal(notesFieldValue(SARA, null, null), "");
    assert.equal(notesFieldValue(SARA, undefined, null), "");
  });

  it("shows what is being typed for this contact over the saved note", () => {
    assert.equal(notesFieldValue(SARA, "saved", { contactId: SARA, text: "typing" }), "typing");
    // Cleared on purpose is still typing: an empty box, not the saved note back.
    assert.equal(notesFieldValue(SARA, "saved", { contactId: SARA, text: "" }), "");
  });

  it("never shows one contact's typing on another contact", () => {
    const draft = { contactId: SARA, text: "about Sara" };
    assert.equal(notesFieldValue(OMAR, "Omar's note", draft), "Omar's note");
    assert.equal(notesFieldValue(null, undefined, draft), "");
    assert.equal(hasUnsavedNotes(OMAR, draft), false);
    assert.equal(hasUnsavedNotes(SARA, draft), true);
    assert.equal(hasUnsavedNotes(SARA, null), false);
  });

  it("clears the typing once exactly that text has been saved", () => {
    const draft = { contactId: SARA, text: "first" };
    assert.equal(draftAfterSave(draft, { contactId: SARA, text: "first" }), null);
  });

  it("keeps words typed after Save was pressed", () => {
    const draft = { contactId: SARA, text: "first, and more" };
    assert.deepEqual(draftAfterSave(draft, { contactId: SARA, text: "first" }), draft);
  });

  it("keeps another contact's typing when an earlier save answers", () => {
    const draft = { contactId: OMAR, text: "first" };
    assert.deepEqual(draftAfterSave(draft, { contactId: SARA, text: "first" }), draft);
    assert.equal(draftAfterSave(null, { contactId: SARA, text: "first" }), null);
  });
});

describe("L1 — the pipeline board totals each stage", () => {
  const board = [
    { stage: "new", value: 1 },
    { stage: "new", value: 2500 },
    { stage: "negotiation", value: 12000 },
    { stage: "won", value: null },
  ];

  it("adds the deal values in one stage", () => {
    assert.deepEqual(stageTotal(board, "new"), { count: 2, total: 2501 });
  });

  it("counts a contact with no value without breaking the total", () => {
    assert.deepEqual(stageTotal(board, "won"), { count: 1, total: 0 });
  });

  it("is zero for an empty stage", () => {
    assert.deepEqual(stageTotal(board, "lost"), { count: 0, total: 0 });
  });

  it("adds numeric columns that arrive as strings", () => {
    // Postgres numeric comes back from supabase-js as a string once it is large
    // enough; "1" + "2" would otherwise total "12".
    assert.equal(
      stageTotal(
        [
          { stage: "new", value: "1" },
          { stage: "new", value: "2" },
        ],
        "new",
      ).total,
      3,
    );
  });

  it("never lets one unparseable value poison the column", () => {
    const rows = [
      { stage: "new", value: "not a number" },
      { stage: "new", value: 500 },
    ];
    assert.equal(stageTotal(rows, "new").total, 500);
  });

  it("formats a total in the workspace currency", () => {
    assert.match(formatStageMoney(2501, "AED"), /2,501/);
    assert.ok(!formatStageMoney(2501, "AED").includes(".00"), "whole units on a board total");
  });

  it("survives a currency code Intl does not know", () => {
    // organizations.currency is free text from onboarding. A throw inside render
    // would blank the whole board.
    assert.equal(formatStageMoney(2501, "NOTACURRENCY"), "NOTACURRENCY 2,501");
    assert.match(formatStageMoney(10, null), /10/);
  });

  it("puts the total in the column heading", () => {
    // The arithmetic being right is no use if the board does not render it,
    // which is exactly the state the tester found.
    const board = read("src/routes/_authenticated/contacts.tsx");
    const heading = board.slice(board.indexOf("STAGES.map(("), board.indexOf("<Card key={c.id}>"));
    assert.match(heading, /stageTotal\(rows, stage\.id\)/);
    assert.match(heading, /formatStageMoney\(total, tenant\?\.currency\)/);
  });

  it("totals the rows on screen, not every contact in the workspace", () => {
    // Searching narrows the cards; a heading that kept totalling the unfiltered
    // list would contradict the cards underneath it.
    const board = read("src/routes/_authenticated/contacts.tsx");
    assert.match(board, /const rows = filtered\.filter\(\(c\) => c\.stage === stage\.id\);/);
    assert.match(board, /stageTotal\(rows,/);
  });
});

describe("H13 — a contact opens into a detail view", () => {
  const dialog = read("src/components/contacts/ContactDetailDialog.tsx");
  const route = read("src/routes/_authenticated/contacts.tsx");
  const server = read("src/lib/contact-identities.functions.ts");
  // Bounded at the next export: saveContactNotes also touches `contacts`, and a
  // slice running to end-of-file would let it satisfy assertions about the read.
  const getDetail = server.slice(
    server.indexOf("export const getContactDetail"),
    server.indexOf("export const saveContactNotes"),
  );

  it("makes the contact name on the card open the dialog", () => {
    // The only way in used to be a 10px "Numbers & branches" link under the
    // name, which the tester did not find. Asserted as "the element that renders
    // {c.name} carries the onClick", not merely "the card has an onClick
    // somewhere" — the latter stayed true with the name back to plain text.
    const card = route.slice(route.indexOf("CardContent"));
    const nameElement = card.slice(0, card.indexOf("{c.name}"));
    const opener = /onClick=\{\(\) => setDetailFor\(\{ id: c\.id, name: c\.name \}\)\}/;
    assert.match(nameElement.slice(nameElement.lastIndexOf("<")), opener);
  });

  it("loads the contact row, not just its identities", () => {
    assert.ok(getDetail.length > 0, "getContactDetail must come before saveContactNotes");
    assert.match(getDetail, /\.from\("contacts"\)/);
    assert.match(getDetail, /\.from\("conversations"\)/);
    // The phone and email columns are the whole point of H12: reachLines cannot
    // fold in what the query did not select.
    assert.match(getDetail, /"id, name, phone, email, company, tags, stage, value/);
  });

  it("reads the contact through the caller's RLS client, never supabaseAdmin", () => {
    // A contact id is a uuid in a URL-shaped payload; served by supabaseAdmin
    // this endpoint would read any workspace's customer phone numbers.
    assert.ok(
      !server.includes("client.server"),
      "contact detail must stay on the RLS-scoped client, not the service-role one",
    );
    assert.match(getDetail, /context\.supabase\s*\n?\s*\.from\("contacts"\)/);
  });

  it("folds the contact row into the list the dialog renders", () => {
    assert.match(dialog, /reachLines\(contact \?\? \{\}, identities\)/);
  });

  it("shows stage, deal value and tags", () => {
    // The stage name is now the reader's language, read by the stage's id.
    assert.match(dialog, /t\(`stage\.\$\{contact\.stage\}`\)/);
    assert.match(
      dialog,
      /formatStageMoney\(Number\(contact\?\.value \?\? 0\), tenant\?\.currency\)/,
    );
    assert.match(dialog, /contact\?\.tags \?\? \[\]/);
  });

  it("links a conversation into the existing inbox", () => {
    assert.equal(
      inboxConversationHref("abc-123"),
      "/inbox?conversation=abc-123",
      "the inbox route is the one messaging path",
    );
    assert.match(dialog, /inboxConversationHref\(/);
  });

  it("escapes the conversation id it puts in the URL", () => {
    assert.equal(inboxConversationHref("a b&c"), "/inbox?conversation=a%20b%26c");
  });

  it("does not grow a second send path inside the dialog", () => {
    // Consent checks, template rules and the audit trail all live on the inbox
    // send path. A composer here would route around every one of them.
    for (const forbidden of ["sendAgentMessage", "sendTemplateMessage"]) {
      assert.ok(!dialog.includes(forbidden), `${forbidden} must stay in the inbox`);
    }
  });

  it("says so when there is no thread yet, rather than offering a dead button", () => {
    // Said through a translation key; the English is still that sentence.
    assert.match(dialog, /t\("contactCard\.noConversationYet"\)/);
    const messages = fs.readFileSync(
      new URL("../src/lib/i18n/screens/contact-card.ts", import.meta.url),
      "utf8",
    );
    assert.match(messages, /"contactCard\.noConversationYet":\s*"No conversation yet/);
  });
});
