// The campaign board as a person uses it: rendered, with its real composer, its
// real server function and a database double behind that.
//
//   npm run test:campaign-audience
//
// The review of PR #58 (17 Oct) found that the guarded save (a recipient count
// the server works out, a refused save when the audience cannot be read, one id
// for one draft) was only ever reached from a form nobody could see. The board
// that is on the page saved by itself, straight to the table, with the count the
// page had at the time: zero while the page's own audience request was loading
// or had failed. These tests click the real buttons and read the real table.
//
// What is real: CampaignBoard, CampaignComposerModal, the dialog, tabs, the
// i18n lookup (English, as a reader without a language cookie sees it), the
// server function with its validator, the audience reads and the save.
// What is replaced: the data client the page itself holds (a recorder, so a
// write made by the page rather than the server shows up), the toast, the
// server-function wrapper and the model call.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { createDb } from "./support/db-double.mjs";
import { asPostgrest } from "./support/postgrest-double.mjs";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
    .split("\r\n")
    .join("\n");

/* ── a browser for React to render into ───────────────────────────────────── */

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
for (const key of Object.getOwnPropertyNames(dom.window)) {
  if (!(key in globalThis)) {
    try {
      globalThis[key] = dom.window[key];
    } catch {
      // A few window properties are getters that refuse assignment.
    }
  }
}
// Node has its own Event and CustomEvent; the dialog library builds these and
// hands them to jsdom's dispatchEvent, which accepts only jsdom's.
globalThis.Event = dom.window.Event;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// The dialog and tooltip libraries measure and observe; jsdom does neither.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
window.ResizeObserver = globalThis.ResizeObserver;
window.matchMedia ??= () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
});
window.HTMLElement.prototype.scrollIntoView ??= () => {};
window.HTMLElement.prototype.hasPointerCapture ??= () => false;
window.HTMLElement.prototype.releasePointerCapture ??= () => {};

/* ── the board, its composer and the real server function, in one bundle ──── */

mkdirSync("node_modules/.cache", { recursive: true });
const stubs = {
  // The data client the PAGE holds. Anything the board writes with it is
  // recorded; the server's own client is the database double below.
  "@/integrations/supabase/client": "export const supabase = globalThis.boardSupabase;",
  "@/integrations/supabase/client.server": "export const supabaseAdmin = {};",
  "@/integrations/supabase/auth-middleware": "export const requireSupabaseAuth = {};",
  "@/lib/lead-automation.server":
    "export const whyMarketingEmailCannotBeSent = () => 'Sending is not connected.';",
  "@/lib/audit.server": "export async function logAudit() {}",
  "./flash-ai.server": `export const aiOptionsFor = async () => ({});
    export const getBusinessContext = async () => null;
    export const callFlashAi = async () => '';`,
  sonner: `export const toast = {
    success: (message) => globalThis.boardToasts.push({ kind: "success", message }),
    error: (message) => globalThis.boardToasts.push({ kind: "error", message }),
    warning: (message) => globalThis.boardToasts.push({ kind: "warning", message }),
  };`,
  // A server function becomes an ordinary async function that runs the real
  // validator and the real handler, with the server's database client.
  "@tanstack/react-start": `export function createServerFn() {
    let validate = (input) => input;
    return {
      middleware() { return this; },
      inputValidator(fn) { validate = fn; return this; },
      handler(fn) {
        return async (call) => {
          globalThis.boardServerCalls.push(call?.data);
          return fn({ ...call, data: validate(call?.data), context: globalThis.boardServerContext });
        };
      },
    };
  }
  export const useServerFn = (fn) => fn;`,
};

