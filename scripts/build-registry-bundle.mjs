// Bundles the TypeScript capability registry so the test suite can import the
// same module the app does, rather than a re-typed copy that could drift.
// esbuild already ships with vite, so this adds no dependency.
import { build } from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync("node_modules/.cache", { recursive: true });
await build({
  entryPoints: ["src/lib/social-connector-definitions.ts"],
  outfile: "node_modules/.cache/flas-registry.mjs",
  format: "esm",
  bundle: false,
  logLevel: "error",
});
