/*
 * Checking that a platform app's ID and secret are the ones the provider knows,
 * without a customer login and without changing anything.
 *
 * Why this is not just "try connecting": a wrong secret only shows up at the
 * very end of an OAuth round trip, in a provider error page the customer sees
 * and the administrator does not. This asks the provider directly.
 *
 * What it must never do:
 * - keep, log or return anything the provider hands back. Meta's
 *   client_credentials call returns a real app access token; it is dropped
 *   without being read.
 * - guess. A provider response that is not on the documented list below is
 *   reported as inconclusive rather than turned into a confident "your keys are
 *   wrong", which would send an administrator to re-copy a working secret.
 * - have side effects. The authorization-code probe deliberately sends an
 *   invalid code, so the only possible outcome is a refusal.
 */
import { applyClientCredentials, PROVIDERS, tokenEndpointHeaders } from "@/lib/oauth.server";
import type { OAuthProviderId } from "@/lib/connection-problem";

/** passed = the provider accepted the app keys. failed = it refused them. */
export type CredentialTestStatus = "passed" | "failed" | "inconclusive";

export type CredentialTestResult = {
  provider: OAuthProviderId;
  status: CredentialTestStatus;
  /** The provider's HTTP status, for administrators. Null when it was unreachable. */
  httpStatus: number | null;
  /**
   * The provider's own error code, only ever one of the documented values in
   * DOCUMENTED_ERRORS. Never free text from a provider, so nothing it says can
   * carry a credential into a log.
   */
  providerErrorCode: string | null;
  /** Plain English, written here rather than taken from the provider. */
  message: string;
  testedAt: string;
};

/**
 * OAuth 2.0 (RFC 6749 §5.2) token-endpoint error codes, and what each one
 * proves about the *client credentials* specifically.
 *
 * - invalid_client: "Client authentication failed". The keys were refused.
 * - invalid_grant: the authorization code was rejected *after* the client
 *   authenticated -- which is exactly what our deliberately invalid code
 *   should produce when the keys are good.
 *
 * Everything else -- unauthorized_client, invalid_request, unsupported_grant_type,
 * invalid_scope, a provider-specific code, or an unparseable body -- says
 * something about the request or the app's configuration rather than about
 * whether the secret is correct, so it is inconclusive.
 *
 * NEEDS_MANUAL_VERIFICATION: provider-specific codes (TikTok, Pinterest and X
 * each publish their own beyond the RFC set) are intentionally not encoded
 * here. Add one only with a link to the provider's own documentation.
 */
const CREDENTIALS_REFUSED = "invalid_client";
const CREDENTIALS_ACCEPTED = "invalid_grant";
const DOCUMENTED_ERRORS = [CREDENTIALS_REFUSED, CREDENTIALS_ACCEPTED] as const;

/** Meta refuses bad app credentials with this error type. */
const META_OAUTH_EXCEPTION = "OAuthException";

/** A code the provider actually sent, if it is one we can reason about. */
function documentedError(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return (DOCUMENTED_ERRORS as readonly string[]).includes(normalized) ? normalized : null;
}

/** A code on the deliberately invalid probe. Long enough to be well-formed, invalid everywhere. */
const INVALID_CODE = "flas-credential-check-invalid-code";

const TIMEOUT_MS = 8000;

function result(
  provider: OAuthProviderId,
  status: CredentialTestStatus,
  httpStatus: number | null,
  providerErrorCode: string | null,
  message: string,
): CredentialTestResult {
  return {
    provider,
    status,
    httpStatus,
    providerErrorCode,
    message,
    testedAt: new Date().toISOString(),
  };
}

/** Reads a JSON body without letting a huge or malformed one throw. */
async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await response.json();
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Meta: the app access token grant. Success proves the ID and secret are a real
 * pair. The token that comes back is an app token -- it is never read, stored,
 * logged or returned.
 */
async function testMeta(id: string, secret: string, name: string): Promise<CredentialTestResult> {
  const url = `https://graph.facebook.com/oauth/access_token?${new URLSearchParams({
    client_id: id,
    client_secret: secret,
    grant_type: "client_credentials",
  }).toString()}`;
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await readJson(response);
  if (response.ok && typeof body["access_token"] === "string") {
    // Deliberately not captured. Nothing downstream may see this value.
    return result("meta", "passed", response.status, null, `${name} accepted these app keys.`);
  }
  const error = (body["error"] ?? null) as { type?: unknown; code?: unknown } | null;
  if (response.status === 401 || error?.type === META_OAUTH_EXCEPTION) {
    const code =
      typeof error?.code === "number" ? `OAuthException:${error.code}` : META_OAUTH_EXCEPTION;
    return result(
      "meta",
      "failed",
      response.status,
      code,
      `${name} refused these app keys. Check the App ID and App Secret in the Meta app dashboard.`,
    );
  }
  return result(
    "meta",
    "inconclusive",
    response.status,
    null,
    `${name} answered, but not in a way that proves whether the keys are right. Try again shortly.`,
  );
}

/**
 * Everyone else: the documented authorization-code exchange with a code that
 * cannot be valid, sent with the same client authentication style the real
 * exchange uses (form body, or HTTP Basic for X and Pinterest), so this tests
 * the credentials the way they are actually presented.
 */
async function testAuthorizationCode(
  provider: OAuthProviderId,
  id: string,
  secret: string,
  redirectUri: string,
  name: string,
): Promise<CredentialTestResult> {
  const config = PROVIDERS[provider];
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: INVALID_CODE,
    redirect_uri: redirectUri,
  });
  applyClientCredentials(body, provider, id, secret);

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: tokenEndpointHeaders(provider, id, secret),
    body: body.toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const parsed = await readJson(response);
  // TikTok answers with the error alongside the data envelope; both are read
  // the same way because only the code matters.
  const data = (parsed["data"] ?? null) as Record<string, unknown> | null;
  const code = documentedError(parsed["error"]) ?? documentedError(data?.["error"]);

  if (code === CREDENTIALS_ACCEPTED) {
    return result(
      provider,
      "passed",
      response.status,
      code,
      `${name} accepted these app keys -- it rejected only the test code, which is what should happen.`,
    );
  }
  if (code === CREDENTIALS_REFUSED || response.status === 401) {
    return result(
      provider,
      "failed",
      response.status,
      code ?? "http_401",
      `${name} refused these app keys. Re-copy the client ID and secret from the ${name} app dashboard.`,
    );
  }
  return result(
    provider,
    "inconclusive",
    response.status,
    null,
    `${name} answered, but not in a way that proves whether the keys are right. Check the app's redirect URI and try again.`,
  );
}

/**
 * Asks the provider whether these app keys are real.
 *
 * Never throws: a provider that is unreachable, slow or answering nonsense is
 * an inconclusive result, not an error the caller has to handle.
 */
export async function testProviderCredentials(args: {
  provider: OAuthProviderId;
  id: string;
  secret: string;
  /** The real redirect URI, so the probe matches the exchange that will follow. */
  redirectUri: string;
  name: string;
}): Promise<CredentialTestResult> {
  try {
    if (args.provider === "meta") return await testMeta(args.id, args.secret, args.name);
    return await testAuthorizationCode(
      args.provider,
      args.id,
      args.secret,
      args.redirectUri,
      args.name,
    );
  } catch {
    // The reason is deliberately not echoed: a fetch failure can quote the URL
    // it was given, and for Meta that URL carries the app secret.
    return result(
      args.provider,
      "inconclusive",
      null,
      null,
      `Flas could not reach ${args.name} to check these keys. Try again shortly.`,
    );
  }
}
