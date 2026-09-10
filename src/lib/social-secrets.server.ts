/**
 * Authenticated encryption for social provider tokens (Batch 1, Phase 6).
 *
 * AES-256-GCM through WebCrypto. Both the Cloudflare Worker runtime this app
 * deploys to and Node provide it, so there is no dependency and the tests run
 * the same code the server does.
 *
 *   Envelope:  v1:<keyId>:<iv>:<ciphertext>:<tag>      (parts base64url)
 *
 *   SOCIAL_TOKEN_ENCRYPTION_KEYS = "k2026a:<base64 32 bytes>,k2026b:<...>"
 *   SOCIAL_TOKEN_ACTIVE_KEY_ID   = "k2026b"
 *
 * New writes use the active key; any key still in the ring decrypts. That is
 * what makes rotation possible: add a key, make it active, re-encrypt at
 * leisure, and only then remove the old one.
 *
 * Additional authenticated data binds each ciphertext to where it belongs --
 * tenant, platform and field. A ciphertext copied into another workspace's row,
 * or moved from refresh_token_enc into access_token_enc, fails authentication
 * rather than decrypting.
 *
 * This module never logs, and no error it raises contains key material,
 * plaintext or ciphertext. It has no imports, so it can be bundled on its own
 * for tests and for the backfill script.
 */

const VERSION = "v1";
const KEY_ID = /^[A-Za-z0-9_-]{1,32}$/;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export type TokenCryptoCode =
  | "not_configured"
  | "bad_key_ring"
  | "unknown_key"
  | "malformed"
  | "authentication_failed";

export class TokenCryptoError extends Error {
  readonly code: TokenCryptoCode;
  constructor(code: TokenCryptoCode, message: string) {
    super(message);
    this.name = "TokenCryptoError";
    this.code = code;
  }
}

type Env = Record<string, string | undefined>;
const defaultEnv = (): Env =>
  (typeof process !== "undefined" ? process.env : {}) as Env;

/* ---------- encoding ---------- */

function toB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64(value: string): Uint8Array<ArrayBuffer> {
  const std = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = std + "=".repeat((4 - (std.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ---------- key ring ---------- */

type KeyRing = { active: string; keys: Map<string, Uint8Array<ArrayBuffer>> };

/**
 * Parses the key ring from the environment. Messages name the variable and the
 * key id at most -- never a key.
 */
export function readKeyRing(env: Env = defaultEnv()): KeyRing {
  const raw = env["SOCIAL_TOKEN_ENCRYPTION_KEYS"]?.trim();
  const active = env["SOCIAL_TOKEN_ACTIVE_KEY_ID"]?.trim();
  if (!raw || !active) {
    throw new TokenCryptoError(
      "not_configured",
      "Social token encryption is not configured: set SOCIAL_TOKEN_ENCRYPTION_KEYS and SOCIAL_TOKEN_ACTIVE_KEY_ID.",
    );
  }
  const keys = new Map<string, Uint8Array<ArrayBuffer>>();
  for (const entry of raw.split(",")) {
    const i = entry.indexOf(":");
    const id = i > 0 ? entry.slice(0, i).trim() : "";
    const material = i > 0 ? entry.slice(i + 1).trim() : "";
    if (!KEY_ID.test(id)) {
      throw new TokenCryptoError("bad_key_ring", "SOCIAL_TOKEN_ENCRYPTION_KEYS has an entry with an invalid key id.");
    }
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = fromB64(material);
    } catch {
      throw new TokenCryptoError("bad_key_ring", `Key "${id}" is not valid base64.`);
    }
    if (bytes.length !== 32) {
      throw new TokenCryptoError("bad_key_ring", `Key "${id}" must be exactly 32 bytes (AES-256).`);
    }
    if (keys.has(id)) {
      throw new TokenCryptoError("bad_key_ring", `Key id "${id}" appears twice.`);
    }
    keys.set(id, bytes);
  }
  if (!keys.has(active)) {
    throw new TokenCryptoError(
      "bad_key_ring",
      `SOCIAL_TOKEN_ACTIVE_KEY_ID names "${active}", which is not in the key ring.`,
    );
  }
  return { active, keys };
}

const imported = new Map<string, Promise<CryptoKey>>();
function cryptoKey(id: string, bytes: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  // Cached per key *material*, so a test that swaps the ring gets fresh keys.
  const cacheKey = `${id}:${toB64url(bytes)}`;
  let key = imported.get(cacheKey);
  if (!key) {
    key = crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, [
      "encrypt",
      "decrypt",
    ]);
    imported.set(cacheKey, key);
  }
  return key;
}

/* ---------- public API ---------- */

/** The AAD every token field is bound to. */
export function tokenAad(
  tenantId: string,
  platform: string,
  field: "access_token" | "refresh_token" | "code_verifier",
): string {
  return `flas-social:${VERSION}:${tenantId}:${platform}:${field}`;
}

export function isEnvelope(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(`${VERSION}:`) && value.split(":").length === 5;
}

export function envelopeKeyId(envelope: string): string | null {
  return isEnvelope(envelope) ? (envelope.split(":")[1] ?? null) : null;
}

export async function encryptSecret(
  plaintext: string,
  aad: string,
  env: Env = defaultEnv(),
): Promise<string> {
  const ring = readKeyRing(env);
  const key = await cryptoKey(ring.active, ring.keys.get(ring.active)!);
  const iv = new Uint8Array(IV_BYTES);
  crypto.getRandomValues(iv);
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad), tagLength: TAG_BYTES * 8 },
      key,
      new TextEncoder().encode(plaintext),
    ),
  );
  // WebCrypto appends the tag to the ciphertext; the envelope stores it apart.
  const ciphertext = sealed.slice(0, sealed.length - TAG_BYTES);
  const tag = sealed.slice(sealed.length - TAG_BYTES);
  return [VERSION, ring.active, toB64url(iv), toB64url(ciphertext), toB64url(tag)].join(":");
}

