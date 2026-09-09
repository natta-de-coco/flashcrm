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
  bundle: true,
  logLevel: "error",
  alias: { "@": "./src" },
});

await build({
  entryPoints: ["src/lib/connection-state.server.ts"],
  outfile: "node_modules/.cache/flas-derive-state.mjs",
  format: "esm",
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
