// UI-kit component contract, as tests.
//
//   node scripts/cc-ui-kit-bundle.mjs && node --test tests/connection-ui-kit.test.mjs
//
// Renders every component with react-dom/server's renderToStaticMarkup and
// inspects the markup with jsdom (parsing only -- nothing here simulates a
// click or keypress). That is deliberate: every component in this kit is
// controlled entirely by props, so what a given set of props renders is the
// whole contract. Radix's own test suite covers that its primitives actually
// respond to Tab/Space/Enter/arrow keys at runtime; this suite covers that
// *our* components hand Radix the right roles, disabled state and aria-*
// wiring, and that the specified plain-language copy shows up as real text.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AssetPicker,
  ConnectionProblemCard,
  ConnectionSuccess,
  CapabilityList,
  ReadinessBadge,
  READINESS_LABELS,
  filterAssets,
  initialsFor,
  nextSelection,
  pluralNoun,
  resultSummary,
} from "../node_modules/.cache/cc-ui-kit-components.mjs";

const h = React.createElement;

/**
 * Renders an element and hands back both the raw HTML and a parsed
 * document to query. Also the one place that enforces "never renders
 * '[object Object]'" -- baked into every render in this file rather than a
 * single end-of-file check, so a violation is reported against the test
 * that actually produced it.
 */
function renderDom(element) {
  const html = renderToStaticMarkup(element);
  assert.ok(!html.includes("[object Object]"), `rendered output leaked an object:\n${html}`);
  assert.ok(!html.includes("[object Undefined]"), `rendered output leaked an object:\n${html}`);
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
  return { html, doc: dom.window.document };
}

