import { build } from "esbuild";

// src/lib/contacts-view.ts is plain TypeScript with no imports, so this is only
// here to strip the types — node --test cannot load a .ts file. Same shape as
// the other bundle scripts so there is one way to test a lib module.
await build({
  stdin: {
    contents: `export * from './src/lib/contacts-view';`,
    resolveDir: process.cwd(),
  },
  outfile: "node_modules/.cache/flas-contacts.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  alias: { "@": "./src" },
});
