/*
 * Input schema for manually connecting a social account.
 *
 * Kept out of social.functions.ts so it can be asserted directly: that module
 * imports createServerFn, which drags in the TanStack Start entry points and
 * cannot be bundled for a plain node test. A live QA pass found the endpoint
 * still accepted an empty access token after the form had been fixed, which is
 * exactly the kind of gap a schema test closes for good.
 */
import { z } from "zod";

export const PLATFORMS = [
  "instagram",
  "facebook",
  "youtube",
  "twitter",
  "linkedin",
  "tiktok",
  "google_business",
] as const;

export const ConnectSchema = z.object({
  platform: z.enum(PLATFORMS),
  label: z.string().min(2).max(80),
  // TikTok resolves the account from the token, so an id is genuinely optional
  // at this layer; the form requires it for every other platform.
  externalId: z.string().max(200).optional(),
  // Required, and non-empty after trimming. `.optional()` with no minimum let
  // "" through, so the server stored an account with no credential -- it
  // listed as connected and failed on first sync. The form guards this too;
  // this is the guard that cannot be bypassed by calling the endpoint.
  accessToken: z.string().trim().min(1, "An access token is required.").max(2000),
});
