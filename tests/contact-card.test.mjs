// The contact card, driven the way a person drives it: opened, closed, opened
// again, typed into while a save is still on its way. Three review findings on
// the card (PR #32) were about exactly those sequences —
//
//   notes blank   reopening a contact that was already loaded showed an empty
//                 notes box, so a saved note could be overwritten unseen
//   notes lost    typing on while a save was in flight threw the newer text away
//                 when the older save answered
//   two primaries a contact whose number lives only on its record showed two
//                 "Primary" numbers once another number was made primary
//
// — so the real component runs here, with its effects in order, and the real
// server functions run against the database double.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { runInNewContext } from "node:vm";

import {
  compileComponent,
  deferred,
  hookRuntime,
  jsxRuntime,
  loadLib,
  mutationDouble,
  named,
  nodes,
  text,
} from "./support/component-double.mjs";
import { createDb } from "./support/db-double.mjs";
import { i18nModules } from "./support/i18n-double.mjs";

const { saveContactNotes, setPrimaryIdentity } =
  await import("../node_modules/.cache/flas-contact-functions.mjs");

const compiled = compileComponent(
  new URL("../src/components/contacts/ContactDetailDialog.tsx", import.meta.url),
);
// The list and the notes rules are the real ones, not stand-ins.
const contactsView = loadLib(new URL("../src/lib/contacts-view.ts", import.meta.url));
const validationMessage = loadLib(new URL("../src/lib/validation-message.ts", import.meta.url));

const SARA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OMAR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OFFICE = "11111111-1111-4111-8111-111111111111";
const MOBILE = "22222222-2222-4222-8222-222222222222";
const SARA_EMAIL = "33333333-3333-4333-8333-333333333333";
const OMAR_PHONE = "44444444-4444-4444-8444-444444444444";
const GONE = "99999999-9999-4999-8999-999999999999";
const NOBODY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/** What getContactDetail returns for one contact. */
function detail(contact = {}, identities = []) {
  return {
    contact: {
      id: SARA,
      name: "Sara Khan",
      phone: null,
      email: null,
      company: null,
      tags: [],
      stage: "new",
      value: 0,
      notes: null,
      consent_given: false,
      consent_at: null,
      ...contact,
    },
    identities,
    branches: [],
    conversations: [],
  };
}

const identity = (over = {}) => ({
  id: OFFICE,
  kind: "phone",
  value: "+971559876543",
  label: "Office",
  is_primary: false,
  branch_id: null,
  ...over,
});

