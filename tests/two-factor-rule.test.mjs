// Two-factor sign-in: the one rule that says whether a session still owes a code.
//
//   npm run test:stale-chunk        (this file is on that line)
//
// src/lib/two-factor.ts is a pure function of the session the app already holds
// in memory, so the sign-in page, the signed-in layout and the server all ask
// the same question and cannot disagree. It is read to decide to REFUSE; the
// server still checks the token's signature before it lets anything through.
//
// The pull request lists the ways this bug can come back (the rule ignoring the
// assurance level, the server not asking, a failure letting a call through, and
// so on). Each was put back by hand, one at a time, and this suite failed.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildRuleBundle } from "./support/two-factor-build.mjs";

const rule = await import(await buildRuleBundle());

const b64url = (value) =>
  Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");

/** A token the way Auth shapes one. The signature is not checked by the rule, so it is a placeholder. */
const token = (claims) => `${b64url({ alg: "ES256", typ: "JWT" })}.${b64url(claims)}.sig`;

const VERIFIED_TOTP = { id: "f-verified", status: "verified", factor_type: "totp" };
const UNVERIFIED_TOTP = { id: "f-started", status: "unverified", factor_type: "totp" };

const session = (claims, factors) => ({
  access_token: typeof claims === "string" ? claims : token(claims),
  user: factors === undefined ? { id: "u1" } : { id: "u1", factors },
});

describe("a session that has entered its code", () => {
  test("owes nothing, even though the account has a verified factor", () => {
    assert.equal(
      rule.sessionOwesSecondFactor(session({ sub: "u1", aal: "aal2" }, [VERIFIED_TOTP])),
      false,
    );
  });

  test("is only recognised when the claim is exactly aal2", () => {
    for (const aal of ["AAL2", "aal2 ", "aal3", 2, ["aal2"], { aal2: true }, true, null]) {
      assert.equal(
        rule.sessionOwesSecondFactor(session({ sub: "u1", aal }, [VERIFIED_TOTP])),
        true,
        `an aal claim of ${JSON.stringify(aal)} must not count as the code having been entered`,
      );
    }
  });
});

describe("a session that only gave the password", () => {
  test("owes a code when the account has a verified authenticator-app factor", () => {
    assert.equal(
      rule.sessionOwesSecondFactor(session({ sub: "u1", aal: "aal1" }, [VERIFIED_TOTP])),
      true,
    );
  });

  test("owes a code however many other factors sit beside it", () => {
    const factors = [
      UNVERIFIED_TOTP,
      { id: "f-phone", status: "verified", factor_type: "phone" },
      VERIFIED_TOTP,
    ];
    assert.equal(rule.sessionOwesSecondFactor(session({ sub: "u1", aal: "aal1" }, factors)), true);
  });

  test("owes a code when the factor does not say what kind it is (an unknown shape errs toward asking)", () => {
    assert.equal(
      rule.sessionOwesSecondFactor(
        session({ sub: "u1", aal: "aal1" }, [{ id: "f", status: "verified" }]),
      ),
      true,
    );
  });

  for (const [what, claims] of Object.entries({
    "no aal claim at all": { sub: "u1" },
    "an aal claim that is a number": { sub: "u1", aal: 2 },
    "an aal claim that is a list": { sub: "u1", aal: ["aal2"] },
  })) {
    test(`is treated as password-only when the token has ${what}`, () => {
      assert.equal(rule.sessionOwesSecondFactor(session(claims, [VERIFIED_TOTP])), true);
    });
  }

  for (const [what, access] of Object.entries({
    "an empty string": "",
    "text that is not a token": "not a token",
    "only two parts": `${b64url({ alg: "none" })}.${b64url({ aal: "aal2" })}`,
    "four parts": `a.${b64url({ aal: "aal2" })}.c.d`,
    "a payload that is not JSON": `a.${b64url("this is not json")}.c`,
    "a payload that is a list": `a.${b64url(["aal2"])}.c`,
    "a payload that is the word null": `a.${b64url("null")}.c`,
    "a payload that is not base64": "a.%%%.c",
    "nothing at all": undefined,
  })) {
    test(`is treated as password-only when the token is ${what}`, () => {
      assert.equal(
        rule.sessionOwesSecondFactor({ access_token: access, user: { factors: [VERIFIED_TOTP] } }),
        true,
      );
    });
  }
});