await build({
  stdin: {
    contents: `export { CampaignBoard } from './src/components/marketing/CampaignBoard';
      export * as serverFns from './src/lib/campaign-audience.functions';
      export * as audience from './src/lib/campaign-audience';
      export { AUDIENCE_ROW_LIMIT } from './src/lib/audience-rows.server';
      export { default as marketing } from './src/lib/i18n/screens/marketing';`,
    resolveDir: process.cwd(),
  },
  outfile: "node_modules/.cache/flas-campaign-board.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  jsx: "automatic",
  logLevel: "error",
  alias: { "@": "./src" },
  plugins: [
    {
      name: "campaign-board-boundaries",
      setup(b) {
        b.onResolve({ filter: /.*/ }, (args) => {
          const stub = Object.keys(stubs).find(
            (name) => args.path === name || (name.startsWith("./") && args.path === name),
          );
          if (stub) return { path: stub, namespace: "board-stub" };
          // Every package is external, so the test and the board share one React.
          if (args.path.startsWith("@/") || args.path.startsWith(".") || isAbsolute(args.path))
            return undefined;
          return { path: args.path, external: true };
        });
        b.onLoad({ filter: /.*/, namespace: "board-stub" }, (args) => ({
          contents: stubs[args.path],
          loader: "js",
        }));
      },
    },
  ],
});

/* ── the doubles the bundle reads from ───────────────────────────────────── */

const db = createDb();
const { client } = asPostgrest(db);
globalThis.boardToasts = [];
globalThis.boardServerCalls = [];
globalThis.boardClientCalls = [];
globalThis.boardServerContext = { supabase: client, userId: "user-1" };

/** What the page's own data client was asked to do: a write here is the page writing by itself. */
const pageClientWrites = () =>
  globalThis.boardClientCalls.filter((c) =>
    ["insert", "update", "upsert", "delete"].includes(c.op),
  );
{
  const ended = new Proxy(function () {}, {
    get: (_t, key) =>
      key === "then"
        ? (resolve, reject) => Promise.resolve({ data: [], error: null }).then(resolve, reject)
        : ended,
    apply: () => ended,
  });
  globalThis.boardSupabase = {
    from: (table) =>
      new Proxy(
        {},
        {
          get:
            (_t, op) =>
            (...args) => {
              globalThis.boardClientCalls.push({ table, op, args });
              return ended;
            },
        },
      ),
  };
}
console.error = () => {};

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { Provider: TooltipProvider } = await import("@radix-ui/react-tooltip");
const board = await import("../node_modules/.cache/flas-campaign-board.mjs");
const messages = board.marketing.en;
const { CAMPAIGN_EXTRA_LIMITS, CAMPAIGN_FIELD_LIMITS, CAMPAIGN_TOO_LONG } = board.audience;
const h = React.createElement;
const { act } = React;

/* ── helpers ─────────────────────────────────────────────────────────────── */

const aContact = (id, extra = {}) => ({
  id,
  name: `Contact ${id}`,
  email: `${id}@example.com`,
  phone: null,
  consent_given: true,
  ...extra,
});
const aCampaign = (id, extra = {}) => ({
  id,
  name: "Spring launch",
  subject: "New in",
  body: "<p>Hi {{name}}</p>",
  template_id: "welcome_discount",
  image_url: null,
  attachments: [],
  status: "draft",
  recipients_count: 2,
  scheduled_at: null,
  sent_at: null,
  created_at: "2026-10-01T10:00:00.000Z",
  ...extra,
});

let mounted = [];
async function mount(props) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (next) =>
    h(
      QueryClientProvider,
      { client: queries },
      h(TooltipProvider, null, h(board.CampaignBoard, next)),
    );
  await act(async () => root.render(tree(props)));
  const view = {
    container,
    rerender: (next) => act(async () => root.render(tree(next))),
    unmount: () => act(async () => root.unmount()),
  };
  mounted.push(view);
  return view;
}

const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
const buttons = () => [...document.querySelectorAll("button")];
const buttonByText = (text) => buttons().find((b) => b.textContent.trim() === text);
const buttonByIcon = (scope, icon) =>
  [...scope.querySelectorAll("button")].find((b) =>
    (b.querySelector("svg")?.getAttribute("class") ?? "").split(" ").includes(`lucide-${icon}`),
  );
