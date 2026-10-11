// Two-factor sign-in, on the server: which sessions may call a server function.
//
//   npm run test:stale-chunk        (this file is on that line)
//
// An account that switched two-factor on must not be usable with its password
// alone. The browser can be told to ask for the code, but the browser belongs
// to whoever is holding it, so the rule has to hold where the work is done.
//
// Everything below runs the app's own code: src/start.ts decides which
// middleware runs for every server function, TanStack Start's executor runs
// it, requireSupabaseAuth checks the token with supabase-js, and the Auth
// service is an in-process double that signs real tokens (tests/support/
// fake-supabase.mjs). Only the handlers are made up, because what is under
// test is what happens before a handler is reached.
//
// MUTATION names one way of putting the bug back (see the list at the bottom
// of the pull request). The suite MUST fail under each.
import { test, describe, before, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { buildServerBundle } from "./support/two-factor-build.mjs";
import { createFakeSupabase } from "./support/fake-supabase.mjs";

const fake = await createFakeSupabase();
process.env.SUPABASE_URL = fake.url;
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fake_for_tests";
const realFetch = globalThis.fetch;
globalThis.fetch = fake.fetch;

const mod = await import(await buildServerBundle());
const startOptions = await mod.startInstance.getOptions();

// The guard logs every call; that is noise here.
before(() => {
  mock.method(console, "info", () => {});
  mock.method(console, "warn", () => {});
  mock.method(console, "error", () => {});
});
after(() => {
  mock.restoreAll();
  globalThis.fetch = realFetch;
});
beforeEach(() => {
  for (const level of ["info", "warn", "error"]) console[level].mock.resetCalls();
  fake.clearCalls();
  for (const name of ["user", "jwks", "rpc:access_state"]) fake.recover(name);
});

/**
 * A server function as the compiler would emit it: a name, the file it lives
 * in, the middleware the author gave it, and a handler. `open` leaves
 * requireSupabaseAuth off, which is what the app's public functions do.
 */
function serverFn(name, { open = false, file = "src/lib/example.functions.ts" } = {}) {
  const ran = [];
  const builder = mod.createServerFn({ method: "POST" });
  const rpc = Object.assign(
    () => {
      throw new Error("the browser half is not used in this suite");
    },
    { serverFnMeta: { id: `id-${name}`, name, filename: file } },
  );
  const fn = (open ? builder : builder.middleware([mod.requireSupabaseAuth])).handler(
    rpc,
    async ({ context }) => {
      ran.push(context.userId ?? null);
      return { ok: true, userId: context.userId ?? null };
    },
  );
  return { fn, ran };
}

/** One call arriving at the server with this bearer token (or none), or with a header written out in full. */
async function call(target, token, { header } = {}) {
  const authorization = header ?? (token ? `Bearer ${token}` : undefined);
  const request = new Request("https://app.test/_serverFn/abc", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });
  return mod.runWithStartContext(
    {
      startOptions,
      request,
      contextAfterGlobalMiddlewares: {},
      executedRequestMiddlewares: new Set(),
    },
    () => target.fn.__executeServer({ data: undefined, method: "POST", context: {} }),
  );
}

let accounts = 0;
/** A fresh account each time, so no test can lean on what another one left behind. */
function account(factors = []) {
  accounts += 1;
  const id = `10000000-0000-4000-8000-${String(accounts).padStart(12, "0")}`;
  fake.addUser({ id, email: `person${accounts}@example.test`, factors });
  return id;
}
const VERIFIED = { id: "factor-verified", status: "verified" };
const UNVERIFIED = { id: "factor-started", status: "unverified" };

const refused = (result, target, pattern) => {
  assert.ok(result.error, "the call was let through");
  assert.match(result.error.message, pattern);
  assert.deepEqual(target.ran, [], "the handler ran for a call that was refused");
};
const accepted = (result, target, userId) => {
  assert.equal(result.error, undefined, result.error?.message);
  assert.deepEqual(result.result, { ok: true, userId });
  assert.deepEqual(target.ran, [userId]);
};

const PUBLIC_BILLING = "src/lib/public-billing.functions.ts";
const TELEMETRY = "src/lib/telemetry.functions.ts";
const NEEDS_CODE = /two-factor code/i;
const COULD_NOT_CHECK = /could not check/i;
const SIGN_IN_AGAIN = /^Unauthorized/;

