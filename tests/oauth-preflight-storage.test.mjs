import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync("node_modules/.cache", { recursive: true });
await build({
  entryPoints: ["src/lib/oauth-preflight.server.ts"],
  outfile: "node_modules/.cache/oauth-preflight-storage.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "error",
  plugins: [
    {
      name: "preflight-boundaries",
      setup(b) {
        for (const [filter, name] of [
          [/client\.server$/, "admin"],
          [/secret-box\.server$/, "encryption"],
          [/oauth\.server$/, "oauth"],
        ])
          b.onResolve({ filter }, () => ({ path: name, namespace: "preflight-test" }));
        b.onLoad({ filter: /.*/, namespace: "preflight-test" }, ({ path }) => ({
          contents:
            path === "admin"
              ? "export const supabaseAdmin={from:(...a)=>globalThis.__preflight.from(...a),rpc:(...a)=>globalThis.__preflight.rpc(...a)};"
              : path === "encryption"
                ? "export const encryptionConfigured=async()=>true;"
                : "export async function resolveCredentials(){return {id:'synthetic-client',secret:'synthetic-secret',source:'shared'}} export function resolveAllowedOrigin(origin){return origin==='https://flas.example'?origin:null}",
          loader: "js",
        }));
      },
    },
  ],
});
const { oauthPreflight } = await import("../node_modules/.cache/oauth-preflight-storage.mjs");
process.env.PUBLIC_APP_URL = "https://flas.example";

function setup(options = {}) {
  const reads = [];
  globalThis.__preflight = {
    from(table) {
      return {
        select(columns) {
          reads.push({ table, columns });
          return {
            async limit(n) {
              assert.equal(n, 0, "Readiness must not read customer rows");
              const missing =
                options.missing &&
                columns
                  .split(",")
                  .map((s) => s.trim())
                  .includes(options.missing);
              return {
                data: [],
                error:
                  missing || options.readError ? { message: "Synthetic missing column" } : null,
              };
            },
          };
        },
      };
    },
    async rpc(name) {
      assert.equal(name, "integration_oauth_storage_ready");
      return {
        data: options.guard !== false,
        error: options.guardError ? { message: "Unavailable" } : null,
      };
    },
  };
  return reads;
}

for (const provider of ["google", "meta"])
  for (const missing of ["purpose", "target_account_id", "requested_scopes"])
    test(`${provider}: an old successful guard cannot hide missing ${missing}`, async () => {
      setup({ missing });
      const result = await oauthPreflight(provider, "workspace-A", "https://flas.example");
      assert.equal(result.checks.storage, false);
      assert.equal(result.ready, false);
      assert.equal(result.checks.credentials, true);
    });

test("complete attempt storage passes a read-only, zero-row preflight", async () => {
  const reads = setup();
  const result = await oauthPreflight("google", "workspace-A", "https://flas.example");
  assert.equal(result.ready, true);
  const columns = reads
    .find((r) => r.table === "oauth_states")
    .columns.split(",")
    .map((s) => s.trim());
  for (const column of ["purpose", "target_account_id", "requested_scopes"])
    assert.ok(columns.includes(column));
});

for (const options of [{ guard: false }, { guardError: true }, { readError: true }])
  test(`${Object.keys(options)[0]} still refuses OAuth start`, async () => {
    setup(options);
    assert.equal(
      (await oauthPreflight("google", "workspace-A", "https://flas.example")).ready,
      false,
    );
  });
