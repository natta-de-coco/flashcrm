import { build } from "esbuild";
import { mkdirSync } from "node:fs";

// Bundles the real payments webhook route. The route shell, the signature
// check and the database are replaced by doubles the test controls; the event
// handling in between is the code that runs in production.
mkdirSync("node_modules/.cache", { recursive: true });

const stubs = {
  "@tanstack/react-router": "export const createFileRoute = () => (options) => ({ options });",
  "paddle.server": `export const EventName = {
      SubscriptionCreated: "subscription.created",
      SubscriptionUpdated: "subscription.updated",
      SubscriptionCanceled: "subscription.canceled",
      TransactionPaymentFailed: "transaction.payment_failed",
    };
    export async function verifyWebhook(request, env) {
      return globalThis.paymentsWebhook.verify(request, env);
    }`,
  "client.server":
    "export const supabaseAdmin = new Proxy({}, { get: (_, key) => globalThis.paymentsWebhook.db[key] });",
  "audit.server": "export async function logAudit() {}",
  "monitoring.server":
    "export async function raiseAlert(alert) { globalThis.paymentsWebhook.alerts.push(alert); return true; }",
};

await build({
  entryPoints: ["src/routes/api/public/payments/webhook.ts"],
  outfile: "node_modules/.cache/flas-payments-webhook.mjs",
  format: "esm",
  platform: "node",
  bundle: true,
  logLevel: "error",
  alias: { "@": "./src" },
  plugins: [
    {
      name: "payments-boundaries",
      setup(b) {
        b.onResolve({ filter: /.*/ }, (args) => {
          const key = Object.keys(stubs).find(
            (k) => args.path === k || args.path.endsWith("/" + k),
          );
          return key ? { path: key, namespace: "payments-stub" } : undefined;
        });
        b.onLoad({ filter: /.*/, namespace: "payments-stub" }, (args) => ({
          contents: stubs[args.path],
          loader: "js",
        }));
      },
    },
  ],
});
