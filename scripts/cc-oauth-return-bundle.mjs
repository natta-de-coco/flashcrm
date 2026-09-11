// Bundles the OAuth-return modules for tests/oauth-return.test.mjs, so the
// suite runs the TypeScript the app actually ships rather than a re-typed copy
// of its rules.
//
//   node scripts/cc-oauth-return-bundle.mjs && node --test tests/oauth-return.test.mjs
//
// connect-attempts.server.ts reaches for the Supabase admin client only through
// the default loader, and the tests always inject their own — so the client is
// stubbed with a Proxy that throws if anything touches it. A test that quietly
// started hitting the database would fail loudly instead of passing.
//
// Writes only to node_modules/.cache/cc-oauth-return-*.mjs.
import { build } from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync("node_modules/.cache", { recursive: true });

const stubSupabase = {
  name: "stub-supabase-admin",
  setup(b) {
    b.onResolve({ filter: /client\.server$/ }, () => ({
      path: "stub-supabase-admin",
      namespace: "cc-oauth-return-stub",
    }));
    b.onLoad({ filter: /.*/, namespace: "cc-oauth-return-stub" }, () => ({
      contents:
        "export const supabaseAdmin = new Proxy({}, { get() { throw new Error('supabaseAdmin touched in a pure-function test'); } });",
      loader: "js",
    }));
  },
};

const common = {
  format: "esm",
  platform: "node",
  bundle: true,
  logLevel: "error",
  alias: { "@": "./src" },
};

// The browser-safe half: the state machine, the ping codec, the redirect
// contract and the attempt_reason markers.
await build({
  ...common,
  entryPoints: ["src/lib/oauth-return.ts"],
  outfile: "node_modules/.cache/cc-oauth-return-pure.mjs",
});

// The lookup and the failure-code copy.
await build({
  ...common,
  entryPoints: ["src/lib/connect-attempts.server.ts"],
  outfile: "node_modules/.cache/cc-oauth-return-attempts.mjs",
  plugins: [stubSupabase],
});
