// Two-factor sign-in, on screen: what the sign-in page and the signed-in layout
// do with a session that has given the password but not the code.
//
//   npm run test:stale-chunk        (this file is on that line)
//
// The real sign-in page, the real signed-in layout, the real auth provider and
// the real supabase-js client are drawn in jsdom. Only what needs a deployment
// is replaced: the Auth service is an in-process double that signs real tokens
// (tests/support/fake-supabase.mjs), the router is a small stand-in that
// records every move (tests/support/two-factor-router-double.jsx), and the
// layout's data-loading children are blanked. "A signed-in screen" is a marker
// that stands for any screen the layout protects.
//
// Look here first if this suite stops starting after a dependency bump:
// tests/support/two-factor-build.mjs bundles the app for it, and
// tests/support/two-factor-wire.mjs drives TanStack Start's own middleware
// executor (__executeServer, runWithStartContext from @tanstack/start-storage-
// context, a transitive package). A change in either shows up as a bundle or
// import error, not as a silent pass.
//
// MUTATION names one way of putting the bug back (see the list at the bottom
// of the pull request). The suite MUST fail under each.
import { test, describe, before, after, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { installBrowser } from "./support/two-factor-dom.mjs";
import { createFakeSupabase } from "./support/fake-supabase.mjs";
import { buildScreensBundle } from "./support/two-factor-build.mjs";

// The browser must exist before React is loaded: react-dom looks for a document
// when it loads and switches its event handling off if there is none. (That is
// why React is imported here and not at the top of the file.)
const browser = installBrowser();
const React = (await import("react")).default;
const { act } = React;
const { createRoot } = await import("react-dom/client");
const fake = await createFakeSupabase();
process.env.SUPABASE_URL = fake.url;
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fake_for_tests";
const realFetch = globalThis.fetch;
globalThis.fetch = fake.fetch;

const app = await import(await buildScreensBundle());
const { supabase, watched } = app;

before(() => {
  // The server guard logs every call; and useServerFn warns that there is no
  // real router, which only matters when a server function redirects.
  mock.method(console, "info", () => {});
  const warn = console.warn;
  mock.method(console, "warn", (...args) => {
    if (/RouterProvider/.test(String(args[0]))) return;
    if (/^\[serverFn\]/.test(String(args[0]))) return;
    // The server half builds its own client per call, in the same "browser".
    if (/Multiple GoTrueClient instances/.test(String(args[0]))) return;
    warn(...args);
  });
});
after(() => {
  mock.restoreAll();
  globalThis.fetch = realFetch;
  browser.window.close();
});

// ---------------------------------------------------------------------------
// Driving the page

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const doc = browser.document;
let root = null;
let observer = null;
let watchedSelectors = new Map();

/** Let whatever is in flight finish. */
const settle = (ms = 60) =>
  act(async () => {
    await sleep(ms);
  });

/** Wait until something is true (or give up and say so), letting the page react meanwhile. */
async function until(predicate, ms = 2500) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await settle(15);
  }
  return Boolean(predicate());
}

/** Draw the app at an address, in a language. */
async function show({ at = "/auth", language = "en" } = {}) {
  doc.cookie = `flas_lang=${language}; path=/`;
  root = createRoot(browser.root);
  await act(async () => {
    root.render(React.createElement(app.App, { startAt: at, language }));
  });
  await settle();
}

/** Remembers whether an element ever appeared, even for an instant. */
function keepWatching(selector) {
  watchedSelectors.set(selector, false);
  observer ??= new browser.window.MutationObserver(() => {
    for (const key of watchedSelectors.keys())
      if (doc.querySelector(key)) watchedSelectors.set(key, true);
  });
  observer.observe(doc.body, { childList: true, subtree: true });
}
const everAppeared = (selector) =>
  watchedSelectors.get(selector) === true || Boolean(doc.querySelector(selector));

const codeField = () => doc.getElementById("mfa");
const signedInScreen = () => doc.querySelector("[data-testid='signed-in-screen']");
const here = () => browser.root.firstElementChild?.getAttribute("data-address");

function setValue(input, value) {
  const set = Object.getOwnPropertyDescriptor(
    browser.window.HTMLInputElement.prototype,
    "value",
  ).set;
  set.call(input, value);
  input.dispatchEvent(new browser.window.Event("input", { bubbles: true }));
}
const type = (id, value) =>
  act(async () => {
    setValue(doc.getElementById(id), value);
  });
