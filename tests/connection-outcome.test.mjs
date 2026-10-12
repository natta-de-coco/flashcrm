// What a person sees when they come back from a provider's sign-in.
//
// Pressing Cancel on Facebook's consent screen used to land on a red
// "Connection failed -- ask a FLAS administrator", and an expired link read the
// same. These tests run the real outcome screen and the real copy rules.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

import { i18nModules } from "./support/i18n-double.mjs";

function load(relative, modules = {}) {
  const source = readFileSync(new URL(relative, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  runInNewContext(compiled, {
    exports,
    require: (name) => modules[name] ?? new Proxy({}, { get: (_, key) => String(key) }),
  });
  return exports;
}

const outcome = load("../src/lib/oauth-outcome.ts");
const CONNECTORS = [
  { id: "facebook", name: "Facebook" },
  { id: "instagram", name: "Instagram" },
];
const screen = load("../src/components/integrations/ConnectionOutcome.tsx", {
  "react/jsx-runtime": {
    jsx: (type, props) => ({ type, props }),
    jsxs: (type, props) => ({ type, props }),
  },
  "@/lib/oauth-outcome": outcome,
  "@/lib/connections-catalog": { CONNECTORS },
  // The screen is read in English, from the real message files.
  ...i18nModules,
});

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (tree === null || tree === undefined || typeof tree === "boolean") return "";
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  if (Array.isArray(tree)) return tree.map(text).join("");
  return text(tree.props?.children);
}
function render(search, onRetry) {
  return screen.ConnectionOutcome({
    search,
    accounts: [],
    onChanged() {},
    onDismiss() {},
    onRetry,
  });
}

describe("recognising a cancelled sign-in", () => {
  it("treats each provider's cancel answer as a cancel", () => {
    assert.equal(outcome.isUserCancellation("access_denied", "user_denied"), true); // Meta
    assert.equal(outcome.isUserCancellation("access_denied"), true); // Google, TikTok, X
    assert.equal(outcome.isUserCancellation("user_cancelled_login"), true); // LinkedIn
    assert.equal(outcome.isUserCancellation("user_cancelled_authorize"), true); // LinkedIn
  });

  it("does not treat a real provider error as a cancel", () => {
    assert.equal(outcome.isUserCancellation("invalid_scope"), false);
    assert.equal(outcome.isUserCancellation("server_error"), false);
    assert.equal(outcome.isUserCancellation(null), false);
  });
});

describe("the screen after a cancel", () => {
  it("is calm, says nothing changed, and offers to try again", () => {
    const retried = [];
    const tree = render({ connect_cancelled: "facebook" }, (p) => retried.push(p));
    const alert = nodes(tree).find((n) => n.type === "Alert");
    assert.notEqual(alert.props.variant, "destructive");
    assert.match(text(tree), /Sign-in to Facebook was cancelled/);
    assert.match(text(tree), /nothing was connected or changed/);
    assert.doesNotMatch(text(tree), /administrator/);
    const again = nodes(tree).find((n) => n.type === "Button" && text(n) === "Try again");
    again.props.onClick();
    assert.deepEqual(retried, ["facebook"]);
  });

  it("never shows a platform name taken from a crafted link", () => {
    const tree = render({ connect_cancelled: "<b>Pay here</b>" }, () => {});
    assert.match(text(tree), /Sign-in to the provider was cancelled/);
    assert.doesNotMatch(text(tree), /Pay here/);
    assert.equal(
      nodes(tree).some((n) => n.type === "Button" && text(n) === "Try again"),
      false,
    );
  });
});

describe("the screen after a failed sign-in", () => {
  it("says an expired link expired, in fixed words", () => {
    const tree = render({ connect_error: "Visit evil.example", connect_code: "expired" });
    assert.match(text(tree), /The sign-in link expired/);
    assert.doesNotMatch(text(tree), /evil\.example/);
  });

  it("names the provider that refused, only when it is a known connector", () => {
    const known = render({
      connect_error: "x",
      connect_code: "provider_refused",
      connect_platform: "instagram",
    });
    assert.match(text(known), /Instagram did not finish the sign-in/);
    const unknown = render({
      connect_error: "x",
      connect_code: "provider_refused",
      connect_platform: "Trust me",
    });
    assert.match(text(unknown), /the provider did not finish the sign-in/);
    assert.doesNotMatch(text(unknown), /Trust me/);
  });

  it("falls back to the general message for anything unrecognised", () => {
    assert.match(text(render({ connect_error: "x" })), /Connection failed/);
  });
});

describe("the page keeps the new outcome details", () => {
  it("parses cancel and failure codes from the address", () => {
    const parsed = screen.parseConnectionOutcomeSearch({
      connect_cancelled: "facebook",
      connect_code: "expired",
      connect_platform: "facebook",
      unrelated: "dropped",
    });
    // The object comes from the sandbox realm; copy it before comparing.
    assert.deepEqual(
      { ...parsed },
      {
        connect_cancelled: "facebook",
        connect_code: "expired",
        connect_platform: "facebook",
      },
    );
  });
});

describe("the OAuth callback reports what happened", () => {
  const source = readFileSync(
    new URL("../src/routes/api/public/oauth-callback.ts", import.meta.url),
    "utf8",
  );

  it("sends a cancel back as a cancel, not an error", () => {
    assert.match(source, /isUserCancellation\(providerError/);
    assert.match(source, /connect_cancelled: row\.platform/);
  });

  it("marks expired and incomplete sign-ins with their code", () => {
    assert.match(source, /connect_code: "expired"/);
    assert.match(source, /connect_code: "incomplete"/);
  });
});
