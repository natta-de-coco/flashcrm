// Bundles the integration-health code the way the app runs it, with the four things outside the
// code under test replaced by doubles the test drives through globalThis.healthTest:
//   * the Supabase service client  -> healthTest.db     (tests/support/db-double.mjs)
//   * the audit log                -> healthTest.audits
//   * the token refresh call       -> healthTest.refresh (counts calls, can rotate tokens)
//   * the secret box               -> a reversible "sealed:" prefix, so a stored token is visibly
//                                     not plaintext
// Provider HTTP is never stubbed here: the code under test calls the global fetch, and the test
// replaces globalThis.fetch with a recorder. Nothing in these bundles can reach a real platform.
import { build } from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync("node_modules/.cache", { recursive: true });

const stubs = {
  "client.server":
    "export const supabaseAdmin = new Proxy({}, { get: (_, key) => globalThis.healthTest.db[key] });",
  "audit.server":
    "export async function logAudit(entry) { globalThis.healthTest.audits.push(entry); }",
  "secret-box.server": `
    const PREFIX = "sealed:";
    export const isSealed = (v) => typeof v === "string" && v.startsWith(PREFIX);
    export async function openSecret(value) {
      if (globalThis.healthTest.openFails) throw new Error("A stored credential could not be decrypted.");
      if (value === null || value === undefined || value === "") return null;
      return isSealed(value) ? value.slice(PREFIX.length) : value;
    }
    export async function sealSecret(plain) {
      if (plain === null || plain === undefined || plain === "") return null;
      return isSealed(plain) ? plain : PREFIX + plain;
    }
    export async function sealTenantSecrets() {
      return { configured: true, plaintext: 0, alreadySealed: 0, sealedNow: 0 };
    }
    export async function encryptionConfigured() { return true; }`,
  "oauth.server": `
    export async function refreshAccessToken(args) {
      return globalThis.healthTest.refresh(args);
    }
    export function resolveAllowedOrigin() { return null; }
    export async function resolveCredentials() { return { id: null, secret: null }; }`,
  "flash-ai.server":
    "export async function callFlashAi() { return ''; } export function aiOptionsFor() { return {}; } export async function getBusinessContext() { return ''; }",
  "auth-middleware": "export const requireSupabaseAuth = {};",
  "@tanstack/react-start": `export function createServerFn() {
      return { middleware() { return this; }, inputValidator() { return this; }, handler(fn) { return fn; } };
    }`,
};

const boundaries = {
  name: "health-boundaries",
  setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => {
      const key = Object.keys(stubs).find((k) => args.path === k || args.path.endsWith("/" + k));
      return key ? { path: key, namespace: "health-stub" } : undefined;
    });
    b.onLoad({ filter: /.*/, namespace: "health-stub" }, (args) => ({
      contents: stubs[args.path],
      loader: "js",
    }));
  },
};

const bundle = (entry, out) =>
  build({
    entryPoints: [entry],
    outfile: `node_modules/.cache/${out}`,
    format: "esm",
    platform: "node",
    bundle: true,
    logLevel: "error",
    alias: { "@": "./src" },
    plugins: [boundaries],
  });

// The server functions the Connect accounts screen and the health dialog call.
await bundle("src/lib/connections.functions.ts", "flas-health-functions.mjs");
// The Social Hub server functions; connectSocialAccount is the one that saves a pasted token.
await bundle("src/lib/social.functions.ts", "flas-health-social-functions.mjs");
// The engine itself (retryConnection / retryDueConnections / buildHealthReport).
await bundle("src/lib/integration-health.server.ts", "flas-health-engine.mjs");
// The reconnect write (saveAuthorizedConnection), which must clear stale evidence.
await bundle("src/lib/connections.server.ts", "flas-health-connections-server.mjs");
// The channel picker's connect write (connectDiscoveredChannels), which must not stamp a verification.
await bundle("src/lib/social-authorizations.server.ts", "flas-health-authorizations.mjs");
// How a channel's token is stored encrypted on the account itself (the tests store one the real way).
await bundle("src/lib/social-token-store.server.ts", "flas-health-token-store.mjs");
// Where a channel's own token is found when access_token is empty (read on its own by the tests).
await bundle("src/lib/connection-tokens.server.ts", "flas-health-tokens.mjs");
// The browser-safe model: counts, outcome summary, CSV.
await bundle("src/lib/integration-health.ts", "flas-health-model.mjs");
// The words: which sentence each status and outcome is, and the messages of all five languages.
await bundle("src/lib/integration-health-text.ts", "flas-health-text.mjs");
await build({
  stdin: {
    contents: [
      "export { MESSAGES } from './src/lib/i18n/messages';",
      "export { TRANSLATED_LANGUAGES } from './src/lib/i18n/define';",
    ].join("\n"),
    resolveDir: process.cwd(),
  },
  outfile: "node_modules/.cache/flas-health-i18n.mjs",
  format: "esm",
  platform: "node",
  bundle: true,
  logLevel: "error",
  alias: { "@": "./src" },
});
