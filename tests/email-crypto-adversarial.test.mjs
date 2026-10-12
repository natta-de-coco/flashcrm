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

const generateKey = () => crypto.randomBytes(32).toString("base64");
const makeRing = (active, ...entries) => ({
  EMAIL_TOKEN_ENCRYPTION_KEYS: entries.map(([id, k]) => `${id}:${k}`).join(","),
  EMAIL_TOKEN_ACTIVE_KEY_ID: active,
});

const K1 = ["k1", generateKey()];
const K2 = ["k2", generateKey()];
const K3 = ["k3", generateKey()];
const env1 = makeRing("k1", K1);
const env12 = makeRing("k1", K1, K2);
const env2Active = makeRing("k2", K1, K2);
const env3Active = makeRing("k3", K1, K2, K3);

const TEST_SECRET = "Platform_Transactional_Secret_Key_!@#$%^&*()_+2026";

describe("email-crypto: Adversarial Ciphertext Tampering", () => {
  test("single-bit flip in first byte of ciphertext fails authentication", async () => {
    const envelope = await emailCrypto.encryptEmailSecret(TEST_SECRET, "platform", "smtp_password", env1);
    const parts = envelope.split(":");
    const ct = Buffer.from(parts[3], "base64url");
    ct[0] ^= 0x01;
    parts[3] = ct.toString("base64url");
    await assert.rejects(
      emailCrypto.decryptEmailSecret(parts.join(":"), "platform", "smtp_password", env1),
      (err) => err instanceof emailCrypto.EmailCryptoError && err.code === "authentication_failed",
    );
  });

  test("single-bit flip in middle byte of ciphertext fails authentication", async () => {
    const envelope = await emailCrypto.encryptEmailSecret(TEST_SECRET, "platform", "smtp_password", env1);
    const parts = envelope.split(":");
    const ct = Buffer.from(parts[3], "base64url");
    const mid = Math.floor(ct.length / 2);
    ct[mid] ^= 0x08;
    parts[3] = ct.toString("base64url");
    await assert.rejects(
      emailCrypto.decryptEmailSecret(parts.join(":"), "platform", "smtp_password", env1),
      (err) => err instanceof emailCrypto.EmailCryptoError && err.code === "authentication_failed",
    );
  });

  test("single-bit flip in last byte of ciphertext fails authentication", async () => {
    const envelope = await emailCrypto.encryptEmailSecret(TEST_SECRET, "platform", "smtp_password", env1);
    const parts = envelope.split(":");
    const ct = Buffer.from(parts[3], "base64url");
    ct[ct.length - 1] ^= 0x80;
    parts[3] = ct.toString("base64url");
    await assert.rejects(
      emailCrypto.decryptEmailSecret(parts.join(":"), "platform", "smtp_password", env1),
      (err) => err instanceof emailCrypto.EmailCryptoError && err.code === "authentication_failed",
    );
  });

  test("bitwise inversion of all ciphertext bytes fails authentication", async () => {
    const envelope = await emailCrypto.encryptEmailSecret(TEST_SECRET, "platform", "smtp_password", env1);
    const parts = envelope.split(":");
    const ct = Buffer.from(parts[3], "base64url");
    for (let i = 0; i < ct.length; i++) ct[i] ^= 0xff;
    parts[3] = ct.toString("base64url");
    await assert.rejects(
      emailCrypto.decryptEmailSecret(parts.join(":"), "platform", "smtp_password", env1),
      (err) => err instanceof emailCrypto.EmailCryptoError && err.code === "authentication_failed",
    );
  });

  test("truncated ciphertext by 1 byte fails authentication", async () => {
    const envelope = await emailCrypto.encryptEmailSecret(TEST_SECRET, "platform", "smtp_password", env1);
    const parts = envelope.split(":");
    const ct = Buffer.from(parts[3], "base64url");
    parts[3] = ct.subarray(0, ct.length - 1).toString("base64url");
    await assert.rejects(
      emailCrypto.decryptEmailSecret(parts.join(":"), "platform", "smtp_password", env1),
      (err) => err instanceof emailCrypto.EmailCryptoError && err.code === "authentication_failed",
    );
  });

  test("empty ciphertext with tag fails authentication", async () => {
    const envelope = await emailCrypto.encryptEmailSecret(TEST_SECRET, "platform", "smtp_password", env1);
    const parts = envelope.split(":");
    parts[3] = "";
    await assert.rejects(
      emailCrypto.decryptEmailSecret(parts.join(":"), "platform", "smtp_password", env1),
      (err) => err instanceof emailCrypto.EmailCryptoError && err.code === "authentication_failed",
    );
  });

  test("appended bytes to ciphertext fails authentication", async () => {
    const envelope = await emailCrypto.encryptEmailSecret(TEST_SECRET, "platform", "smtp_password", env1);
    const parts = envelope.split(":");
    const ct = Buffer.concat([Buffer.from(parts[3], "base64url"), Buffer.from([0xaa, 0xbb])]);
    parts[3] = ct.toString("base64url");
    await assert.rejects(
      emailCrypto.decryptEmailSecret(parts.join(":"), "platform", "smtp_password", env1),
      (err) => err instanceof emailCrypto.EmailCryptoError && err.code === "authentication_failed",
    );
  });

  test("ciphertext swapped from another encrypted secret fails authentication", async () => {
    const envelopeA = await emailCrypto.encryptEmailSecret("SECRET_A_12345", "platform", "smtp_password", env1);
    const envelopeB = await emailCrypto.encryptEmailSecret("SECRET_B_67890", "platform", "smtp_password", env1);
    const partsA = envelopeA.split(":");
    const partsB = envelopeB.split(":");
    // Swap ciphertext of B into envelope A keeping A's IV and tag
    partsA[3] = partsB[3];
    await assert.rejects(
      emailCrypto.decryptEmailSecret(partsA.join(":"), "platform", "smtp_password", env1),
      (err) => err instanceof emailCrypto.EmailCryptoError && err.code === "authentication_failed",
    );
  });
});