describe("a server function that needs sign-in, for an account with two-factor", () => {
  test("refuses a session that only gave the password", async () => {
    const user = account([VERIFIED]);
    const session = await fake.session(user, { aal: "aal1", method: "password" });
    const target = serverFn("listInvoices");
    refused(await call(target, session.token), target, NEEDS_CODE);
  });

  for (const method of ["otp", "magiclink", "recovery", "oauth"]) {
    test(`refuses a session that came from somewhere the code is never asked (${method})`, async () => {
      const user = account([VERIFIED]);
      const session = await fake.session(user, { aal: "aal1", method });
      const target = serverFn("listInvoices");
      refused(await call(target, session.token), target, NEEDS_CODE);
    });
  }

  test("accepts the session once the code has been entered", async () => {
    const user = account([VERIFIED]);
    const session = await fake.session(user, { aal: "aal2", method: "password" });
    const target = serverFn("listInvoices");
    accepted(await call(target, session.token), target, user);
  });

  test("looks nothing up for a session that entered its code", async () => {
    const user = account([VERIFIED]);
    const session = await fake.session(user, { aal: "aal2" });
    await call(serverFn("listInvoices"), session.token);
    assert.equal(fake.count("user"), 0);
  });

  test("refuses again as soon as it is asked, even right after an accepted call", async () => {
    const user = account([VERIFIED]);
    const withCode = await fake.session(user, { aal: "aal2" });
    const passwordOnly = await fake.session(user, { aal: "aal1" });
    const first = serverFn("listInvoices");
    accepted(await call(first, withCode.token), first, user);
    const second = serverFn("listInvoices");
    refused(await call(second, passwordOnly.token), second, NEEDS_CODE);
  });
});

describe("a server function that needs sign-in, for an account without two-factor", () => {
  test("accepts the password alone, as before", async () => {
    const user = account();
    const session = await fake.session(user);
    const target = serverFn("listInvoices");
    accepted(await call(target, session.token), target, user);
  });

  test("accepts someone half-way through setting two-factor up", async () => {
    const user = account([UNVERIFIED]);
    const session = await fake.session(user);
    const target = serverFn("listInvoices");
    accepted(await call(target, session.token), target, user);
  });

  test("accepts them the moment set-up finishes on this session", async () => {
    // Verifying the first code raises this very session to aal2.
    const user = account([UNVERIFIED]);
    const session = await fake.session(user);
    const before = serverFn("listInvoices");
    accepted(await call(before, session.token), before, user);
    fake.user(user).factors[0].status = "verified";
    session.raw.aal = "aal2";
    const after = serverFn("listInvoices");
    accepted(await call(after, await fake.tokenFor(session)), after, user);
  });
});

describe("when the factor lookup cannot be made", () => {
  const faults = {
    "the Auth service answers 500": { status: 500 },
    "the Auth service answers 429": { status: 429 },
    "the network fails": { network: true },
    "the answer is not what Auth sends": { garbled: true },
  };
  for (const [what, fault] of Object.entries(faults)) {
    test(`refuses an account with two-factor (${what})`, async () => {
      const user = account([VERIFIED]);
      const session = await fake.session(user);
      fake.fail("user", fault);
      const target = serverFn("listInvoices");
      refused(await call(target, session.token), target, COULD_NOT_CHECK);
    });
  }

  test("refuses an account without two-factor too, and says to try again, not to enter a code", async () => {
    const user = account();
    const session = await fake.session(user);
    fake.fail("user", { status: 500 });
    const target = serverFn("listInvoices");
    const result = await call(target, session.token);
    refused(result, target, COULD_NOT_CHECK);
    assert.doesNotMatch(result.error.message, NEEDS_CODE);
    assert.doesNotMatch(result.error.message, SIGN_IN_AGAIN);
  });

  test("lets the same person back in as soon as the lookup works again", async () => {
    const user = account();
    const session = await fake.session(user);
    fake.fail("user", { network: true });
    const during = serverFn("listInvoices");
    refused(await call(during, session.token), during, COULD_NOT_CHECK);
    fake.recover("user");
    const afterwards = serverFn("listInvoices");
    accepted(await call(afterwards, session.token), afterwards, user);
  });

  test("is not affected by a session that entered its code", async () => {
    const user = account([VERIFIED]);
    const session = await fake.session(user, { aal: "aal2" });
    fake.fail("user", { status: 500 });
    const target = serverFn("listInvoices");
    accepted(await call(target, session.token), target, user);
  });
});