export async function decryptSecret(
  envelope: string,
  aad: string,
  env: Env = defaultEnv(),
): Promise<string> {
  if (!isEnvelope(envelope)) {
    throw new TokenCryptoError("malformed", "Stored token is not a recognised encryption envelope.");
  }
  const [, keyId, ivPart, ctPart, tagPart] = envelope.split(":") as [string, string, string, string, string];
  const ring = readKeyRing(env);
  const material = ring.keys.get(keyId);
  if (!material) {
    throw new TokenCryptoError(
      "unknown_key",
      `Stored token was encrypted with key "${keyId}", which is no longer in the key ring.`,
    );
  }
  let iv: Uint8Array<ArrayBuffer>, ct: Uint8Array<ArrayBuffer>, tag: Uint8Array<ArrayBuffer>;
  try {
    iv = fromB64(ivPart);
    ct = fromB64(ctPart);
    tag = fromB64(tagPart);
  } catch {
    throw new TokenCryptoError("malformed", "Stored token envelope is not valid base64url.");
  }
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new TokenCryptoError("malformed", "Stored token envelope has the wrong shape.");
  }
  const sealed = new Uint8Array(ct.length + tag.length);
  sealed.set(ct);
  sealed.set(tag, ct.length);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad), tagLength: TAG_BYTES * 8 },
      await cryptoKey(keyId, material),
      sealed,
    );
    return new TextDecoder().decode(plain);
  } catch {
    // Tampered ciphertext, a wrong key, or a ciphertext moved to a row it does
    // not belong to. Deliberately indistinguishable to the caller.
    throw new TokenCryptoError("authentication_failed", "Stored token failed authentication.");
  }
}

/** True when the envelope was written with a key other than the active one. */
export function needsRotation(envelope: string, env: Env = defaultEnv()): boolean {
  const id = envelopeKeyId(envelope);
  return id !== null && id !== readKeyRing(env).active;
}

/** Whether new token writes can succeed at all. Never throws. */
export function encryptionConfigured(env: Env = defaultEnv()): boolean {
  try {
    readKeyRing(env);
    return true;
  } catch {
    return false;
  }
}
