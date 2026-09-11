/*
 * Encryption at rest for the credentials Flas holds on customers' behalf:
 * social account access and refresh tokens, and the platform app secrets a
 * workspace pastes in.
 *
 * Why application-side. Column grants already stop a browser session reading
 * these columns, but a database backup, a leaked service-role key, a replica
 * or a logged SELECT all read them in the clear. Sealing them here means the
 * database only ever holds ciphertext; the key lives in the server's
 * environment and never in the database.
 *
 * Format: enc:v1:<keyId>:<iv>:<ciphertext+tag>, base64url. AES-256-GCM through
 * WebCrypto (available on the server runtime and in Node), a fresh random
 * 96-bit IV per value, and the key id bound in as additional authenticated
 * data -- so a value cannot be opened under any key id but the one it names.
 *
 * Keys: TOKEN_ENCRYPTION_KEYS="k2:<base64 of 32 bytes>,k1:<base64 of 32 bytes>".
 * The first key seals new values; the others only open old ones, which makes
 * rotation a configuration change rather than a migration.
 * TOKEN_ENCRYPTION_KEY=<base64> is accepted as shorthand for a single key "k1".
 *
 * With no key configured, sealSecret() returns the value unchanged and the
 * integration health report says encryption is off. Deliberate: refusing to
 * store a token would break every connection the moment the variable went
 * missing, which is worse than the plaintext it replaces. openSecret() always
 * accepts unprefixed legacy plaintext for the same reason, so existing rows
 * keep working and are sealed the next time they are written.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const PREFIX = "enc:v1:";

type Keyring = { activeId: string; keys: Map<string, CryptoKey> };

let cached: { spec: string; ring: Promise<Keyring | null> } | null = null;

function keySpec(): string {
  const many = (process.env["TOKEN_ENCRYPTION_KEYS"] ?? "").trim();
  if (many) return many;
  const one = (process.env["TOKEN_ENCRYPTION_KEY"] ?? "").trim();
  return one ? `k1:${one}` : "";
}

function toB64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Accepts both base64url and standard base64, with or without padding. */
function fromB64(value: string): Uint8Array<ArrayBuffer> {
  const normal = value.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(normal + "=".repeat((4 - (normal.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function additionalData(keyId: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(`flas-secret:v1:${keyId}`);
  const out = new Uint8Array(new ArrayBuffer(encoded.length));
  out.set(encoded);
  return out;
}

async function keyring(): Promise<Keyring | null> {
  const spec = keySpec();
  if (cached && cached.spec === spec) return cached.ring;
  const ring = (async (): Promise<Keyring | null> => {
    if (!spec) return null;
    const keys = new Map<string, CryptoKey>();
    let activeId = "";
    for (const part of spec
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)) {
      const colon = part.indexOf(":");
      if (colon <= 0) {
        throw new Error("TOKEN_ENCRYPTION_KEYS must be id:base64key pairs separated by commas.");
      }
      const id = part.slice(0, colon).trim();
      if (!/^[A-Za-z0-9_-]{1,32}$/.test(id)) {
        throw new Error(`Encryption key id "${id}" may only use letters, digits, - and _.`);
      }
      const raw = fromB64(part.slice(colon + 1).trim());
      if (raw.length !== 32) {
        throw new Error(
          `Encryption key "${id}" must be 32 bytes (the base64 of 32 random bytes); it is ${raw.length}.`,
        );
      }
      keys.set(
        id,
        await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
          "encrypt",
          "decrypt",
        ]),
      );
      if (!activeId) activeId = id;
    }
    return keys.size ? { activeId, keys } : null;
  })();
  cached = { spec, ring };
  return ring;
}

/** True when a stored value is ciphertext produced by sealSecret(). */
export function isSealed(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

/** Whether a usable key is configured. A malformed key reads as not configured. */
export async function encryptionConfigured(): Promise<boolean> {
  try {
    return (await keyring()) !== null;
  } catch {
    return false;
  }
}

/**
 * Seals a credential for storage. Empty stays empty, an already-sealed value
 * is returned as it is, and with no key configured the value is unchanged.
 */
export async function sealSecret(plain: string | null | undefined): Promise<string | null> {
  if (plain === null || plain === undefined || plain === "") return null;
  if (isSealed(plain)) return plain;
  const ring = await keyring();
  if (!ring) return plain;
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: additionalData(ring.activeId) },
      ring.keys.get(ring.activeId)!,
      new TextEncoder().encode(plain),
    ),
  );
  return `${PREFIX}${ring.activeId}:${toB64Url(iv)}:${toB64Url(ciphertext)}`;
}

