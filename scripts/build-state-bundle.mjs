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

// Batch 1 / Phase 6: token encryption. No imports, so no stubs needed.
await build({
  entryPoints: ["src/lib/social-secrets.server.ts"],
  outfile: "node_modules/.cache/flas-secrets.mjs",
  format: "esm",
  platform: "node",
  bundle: true,
  logLevel: "error",
});
