import { build } from "esbuild";

// The translation layer and the navigation it labels, as one module node --test
// can load. Same shape as the other bundle scripts.
await build({
  stdin: {
    contents: [
      `export * from './src/lib/i18n/index';`,
      `export { MESSAGES, SCREEN_LIST } from './src/lib/i18n/messages';`,
      `export { TRANSLATED_LANGUAGES } from './src/lib/i18n/define';`,
      `export { NAV_SECTIONS, MANAGER_SECTION } from './src/lib/navigation';`,
    ].join("\n"),
    resolveDir: process.cwd(),
  },
  outfile: "node_modules/.cache/flas-i18n.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  alias: { "@": "./src" },
  // Icons render nothing in a test; there is no reason to bundle React for them.
  external: ["lucide-react"],
});
