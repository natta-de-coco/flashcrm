// Two-factor sign-in on the server: a session that has only given its password
// may not call a server function when its account has a verified second factor.
//
// requireSupabaseAuth (generated, not ours to edit) only proves the token is
// genuine, and the token says its assurance level but not whether the account
// has a factor. So for a token that does not say aal2 this asks the Auth
// service. It runs from the global sessionGuard middleware, which Start puts
// in front of every server function, so one call here covers all of them and
// any added later.
//
// Name ends in `.server` so the Start compiler keeps it out of the browser bundle.
import {
  hasVerifiedTotp,
  tokenClaims,
  TWO_FACTOR_REQUIRED,
  TWO_FACTOR_UNCHECKED,
} from "./two-factor";

/**
 * THE DECISION FOR THE PROJECT MANAGER: what happens when this check cannot find
 * out whether the account has two-factor (Auth slow, down, rate-limiting us, or
 * answering nonsense).
 *
 *   "refuse"  The call is refused with "could not check, try again" and nobody
 *             is signed out. Nothing is let in on a failed check, with ONE
 *             exception: a person Auth itself confirmed, in the last ten
 *             minutes, has no second factor keeps that answer while the lookup
 *             fails (see ALLOWANCE_MS), so a slow Auth is not an outage for
 *             everybody. Anybody Auth has not confirmed is refused.
 *             (Recommended.)
 *   "allow"   The call goes through and the failure is logged. A password-only
 *             session of an account WITH two-factor gets in whenever the check
 *             fails, and if the check breaks for good nobody notices.
 *
 * This is the only line that decides it. A token Auth says is dead (401, 403,
 * 404) is always refused, whatever this says.
 */
export const WHEN_THE_CHECK_FAILS = "refuse" as "refuse" | "allow";

/** What a token Auth no longer vouches for is told. session-guard turns it into the usual "sign in again". */
const SESSION_GONE = "Unauthorized: this session is no longer valid.";

/**
 * The server functions that are public on purpose (no sign-in needed), as
 * `file#name`: the project-relative file the compiler gives each one, and its
 * exported name. Both must match, so a protected function that borrows a public
 * name in another file is still checked. Anything not listed is checked, so a
 * new function is protected unless somebody lists it here on purpose.
 * tests/two-factor-server.test.mjs checks this list against the source.
 */
export const OPEN_SERVER_FUNCTIONS: readonly string[] = [
  "src/lib/homepage-widget.functions.ts#getHomepageWidgetKey",
  "src/lib/otp-resend.functions.ts#resendVerification",
  "src/lib/public-billing.functions.ts#getPublicDocument",
  "src/lib/public-billing.functions.ts#claimDocumentPayment",
  "src/lib/public-billing.functions.ts#verifyDocument",
  "src/lib/telemetry.functions.ts#reportErrorEvent",
  // The link in a marketing email: the reader is usually not signed in, and
  // must still be able to unsubscribe when they happen to be.
  "src/routes/unsubscribe.tsx#processUnsubscribeFn",
  "src/utils/payments.functions.ts#resolvePaddlePrice",
];

type FunctionMeta = { name?: unknown; filename?: unknown } | null | undefined;

function isOpen(meta: FunctionMeta): boolean {
  const name = meta?.name;
  const filename = meta?.filename;
  if (typeof name !== "string" || typeof filename !== "string") return false;
  // The compiler writes the path with the separators of the machine that built it.
  const file = filename.split("\\").join("/");
  return OPEN_SERVER_FUNCTIONS.some((entry) => {
    const [listedFile, listedName] = entry.split("#");
    return (
      listedName === name &&
      listedFile !== undefined &&
      (file === listedFile || file.endsWith(`/${listedFile}`))
    );
  });
}

/** How long the lookup may take before it counts as "could not check". */
const LOOKUP_LIMIT_MS = 5_000;
/**
 * The same, for a person who has an allowance to fall back on (below): nothing
 * is gained by making them wait the full time for an answer that is not needed.
 */
const LOOKUP_LIMIT_WITH_ALLOWANCE_MS = 2_000;

/**
 * The answer "this account has no verified second factor", remembered per user
 * so that someone without two-factor (everyone who has not set it up) costs one
 * lookup a minute, not one per click.
 *
 *  - For ANSWER_LIFE_MS the answer is used without asking.
 *  - For ALLOWANCE_MS from Auth's answer it is also used when, and only when,
 *    the lookup FAILS (Auth slow, down, rate-limiting, or answering with
 *    something that is not about this session). Using it does not renew it;
 *    only an answer from Auth does.
 *  - Only "no second factor" is remembered. A refusal never is, and an old
 *    answer is dropped the moment Auth shows the account has a factor, or a call
 *    arrives that has entered a code (see noteCodeWasEntered), so a lost factor
 *    removed by the owner works on the person's very next sign-in and a newly
 *    added one is not waved past.
 *  - It is keyed by the user id Auth itself returned, never by the id inside the
 *    token alone, so nobody can use another person's answer.
 *  - Nothing is shared between simultaneous calls: a request that reuses a
 *    lookup another request started is something the Cloudflare Workers
 *    runtime may refuse, so a busy first minute costs more lookups instead.
 *  - It lives in this server instance's memory: per instance, best effort, and
 *    losing it only costs one more lookup.
 */