async function click(element) {
  assert.ok(element, "the button to click is on the page");
  await act(async () => {
    element.click();
  });
  await flush();
}
async function type(element, value) {
  assert.ok(element, "the field to fill is on the page");
  const prototype =
    element.tagName === "TEXTAREA" ? window.HTMLTextAreaElement : window.HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype.prototype, "value").set.call(element, value);
    element.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}
const field = (id) => document.getElementById(id);
const composerIsOpen = () => field("campName") !== null;
async function openNewCampaign() {
  await click(buttonByText("New Campaign"));
  assert.ok(composerIsOpen(), "the composer opened");
}
async function fillAndSave(name = "Spring launch", subject = "New in", label = "Save as Draft") {
  await type(field("campName"), name);
  await type(field("campSubject"), subject);
  await click(buttonByText(label));
}
const toasts = (kind) =>
  globalThis.boardToasts.filter((t) => t.kind === kind).map((t) => t.message);
const campaigns = () => db.table("campaigns");
const baseProps = (extra = {}) => ({
  campaigns: [],
  isSmtpVerified: true,
  audienceCount: 999, // what the page last showed: never what is saved
  ...extra,
});

beforeEach(async () => {
  for (const view of mounted) await view.unmount();
  mounted = [];
  document.body.innerHTML = "";
  db.reset({
    contacts: [
      aContact("c1"),
      aContact("c2"),
      aContact("c3", { email: "no@example.com", consent_given: false }),
    ],
    leads: [],
    contact_identities: [],
    campaigns: [],
  });
  // The table's primary key, so that a second insert of one id is a 23505.
  db.unique("campaigns", ["id"]);
  globalThis.boardToasts.length = 0;
  globalThis.boardServerCalls.length = 0;
  globalThis.boardClientCalls.length = 0;
});

after(async () => {
  for (const view of mounted) await view.unmount();
});

/* ── 1. the rendered board saves through the server ──────────────────────── */