describe("a token the Auth service no longer vouches for", () => {
  test("is refused for an account with two-factor that signed out after giving only the password", async () => {
    // Without this, "sign in with the password, sign out, keep the token"
    // would dodge the lookup: the token's signature is still good for an hour.
    const user = account([VERIFIED]);
    const session = await fake.session(user);
    fake.revoke(session.id);
    const target = serverFn("listInvoices");
    refused(await call(target, session.token), target, SIGN_IN_AGAIN);
  });

  test("is told to sign in again, not to enter a code", async () => {
    const user = account();
    const session = await fake.session(user);
    fake.revoke(session.id);
    const target = serverFn("listInvoices");
    const result = await call(target, session.token);
    refused(result, target, SIGN_IN_AGAIN);
    assert.doesNotMatch(result.error.message, NEEDS_CODE);
  });
});

describe("how often the lookup is made", () => {
  test("an account that switches two-factor on is refused once the remembered answer is a minute old", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
    const user = account();
    const session = await fake.session(user);
    const first = serverFn("listInvoices");
    accepted(await call(first, session.token), first, user);

    fake.user(user).factors.push({ ...VERIFIED, type: "totp", code: "123456" });
    t.mock.timers.tick(61_000);
    const second = serverFn("listInvoices");
    refused(await call(second, session.token), second, NEEDS_CODE);
  });

  test("a refusal is never remembered: once two-factor is removed the very next call gets in", async () => {
    const user = account([VERIFIED]);
    const session = await fake.session(user);
    const first = serverFn("listInvoices");
    refused(await call(first, session.token), first, NEEDS_CODE);

    fake.user(user).factors.length = 0;
    const second = serverFn("listInvoices");
    accepted(await call(second, session.token), second, user);
  });

  test("one person's remembered answer is not used for anybody else", async () => {
    const plain = account();
    const protectedAccount = account([VERIFIED]);
    const plainSession = await fake.session(plain);
    const first = serverFn("listInvoices");
    accepted(await call(first, plainSession.token), first, plain);

    const other = await fake.session(protectedAccount);
    const second = serverFn("listInvoices");
    refused(await call(second, other.token), second, NEEDS_CODE);
  });
});

describe("a token nobody at Auth signed", () => {
  test("is rejected even when it claims the code was entered", async () => {
    const user = account([VERIFIED]);
    const forged = await fake.forge({ sub: user, aal: "aal2", session_id: "made-up" });
    const target = serverFn("listInvoices");
    refused(await call(target, forged), target, SIGN_IN_AGAIN);
  });

  test("cannot borrow the answer remembered for a real session", async () => {
    const user = account();
    const session = await fake.session(user);
    const real = serverFn("listInvoices");
    accepted(await call(real, session.token), real, user);

    const forged = await fake.forge({ sub: user, aal: "aal1", session_id: session.id });
    const target = serverFn("listInvoices");
    refused(await call(target, forged), target, SIGN_IN_AGAIN);
  });
});

describe("a public server function", () => {
  test("answers a visitor with no session", async () => {
    const target = serverFn("getPublicDocument", { open: true, file: PUBLIC_BILLING });
    accepted(await call(target, undefined), target, null);
    assert.equal(fake.count("user"), 0);
  });

  test("answers someone whose session still owes a code, and looks nothing up", async () => {
    // Somebody stuck at the code prompt can still open an invoice link.
    const user = account([VERIFIED]);
    const session = await fake.session(user);
    const target = serverFn("getPublicDocument", { open: true, file: PUBLIC_BILLING });
    accepted(await call(target, session.token), target, null);
    assert.equal(fake.count("user"), 0);
  });

  test("is not held up when the factor lookup is down", async () => {
    const user = account();
    const session = await fake.session(user);
    fake.fail("user", { status: 500 });
    const target = serverFn("reportErrorEvent", { open: true, file: TELEMETRY });
    accepted(await call(target, session.token), target, null);
  });

  test("a function that is not on the public list is checked, even if it forgot to ask for sign-in", async () => {
    const user = account([VERIFIED]);
    const session = await fake.session(user);
    const target = serverFn("somethingAddedLater", { open: true });
    refused(await call(target, session.token), target, NEEDS_CODE);
  });
});

