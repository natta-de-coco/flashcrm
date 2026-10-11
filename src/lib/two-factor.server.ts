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
 *             is signed out. Nothing is let in on a failed check. While Auth is
 *             failing, people WITHOUT two-factor cannot use server functions
 *             either, once their remembered answer runs out. (Recommended.)
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
 * The answer "this account has no verified second factor", remembered per user
 * for a minute so that someone without two-factor (everyone who has not set it
 * up) costs one lookup a minute, not one per click.
 *
 *  - Only that answer is remembered. A refusal never is, so a lost factor
 *    removed by the owner works on the person's very next sign-in; neither is a
 *    failure to check.
 *  - It is keyed by the user id Auth itself returned, never by the id inside the
 *    token alone.
 *  - Nothing is shared between simultaneous calls: a request that reuses a
 *    lookup another request started is something the Cloudflare Workers
 *    runtime may refuse, so a busy first minute costs more lookups instead.
 *  - It lives in this server instance's memory: per instance, best effort, and
 *    losing it only costs one more lookup.
 */
const ANSWER_LIFE_MS = 60_000;
const MOST_REMEMBERED = 2_000;
const hasNoSecondFactor = new Map<string, number>(); // user id -> when Auth said so

function isRemembered(userId: string, now: number): boolean {
  const since = hasNoSecondFactor.get(userId);
  if (since === undefined) return false;
  const age = now - since;
  return age >= 0 && age < ANSWER_LIFE_MS;
}

function remember(userId: string, now: number): void {
  // Delete first so the map stays in the order the answers were given.
  hasNoSecondFactor.delete(userId);
  if (hasNoSecondFactor.size >= MOST_REMEMBERED) {
    for (const [id, since] of hasNoSecondFactor) {
      if (now - since >= 0 && now - since < ANSWER_LIFE_MS) break; // the rest are younger
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

/** Asks Auth who this token belongs to, with the caller's own token. Throws only for a token Auth has dropped. */
async function lookUpUser(token: string): Promise<Lookup> {
  const base = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!base || !key) return { kind: "unknown", reason: "the project address or key is not set" };

  // Patience for the whole exchange, answer included: a lookup that hangs must
  // end in a refusal, not hold the request open.
  const limit = new AbortController();
  const timer = setTimeout(() => limit.abort(), LOOKUP_LIMIT_MS);
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
    // sign out, keep the token" would dodge the check.
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      throw new Error(SESSION_GONE);
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
function theCheckFailed(reason: string, userId: string): void {
  if (WHEN_THE_CHECK_FAILS === "allow") {
    console.warn(
      `[two-factor] could not check (${reason}) user=${userId} - letting the call through`,
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
  const found = await lookUpUser(token);
  if (found.kind === "unknown") return theCheckFailed(found.reason, userId);
  // Auth must be describing this very user, or its answer says nothing about them.
  // (Remembered under the id Auth returned, which is this one.)
  if (found.id !== userId) return theCheckFailed("Auth described another user", userId);
  if (hasVerifiedTotp(found.factors)) throw new Error(TWO_FACTOR_REQUIRED);
  remember(found.id, Date.now());
}
