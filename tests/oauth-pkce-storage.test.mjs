import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { randomBytes, createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { build } from "esbuild";

mkdirSync("node_modules/.cache", { recursive: true });
await build({
  entryPoints: ["src/lib/oauth.server.ts"],
  outfile: "node_modules/.cache/oauth-pkce-storage.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "error",
  alias: { "@": "./src" },
  plugins: [
    {
      name: "pkce-boundaries",
      setup(b) {
        for (const [filter, name] of [
          [/client\.server$/, "admin"],
          [/oauth-preflight\.server$/, "preflight"],
          [/secret-box\.server$/, "legacy"],
          [/connection-state\.server$/, "bookkeeping"],
        ])
          b.onResolve({ filter }, () => ({ path: name, namespace: "pkce-test" }));
        const modules = {
          admin:
            "export const supabaseAdmin={from:(...a)=>globalThis.__pkceDb.from(...a),rpc:(...a)=>globalThis.__pkceDb.rpc(...a)};",
          preflight:
            "export async function oauthPreflight(){return {ready:true,allowedOrigin:'https://flas.example',credentials:{id:'synthetic-client',secret:'synthetic-secret',source:'shared'}}}",
          legacy:
            "export async function openSecret(){throw new Error('Real credentials are forbidden in this test')}",
          bookkeeping:
            "export async function beginAuthorization(){} export async function sweepAbandonedAttempts(){}",
        };
        b.onLoad({ filter: /.*/, namespace: "pkce-test" }, ({ path }) => ({
          contents: modules[path],
          loader: "js",
        }));
      },
    },
  ],
});
await build({
  entryPoints: ["src/lib/social-secrets.server.ts"],
  outfile: "node_modules/.cache/oauth-pkce-crypto.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "error",
});
const oauth = await import("../node_modules/.cache/oauth-pkce-storage.mjs");
const crypto = await import("../node_modules/.cache/oauth-pkce-crypto.mjs");
const platformKey = randomBytes(32).toString("base64");
const dedicatedKey = randomBytes(32).toString("base64");
const tenant = "00000000-0000-4000-8000-000000000001";
let rows;

beforeEach(() => {
  for (const name of [
    "TOKEN_ENCRYPTION_KEYS",
    "TOKEN_ENCRYPTION_KEY",
    "SOCIAL_TOKEN_ENCRYPTION_KEYS",
    "SOCIAL_TOKEN_ACTIVE_KEY_ID",
  ])
    delete process.env[name];
  process.env.TOKEN_ENCRYPTION_KEYS = `platform:${platformKey}`;
  rows = new Map();
  globalThis.__pkceDb = {
    from(table) {
      assert.equal(table, "oauth_states");
      return {
        async insert(row) {
          rows.set(row.state_hash, { ...row });
          return { error: null };
        },
      };
    },
    async rpc(name, args) {
      assert.equal(name, "consume_oauth_state_hash");
      const row = rows.get(args._state_hash);
      rows.delete(args._state_hash);
      return { data: row ? [row] : [], error: null };
    },
  };
});
async function start() {
  const result = await oauth.startAuthorization({
    platform: "youtube",
    origin: "https://flas.example",
    tenantId: tenant,
    userId: "00000000-0000-4000-8000-000000000002",
  });
  assert.equal(result.ready, true);
  const url = new URL(result.url);
  const state = url.searchParams.get("state");
  const hash = await oauth.sha256Hex(state);
  return { url, state, hash, row: rows.get(hash) };
}
async function seed(verifier, state = "synthetic-legacy-state") {
  rows.set(await oauth.sha256Hex(state), {
    tenant_id: tenant,
    user_id: "synthetic-user",
    platform: "youtube",
    redirect_uri: "https://flas.example/api/public/oauth-callback",
    code_verifier: verifier,
  });
  return state;
}
async function proveRoundTrip(attempt) {
  assert.ok(crypto.isEnvelope(attempt.row.code_verifier));
  const consumed = await oauth.consumeState(attempt.state);
  assert.match(consumed.code_verifier, /^[A-Za-z0-9._~-]{43,128}$/);
  assert.equal(
    createHash("sha256").update(consumed.code_verifier).digest("base64url"),
    attempt.url.searchParams.get("code_challenge"),
  );
  assert.notEqual(consumed.code_verifier, attempt.row.code_verifier);
  assert.equal(await oauth.consumeState(attempt.state), null, "state cannot be consumed twice");
}

test("existing platform ring supports actual encrypted PKCE start and callback", async () => {
  await proveRoundTrip(await start());
});
test("single platform key shorthand supports the same bound round trip", async () => {
  delete process.env.TOKEN_ENCRYPTION_KEYS;
  process.env.TOKEN_ENCRYPTION_KEY = platformKey;
  const attempt = await start();
  assert.equal(crypto.envelopeKeyId(attempt.row.code_verifier), "k1");
  await proveRoundTrip(attempt);
});
test("an explicit dedicated ring keeps precedence over the platform ring", async () => {
  process.env.SOCIAL_TOKEN_ENCRYPTION_KEYS = `dedicated:${dedicatedKey}`;
  process.env.SOCIAL_TOKEN_ACTIVE_KEY_ID = "dedicated";
  const attempt = await start();
  assert.equal(crypto.envelopeKeyId(attempt.row.code_verifier), "dedicated");
  await proveRoundTrip(attempt);
});
test("a partial dedicated configuration cannot silently use the platform key", async () => {
  process.env.SOCIAL_TOKEN_ENCRYPTION_KEYS = `dedicated:${dedicatedKey}`;
  await assert.rejects(start(), { code: "not_configured" });
});
test("an invalid dedicated ring cannot silently use the platform key", async () => {
  process.env.SOCIAL_TOKEN_ENCRYPTION_KEYS = "dedicated:invalid";
  process.env.SOCIAL_TOKEN_ACTIVE_KEY_ID = "dedicated";
  await assert.rejects(start(), { code: "bad_key_ring" });
});
test("malformed platform material is never accepted as usable encryption", () => {
  assert.equal(crypto.encryptionConfigured({ TOKEN_ENCRYPTION_KEYS: "platform:invalid" }), false);
  assert.equal(crypto.encryptionConfigured({}), false);
});
test("old platform keys remain usable when the active platform key changes", async () => {
  const value = await crypto.encryptSecret("synthetic-verifier", "synthetic-aad", {
    TOKEN_ENCRYPTION_KEYS: `old:${platformKey}`,
  });
  const rotated = { TOKEN_ENCRYPTION_KEYS: `new:${dedicatedKey},old:${platformKey}` };
  assert.equal(await crypto.decryptSecret(value, "synthetic-aad", rotated), "synthetic-verifier");
  assert.equal(crypto.needsRotation(value, rotated), true);
});
for (const moved of ["tenant", "state", "field"])
  test(`PKCE ciphertext moved to another ${moved} is refused after consumption`, async () => {
    process.env.SOCIAL_TOKEN_ENCRYPTION_KEYS = `dedicated:${dedicatedKey}`;
    process.env.SOCIAL_TOKEN_ACTIVE_KEY_ID = "dedicated";
    const state = `synthetic-${moved}-state`;
    const hash = await oauth.sha256Hex(state);
    const aad = crypto.tokenAad(
      moved === "tenant" ? "another-tenant" : tenant,
      moved === "state" ? "oauth:another-hash" : `oauth:${hash}`,
      moved === "field" ? "access_token" : "code_verifier",
    );
    const sealed = await crypto.encryptSecret("a".repeat(43), aad);
    await seed(sealed, state);
    await assert.rejects(oauth.consumeState(state), /PKCE.*could not be opened/i);
    assert.equal(await oauth.consumeState(state), null);
  });
for (const value of ["v1:broken", "v2:unknown:format", "short", "a".repeat(129), "!".repeat(43)])
  test(`invalid stored verifier is refused (${value.slice(0, 12)})`, async () => {
    const state = await seed(value);
    await assert.rejects(oauth.consumeState(state), /PKCE/i);
  });
test("valid legacy plaintext attempts can finish without a new grant", async () => {
  const verifier = "a".repeat(43);
  assert.equal((await oauth.consumeState(await seed(verifier))).code_verifier, verifier);
});
test("non-PKCE attempts retain their null verifier", async () => {
  assert.equal((await oauth.consumeState(await seed(null))).code_verifier, null);
});
