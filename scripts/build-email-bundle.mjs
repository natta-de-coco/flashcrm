// Bundles a company's email settings and the code that actually sends, so
// tests/email-providers.test.mjs can hold the two against each other: what the
// settings accept has to be something the sender can send through.
//
// The service-role database is whatever the test sets as globalThis.emailDb,
// the caller's own client is `context.supabase`, and the provider is whatever
// the test installs as globalThis.fetch. createServerFn's stand-in runs the
// input validator before the handler, because "the server refuses a provider
// the screen no longer offers" is one of the things being tested.
import { build } from "esbuild";

const stubs = {
  "client.server":
    "export const supabaseAdmin = new Proxy({}, { get: (_, key) => globalThis.emailDb[key] });",
  "auth-middleware": "export const requireSupabaseAuth = {};",
  "audit.server":
    "export async function logAudit(entry) { (globalThis.emailAudits ??= []).push(entry); }",
  "@tanstack/react-start": `export function createServerFn() {
    let validate = (input) => input;
    return {
      middleware() { return this; },
      inputValidator(fn) { validate = fn; return this; },
      handler(fn) {
        return async ({ data, context }) => fn({ data: validate(data), context });
      },
    };
  }`,
};

await build({
  stdin: {
    contents: [
      `export * from './src/lib/tenant-smtp.functions';`,
      `export * from './src/lib/email-dispatch.server';`,
    ].join("\n"),
    resolveDir: process.cwd(),
  },
  outfile: "node_modules/.cache/flas-email.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "error",
  alias: { "@": "./src" },
  plugins: [
    {
      name: "email-boundaries",
      setup(b) {
        b.onResolve({ filter: /.*/ }, (args) => {
          const key = Object.keys(stubs).find(
            (k) => args.path === k || args.path.endsWith("/" + k),
          );
          return key ? { path: key, namespace: "email-stub" } : undefined;
        });
        b.onLoad({ filter: /.*/, namespace: "email-stub" }, (args) => ({
          contents: stubs[args.path],
          loader: "js",
        }));
      },
    },
  ],
});