/**
 * Opens a stored credential. Legacy plaintext passes through unchanged.
 *
 * Throws -- never returns the ciphertext -- when the value cannot be opened:
 * a provider handed an unreadable token fails later with an error that points
 * nowhere near the cause.
 */
export async function openSecret(stored: string | null | undefined): Promise<string | null> {
  if (stored === null || stored === undefined || stored === "") return null;
  if (!isSealed(stored)) return stored;
  const [keyId, ivPart, ctPart, ...rest] = stored.slice(PREFIX.length).split(":");
  if (!keyId || !ivPart || !ctPart || rest.length) {
    throw new Error("A stored credential is not in the expected encrypted format.");
  }
  const key = (await keyring())?.keys.get(keyId);
  if (!key) {
    throw new Error(
      `A stored credential was encrypted with key "${keyId}", which is not configured in TOKEN_ENCRYPTION_KEYS. Add that key back to read it; reconnecting the account also replaces it.`,
    );
  }
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(ivPart), additionalData: additionalData(keyId) },
      key,
      fromB64(ctPart),
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error(
      "A stored credential could not be decrypted: it was altered, or the key with its id was changed. Reconnect the account.",
    );
  }
}

export type SealReport = {
  /** Whether a key is configured; nothing is sealed without one. */
  configured: boolean;
  /** Values still stored in plaintext (before this run, when dryRun). */
  plaintext: number;
  /** Values already sealed before this run. */
  alreadySealed: number;
  /** Values this run sealed. Zero on a dry run. */
  sealedNow: number;
};

/**
 * Seals every credential of one workspace still stored in plaintext.
 *
 * Each value is proven to open back to the original before it is written, no
 * value is ever logged, and running it twice changes nothing the second time.
 * `dryRun` only counts.
 */
export async function sealTenantSecrets(
  tenantId: string,
  options: { dryRun?: boolean } = {},
): Promise<SealReport> {
  const configured = await encryptionConfigured();
  const report: SealReport = { configured, plaintext: 0, alreadySealed: 0, sealedNow: 0 };

  const [{ data: accounts }, { data: apps }] = await Promise.all([
    supabaseAdmin
      .from("social_accounts")
      .select("id, access_token, refresh_token")
      .eq("tenant_id", tenantId),
    supabaseAdmin.from("platform_apps").select("id, client_secret").eq("tenant_id", tenantId),
  ]);

  const seal = async (value: string | null): Promise<string | null> => {
    if (!value) return null;
    if (isSealed(value)) {
      report.alreadySealed++;
      return null;
    }
    report.plaintext++;
    if (!configured || options.dryRun) return null;
    const sealed = await sealSecret(value);
    if (!sealed || (await openSecret(sealed)) !== value) {
      throw new Error("Sealing check failed; nothing further was written.");
    }
    return sealed;
  };

  for (const row of accounts ?? []) {
    const access = await seal(row.access_token);
    const refresh = await seal(row.refresh_token);
    if (access || refresh) {
      const { error } = await supabaseAdmin
        .from("social_accounts")
        .update({
          ...(access ? { access_token: access } : {}),
          ...(refresh ? { refresh_token: refresh } : {}),
        })
        .eq("id", row.id)
        .eq("tenant_id", tenantId);
      if (error) throw new Error(`Could not store a sealed credential: ${error.message}`);
      report.sealedNow += (access ? 1 : 0) + (refresh ? 1 : 0);
    }
  }

  for (const row of apps ?? []) {
    const secret = await seal(row.client_secret);
    if (secret) {
      const { error } = await supabaseAdmin
        .from("platform_apps")
        .update({ client_secret: secret })
        .eq("id", row.id)
        .eq("tenant_id", tenantId);
      if (error) throw new Error(`Could not store a sealed app secret: ${error.message}`);
      report.sealedNow++;
    }
  }

  return report;
}