describe("a public server function, by name and by file", () => {
  // The seven functions the app serves without a sign-in, exactly as the
  // compiler names them. If one is added or renamed, this list and the one in
  // src/lib/two-factor.server.ts change together, on purpose.
  const OPEN = [
    ["getHomepageWidgetKey", "src/lib/homepage-widget.functions.ts"],
    ["resendVerification", "src/lib/otp-resend.functions.ts"],
    ["getPublicDocument", PUBLIC_BILLING],
    ["claimDocumentPayment", PUBLIC_BILLING],
    ["verifyDocument", PUBLIC_BILLING],
    ["reportErrorEvent", TELEMETRY],
    ["resolvePaddlePrice", "src/utils/payments.functions.ts"],
  ];

  for (const [name, file] of OPEN) {
    test(`${name} answers someone whose session still owes a code, and looks nothing up`, async () => {
      const user = account([VERIFIED]);
      const session = await fake.session(user);
      const target = serverFn(name, { open: true, file });
      accepted(await call(target, session.token), target, null);
      assert.equal(fake.count("user"), 0);
    });
  }

  test("a protected function that borrows a public name in another file is still checked", async () => {
    const user = account([VERIFIED]);
    const session = await fake.session(user);
    const target = serverFn("getPublicDocument", { file: "src/lib/example.functions.ts" });
    refused(await call(target, session.token), target, NEEDS_CODE);
  });

  test("a function that borrows a public name in another file is checked even without requireSupabaseAuth", async () => {
    const user = account([VERIFIED]);
    const session = await fake.session(user);
    const target = serverFn("getPublicDocument", {
      open: true,
      file: "src/lib/elsewhere.functions.ts",
    });
    refused(await call(target, session.token), target, NEEDS_CODE);
  });

  test("a public file with another function's name in it is checked too", async () => {
    const user = account([VERIFIED]);
    const session = await fake.session(user);
    const target = serverFn("somethingAddedLater", { open: true, file: PUBLIC_BILLING });
    refused(await call(target, session.token), target, NEEDS_CODE);
  });

  test("is recognised however the build writes the path (Windows separators)", async () => {
    const user = account([VERIFIED]);
    const session = await fake.session(user);
    const target = serverFn("getPublicDocument", {
      open: true,
      file: "src\\lib\\public-billing.functions.ts",
    });
    accepted(await call(target, session.token), target, null);
    assert.equal(fake.count("user"), 0);
  });

  test("is not held up by a token that has since died", async () => {
    const user = account([VERIFIED]);
    const session = await fake.session(user);
    fake.revoke(session.id);
    const target = serverFn("getPublicDocument", { open: true, file: PUBLIC_BILLING });
    accepted(await call(target, session.token), target, null);
  });
});

describe("a call the gate leaves for the generated middleware to refuse", () => {
  // The gate only has an opinion about a well-formed token. Everything else is
  // turned away by requireSupabaseAuth as before, and costs no lookup.
  const unlooked = async (token, options) => {
    const target = serverFn("listInvoices");
    const result = await call(target, token, options);
    refused(result, target, SIGN_IN_AGAIN);
    assert.equal(fake.count("user"), 0, "a lookup was made for a call that is refused anyway");
  };

  test("no sign-in at all", async () => {
    await unlooked(undefined);
  });

  test("a token with no user in it", async () => {
    await unlooked(await fake.signed({ aal: "aal1", session_id: "none" }));
  });

  test("a token that has expired", async () => {
    const user = account([VERIFIED]);
    const session = await fake.session(user);
    await unlooked(await fake.tokenFor(session, { expiresIn: -60 }));
  });

  test("a header written with a lower-case bearer", async () => {
    const user = account([VERIFIED]);
    const session = await fake.session(user);
    await unlooked(undefined, { header: `bearer ${session.token}` });
  });

  test("a header with more than the token in it", async () => {
    const user = account([VERIFIED]);
    const session = await fake.session(user);
    await unlooked(undefined, { header: `Bearer ${session.token} extra` });
  });

  test("a header that is not a three-part token", async () => {
    await unlooked(undefined, { header: "Bearer not-a-token" });
  });
});