const ANSWER_LIFE_MS = 60_000;
const ALLOWANCE_MS = 10 * 60_000;
const MOST_REMEMBERED = 2_000;
const hasNoSecondFactor = new Map<string, number>(); // user id -> when Auth said so

function ageOf(userId: string, now: number): number | null {
  const since = hasNoSecondFactor.get(userId);
  if (since === undefined) return null;
  const age = now - since;
  return age >= 0 ? age : null; // a clock that went backwards remembers nothing
}

function isRemembered(userId: string, now: number): boolean {
  const age = ageOf(userId, now);
  return age !== null && age < ANSWER_LIFE_MS;
}

/** Auth confirmed "no second factor" recently enough to fall back on when it cannot be asked. */
function hasAllowance(userId: string, now: number): boolean {
  const age = ageOf(userId, now);
  return age !== null && age < ALLOWANCE_MS;
}

function remember(userId: string, now: number): void {
  // Delete first so the map stays in the order the answers were given.
  hasNoSecondFactor.delete(userId);
  if (hasNoSecondFactor.size >= MOST_REMEMBERED) {
    for (const [id, since] of hasNoSecondFactor) {
      if (now - since >= 0 && now - since < ALLOWANCE_MS) break; // the rest are younger
      hasNoSecondFactor.delete(id);
    }
    // Nobody had run out: make room by dropping the one remembered longest.
    const oldest = hasNoSecondFactor.keys().next();
    if (hasNoSecondFactor.size >= MOST_REMEMBERED && !oldest.done) {
      hasNoSecondFactor.delete(oldest.value);
    }
  }
  hasNoSecondFactor.set(userId, now);
}

type Lookup = { kind: "user"; id: unknown; factors: unknown } | { kind: "unknown"; reason: string };

/**
 * Is this the Auth service itself saying the session is gone? Its errors carry
 * an `error_code` (newer versions) or a numeric `code` with a `msg` (older
 * ones). The gateway in front of it speaks differently (`{ "message": "Invalid
 * API key" }`), and a proxy's error page is not JSON at all: neither says
 * anything about this person's session, so neither may be told to them as
 * "your session has expired".
 */
function authSaysSessionIsGone(body: unknown): boolean {
  if (body === null || typeof body !== "object") return false;
  const { error_code: errorCode, code, msg } = body as Record<string, unknown>;
  return typeof errorCode === "string" || (typeof code === "number" && typeof msg === "string");
}

/** Asks Auth who this token belongs to, with the caller's own token. Throws only for a token Auth says is dropped. */
async function lookUpUser(token: string, limitMs: number): Promise<Lookup> {
  const base = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!base || !key) return { kind: "unknown", reason: "the project address or key is not set" };

  // Patience for the whole exchange, answer included: a lookup that hangs must
  // end in a refusal, not hold the request open.
  const limit = new AbortController();
  const timer = setTimeout(() => limit.abort(), limitMs);
  let body: unknown;
  try {
    let response: Response;
    try {
      response = await fetch(`${base.replace(/\/+$/, "")}/auth/v1/user`, {
        headers: { apikey: key, Authorization: `Bearer ${token}` },
        signal: limit.signal,
      });
    } catch {
      return {
        kind: "unknown",
        reason: limit.signal.aborted ? "Auth took too long" : "Auth could not be reached",
      };
    }

    // Signed out, session gone, or user deleted. requireSupabaseAuth checks the
    // token's signature on this machine and would still accept it until it
    // expires, so this must refuse here: otherwise "sign in with the password,
    // sign out, keep the token" would dodge the check. But only when Auth ITSELF
    // says so: a 401 from the gateway (a wrong or rotated project key) is a
    // failure to check, not a dead session, and signing in again would not help.
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      let about: unknown = null;
      try {
        about = await response.json();
      } catch {
        /* not JSON: a proxy's page, not Auth's answer */
      }
      if (authSaysSessionIsGone(about)) throw new Error(SESSION_GONE);
      return {
        kind: "unknown",
        reason: `Auth answered ${response.status} in a way that is not about the session`,
      };
    }
    if (response.status !== 200) {
      return { kind: "unknown", reason: `Auth answered ${response.status}` };
    }

    try {
      body = await response.json();
    } catch {
      return {
        kind: "unknown",
        reason: limit.signal.aborted ? "Auth took too long" : "Auth's answer was not readable",
      };
    }
  } finally {
    clearTimeout(timer);
  }
  const outer =
    body !== null && typeof body === "object" ? (body as Record<string, unknown>) : null;
  // Some versions of the service wrap the user as { user: {...} }.
  const inner = outer?.["user"];
  const user =
    inner !== null && typeof inner === "object" ? (inner as Record<string, unknown>) : outer;
  if (!user) return { kind: "unknown", reason: "Auth's answer was not a user" };
  return { kind: "user", id: user["id"], factors: user["factors"] };
}