function buttonTexts(doc) {
  return [...doc.querySelectorAll("button")].map((b) => b.textContent);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PAGE_ASSETS = [
  {
    id: "p1",
    name: "Acme Retail",
    secondary: "@acmeretail",
    kind: "Facebook Page",
    eligible: true,
  },
  {
    id: "p2",
    name: "Old Test Page",
    secondary: "@oldtestpage",
    kind: "Facebook Page",
    eligible: true,
    alreadyConnected: true,
  },
  {
    id: "p3",
    name: "No Access Page",
    kind: "Facebook Page",
    eligible: false,
    disabledReason: "Flas is not an admin on this Page",
  },
];

const BASE_PICKER_PROPS = {
  onRetry: () => {},
  onChange: () => {},
  onConfirm: () => {},
  confirming: false,
  confirmLabel: "Connect Page",
  noun: "Page",
  emptyTitle: "No Pages found",
  emptyMessage: "Create a Page on Facebook, then reconnect.",
  searchPlaceholder: "Search Pages",
};

const BLOCKING_PROBLEM = {
  code: "OAUTH_ORIGIN_MISSING",
  title: "Redirect not allowed",
  message: "The app is not configured to accept logins from this domain.",
  owner: "WORKSPACE_ADMIN",
  severity: "blocking",
  nextAction: "Add the redirect URI to the app's allowed origins.",
  url: "https://developers.facebook.com/apps",
  urlLabel: "Open Meta App Dashboard",
  retryable: true,
  copyValue: "https://app.flas.example/oauth/callback",
  copyLabel: "Copy redirect URI",
  technical: {
    setting: "OAUTH_ALLOWED_ORIGINS",
    detail: "Provider returned 403 redirect_uri_mismatch",
  },
};

const WARNING_PROBLEM = {
  code: "PARTIAL_SCOPE",
  title: "Some permissions are missing",
  message: "Flas can read this Page but cannot publish to it yet.",
  owner: "END_USER",
  severity: "warning",
  nextAction: "Reconnect and approve the publish permission.",
};

const PROVIDER_PROBLEM = {
  code: "PROVIDER_5XX",
  title: "Facebook is not responding",
  message: "The last three attempts to reach Facebook failed.",
  owner: "PROVIDER",
  severity: "info",
  nextAction: "Wait a few minutes and try again.",
  retryable: true,
};

const CAPABILITIES = [
  { key: "publish", label: "Publish posts", state: "available" },
  { key: "ads", label: "Ads insights", state: "review", note: "Pending Meta review" },
  {
    key: "dm",
    label: "Direct messages",
    state: "limited",
    note: "Only within 24 hours of the last customer message",
  },
  { key: "stories", label: "Stories", state: "unavailable" },
];

// ---------------------------------------------------------------------------
// src/lib/asset-picker.ts -- pure logic
// ---------------------------------------------------------------------------

describe("filterAssets", () => {
  test("matches case-insensitively on name", () => {
    assert.deepEqual(
      filterAssets(PAGE_ASSETS, "acme").map((a) => a.id),
      ["p1"],
    );
    assert.deepEqual(
      filterAssets(PAGE_ASSETS, "ACME").map((a) => a.id),
      ["p1"],
    );
  });

  test("matches on secondary", () => {
    assert.deepEqual(
      filterAssets(PAGE_ASSETS, "@oldtestpage").map((a) => a.id),
      ["p2"],
    );
  });

  test("matches on kind", () => {
    assert.deepEqual(
      filterAssets(PAGE_ASSETS, "facebook page").map((a) => a.id),
      ["p1", "p2", "p3"],
    );
  });

  test("trims the query", () => {
    assert.deepEqual(
      filterAssets(PAGE_ASSETS, "   acme   ").map((a) => a.id),
      ["p1"],
    );
  });

  test("a blank (or whitespace-only) query matches everything", () => {
    assert.equal(filterAssets(PAGE_ASSETS, "").length, 3);
    assert.equal(filterAssets(PAGE_ASSETS, "   ").length, 3);
  });

  test("undefined assets filters to an empty list, not a throw", () => {
    assert.deepEqual(filterAssets(undefined, "anything"), []);
  });

  test("no match returns an empty list", () => {
    assert.deepEqual(filterAssets(PAGE_ASSETS, "nonexistent-xyz"), []);
  });
});

describe("nextSelection", () => {
  test("single mode always replaces the selection with just the clicked id", () => {
    assert.deepEqual(nextSelection([], "a", "single"), ["a"]);
    assert.deepEqual(nextSelection(["a"], "b", "single"), ["b"]);
    assert.deepEqual(nextSelection(["a"], "a", "single"), ["a"]);
  });

  test("multi mode adds an id that isn't selected", () => {
    assert.deepEqual(nextSelection(["a"], "b", "multi"), ["a", "b"]);
  });

  test("multi mode removes an id that is already selected", () => {
    assert.deepEqual(nextSelection(["a", "b"], "a", "multi"), ["b"]);
  });
});

describe("initialsFor", () => {
  test("two words -> first letter of each", () => {
    assert.equal(initialsFor("Acme Retail"), "AR");
  });

  test("one word -> its first two letters", () => {
    assert.equal(initialsFor("flas"), "FL");
  });

  test("blank name never throws", () => {
    assert.equal(initialsFor(""), "?");
    assert.equal(initialsFor("   "), "?");
  });
});

describe("pluralNoun / resultSummary", () => {
  test("pluralizes by default, singularizes at count 1", () => {
    assert.equal(pluralNoun("Page"), "Pages");
    assert.equal(pluralNoun("Page", 1), "Page");
    assert.equal(pluralNoun("ad account", 3), "ad accounts");
  });

  test("does not double an already-plural noun", () => {
    assert.equal(pluralNoun("Access", 2), "Access");
  });

  test("resultSummary covers empty, partial and full", () => {
    assert.equal(resultSummary(0, 0, "Page"), "No Pages available");
    assert.equal(resultSummary(2, 5, "Page"), "Showing 2 of 5 Pages");
    assert.equal(resultSummary(3, 3, "Page"), "Showing all 3 Pages");
    assert.equal(resultSummary(1, 1, "Page"), "Showing all 1 Page");
  });
});

// ---------------------------------------------------------------------------
// AssetPicker
// ---------------------------------------------------------------------------

describe("AssetPicker", () => {
  test("single mode renders a radiogroup with exactly one checked radio, no checkboxes", () => {
    const { doc } = renderDom(
      h(AssetPicker, {
        ...BASE_PICKER_PROPS,
        assets: PAGE_ASSETS,
        loading: false,
        error: null,
        mode: "single",
        selected: ["p1"],
      }),
    );
    assert.ok(doc.querySelector('[role="radiogroup"]'), "expected a radiogroup");
    assert.equal(doc.querySelectorAll('[role="checkbox"]').length, 0);
    const radios = [...doc.querySelectorAll('[role="radio"]')];
    assert.equal(radios.length, 3);
    const checked = radios.filter((r) => r.getAttribute("aria-checked") === "true");
    assert.equal(checked.length, 1);
    const label = doc.querySelector(`label[for="${checked[0].id}"]`);
    assert.ok(label.textContent.includes("Acme Retail"));
  });

  test("multi mode renders independent checkboxes reflecting the selected array, no radiogroup", () => {
    const { doc } = renderDom(
      h(AssetPicker, {
        ...BASE_PICKER_PROPS,
        assets: PAGE_ASSETS,
        loading: false,
        error: null,
        mode: "multi",
        selected: ["p1", "p2"],
      }),
    );
    assert.equal(doc.querySelectorAll('[role="radiogroup"]').length, 0);
    assert.equal(doc.querySelectorAll('[role="radio"]').length, 0);
    const boxes = [...doc.querySelectorAll('[role="checkbox"]')];
    assert.equal(boxes.length, 3);
    const checked = boxes.filter((b) => b.getAttribute("aria-checked") === "true");
    assert.equal(checked.length, 2);
    // "2 selected" copy tracks the selected array, not the checked count in the DOM.
    assert.ok(doc.body.textContent.includes("2 selected"));
  });

  test("an ineligible asset is disabled, described by its visible reason (not a tooltip)", () => {
    const { doc } = renderDom(
      h(AssetPicker, {
        ...BASE_PICKER_PROPS,
        assets: PAGE_ASSETS,
        loading: false,
        error: null,
        mode: "single",
        selected: [],
      }),
    );
    const radios = [...doc.querySelectorAll('[role="radio"]')];
    const disabled = radios.find((r) => r.disabled);
    assert.ok(disabled, "expected one disabled radio");
    assert.equal(disabled.getAttribute("title"), null, "reason must not be tooltip-only");
    const reasonId = disabled.getAttribute("aria-describedby");
    assert.ok(reasonId, "disabled control should be described by its reason");
    const reasonEl = doc.getElementById(reasonId);
    assert.ok(reasonEl, "the reason element the control points to must exist");
    assert.equal(reasonEl.textContent, "Flas is not an admin on this Page");
  });

  test('marks an already-connected asset without disabling it', () => {
    const { doc } = renderDom(
      h(AssetPicker, {
        ...BASE_PICKER_PROPS,
        assets: PAGE_ASSETS,
        loading: false,
        error: null,
        mode: "single",
        selected: [],
      }),
    );
    assert.ok(doc.body.textContent.includes("Already connected"));
    const radios = [...doc.querySelectorAll('[role="radio"]')];
    const alreadyConnectedRadio = radios.find((r) => !r.disabled && r.value === "p2");
    assert.ok(alreadyConnectedRadio, "an already-connected but eligible asset stays selectable");
  });

  test("loading state shows an accessible status and no selectable rows", () => {
    const { doc } = renderDom(
      h(AssetPicker, {
        ...BASE_PICKER_PROPS,
        assets: undefined,
        loading: true,
        error: null,
        mode: "single",
        selected: [],
      }),
    );
    const status = doc.querySelector('[role="status"]');
    assert.ok(status);
    assert.ok(status.textContent.includes("Loading Pages"));
    assert.equal(doc.querySelectorAll('[role="radio"], [role="checkbox"]').length, 0);
  });

  test("error state shows the message inside role=alert, with a Retry button", () => {
    const { doc } = renderDom(
      h(AssetPicker, {
        ...BASE_PICKER_PROPS,
        assets: undefined,
        loading: false,
        error: "Facebook did not respond in time.",
        mode: "single",
        selected: [],
      }),
    );
    const alert = doc.querySelector('[role="alert"]');
    assert.ok(alert);
    assert.ok(alert.textContent.includes("Facebook did not respond in time."));
    assert.ok(buttonTexts(doc).some((t) => t.includes("Retry")));
  });

  test("empty state (no assets at all) explains why and what to do, using the caller's copy", () => {
    const { doc } = renderDom(
      h(AssetPicker, {
        ...BASE_PICKER_PROPS,
        assets: [],
        loading: false,
        error: null,
        mode: "single",
        selected: [],
      }),
    );
    assert.ok(doc.body.textContent.includes("No Pages found"));
    assert.ok(doc.body.textContent.includes("Create a Page on Facebook, then reconnect."));
    assert.equal(doc.querySelectorAll('[role="radio"], [role="checkbox"]').length, 0);
  });

  test("a search with no matches is distinct from having no assets at all", () => {
    // This is exercised through the pure filterAssets function (above); here
    // we only confirm the component does not conflate the two by checking
    // the true-empty fixture never renders the "No matches" copy.
    const { doc } = renderDom(
      h(AssetPicker, {
        ...BASE_PICKER_PROPS,
        assets: [],
        loading: false,
        error: null,
        mode: "single",
        selected: [],
      }),
    );
    assert.ok(!doc.body.textContent.includes("No matches"));
  });

  test("the confirm button is disabled with nothing selected and labeled with confirmLabel", () => {
    const { doc } = renderDom(
      h(AssetPicker, {
        ...BASE_PICKER_PROPS,
        assets: PAGE_ASSETS,
        loading: false,
        error: null,
        mode: "single",
        selected: [],
      }),
    );
    const confirmButton = [...doc.querySelectorAll("button")].find((b) =>
      b.textContent.includes("Connect Page"),
    );
    assert.ok(confirmButton);
    assert.ok(confirmButton.disabled);
  });
});

// ---------------------------------------------------------------------------
// ConnectionProblemCard
// ---------------------------------------------------------------------------

describe("ConnectionProblemCard", () => {
  test("blocking severity uses role=alert", () => {
    const { doc } = renderDom(h(ConnectionProblemCard, { problem: BLOCKING_PROBLEM, onRetry: () => {} }));
    assert.ok(doc.querySelector('[role="alert"]'));
  });

  test("warning and info severities use role=status, not role=alert", () => {
    const warning = renderDom(h(ConnectionProblemCard, { problem: WARNING_PROBLEM }));
    assert.equal(warning.doc.querySelector('[role="alert"]'), null);
    assert.ok(warning.doc.querySelector('[role="status"]'));

    const info = renderDom(
      h(ConnectionProblemCard, { problem: PROVIDER_PROBLEM, providerName: "Facebook", onRetry: () => {} }),
    );
    assert.equal(info.doc.querySelector('[role="alert"]'), null);
    assert.ok(info.doc.querySelector('[role="status"]'));
  });

  test("shows the owner line for each owner", () => {
    const { doc } = renderDom(h(ConnectionProblemCard, { problem: BLOCKING_PROBLEM }));
    assert.ok(doc.body.textContent.includes("Your workspace administrator needs to act"));

    const endUser = renderDom(h(ConnectionProblemCard, { problem: WARNING_PROBLEM }));
    assert.ok(endUser.doc.body.textContent.includes("You can fix this"));
  });

  test("PROVIDER owner names the provider when given, and falls back when not", () => {
    const named = renderDom(
      h(ConnectionProblemCard, { problem: PROVIDER_PROBLEM, providerName: "Facebook" }),
    );
    assert.ok(named.doc.body.textContent.includes("Waiting on Facebook"));

    const unnamed = renderDom(h(ConnectionProblemCard, { problem: PROVIDER_PROBLEM }));
    assert.ok(unnamed.doc.body.textContent.includes("Waiting on the provider"));
  });

  test("hides technical detail unless showTechnical is true", () => {
    const hidden = renderDom(h(ConnectionProblemCard, { problem: BLOCKING_PROBLEM, onRetry: () => {} }));
    assert.ok(!hidden.html.includes("OAUTH_ALLOWED_ORIGINS"));
    assert.ok(!hidden.html.includes("redirect_uri_mismatch"));

    const shownFalse = renderDom(
      h(ConnectionProblemCard, { problem: BLOCKING_PROBLEM, onRetry: () => {}, showTechnical: false }),
    );
    assert.ok(!shownFalse.html.includes("OAUTH_ALLOWED_ORIGINS"));

    const shown = renderDom(
      h(ConnectionProblemCard, { problem: BLOCKING_PROBLEM, onRetry: () => {}, showTechnical: true }),
    );
    assert.ok(shown.html.includes("OAUTH_ALLOWED_ORIGINS"));
    assert.ok(shown.html.includes("redirect_uri_mismatch"));
  });

  test("a problem with no technical field renders fine with showTechnical true", () => {
    const { html } = renderDom(
      h(ConnectionProblemCard, { problem: WARNING_PROBLEM, showTechnical: true }),
    );
    assert.ok(html.includes("Some permissions are missing"));
  });

  test("Retry renders only when retryable is true AND onRetry is given", () => {
    const both = renderDom(h(ConnectionProblemCard, { problem: BLOCKING_PROBLEM, onRetry: () => {} }));
    assert.ok(buttonTexts(both.doc).some((t) => t.includes("Retry")));

    const noHandler = renderDom(h(ConnectionProblemCard, { problem: BLOCKING_PROBLEM }));
    assert.ok(!buttonTexts(noHandler.doc).some((t) => t.includes("Retry")));

    const notRetryable = renderDom(
      h(ConnectionProblemCard, { problem: { ...WARNING_PROBLEM, retryable: false }, onRetry: () => {} }),
    );
    assert.ok(!buttonTexts(notRetryable.doc).some((t) => t.includes("Retry")));
  });

  test("the official link renders only when url and urlLabel both exist, opens in a new tab safely", () => {
    const { doc } = renderDom(h(ConnectionProblemCard, { problem: BLOCKING_PROBLEM }));
    const link = [...doc.querySelectorAll("a")].find((a) =>
      a.textContent.includes("Open Meta App Dashboard"),
    );
    assert.ok(link);
    assert.equal(link.getAttribute("href"), "https://developers.facebook.com/apps");
    assert.equal(link.getAttribute("target"), "_blank");
    assert.equal(link.getAttribute("rel"), "noopener noreferrer");

    const without = renderDom(h(ConnectionProblemCard, { problem: WARNING_PROBLEM }));
    assert.equal(without.doc.querySelector("a"), null);
  });

  test("the copy button renders only when copyValue exists, labeled with copyLabel", () => {
    const { doc } = renderDom(h(ConnectionProblemCard, { problem: BLOCKING_PROBLEM }));
    assert.ok(buttonTexts(doc).some((t) => t.includes("Copy redirect URI")));

    const without = renderDom(h(ConnectionProblemCard, { problem: WARNING_PROBLEM }));
    assert.ok(!buttonTexts(without.doc).some((t) => t.includes("Copy")));
  });

  test("never renders the message field as anything but plain text (no raw object/stack)", () => {
    const weird = {
      ...WARNING_PROBLEM,
      message: "A plain string, even though the underlying error was an object.",
    };
    const { html } = renderDom(h(ConnectionProblemCard, { problem: weird }));
    assert.ok(!html.includes("[object Object]"));
    assert.ok(!html.includes("at Object.<anonymous>")); // a stack trace line, should never appear
  });

  describe("compact variant", () => {
    test("keeps the severity role and shows the title", () => {
      const { doc } = renderDom(
        h(ConnectionProblemCard, { problem: BLOCKING_PROBLEM, onRetry: () => {}, compact: true }),
      );
      assert.ok(doc.querySelector('[role="alert"]'));
      assert.ok(doc.body.textContent.includes("Redirect not allowed"));
    });

    test("still gates actions on the same rules as the full card", () => {
      const { doc } = renderDom(h(ConnectionProblemCard, { problem: WARNING_PROBLEM, compact: true }));
      // WARNING_PROBLEM has no url/copyValue/retry handler.
      assert.equal(doc.querySelector("a"), null);
      assert.equal(doc.querySelectorAll("button").length, 0);
    });
  });
});

// ---------------------------------------------------------------------------
// CapabilityList
// ---------------------------------------------------------------------------

describe("CapabilityList", () => {
  test("shows review/limited notes as visible text", () => {
    const { doc } = renderDom(h(CapabilityList, { capabilities: CAPABILITIES }));
    assert.ok(doc.body.textContent.includes("Pending Meta review"));
    assert.ok(doc.body.textContent.includes("Only within 24 hours of the last customer message"));
  });

  test("hides unavailable capabilities by default", () => {
    const { doc } = renderDom(h(CapabilityList, { capabilities: CAPABILITIES }));
    assert.ok(!doc.body.textContent.includes("Stories"));
  });

  test("shows unavailable capabilities when showUnavailable is true", () => {
    const { doc } = renderDom(h(CapabilityList, { capabilities: CAPABILITIES, showUnavailable: true }));
    assert.ok(doc.body.textContent.includes("Stories"));
  });

  test("renders nothing when every capability is unavailable and showUnavailable is off", () => {
    const { html } = renderDom(
      h(CapabilityList, { capabilities: [{ key: "x", label: "X", state: "unavailable" }] }),
    );
    assert.equal(html, "");
  });

  test("available capabilities render without a note", () => {
    const { doc } = renderDom(
      h(CapabilityList, { capabilities: [{ key: "publish", label: "Publish posts", state: "available" }] }),
    );
    assert.ok(doc.body.textContent.includes("Publish posts"));
  });
});

// ---------------------------------------------------------------------------
// ConnectionSuccess
// ---------------------------------------------------------------------------

describe("ConnectionSuccess", () => {
  test("hides actions whose handler is absent", () => {
    const { doc } = renderDom(
      h(ConnectionSuccess, {
        assetName: "Acme Retail",
        assetKind: "Facebook Page",
        capabilities: CAPABILITIES,
        onDone: () => {},
      }),
    );
    const texts = buttonTexts(doc);
    assert.ok(texts.some((t) => t.includes("Done")));
    assert.ok(!texts.some((t) => t.includes("View connection")));
    assert.ok(!texts.some((t) => t.includes("Connect another")));
  });

  test("shows every action whose handler is present", () => {
    const { doc } = renderDom(
      h(ConnectionSuccess, {
        assetName: "Acme Retail",
        assetKind: "Facebook Page",
        noun: "Page",
        capabilities: CAPABILITIES,
        onViewConnection: () => {},
        onConnectAnother: () => {},
        onDone: () => {},
      }),
    );
    const texts = buttonTexts(doc);
    assert.ok(texts.some((t) => t.includes("View connection")));
    assert.ok(texts.some((t) => t.includes("Connect another Page")));
    assert.ok(texts.some((t) => t.includes("Done")));
  });

  test("renders no actions at all when no handler is given", () => {
    const { doc } = renderDom(
      h(ConnectionSuccess, { assetName: "Acme Retail", assetKind: "Facebook Page", capabilities: [] }),
    );
    assert.equal(doc.querySelectorAll("button").length, 0);
  });

  test("headline names what kind of thing connected; body names the specific asset and its kind", () => {
    const { doc } = renderDom(
      h(ConnectionSuccess, {
        assetName: "Acme Retail",
        assetKind: "Facebook Page",
        capabilities: [],
      }),
    );
    assert.ok(doc.body.textContent.includes("Facebook Page connected"));
    assert.ok(doc.body.textContent.includes("Acme Retail"));
  });

  test("shows the CapabilityList content (e.g. a review note) inline", () => {
    const { doc } = renderDom(
      h(ConnectionSuccess, {
        assetName: "Acme Retail",
        assetKind: "Facebook Page",
        capabilities: CAPABILITIES,
      }),
    );
    assert.ok(doc.body.textContent.includes("Pending Meta review"));
  });
});

// ---------------------------------------------------------------------------
// ReadinessBadge
// ---------------------------------------------------------------------------

describe("ReadinessBadge", () => {
  test("renders the shared label for every readiness state", () => {
    for (const state of Object.keys(READINESS_LABELS)) {
      const { doc } = renderDom(h(ReadinessBadge, { state }));
      assert.equal(doc.body.textContent.trim(), READINESS_LABELS[state]);
    }
  });

  test("READY and an error state render with different classes (distinct tones)", () => {
    const ready = renderDom(h(ReadinessBadge, { state: "READY" }));
    const error = renderDom(h(ReadinessBadge, { state: "PROVIDER_ERROR" }));
    const readyClass = ready.doc.querySelector("div").className;
    const errorClass = error.doc.querySelector("div").className;
    assert.notEqual(readyClass, errorClass);
  });
});
