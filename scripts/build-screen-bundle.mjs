import { build } from "esbuild";
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Bundles a real route screen, so a test can render it. Everything under src/
// is the real code except the modules named in STUBBED, which are replaced by
// tests/support/screen-doubles.mjs (the data client, the router, the tenant
// and translation hooks). Every package stays external, so the test and the
// screen share one copy of React.
//
//   node scripts/build-screen-bundle.mjs <route file under src/> <out file name>
//   node scripts/build-screen-bundle.mjs routes/_authenticated/contacts.tsx flas-screen-contacts.mjs
const [entry, outName] = process.argv.slice(2);
if (!entry || !outName) {
  console.error("usage: node scripts/build-screen-bundle.mjs <file under src/> <out name>");
  process.exit(1);
}

const root = process.cwd();
const doubles = resolve(root, "tests/support/screen-doubles.mjs");
const STUBBED = new Set([
  "@/integrations/supabase/client",
  "@/hooks/useTenant",
  "@/hooks/useI18n",
  "@/lib/audit.functions",
  "@/components/contacts/ContactDetailDialog",
  "@tanstack/react-router",
  "@tanstack/react-start",
]);
const EXTENSIONS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

const screenPlugin = {
  name: "screen-doubles",
  setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => {
      // External, by file URL, so the test imports the very same module the
      // screen does and can open the gate on its data.
      if (STUBBED.has(args.path)) return { path: pathToFileURL(doubles).href, external: true };
      if (args.path.startsWith("@/")) {
        const base = resolve(root, "src", args.path.slice(2));
        const found = EXTENSIONS.map((ext) => base + ext).find(
          (candidate) =>
            existsSync(candidate) && !candidate.endsWith("/src") && /\.\w+$/.test(candidate),
        );
        if (!found) return { errors: [{ text: `cannot resolve ${args.path}` }] };
        return { path: found };
      }
      // A relative import is part of the screen; a bare one is a package.
      if (args.kind === "entry-point" || args.path.startsWith(".") || isAbsolute(args.path))
        return undefined;
      return { path: args.path, external: true };
    });
  },
};

await build({
  entryPoints: [resolve(root, "src", entry)],
  outfile: `node_modules/.cache/${outName}`,
  bundle: true,
  platform: "node",
  format: "esm",
  jsx: "automatic",
  plugins: [screenPlugin],
  logLevel: "warning",
});
