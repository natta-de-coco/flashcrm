import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Execute the actual screen's event handlers with hook/network boundaries
// replaced. No provider credentials or browser session are used by this test.
const source = readFileSync(
  new URL("../src/components/integrations-v2/IntegrationsAuditFixed.tsx", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function loadLib(relative) {
  const libSource = readFileSync(new URL(relative, import.meta.url), "utf8");
  const libCompiled = ts.transpileModule(libSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const libExports = {};
  runInNewContext(libCompiled, { exports: libExports, require: () => ({}) });
  return libExports;
}

const credentialHandoff = loadLib("../src/lib/credential-handoff.ts");

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}

function harness({
  status = "ADMIN_SETUP_REQUIRED",
  result = { ready: true, url: "https://provider.example/login" },
  connectors,
  blockers = [],
  accounts = [],
} = {}) {
  const state = [],
    requests = [],
    redirects = [],
    pending = [],
    mutations = [];
  let cursor = 0,
    mutationCursor = 0;
  const connector = {
    id: "instagram",
    name: "Instagram",
    provider: "meta",
    oauth: true,
    group: "social",
  };
  const catalog = connectors ?? [connector];
  const rows = catalog.map((c) => ({ ...c, status, checks: {}, credentials: {}, blockers }));
  const start = async (request) => {
    requests.push(request);
    return result;
  };
  const modules = {
    "react/jsx-runtime": {
      jsx: (type, props) => ({ type, props }),
      jsxs: (type, props) => ({ type, props }),
    },
    react: {
      useEffect() {},
      useMemo: (fn) => fn(),
      useRef(initial) {
        const index = cursor++;
        return (state[index] ??= { current: initial });
      },
      useState(initial) {
        const index = cursor++;
        if (!(index in state)) state[index] = initial;
        return [
          state[index],
          (value) => {
            state[index] = typeof value === "function" ? value(state[index]) : value;
          },
        ];
      },
    },
    "@tanstack/react-query": {
      useQueryClient: () => ({ invalidateQueries: async () => {} }),
      useQuery: ({ queryKey }) => ({
        data: queryKey[0] === "connections" ? { accounts } : { rows },
      }),
      useMutation(options) {
        const index = mutationCursor++;
        const mutation = (mutations[index] ??= { isPending: false });
        mutation.mutate = (value) => {
          mutation.isPending = true;
          pending.push(
            Promise.resolve()
              .then(() => options.mutationFn(value))
              .then(
                (response) => options.onSuccess?.(response, value),
                (error) => options.onError?.(error, value),
              )
              .finally(() => {
                mutation.isPending = false;
              }),
          );
        };
        return mutation;
      },
    },
    "@tanstack/react-start": { useServerFn: (fn) => fn },
    "@/hooks/useAuth": { useAuth: () => ({ isAdmin: true }) },
    "@/lib/connections-catalog": { CONNECTORS: catalog },
    "@/lib/credential-handoff": credentialHandoff,
    "@/lib/connections.functions": { startConnect: start },
    "@/lib/connection-setup": {
      credentialSpec: () => ({ scope: "provider", fields: [] }),
      OAUTH_REDIRECT_PATH: "/api/public/oauth-callback",
    },
    "@/lib/provider-setup-links": { providerSetup: () => null },
  };
  const exports = {};
  runInNewContext(compiled, {
    exports,
    require: (name) => modules[name] ?? new Proxy({}, { get: (_, key) => String(key) }),
    window: { location: { origin: "https://flas.example", assign: (url) => redirects.push(url) } },
  });
  const render = () => {
    cursor = 0;
    mutationCursor = 0;
    return exports.IntegrationsAuditFixed({});
  };
  const find = (tree, name) => nodes(tree).find((node) => (node.type?.name ?? node.type) === name);
  return { render, find, requests, redirects, flush: () => Promise.all(pending) };
}

test("saving an Instagram app continues its OAuth flow even when cached readiness is blocked", async () => {
  const h = harness();
  h.find(h.render(), "ProviderReadiness").props.onConfigure("instagram");
  const credentials = h.find(h.render(), "CredentialsStep");
  assert.equal(credentials.props.continueLabel, "Save and continue with Facebook");
  credentials.props.onSaved();
  await h.flush();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].data.platform, "instagram");
  assert.deepEqual(h.redirects, ["https://provider.example/login"]);
  assert.equal(h.find(h.render(), "CredentialsStep"), undefined);
});

test("an already configured app has a direct sign-in action in diagnostics", async () => {
  const h = harness({ status: "LIMITED" });
  const diagnostics = h.find(h.render(), "ProviderReadiness");
  const card = h.find(diagnostics.type(diagnostics.props), "ReadinessCard");
  const button = nodes(card.type(card.props)).find(
    (n) => n.type === "Button" && n.props.children === "Continue with Facebook",
  );
  assert.ok(button);
  button.props.onClick();
  await h.flush();
  assert.equal(h.requests[0].data.platform, "instagram");
});