describe("an account that is not asked for a code", () => {
  test("has only an unverified factor: half-way through setting two-factor up", () => {
    assert.equal(
      rule.sessionOwesSecondFactor(session({ sub: "u1", aal: "aal1" }, [UNVERIFIED_TOTP])),
      false,
    );
  });

  test("has no factors", () => {
    assert.equal(rule.sessionOwesSecondFactor(session({ sub: "u1", aal: "aal1" }, [])), false);
  });

  test("has no factors listed at all", () => {
    assert.equal(rule.sessionOwesSecondFactor(session({ sub: "u1", aal: "aal1" })), false);
  });

  test("has no user on the session", () => {
    assert.equal(
      rule.sessionOwesSecondFactor({ access_token: token({ sub: "u1", aal: "aal1" }) }),
      false,
    );
    assert.equal(
      rule.sessionOwesSecondFactor({ access_token: token({ sub: "u1", aal: "aal1" }), user: null }),
      false,
    );
  });

  test("has only a verified factor of a kind this app cannot ask for", () => {
    // The page can only ask for an authenticator-app code; asking for a kind
    // it cannot would lock the person out with no way forward.
    assert.equal(
      rule.sessionOwesSecondFactor(
        session({ sub: "u1", aal: "aal1" }, [
          { id: "p", status: "verified", factor_type: "phone" },
        ]),
      ),
      false,
    );
  });

  test("has a factors field that is not a list", () => {
    for (const factors of ["verified", 7, {}, { 0: VERIFIED_TOTP }, null]) {
      assert.equal(
        rule.sessionOwesSecondFactor(session({ sub: "u1", aal: "aal1" }, factors)),
        false,
        JSON.stringify(factors),
      );
    }
  });

  test("lists entries that are not factors", () => {
    assert.equal(
      rule.sessionOwesSecondFactor(session({ sub: "u1", aal: "aal1" }, [null, 5, "x", []])),
      false,
    );
  });

  test("is nobody at all: no session", () => {
    assert.equal(rule.sessionOwesSecondFactor(null), false);
    assert.equal(rule.sessionOwesSecondFactor(undefined), false);
  });
});

describe("which factor the code form asks about", () => {
  test("is the verified authenticator-app one, not the one that was only started", () => {
    const s = session({ sub: "u1", aal: "aal1" }, [UNVERIFIED_TOTP, VERIFIED_TOTP]);
    assert.equal(rule.verifiedTotpFactorId(s), "f-verified");
  });

  test("is nothing when there is no verified authenticator-app factor", () => {
    assert.equal(
      rule.verifiedTotpFactorId(session({ sub: "u1", aal: "aal1" }, [UNVERIFIED_TOTP])),
      null,
    );
    assert.equal(rule.verifiedTotpFactorId(session({ sub: "u1", aal: "aal1" })), null);
    assert.equal(rule.verifiedTotpFactorId(null), null);
  });
});

describe("reading the assurance level from a token", () => {
  test("says aal1, aal2, or nothing", () => {
    assert.equal(rule.assuranceLevelOf(token({ aal: "aal1" })), "aal1");
    assert.equal(rule.assuranceLevelOf(token({ aal: "aal2" })), "aal2");
    assert.equal(rule.assuranceLevelOf(token({ aal: "aal9" })), null);
    assert.equal(rule.assuranceLevelOf(token({})), null);
  });

  test("never throws, whatever it is handed", () => {
    for (const value of [
      undefined,
      null,
      0,
      {},
      [],
      "",
      "a.b",
      "a.b.c",
      "a.!.c",
      () => 1,
      Symbol.iterator,
    ]) {
      assert.equal(rule.assuranceLevelOf(value), null);
    }
  });

  test("reads a payload written with the URL-safe alphabet and no padding", () => {
    // "aal" values of the right size land the encoded text on a "-" or "_".
    const claims = { aal: "aal2", note: "ÿþ??>>" };
    const encoded = b64url(claims);
    assert.match(encoded, /[-_]/, "the example must exercise the URL-safe characters");
    assert.equal(rule.assuranceLevelOf(`a.${encoded}.c`), "aal2");
  });
});

describe("the two refusal messages", () => {
  test("are told apart from each other and from an ordinary sign-in failure", () => {
    const required = new Error(rule.TWO_FACTOR_REQUIRED);
    const unchecked = new Error(rule.TWO_FACTOR_UNCHECKED);
    assert.equal(rule.isTwoFactorRequired(required), true);
    assert.equal(rule.isTwoFactorUnchecked(required), false);
    assert.equal(rule.isTwoFactorUnchecked(unchecked), true);
    assert.equal(rule.isTwoFactorRequired(unchecked), false);
    for (const other of [
      new Error("Unauthorized: Your session has expired. Please sign in again to continue."),
      new Error("something else broke"),
      "plain text",
      null,
      undefined,
      {},
      42,
    ]) {
      assert.equal(rule.isTwoFactorRequired(other), false);
      assert.equal(rule.isTwoFactorUnchecked(other), false);
    }
  });

  test("are still found when the framework wraps them or hands over a bare string", () => {
    assert.equal(rule.isTwoFactorRequired(`Error: ${rule.TWO_FACTOR_REQUIRED}`), true);
    assert.equal(rule.isTwoFactorUnchecked({ message: rule.TWO_FACTOR_UNCHECKED }), true);
  });

  test("never trip the old sign-in-again handling, and one never reads as the other", () => {
    // session-guard.ts sends anyone whose message matches this to /auth with
    // "your session has expired"; a code prompt or a retry must not.
    const signInAgain = /unauthorized|jwt|invalid token|no authorization header/i;
    assert.doesNotMatch(rule.TWO_FACTOR_REQUIRED, signInAgain);
    assert.doesNotMatch(rule.TWO_FACTOR_UNCHECKED, signInAgain);
    assert.doesNotMatch(rule.TWO_FACTOR_UNCHECKED, /two-factor code/i);
    assert.doesNotMatch(rule.TWO_FACTOR_REQUIRED, /could not check/i);
  });

  test("say nothing about whose account it is or why", () => {
    for (const text of [rule.TWO_FACTOR_REQUIRED, rule.TWO_FACTOR_UNCHECKED]) {
      assert.doesNotMatch(text, /@|[0-9a-f]{8}-[0-9a-f]{4}/i);
    }
  });
});