describe("email-crypto: Adversarial Auth Tag Corruption", () => {
  test("single-bit flip in first byte of auth tag fails authentication", async () => {
    const envelope = await emailCrypto.encryptEmailSecret(TEST_SECRET, "platform", "smtp_password", env1);
    const parts = envelope.split(":");
    const tag = Buffer.from(parts[4], "base64url");
    tag[0] ^= 0x01;
    parts[4] = tag.toString("base64url");
    await assert.rejects(
      emailCrypto.decryptEmailSecret(parts.join(":"), "platform", "smtp_password", env1),
      (err) => err instanceof emailCrypto.EmailCryptoError && err.code === "authentication_failed",
    );
  });

  test("single-bit flip in last byte of auth tag fails authentication", async () => {
    const envelope = await emailCrypto.encryptEmailSecret(TEST_SECRET, "platform", "smtp_password", env1);
    const parts = envelope.split(":");
    const tag = Buffer.from(parts[4], "base64url");
    tag[tag.length - 1] ^= 0x01;
    parts[4] = tag.toString("base64url");
    await assert.rejects(
      emailCrypto.decryptEmailSecret(parts.join(":"), "platform", "smtp_password", env1),
      (err) => err instanceof emailCrypto.EmailCryptoError && err.code === "authentication_failed",
    );
  });

  test("all-zero auth tag (16 zero bytes) fails authentication", async () => {
    const envelope = await emailCrypto.encryptEmailSecret(TEST_SECRET, "platform", "smtp_password", env1);
    const parts = envelope.split(":");
    parts[4] = Buffer.alloc(16, 0).toString("base64url");
    await assert.rejects(
      emailCrypto.decryptEmailSecret(parts.join(":"), "platform", "smtp_password", env1),
      (err) => err instanceof emailCrypto.EmailCryptoError && err.code === "authentication_failed",
    );
  });

  test("truncated auth tag (15 bytes) throws malformed error", async () => {
    const envelope = await emailCrypto.encryptEmailSecret(TEST_SECRET, "platform", "smtp_password", env1);
    const parts = envelope.split(":");
    parts[4] = Buffer.alloc(15, 0x42).toString("base64url");
    await assert.rejects(
      emailCrypto.decryptEmailSecret(parts.join(":"), "platform", "smtp_password", env1),
      (err) => err instanceof emailCrypto.EmailCryptoError && err.code === "malformed",
    );
  });

  test("expanded auth tag (18 bytes) throws malformed error", async () => {
    const envelope = await emailCrypto.encryptEmailSecret(TEST_SECRET, "platform", "smtp_password", env1);
    const parts = envelope.split(":");
    parts[4] = Buffer.alloc(18, 0x42).toString("base64url");
    await assert.rejects(
      emailCrypto.decryptEmailSecret(parts.join(":"), "platform", "smtp_password", env1),
      (err) => err instanceof emailCrypto.EmailCryptoError && err.code === "malformed",
    );
  });

  test("invalid base64url characters in auth tag throws malformed error", async () => {
    const envelope = await emailCrypto.encryptEmailSecret(TEST_SECRET, "platform", "smtp_password", env1);
    const parts = envelope.split(":");
    parts[4] = "!@#$%^&*()_+???=";
    await assert.rejects(
      emailCrypto.decryptEmailSecret(parts.join(":"), "platform", "smtp_password", env1),
      (err) => err instanceof emailCrypto.EmailCryptoError && err.code === "malformed",
    );
  });
});

