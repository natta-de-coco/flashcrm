// Encryption at rest for social tokens and platform app secrets.
//
// The property that matters is not "it encrypts" but "it can never quietly
// lose or expose a credential": tampering is detected, a value cannot be moved
// under another key id, rotation keeps old values readable, and a missing key
// fails loudly instead of handing ciphertext to a provider.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { beforeEach, describe, it } from "node:test";

import {
  encryptionConfigured,
  isSealed,
  openSecret,
  sealSecret,
} from "../node_modules/.cache/flas-secret-box.mjs";

const freshKey = () => randomBytes(32).toString("base64");
const K1 = freshKey();
const K2 = freshKey();

const useKeys = (spec) => {
  delete process.env.TOKEN_ENCRYPTION_KEY;
  if (spec === null) delete process.env.TOKEN_ENCRYPTION_KEYS;
  else process.env.TOKEN_ENCRYPTION_KEYS = spec;
};

describe("credentials are sealed at rest", () => {
  beforeEach(() => useKeys(`k1:${K1}`));

  it("round-trips a token and never stores it readably", async () => {
    const sealed = await sealSecret("EAAGsecret-page-token");
    assert.ok(isSealed(sealed));
    assert.ok(!sealed.includes("EAAGsecret-page-token"));
    assert.equal(await openSecret(sealed), "EAAGsecret-page-token");
  });

  it("uses a fresh IV, so the same token never produces the same ciphertext", async () => {
    assert.notEqual(await sealSecret("same"), await sealSecret("same"));
  });

  it("detects tampering instead of returning garbage", async () => {
    const parts = (await sealSecret("token")).split(":");
    const ct = parts[4];
    parts[4] = (ct[0] === "A" ? "B" : "A") + ct.slice(1);
    await assert.rejects(openSecret(parts.join(":")), /could not be decrypted/);
  });

  it("refuses a value relabelled to another key id, even with the same key material", async () => {
    // The key id is authenticated data, so this is detected rather than read.
    useKeys(`k1:${K1},k2:${K1}`);
    const sealed = await sealSecret("token");
    await assert.rejects(openSecret(sealed.replace("enc:v1:k1:", "enc:v1:k2:")));
  });

  it("reads legacy plaintext unchanged, so existing connections keep working", async () => {
    assert.equal(await openSecret("ya29.legacy-plaintext"), "ya29.legacy-plaintext");
  });

  it("does not seal twice", async () => {
    const sealed = await sealSecret("token");
    assert.equal(await sealSecret(sealed), sealed);
  });

  it("treats empty as absent", async () => {
    assert.equal(await sealSecret(""), null);
    assert.equal(await sealSecret(null), null);
    assert.equal(await openSecret(null), null);
  });

  it("rejects a malformed sealed value", async () => {
    await assert.rejects(openSecret("enc:v1:k1:only-two-parts"), /expected encrypted format/);
  });
});

describe("key rotation", () => {
  it("seals with the first key and still opens values sealed under older ones", async () => {
    useKeys(`k1:${K1}`);
    const old = await sealSecret("token");
    useKeys(`k2:${K2},k1:${K1}`);
    assert.equal(await openSecret(old), "token");
    assert.match(await sealSecret("token"), /^enc:v1:k2:/);
  });

  it("fails loudly, naming the key, when a value's key has been removed", async () => {
    useKeys(`k1:${K1}`);
    const sealed = await sealSecret("token");
    useKeys(`k2:${K2}`);
    await assert.rejects(openSecret(sealed), /"k1"/);
  });
});

describe("configuration", () => {
  it("with no key, refuses new credential writes and reports encryption off", async () => {
    useKeys(null);
    await assert.rejects(sealSecret("token"), /Secure credential storage is unavailable/);
    assert.equal(await encryptionConfigured(), false);
  });

  it("accepts TOKEN_ENCRYPTION_KEY as a single key k1", async () => {
    useKeys(null);
    process.env.TOKEN_ENCRYPTION_KEY = K1;
    try {
      assert.match(await sealSecret("token"), /^enc:v1:k1:/);
      assert.equal(await encryptionConfigured(), true);
    } finally {
      delete process.env.TOKEN_ENCRYPTION_KEY;
    }
  });

  it("refuses a key that is not 32 bytes rather than using a weak one", async () => {
    useKeys(`k1:${Buffer.from("too-short").toString("base64")}`);
    await assert.rejects(sealSecret("token"), /32 bytes/);
    assert.equal(await encryptionConfigured(), false);
  });

  it("refuses a key entry without an id", async () => {
    useKeys(K1);
    await assert.rejects(sealSecret("token"), /id:base64key/);
  });
});
