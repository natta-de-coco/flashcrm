/*
 * Legacy manual-social input schema.
 *
 * Social channels must be connected through the provider OAuth flow under
 * Connect & setup. Keeping a browser endpoint that accepts bearer/access
 * tokens trains operators to copy live credentials around and bypasses the
 * server-owned consent, scope validation and target-selection flow.
 *
 * The old UI may still import this schema while it is being removed, so keep
 * the export stable but reject every attempt with a clear migration message.
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

export const ConnectSchema = z
  .object({
    platform: z.enum(PLATFORMS),
    label: z.string().min(2).max(80),
    externalId: z.string().max(200).optional(),
    accessToken: z.string().max(2000).optional(),
  })
  .superRefine((_value, ctx) => {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["accessToken"],
      message:
        "Manual social-token connections are disabled. Use Connect & setup so the provider handles sign-in, consent and permissions securely.",
    });
  });
