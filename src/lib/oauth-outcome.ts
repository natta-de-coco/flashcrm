/*
 * What a provider's redirect back to FLAS means, in words a person can act on.
 *
 * Pressing Cancel on Facebook's consent screen came back as the same red
 * "Connection failed -- ask an administrator" as a real failure, and an expired
 * sign-in link read exactly the same. The callback now reports which it was as
 * a fixed code, and the screen turns the code into fixed copy. Nothing from the
 * URL is ever shown as text: anyone can craft a link.
 */

/**
 * Provider answers that mean sign-in was stopped before FLAS got access.
 * Meta sends error=access_denied with error_reason=user_denied; Google, TikTok
 * and X send access_denied; LinkedIn sends user_cancelled_login or
 * user_cancelled_authorize.
 */
const CANCELLATION_ERRORS: ReadonlySet<string> = new Set([
  "access_denied",
  "user_cancelled_login",
  "user_cancelled_authorize",
  "user_denied",
]);

export function isUserCancellation(
  error: string | null | undefined,
  reason?: string | null | undefined,
): boolean {
  return (
    CANCELLATION_ERRORS.has((error ?? "").trim().toLowerCase()) ||
    (reason ?? "").trim().toLowerCase() === "user_denied"
  );
}

/** Why a sign-in did not finish, as the callback reports it. */
export type OutcomeCode = "expired" | "incomplete" | "provider_refused";

export function outcomeCopy(
  code: string | null | undefined,
  platform: string,
): { title: string; message: string } {
  switch (code) {
    case "expired":
      return {
        title: "The sign-in link expired",
        message: `Sign-in links work once and only for a few minutes. Start connecting ${platform} again.`,
      };
    case "incomplete":
      return {
        title: "Sign-in was interrupted",
        message: `${platform} did not send back everything FLAS needs. Start connecting again.`,
      };
    case "provider_refused":
      return {
        title: `${platform} did not finish the sign-in`,
        message: `${platform} refused the request. Try again; if it keeps happening, ask your administrator to check the ${platform} app settings.`,
      };
    default:
      return {
        title: "Connection failed",
        message:
          "Sign-in could not be completed. Please try connecting again. If this keeps happening, ask a FLAS administrator to check the connection.",
      };
  }
}
