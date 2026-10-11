// Bundles the real sign-in code for the two-factor suites, so they run the
// TypeScript the app ships rather than a re-typed copy.
//
// What is real: src/start.ts (which middleware runs for every server function),
// the session guard, requireSupabaseAuth, the sign-in page, the signed-in
// layout, the auth provider, supabase-js and TanStack Start's own middleware
// executor. What is replaced is only what needs a deployment: the HTTP request
// of the moment, the router, and the heavy children of the layout.
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CACHE = "node_modules/.cache";

/** Replaces whole modules, matched by the end of the import path. */
function replaceModules(name, modules) {
  return {
    name,
    setup(b) {
      b.onResolve({ filter: /.*/ }, (args) => {
        const key = Object.keys(modules).find(
          (candidate) => args.path === candidate || args.path.endsWith("/" + candidate),
        );
        if (!key) return undefined;
        const target = modules[key];
        return target.file
          ? { path: new URL(target.file, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1") }
          : { path: key, namespace: name };
      });
      b.onLoad({ filter: /.*/, namespace: name }, (args) => ({
        contents: modules[args.path].contents,
        loader: "js",
        resolveDir: process.cwd(),
      }));
    },
  };
}

const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "error",
  alias: { "@": "./src" },
  // Everything from node_modules is loaded by Node itself, unbundled.
  packages: "external",
  // client.ts reads Vite's build-time values first and the process's second.
  define: { "import.meta.env": "{}" },
};

// The request a server function is answering. In a deployment this comes from
// the HTTP server; here it is the one the test put in Start's own context.
const REQUEST_OF_THE_MOMENT = `
  export function getRequest() {
    const store = globalThis[Symbol.for("tanstack-start:start-storage-context")]?.getStore();
    if (!store?.request) throw new Error("No request in this test");
    return store.request;
  }
`;

/** The rule for "does this session still owe a second factor?", on its own. It imports nothing. */
export async function buildRuleBundle() {
  mkdirSync(CACHE, { recursive: true });
  const outfile = `${CACHE}/flas-two-factor-rule.mjs`;
  await build({ ...common, entryPoints: ["src/lib/two-factor.ts"], outfile });
  return pathToFileURL(resolve(outfile)).href;
}

/** The server half: every server function's middleware, as the app registers it. */
export async function buildServerBundle() {
  mkdirSync(CACHE, { recursive: true });
  const outfile = `${CACHE}/flas-two-factor-server.mjs`;
  await build({
    ...common,
    stdin: {
      contents: `
        export { startInstance } from "./src/start";
        export { requireSupabaseAuth } from "./src/integrations/supabase/auth-middleware";
        export { createServerFn } from "@tanstack/react-start";
        export { runWithStartContext } from "@tanstack/start-storage-context";
        export { OPEN_SERVER_FUNCTIONS } from "./src/lib/two-factor.server";
      `,
      resolveDir: process.cwd(),
    },
    outfile,
    plugins: [
      replaceModules("two-factor-server", {
        "@tanstack/react-start/server": { contents: REQUEST_OF_THE_MOMENT },
      }),
    ],
  });
  return pathToFileURL(resolve(outfile)).href;
}

const nothing = (...names) =>
  names.map((name) => `export function ${name}() { return null; }`).join("\n");

/**
 * The browser half: the sign-in page and the signed-in layout, with the real
 * auth provider and supabase-js, plus the server half so a call from the
 * browser reaches the app's own server middleware.
 *
 * `window.location` is the one browser object a test cannot watch or replace
 * (jsdom forbids it), so the bundled app code is pointed at a plain object the
 * suite owns. Nothing in src/ is changed for this.
 */
export async function buildScreensBundle() {
  mkdirSync(CACHE, { recursive: true });
  const outfile = `${CACHE}/flas-two-factor-screens.mjs`;
  await build({
    ...common,
    entryPoints: ["tests/support/two-factor-harness.jsx"],
    outfile,
    jsx: "automatic",
    define: { ...common.define, "window.location": "globalThis.__flasTestLocation" },
    plugins: [
      replaceModules("two-factor-screens", {
        "@tanstack/react-router": { file: "./two-factor-router-double.jsx" },
        "@tanstack/react-start/server": { contents: REQUEST_OF_THE_MOMENT },
        // The layout's children that load a company's data. None of them
        // decides who gets in; the layout decides that before rendering them.
        "hooks/useTenant": {
          contents: `
            export function TenantProvider({ children }) { return children; }
            export function useTenant() {
              return { tenant: null, staffRole: "admin", needsOnboarding: false, loading: false, refresh: async () => {} };
            }
          `,
        },
        // Toasts have no screen here; the suite reads them from what was shown.
        sonner: {
          contents: `
            import { watched } from "./tests/support/two-factor-wire.mjs";
            const say = (kind) => (message) => {
              watched.toasts.push({ kind, message: String(message) });
              return String(message);
            };
            export const toast = Object.assign(say("message"), {
              error: say("error"),
              success: say("success"),
              info: say("info"),
              warning: say("warning"),
            });
            export function Toaster() { return null; }
          `,
        },
        "components/OnboardingModal": { contents: nothing("OnboardingModal") },
        "components/CommandPalette": { contents: nothing("CommandPalette") },
        "components/QuickCreate": { contents: nothing("QuickCreate") },
        "components/MobileBottomNav": { contents: nothing("MobileBottomNav") },
        // The layout's heartbeat, as a server function that really goes
        // through the app's client and server middleware.
        "lib/presence.functions": {
          contents: `export { touchPresence } from "./tests/support/two-factor-wire.mjs";`,
        },
      }),
    ],
  });
  return pathToFileURL(resolve(outfile)).href;
}