test("failed server readiness never redirects or pretends the saved app is connected", async () => {
  const h = harness({ result: { ready: false } });
  h.find(h.render(), "ProviderReadiness").props.onConfigure("instagram");
  h.find(h.render(), "CredentialsStep").props.onSaved();
  await h.flush();
  assert.deepEqual(h.redirects, []);
  const screen = h.render();
  assert.match(h.find(screen, "Problem").props.message, /administrator setup/);
  assert.equal(
    nodes(screen).find((n) => n.type?.name === "StatCard" && n.props.label === "Connected").props
      .value,
    0,
  );
});

test("a second sign-in click while the first is pending does not create another attempt", async () => {
  const h = harness({ status: "READY" });
  const diagnostics = h.find(h.render(), "ProviderReadiness");
  diagnostics.props.onConnect("instagram");
  diagnostics.props.onConnect("instagram");
  await h.flush();
  assert.equal(h.requests.length, 1);
});

const FACEBOOK = {
  id: "facebook",
  name: "Facebook",
  provider: "meta",
  oauth: true,
  group: "social",
};
const INSTAGRAM = {
  id: "instagram",
  name: "Instagram",
  provider: "meta",
  oauth: true,
  group: "social",
};
const YOUTUBE = {
  id: "youtube",
  name: "YouTube",
  provider: "google",
  oauth: true,
  group: "social",
};

test("sign-in continues with the product the admin chose, not the row they typed keys into", async () => {
  // One Meta app serves both, so an admin who set out to connect Instagram may
  // well save the app from the Facebook row. Connecting Facebook instead would
  // be the wrong product.
  const h = harness({ connectors: [FACEBOOK, INSTAGRAM] });
  const card = nodes(h.render()).find(
    (n) => n.type?.name === "MarketplaceCard" && n.props.connector.id === "instagram",
  );
  card.props.onConnect();
  h.find(h.render(), "ProviderReadiness").props.onConfigure("facebook");
  h.find(h.render(), "CredentialsStep").props.onSaved();
  await h.flush();
  assert.equal(h.requests[0].data.platform, "instagram");
});

test("configuring a provider on its own connects that provider", async () => {
  const h = harness({ connectors: [FACEBOOK, INSTAGRAM] });
  h.find(h.render(), "ProviderReadiness").props.onConfigure("facebook");
  h.find(h.render(), "CredentialsStep").props.onSaved();
  await h.flush();
  assert.equal(h.requests[0].data.platform, "facebook");
});

test("a choice from another provider never redirects the saved app's sign-in", async () => {
  const h = harness({ connectors: [FACEBOOK, YOUTUBE] });
  const card = nodes(h.render()).find(
    (n) => n.type?.name === "MarketplaceCard" && n.props.connector.id === "youtube",
  );
  card.props.onConnect();
  h.find(h.render(), "ProviderReadiness").props.onConfigure("facebook");
  h.find(h.render(), "CredentialsStep").props.onSaved();
  await h.flush();
  assert.equal(h.requests[0].data.platform, "facebook");
});

test("a refused start tells the admin every actionable blocker, worst first", async () => {
  const h = harness({
    result: { ready: false },
    blockers: [
      { code: "NOTE", title: "note", userMessage: "", severity: "INFO", owner: "PROVIDER" },
      {
        code: "REVIEW",
        title: "Meta review pending",
        userMessage: "Some features wait for approval.",
        severity: "WARNING",
        owner: "PROVIDER",
      },
      {
        code: "STORAGE",
        title: "OAuth database schema is missing",
        userMessage: "Run the pending database migrations.",
        severity: "BLOCKING",
        owner: "FLAS_ADMIN",
        technical: "integration_oauth_storage_ready",
      },
    ],
  });
  h.find(h.render(), "ProviderReadiness").props.onConfigure("instagram");
  h.find(h.render(), "CredentialsStep").props.onSaved();
  await h.flush();
  const problem = h.find(h.render(), "Problem");
  assert.deepEqual(
    problem.props.blockers.map((b) => b.code),
    ["STORAGE", "REVIEW"],
  );
  assert.deepEqual(h.redirects, []);
});

test("an unfinished Page choice can be resumed after a reload", () => {
  // Sign-in finished but no Page was chosen yet (the row has no external id).
  // After a reload the screen must offer to finish, for exactly that account.
  const h = harness({
    status: "READY",
    accounts: [
      {
        id: "pending-1",
        platform: "instagram",
        active: true,
        external_id: null,
        connect_method: "oauth",
      },
    ],
  });
  const isChoose = (n) =>
    n.type === "Button" &&
    Array.isArray(n.props.children) &&
    n.props.children.join("") === "Choose Instagram";
  const choose = nodes(h.render()).find(isChoose);
  assert.ok(choose, "the unfinished connection is offered");
  choose.props.onClick();
  const screen = h.render();
  const outcome = nodes(screen).find((n) => n.type === "ConnectionOutcome");
  assert.equal(outcome.props.search.select_target, "pending-1");
  assert.equal(outcome.props.search.connected, "instagram");
  assert.equal(nodes(screen).some(isChoose), false);
});

test("a pending connection is never counted as connected", () => {
  const h = harness({
    status: "READY",
    accounts: [
      {
        id: "pending-1",
        platform: "instagram",
        active: true,
        external_id: null,
        connect_method: "oauth",
      },
    ],
  });
  const connected = nodes(h.render()).find(
    (n) => n.type?.name === "StatCard" && n.props.label === "Connected",
  );
  assert.equal(connected.props.value, 0);
});