describe("what the factor lookup says", () => {
  test("asks Auth with the caller's own token and the project's publishable key", async () => {
    const user = account();
    const session = await fake.session(user);
    const target = serverFn("listInvoices");
    accepted(await call(target, session.token), target, user);
    const asked = fake.calls.filter((entry) => entry.name === "user");
    assert.equal(asked.length, 1);
    assert.equal(asked[0].authorization, `Bearer ${session.token}`);
    assert.equal(asked[0].apikey, "sb_publishable_fake_for_tests");
  });

  test("understands an answer wrapped as { user }", async () => {
    const user = account([VERIFIED]);
    const session = await fake.session(user);
    fake.fail("user", { wrapped: true });
    const target = serverFn("listInvoices");
    refused(await call(target, session.token), target, NEEDS_CODE);
  });

  test("refuses, as could-not-check, an answer about somebody else", async () => {
    // Auth vouches for the token but describes another account: the gate must
    // not take the other account's empty factor list as this one's.
    const mine = account([VERIFIED]);
    const other = account();
    const session = await fake.session(mine);
    fake.fail("user", { asUser: other });
    const target = serverFn("listInvoices");
    refused(await call(target, session.token), target, COULD_NOT_CHECK);
  });

  for (const status of [401, 403, 404]) {
    test(`tells the person to sign in again when Auth answers ${status}, not to enter a code`, async () => {
      const user = account([VERIFIED]);
      const session = await fake.session(user);
      fake.fail("user", { status });
      const target = serverFn("listInvoices");
      const result = await call(target, session.token);
      refused(result, target, SIGN_IN_AGAIN);
      assert.doesNotMatch(result.error.message, NEEDS_CODE);
      assert.doesNotMatch(result.error.message, COULD_NOT_CHECK);
    });
  }

  test("does not count a verified factor of a kind the app cannot ask for", async () => {
    const user = account([{ id: "factor-phone", status: "verified", type: "phone" }]);
    const session = await fake.session(user);
    const target = serverFn("listInvoices");
    accepted(await call(target, session.token), target, user);
  });

  test("counts a verified authenticator app even when another one was only started", async () => {
    const user = account([UNVERIFIED, VERIFIED]);
    const session = await fake.session(user);
    const target = serverFn("listInvoices");
    refused(await call(target, session.token), target, NEEDS_CODE);
  });
});

describe("what the server writes in its log", () => {
  const written = (level) =>
    console[level].mock.calls.map((entry) => entry.arguments.join(" ")).join("\n");
  const everythingLogged = () => ["info", "warn", "error"].map(written).join("\n");

  test("a refusal is a warning that names the user, not an error, and never holds the token", async () => {
    const user = account([VERIFIED]);
    const session = await fake.session(user);
    const target = serverFn("listInvoices");
    refused(await call(target, session.token), target, NEEDS_CODE);
    assert.equal(console.error.mock.calls.length, 0, "a refusal was logged as an error");
    assert.ok(written("warn").includes(user), "the warning does not say whose call it was");
    assert.match(written("warn"), /two-factor/i);
    const logged = everythingLogged();
    assert.ok(!logged.includes(session.token), "the token was logged");
    assert.ok(!logged.includes(session.token.split(".")[1]), "the token's payload was logged");
    assert.ok(!logged.includes("example.test"), "an e-mail address was logged");
  });

  test("a lookup that fails is a warning too, and still holds no token", async () => {
    const user = account();
    const session = await fake.session(user);
    fake.fail("user", { status: 500 });
    const target = serverFn("listInvoices");
    refused(await call(target, session.token), target, COULD_NOT_CHECK);
    assert.equal(console.error.mock.calls.length, 0);
    assert.ok(!everythingLogged().includes(session.token));
  });
});

describe("a lookup that never answers", () => {
  test("is given up on after a few seconds, and the call is refused", async (t) => {
    const user = account([VERIFIED]);
    const session = await fake.session(user);
    fake.fail("user", { hang: true });
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const target = serverFn("listInvoices");
    const pending = call(target, session.token);
    // Let the call reach the lookup, then let the clock run past any patience.
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.tick(60_000);
    refused(await pending, target, COULD_NOT_CHECK);
  });

  test("is not given up on before the limit", async (t) => {
    const user = account();
    const session = await fake.session(user);
    fake.fail("user", { hang: true });
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const target = serverFn("listInvoices");
    let settled = false;
    const pending = call(target, session.token).then((result) => {
      settled = true;
      return result;
    });
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.tick(4_000);
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false, "gave up after 4 seconds");
    t.mock.timers.tick(2_000);
    refused(await pending, target, COULD_NOT_CHECK);
  });

  test("a lookup that answers in time leaves no timer behind", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const user = account();
    const session = await fake.session(user);
    const target = serverFn("listInvoices");
    accepted(await call(target, session.token), target, user);
    // Nothing waits to fire: running the clock forward changes nothing.
    t.mock.timers.tick(60_000);
  });
});

