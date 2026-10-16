// An in-process stand-in for the Supabase HTTP services that sign-in talks to,
// so the real supabase-js client and the real middleware can be driven without
// a network: the Auth endpoints (password sign-in, the signed-in user, token
// refresh, two-factor challenge and verify, sign-out, the signing keys) and the
// two database reads the sign-in code makes.
//
// It issues real ES256 tokens and publishes the matching key, so the server's
// own signature check runs for real -- a token this file did not sign is
// rejected by the code under test, not by the test.
//
// Tests own the accounts and can make any endpoint fail, which is how "the
// lookup could not be made" is exercised.

const b64url = (value) =>
  Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

async function signingKey() {
  return crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
}

async function signWith(key, payload) {
  const head = b64url({ alg: "ES256", typ: "JWT", kid: "fake-key-1" });
  const body = b64url(payload);
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key.privateKey,
    new TextEncoder().encode(`${head}.${body}`),
  );
  return `${head}.${body}.${Buffer.from(signature).toString("base64url")}`;
}

export async function createFakeSupabase({ url = "https://fake-project.supabase.test" } = {}) {
  const real = await signingKey();
  const attacker = await signingKey();
  const publicJwk = {
    ...(await crypto.subtle.exportKey("jwk", real.publicKey)),
    kid: "fake-key-1",
    alg: "ES256",
    use: "sig",
    key_ops: ["verify"],
  };

  const users = new Map();
  const sessions = new Map();
  const issued = new Set();
  const faults = new Map();
  const calls = [];
  const settings = { confirmEmail: false };
  let serial = 0;
  const seconds = () => Math.floor(Date.now() / 1000);

  /** What Auth returns for a user. Like the real service, no `factors` key at all when there are none. */
  function userBody(user) {
    const stamp = "2026-01-01T00:00:00Z";
    return {
      id: user.id,
      aud: "authenticated",
      role: "authenticated",
      email: user.email,
      app_metadata: { provider: "email" },
      user_metadata: {},
      identities: [],
      created_at: stamp,
      updated_at: stamp,
      ...(user.factors.length
        ? {
            factors: user.factors.map((factor) => ({
              id: factor.id,
              friendly_name: "Authenticator app",
              factor_type: factor.type,
              status: factor.status,
              created_at: stamp,
              updated_at: stamp,
            })),
          }
        : {}),
    };
  }

  async function accessToken(session, { expiresIn = 3600 } = {}) {
    serial += 1;
    const token = await signWith(real, {
      iss: `${url}/auth/v1`,
      aud: "authenticated",
      role: "authenticated",
      sub: session.userId,
      email: users.get(session.userId).email,
      session_id: session.id,
      aal: session.aal,
      amr: session.amr,
      iat: seconds(),
      exp: seconds() + expiresIn,
      // Two tokens issued in the same second must still differ.
      jti: `t${serial}`,
    });
    issued.add(token);
    return token;
  }

  async function sessionBody(session) {
    session.refreshToken = `refresh-${(serial += 1)}`;
    return {
      access_token: await accessToken(session),
      token_type: "bearer",
      expires_in: 3600,
      expires_at: seconds() + 3600,
      refresh_token: session.refreshToken,
      user: userBody(users.get(session.userId)),
    };
  }

  function openSession(userId, { aal = "aal1", method = "password" } = {}) {
    serial += 1;
    const session = {
      id: `00000000-0000-4000-8000-${String(serial).padStart(12, "0")}`,
      userId,
      aal,
      amr: [{ method, timestamp: seconds() }],
      refreshToken: null,
    };
    sessions.set(session.id, session);
    return session;
  }

  /** The session behind a bearer token, or the refusal Auth would give. */
  function authenticate(request) {
    const header = request.headers.get("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!issued.has(token))
      return { refusal: json(403, { code: 403, error_code: "bad_jwt", msg: "invalid JWT" }) };
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    if (claims.exp <= seconds())
      return { refusal: json(403, { code: 403, error_code: "bad_jwt", msg: "token is expired" }) };
    const session = sessions.get(claims.session_id);
    if (!session)
      return {
        refusal: json(403, {
          code: 403,
          error_code: "session_not_found",
          msg: "Session from session_id claim in JWT does not exist",
        }),
      };
    return { session, user: users.get(session.userId) };
  }

  async function route(request) {
    const { pathname, searchParams } = new URL(request.url);
    const method = request.method;

    let name = "unknown";
    if (pathname === "/auth/v1/.well-known/jwks.json") name = "jwks";
    else if (pathname === "/auth/v1/user" && method === "GET") name = "user";
    else if (pathname === "/auth/v1/user" && method === "PUT") name = "user:update";
    else if (pathname === "/auth/v1/token") name = `token:${searchParams.get("grant_type")}`;
    else if (pathname === "/auth/v1/logout") name = "logout";
    else if (pathname === "/auth/v1/signup") name = "signup";
    else if (/^\/auth\/v1\/factors\/[^/]+\/challenge$/.test(pathname)) name = "factors:challenge";
    else if (/^\/auth\/v1\/factors\/[^/]+\/verify$/.test(pathname)) name = "factors:verify";
    else if (pathname === "/rest/v1/rpc/access_state") name = "rpc:access_state";
    else if (pathname.startsWith("/rest/v1/")) name = "rest";

    calls.push({
      name,
      method,
      pathname,
      authorization: request.headers.get("authorization"),
      apikey: request.headers.get("apikey"),
    });

    const fault = faults.get(name);
    if (fault?.network) throw new TypeError("fetch failed");
    if (fault?.hang) {
      // Never answers; ends only if the caller gives up.
      return new Promise((_, reject) => {
        request.signal?.addEventListener("abort", () =>
          reject(request.signal.reason ?? new DOMException("aborted", "AbortError")),
        );
      });
    }
    // text: an answer that is not JSON at all (a proxy's error page).
    if (fault?.status && fault.text !== undefined)
      return new Response(fault.text, { status: fault.status });
    if (fault?.status) return json(fault.status, fault.body ?? { msg: "upstream error" });
    if (fault?.garbled) return new Response("<html>bad gateway</html>", { status: 200 });

    if (name === "jwks") return json(200, { keys: [publicJwk] });

    if (name === "user") {
      const who = authenticate(request);
      if (who.refusal) return who.refusal;
      // asUser: the service vouches for the token but describes somebody else.
      const body = userBody(fault?.asUser ? users.get(fault.asUser) : who.user);
      // wrapped: some versions of the service answer { user: {...} }.
      return json(200, fault?.wrapped ? { user: body } : body);
    }

    if (name === "user:update") {
      const who = authenticate(request);
      if (who.refusal) return who.refusal;
      const body = await request.json();
      // Like the real service (supabase/auth internal/api/user.go): an account
      // with a verified second factor may change its password or e-mail only
      // from a session that entered its code. A recovery link gives aal1.
      const hasSecondFactor = who.user.factors.some((factor) => factor.status === "verified");
      if ((body.password || body.email) && hasSecondFactor && who.session.aal !== "aal2")
        return json(401, {
          code: 401,
          error_code: "insufficient_aal",
          msg: "AAL2 session is required to update email or password when MFA is enabled",
        });
      if (body.password) who.user.password = body.password;
      return json(200, userBody(who.user));
    }

    if (name === "token:password") {
      const body = await request.json();
      const user = [...users.values()].find(
        (candidate) => candidate.email === body.email && candidate.password === body.password,
      );
      if (!user)
        return json(400, {
          code: 400,
          error_code: "invalid_credentials",
          msg: "Invalid login credentials",
        });
      return json(200, await sessionBody(openSession(user.id)));
    }

    if (name === "token:refresh_token") {
      const body = await request.json();
      const session = [...sessions.values()].find(
        (candidate) => candidate.refreshToken === body.refresh_token,
      );
      if (!session)
        return json(400, {
          code: 400,
          error_code: "refresh_token_not_found",
          msg: "Invalid Refresh Token: Refresh Token Not Found",
        });
      return json(200, await sessionBody(session));
    }

    if (name === "signup") {
      const body = await request.json();
      const user = {
        id: `30000000-0000-4000-8000-${String((serial += 1)).padStart(12, "0")}`,
        email: body.email,
        password: body.password,
        factors: [],
      };
      users.set(user.id, user);
      // With e-mail confirmation switched on, Auth answers with the user and no session.
      if (settings.confirmEmail) return json(200, userBody(user));
      return json(200, await sessionBody(openSession(user.id)));
    }

    if (name === "logout") {
      const who = authenticate(request);
      if (who.session) sessions.delete(who.session.id);
      return new Response(null, { status: 204 });
    }

    if (name === "factors:challenge") {
      const who = authenticate(request);
      if (who.refusal) return who.refusal;
      return json(200, {
        id: `challenge-${(serial += 1)}`,
        type: "totp",
        expires_at: seconds() + 300,
      });
    }

    if (name === "factors:verify") {
      const who = authenticate(request);
      if (who.refusal) return who.refusal;
      const factorId = pathname.split("/")[4];
      const factor = who.user.factors.find((candidate) => candidate.id === factorId);
      const body = await request.json();
      if (!factor || body.code !== factor.code)
        return json(422, {
          code: 422,
          error_code: "mfa_verification_failed",
          msg: "Invalid TOTP code entered",
        });
      factor.status = "verified";
      who.session.aal = "aal2";
      who.session.amr = [...who.session.amr, { method: "totp", timestamp: seconds() }];
      return json(200, await sessionBody(who.session));
    }

    if (name === "rpc:access_state") return json(200, "active");
    if (name === "rest") return json(200, []);

    return json(404, { msg: `fake Supabase has no ${method} ${pathname}` });
  }

  return {
    url,
    calls,

    /** Drop-in for globalThis.fetch. */
    fetch: (input, init) => route(new Request(input, init)),

    /** How many times an endpoint was asked, e.g. count("user"). */
    count: (name) => calls.filter((call) => call.name === name).length,
    clearCalls: () => calls.splice(0),

    /** factors: [{ id, status: "verified" | "unverified", type?: "totp", code? }] */
    addUser({ id, email, password = "correct horse", factors = [] }) {
      const user = {
        id,
        email,
        password,
        factors: factors.map((factor) => ({ type: "totp", code: "123456", ...factor })),
      };
      users.set(id, user);
      return user;
    },
    user: (id) => users.get(id),

    /** Whether a new account must confirm its e-mail before it gets a session (the project setting). */
    confirmEmailOnSignUp: (on) => {
      settings.confirmEmail = on;
    },

    /** A session that exists on the Auth side, and a token for it -- without the browser. */
    async session(userId, options) {
      const session = openSession(userId, options);
      return { id: session.id, token: await accessToken(session), raw: session };
    },
    tokenFor: (session, options) => accessToken(session.raw ?? session, options),

    /** What Auth would send a browser for that session: tokens and user, ready for supabase.auth.setSession(). */
    sessionBody: (session) => sessionBody(session.raw ?? session),

    /** What sign-out, or switching two-factor on elsewhere, does to a session. */
    revoke: (sessionId) => sessions.delete(sessionId),

    /** A token the real key signed for exactly these claims (a token Auth would never issue, such as one with no sub). */
    signed: (claims) =>
      signWith(real, {
        iss: `${url}/auth/v1`,
        aud: "authenticated",
        role: "authenticated",
        iat: seconds(),
        exp: seconds() + 3600,
        ...claims,
      }),

    /** A token for the same claims signed by somebody else's key. */
    forge: (claims) =>
      signWith(attacker, {
        iss: `${url}/auth/v1`,
        aud: "authenticated",
        role: "authenticated",
        iat: seconds(),
        exp: seconds() + 3600,
        ...claims,
      }),

    /** fail("user", { status: 500, body?, text? } | { network: true } | { hang: true } | { garbled: true } | { asUser: id } | { wrapped: true }) */
    fail: (name, fault) => faults.set(name, fault),
    recover: (name) => faults.delete(name),
  };
}