const submit = (id) =>
  act(async () => {
    doc
      .getElementById(id)
      .closest("form")
      .dispatchEvent(new browser.window.Event("submit", { bubbles: true, cancelable: true }));
  });
const press = (element) =>
  act(async () => {
    element.dispatchEvent(new browser.window.MouseEvent("click", { bubbles: true, button: 0 }));
  });
// Radix tabs open on mouse-down, not on click.
const pressTab = (element) =>
  act(async () => {
    element.dispatchEvent(new browser.window.MouseEvent("mousedown", { bubbles: true, button: 0 }));
  });
const buttonSaying = (text) =>
  [...doc.querySelectorAll("button")].find((button) => button.textContent.trim() === text);

async function signInWithPassword(person) {
  await type("email", person.email);
  await type("password", person.password);
  await submit("email");
}

async function enterCode(code) {
  await type("mfa", code);
  await submit("mfa");
}

/** A browser session that did not come from the password form, e.g. a link in an e-mail. */
async function arriveWithSession(person, options) {
  const made = await fake.session(person.id, options);
  const body = await fake.sessionBody(made);
  let outcome;
  await act(async () => {
    outcome = await supabase.auth.setSession(body);
  });
  assert.equal(outcome.error, null, outcome.error?.message);
  return made;
}

// ---------------------------------------------------------------------------
// People

let people = 0;
/** A fresh account each time, so no test leans on what another left behind. */
function person({ factors = [] } = {}) {
  people += 1;
  const id = `20000000-0000-4000-8000-${String(people).padStart(12, "0")}`;
  const account = {
    id,
    email: `person${people}@example.test`,
    password: `pw-${people}-correct-horse`,
  };
  fake.addUser({ ...account, factors });
  return account;
}
const VERIFIED = { id: "factor-verified", status: "verified" };
const UNVERIFIED = { id: "factor-started", status: "unverified" };
const RIGHT_CODE = "123456";

beforeEach(() => {
  watched.reset();
  browser.location.assigned.length = 0;
  fake.clearCalls();
  fake.confirmEmailOnSignUp(false);
  for (const name of ["user", "jwks", "rpc:access_state"]) fake.recover(name);
  watchedSelectors = new Map();
  observer?.disconnect();
  observer = null;
});
afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  browser.window.localStorage.clear();
  doc.cookie = "flas_lang=; path=/; max-age=0";
});

const INTRO = "Your account is protected with two-factor sign-in. Enter your code to continue.";

// ---------------------------------------------------------------------------