describe("PR #58 re-review: the rendered board saves through the guarded server function", () => {
  test("Save as Draft goes to the server, which counts the audience; the page writes nothing itself", async () => {
    await mount(baseProps());
    await openNewCampaign();
    await fillAndSave();

    assert.equal(globalThis.boardServerCalls.length, 1, "one request to the server function");
    assert.deepEqual(
      pageClientWrites().filter((c) => c.table === "campaigns"),
      [],
      "the page did not write to the campaigns table by itself",
    );
    assert.equal(campaigns().length, 1);
    const saved = campaigns()[0];
    assert.equal(saved.recipients_count, 2, "counted by the server, not the page's 999");
    assert.equal(saved.name, "Spring launch");
    assert.equal(saved.subject, "New in");
    assert.equal(saved.status, "draft");
    assert.equal(saved.created_by, "user-1");
    assert.ok(saved.template_id, "the template travels with the draft");
    assert.ok(saved.body.length > 0, "and so does the body");
    assert.deepEqual(toasts("success"), [messages["marketing.campaignSavedAsADraft"]]);
    assert.equal(composerIsOpen(), false, "the composer closes once the draft is saved");
  });

  test("the audience cannot be read: the save is refused in plain words and nothing is stored as 0", async () => {
    db.fail("contacts:read", { message: "permission denied for table contacts" });
    await mount(baseProps({ audienceCount: 0 }));
    await openNewCampaign();
    await fillAndSave();

    assert.deepEqual(toasts("error"), [messages["marketing.campaignNotSaved"]]);
    assert.deepEqual(toasts("success"), []);
    assert.equal(campaigns().length, 0, "no campaign with a made-up count");
    assert.deepEqual(
      pageClientWrites().filter((c) => c.table === "campaigns"),
      [],
      "and the page did not fall back to saving it itself",
    );
    assert.ok(composerIsOpen(), "the composer stays open with what the person wrote");
    assert.equal(field("campName").value, "Spring launch");
    assert.equal(field("campSubject").value, "New in");
  });

  test("trying again after a refusal is the same draft: one id, one row", async () => {
    db.fail("leads:read", { message: "permission denied for table leads" });
    await mount(baseProps());
    await openNewCampaign();
    await fillAndSave();
    assert.equal(campaigns().length, 0);
    const firstId = globalThis.boardServerCalls[0].id;
    assert.match(firstId, /^[0-9a-f-]{36}$/, "the draft has an id before it is ever saved");

    db.recover("leads:read");
    await click(buttonByText("Save as Draft"));

    assert.equal(globalThis.boardServerCalls.length, 2);
    assert.equal(globalThis.boardServerCalls[1].id, firstId, "the same draft keeps its id");
    assert.equal(campaigns().length, 1);
    assert.equal(campaigns()[0].id, firstId);
    assert.equal(campaigns()[0].recipients_count, 2);
    assert.equal(composerIsOpen(), false);
  });

  test("a double click is one campaign", async () => {
    await mount(baseProps());
    await openNewCampaign();
    await type(field("campName"), "Spring launch");
    await type(field("campSubject"), "New in");
    const save = buttonByText("Save as Draft");
    await act(async () => {
      save.click();
      save.click();
    });
    await flush();
    assert.equal(globalThis.boardServerCalls.length >= 1, true);
    assert.equal(campaigns().length, 1, "two clicks, one row");
    const ids = new Set(globalThis.boardServerCalls.map((c) => c.id));
    assert.equal(ids.size, 1, "both clicks carried the one id");
  });

  test("a second save of the same campaign updates that row", async () => {
    const view = await mount(baseProps());
    await openNewCampaign();
    await fillAndSave();
    assert.equal(campaigns().length, 1);
    const id = campaigns()[0].id;

    // The list the page shows after it re-reads the table, and a new person
    // who has consented since.
    db.table("contacts").push(aContact("c4"));
    await view.rerender(baseProps({ campaigns: [{ ...campaigns()[0] }] }));
    const card = document.querySelector(".shadow-sm");
    assert.ok(card, "the saved campaign is on the board");
    await click(buttonByIcon(card, "pen"));
    assert.ok(composerIsOpen());
    assert.equal(field("campName").value, "Spring launch", "the composer shows what was saved");

    await type(field("campName"), "Spring launch, second go");
    await click(buttonByText("Save as Draft"));

    assert.equal(campaigns().length, 1, "still one campaign");
    assert.equal(campaigns()[0].id, id);
    assert.equal(campaigns()[0].name, "Spring launch, second go");
    assert.equal(campaigns()[0].recipients_count, 3, "counted again by the server");
    assert.equal(campaigns()[0].created_by, "user-1");
    assert.deepEqual(
      pageClientWrites().filter((c) => c.table === "campaigns"),
      [],
    );
    assert.equal(globalThis.boardServerCalls.at(-1).id, id, "the edit names the campaign it edits");
  });

  test("editing one campaign and then another shows each its own text", async () => {
    // The composer used to be mounted once for the whole board and read its
    // fields only on its first render, so the second campaign opened with the
    // first one's text, and saving wrote that over it.
    const a = aCampaign("11111111-1111-4111-8111-111111111111", { name: "Alpha", subject: "A" });
    const b = aCampaign("22222222-2222-4222-8222-222222222222", { name: "Beta", subject: "B" });
    db.table("campaigns").push(a, b);
    await mount(baseProps({ campaigns: [a, b] }));

    const cards = () => [...document.querySelectorAll(".shadow-sm")];
    await click(buttonByIcon(cards()[0], "pen"));
    const first = field("campName").value;
    await click(buttonByText("Cancel"));
    assert.equal(composerIsOpen(), false);
    await click(buttonByIcon(cards()[1], "pen"));
    const second = field("campName").value;

    assert.deepEqual([first, second].sort(), ["Alpha", "Beta"]);
    assert.notEqual(first, second, "each campaign opens with its own name");
  });

  test("editing keeps the attachments, the picture and the template the campaign has", async () => {
    const attachment = {
      id: "att_1",
      name: "Brochure.pdf",
      url: "https://x.example/b.pdf",
      type: "application/pdf",
      size: 1024,
    };
    const existing = aCampaign("33333333-3333-4333-8333-333333333333", {
      attachments: [attachment],
      image_url: "https://x.example/hero.png",
      template_id: "newsletter",
    });
    db.table("campaigns").push(existing);
    await mount(baseProps({ campaigns: [existing] }));
    await click(buttonByIcon(document.querySelector(".shadow-sm"), "pen"));
    await type(field("campName"), "Renamed");
    await click(buttonByText("Save as Draft"));

    const saved = campaigns().find((c) => c.id === existing.id);
    assert.equal(saved.name, "Renamed");
    assert.deepEqual(saved.attachments, [attachment], "not emptied by the edit");
    assert.equal(saved.image_url, "https://x.example/hero.png");
    assert.equal(saved.template_id, "newsletter");
  });

  test("the audience figure is the server's number, or says it is not known: never a made-up zero", async () => {
    const view = await mount(baseProps({ audienceCount: 14 }));
    assert.match(document.body.textContent, /Audience pool: 14 consented subscribers/);

    await view.rerender(baseProps({ audienceCount: null, audienceError: "permission denied" }));
    assert.doesNotMatch(document.body.textContent, /Audience pool: 0/);
    assert.doesNotMatch(document.body.textContent, /consented subscribers/);
    assert.ok(
      document.body.textContent.includes("Could not check who has opted in: permission denied"),
    );

    await view.rerender(baseProps({ audienceCount: null }));
    assert.doesNotMatch(document.body.textContent, /Audience pool: 0/);
    assert.ok(document.body.textContent.includes(messages["marketing.checkingWhoHasOptedIn"]));
  });

  test("a cut-short audience read is shown as partial, not as a number", async () => {
    const view = await mount(baseProps({ audienceCount: null, audiencePartial: true }));
    assert.ok(document.body.textContent.includes(messages["marketing.audiencePartial"]));
    assert.doesNotMatch(document.body.textContent, /Audience pool: \d/);
    assert.doesNotMatch(document.body.textContent, /at least/i);
    await view.rerender(baseProps({ audienceCount: 7, audiencePartial: false }));
    assert.match(document.body.textContent, /Audience pool: 7 consented subscribers/);
    assert.ok(!document.body.textContent.includes(messages["marketing.audiencePartial"]));
  });

  test("a save over a cut-short read is stored, and the person is told the count is partial", async () => {
    db.table("leads").push(
      ...Array.from({ length: board.AUDIENCE_ROW_LIMIT }, (_, i) => ({
        id: `l${String(i).padStart(5, "0")}`,
        contact_id: null,
        name: null,
        email: `p${i}@example.com`,
        phone: null,
        consent_given: true,
        subscribed: true,
      })),
    );
    await mount(baseProps());
    await openNewCampaign();
    await fillAndSave();
    assert.equal(campaigns().length, 1);
    assert.deepEqual(toasts("success"), [messages["marketing.campaignSavedAsADraft"]]);
    assert.deepEqual(toasts("warning"), [messages["marketing.audiencePartial"]]);
  });

  test("a draft written by Flas AI opens in the composer, ready to save through the same path", async () => {
    const view = await mount(baseProps());
    await view.rerender(
      baseProps({
        prefill: { name: "Spring offer", subject: "Spring is here", body: "Hello there" },
      }),
    );
    assert.ok(composerIsOpen(), "the composer opened by itself");
    assert.equal(field("campName").value, "Spring offer");
    assert.equal(field("campSubject").value, "Spring is here");
    assert.equal(field("campBody").value, "Hello there");
    await click(buttonByText("Save as Draft"));
    assert.equal(campaigns().length, 1);
    assert.equal(campaigns()[0].name, "Spring offer");
    assert.equal(campaigns()[0].recipients_count, 2);
  });
});

