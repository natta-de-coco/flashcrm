/**
 * The Health report's line about stored credentials. The encryption key is
 * FLAS's own server configuration, so only FLAS staff are told which setting is
 * missing; a company is told it is being handled and that it has nothing to do.
 */
export function credentialsNote(
  credentials: { configured: boolean; plaintext: number },
  forStaff: boolean,
): string {
  if (!credentials.configured)
    return forStaff
      ? "Stored credentials are not encrypted: add TOKEN_ENCRYPTION_KEYS to the server's secrets."
      : "Stored credentials are not encrypted yet. FLAS is finishing secure storage, so there is nothing you need to do.";
  if (credentials.plaintext > 0)
    return `${credentials.plaintext} stored credential(s) are not encrypted yet.`;
  return "Stored credentials are encrypted.";
}
