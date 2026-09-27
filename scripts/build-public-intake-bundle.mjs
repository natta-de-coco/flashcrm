// Bundles the code that runs for requests nobody signed in for: the WhatsApp
// send gate, the lead intake pipeline, and the website-plugin activation
// endpoint. The database, the audit log and the email provider are doubles the
// test drives through globalThis.publicIntake; everything between them is the
// code production runs.
import { build } from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync("node_modules/.cache", { recursive: true });

const stubs = {
  "@tanstack/react-router": "export const createFileRoute = () => (options) => ({ options });",
  "client.server":
    "export const supabaseAdmin = new Proxy({}, { get: (_, key) => globalThis.publicIntake.db[key] });",
  "audit.server":
    "export async function logAudit(entry) { globalThis.publicIntake.audits.push(entry); }",
  "email-dispatch.server": `export async function sendTenantEmail(tenantId, message) {
      globalThis.publicIntake.emails.push({ tenantId, ...message });
      return globalThis.publicIntake.emailResult;
    }`,
  "secret-box.server": "export async function openSecret() { return null; }",
};

const boundaries = {
  name: "public-intake-boundaries",
  setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => {
      const key = Object.keys(stubs).find((k) => args.path === k || args.path.endsWith("/" + k));
      return key ? { path: key, namespace: "intake-stub" } : undefined;
    });
    b.onLoad({ filter: /.*/, namespace: "intake-stub" }, (args) => ({
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

await bundle("src/lib/safety.server.ts", "flas-safety.mjs");
await bundle("src/lib/leads.server.ts", "flas-leads.mjs");
await bundle("src/lib/plugin-activation.server.ts", "flas-plugin-activation.mjs");
await bundle("src/routes/api/public/plugin/activate.ts", "flas-plugin-activate-route.mjs");
await bundle("src/lib/public-limits.server.ts", "flas-public-limits.mjs");
await bundle("src/lib/api-keys.server.ts", "flas-api-keys.mjs");
await bundle("src/routes/api/public/widget/chat.ts", "flas-widget-chat.mjs");
await bundle("src/routes/api/public/leads/collect.ts", "flas-leads-collect.mjs");
await bundle("src/routes/api/public/webhooks/wordpress.ts", "flas-webhook-wordpress.mjs");
await bundle("src/routes/api/public/webhooks/shopify.ts", "flas-webhook-shopify.mjs");