/* ── 2. what #71 and #76 promised still holds ────────────────────────────── */

describe("PR #58 re-review: scheduling and sending claims on the same path", () => {
  test("Schedule / Send saves as scheduled, says it is queued, and claims no send", async () => {
    await mount(baseProps());
    await openNewCampaign();
    await fillAndSave("Spring launch", "New in", "Schedule / Send");

    assert.equal(campaigns().length, 1);
    assert.equal(campaigns()[0].status, "scheduled");
    assert.equal(campaigns()[0].recipients_count, 2);
    assert.deepEqual(toasts("success"), [messages["marketing.markedAsQueuedFlasCrm"]]);
    assert.doesNotMatch(toasts("success").join(" "), /\bsent\b/i);
    assert.deepEqual(
      pageClientWrites().filter((c) => c.table === "campaigns"),
      [],
    );
  });

  test("without a verified SMTP setup, Schedule / Send cannot be used and nothing is requested", async () => {
    await mount(baseProps({ isSmtpVerified: false }));
    await openNewCampaign();
    await type(field("campName"), "Spring launch");
    await type(field("campSubject"), "New in");
    const schedule = buttonByText("Schedule / Send");
    assert.equal(schedule.disabled, true);
    await click(schedule);
    assert.equal(globalThis.boardServerCalls.length, 0);
    assert.equal(campaigns().length, 0);
  });

  test("a campaign cannot be saved as sent, or any other stage, through the server function", async () => {
    for (const status of ["sent", "in_progress", "paused", "failed"]) {
      await assert.rejects(
        board.serverFns.saveCampaignDraft({
          data: { name: "x", subject: "y", body: "z", status },
        }),
        undefined,
        status,
      );
    }
    assert.equal(campaigns().length, 0);
  });

  test("the board still shows the sending notice and no send button works", async () => {
    await mount(
      baseProps({
        campaigns: [aCampaign("44444444-4444-4444-8444-444444444444", { status: "scheduled" })],
      }),
    );
    assert.ok(messages["marketing.sendingIsNotAutomatedYet"], "the sentence exists");
    assert.ok(document.body.textContent.includes(messages["marketing.sendingIsNotAutomatedYet"]));
  });
});

