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

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}

function harness({
  status = "ADMIN_SETUP_REQUIRED",
  result = { ready: true, url: "https://provider.example/login" },
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
  const row = { ...connector, status, checks: {}, credentials: {}, blockers: [] };
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
        data: queryKey[0] === "connections" ? { accounts: [] } : { rows: [row] },
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
    "@/lib/connections-catalog": { CONNECTORS: [connector] },
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
