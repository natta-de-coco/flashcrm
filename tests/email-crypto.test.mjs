import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { build } from "esbuild";

await build({
  entryPoints: ["src/lib/email-crypto.server.ts"],
  outfile: "node_modules/.cache/flas-email-crypto.mjs",
  format: "esm",
  platform: "node",
  bundle: true,
  logLevel: "error",
});

const emailCrypto = await import("../node_modules/.cache/flas-email-crypto.mjs");

const key = () => crypto.randomBytes(32).toString("base64");
const ring = (active, ...ids) => ({
  EMAIL_TOKEN_ENCRYPTION_KEYS: ids.map(([id, k]) => `${id}:${k}`).join(","),
  EMAIL_TOKEN_ACTIVE_KEY_ID: active,
});
const K1 = ["k1", key()];
const K2 = ["k2", key()];
const env1 = ring("k1", K1);
const env2 = ring("k2", K1, K2);

const SECRET = "SuperSecretPlatformSmtpPass!2026#";

describe("email-crypto: round trip", () => {
  test("a secret encrypts and decrypts to itself", async () => {
    const envelope = await emailCrypto.encryptEmailSecret(SECRET, "platform", "smtp_password", env1);
    const decrypted = await emailCrypto.decryptEmailSecret(envelope, "platform", "smtp_password", env1);
    assert.equal(decrypted, SECRET);
  });

  test("the envelope conforms to v1:keyId:iv:ciphertext:tag", async () => {
    const envelope = await emailCrypto.encryptEmailSecret(SECRET, "platform", "smtp_password", env1);
    const parts = envelope.split(":");
    assert.equal(parts.length, 5);
    assert.equal(parts[0], "v1");
    assert.equal(parts[1], "k1");
    assert.ok(emailCrypto.isEmailEnvelope(envelope));
    assert.equal(emailCrypto.emailEnvelopeKeyId(envelope), "k1");
  });

  test("the plaintext appears nowhere in the envelope", async () => {
    const envelope = await emailCrypto.encryptEmailSecret(SECRET, "platform", "smtp_password", env1);
    assert.equal(envelope.includes(SECRET), false);
    assert.equal(
      envelope.includes(Buffer.from(SECRET).toString("base64").slice(0, 16)),
      false,
    );
  });

  test("every encryption produces a fresh IV", async () => {
    const ivs = new Set();
    for (let i = 0; i < 50; i++) {
      const envelope = await emailCrypto.encryptEmailSecret(SECRET, "platform", "smtp_password", env1);
      ivs.add(envelope.split(":")[2]);
    }
    assert.equal(ivs.size, 50);
  });

  test("supports direct AAD string and parsed KeyRing object", async () => {
    const customAad = "flas-platform:v1:smtp_password";
    const rawRing = {
      active: "k1",
      keys: new Map([["k1", Buffer.from(K1[1], "base64")]]),
    };
    const envelope = await emailCrypto.encryptEmailSecret(SECRET, customAad, rawRing);
    const decrypted = await emailCrypto.decryptEmailSecret(envelope, customAad, rawRing);
    assert.equal(decrypted, SECRET);
  });
});

describe("email-crypto: authentication & context binding", () => {
  test("a tampered ciphertext is refused", async () => {
    const envelope = await emailCrypto.encryptEmailSecret(SECRET, "platform", "smtp_password", env1);
    const parts = envelope.split(":");
    const ct = Buffer.from(parts[3], "base64url");
    ct[0] ^= 0x01;
    parts[3] = ct.toString("base64url");
    await assert.rejects(
      emailCrypto.decryptEmailSecret(parts.join(":"), "platform", "smtp_password", env1),
      { code: "authentication_failed" },
    );
  });

  test("a tampered tag is refused", async () => {
    const envelope = await emailCrypto.encryptEmailSecret(SECRET, "platform", "smtp_password", env1);
    const parts = envelope.split(":");
    const tag = Buffer.from(parts[4], "base64url");
    tag[tag.length - 1] ^= 0x80;
    parts[4] = tag.toString("base64url");
    await assert.rejects(
      emailCrypto.decryptEmailSecret(parts.join(":"), "platform", "smtp_password", env1),
      { code: "authentication_failed" },
    );
  });

  test("a secret encrypted for smtp_password cannot be decrypted as imap_password", async () => {
    const envelope = await emailCrypto.encryptEmailSecret(SECRET, "platform", "smtp_password", env1);
    await assert.rejects(
      emailCrypto.decryptEmailSecret(envelope, "platform", "imap_password", env1),
      { code: "authentication_failed" },
    );
  });

  test("a secret encrypted for platform scope cannot be decrypted with tenant scope", async () => {
    const envelope = await emailCrypto.encryptEmailSecret(SECRET, "platform", "smtp_password", env1);
    await assert.rejects(
      emailCrypto.decryptEmailSecret(envelope, "tenant-123", "smtp_password", env1),
      { code: "authentication_failed" },
    );
  });
});

describe("email-crypto: key rotation", () => {
  test("a secret encrypted with k1 still decrypts when k2 is active", async () => {
    const envelope = await emailCrypto.encryptEmailSecret(SECRET, "platform", "smtp_password", env1);
    assert.equal(emailCrypto.emailEnvelopeKeyId(envelope), "k1");
    // Decrypt using key ring where k2 is active but k1 is present
    const decrypted = await emailCrypto.decryptEmailSecret(envelope, "platform", "smtp_password", env2);
    assert.equal(decrypted, SECRET);
    assert.equal(emailCrypto.emailNeedsRotation(envelope, env2), true);
  });

  test("new writes use the active key", async () => {
    const envelope = await emailCrypto.encryptEmailSecret(SECRET, "platform", "smtp_password", env2);
    assert.equal(emailCrypto.emailEnvelopeKeyId(envelope), "k2");
    assert.equal(emailCrypto.emailNeedsRotation(envelope, env2), false);
  });

  test("a secret whose key was removed from the ring throws unknown_key", async () => {
    const envelope = await emailCrypto.encryptEmailSecret(SECRET, "platform", "smtp_password", env1);
    const envOnlyK2 = ring("k2", K2);
    await assert.rejects(
      emailCrypto.decryptEmailSecret(envelope, "platform", "smtp_password", envOnlyK2),
      { code: "unknown_key" },
    );
  });
});

describe("email-crypto: configuration and edge cases", () => {
  test("empty secret throws empty_secret", async () => {
    await assert.rejects(
      emailCrypto.encryptEmailSecret("", "platform", "smtp_password", env1),
      { code: "empty_secret" },
    );
  });

  test("missing key ring throws not_configured", async () => {
    await assert.rejects(
      emailCrypto.encryptEmailSecret(SECRET, "platform", "smtp_password", {}),
      { code: "not_configured" },
    );
  });

  test("active key id missing from ring throws bad_key_ring", async () => {
    const badRing = {
      EMAIL_TOKEN_ENCRYPTION_KEYS: `k1:${key()}`,
      EMAIL_TOKEN_ACTIVE_KEY_ID: "k_non_existent",
    };
    await assert.rejects(
      emailCrypto.encryptEmailSecret(SECRET, "platform", "smtp_password", badRing),
      { code: "bad_key_ring" },
    );
  });

  test("malformed envelope string is rejected", async () => {
    await assert.rejects(
      emailCrypto.decryptEmailSecret("not-an-envelope", "platform", "smtp_password", env1),
      { code: "malformed" },
    );
  });
});
