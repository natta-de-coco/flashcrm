// The Contacts, Inbox and Leads & Marketing screens each returned a "loading"
// skeleton early and called React hooks after it (fa1db0a, 8 Oct). React needs
// the same hooks in the same order on every render of a component; the render
// that finishes loading has more of them than the render that showed the
// skeleton, so React throws "Rendered more hooks than during the previous
// render" the first time the data arrives.
//
// Four things are pinned here:
//   1. the mechanism: a component with that shape does throw in this React;
//   2. the real Contacts screen, rendered through its loading and loaded states;
//   3. no component in src/ calls a hook after a conditional return, checked with
//      the same ESLint rule as the repo, independent of unrelated lint rules;
//   4. the repo's own lint config still has that rule at "error".
//
// jsdom is already installed through isomorphic-dompurify and pinned by the
// lockfile. This harness adds no dependency.
import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";

import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { ESLint } from "eslint";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const root = fileURLToPath(new URL("..", import.meta.url));

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
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const h = React.createElement;
const { act } = React;

/** Catches whatever the tree under it throws, so the test can read the message. */
class Catcher extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error) {
    this.props.onError(error);
  }
  render() {
    return this.state.failed ? h("p", null, "THE PAGE THREW") : this.props.children;
  }
}

/** React logs a thrown render to console.error; the test reads it from the Catcher instead. */
async function quietly(run) {
  const original = console.error;
  console.error = () => undefined;
  try {
    return await run();
  } finally {
    console.error = original;
  }
}

async function mount(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const rootNode = createRoot(container);
  await act(async () => {
    rootNode.render(element);
  });
  return {
    container,
    render: (next) =>
      act(async () => {
        rootNode.render(next);
      }),
    unmount: () =>
      act(async () => {
        rootNode.unmount();
      }),
  };
}

/* ── 1. the mechanism ─────────────────────────────────────────────────────── */

describe("a hook after a loading early return makes React throw when the data arrives", () => {
  // The shape of the three screens: some hooks (state, queries) first, then the
  // skeleton, then one more hook below it. The first hook matters: a component
  // that has no hooks at all on its first render is treated as new by React and
  // cannot trip this.
  function HookAfterReturn({ loading }) {
    const [prefix] = React.useState("is");
    if (loading) return h("p", null, "loading");
    const label = React.useMemo(() => prefix + " ready", [prefix]);
    return h("p", null, label);
  }
  // The shape they have to have: every hook first, the return below them.
  function HookBeforeReturn({ loading }) {
    const [prefix] = React.useState("is");
    const label = React.useMemo(() => prefix + " ready", [prefix]);
    if (loading) return h("p", null, "loading");
    return h("p", null, label);
  }

  const thrownWhenLoadingEnds = async (Component) => {
    let caught = null;
    const tree = (loading) =>
      h(Catcher, { onError: (e) => (caught = e) }, h(Component, { loading }));
    const view = await quietly(() => mount(tree(true)));
    assert.equal(view.container.textContent, "loading");
    await quietly(() => view.render(tree(false)));
    const text = view.container.textContent;
    await view.unmount();
    return { caught, text };
  };

  it("throws when the hook comes after the early return", async () => {
    const { caught } = await thrownWhenLoadingEnds(HookAfterReturn);
    assert.ok(caught, "React did not throw");
    assert.match(caught.message, /Rendered more hooks than during the previous render/);
  });

  it("does not throw when the hook comes first", async () => {
    const { caught, text } = await thrownWhenLoadingEnds(HookBeforeReturn);
    assert.equal(caught, null);
    assert.equal(text, "is ready");
  });
});

/* ── 2. the real Contacts screen ──────────────────────────────────────────── */

describe("the Contacts screen survives its first load", () => {
  let screen;
  let doubles;
  before(async () => {
    // Built by `npm run test:contacts` (scripts/build-screen-bundle.mjs).
    screen = await import("../node_modules/.cache/flas-screen-contacts.mjs");
    doubles = await import("./support/screen-doubles.mjs");
  });

  it("shows the skeleton, then the people, without throwing", async () => {
    doubles.resetData({
      contacts: [
        {
          id: "c1",
          name: "Amina Hassan",
          phone: "+971500000001",
          email: null,
          company: "Hassan Bakery",
          tags: [],
          stage: "new",
          value: 120,
          notes: null,
          owner_id: null,
          last_message_at: null,
          consent_given: true,
          consent_at: null,
          created_at: "2026-10-01T09:00:00.000Z",
        },
      ],
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    let caught = null;
    const tree = h(
      QueryClientProvider,
      { client },
      h(Catcher, { onError: (e) => (caught = e) }, h(screen.Route.component)),
    );

    const view = await quietly(() => mount(tree));
    assert.equal(view.container.textContent.includes("Amina Hassan"), false, "still loading");

    await quietly(() =>
      act(async () => {
        doubles.releaseData();
        await new Promise((resolve) => setTimeout(resolve, 60));
      }),
    );

    assert.equal(caught?.message ?? null, null, "the page threw when its data arrived");
    assert.ok(view.container.textContent.includes("Amina Hassan"), "the contact is on the page");
    await view.unmount();
    client.clear();
  });
});

/* ── 3. no component anywhere calls a hook after a conditional return ─────── */

describe("no screen calls a hook after an early return", () => {
  it("react-hooks/rules-of-hooks reports nothing in src/", async () => {
    const eslint = new ESLint({
      cwd: root,
      overrideConfigFile: true,
      overrideConfig: [
        {
          files: ["**/*.ts", "**/*.tsx"],
          languageOptions: {
            parser: tseslint.parser,
            parserOptions: { ecmaFeatures: { jsx: true } },
          },
          // An `eslint-disable` comment cannot switch this rule off.
          linterOptions: { noInlineConfig: true },
          plugins: { "react-hooks": reactHooks },
          rules: { "react-hooks/rules-of-hooks": "error" },
        },
      ],
    });
    const results = await eslint.lintFiles(["src/**/*.{ts,tsx}"]);
    const found = results.flatMap((result) =>
      result.messages
        .filter((message) => message.ruleId === "react-hooks/rules-of-hooks")
        .map(
          (message) =>
            `${result.filePath.replace(root, "").split("\\").join("/")}:${message.line} ${message.message.split(".")[0]}`,
        ),
    );
    assert.deepEqual(found, []);
  });
});

/* ── 4. the repo's lint config keeps the rule on ──────────────────────────── */
// Inline directives cannot mask the independent scan above; use ESLint's resolved
// config here instead of brittle snapshots of the config file or route source.

describe("the repo's lint setup keeps the rule on", () => {
  it("has react-hooks/rules-of-hooks at error for the three screens", async () => {
    const eslint = new ESLint({ cwd: root });
    for (const file of ["contacts", "inbox", "marketing"]) {
      const config = await eslint.calculateConfigForFile(`src/routes/_authenticated/${file}.tsx`);
      const setting = config.rules["react-hooks/rules-of-hooks"];
      const severity = Array.isArray(setting) ? setting[0] : setting;
      assert.ok(
        severity === 2 || severity === "error",
        `${file}.tsx: rules-of-hooks is ${severity}`,
      );
    }
  });
});

after(() => {
  dom.window.close();
});