describe("how long an answer is remembered", () => {
  test("once a minute for one signed-in person, however much they do", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
    const user = account();
    const session = await fake.session(user);
    for (let i = 0; i < 5; i += 1) {
      const target = serverFn("listInvoices");
      accepted(await call(target, session.token), target, user);
      t.mock.timers.tick(10_000);
    }
    assert.equal(fake.count("user"), 1, "five calls one after another, one lookup");
    t.mock.timers.tick(30_000);
    const later = serverFn("listInvoices");
    accepted(await call(later, session.token), later, user);
    assert.equal(fake.count("user"), 2, "the answer is asked for again after a minute");
  });

  test("is asked for again exactly when the answer is a minute old, not before", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
    const user = account();
    const session = await fake.session(user);
    await call(serverFn("listInvoices"), session.token);
    t.mock.timers.tick(59_999);
    await call(serverFn("listInvoices"), session.token);
    assert.equal(fake.count("user"), 1, "asked again too soon");
    t.mock.timers.tick(1);
    await call(serverFn("listInvoices"), session.token);
    assert.equal(fake.count("user"), 2, "not asked again when the answer was a minute old");
  });

  test("calls made at the same moment each ask for themselves (a request never waits on another's lookup)", async () => {
    const user = account();
    const session = await fake.session(user);
    const targets = Array.from({ length: 6 }, () => serverFn("listInvoices"));
    const results = await Promise.all(targets.map((target) => call(target, session.token)));
    results.forEach((result, i) => accepted(result, targets[i], user));
    assert.equal(fake.count("user"), 6);
  });

  test("a failed lookup is not remembered, and the answer that follows it is", async () => {
    const user = account();
    const session = await fake.session(user);
    fake.fail("user", { status: 500 });
    const during = serverFn("listInvoices");
    refused(await call(during, session.token), during, COULD_NOT_CHECK);
    fake.recover("user");
    for (let i = 0; i < 3; i += 1) {
      const target = serverFn("listInvoices");
      accepted(await call(target, session.token), target, user);
    }
    assert.equal(fake.count("user"), 2, "one failed lookup, then one that was remembered");
  });

  test("an answer about somebody else is not remembered for the caller", async () => {
    const mine = account([VERIFIED]);
    const other = account();
    const session = await fake.session(mine);
    fake.fail("user", { asUser: other });
    const first = serverFn("listInvoices");
    refused(await call(first, session.token), first, COULD_NOT_CHECK);
    fake.recover("user");
    const second = serverFn("listInvoices");
    refused(await call(second, session.token), second, NEEDS_CODE);
  });

  test("two sessions of one person share the remembered answer, and it is the person's, not a token's", async () => {
    const user = account();
    const first = await fake.session(user);
    const second = await fake.session(user);
    await call(serverFn("listInvoices"), first.token);
    await call(serverFn("listInvoices"), second.token);
    assert.equal(fake.count("user"), 1);
  });

  test("only the most recent two thousand people are remembered; the oldest is forgotten first", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
    const first = account();
    const firstSession = await fake.session(first);
    await call(serverFn("listInvoices"), firstSession.token);
    t.mock.timers.tick(1);

    let last;
    for (let i = 0; i < 2000; i += 1) {
      const user = account();
      last = await fake.session(user);
      await call(serverFn("listInvoices"), last.token);
      t.mock.timers.tick(1);
    }
    assert.equal(fake.count("user"), 2001);

    await call(serverFn("listInvoices"), last.token);
    assert.equal(fake.count("user"), 2001, "the newest person was forgotten");
    await call(serverFn("listInvoices"), firstSession.token);
    assert.equal(fake.count("user"), 2002, "the oldest person was still remembered");
  });
});