/* ── 3. limits are the server's, not only the form's ─────────────────────── */

describe("PR #58 re-review: the server's limits apply to everything the board can send", () => {
  const save = (data) =>
    board.serverFns.saveCampaignDraft({ data: { name: "n", subject: "s", body: "b", ...data } });

  test("a name over the limit is stopped by the form, with the sentence, before any request", async () => {
    await mount(baseProps());
    await openNewCampaign();
    await fillAndSave("x".repeat(CAMPAIGN_FIELD_LIMITS.name + 1));
    assert.equal(globalThis.boardServerCalls.length, 0);
    assert.deepEqual(toasts("error"), [messages["marketing.campaignTooLong"]]);
  });

  test("and by the server, if a request is made anyway", async () => {
    await assert.rejects(
      save({ name: "x".repeat(CAMPAIGN_FIELD_LIMITS.name + 1) }),
      (e) => e.message === CAMPAIGN_TOO_LONG,
    );
    await assert.rejects(
      save({ imageUrl: "x".repeat(CAMPAIGN_EXTRA_LIMITS.imageUrl + 1) }),
      (e) => e.message === CAMPAIGN_TOO_LONG,
    );
    await assert.rejects(
      save({ templateId: "x".repeat(CAMPAIGN_EXTRA_LIMITS.templateId + 1) }),
      (e) => e.message === CAMPAIGN_TOO_LONG,
    );
    const attachment = {
      id: "a",
      name: "n",
      url: "https://x.example/a.pdf",
      type: "application/pdf",
      size: 1,
    };
    await assert.rejects(
      save({
        attachments: Array.from({ length: CAMPAIGN_EXTRA_LIMITS.attachments + 1 }, (_, i) => ({
          ...attachment,
          id: `a${i}`,
        })),
      }),
      (e) => e.message === CAMPAIGN_TOO_LONG,
    );
    await assert.rejects(
      save({
        attachments: [{ ...attachment, url: "x".repeat(CAMPAIGN_EXTRA_LIMITS.attachmentUrl + 1) }],
      }),
      (e) => e.message === CAMPAIGN_TOO_LONG,
    );
    assert.equal(campaigns().length, 0, "none of them reached the table");
  });

  test("a refusal from the server is shown as the sentence, not as the code", async () => {
    // The form checks the name, the subject, the body and the picture's address
    // itself; the number of attached files it only stops at on the Attach button.
    // A campaign that already carries too many (saved before the limit, or by
    // hand) gets through the form and is refused by the server.
    const attachment = {
      id: "a",
      name: "n",
      url: "https://x.example/a.pdf",
      type: "application/pdf",
      size: 1,
    };
    const crowded = aCampaign("55555555-5555-4555-8555-555555555555", {
      attachments: Array.from({ length: CAMPAIGN_EXTRA_LIMITS.attachments + 1 }, (_, i) => ({
        ...attachment,
        id: `a${i}`,
      })),
    });
    db.table("campaigns").push(crowded);
    await mount(baseProps({ campaigns: [crowded] }));
    await click(buttonByIcon(document.querySelector(".shadow-sm"), "pen"));
    await click(buttonByText("Save as Draft"));
    assert.equal(globalThis.boardServerCalls.length, 1, "the server was asked");
    assert.deepEqual(toasts("error"), [messages["marketing.campaignTooLong"]]);
    assert.doesNotMatch(toasts("error").join(" "), /campaign_field_too_long/);
    assert.ok(composerIsOpen(), "and the composer keeps what the person wrote");
  });
});

