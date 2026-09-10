/**
 * The only place social provider tokens are read from or written to storage.
 *
 * Writes are encrypted and fail closed: if the key ring is not configured, a
 * write throws instead of storing plaintext. Reads decrypt the *_enc columns.
 * Legacy plaintext is read only while SOCIAL_TOKEN_ALLOW_PLAINTEXT_READ is
 * "true" -- the migration window between deploying this and running
 * scripts/migrate-social-token-encryption.mjs. Outside that window a row that
 * still holds only plaintext yields no token, and the connection has to be
 * re-authorized, which writes it encrypted.
 */
import {
  TokenCryptoError,
  decryptSecret,
  encryptSecret,
  readKeyRing,
  tokenAad,
} from "@/lib/social-secrets.server";

/** Columns a token read needs. Select these, never `*`. */
export const TOKEN_READ_COLUMNS =
  "access_token_enc, refresh_token_enc, token_key_id, access_token, refresh_token";

/** A column patch that leaves no usable token behind. */
export const CLEARED_TOKEN_COLUMNS = {
  access_token: null,
  refresh_token: null,
  access_token_enc: null,
  refresh_token_enc: null,
  token_key_id: null,
} as const;

export type StoredTokenRow = {
  tenant_id: string;
  platform: string;
  access_token_enc?: string | null;
  refresh_token_enc?: string | null;
  access_token?: string | null;
  refresh_token?: string | null;
};

export type ReadTokens = {
  access: string | null;
  refresh: string | null;
  /** Where the token came from. "legacy_plaintext" only inside the window. */
  source: "encrypted" | "legacy_plaintext" | "none";
};

export function plaintextReadAllowed(env: Record<string, string | undefined> = process.env): boolean {
  return env["SOCIAL_TOKEN_ALLOW_PLAINTEXT_READ"] === "true";
}

/**
 * Encrypts a token pair for storage. The plaintext columns are nulled in the
 * same patch, so writing through here can never leave a copy behind.
 */
export async function encryptTokensForStorage(args: {
  tenantId: string;
  platform: string;
  accessToken: string | null;
  refreshToken: string | null;
}): Promise<{
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_key_id: string;
  access_token: null;
  refresh_token: null;
}> {
  const ring = readKeyRing(); // throws not_configured -> nothing is stored
  return {
    access_token_enc: args.accessToken
      ? await encryptSecret(args.accessToken, tokenAad(args.tenantId, args.platform, "access_token"))
      : null,
    refresh_token_enc: args.refreshToken
      ? await encryptSecret(args.refreshToken, tokenAad(args.tenantId, args.platform, "refresh_token"))
      : null,
    token_key_id: ring.active,
    access_token: null,
    refresh_token: null,
  };
}

export async function readStoredTokens(row: StoredTokenRow): Promise<ReadTokens> {
  if (row.access_token_enc || row.refresh_token_enc) {
    return {
      access: row.access_token_enc
        ? await decryptSecret(row.access_token_enc, tokenAad(row.tenant_id, row.platform, "access_token"))
        : null,
      refresh: row.refresh_token_enc
        ? await decryptSecret(row.refresh_token_enc, tokenAad(row.tenant_id, row.platform, "refresh_token"))
        : null,
      source: "encrypted",
    };
  }
  if ((row.access_token || row.refresh_token) && plaintextReadAllowed()) {
    return { access: row.access_token ?? null, refresh: row.refresh_token ?? null, source: "legacy_plaintext" };
  }
  return { access: null, refresh: null, source: "none" };
}

/** Whether a row holds a token that readStoredTokens would return. No decrypt. */
export function hasStoredToken(row: StoredTokenRow): boolean {
  if (row.access_token_enc) return true;
  return Boolean(row.access_token) && plaintextReadAllowed();
}

export { TokenCryptoError };
