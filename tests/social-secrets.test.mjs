// Batch 1 / Phase 6 — token encryption at rest.
//
//   npm run test:social-secrets
//
// MUTATION=drop_aad encrypts without binding the ciphertext to its tenant and
// field. The suite MUST fail: the cross-row tests exist to catch exactly that.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import * as secrets from "../node_modules/.cache/flas-secrets.mjs";

const MUTATION = process.env.MUTATION ?? "";
if (MUTATION === "drop_aad") console.log("!! MUTATION: AAD ignored — the suite must FAIL");

const key = () => crypto.randomBytes(32).toString("base64");
const ring = (active, ...ids) => ({
  SOCIAL_TOKEN_ENCRYPTION_KEYS: ids.map(([id, k]) => `${id}:${k}`).join(","),
  SOCIAL_TOKEN_ACTIVE_KEY_ID: active,
});
const K1 = ["k1", key()];
const K2 = ["k2", key()];
const env1 = ring("k1", K1);
const aadA = secrets.tokenAad("tenant-a", "facebook", "access_token");
const aadB = secrets.tokenAad("tenant-b", "facebook", "access_token");
const aadRefresh = secrets.tokenAad("tenant-a", "facebook", "refresh_token");
const aad = (a) => (MUTATION === "drop_aad" ? "fixed" : a);

const SECRET = "EAAB-test-token-not-real-0123456789abcdef";

describe("round trip", () => {
  test("a token decrypts to itself", async () => {
    const env = await secrets.encryptSecret(SECRET, aad(aadA), env1);
    assert.equal(await secrets.decryptSecret(env, aad(aadA), env1), SECRET);
  });

  test("the envelope is v1:keyId:iv:ciphertext:tag", async () => {
    const env = await secrets.encryptSecret(SECRET, aad(aadA), env1);
    const parts = env.split(":");
    assert.equal(parts.length, 5);
    assert.equal(parts[0], "v1");
    assert.equal(parts[1], "k1");
    assert.ok(secrets.isEnvelope(env));
  });

  test("the plaintext appears nowhere in the envelope", async () => {
    const env = await secrets.encryptSecret(SECRET, aad(aadA), env1);
    assert.equal(env.includes(SECRET), false);
    assert.equal(env.includes(Buffer.from(SECRET).toString("base64").slice(0, 20)), false);
  });

  test("every encryption uses a fresh IV", async () => {
    const ivs = new Set();
    for (let i = 0; i < 50; i++) {
      ivs.add((await secrets.encryptSecret(SECRET, aad(aadA), env1)).split(":")[2]);
    }
    assert.equal(ivs.size, 50);
  });
});

describe("authentication", () => {
  test("a tampered ciphertext is refused", async () => {
    const env = await secrets.encryptSecret(SECRET, aad(aadA), env1);
    const parts = env.split(":");
    const ct = Buffer.from(parts[3], "base64url");
    ct[0] ^= 0x01;
    parts[3] = ct.toString("base64url");
    await assert.rejects(secrets.decryptSecret(parts.join(":"), aad(aadA), env1), {
      code: "authentication_failed",
    });
  });

  test("a tampered tag is refused", async () => {
    const env = await secrets.encryptSecret(SECRET, aad(aadA), env1);
    const parts = env.split(":");
    const tag = Buffer.from(parts[4], "base64url");
    tag[tag.length - 1] ^= 0x80;
    parts[4] = tag.toString("base64url");
    await assert.rejects(secrets.decryptSecret(parts.join(":"), aad(aadA), env1), {
      code: "authentication_failed",
    });
  });

  test("a ciphertext copied into another workspace's row does not decrypt", async () => {
    const env = await secrets.encryptSecret(SECRET, aad(aadA), env1);
    await assert.rejects(secrets.decryptSecret(env, aad(aadB), env1), {
      code: "authentication_failed",
    });
  });

  test("a refresh token moved into the access-token column does not decrypt", async () => {
    const env = await secrets.encryptSecret(SECRET, aad(aadRefresh), env1);
    await assert.rejects(secrets.decryptSecret(env, aad(aadA), env1), {
      code: "authentication_failed",
    });
  });

  test("the error never contains the plaintext or the key", async () => {
    const env = await secrets.encryptSecret(SECRET, aad(aadA), env1);
    try {
      await secrets.decryptSecret(env, aad(aadB), env1);
    } catch (e) {
      assert.equal(String(e.message).includes(SECRET), false);
      assert.equal(String(e.message).includes(K1[1]), false);
    }
  });
});

describe("rotation", () => {
  test("a token written under an old key still decrypts once a new key is active", async () => {
    const old = await secrets.encryptSecret(SECRET, aad(aadA), env1);
    const both = ring("k2", K1, K2);
    assert.equal(await secrets.decryptSecret(old, aad(aadA), both), SECRET);
    assert.equal(secrets.needsRotation(old, both), true);
  });

  test("new writes use the active key", async () => {
    const both = ring("k2", K1, K2);
    const fresh = await secrets.encryptSecret(SECRET, aad(aadA), both);
    assert.equal(secrets.envelopeKeyId(fresh), "k2");
    assert.equal(secrets.needsRotation(fresh, both), false);
  });

  test("a token whose key was removed from the ring says so", async () => {
    const old = await secrets.encryptSecret(SECRET, aad(aadA), env1);
    await assert.rejects(secrets.decryptSecret(old, aad(aadA), ring("k2", K2)), {
      code: "unknown_key",
    });
  });
});

describe("configuration fails closed", () => {
  test("no key ring means no encryption, not plaintext", async () => {
    await assert.rejects(secrets.encryptSecret(SECRET, aadA, {}), { code: "not_configured" });
    assert.equal(secrets.encryptionConfigured({}), false);
  });

  test("an active key id missing from the ring is refused", () => {
    assert.throws(() => secrets.readKeyRing(ring("k9", K1)), { code: "bad_key_ring" });
  });

  test("a key that is not 32 bytes is refused", () => {
    assert.throws(
      () => secrets.readKeyRing({ SOCIAL_TOKEN_ENCRYPTION_KEYS: `k1:${Buffer.alloc(16).toString("base64")}`, SOCIAL_TOKEN_ACTIVE_KEY_ID: "k1" }),
      { code: "bad_key_ring" },
    );
  });

  test("a duplicated key id is refused", () => {
    assert.throws(() => secrets.readKeyRing(ring("k1", K1, ["k1", key()])), { code: "bad_key_ring" });
  });

  test("a key-ring error never echoes key material", () => {
    const bad = { SOCIAL_TOKEN_ENCRYPTION_KEYS: "k1:not-base64-!!!", SOCIAL_TOKEN_ACTIVE_KEY_ID: "k1" };
    try {
      secrets.readKeyRing(bad);
    } catch (e) {
      assert.equal(String(e.message).includes("not-base64-!!!"), false);
    }
  });

  test("a malformed envelope is refused before any crypto", async () => {
    for (const junk of ["", "plaintext-token", "v1:k1:only-three", "v2:k1:a:b:c"]) {
      await assert.rejects(secrets.decryptSecret(junk, aadA, env1), { code: "malformed" });
    }
  });
});