describe("email-crypto: Adversarial IV Modification", () => {
  test("single-bit flip in IV fails authentication", async () => {
    const envelope = await emailCrypto.encryptEmailSecret(TEST_SECRET, "platform", "smtp_password", env1);
    const parts = envelope.split(":");
    const iv = Buffer.from(parts[2], "base64url");
    iv[0] ^= 0x01;
    parts[2] = iv.toString("base64url");
    await assert.rejects(
      emailCrypto.decryptEmailSecret(parts.join(":"), "platform", "smtp_password", env1),
      (err) => err instanceof emailCrypto.EmailCryptoError && err.code === "authentication_failed",
    );
  });

  test("all-zero IV fails authentication", async () => {
    const envelope = await emailCrypto.encryptEmailSecret(TEST_SECRET, "platform", "smtp_password", env1);
    const parts = envelope.split(":");
    parts[2] = Buffer.alloc(12, 0).toString("base64url");
    await assert.rejects(
      emailCrypto.decryptEmailSecret(parts.join(":"), "platform", "smtp_password", env1),
      (err) => err instanceof emailCrypto.EmailCryptoError && err.code === "authentication_failed",
    );
  });

  test("truncated IV (11 bytes) throws malformed error", async () => {
    const envelope = await emailCrypto.encryptEmailSecret(TEST_SECRET, "platform", "smtp_password", env1);
    const parts = envelope.split(":");
    parts[2] = Buffer.alloc(11, 0x11).toString("base64url");
    await assert.rejects(
      emailCrypto.decryptEmailSecret(parts.join(":"), "platform", "smtp_password", env1),
      (err) => err instanceof emailCrypto.EmailCryptoError && err.code === "malformed",
    );
  });

  test("expanded IV (16 bytes) throws malformed error", async () => {
    const envelope = await emailCrypto.encryptEmailSecret(TEST_SECRET, "platform", "smtp_password", env1);
    const parts = envelope.split(":");
    parts[2] = Buffer.alloc(16, 0x11).toString("base64url");
    await assert.rejects(
      emailCrypto.decryptEmailSecret(parts.join(":"), "platform", "smtp_password", env1),
      (err) => err instanceof emailCrypto.EmailCryptoError && err.code === "malformed",
    );
  });
});

