// Bundles the code that runs for requests nobody signed in for: the WhatsApp
// send gate, the lead intake pipeline, the website-plugin activation endpoint,
// and the unsubscribe link every marketing email carries. The database, the
// audit log and the email provider are doubles the test drives through
// globalThis.publicIntake; everything between them is the code production runs.
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
  "lead-alerts.server.ts": `export async function dispatchSalesLeadAlert(alert) {
      globalThis.publicIntake.alerts.push(alert);
    }`,
  // A stored token is its own plaintext here, so a connected number has one.
  "secret-box.server": "export async function openSecret(value) { return value || null; }",
};

const boundariesFor = (table) => ({
  name: "public-intake-boundaries",
  setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => {
      const key = Object.keys(table).find((k) => args.path === k || args.path.endsWith("/" + k));
      return key ? { path: key, namespace: "intake-stub" } : undefined;
    });
    b.onLoad({ filter: /.*/, namespace: "intake-stub" }, (args) => ({
      contents: table[args.path],
      loader: "js",
    }));
  },
});

const bundle = (entry, out, table = stubs) =>
  build({
    entryPoints: [entry],
    outfile: `node_modules/.cache/${out}`,
    format: "esm",
    platform: "node",
    bundle: true,
    logLevel: "error",
    alias: { "@": "./src" },
    plugins: [boundariesFor(table)],
  });

// The campaign send functions are server functions behind the sign-in check. The test calls
// the handler directly with a signed-in user, so the wrapper and the check are stand-ins.
const campaignStubs = {
  ...stubs,
  "auth-middleware": "export const requireSupabaseAuth = {};",
  "@tanstack/react-start": `export function createServerFn() {
      return { middleware() { return this; }, inputValidator() { return this; }, handler(fn) { return fn; } };
    }`,
};

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
await bundle("src/lib/unsubscribe.server.ts", "flas-unsubscribe.mjs");
await bundle("src/lib/lead-automation.server.ts", "flas-lead-automation.mjs");
await bundle("src/lib/drip-automation.server.ts", "flas-drip-automation.mjs");
await bundle("src/lib/email-templates.ts", "flas-email-templates.mjs");
await bundle("src/lib/marketing.functions.ts", "flas-marketing.mjs", campaignStubs);
