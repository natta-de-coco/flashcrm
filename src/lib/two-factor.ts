// The one rule for two-factor sign-in: does this session still owe a code?
//
// Two-factor used to be a step inside the sign-in form, so every other place
// that asks "is this person signed in?" (the sign-in page's redirect, the
// signed-in layout, every server function) only asked whether a session
// exists. The password step creates a session at once, so all of them let a
// password-only session in. They now ask this instead.
//
// A session owes a second factor when BOTH are true:
//   1. its access token does not carry `aal: "aal2"` (a missing, unreadable or
//      differently-shaped claim counts as "not aal2"), and
//   2. its user has a verified authenticator-app (TOTP) factor.
//
// Only an authenticator app counts, because it is the only kind this app can
// enrol or ask for. Counting a kind the page cannot ask for would lock the
// person out with no way forward.
//
// The token is decoded here WITHOUT checking its signature. That is safe
// because the answer is only ever used to decide to refuse or to show the code
// prompt; nothing is let in on the strength of it. The server still has the
// token's signature checked (requireSupabaseAuth) before any work is done.
//
// This file imports nothing, so the browser and the server can both use it.

/** The part of a Supabase session this rule reads (structural, so no import is needed). */
export type SessionLike = {
  access_token?: unknown;
  user?: { factors?: unknown } | null;
};

/** What the server says when a password-only session of a two-factor account calls it. */
export const TWO_FACTOR_REQUIRED =
  "Two-factor code required. Enter the code from your authenticator app to continue.";

/** What the server says when it could not find out whether the account has two-factor. */
export const TWO_FACTOR_UNCHECKED =
  "Could not check your sign-in security. Please try again in a moment.";

type Claims = Record<string, unknown>;

/**
 * The payload of a token, or null. No signature check, never throws.
 * Anything that is not three dot-separated parts with a JSON object in the
 * middle is "no claims".
 */
export function tokenClaims(token: unknown): Claims | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const middle = parts[1];
  if (!middle) return null;
  try {
    const base64 = middle.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const value: unknown = JSON.parse(atob(padded));
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Claims)
      : null;
  } catch {
    return null;
  }
}

/** "aal1" or "aal2" exactly as the token says it, otherwise null (never a guess). */
export function assuranceLevelOf(accessToken: unknown): "aal1" | "aal2" | null {
  const level = tokenClaims(accessToken)?.["aal"];
  return level === "aal1" || level === "aal2" ? level : null;
}

/** The verified authenticator-app factors in a user's factor list. */
function verifiedTotpFactors(factors: unknown): Claims[] {
  if (!Array.isArray(factors)) return [];
  return factors.filter((factor): factor is Claims => {
    if (factor === null || typeof factor !== "object") return false;
    const { status, factor_type: kind } = factor as Claims;
    // A factor that does not say what kind it is counts as an authenticator
    // app, so an unknown shape errs toward asking for a code.
    return status === "verified" && (kind === undefined || kind === null || kind === "totp");
  });
}

/** True when the list holds a verified authenticator-app factor. Unverified ones (half-finished set-up) do not count. */
export function hasVerifiedTotp(factors: unknown): boolean {
  return verifiedTotpFactors(factors).length > 0;
}

/** The factor the code form asks about: the first verified authenticator app, or null. */
export function verifiedTotpFactorId(session: SessionLike | null | undefined): string | null {
  const id = verifiedTotpFactors(session?.user?.factors)[0]?.["id"];
  return typeof id === "string" ? id : null;
}

/** True when this session got in with a password (or a link) and still owes the code its account asks for. */
export function sessionOwesSecondFactor(session: SessionLike | null | undefined): boolean {
  if (!session) return false;
  if (assuranceLevelOf(session.access_token) === "aal2") return false;
  return hasVerifiedTotp(session.user?.factors);
}

function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error !== null && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

/** Did the server refuse because the code has not been entered? */
export function isTwoFactorRequired(error: unknown): boolean {
  return messageOf(error).includes(TWO_FACTOR_REQUIRED);
}

/** Did the server refuse because it could not find out? */
export function isTwoFactorUnchecked(error: unknown): boolean {
  return messageOf(error).includes(TWO_FACTOR_UNCHECKED);
}

/**
 * Did Auth refuse to change a password or e-mail because the session has not
 * entered its second-factor code? Auth answers 401 with the error code
 * `insufficient_aal` ("AAL2 session is required to update email or password
 * when MFA is enabled"). Matched on the code, with the wording as a fallback for
 * a version that does not send the code.
 */
export function isCodeRequiredFirst(error: unknown): boolean {
  if (error !== null && typeof error === "object") {
    if ((error as { code?: unknown }).code === "insufficient_aal") return true;
  }
  return /\baal2 session is required\b/i.test(messageOf(error));
}