describe("email-crypto: Cross-Scope and Field AAD Binding Mismatches", () => {
  test("secret encrypted as smtp_password cannot be decrypted as imap_password", async () => {
    const envelope = await emailCrypto.encryptEmailSecret(TEST_SECRET, "platform", "smtp_password", env1);
    await assert.rejects(
      emailCrypto.decryptEmailSecret(envelope, "platform", "imap_password", env1),
      (err) => err instanceof emailCrypto.EmailCryptoError && err.code === "authentication_failed",
    );
  });

  test("secret encrypted for platform scope cannot be decrypted for tenant scope", async () => {
    const envelope = await emailCrypto.encryptEmailSecret(TEST_SECRET, "platform", "smtp_password", env1);
    await assert.rejects(
      emailCrypto.decryptEmailSecret(envelope, "tenant-a", "smtp_password", env1),
      (err) => err instanceof emailCrypto.EmailCryptoError && err.code === "authentication_failed",
    );
  });

  test("secret encrypted for tenant-a cannot be decrypted for tenant-b", async () => {
    const envelope = await emailCrypto.encryptEmailSecret(TEST_SECRET, "tenant-a", "smtp_password", env1);
    await assert.rejects(
      emailCrypto.decryptEmailSecret(envelope, "tenant-b", "smtp_password", env1),
      (err) => err instanceof emailCrypto.EmailCryptoError && err.code === "authentication_failed",
    );
  });

  test("secret encrypted with default secret field cannot be decrypted with explicit smtp_password", async () => {
    const envelope = await emailCrypto.encryptEmailSecret(TEST_SECRET, "platform", env1);
    await assert.rejects(
      emailCrypto.decryptEmailSecret(envelope, "platform", "smtp_password", env1),
      (err) => err instanceof emailCrypto.EmailCryptoError && err.code === "authentication_failed",
    );
  });

  test("secret encrypted with custom AAD string requires exact same AAD string", async () => {
    const aad1 = "custom-auth-aad-v1:context:1";
    const aad2 = "custom-auth-aad-v1:context:2";
    const envelope = await emailCrypto.encryptEmailSecret(TEST_SECRET, aad1, env1);
    // Correct AAD works
    const ok = await emailCrypto.decryptEmailSecret(envelope, aad1, env1);
    assert.equal(ok, TEST_SECRET);
    // Different AAD fails
    await assert.rejects(
      emailCrypto.decryptEmailSecret(envelope, aad2, env1),
      (err) => err instanceof emailCrypto.EmailCryptoError && err.code === "authentication_failed",
    );
  });

  test("secret encrypted with AAD fails when extra whitespace is passed", async () => {
    const aad = "custom-aad:test";
    const envelope = await emailCrypto.encryptEmailSecret(TEST_SECRET, aad, env1);
    await assert.rejects(
      emailCrypto.decryptEmailSecret(envelope, `${aad} `, env1),
      (err) => err instanceof emailCrypto.EmailCryptoError && err.code === "authentication_failed",
    );
  });
});

describe("email-crypto: Key Rotation & Missing Keys", () => {
  test("secret encrypted with k1 can still be decrypted when k2 is active (k1 is secondary)", async () => {
    const envK1 = await emailCrypto.encryptEmailSecret(TEST_SECRET, "platform", "smtp_password", env1);
    assert.equal(emailCrypto.emailEnvelopeKeyId(envK1), "k1");

    // Decrypt using env where k2 is active and k1 is secondary
    const dec = await emailCrypto.decryptEmailSecret(envK1, "platform", "smtp_password", env2Active);
    assert.equal(dec, TEST_SECRET);
    assert.equal(emailCrypto.emailNeedsRotation(envK1, env2Active), true);
  });

  test("new writes under rotated ring use the new active key", async () => {
    const envK2 = await emailCrypto.encryptEmailSecret(TEST_SECRET, "platform", "smtp_password", env2Active);
    assert.equal(emailCrypto.emailEnvelopeKeyId(envK2), "k2");
    assert.equal(emailCrypto.emailNeedsRotation(envK2, env2Active), false);
  });

  test("secret encrypted under secondary key k2 can be decrypted when k1 is active", async () => {
    const envK2 = await emailCrypto.encryptEmailSecret(TEST_SECRET, "platform", "smtp_password", env2Active);
    // env12 has k1 active, but k2 is in the ring
    const dec = await emailCrypto.decryptEmailSecret(envK2, "platform", "smtp_password", env12);
    assert.equal(dec, TEST_SECRET);
    assert.equal(emailCrypto.emailNeedsRotation(envK2, env12), true);
  });

  test("multi-generation rotation: k1, k2, k3", async () => {
    const e1 = await emailCrypto.encryptEmailSecret("gen1", "platform", "smtp_password", env1);
    const e2 = await emailCrypto.encryptEmailSecret("gen2", "platform", "smtp_password", env2Active);
    const e3 = await emailCrypto.encryptEmailSecret("gen3", "platform", "smtp_password", env3Active);

    // env3Active can decrypt all three generations
    assert.equal(await emailCrypto.decryptEmailSecret(e1, "platform", "smtp_password", env3Active), "gen1");
    assert.equal(await emailCrypto.decryptEmailSecret(e2, "platform", "smtp_password", env3Active), "gen2");
    assert.equal(await emailCrypto.decryptEmailSecret(e3, "platform", "smtp_password", env3Active), "gen3");

    assert.equal(emailCrypto.emailNeedsRotation(e1, env3Active), true);
    assert.equal(emailCrypto.emailNeedsRotation(e2, env3Active), true);
    assert.equal(emailCrypto.emailNeedsRotation(e3, env3Active), false);
  });

  test("tampering keyId to another valid keyId in ring fails authentication", async () => {
    const envelope = await emailCrypto.encryptEmailSecret(TEST_SECRET, "platform", "smtp_password", env2Active);
    const parts = envelope.split(":");
    assert.equal(parts[1], "k2");
    parts[1] = "k1"; // change keyId to k1
    await assert.rejects(
      emailCrypto.decryptEmailSecret(parts.join(":"), "platform", "smtp_password", env2Active),
      (err) => err instanceof emailCrypto.EmailCryptoError && err.code === "authentication_failed",
    );
  });

  test("key removed from ring throws unknown_key", async () => {
    const envelope = await emailCrypto.encryptEmailSecret(TEST_SECRET, "platform", "smtp_password", env1);
    const envOnlyK2 = makeRing("k2", K2);
    await assert.rejects(
      emailCrypto.decryptEmailSecret(envelope, "platform", "smtp_password", envOnlyK2),
      (err) => err instanceof emailCrypto.EmailCryptoError && err.code === "unknown_key",
    );
  });
});