describe("the sign-in page, for an account with two-factor", () => {
  test("asks for the code after the right password and does not let anyone in", async () => {
    const me = person({ factors: [VERIFIED] });
    await show();
    keepWatching("[data-testid='signed-in-screen']");
    await signInWithPassword(me);
    assert.ok(
      await until(() => codeField() || watched.navigations.length),
      "nothing happened after the password",
    );
    await settle(200); // long enough for a late redirect to show up
    assert.ok(codeField(), "the code field is not on screen");
    assert.deepEqual(watched.navigations, [], "the page moved on with only the password");
    assert.equal(everAppeared("[data-testid='signed-in-screen']"), false);
    assert.equal(here(), "/auth");
  });

  test("says why it is asking, and which account is waiting", async () => {
    const me = person({ factors: [VERIFIED] });
    await show();
    await signInWithPassword(me);
    assert.ok(await until(() => codeField()), "the code field never appeared");
    assert.ok(doc.body.textContent.includes(INTRO), "the introduction is missing");
    const line = [...doc.querySelectorAll("p")].find((p) => p.textContent.startsWith("Account:"));
    assert.ok(line, "the account line is missing");
    assert.equal(line.textContent, `Account: ${me.email}`);
    const address = line.querySelector("bdi");
    assert.ok(address, "the address is not isolated from the sentence around it");
    assert.equal(address.getAttribute("dir"), "ltr");
    assert.equal(address.textContent, me.email);
  });

  test("in Arabic the sentence is translated and the address stays left-to-right inside it", async () => {
    const me = person({ factors: [VERIFIED] });
    await show({ language: "ar" });
    await signInWithPassword(me);
    assert.ok(await until(() => codeField()), "the code field never appeared");
    const line = doc.querySelector("p:has(bdi)");
    assert.ok(line, "the account line is missing");
    assert.equal(line.textContent, `الحساب: ${me.email}`);
    assert.equal(line.querySelector("bdi").getAttribute("dir"), "ltr");
    assert.match(doc.body.textContent, /حسابك محميّ بتسجيل الدخول بالتحقق الثنائي/);
    assert.ok(!doc.body.textContent.includes(INTRO), "the English sentence is showing in Arabic");
  });

  test("moves on exactly once, to the home screen, after the right code", async () => {
    const me = person({ factors: [VERIFIED] });
    await show();
    await signInWithPassword(me);
    assert.ok(await until(() => codeField()), "the code field never appeared");
    await enterCode(RIGHT_CODE);
    assert.ok(await until(() => watched.navigations.length > 0), "never moved on");
    await settle(200);
    assert.deepEqual(watched.navigations, ["/inbox"]);
    assert.ok(signedInScreen());
    assert.equal(codeField(), null);
  });

  test("moves on to the page it was asked for, when that page is on this site", async () => {
    const me = person({ factors: [VERIFIED] });
    await show({ at: "/auth?redirect=%2Fsettings" });
    await signInWithPassword(me);
    assert.ok(await until(() => codeField()), "the code field never appeared");
    await enterCode(RIGHT_CODE);
    assert.ok(await until(() => watched.navigations.length > 0));
    await settle(200);
    assert.deepEqual(watched.navigations, ["/settings"]);
  });

  test("ignores a destination that leaves the site", async () => {
    const me = person({ factors: [VERIFIED] });
    await show({ at: "/auth?redirect=%2F%2Fevil.test" });
    await signInWithPassword(me);
    assert.ok(await until(() => codeField()), "the code field never appeared");
    await enterCode(RIGHT_CODE);
    assert.ok(await until(() => watched.navigations.length > 0));
    await settle(200);
    assert.deepEqual(watched.navigations, ["/inbox"]);
  });

  test("stays on the code form, with Auth's message, after a wrong code", async () => {
    const me = person({ factors: [VERIFIED] });
    await show();
    await signInWithPassword(me);
    assert.ok(await until(() => codeField()), "the code field never appeared");
    await enterCode("000000");
    assert.ok(await until(() => watched.toasts.length > 0), "no message was shown");
    await settle(200);
    assert.equal(watched.toasts[0].kind, "error");
    assert.match(watched.toasts[0].message, /Invalid TOTP code/);
    assert.ok(codeField(), "the code form went away");
    assert.deepEqual(watched.navigations, []);
    assert.equal(signedInScreen(), null);
  });

  test("Back signs the half-signed-in session out and shows the password form again", async () => {
    const me = person({ factors: [VERIFIED] });
    await show();
    await signInWithPassword(me);
    assert.ok(await until(() => codeField()), "the code field never appeared");
    await press(buttonSaying("Back"));
    assert.ok(
      await until(() => doc.getElementById("password")),
      "the password form did not come back",
    );
    assert.equal(codeField(), null);
    assert.equal((await supabase.auth.getSession()).data.session, null);
    assert.deepEqual(watched.navigations, []);
  });

  test("after Back, somebody else can sign in on the same page", async () => {
    const first = person({ factors: [VERIFIED] });
    const second = person();
    await show();
    await signInWithPassword(first);
    assert.ok(await until(() => codeField()), "the code field never appeared");
    await press(buttonSaying("Back"));
    assert.ok(await until(() => doc.getElementById("password")));
    await signInWithPassword(second);
    assert.ok(await until(() => watched.navigations.length > 0));
    assert.deepEqual(watched.navigations, ["/inbox"]);
  });

  test("is asked for the code too when the session arrived some other way, such as an e-mailed link", async () => {
    const me = person({ factors: [VERIFIED] });
    await show();
    keepWatching("[data-testid='signed-in-screen']");
    await arriveWithSession(me, { aal: "aal1", method: "magiclink" });
    assert.ok(await until(() => codeField() || watched.navigations.length));
    await settle(200);
    assert.ok(codeField(), "a link sign-in skipped the code");
    assert.deepEqual(watched.navigations, []);
    assert.equal(everAppeared("[data-testid='signed-in-screen']"), false);
  });

  test("moves on by itself when the code is finished somewhere else", async () => {
    // Two tabs share one stored session: when the other tab verifies, this one follows.
    const me = person({ factors: [VERIFIED] });
    await show();
    await signInWithPassword(me);
    assert.ok(await until(() => codeField()), "the code field never appeared");
    await arriveWithSession(me, { aal: "aal2" });
    assert.ok(await until(() => watched.navigations.length > 0));
    await settle(200);
    assert.deepEqual(watched.navigations, ["/inbox"]);
  });

  test("goes straight on with a session that has already entered its code", async () => {
    const me = person({ factors: [VERIFIED] });
    await show();
    keepWatching("#mfa");
    await arriveWithSession(me, { aal: "aal2" });
    assert.ok(await until(() => watched.navigations.length > 0));
    await settle(200);
    assert.deepEqual(watched.navigations, ["/inbox"]);
    assert.equal(everAppeared("#mfa"), false, "asked for a code it already had");
  });
});

