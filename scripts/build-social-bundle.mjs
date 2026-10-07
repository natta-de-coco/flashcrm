// Bundles the Social screen's server code so node --test can drive what
// production runs: the account sync, and the handlers that save and update a
// draft post. Same shape as the other bundle scripts.
//
// The database, the audit log and the secret store are doubles the test drives
// through globalThis.socialSuite; the provider is whatever the test installs as
// globalThis.fetch, so nothing here can reach a real platform.
//
// tests/social-hub.test.mjs imports this file to build the bundle before it
// loads it, so the suite needs no extra step in package.json.
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
mkdirSync(`${root}/node_modules/.cache`, { recursive: true });

const stubs = {
  "client.server":
    "export const supabaseAdmin = new Proxy({}, { get: (_, key) => globalThis.socialSuite.db[key] });",
  "auth-middleware": "export const requireSupabaseAuth = {};",
  // The real builder, minus the transport: the handler is called directly, and
  // the input still goes through the function's own validator first, so a value
  // the schema refuses is refused here too.
  "@tanstack/react-start": `export function createServerFn() {
    let validate = (input) => input;
    return {
      middleware() { return this; },
      inputValidator(validator) { validate = validator; return this; },
      handler(fn) { return async ({ data, context }) => fn({ data: validate(data), context }); },
    };
  }`,
  "audit.server":
    "export async function logAudit(entry) { globalThis.socialSuite.audits.push(entry); }",
  // A stored token is its own plaintext here.
  "secret-box.server":
    "export async function openSecret(value) { return value || null; } export async function sealSecret(value) { return value || null; }",
  // Neither is reached by the paths under test; stubbed so the bundle does not
  // drag the AI and OAuth stacks in behind them.
  "flash-ai.server":
    "export async function callFlashAi() { throw new Error('the AI was called by a test that should not need it'); } export async function aiOptionsFor() { return {}; } export async function getBusinessContext() { return null; }",
  "integration-health.server":
    "export async function retryConnection() { throw new Error('a token refresh was attempted by a test that should not need it'); }",
};

const boundaries = {
  name: "social-boundaries",
  setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => {
      const key = Object.keys(stubs).find((k) => args.path === k || args.path.endsWith("/" + k));
      return key ? { path: key, namespace: "social-stub" } : undefined;
    });
    b.onLoad({ filter: /.*/, namespace: "social-stub" }, (args) => ({
      contents: stubs[args.path],
      loader: "js",
    }));
  },
};

await build({
  stdin: {
    contents: [
      `export { syncSocialAccount } from './src/lib/social.server';`,
      `export { saveSocialPost, updateSocialPost } from './src/lib/social.functions';`,
    ].join("\n"),
    resolveDir: root,
  },
  absWorkingDir: root,
  outfile: "node_modules/.cache/flas-social.mjs",
  format: "esm",
  platform: "node",
  bundle: true,
  logLevel: "error",
  alias: { "@": "./src" },
  plugins: [boundaries],
});