describe("email-crypto: Key Ring Parser Adversarial & Malformed Inputs", () => {
  test("duplicate key ID in ring throws bad_key_ring", () => {
    const dupRing = {
      EMAIL_TOKEN_ENCRYPTION_KEYS: `k1:${K1[1]},k1:${K2[1]}`,
      EMAIL_TOKEN_ACTIVE_KEY_ID: "k1",
    };
    assert.throws(
      () => emailCrypto.readEmailKeyRing(dupRing),
      (err) => err instanceof emailCrypto.EmailCryptoError && err.code === "bad_key_ring",
    );
  });

  test("invalid key ID containing special characters throws bad_key_ring", () => {
    const badIdRing = {
      EMAIL_TOKEN_ENCRYPTION_KEYS: `k@1:${K1[1]}`,
      EMAIL_TOKEN_ACTIVE_KEY_ID: "k@1",
    };
    assert.throws(
      () => emailCrypto.readEmailKeyRing(badIdRing),
      (err) => err instanceof emailCrypto.EmailCryptoError && err.code === "bad_key_ring",
    );
  });

  test("key ID longer than 32 characters throws bad_key_ring", () => {
    const longId = "a".repeat(33);
    const badIdRing = {
      EMAIL_TOKEN_ENCRYPTION_KEYS: `${longId}:${K1[1]}`,
      EMAIL_TOKEN_ACTIVE_KEY_ID: longId,
    };
    assert.throws(
      () => emailCrypto.readEmailKeyRing(badIdRing),
      (err) => err instanceof emailCrypto.EmailCryptoError && err.code === "bad_key_ring",
    );
  });

  test("key material not valid base64 throws bad_key_ring", () => {
    const badKeyRing = {
      EMAIL_TOKEN_ENCRYPTION_KEYS: "k1:!!!NotValidBase64@@@",
      EMAIL_TOKEN_ACTIVE_KEY_ID: "k1",
    };
    assert.throws(
      () => emailCrypto.readEmailKeyRing(badKeyRing),
      (err) => err instanceof emailCrypto.EmailCryptoError && err.code === "bad_key_ring",
    );
  });

  test("key material shorter than 32 bytes (e.g. 16 bytes for AES-128) throws bad_key_ring", () => {
    const shortKey = crypto.randomBytes(16).toString("base64");
    const badKeyRing = {
      EMAIL_TOKEN_ENCRYPTION_KEYS: `k1:${shortKey}`,
      EMAIL_TOKEN_ACTIVE_KEY_ID: "k1",
    };
    assert.throws(
      () => emailCrypto.readEmailKeyRing(badKeyRing),
      (err) => err instanceof emailCrypto.EmailCryptoError && err.code === "bad_key_ring",
    );
  });

  test("key material longer than 32 bytes (e.g. 64 bytes) throws bad_key_ring", () => {
    const longKey = crypto.randomBytes(64).toString("base64");
    const badKeyRing = {
      EMAIL_TOKEN_ENCRYPTION_KEYS: `k1:${longKey}`,
      EMAIL_TOKEN_ACTIVE_KEY_ID: "k1",
    };
    assert.throws(
      () => emailCrypto.readEmailKeyRing(badKeyRing),
      (err) => err instanceof emailCrypto.EmailCryptoError && err.code === "bad_key_ring",
    );
  });

  test("entry missing colon throws bad_key_ring", () => {
    const badKeyRing = {
      EMAIL_TOKEN_ENCRYPTION_KEYS: "k1_no_colon_key_material",
      EMAIL_TOKEN_ACTIVE_KEY_ID: "k1",
    };
    assert.throws(
      () => emailCrypto.readEmailKeyRing(badKeyRing),
      (err) => err instanceof emailCrypto.EmailCryptoError && err.code === "bad_key_ring",
    );
  });

  test("active key ID not in keys map throws bad_key_ring", () => {
    const badKeyRing = {
      EMAIL_TOKEN_ENCRYPTION_KEYS: `k1:${K1[1]}`,
      EMAIL_TOKEN_ACTIVE_KEY_ID: "k_missing",
    };
    assert.throws(
      () => emailCrypto.readEmailKeyRing(badKeyRing),
      (err) => err instanceof emailCrypto.EmailCryptoError && err.code === "bad_key_ring",
    );
  });

  test("empty env throws not_configured", () => {
    assert.throws(
      () => emailCrypto.readEmailKeyRing({}),
      (err) => err instanceof emailCrypto.EmailCryptoError && err.code === "not_configured",
    );
  });

  test("fallback to SOCIAL_TOKEN_ENCRYPTION_KEYS works when EMAIL_TOKEN keys absent", async () => {
    const socialRing = {
      SOCIAL_TOKEN_ENCRYPTION_KEYS: `soc1:${K1[1]}`,
      SOCIAL_TOKEN_ACTIVE_KEY_ID: "soc1",
    };
    const ring = emailCrypto.readEmailKeyRing(socialRing);
    assert.equal(ring.active, "soc1");
    assert.ok(ring.keys.has("soc1"));

    const enc = await emailCrypto.encryptEmailSecret("hello", "platform", "smtp_password", socialRing);
    const dec = await emailCrypto.decryptEmailSecret(enc, "platform", "smtp_password", socialRing);
    assert.equal(dec, "hello");
  });

  test("fallback to PLATFORM_ENCRYPTION_KEY works when token keys absent", async () => {
    const platformSingle = {
      PLATFORM_ENCRYPTION_KEY: K1[1],
    };
    const ring = emailCrypto.readEmailKeyRing(platformSingle);
    assert.equal(ring.active, "k1");
    assert.ok(ring.keys.has("k1"));

    const enc = await emailCrypto.encryptEmailSecret("platform-msg", "platform", "smtp_password", platformSingle);
    const dec = await emailCrypto.decryptEmailSecret(enc, "platform", "smtp_password", platformSingle);
    assert.equal(dec, "platform-msg");
  });

  test("emailCryptoConfigured returns true when valid ring present, false otherwise", () => {
    assert.equal(emailCrypto.emailCryptoConfigured(env1), true);
    assert.equal(emailCrypto.emailCryptoConfigured({}), false);
    assert.equal(emailCrypto.emailCryptoConfigured({ EMAIL_TOKEN_ACTIVE_KEY_ID: "k1" }), false);
  });
});