/** The card on screen, with the query cache and the server in the test's hands. */
function card() {
  const cache = new Map(); // contact id -> the detail last loaded for it
  const failed = new Set(); // contact ids whose detail could not be loaded
  const saves = []; // one per "Save notes" request: what was sent, and its answer
  const primaries = []; // every "Make primary" request
  const toasts = []; // everything the person was told: { kind, message }
  const refetched = []; // the query keys the card asked to be read again
  let primaryFailure = null; // an error "Make primary" answers with, when set
  const runtime = hookRuntime();
  const mutation = mutationDouble();
  let shown = null;

  const modules = {
    "react/jsx-runtime": jsxRuntime,
    react: runtime.react,
    "@tanstack/react-query": {
      useQueryClient: () => ({
        invalidateQueries: async ({ queryKey }) => {
          refetched.push(queryKey);
        },
        setQueryData(key, next) {
          const after = typeof next === "function" ? next(cache.get(key[1])) : next;
          if (after !== undefined) cache.set(key[1], after);
        },
      }),
      useQuery({ queryKey, enabled }) {
        const id = queryKey[1];
        const data = enabled === false ? undefined : cache.get(id);
        const isError = enabled !== false && data === undefined && failed.has(id);
        return { data, isError, isLoading: enabled !== false && data === undefined && !isError };
      },
      useMutation: mutation.useMutation,
    },
    "@tanstack/react-start": { useServerFn: (fn) => fn },
    "@tanstack/react-router": { useNavigate: () => async () => {} },
    ...i18nModules,
    "@/hooks/useTenant": { useTenant: () => ({ tenant: { currency: "AED" } }) },
    "@/lib/contacts-view": contactsView,
    "@/lib/validation-message": validationMessage,
    "@/lib/contact-identities.functions": {
      getContactDetail: async () => {
        throw new Error("the cache answers for the server in this harness");
      },
      saveContactNotes({ data }) {
        const answer = deferred();
        saves.push({ data: { ...data }, answer });
        return answer.promise;
      },
      setPrimaryIdentity: async ({ data }) => {
        primaries.push({ ...data });
        if (primaryFailure) throw primaryFailure;
        return { ok: true };
      },
      addContactIdentity: async () => ({ ok: true }),
      removeContactIdentity: async () => ({ ok: true }),
      saveContactBranch: async () => ({ ok: true }),
      removeContactBranch: async () => ({ ok: true }),
    },
    "@/lib/whatsapp-conversations.functions": {
      openContactWhatsApp: async () => ({ conversationId: "c1" }),
    },
    sonner: {
      toast: {
        success: (message) => toasts.push({ kind: "success", message }),
        error: (message, options) =>
          toasts.push({ kind: "error", message, description: options?.description }),
      },
    },
  };
  const exports = {};
  runInNewContext(compiled, {
    exports,
    require: (name) => modules[name] ?? new Proxy({}, { get: (_, key) => String(key) }),
  });
  const Card = (props) => {
    mutation.rewind();
    return exports.ContactDetailDialog(props);
  };
  const screen = () =>
    nodes(runtime.render(Card, { contactId: shown, contactName: "", onOpenChange() {} }));

  return {
    saves,
    primaries,
    toasts,
    refetched,
    failPrimary(error) {
      primaryFailure = error;
    },
    screen,
    settle: mutation.settle,
    /** Opens a contact's card, or closes the card with null. */
    open(id) {
      shown = id;
      return screen();
    },
    /** The server's answer for a contact arrives (or is already in the cache). */
    loaded(id, contact, identities) {
      cache.set(id, detail({ id, ...contact }, identities));
    },
    loadFails(id) {
      failed.add(id);
    },
    notesBox: () => screen().find(named("Textarea")),
    type(words) {
      screen()
        .find(named("Textarea"))
        .props.onChange({ target: { value: words } });
    },
    saveButton: () => screen().find((n) => named("Button")(n) && text(n).trim() === "Save notes"),
    /** One line of "Numbers & emails": by identity id, or "row:phone" for the record's own. */
    line(key) {
      const row = screen().find((n) => n.key === key);
      if (!row) return null;
      const inside = nodes(row);
      return {
        badges: inside.filter(named("Badge")).map((badge) => text(badge).trim()),
        makePrimary: inside.find((n) => named("Button")(n) && text(n).trim() === "Make primary"),
      };
    },
  };
}

describe("the notes box starts from the saved note", () => {
  it("shows the saved note when a contact that is already loaded is opened again", () => {
    const h = card();
    h.open(SARA);
    h.loaded(SARA, { notes: "Call before 10am. Ask for Sara." });
    assert.equal(h.notesBox().props.value, "Call before 10am. Ask for Sara.");

    h.open(null);
    h.open(SARA);
    assert.equal(
      h.notesBox().props.value,
      "Call before 10am. Ask for Sara.",
      "a blank box here is a note someone will overwrite without having seen it",
    );
    assert.equal(h.saveButton().props.disabled, true, "nothing has been typed yet");
  });

  it("shows the saved note the first time, when the record is already in the cache", () => {
    // The board can have loaded the detail before the card is ever mounted.
    const h = card();
    h.loaded(SARA, { notes: "Pays on the 1st." });
    h.open(SARA);
    assert.equal(h.notesBox().props.value, "Pays on the 1st.");
  });

  it("shows each contact its own note, never the last one's typing", () => {
    const h = card();
    h.loaded(SARA, { notes: "Sara's note" });
    h.loaded(OMAR, { notes: "Omar's note" });
    h.open(SARA);
    h.type("half a sentence about Sara");
    h.open(OMAR);
    assert.equal(h.notesBox().props.value, "Omar's note");
    assert.equal(h.saveButton().props.disabled, true);
    // And going back does not resurrect what was abandoned.
    h.open(SARA);
    assert.equal(h.notesBox().props.value, "Sara's note");
  });

  it("keeps what is being typed when the record refreshes underneath it", () => {
    // Adding a number refetches the whole record; that must not eat a half-typed note.
    const h = card();
    h.loaded(SARA, { notes: "old" });
    h.open(SARA);
    h.type("old, plus a new line");
    h.loaded(SARA, { notes: "old" }, [identity()]);
    assert.equal(h.notesBox().props.value, "old, plus a new line");
    assert.equal(h.saveButton().props.disabled, false);
  });

  it("does not offer a note to edit when the saved one could not be loaded", () => {
    // An empty box after a failed load looks exactly like "no note yet", and
    // saving from it would replace a note nobody was shown.
    const h = card();
    h.loadFails(SARA);
    h.open(SARA);
    assert.equal(h.notesBox().props.disabled, true);
    assert.equal(h.saveButton().props.disabled, true);
    assert.ok(
      h.screen().some((n) => n.type === "p" && /could not be loaded/.test(text(n))),
      "and it says why",
    );
  });
});

