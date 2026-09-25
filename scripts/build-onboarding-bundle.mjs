import { build } from "esbuild";

// Exercise the actual server handlers with a database double. Live RLS and
// provider consent still require the separate staging acceptance checklist.
await build({
  stdin: {
    contents: `export * from './src/lib/wa.server';
      export * from './src/lib/monitoring.server';
      export * from './src/lib/website-knowledge';
      export * from './src/lib/website-knowledge.server';
      export * from './src/lib/secret-box.server';
      export * from './src/lib/oauth-preflight.server';
      export * from './src/lib/oauth.server';
      export * from './src/lib/integration-readiness.functions';
      export * from './src/lib/social-doctor.functions';
      export * from './src/lib/connections.server';
      export * from './src/lib/wa-numbers.functions';
      export * from './src/lib/flash-ai.server';
      export * from './src/lib/contact-resolve.server';
      export * from './src/lib/meta-health.functions';`,
    resolveDir: process.cwd(),
  },
  outfile: "node_modules/.cache/flas-onboarding.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  alias: { "@": "./src" },
  plugins: [
    {
      name: "onboarding-boundaries",
      setup(b) {
        const stubs = {
          "client.server":
            "export const supabaseAdmin = new Proxy({}, {get: (_, key) => globalThis.onboardingDb[key]});",
          "auth-middleware": "export const requireSupabaseAuth = {};",
          "@tanstack/react-start":
            "export function createServerFn() { return {middleware(){return this},inputValidator(){return this},handler(fn){return fn}}; }",
          "audit.server": "export async function logAudit() {}",
          "social-doctor.server":
            "export async function runConnectionTest({account}) { return {accountId: account.id}; }",
        };
        b.onResolve({ filter: /.*/ }, (args) => {
          const key = Object.keys(stubs).find(
            (key) => args.path === key || args.path.endsWith("/" + key),
          );
          return key ? { path: key, namespace: "onboarding-stub" } : undefined;
        });
        b.onLoad({ filter: /.*/, namespace: "onboarding-stub" }, (args) => ({
          contents: stubs[args.path],
          loader: "js",
        }));
      },
    },
  ],
});