describe("email-crypto: Extreme Length and Content Inputs", () => {
  test("empty secret string throws empty_secret error", async () => {
    await assert.rejects(
      emailCrypto.encryptEmailSecret("", "platform", "smtp_password", env1),
      (err) => err instanceof emailCrypto.EmailCryptoError && err.code === "empty_secret",
    );
  });

  test("single character secret encrypts and decrypts accurately", async () => {
    const enc = await emailCrypto.encryptEmailSecret("x", "platform", "smtp_password", env1);
    const dec = await emailCrypto.decryptEmailSecret(enc, "platform", "smtp_password", env1);
    assert.equal(dec, "x");
  });

  test("large secret: 100 KB payload", async () => {
    const largeStr = "A".repeat(100 * 1024);
    const enc = await emailCrypto.encryptEmailSecret(largeStr, "platform", "smtp_password", env1);
    const dec = await emailCrypto.decryptEmailSecret(enc, "platform", "smtp_password", env1);
    assert.equal(dec, largeStr);
    assert.equal(dec.length, 100 * 1024);
  });

  test("extreme secret: 1 MB payload", async () => {
    const mbPayload = crypto.randomBytes(1024 * 1024).toString("base64");
    const enc = await emailCrypto.encryptEmailSecret(mbPayload, "platform", "smtp_password", env1);
    const dec = await emailCrypto.decryptEmailSecret(enc, "platform", "smtp_password", env1);
    assert.equal(dec, mbPayload);
  });

  test("Unicode, multilingual, surrogate pairs and emoji sequences", async () => {
    const unicodeSecret = "🔒🔐 Flas CRM Email 🚀 中文测试 العربية Русский 👨‍👩‍👧‍👦 \u0000\u001f\r\n\t";
    const enc = await emailCrypto.encryptEmailSecret(unicodeSecret, "platform", "smtp_password", env1);
    const dec = await emailCrypto.decryptEmailSecret(enc, "platform", "smtp_password", env1);
    assert.equal(dec, unicodeSecret);
  });

  test("embedded null bytes and control characters survive intact", async () => {
    const binaryish = "pre\x00mid\x01\x02\x03\x1b[31mend";
    const enc = await emailCrypto.encryptEmailSecret(binaryish, "platform", "smtp_password", env1);
    const dec = await emailCrypto.decryptEmailSecret(enc, "platform", "smtp_password", env1);
    assert.equal(dec, binaryish);
  });

  test("whitespace-only secrets encrypt and decrypt faithfully", async () => {
    const ws = "   \t\r\n   ";
    const enc = await emailCrypto.encryptEmailSecret(ws, "platform", "smtp_password", env1);
    const dec = await emailCrypto.decryptEmailSecret(enc, "platform", "smtp_password", env1);
    assert.equal(dec, ws);
  });
});

