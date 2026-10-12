/**
 * src/lib/email-crypto.server.ts
 *
 * Authenticated envelope encryption for email credentials (Milestone 1).
 * Compatible with WebCrypto (crypto.subtle) and social-secrets.server.ts.
 *
 * Envelope format:
 *   v1:<keyId>:<iv>:<ciphertext>:<tag>  (parts base64url)
 *
 * Key resolution:
 *   1. EMAIL_TOKEN_ENCRYPTION_KEYS / EMAIL_TOKEN_ACTIVE_KEY_ID
 *   2. SOCIAL_TOKEN_ENCRYPTION_KEYS / SOCIAL_TOKEN_ACTIVE_KEY_ID
 *   3. PLATFORM_ENCRYPTION_KEY
 */

const VERSION = "v1";
const KEY_ID_REGEX = /^[A-Za-z0-9_-]{1,32}$/;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export type EmailCryptoCode =
  | "not_configured"
  | "bad_key_ring"
  | "unknown_key"
  | "malformed"
  | "authentication_failed"
  | "empty_secret";

export class EmailCryptoError extends Error {
  readonly code: EmailCryptoCode;
  constructor(code: EmailCryptoCode, message: string) {
    super(message);
    this.name = "EmailCryptoError";
    this.code = code;
  }
}

export type Env = Record<string, string | undefined>;
const defaultEnv = (): Env =>
  (typeof process !== "undefined" ? process.env : {}) as Env;

/* ---------- base64 / base64url helpers ---------- */

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

/* ---------- Key Ring Resolution ---------- */

export type KeyRing = {
  active: string;
  activeId?: string | undefined;
  keys: Map<string, Uint8Array<ArrayBuffer>>;
};

export function readEmailKeyRing(env: Env = defaultEnv()): KeyRing {
  let raw = env["EMAIL_TOKEN_ENCRYPTION_KEYS"]?.trim();
  let active = env["EMAIL_TOKEN_ACTIVE_KEY_ID"]?.trim();

  // Fallback to social tokens ring if email ring not explicitly set
  if (!raw || !active) {
    raw = env["SOCIAL_TOKEN_ENCRYPTION_KEYS"]?.trim();
    active = env["SOCIAL_TOKEN_ACTIVE_KEY_ID"]?.trim();
  }

  // Fallback to single PLATFORM_ENCRYPTION_KEY if provided
  if (!raw && env["PLATFORM_ENCRYPTION_KEY"]?.trim()) {
    const single = env["PLATFORM_ENCRYPTION_KEY"]!.trim();
    raw = `k1:${single}`;
    active = "k1";
  }

  if (!raw || !active) {
    throw new EmailCryptoError(
      "not_configured",
      "Email credential encryption is not configured: set EMAIL_TOKEN_ENCRYPTION_KEYS or SOCIAL_TOKEN_ENCRYPTION_KEYS.",
    );
  }

  const keys = new Map<string, Uint8Array<ArrayBuffer>>();
  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const i = trimmed.indexOf(":");
    const id = i > 0 ? trimmed.slice(0, i).trim() : "";
    const material = i > 0 ? trimmed.slice(i + 1).trim() : "";
    if (!KEY_ID_REGEX.test(id)) {
      throw new EmailCryptoError("bad_key_ring", "Key ring contains an entry with an invalid key id.");
    }
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = fromB64(material);
    } catch {
      throw new EmailCryptoError("bad_key_ring", `Key "${id}" is not valid base64.`);
    }
    if (bytes.length !== 32) {
      throw new EmailCryptoError("bad_key_ring", `Key "${id}" must be exactly 32 bytes (AES-256).`);
    }
    if (keys.has(id)) {
      throw new EmailCryptoError("bad_key_ring", `Key id "${id}" appears twice.`);
    }
    keys.set(id, bytes);
  }

  if (!keys.has(active)) {
    throw new EmailCryptoError(
      "bad_key_ring",
      `Active key id "${active}" is not present in the key ring.`,
    );
  }

  return { active, activeId: active, keys };
}

function resolveKeyRing(envOrRing?: Env | KeyRing | undefined): KeyRing {
  if (envOrRing && "keys" in envOrRing && (envOrRing.active || envOrRing.activeId)) {
    const active = envOrRing.active || envOrRing.activeId!;
    return {
      active,
      activeId: active,
      keys: envOrRing.keys as Map<string, Uint8Array<ArrayBuffer>>,
    };
  }
  return readEmailKeyRing((envOrRing as Env) ?? defaultEnv());
}

const importedKeys = new Map<string, Promise<CryptoKey>>();
function getCryptoKey(id: string, bytes: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const cacheKey = `${id}:${toB64url(bytes)}`;
  let key = importedKeys.get(cacheKey);
  if (!key) {
    key = crypto.subtle.importKey(
      "raw",
      bytes,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
    importedKeys.set(cacheKey, key);
  }
  return key;
}

/* ---------- Public Envelope & Crypto API ---------- */

export function emailAad(scope: string = "platform", field: string = "secret"): string {
  return `flas-email:${VERSION}:${scope}:${field}`;
}

export function isEmailEnvelope(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith(`${VERSION}:`) &&
    value.split(":").length === 5
  );
}

export function emailEnvelopeKeyId(envelope: string): string | null {
  return isEmailEnvelope(envelope) ? envelope.split(":")[1] ?? null : null;
}

