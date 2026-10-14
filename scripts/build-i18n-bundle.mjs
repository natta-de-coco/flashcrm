import { build } from "esbuild";

// The translation layer and the navigation it labels, as one module node --test
// can load, plus the role rules that decide who sees each entry. Same shape as the
// other bundle scripts.
await build({
  stdin: {
    contents: [
      `export * from './src/lib/i18n/index';`,
      `export { MESSAGES, SCREEN_LIST } from './src/lib/i18n/messages';`,
      `export { TRANSLATED_LANGUAGES } from './src/lib/i18n/define';`,
      `export * from './src/lib/navigation';`,
      `export * from './src/lib/permissions';`,
      `export * from './src/lib/record-search';`,
      `export * from './src/lib/nav-access';`,
      `export * from './src/lib/social-tabs';`,
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

// The real useNavAccess hook, with the signed-in person (hooks/useTenant) swapped
// for a double the test sets. The test renders it for each role and checks that
// every list it hands back belongs to THAT role -- the thing a source search for
// "paletteFor(" cannot tell. React stays outside the bundle so the test and the
// hook share one copy.
await build({
  entryPoints: ["src/hooks/useNavAccess.ts"],
  outfile: "node_modules/.cache/flas-nav-access-hook.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  alias: { "@": "./src" },
  external: ["lucide-react", "react"],
  plugins: [
    {
      name: "tenant-double",
      setup(b) {
        b.onResolve({ filter: /^@\/hooks\/useTenant$/ }, () => ({
          path: `${process.cwd()}/tests/support/tenant-double.mjs`,
        }));
      },
    },
  ],
});