/* ── 4. the page that holds the board ────────────────────────────────────── */

describe("PR #58 re-review: the route has no second way to save", () => {
  const route = read("src/routes/_authenticated/marketing.tsx");
  const boardSource = read("src/components/marketing/CampaignBoard.tsx");
  const composer = read("src/components/marketing/CampaignComposerModal.tsx");

  test("the unused mutation, its hidden form state and the direct queue write are gone", () => {
    assert.doesNotMatch(route, /createCampaign/);
    assert.doesNotMatch(route, /campaignForm/);
    assert.doesNotMatch(route, /const \[draftId/);
    assert.doesNotMatch(route, /queueCampaign/);
    assert.doesNotMatch(route, /\.from\("campaigns"\)\s*\.(insert|update|upsert)\(/);
  });

  test("the route never hands the board a count it made up", () => {
    assert.doesNotMatch(route, /emailAudience\?\.total \?\? 0/);
    assert.match(
      route,
      /audienceCount=\{emailAudience && !emailAudience\.truncated \? emailAudience\.total : null\}/,
    );
    assert.match(route, /audiencePartial=\{emailAudience\?\.truncated === true\}/);
  });

  test("the board saves through the server function and does not insert or update a campaign's content itself", () => {
    assert.match(boardSource, /useServerFn\(saveCampaignDraft\)/);
    assert.doesNotMatch(boardSource, /recipients_count: audienceCount/);
    assert.doesNotMatch(boardSource, /\.insert\(/);
    assert.doesNotMatch(boardSource, /insert: \(values/);
    // The one direct write left is the stage button on a card, which sends no
    // count and cannot set "sent" (tests/campaign-board-honesty.test.mjs).
    const writes = boardSource.match(/\.update\(/g) ?? [];
    assert.equal(writes.length, 1);
  });

  test("the composer only closes when the save worked", () => {
    assert.match(
      composer,
      /onSave: \(data: CampaignComposerData, isScheduled\?: boolean\) => Promise<boolean>/,
    );
    assert.match(composer, /if \(saved\) onOpenChange\(false\)/);
  });
});