function resolveAadAndRing(
  scopeOrAad: string,
  fieldOrEnvOrRing: string | Env | KeyRing | undefined,
  envOrRing?: Env | KeyRing,
): { aad: string; ring: KeyRing } {
  let aad: string;
  let ringSource: Env | KeyRing | undefined;

  if (typeof fieldOrEnvOrRing === "object" && fieldOrEnvOrRing !== null) {
    // Called as: fn(text, aad, ringOrEnv)
    aad = scopeOrAad;
    ringSource = fieldOrEnvOrRing;
  } else if (typeof fieldOrEnvOrRing === "string") {
    // Called as: fn(text, scope, field, ringOrEnv)
    if (scopeOrAad.includes(":")) {
      aad = scopeOrAad;
    } else {
      aad = emailAad(scopeOrAad, fieldOrEnvOrRing);
    }
    ringSource = envOrRing;
  } else {
    // Called as: fn(text, scopeOrAad)
    if (scopeOrAad.includes(":")) {
      aad = scopeOrAad;
    } else {
      aad = emailAad(scopeOrAad, "secret");
    }
    ringSource = envOrRing;
  }

  const ring = resolveKeyRing(ringSource);
  return { aad, ring };
}

/**
 * Encrypt a plaintext secret using AES-256-GCM envelope.
 * Supports multiple call styles:
 *   - encryptEmailSecret(plaintext)
 *   - encryptEmailSecret(plaintext, "platform", "smtp_password")
 *   - encryptEmailSecret(plaintext, aad, ring)
 *   - encryptEmailSecret(plaintext, scope, field, env)
 */
export async function encryptEmailSecret(
  plainText: string,
  scopeOrAad: string = "platform",
  fieldOrEnvOrRing?: string | Env | KeyRing,
  envOrRing?: Env | KeyRing,
): Promise<string> {
  if (typeof plainText !== "string" || plainText.length === 0) {
    throw new EmailCryptoError("empty_secret", "Cannot encrypt empty secret string.");
  }

  const { aad, ring } = resolveAadAndRing(scopeOrAad, fieldOrEnvOrRing, envOrRing);
  const activeKeyBytes = ring.keys.get(ring.active);
  if (!activeKeyBytes) {
    throw new EmailCryptoError("unknown_key", `Active key "${ring.active}" not found in key ring.`);
  }

  const key = await getCryptoKey(ring.active, activeKeyBytes);
  const iv = new Uint8Array(IV_BYTES);
  crypto.getRandomValues(iv);

  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: new TextEncoder().encode(aad),
        tagLength: TAG_BYTES * 8,
      },
      key,
      new TextEncoder().encode(plainText),
    ),
  );

  const ciphertext = sealed.slice(0, sealed.length - TAG_BYTES);
  const tag = sealed.slice(sealed.length - TAG_BYTES);
  return [VERSION, ring.active, toB64url(iv), toB64url(ciphertext), toB64url(tag)].join(":");
}

/**
 * Decrypt an AES-256-GCM envelope string.
 * Supports multiple call styles:
 *   - decryptEmailSecret(envelope)
 *   - decryptEmailSecret(envelope, "platform", "smtp_password")
 *   - decryptEmailSecret(envelope, aad, ring)
 *   - decryptEmailSecret(envelope, scope, field, env)
 */
export async function decryptEmailSecret(
  envelope: string,
  scopeOrAad: string = "platform",
  fieldOrEnvOrRing?: string | Env | KeyRing,
  envOrRing?: Env | KeyRing,
): Promise<string> {
  if (!isEmailEnvelope(envelope)) {
    throw new EmailCryptoError("malformed", "Stored secret is not a recognized encryption envelope.");
  }

  const parts = envelope.split(":");
  if (parts.length !== 5) {
    throw new EmailCryptoError("malformed", "Stored secret envelope has invalid number of parts.");
  }
  const [, keyId, ivPart, ctPart, tagPart] = parts as [string, string, string, string, string];

  const { aad, ring } = resolveAadAndRing(scopeOrAad, fieldOrEnvOrRing, envOrRing);
  const material = ring.keys.get(keyId);
  if (!material) {
    throw new EmailCryptoError(
      "unknown_key",
      `Stored secret was encrypted with key "${keyId}", which is no longer in the key ring.`,
    );
  }

  let iv: Uint8Array<ArrayBuffer>, ct: Uint8Array<ArrayBuffer>, tag: Uint8Array<ArrayBuffer>;
  try {
    iv = fromB64(ivPart);
    ct = fromB64(ctPart);
    tag = fromB64(tagPart);
  } catch {
    throw new EmailCryptoError("malformed", "Stored secret envelope contains invalid base64url data.");
  }

  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new EmailCryptoError("malformed", "Stored secret envelope has invalid IV or tag length.");
  }

  const sealed = new Uint8Array(ct.length + tag.length);
  sealed.set(ct);
  sealed.set(tag, ct.length);

  try {
    const key = await getCryptoKey(keyId, material);
    const plain = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: new TextEncoder().encode(aad),
        tagLength: TAG_BYTES * 8,
      },
      key,
      sealed,
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new EmailCryptoError("authentication_failed", "Stored secret failed authentication.");
  }
}

export function emailNeedsRotation(envelope: string, envOrRing?: Env | KeyRing): boolean {
  const id = emailEnvelopeKeyId(envelope);
  if (!id) return false;
  try {
    const ring = resolveKeyRing(envOrRing);
    return id !== ring.active;
  } catch {
    return false;
  }
}

export function emailCryptoConfigured(envOrRing?: Env | KeyRing): boolean {
  try {
    resolveKeyRing(envOrRing);
    return true;
  } catch {
    return false;
  }
}
