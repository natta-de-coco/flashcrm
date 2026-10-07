// Bundles the WhatsApp send and receive paths so node --test can drive the
// code production runs: the send pipeline, the safety gate, and the webhook
// processor. The database, the audit log and the secret store are doubles the
// test drives through globalThis.waSuite; the provider is whatever the test
// installs as globalThis.fetch.
import { build } from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync("node_modules/.cache", { recursive: true });

const stubs = {
  "client.server":
    "export const supabaseAdmin = new Proxy({}, { get: (_, key) => globalThis.waSuite.db[key] });",
  "audit.server":
    "export async function logAudit(entry) { globalThis.waSuite.audits.push(entry); }",
  // A stored token is its own plaintext here; an empty one is a number that
  // has lost its connection.
  "secret-box.server": "export async function openSecret(value) { return value || null; }",
};

const boundaries = {
  name: "whatsapp-boundaries",
  setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => {
      const key = Object.keys(stubs).find((k) => args.path === k || args.path.endsWith("/" + k));
      return key ? { path: key, namespace: "wa-stub" } : undefined;
    });
    b.onLoad({ filter: /.*/, namespace: "wa-stub" }, (args) => ({
      contents: stubs[args.path],
      loader: "js",
    }));
  },
};

await build({
  stdin: {
    contents: [
      `export * from './src/lib/wa-delivery';`,
      `export { sendConversationMessage, sendTemplate, describeSendContext } from './src/lib/wa-send.server';`,
      `export { processWaPayload } from './src/lib/monitoring.server';`,
      `export { checkSendPermission } from './src/lib/safety.server';`,
      `export { generateBotReply, evidenceProbe } from './src/lib/wa.server';`,
      `export * from './src/lib/billing-whatsapp.server';`,
      `export * from './src/lib/send-reference';`,
    ].join("\n"),
    resolveDir: process.cwd(),
  },
  outfile: "node_modules/.cache/flas-whatsapp.mjs",
  format: "esm",
  platform: "node",
  bundle: true,
  logLevel: "error",
  alias: { "@": "./src" },
  plugins: [boundaries],
});

// Where a customer's link may point. On its own, with only the database
// stubbed: the rule reads configuration, and nothing else here needs OAuth.
await build({
  entryPoints: ["src/lib/customer-link.server.ts"],
  outfile: "node_modules/.cache/flas-customer-link.mjs",
  format: "esm",
  platform: "node",
  bundle: true,
  logLevel: "error",
  alias: { "@": "./src" },
  plugins: [
    {
      name: "no-database",
      setup(b) {
        b.onResolve({ filter: /client\.server$/ }, () => ({ path: "db", namespace: "none" }));
        b.onLoad({ filter: /.*/, namespace: "none" }, () => ({
          contents:
            "export const supabaseAdmin = new Proxy({}, { get() { throw new Error('the database was touched by a pure rule'); } });",
          loader: "js",
        }));
      },
    },
  ],
});