describe("typing while a note is being saved", () => {
  it("keeps the words typed after Save was pressed", async () => {
    const h = card();
    h.loaded(SARA, { notes: "old" });
    h.open(SARA);
    h.type("first thought");
    h.saveButton().props.onClick();
    assert.deepEqual(h.saves[0].data, { contactId: SARA, notes: "first thought" });
    assert.equal(h.saveButton().props.disabled, true, "one save at a time");

    h.type("first thought, and a second one");
    h.saves[0].answer.resolve({ ok: true, notes: "first thought" });
    await h.settle();
    // The record then refreshes with what the first save stored.
    h.loaded(SARA, { notes: "first thought" });

    assert.equal(h.notesBox().props.value, "first thought, and a second one");
    assert.equal(
      h.saveButton().props.disabled,
      false,
      "the newer words are not saved yet, so Save must be offered again",
    );
  });

  it("shows what was stored as soon as the save answers, not the note from before", async () => {
    const h = card();
    h.loaded(SARA, { notes: "old" });
    h.open(SARA);
    h.type("  new  ");
    h.saveButton().props.onClick();
    h.saves[0].answer.resolve({ ok: true, notes: "new" });
    await h.settle();
    // No refresh has arrived: the box must not fall back to "old".
    assert.equal(h.notesBox().props.value, "new");
    assert.equal(h.saveButton().props.disabled, true);
  });

  it("keeps the typing when the save fails", async () => {
    const h = card();
    h.loaded(SARA, { notes: "old" });
    h.open(SARA);
    h.type("could not be saved");
    h.saveButton().props.onClick();
    h.saves[0].answer.reject(new Error("offline"));
    await h.settle();
    assert.equal(h.notesBox().props.value, "could not be saved");
    assert.equal(h.saveButton().props.disabled, false);
  });

  it("leaves another contact's box alone when an earlier contact's save answers", async () => {
    const h = card();
    h.loaded(SARA, { notes: "Sara's note" });
    h.loaded(OMAR, { notes: "Omar's note" });
    h.open(SARA);
    h.type("Sara, updated");
    h.saveButton().props.onClick();

    h.open(OMAR);
    h.type("typing about Omar");
    h.saves[0].answer.resolve({ ok: true, notes: "Sara, updated" });
    await h.settle();

    assert.equal(h.notesBox().props.value, "typing about Omar");
    assert.equal(h.saveButton().props.disabled, false);
    h.open(SARA);
    assert.equal(h.notesBox().props.value, "Sara, updated", "Sara's saved note is hers");
  });
});

