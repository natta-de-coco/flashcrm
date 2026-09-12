// Bundles the Connection Center UI-kit components (and the pure
// asset-picker logic) for tests/connection-ui-kit.test.mjs, so the suite
// renders the exact TypeScript/JSX the page agent will compose rather than
// a re-typed copy.
//
// Run with: node scripts/cc-ui-kit-bundle.mjs
//
// react/react-dom stay external: the test supplies its own via
// react-dom/server, and inlining a second copy would double up React's
// module registry (two React instances => broken context, mismatched
// hooks). Everything else -- Radix primitives, lucide-react, clsx,
// tailwind-merge, class-variance-authority -- is bundled in, same as
// scripts/build-state-bundle.mjs does for the rest of the app's pure logic.
//
// Writes only to node_modules/.cache/cc-ui-kit-*.mjs -- node_modules is a
// junction shared with other agents' worktrees, so this script never
// touches any other path under it.
import { build } from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync("node_modules/.cache", { recursive: true });

// Built in-memory (esbuild `stdin`) rather than as a source file under
// src/ -- nothing in the app itself needs a barrel that re-exports all
// five components at once, only this test bundle does.
const entry = `
  export { AssetPicker } from "./src/components/integrations/AssetPicker";
  export * from "./src/lib/asset-picker";
  export { ConnectionProblemCard } from "./src/components/integrations/ConnectionProblemCard";
  export { ConnectionSuccess } from "./src/components/integrations/ConnectionSuccess";
  export { CapabilityList } from "./src/components/integrations/CapabilityList";
  export { ReadinessBadge } from "./src/components/integrations/ReadinessBadge";
  // Re-exported so the test suite can check ReadinessBadge against the real
  // shared copy instead of a hand-duplicated set of expected strings.
  export { READINESS_LABELS } from "./src/lib/connection-problem";
`;

await build({
  stdin: {
    contents: entry,
    resolveDir: process.cwd(),
    loader: "ts",
    sourcefile: "cc-ui-kit-entry.ts",
  },
  outfile: "node_modules/.cache/cc-ui-kit-components.mjs",
  format: "esm",
  platform: "node",
  bundle: true,
  jsx: "automatic",
  logLevel: "error",
  alias: { "@": "./src" },
  // Several deps (lucide-react in particular) ship both an ESM and a CJS
  // build. Left to its defaults esbuild can pick the CJS one here, whose
  // `require("react")` it can only convert to a *runtime* require -- which
  // does not exist in real ESM output and throws the moment the module
  // loads. Preferring the ESM build sidesteps that entirely: react/react-dom
  // end up as ordinary static imports, which esbuild's ESM output handles
  // natively.
  mainFields: ["module", "main"],
  conditions: ["import", "module"],
  external: ["react", "react-dom", "react-dom/server"],
});

console.log("Built node_modules/.cache/cc-ui-kit-components.mjs");
