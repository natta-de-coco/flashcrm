// Bundles the connection-state modules for the test suite, so the tests
// exercise the same TypeScript the app imports rather than a re-typed copy.
// deriveConnectionState lives in the .server module, which pulls in the
// Supabase admin client — so it is bundled with that dependency stubbed,
// because the function itself is pure and needs no database.
import { build } from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync("node_modules/.cache", { recursive: true });

await build({
  entryPoints: ["src/lib/connection-state.ts"],
  outfile: "node_modules/.cache/flas-connection-state.mjs",
  format: "esm",
  platform: "node",
  bundle: true,
  logLevel: "error",
  alias: { "@": "./src" },
});

const stubSupabase = {
  name: "stub-supabase-admin",
  setup(b) {
    b.onResolve({ filter: /client\.server$/ }, () => ({
      path: "stub-supabase-admin",
      namespace: "stub",
    }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents:
        "export const supabaseAdmin = new Proxy({}, { get() { throw new Error('supabaseAdmin touched in a pure-function test'); } });",
      loader: "js",
    }));
  },
};

// Task 4: the redirect allowlist, state hashing and redaction helpers.
await build({
  entryPoints: ["src/lib/oauth.server.ts"],
  outfile: "node_modules/.cache/flas-oauth.mjs",
  format: "esm",
  platform: "node",
  bundle: true,
  logLevel: "error",
  alias: { "@": "./src" },
  plugins: [stubSupabase],
});

await build({
  entryPoints: ["src/lib/integration-errors.server.ts"],
  outfile: "node_modules/.cache/flas-redact.mjs",
  format: "esm",
  platform: "node",
  bundle: true,
  logLevel: "error",
  alias: { "@": "./src" },
  plugins: [stubSupabase],
});

await build({
  entryPoints: ["src/lib/connection-state.server.ts"],
  outfile: "node_modules/.cache/flas-derive-state.mjs",
  format: "esm",
  platform: "node",
  bundle: true,
  logLevel: "error",
  alias: { "@": "./src" },
  plugins: [
    {
      name: "stub-supabase-admin",
      setup(b) {
        // The admin client reads environment variables at import time. Nothing
        // under test touches it, so it is replaced with a proxy that throws if
        // anything ever does — a silent stub would hide a real dependency.
        b.onResolve({ filter: /client\.server$/ }, () => ({
          path: "stub-supabase-admin",
          namespace: "stub",
        }));
        b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
          contents:
            "export const supabaseAdmin = new Proxy({}, { get() { throw new Error('supabaseAdmin touched in a pure-function test'); } });",
          loader: "js",
        }));
      },
    },
  ],
});

// QA pass: the tenant-timezone date helper and the single navigation source
// that global search is built from. Both are pure and dependency-free.
await build({
  entryPoints: ["src/lib/locale.ts"],
  outfile: "node_modules/.cache/flas-locale.mjs",
  format: "esm",
  platform: "node",
  bundle: true,
  logLevel: "error",
  alias: { "@": "./src" },
});

await build({
  entryPoints: ["src/lib/navigation.ts"],
  outfile: "node_modules/.cache/flas-navigation.mjs",
  format: "esm",
  platform: "node",
  bundle: true,
  logLevel: "error",
  alias: { "@": "./src" },
});

// The manual social-connect input schema. A live QA pass found the endpoint
// accepted an empty access token even after the form was fixed, so the schema
// itself is asserted here.
await build({
  entryPoints: ["src/lib/social-schema.ts"],
  outfile: "node_modules/.cache/flas-social-schema.mjs",
  format: "esm",
  platform: "node",
  bundle: true,
  logLevel: "error",
  alias: { "@": "./src" },
});

// The form validators. Extracted from the route files so the rules that decide
// whether bad input can be saved are asserted directly rather than by clicking.
await build({
  entryPoints: ["src/lib/form-validation.ts"],
  outfile: "node_modules/.cache/flas-form-validation.mjs",
  format: "esm",
  platform: "node",
  bundle: true,
  logLevel: "error",
  alias: { "@": "./src" },
});

// The manager portal's subscription rules: dates, access and what a save does.
await build({
  entryPoints: ["src/lib/subscription-admin.ts"],
  outfile: "node_modules/.cache/flas-subscription-admin.mjs",
  format: "esm",
  platform: "node",
  bundle: true,
  logLevel: "error",
  alias: { "@": "./src" },
});