describe("email-crypto: Envelope Structure Parser Boundaries", () => {
  test("non-envelope string formats throw malformed", async () => {
    const invalids = [
      "not-an-envelope",
      "v1:k1:iv:ct", // 4 parts
      "v1:k1:iv:ct:tag:extra", // 6 parts
      "v2:k1:iv:ct:tag", // wrong version
      ":k1:iv:ct:tag", // missing version
      "v1::::", // empty parts
    ];
    for (const inv of invalids) {
      await assert.rejects(
        emailCrypto.decryptEmailSecret(inv, "platform", "smtp_password", env1),
        (err) => err instanceof emailCrypto.EmailCryptoError,
        `Expected rejection for "${inv}"`,
      );
    }
  });

  test("isEmailEnvelope accurately identifies envelopes", () => {
    assert.equal(emailCrypto.isEmailEnvelope("v1:k1:iv:ct:tag"), true);
    assert.equal(emailCrypto.isEmailEnvelope("v1:k1:iv:ct"), false);
    assert.equal(emailCrypto.isEmailEnvelope("v2:k1:iv:ct:tag"), false);
    assert.equal(emailCrypto.isEmailEnvelope(null), false);
    assert.equal(emailCrypto.isEmailEnvelope(undefined), false);
    assert.equal(emailCrypto.isEmailEnvelope(12345), false);
    assert.equal(emailCrypto.isEmailEnvelope({}), false);
  });

  test("emailEnvelopeKeyId returns key ID or null", () => {
    assert.equal(emailCrypto.emailEnvelopeKeyId("v1:my-key-99:iv:ct:tag"), "my-key-99");
    assert.equal(emailCrypto.emailEnvelopeKeyId("not-an-envelope"), null);
  });
});