describe("the sign-in page, for an account without two-factor", () => {
  test("goes in after the password, with no code form at all", async () => {
    const me = person();
    await show();
    keepWatching("#mfa");
    await signInWithPassword(me);
    assert.ok(await until(() => watched.navigations.length > 0), "never moved on");
    await settle(200);
    assert.deepEqual(watched.navigations, ["/inbox"]);
    assert.equal(everAppeared("#mfa"), false, "the code form flashed up");
    assert.deepEqual(watched.toasts, []);
  });

  test("goes in after the password when two-factor was only started, not finished", async () => {
    const me = person({ factors: [UNVERIFIED] });
    await show();
    keepWatching("#mfa");
    await signInWithPassword(me);
    assert.ok(await until(() => watched.navigations.length > 0));
    await settle(200);
    assert.deepEqual(watched.navigations, ["/inbox"]);
    assert.equal(everAppeared("#mfa"), false, "asked for a code the account cannot give");
  });

  test("a wrong password still shows Auth's message and goes nowhere", async () => {
    const me = person();
    await show();
    await signInWithPassword({ ...me, password: "not the password" });
    assert.ok(await until(() => watched.toasts.length > 0));
    await settle(100);
    assert.match(watched.toasts[0].message, /Invalid login credentials/);
    assert.deepEqual(watched.navigations, []);
    assert.equal(codeField(), null);
  });
});

describe("creating an account", () => {
  async function fillSignUp(email) {
    await pressTab(doc.querySelector("[role='tab'][id$='trigger-signup']"));
    assert.ok(await until(() => doc.getElementById("email2")), "the sign-up form did not open");
    await type("name", "New Person");
    await type("email2", email);
    await type("password2", "a-long-enough-password");
    await submit("email2");
  }

  test("that gets a session at once goes in, exactly once, and is not asked for a code", async () => {
    await show({ at: "/auth?redirect=%2Fsettings" });
    keepWatching("#mfa");
    await fillSignUp("brand-new@example.test");
    assert.ok(await until(() => watched.navigations.length > 0), "never moved on");
    await settle(200);
    assert.deepEqual(watched.navigations, ["/settings"]);
    assert.equal(everAppeared("#mfa"), false);
  });

  test("that must confirm its e-mail first stays on the page and says to check the inbox", async () => {
    fake.confirmEmailOnSignUp(true);
    await show();
    await fillSignUp("later@example.test");
    assert.ok(await until(() => watched.toasts.length > 0));
    await settle(200);
    assert.deepEqual(watched.navigations, []);
    assert.match(doc.body.textContent, /later@example\.test/);
  });
});

// ---------------------------------------------------------------------------

