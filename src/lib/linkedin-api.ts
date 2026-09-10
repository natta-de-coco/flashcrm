/**
 * LinkedIn's versioned REST API, YYYYMM. Versions are sunset about a year after
 * release: Flas sent "202405" long after it was retired, so every LinkedIn call
 * was refused. Verified 2026-09-11 against Microsoft's docs, which list 2025-08
 * through 2026-08 as supported and 2026-08 as the default -- and note that even
 * 202508 sunsets on 17 August 2026. Bump this before it lapses.
 */
export const LINKEDIN_API_VERSION = "202608";

/** Headers every LinkedIn REST call needs. */
export function linkedInHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "LinkedIn-Version": LINKEDIN_API_VERSION,
    "X-Restli-Protocol-Version": "2.0.0",
  };
}
