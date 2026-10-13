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

// The contact card's server functions, for tests/contact-card.test.mjs. A test
// calls one as `fn({ data, context })` with its own database as
// `context.supabase`. Unlike the other bundles' stand-in for createServerFn,
// this one runs the input validator first: what a function refuses to accept
// is part of what those tests are about.
const stubs = {
  "auth-middleware": "export const requireSupabaseAuth = {};",
  "audit.server": "export async function logAudit() {}",
  "@tanstack/react-start": `export function createServerFn() {
    let validate = (input) => input;
    return {
      middleware() { return this; },
      inputValidator(fn) { validate = fn; return this; },
      handler(fn) {
        return async ({ data, context }) => fn({ data: validate(data), context });
      },
    };
  }`,
};

await build({
  stdin: {
    contents: `export * from './src/lib/contact-identities.functions';`,
    resolveDir: process.cwd(),
  },
  outfile: "node_modules/.cache/flas-contact-functions.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "error",
  alias: { "@": "./src" },
  plugins: [
    {
      name: "contact-function-boundaries",
      setup(b) {
        b.onResolve({ filter: /.*/ }, (args) => {
          const key = Object.keys(stubs).find(
            (k) => args.path === k || args.path.endsWith("/" + k),
          );
          return key ? { path: key, namespace: "contact-stub" } : undefined;
        });
        b.onLoad({ filter: /.*/, namespace: "contact-stub" }, (args) => ({
          contents: stubs[args.path],
          loader: "js",
        }));
      },
    },
  ],
});