/** The single place the decision above is applied. */
function theCheckFailed(reason: string, userId: string, hasAnswerToFallBackOn = false): void {
  if (WHEN_THE_CHECK_FAILS === "allow") {
    console.warn(
      `[two-factor] could not check (${reason}) user=${userId} - letting the call through`,
    );
    return;
  }
  if (hasAnswerToFallBackOn) {
    console.warn(
      `[two-factor] could not check (${reason}) user=${userId} - letting the call through on Auth's answer from the last ten minutes`,
    );
    return;
  }
  console.warn(`[two-factor] could not check (${reason}) user=${userId} - refusing the call`);
  throw new Error(TWO_FACTOR_UNCHECKED);
}

/**
 * Throws if this call comes from a session that still owes its second factor
 * (or if it cannot be told), and returns quietly otherwise. It only ever adds
 * a refusal: whatever it returns for, requireSupabaseAuth still has its say.
 */
export async function enforceSecondFactor({
  request,
  serverFnMeta,
}: {
  request: Request | undefined;
  serverFnMeta: FunctionMeta;
}): Promise<void> {
  // 1. Public on purpose.
  if (isOpen(serverFnMeta)) return;

  // 2. Not a well-formed bearer token: requireSupabaseAuth refuses it, or the
  //    function is not one that needs a sign-in.
  const header = request?.headers?.get("authorization") ?? "";
  const token = /^Bearer ([^\s.]+\.[^\s.]+\.[^\s.]+)$/.exec(header)?.[1];
  if (!token) return;

  // 3. A token that names nobody, or has expired, is refused downstream.
  const claims = tokenClaims(token);
  const userId = claims?.["sub"];
  if (!claims || typeof userId !== "string" || userId === "") return;
  const expires = claims["exp"];
  if (typeof expires === "number" && expires <= Date.now() / 1000) return;

  // 4. The code was entered. (The signature is still checked downstream.)
  if (claims["aal"] === "aal2") return;

  // 5. Password only. Auth said a minute ago that this account has no second factor?
  if (isRemembered(userId, Date.now())) return;

  // 6. Ask: does this account have a verified second factor?
  const hasAllowanceNow = hasAllowance(userId, Date.now());
  const found = await lookUpUser(
    token,
    hasAllowanceNow ? LOOKUP_LIMIT_WITH_ALLOWANCE_MS : LOOKUP_LIMIT_MS,
  );
  // Could not find out. Somebody Auth confirmed has no second factor in the last
  // ten minutes keeps that answer; everybody else is refused.
  if (found.kind === "unknown") return theCheckFailed(found.reason, userId, hasAllowanceNow);
  // Auth must be describing this very user, or its answer says nothing about them
  // (and that is not "Auth is slow", so it gets no allowance).
  // (Remembered under the id Auth returned, which is this one.)
  if (found.id !== userId) return theCheckFailed("Auth described another user", userId);
  if (hasVerifiedTotp(found.factors)) {
    // Whatever was remembered about this account is out of date.
    hasNoSecondFactor.delete(userId);
    throw new Error(TWO_FACTOR_REQUIRED);
  }
  remember(found.id, Date.now());
}

/**
 * Call after a server function has run for this request. A token that entered
 * its code (aal2) means the account has a verified second factor, so any
 * remembered "no second factor" answer about it is out of date and goes at once.
 * That is how a factor switched on through the app takes effect on this server
 * without waiting for the answer to age out.
 *
 * It runs only after the call succeeded, because that is when the token's
 * signature has been checked: a token somebody forged must not be able to wipe
 * another person's answer. A public function never checks a signature, so it
 * never counts.
 */
export function noteCodeWasEntered({
  request,
  serverFnMeta,
}: {
  request: Request | undefined;
  serverFnMeta: FunctionMeta;
}): void {
  if (isOpen(serverFnMeta)) return;
  const header = request?.headers?.get("authorization") ?? "";
  const token = /^Bearer ([^\s.]+\.[^\s.]+\.[^\s.]+)$/.exec(header)?.[1];
  if (!token) return;
  const claims = tokenClaims(token);
  const userId = claims?.["sub"];
  if (claims?.["aal"] === "aal2" && typeof userId === "string") hasNoSecondFactor.delete(userId);
}
