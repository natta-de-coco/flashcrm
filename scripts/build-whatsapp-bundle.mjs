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
      `export { processWaPayload, raiseAlert, checkNumberHealth } from './src/lib/monitoring.server';`,
      `export { checkSendPermission } from './src/lib/safety.server';`,
      `export { generateBotReply, evidenceProbe, ingestInboundMessage, newChatAutomation } from './src/lib/wa.server';`,
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

// The webhook route itself: the handshake, the signature check, and what is
// recorded when processing fails. The route shell is a double; everything the
// handlers call is the code above, over the same database double.
await build({
  entryPoints: ["src/routes/api/public/whatsapp/webhook.ts"],
  outfile: "node_modules/.cache/flas-whatsapp-webhook.mjs",
  format: "esm",
  platform: "node",
  bundle: true,
  logLevel: "error",
  alias: { "@": "./src" },
  plugins: [
    {
      name: "whatsapp-route-shell",
      setup(b) {
        b.onResolve({ filter: /^@tanstack\/react-router$/ }, () => ({
          path: "router",
          namespace: "wa-route-shell",
        }));
        b.onLoad({ filter: /.*/, namespace: "wa-route-shell" }, () => ({
          contents: "export const createFileRoute = () => (options) => ({ options });",
          loader: "js",
        }));
      },
    },
    boundaries,
  ],
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
