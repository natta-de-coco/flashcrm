// Bundles the Connection Center readiness engine for the test suite, so the
// tests exercise the same TypeScript the app imports rather than a re-typed
// copy. Modelled on scripts/build-state-bundle.mjs.
//
// Everything goes into ONE bundle from a synthetic entry point, because the
// Supabase admin client is stubbed per bundle: readiness, the credential test,
// the OAuth helpers and secret-box all have to share the same stub instance for
// a test to be able to install a fake database.
//
// Writes only to node_modules/.cache/cc-readiness-*.mjs.
import { build } from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync("node_modules/.cache", { recursive: true });

// The service-role client, replaced by whatever the test installs. Touching it
// before a test installs one is a bug in the test, not a silent empty result.
const stubSupabase = {
  name: "stub-supabase-admin",
  setup(b) {
    b.onResolve({ filter: /client\.server$/ }, () => ({
      path: "stub-supabase-admin",
      namespace: "stub",
    }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: `
        let current = null;
        export function __setSupabaseAdmin(fake) { current = fake; }
        export function __resetSupabaseAdmin() { current = null; }
        export const supabaseAdmin = new Proxy({}, {
          get(_target, prop) {
            if (!current) {
              throw new Error("supabaseAdmin was used before __setSupabaseAdmin() in a test");
            }
            const value = Reflect.get(current, prop);
            return typeof value === "function" ? value.bind(current) : value;
          },
        });
      `,
      loader: "js",
    }));
  },
};

const entry = `
export * from "@/lib/connection-readiness.server";
export { testProviderCredentials } from "@/lib/provider-credential-test.server";
export {
  configuredAllowedOrigins,
  oauthRedirectUri,
  providerEnvNames,
  PROVIDERS,
  resolveAllowedOrigin,
  resolveCredentials,
  startAuthorization,
} from "@/lib/oauth.server";
export {
  encryptionConfigured,
  isSealed,
  openSecret,
  sealSecret,
} from "@/lib/secret-box.server";
export { forAudience, maskId } from "@/lib/connection-problem";
export { __setSupabaseAdmin, __resetSupabaseAdmin } from "@/integrations/supabase/client.server";
`;

await build({
  stdin: { contents: entry, resolveDir: ".", sourcefile: "cc-readiness-entry.ts", loader: "ts" },
  outfile: "node_modules/.cache/cc-readiness-engine.mjs",
  format: "esm",
  platform: "node",
  bundle: true,
  logLevel: "error",
  alias: { "@": "./src" },
  plugins: [stubSupabase],
});