describe("what a person is told when a note is refused", () => {
  const tooLong = () => "x".repeat(contactsView.NOTES_MAX_LENGTH + 1);

  /** What the server really throws for input it refuses: zod's list of issues. */
  async function realRefusal() {
    db.reset({ contacts: [{ id: SARA, notes: "old" }] });
    const refusal = await saveContactNotes({
      data: { contactId: SARA, notes: tooLong() },
      context,
    }).then(
      () => null,
      (error) => error,
    );
    assert.ok(refusal, "the server refuses a note over the limit");
    return refusal;
  }

  it("cannot type more than the server will accept", () => {
    const h = card();
    h.loaded(SARA, { notes: null });
    h.open(SARA);
    assert.equal(typeof contactsView.NOTES_MAX_LENGTH, "number");
    assert.equal(h.notesBox().props.maxLength, contactsView.NOTES_MAX_LENGTH);
  });

  it("agrees with the server about the limit", async () => {
    db.reset({ contacts: [{ id: SARA, notes: "old" }] });
    const atLimit = "x".repeat(contactsView.NOTES_MAX_LENGTH);
    const out = await saveContactNotes({ data: { contactId: SARA, notes: atLimit }, context });
    assert.equal(out.notes === atLimit, true, "exactly at the limit is saved");
    await assert.rejects(
      saveContactNotes({ data: { contactId: SARA, notes: tooLong() }, context }),
    );
    assert.equal(
      db.table("contacts")[0].notes === atLimit,
      true,
      "one more is refused and changes nothing",
    );
  });

  it("shows one plain sentence, not the server's list of issues", async () => {
    const refusal = await realRefusal();
    assert.match(refusal.message, /too_big/, "this is the text that used to reach the screen");

    const h = card();
    h.loaded(SARA, { notes: "old" });
    h.open(SARA);
    h.type(tooLong());
    h.saveButton().props.onClick();
    h.saves[0].answer.reject(refusal);
    await h.settle();

    const shown = h.toasts.filter((toast) => toast.kind === "error");
    assert.equal(shown.length, 1);
    assert.match(shown[0].description, /too long or not valid/);
    assert.doesNotMatch(shown[0].description, /too_big|"code"|"path"|[[{]/);
    assert.doesNotMatch(shown[0].message, /too_big|"code"|"path"|[[{]/);
    assert.equal(h.notesBox().props.value, tooLong(), "and what was typed is still there");
  });

  it("still shows a sentence the server wrote for a person, word for word", async () => {
    const h = card();
    h.loaded(SARA, { notes: "old" });
    h.open(SARA);
    h.type("new");
    h.saveButton().props.onClick();
    h.saves[0].answer.reject(
      new Error("This contact could not be found, so the note was not saved."),
    );
    await h.settle();
    assert.equal(h.toasts.at(-1).kind, "error");
    assert.equal(
      h.toasts.at(-1).description,
      "This contact could not be found, so the note was not saved.",
    );
  });

  it("tells a list of issues from a sentence", async () => {
    const { isValidationDump } = validationMessage;
    assert.equal(isValidationDump((await realRefusal()).message), true);
    assert.equal(
      isValidationDump('[{"code":"invalid_enum_value","path":["provider"],"message":"Invalid"}]'),
      true,
    );
    for (const words of [
      "offline",
      "This contact could not be found, so the note was not saved.",
      "[not json",
      "[]",
      '[{"a":1}]',
      '[{"code":"x"}]',
      "",
      null,
      undefined,
      42,
    ])
      assert.equal(isValidationDump(words), false, String(words));
  });
});

describe("a note whose save fails while the card is closed", () => {
  const NOTE = "Call before 10am. Ask for Sara.";

  /** Sara's note is typed and sent, and the card is closed with the save still out. */
  function sentThenClosed() {
    const h = card();
    h.loaded(SARA, { notes: "old" });
    h.loaded(OMAR, { notes: "Omar's note" });
    h.open(SARA);
    h.type(NOTE);
    h.saveButton().props.onClick();
    h.open(null);
    return h;
  }
  const errors = (h) => h.toasts.filter((toast) => toast.kind === "error");

  it("is on screen again when the card is opened again, with Save on", async () => {
    const h = sentThenClosed();
    h.saves[0].answer.reject(new Error("offline"));
    await h.settle();
    h.open(SARA);
    assert.equal(h.notesBox().props.value, NOTE);
    assert.equal(h.saveButton().props.disabled, false, "it can be saved again at once");
  });

  it("is saved from the restored box exactly as it was typed", async () => {
    const h = sentThenClosed();
    h.saves[0].answer.reject(new Error("offline"));
    await h.settle();
    h.open(SARA);
    h.saveButton().props.onClick();
    assert.deepEqual(h.saves[1].data, { contactId: SARA, notes: NOTE });
    h.saves[1].answer.resolve({ ok: true, notes: NOTE });
    await h.settle();
    h.open(null);
    h.open(SARA);
    assert.equal(h.notesBox().props.value, NOTE, "now it is the saved note");
    assert.equal(h.saveButton().props.disabled, true, "and nothing is left to save");
  });

  it("names the contact in what the person is told, with the reason beneath", async () => {
    const h = sentThenClosed();
    h.saves[0].answer.reject(new Error("offline"));
    await h.settle();
    assert.equal(errors(h).length, 1);
    assert.match(errors(h)[0].message, /Sara Khan/);
    assert.match(errors(h)[0].message, /not saved/);
    assert.equal(errors(h)[0].description, "offline");
  });

  it("names the contact that failed, not the one whose card is open now", async () => {
    const h = sentThenClosed();
    h.open(OMAR);
    h.saves[0].answer.reject(new Error("offline"));
    await h.settle();
    assert.match(errors(h)[0].message, /Sara Khan/);
    assert.doesNotMatch(errors(h)[0].message, /Omar/);
  });

  it("leaves another contact's box alone", async () => {
    const h = sentThenClosed();
    h.saves[0].answer.reject(new Error("offline"));
    await h.settle();
    h.open(OMAR);
    assert.equal(h.notesBox().props.value, "Omar's note");
    assert.equal(h.saveButton().props.disabled, true);
    h.open(SARA);
    assert.equal(h.notesBox().props.value, NOTE, "and Sara's is still waiting for her");
  });

  it("is not wiped when the contact is read again", async () => {
    const h = sentThenClosed();
    h.saves[0].answer.reject(new Error("offline"));
    await h.settle();
    h.open(SARA);
    h.loaded(SARA, { notes: "old" }, [identity()]);
    assert.equal(h.notesBox().props.value, NOTE);
    h.loaded(SARA, { notes: "changed in another tab" });
    assert.equal(h.notesBox().props.value, NOTE, "not even when the saved note has changed");
    assert.equal(h.saveButton().props.disabled, false);
  });

  it("is not kept when the save works", async () => {
    const h = sentThenClosed();
    h.saves[0].answer.resolve({ ok: true, notes: NOTE });
    await h.settle();
    h.open(SARA);
    assert.equal(h.notesBox().props.value, NOTE, "this is the saved note");
    assert.equal(h.saveButton().props.disabled, true, "there is nothing unsaved");
    // Later changes made elsewhere show through: nothing is held back.
    h.loaded(SARA, { notes: "changed in another tab" });
    assert.equal(h.notesBox().props.value, "changed in another tab");
    assert.equal(errors(h).length, 0);
  });

  it("keeps the newest words when more were typed before the card was closed", async () => {
    const h = card();
    h.loaded(SARA, { notes: "old" });
    h.open(SARA);
    h.type("first thought");
    h.saveButton().props.onClick();
    h.type("first thought, and a second one");
    h.open(null);
    h.saves[0].answer.reject(new Error("offline"));
    await h.settle();
    h.open(SARA);
    assert.equal(h.notesBox().props.value, "first thought, and a second one");
  });

  it("keeps the newest words even if the first save then works", async () => {
    // The request carried only the first words; the rest were never saved.
    const h = card();
    h.loaded(SARA, { notes: "old" });
    h.open(SARA);
    h.type("first thought");
    h.saveButton().props.onClick();
    h.type("first thought, and a second one");
    h.open(null);
    h.saves[0].answer.resolve({ ok: true, notes: "first thought" });
    await h.settle();
    h.open(SARA);
    assert.equal(h.notesBox().props.value, "first thought, and a second one");
    assert.equal(h.saveButton().props.disabled, false);
  });

  it("follows what is typed after a failure with the card still open", async () => {
    const h = card();
    h.loaded(SARA, { notes: "old" });
    h.open(SARA);
    h.type("first thought");
    h.saveButton().props.onClick();
    h.saves[0].answer.reject(new Error("offline"));
    await h.settle();
    h.type("first thought, fixed");
    h.open(null);
    h.open(SARA);
    assert.equal(h.notesBox().props.value, "first thought, fixed");
  });

  it("gives the person the plain sentence, not a list of issues", async () => {
    const h = sentThenClosed();
    const refusal = await saveContactNotes({
      data: { contactId: SARA, notes: "x".repeat(contactsView.NOTES_MAX_LENGTH + 1) },
      context,
    }).then(
      () => null,
      (error) => error,
    );
    h.saves[0].answer.reject(refusal);
    await h.settle();
    assert.match(errors(h)[0].message, /Sara Khan/);
    assert.match(errors(h)[0].description, /too long or not valid/);
    h.open(SARA);
    assert.equal(h.notesBox().props.value, NOTE, "and what was typed is still there");
  });

  it("still lets abandoned typing go, as before", () => {
    // Nothing was sent, so nothing is held: moving on drops it.
    const h = card();
    h.loaded(SARA, { notes: "Sara's note" });
    h.open(SARA);
    h.type("half a sentence");
    h.open(null);
    h.open(SARA);
    assert.equal(h.notesBox().props.value, "Sara's note");
  });
});

describe("one primary number", () => {
  it("shows the chosen number as the only primary when the first lives on the record", () => {
    // The contact was made with the New contact form, so its number is only in
    // contacts.phone. A second number was added and made primary.
    const h = card();
    h.loaded(SARA, { phone: "+971509630506" }, [identity({ is_primary: true })]);
    h.open(SARA);
    const onRecord = h.line("row:phone");
    const chosen = h.line(OFFICE);
    assert.ok(chosen.badges.includes("Primary"), "the number the person chose is the primary");
    assert.equal(
      onRecord.badges.some((badge) => /primary/i.test(badge)),
      false,
      "the number on the record must not also claim to be primary",
    );
    assert.deepEqual(onRecord.badges, ["On the contact record"]);
  });

  it("lets the number on the record be chosen again", async () => {
    const h = card();
    h.loaded(SARA, { phone: "+971509630506" }, [identity({ is_primary: true })]);
    h.open(SARA);
    h.line("row:phone").makePrimary.props.onClick();
    await h.settle();
    // No identity row stands behind it, so the request names none.
    assert.deepEqual(h.primaries, [{ id: null, contactId: SARA, kind: "phone" }]);
  });

  it("treats the number on the record as primary until another is chosen", () => {
    const h = card();
    h.loaded(SARA, { phone: "+971509630506" }, [identity()]);
    h.open(SARA);
    assert.ok(h.line("row:phone").badges.includes("Primary"));
    assert.equal(h.line("row:phone").makePrimary, undefined);
    assert.equal(h.line(OFFICE).badges.includes("Primary"), false);
    assert.ok(h.line(OFFICE).makePrimary);
  });

  it("asks for the chosen identity by its id", async () => {
    const h = card();
    h.loaded(SARA, { phone: "+971509630506" }, [identity()]);
    h.open(SARA);
    h.line(OFFICE).makePrimary.props.onClick();
    await h.settle();
    assert.deepEqual(h.primaries, [{ id: OFFICE, contactId: SARA, kind: "phone" }]);
  });
});

// ── The server functions behind the card, against the database double ─────────
const db = createDb();
const context = { supabase: db.client, userId: "user-1" };

/**
 * Rejects with something whose message matches. The database double refuses
 * with a plain { message } object where the real client throws an Error, and
 * assert.rejects(…, /regex/) cannot read a message off a plain object.
 */
const rejectsWith = (promise, pattern) =>
  assert.rejects(promise, (error) => {
    assert.match(String(error?.message ?? error), pattern);
    return true;
  });

describe("saving a note on the server", () => {
  it("answers with the note as it was stored", async () => {
    db.reset({ contacts: [{ id: SARA, notes: "old" }] });
    const out = await saveContactNotes({
      data: { contactId: SARA, notes: "  Call before 10am  " },
      context,
    });
    assert.deepEqual(out, { ok: true, notes: "Call before 10am" });
    assert.equal(db.table("contacts")[0].notes, "Call before 10am");
  });

  it("stores a cleared note as no note", async () => {
    db.reset({ contacts: [{ id: SARA, notes: "old" }] });
    const out = await saveContactNotes({ data: { contactId: SARA, notes: "   " }, context });
    assert.deepEqual(out, { ok: true, notes: null });
    assert.equal(db.table("contacts")[0].notes, null);
  });

  it("does not say saved when there was no contact to save it on", async () => {
    // Deleted in another tab, or not this workspace's: the update touches no row.
    db.reset({ contacts: [{ id: OMAR, notes: "Omar's note" }] });
    await rejectsWith(
      saveContactNotes({ data: { contactId: SARA, notes: "lost" }, context }),
      /not saved/,
    );
    assert.equal(db.table("contacts")[0].notes, "Omar's note");
  });

  it("does not say saved when the database refuses", async () => {
    db.reset({ contacts: [{ id: SARA, notes: "old" }] });
    db.fail("contacts:update", { message: "connection reset" });
    await rejectsWith(
      saveContactNotes({ data: { contactId: SARA, notes: "new" }, context }),
      /connection reset/,
    );
    assert.equal(db.table("contacts")[0].notes, "old");
  });
});

describe("choosing the primary on the server", () => {
  const seed = () =>
    db.reset({
      contacts: [
        // Sara's own number lives only on her record: no identity row mentions it.
        { id: SARA, tenant_id: "t1", phone: "+971509630506", email: "s@e.com" },
        { id: OMAR, tenant_id: "t1", phone: "+97150999", email: null },
        // A contact with nothing on the record to choose.
        { id: NOBODY, tenant_id: "t1", phone: null, email: null },
      ],
      contact_identities: [
        { id: OFFICE, contact_id: SARA, kind: "phone", value: "+971559876543", is_primary: true },
        { id: MOBILE, contact_id: SARA, kind: "phone", value: "+971501112222", is_primary: false },
        { id: SARA_EMAIL, contact_id: SARA, kind: "email", value: "s@e.com", is_primary: true },
        { id: OMAR_PHONE, contact_id: OMAR, kind: "phone", value: "+97150999", is_primary: true },
      ],
    });
  const primaryIds = () =>
    db
      .table("contact_identities")
      .filter((row) => row.is_primary)
      .map((row) => row.id)
      .sort();
  const ORIGINAL = () => [OFFICE, SARA_EMAIL, OMAR_PHONE].sort();

  /**
   * contact_identities_one_primary_key, which the database double does not
   * enforce: a contact has at most one primary identity of each kind, and a
   * write that would make two is refused (23505), as Postgres refuses it.
   */
  const onePrimaryPerKind = (query) => {
    if (query.patch?.is_primary !== true) return null;
    const rows = db.table("contact_identities");
    const touched = rows.filter((row) => query.filters.every((matches) => matches(row)));
    const primaries = rows
      .map((row) => (touched.includes(row) ? { ...row, is_primary: true } : row))
      .filter((row) => row.is_primary)
      .map((row) => `${row.contact_id}:${row.kind}`);
    return new Set(primaries).size === primaries.length
      ? null
      : {
          code: "23505",
          message:
            'duplicate key value violates unique constraint "contact_identities_one_primary_key"',
        };
  };
  /**
   * Makes the writes that set a primary fail the way a test says, but only for
   * the first \`times\` of them: the ones after it (putting the old one back) get
   * the database's own one-primary rule.
   */
  const refuseSetting = (answer, times = 1) => {
    let calls = 0;
    db.fail("contact_identities:update", (query) => {
      if (query.patch?.is_primary !== true) return null;
      calls += 1;
      return calls <= times ? answer : onePrimaryPerKind(query);
    });
  };
  const choose = (id, kind = "phone", contactId = SARA) =>
    setPrimaryIdentity({ data: { id, contactId, kind }, context });

  const realConsoleError = console.error;
  let logged;
  beforeEach(() => {
    seed();
    db.fail("contact_identities:update", onePrimaryPerKind);
    logged = [];
    console.error = (...args) =>
      logged.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  });
  afterEach(() => {
    console.error = realConsoleError;
  });

  it("makes the chosen number the only primary of its kind on that contact", async () => {
    await choose(MOBILE);
    assert.deepEqual(primaryIds(), [MOBILE, SARA_EMAIL, OMAR_PHONE].sort());
  });

  it("choosing the number on the record leaves no identity of that kind as primary", async () => {
    const out = await choose(null);
    assert.deepEqual(out, { ok: true });
    // Sara's email and Omar's number are not this choice's to change.
    assert.deepEqual(primaryIds(), [SARA_EMAIL, OMAR_PHONE].sort());
  });

  it("refuses a number that belongs to another contact, and changes nothing", async () => {
    await assert.rejects(choose(OMAR_PHONE), /no longer on this contact/);
    assert.deepEqual(primaryIds(), ORIGINAL());
  });

  it("refuses a number that has since been removed, and changes nothing", async () => {
    await assert.rejects(choose(GONE), /no longer on this contact/);
    assert.deepEqual(primaryIds(), ORIGINAL());
  });

  it("refuses an email offered as the primary phone", async () => {
    await assert.rejects(choose(SARA_EMAIL), /no longer on this contact/);
    assert.deepEqual(primaryIds(), ORIGINAL());
  });

  it("does not mistake a database that cannot be read for a number that is gone", async () => {
    db.fail("contact_identities:read", { message: "statement timeout" });
    await rejectsWith(choose(MOBILE), /statement timeout/);
    db.recover("contact_identities:read");
    assert.deepEqual(primaryIds(), ORIGINAL());
  });

  it("does not mistake a contact that cannot be read for one that is gone", async () => {
    db.fail("contacts:read", { message: "statement timeout" });
    await rejectsWith(choose(MOBILE), /statement timeout/);
    await rejectsWith(choose(null), /statement timeout/);
    db.recover("contacts:read");
    assert.deepEqual(primaryIds(), ORIGINAL());
  });

  it("changes nothing when clearing the old primary is refused", async () => {
    db.fail("contact_identities:update", { message: "write refused" });
    await rejectsWith(choose(MOBILE), /write refused/);
    await rejectsWith(choose(null), /write refused/);
    db.recover("contact_identities:update");
    assert.deepEqual(primaryIds(), ORIGINAL());
  });

  describe("when the new primary cannot be set after the old one was cleared", () => {
    it("puts the old primary back and says it was not changed, if the database refuses", async () => {
      refuseSetting({ message: "write refused" });
      await rejectsWith(choose(MOBILE), /could not be made primary.*nothing was changed/);
      assert.deepEqual(primaryIds(), ORIGINAL(), "the contact still has the primary it had");
      assert.ok(
        logged.some((line) => /write refused/.test(line)),
        "and the technical reason is in the log",
      );
    });

    it("does not say done when the write touched no row", async () => {
      // The number was removed in another tab between the check and the write:
      // the database accepts an update that matches nothing.
      refuseSetting({ empty: true });
      await rejectsWith(choose(MOBILE), /could not be made primary.*nothing was changed/);
      assert.deepEqual(primaryIds(), ORIGINAL());
    });

    it("says so, plainly, if the old primary cannot be put back either", async () => {
      refuseSetting({ message: "write refused" }, 2);
      await assert.rejects(choose(MOBILE), (error) => {
        assert.match(error.message, /could not be put back/);
        assert.match(error.message, /choose the primary number again/);
        assert.doesNotMatch(error.message, /write refused/, "the technical reason is for the log");
        return true;
      });
      assert.equal(
        primaryIds().includes(MOBILE),
        false,
        "the number that failed is not left primary",
      );
    });
  });

  describe("choosing the number on the record", () => {
    it("is refused for a contact this person cannot see, and changes nothing", async () => {
      // Without a check, clearing zero rows reads as success.
      await assert.rejects(choose(null, "phone", GONE), /could not be found/);
      assert.deepEqual(primaryIds(), ORIGINAL());
    });

    it("is refused when the record has no number of that kind, and changes nothing", async () => {
      await assert.rejects(choose(null, "phone", NOBODY), /no longer on this contact/);
      await assert.rejects(choose(null, "email", NOBODY), /no longer on this contact/);
      assert.deepEqual(primaryIds(), ORIGINAL());
    });
  });
});

describe("when choosing the primary fails on the card", () => {
  it("shows why and reads the contact again, so the card shows what is really primary", async () => {
    const h = card();
    h.loaded(SARA, { phone: "+971509630506" }, [identity({ is_primary: true })]);
    h.open(SARA);
    h.failPrimary(new Error("That number could not be made primary, so nothing was changed."));
    h.line("row:phone").makePrimary.props.onClick();
    await h.settle();
    assert.equal(h.toasts.at(-1).kind, "error");
    assert.match(h.toasts.at(-1).message, /nothing was changed/);
    assert.ok(
      h.refetched.some((key) => key[0] === "contact-detail" && key[1] === SARA),
      "the card asked for the contact again",
    );
  });
});