describe("the signed-in layout, for a session that only gave the password", () => {
  const SCREEN = "[data-testid='signed-in-screen']";

  test("draws nothing, sends no heartbeat, and sends the person to the code prompt", async () => {
    const me = person({ factors: [VERIFIED] });
    await arriveWithSession(me, { aal: "aal1", method: "password" });
    keepWatching(SCREEN);
    await show({ at: "/inbox" });
    assert.ok(await until(() => watched.navigations.length > 0), "the layout let the session stay");
    await settle(300);
    assert.deepEqual(watched.navigations, ["/auth?redirect=%2Finbox"]);
    assert.equal(
      everAppeared(SCREEN),
      false,
      "a signed-in screen was drawn for a session that owes a code",
    );
    assert.deepEqual(
      watched.sent,
      [],
      "a server call left the browser for a session that owes a code",
    );
    assert.ok(codeField(), "the code prompt is not on screen");
  });

  test("remembers the page it was on, whichever page that was", async () => {
    const me = person({ factors: [VERIFIED] });
    await arriveWithSession(me, { aal: "aal1", method: "recovery" });
    await show({ at: "/contacts" });
    assert.ok(await until(() => watched.navigations.length > 0));
    await settle(200);
    assert.deepEqual(watched.navigations, ["/auth?redirect=%2Fcontacts"]);
  });

  test("brings the person back to that page, and draws it, once the code is right", async () => {
    const me = person({ factors: [VERIFIED] });
    await arriveWithSession(me, { aal: "aal1", method: "magiclink" });
    await show({ at: "/inbox" });
    assert.ok(await until(() => codeField()), "the code field never appeared");
    await enterCode(RIGHT_CODE);
    assert.ok(await until(() => signedInScreen()), "never got back in");
    await settle(300);
    assert.deepEqual(watched.navigations, ["/auth?redirect=%2Finbox", "/inbox"]);
    assert.equal(codeField(), null);
    assert.ok(
      watched.served.some((call) => call.name === "touchPresence" && call.userId === me.id),
      "the heartbeat did not start once the code was entered",
    );
  });

  test("catches a session that becomes owed while the app is open (two-factor switched on elsewhere)", async () => {
    const me = person();
    await arriveWithSession(me, { aal: "aal1" });
    await show({ at: "/inbox" });
    assert.ok(await until(() => signedInScreen()), "the account without two-factor was not let in");
    assert.deepEqual(watched.navigations, []);

    // Another device enrols and verifies a factor; this browser learns of it when its token refreshes.
    fake.user(me.id).factors.push({ ...VERIFIED, type: "totp", code: RIGHT_CODE });
    await act(async () => {
      await supabase.auth.refreshSession();
    });
    assert.ok(
      await until(() => watched.navigations.length > 0),
      "the open page was never asked for the code",
    );
    await settle(300);
    assert.deepEqual(watched.navigations, ["/auth?redirect=%2Finbox"]);
    assert.equal(signedInScreen(), null);
    assert.ok(codeField());
  });
});

describe("the signed-in layout, for everyone else", () => {
  test("draws the screen for a session that has entered its code, and sends the heartbeat", async () => {
    const me = person({ factors: [VERIFIED] });
    await arriveWithSession(me, { aal: "aal2" });
    await show({ at: "/inbox" });
    assert.ok(await until(() => signedInScreen()), "an account that entered its code was kept out");
    assert.ok(await until(() => watched.served.length > 0), "no heartbeat");
    assert.deepEqual(watched.navigations, []);
    assert.equal(watched.served[0].userId, me.id);
  });

  test("draws the screen for an account without two-factor", async () => {
    const me = person();
    await arriveWithSession(me, { aal: "aal1" });
    await show({ at: "/inbox" });
    assert.ok(await until(() => signedInScreen()));
    assert.ok(await until(() => watched.served.length > 0), "no heartbeat");
    assert.deepEqual(watched.navigations, []);
  });

  test("draws the screen for an account that only started setting two-factor up", async () => {
    const me = person({ factors: [UNVERIFIED] });
    await arriveWithSession(me, { aal: "aal1" });
    await show({ at: "/inbox" });
    assert.ok(await until(() => signedInScreen()));
    assert.ok(await until(() => watched.served.length > 0), "no heartbeat");
    assert.deepEqual(watched.navigations, []);
  });

  test("sends a visitor with no session to the sign-in page, as before", async () => {
    keepWatching("[data-testid='signed-in-screen']");
    await show({ at: "/inbox" });
    assert.ok(await until(() => watched.navigations.length > 0));
    await settle(200);
    assert.deepEqual(watched.navigations, ["/auth"]);
    assert.equal(everAppeared("[data-testid='signed-in-screen']"), false);
    assert.deepEqual(watched.sent, []);
  });
});
