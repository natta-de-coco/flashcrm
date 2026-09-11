// The Connection Center's readiness engine.
//
//   node scripts/cc-readiness-bundle.mjs && node --test tests/connection-readiness.test.mjs
//
// The properties that matter are not "it returns a state" but:
//  - a customer never sees a server setting name, and an administrator always does;
//  - no secret, key or provider token reaches a result, the console or an audit entry;
//  - one provider failing never hides the other five;
//  - a misconfigured deployment is diagnosed rather than quietly treated as ready;
//  - with a broken encryption key, sealing refuses rather than storing plaintext.
//
// The database is a fake service-role client installed into the bundle's stub,
// and fetch is mocked, so nothing here reaches a network or a real Postgres.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  __setSupabaseAdmin,
  audienceFor,
  availabilityForCaller,
  canTestCredentials,
  canViewProviderReadiness,
  checkCredentialTestRateLimit,
  evaluateAllProviders,
  evaluateProviderReadiness,
  maskId,
  readinessForCaller,
  resetCredentialTestRateLimit,
  sealSecret,
  startAuthorization,
  startResultForCaller,
  testProviderCredentials,
  visibleMissingSettings,
} from "../node_modules/.cache/cc-readiness-engine.mjs";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const APP_ID = "1234567890123456";
const SECRET = "super-secret-app-secret-value";
const PROVIDER_TOKEN = "EAAGprovider-app-token-never-leaves";
const ORIGIN = "https://app.example.test";
const KEY = `k1:${randomBytes(32).toString("base64")}`;

const ENV_BASE = {
  SUPABASE_URL: "https://db.example.test",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_fake_service_role",
  OAUTH_ALLOWED_ORIGINS: ORIGIN,
  PUBLIC_APP_URL: ORIGIN,
  TOKEN_ENCRYPTION_KEYS: KEY,
  TOKEN_ENCRYPTION_KEY: undefined,
  META_APP_ID: APP_ID,
  META_APP_SECRET: SECRET,
  META_LOGIN_CONFIG_ID: undefined,
  GOOGLE_OAUTH_CLIENT_ID: APP_ID,
  GOOGLE_OAUTH_CLIENT_SECRET: SECRET,
  LINKEDIN_CLIENT_ID: APP_ID,
  LINKEDIN_CLIENT_SECRET: SECRET,
  TIKTOK_CLIENT_KEY: APP_ID,
  TIKTOK_CLIENT_SECRET: SECRET,
  X_CLIENT_ID: APP_ID,
  X_CLIENT_SECRET: SECRET,
  PINTEREST_APP_ID: APP_ID,
  PINTEREST_APP_SECRET: SECRET,
};

const saved = new Map();

function setEnv(overrides = {}) {
  for (const [key, value] of Object.entries({ ...ENV_BASE, ...overrides })) {
    if (!saved.has(key)) saved.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function restoreEnv() {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved.clear();
}

/**
 * A chainable stand-in for the service-role client. `spec` maps a table name to
 * either a fixed `{ data, error }` or a function of the query, so a test can
 * make one table fail, or one provider's lookup throw, and leave the rest alone.
 */
function fakeDb(spec = {}) {
  const inserts = [];
  const resolve = (q) => {
    const entry = spec[q.table];
    const answer = typeof entry === "function" ? entry(q) : entry;
    if (answer) return answer;
    return { data: q.single ? null : [], error: null };
  };
  return {
    inserts,
    from(table) {
      const q = { table, op: "select", columns: "", filters: {}, single: false, row: null };
      const builder = {
        select(columns) {
          q.columns = columns ?? "";
          return builder;
        },
        insert(row) {
          q.op = "insert";
          q.row = row;
          inserts.push({ table, row });
          return builder;
        },
        eq(column, value) {
          q.filters[column] = value;
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return builder;
        },
        maybeSingle() {
          q.single = true;
          return builder;
        },
        single() {
          q.single = true;
          return builder;
        },
        then(onFulfilled, onRejected) {
          return Promise.resolve()
            .then(() => resolve(q))
            .then(onFulfilled, onRejected);
        },
      };
      return builder;
    },
    rpc: async () => ({ data: null, error: null }),
  };
}

/** Replaces global fetch and records what was sent. */
async function withFetch(handler, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return handler(String(input), init ?? {});
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

/** Everything written to the console while fn runs, as one string. */
async function captureConsole(fn) {
  const methods = ["log", "error", "warn", "info", "debug"];
  const originals = {};
  const lines = [];
  for (const method of methods) {
    originals[method] = console[method];
    console[method] = (...args) => lines.push(args.map((a) => String(a)).join(" "));
  }
  try {
    await fn();
  } finally {
    for (const method of methods) console[method] = originals[method];
  }
  return lines.join("\n");
}

const SUPER = { superAdmin: true, workspaceAdmin: true, tenantId: "t1" };
const WORKSPACE = { superAdmin: false, workspaceAdmin: true, tenantId: "t1" };
const MEMBER = { superAdmin: false, workspaceAdmin: false, tenantId: "t1" };

/** The exact spellings that must never reach someone who cannot change them. */
const ENV_NAME_FRAGMENTS = [
  "OAUTH_ALLOWED_ORIGINS",
  "PUBLIC_APP_URL",
  "TOKEN_ENCRYPTION_KEYS",
  "_APP_SECRET",
  "_CLIENT_SECRET",
  "_CLIENT_ID",
  "_APP_ID",
];

function assertNoEnvNames(value, label) {
  // `code` is the contract's stable machine identifier, and
  // PROVIDER_APP_ID_MISSING spells _APP_ID by design. It is an identifier the UI
  // keys on, not a server setting name, so it is dropped before the scan; every
  // other field is prose a customer actually reads.
  const json = JSON.stringify(value, (key, inner) => (key === "code" ? undefined : inner));
  for (const fragment of ENV_NAME_FRAGMENTS) {
    assert.equal(json.includes(fragment), false, `${label} leaked the setting name ${fragment}`);
  }
}

function assertNoSecrets(text, label) {
  for (const secret of [SECRET, PROVIDER_TOKEN, KEY.split(":")[1]]) {
    assert.equal(String(text).includes(secret), false, `${label} leaked a secret`);
  }
}

const codes = (problems) => problems.map((p) => p.code);

beforeEach(() => {
  setEnv();
  __setSupabaseAdmin(fakeDb());
  resetCredentialTestRateLimit();
});

afterEach(() => {
  restoreEnv();
});

// ─────────────────────────────────────────────────────────────────────────────

describe("the deployment's return address", () => {
  it("reports OAUTH_ORIGIN_MISSING when nobody told Flas its own address", async () => {
    setEnv({ OAUTH_ALLOWED_ORIGINS: undefined, PUBLIC_APP_URL: undefined });
    const readiness = await evaluateProviderReadiness("meta", { tenantId: null, origin: ORIGIN });

    assert.ok(codes(readiness.blockingIssues).includes("OAUTH_ORIGIN_MISSING"));
    assert.equal(readiness.state, "FLAS_CONFIGURATION_ERROR");
    assert.equal(readiness.allowedOriginConfigured, false);
    assert.equal(readiness.redirectUri, null);

    const problem = readiness.blockingIssues.find((p) => p.code === "OAUTH_ORIGIN_MISSING");
    assert.equal(problem.owner, "FLAS_ADMIN");
    assert.equal(problem.severity, "blocking");
    assert.equal(problem.technical.setting, "OAUTH_ALLOWED_ORIGINS");
  });

  it("refuses an origin that is not on the allowlist, without widening it", async () => {
    const readiness = await evaluateProviderReadiness("meta", {
      tenantId: null,
      origin: "https://app.example.test.attacker.test",
    });
    assert.ok(codes(readiness.blockingIssues).includes("OAUTH_ORIGIN_NOT_ALLOWED"));
    assert.equal(readiness.redirectUri, null);
  });

  it("builds the redirect URI from the validated origin when everything is set", async () => {
    const readiness = await evaluateProviderReadiness("meta", { tenantId: null, origin: ORIGIN });
    assert.equal(readiness.redirectUri, `${ORIGIN}/api/public/oauth-callback`);
    assert.equal(readiness.blockingIssues.length, 0);
    // Meta gates several capabilities behind its own app review, so a fully
    // configured Meta is connectable without being unqualified "READY".
    assert.equal(readiness.state, "NEEDS_PROVIDER_REVIEW");
  });

  it("warns, without blocking, when only PUBLIC_APP_URL is missing", async () => {
    setEnv({ PUBLIC_APP_URL: undefined });
    const readiness = await evaluateProviderReadiness("meta", { tenantId: null, origin: ORIGIN });
    assert.ok(codes(readiness.warnings).includes("PUBLIC_APP_URL_MISSING"));
    assert.equal(readiness.blockingIssues.length, 0);
  });
});

describe("what each audience is shown", () => {
  it("tells a member nothing about server settings, for any provider", async () => {
    setEnv({
      OAUTH_ALLOWED_ORIGINS: undefined,
      PUBLIC_APP_URL: undefined,
      META_APP_SECRET: undefined,
      TOKEN_ENCRYPTION_KEYS: "k1:not-a-valid-key",
    });
    const providers = await evaluateAllProviders({ tenantId: null, origin: ORIGIN });
    const seen = providers.map((p) => availabilityForCaller(p, MEMBER));

    assertNoEnvNames(seen, "a member's availability view");
    assertNoSecrets(JSON.stringify(seen), "a member's availability view");
    for (const entry of seen) {
      assert.equal(entry.available, false);
      assert.equal(entry.problem.technical, undefined);
    }
  });

  it("strips settings from a member's full readiness view too", async () => {
    setEnv({ OAUTH_ALLOWED_ORIGINS: undefined, PUBLIC_APP_URL: undefined });
    const readiness = await evaluateProviderReadiness("meta", { tenantId: null, origin: ORIGIN });
    assertNoEnvNames(readinessForCaller(readiness, MEMBER), "a member's readiness view");
  });

  it("gives a Flas super admin the setting name", async () => {
    setEnv({ OAUTH_ALLOWED_ORIGINS: undefined, PUBLIC_APP_URL: undefined });
    const readiness = await evaluateProviderReadiness("meta", { tenantId: null, origin: ORIGIN });
    const asAdmin = readinessForCaller(readiness, SUPER);
    assert.equal(
      asAdmin.blockingIssues.find((p) => p.code === "OAUTH_ORIGIN_MISSING").technical.setting,
      "OAUTH_ALLOWED_ORIGINS",
    );
  });

  it("treats a workspace admin as an admin of their own problems only", () => {
    assert.equal(audienceFor("WORKSPACE_ADMIN", WORKSPACE), "admin");
    assert.equal(audienceFor("FLAS_ADMIN", WORKSPACE), "user");
    assert.equal(audienceFor("FLAS_ADMIN", SUPER), "admin");
    assert.equal(audienceFor("WORKSPACE_ADMIN", MEMBER), "user");
    assert.equal(audienceFor("PROVIDER", MEMBER), "user");
  });

  it("hides a Flas deployment fault from a workspace admin's technical detail", async () => {
    setEnv({ OAUTH_ALLOWED_ORIGINS: undefined, PUBLIC_APP_URL: undefined });
    const readiness = await evaluateProviderReadiness("meta", { tenantId: "t1", origin: ORIGIN });
    assertNoEnvNames(readinessForCaller(readiness, WORKSPACE), "a workspace admin's view");
  });
});

describe("app keys", () => {
  it("reports a missing secret without ever revealing one", async () => {
    setEnv({ META_APP_SECRET: undefined });
    const readiness = await evaluateProviderReadiness("meta", { tenantId: null, origin: ORIGIN });

    assert.ok(codes(readiness.blockingIssues).includes("PROVIDER_APP_SECRET_MISSING"));
    assert.equal(readiness.state, "NEEDS_CONFIGURATION");
    assert.equal(readiness.secretPresent, false);
    assert.equal(readiness.appIdPresent, true);
    assert.equal(readiness.credentialSource, "none");
    assert.equal(readiness.configured, false);
    assert.equal(
      readiness.blockingIssues.find((p) => p.code === "PROVIDER_APP_SECRET_MISSING").technical
        .setting,
      "META_APP_SECRET",
    );
  });

  it("masks the app id rather than returning it", async () => {
    const readiness = await evaluateProviderReadiness("meta", { tenantId: null, origin: ORIGIN });
    assert.equal(readiness.appIdMasked, maskId(APP_ID));
    assert.equal(readiness.appIdMasked.includes(APP_ID), false);
    assert.equal(JSON.stringify(readiness).includes(APP_ID), false);
  });

  it("hands a half-finished workspace app to the workspace admin, not to Flas", async () => {
    setEnv({ META_APP_SECRET: undefined });
    __setSupabaseAdmin(
      fakeDb({
        // The workspace pasted an id but no secret, so resolveCredentials falls
        // back to the shared app and the workspace row is the thing to finish.
        platform_apps: (q) =>
          q.filters.provider === "meta"
            ? { data: { client_id: APP_ID, client_secret: null }, error: null }
            : { data: null, error: null },
      }),
    );
    const readiness = await evaluateProviderReadiness("meta", { tenantId: "t1", origin: ORIGIN });
    const problem = readiness.blockingIssues.find((p) => p.code === "PROVIDER_APP_SECRET_MISSING");
    assert.equal(problem.owner, "WORKSPACE_ADMIN");
    assert.equal(problem.technical.setting, undefined);
    assertNoEnvNames(problem, "a workspace-owned credential problem");
  });
});

describe("encryption at rest", () => {
  it("blocks when a configured key cannot be used", async () => {
    setEnv({ TOKEN_ENCRYPTION_KEYS: "k1:not-thirty-two-bytes" });
    const readiness = await evaluateProviderReadiness("meta", { tenantId: null, origin: ORIGIN });
    const problem = readiness.blockingIssues.find((p) => p.code === "TOKEN_ENCRYPTION_KEY_INVALID");
    assert.ok(problem, "a malformed key must block");
    assert.equal(problem.severity, "blocking");
    assert.equal(readiness.state, "FLAS_CONFIGURATION_ERROR");
    assert.equal(readiness.encryptionConfigured, false);
    assertNoSecrets(JSON.stringify(problem), "the malformed-key problem");
  });

  it("only warns when no key is configured, because that mode is deliberate", async () => {
    setEnv({ TOKEN_ENCRYPTION_KEYS: undefined, TOKEN_ENCRYPTION_KEY: undefined });
    const readiness = await evaluateProviderReadiness("meta", { tenantId: null, origin: ORIGIN });
    const problem = readiness.warnings.find((p) => p.code === "TOKEN_ENCRYPTION_NOT_CONFIGURED");
    assert.ok(problem, "an absent key must warn");
    assert.equal(problem.severity, "warning");
    // A warning, so it never becomes the reason a connection is refused.
    assert.equal(readiness.blockingIssues.length, 0);
    assert.equal(readiness.state, "NEEDS_PROVIDER_REVIEW");
  });

  it("fails closed: a broken key makes sealing refuse rather than store plaintext", async () => {
    setEnv({ TOKEN_ENCRYPTION_KEYS: "k1:not-thirty-two-bytes" });
    await assert.rejects(sealSecret(SECRET), /32 bytes/);
    setEnv({ TOKEN_ENCRYPTION_KEYS: "no-id-at-all" });
    await assert.rejects(sealSecret(SECRET), /id:base64key/);
  });
});

describe("the database the connect flow needs", () => {
  it("reports a pending migration and names the object only to administrators", async () => {
    __setSupabaseAdmin(
      fakeDb({
        social_accounts: {
          data: null,
          error: { message: "column social_accounts.refresh_locked_until does not exist" },
        },
      }),
    );
    const readiness = await evaluateProviderReadiness("meta", { tenantId: null, origin: ORIGIN });
    const problem = readiness.blockingIssues.find((p) => p.code === "DATABASE_MIGRATION_PENDING");

    assert.ok(problem, "a missing column must be reported");
    assert.equal(problem.owner, "FLAS_ADMIN");
    assert.equal(readiness.databaseReady, false);
    assert.ok(problem.technical.detail.includes("refresh_locked_until"));
    assert.equal(
      JSON.stringify(readinessForCaller(readiness, MEMBER)).includes("refresh_locked_until"),
      false,
      "a member must not be shown the missing database object",
    );
  });

  it("reports an unusable oauth_states table", async () => {
    __setSupabaseAdmin(
      fakeDb({ oauth_states: { data: null, error: { message: "permission denied" } } }),
    );
    const readiness = await evaluateProviderReadiness("meta", { tenantId: null, origin: ORIGIN });
    assert.ok(codes(readiness.blockingIssues).includes("OAUTH_STATE_UNAVAILABLE"));
    assert.equal(readiness.oauthStateReady, false);
  });

  it("reports a missing service-role key instead of probing with none", async () => {
    setEnv({ SUPABASE_SERVICE_ROLE_KEY: undefined });
    const readiness = await evaluateProviderReadiness("meta", { tenantId: null, origin: ORIGIN });
    assert.ok(codes(readiness.blockingIssues).includes("SERVICE_ROLE_MISSING"));
    assert.equal(readiness.databaseReady, false);
  });
});

describe("one provider never takes down the others", () => {
  it("keeps every provider in the list when one check throws", async () => {
    __setSupabaseAdmin(
      fakeDb({
        platform_apps: (q) => {
          if (q.filters.provider === "linkedin") throw new Error("connection reset by peer");
          return { data: null, error: null };
        },
      }),
    );
    const providers = await evaluateAllProviders({ tenantId: "t1", origin: ORIGIN });

    assert.equal(providers.length, 6);
    const linkedin = providers.find((p) => p.provider === "linkedin");
    assert.equal(linkedin.state, "FLAS_CONFIGURATION_ERROR");
    assert.ok(codes(linkedin.blockingIssues).includes("FLAS_CONFIGURATION_ERROR"));
    for (const other of providers.filter((p) => p.provider !== "linkedin")) {
      assert.notEqual(
        other.state,
        "FLAS_CONFIGURATION_ERROR",
        `${other.provider} should be unaffected`,
      );
      assert.equal(other.blockingIssues.length, 0, `${other.provider} should have no blockers`);
    }
  });

  it("says a provider's review is still pending without calling it broken", async () => {
    const readiness = await evaluateProviderReadiness("meta", { tenantId: null, origin: ORIGIN });
    assert.equal(readiness.reviewRequired, true);
    assert.equal(readiness.reviewStatus, "unknown");
    assert.ok(readiness.connectors.includes("facebook"));
    assert.ok(readiness.connectors.includes("instagram"));
  });
});

describe("testing app keys against the provider", () => {
  const redirectUri = `${ORIGIN}/api/public/oauth-callback`;
  const run = (provider) =>
    testProviderCredentials({ provider, id: APP_ID, secret: SECRET, redirectUri, name: provider });

  it("passes when Meta issues an app token, and throws that token away", async () => {
    const result = await withFetch(
      () => new Response(JSON.stringify({ access_token: PROVIDER_TOKEN }), { status: 200 }),
      () => run("meta"),
    );
    assert.equal(result.status, "passed");
    assert.equal(JSON.stringify(result).includes(PROVIDER_TOKEN), false);
    assertNoSecrets(JSON.stringify(result), "a passing Meta test");
  });

  it("fails when Meta refuses the keys", async () => {
    const result = await withFetch(
      () =>
        new Response(JSON.stringify({ error: { type: "OAuthException", code: 101 } }), {
          status: 400,
        }),
      () => run("meta"),
    );
    assert.equal(result.status, "failed");
    assert.equal(result.providerErrorCode, "OAuthException:101");
  });

  it("reads invalid_grant as proof the keys were accepted", async () => {
    const calls = [];
    const result = await withFetch(
      () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
      async (recorded) => {
        const out = await run("google");
        calls.push(...recorded);
        return out;
      },
    );
    assert.equal(result.status, "passed");
    // The probe is an authorization-code exchange that cannot succeed.
    assert.ok(calls[0].init.body.includes("grant_type=authorization_code"));
    assert.ok(calls[0].init.body.includes(encodeURIComponent(redirectUri)));
  });

  it("reads invalid_client, and a 401, as a refusal", async () => {
    const rejected = await withFetch(
      () => new Response(JSON.stringify({ error: "invalid_client" }), { status: 400 }),
      () => run("linkedin"),
    );
    assert.equal(rejected.status, "failed");

    const unauthorized = await withFetch(
      () => new Response("{}", { status: 401 }),
      () => run("pinterest"),
    );
    assert.equal(unauthorized.status, "failed");
  });

  it("sends X and Pinterest secrets in the Authorization header, never in a result", async () => {
    const seen = [];
    const result = await withFetch(
      () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
      async (calls) => {
        const out = await run("twitter");
        seen.push(...calls);
        return out;
      },
    );
    assert.ok(seen[0].init.headers["Authorization"].startsWith("Basic "));
    assert.equal(seen[0].init.body.includes(SECRET), false);
    assertNoSecrets(JSON.stringify(result), "an X credential test");
  });

  it("stays inconclusive on anything it cannot back with documentation", async () => {
    const serverError = await withFetch(
      () => new Response(JSON.stringify({ error: "server_error" }), { status: 500 }),
      () => run("tiktok"),
    );
    assert.equal(serverError.status, "inconclusive");
    assert.equal(serverError.providerErrorCode, null);

    // unauthorized_client says the app is misconfigured, not that the secret is
    // wrong, so it must not be reported as a refusal.
    const unauthorizedClient = await withFetch(
      () => new Response(JSON.stringify({ error: "unauthorized_client" }), { status: 400 }),
      () => run("google"),
    );
    assert.equal(unauthorizedClient.status, "inconclusive");
  });

  it("stays inconclusive, and quotes nothing, when the provider cannot be reached", async () => {
    const result = await withFetch(
      () => {
        throw new Error(`request to https://graph.facebook.com/?client_secret=${SECRET} failed`);
      },
      () => run("meta"),
    );
    assert.equal(result.status, "inconclusive");
    assertNoSecrets(JSON.stringify(result), "an unreachable-provider result");
  });

  it("records only a verdict, a status and a documented code", async () => {
    const result = await withFetch(
      () =>
        new Response(JSON.stringify({ error: { type: "OAuthException", code: 101 } }), {
          status: 400,
        }),
      () => run("meta"),
    );
    // The shape the server function hands to logAudit.
    const auditDetails = {
      provider: result.provider,
      status: result.status,
      httpStatus: result.httpStatus,
      providerErrorCode: result.providerErrorCode,
      credentialSource: "shared",
    };
    assertNoSecrets(JSON.stringify(auditDetails), "audit details");
    assertNoEnvNames(auditDetails, "audit details");
  });

  it("allows one test per provider per 30 seconds", () => {
    const start = 1_000_000;
    assert.equal(checkCredentialTestRateLimit("meta", start).allowed, true);
    const blocked = checkCredentialTestRateLimit("meta", start + 5_000);
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfterSeconds > 0 && blocked.retryAfterSeconds <= 30);
    // Per provider, so one screen's test does not lock the others out.
    assert.equal(checkCredentialTestRateLimit("google", start + 5_000).allowed, true);
    assert.equal(checkCredentialTestRateLimit("meta", start + 31_000).allowed, true);
  });
});

describe("who may ask", () => {
  it("opens the diagnosis to administrators only", () => {
    assert.equal(canViewProviderReadiness(SUPER), true);
    assert.equal(canViewProviderReadiness(WORKSPACE), true);
    assert.equal(canViewProviderReadiness(MEMBER), false);
  });

  it("lets a workspace admin test only their own workspace's app", () => {
    assert.equal(canTestCredentials(SUPER, "shared"), true);
    assert.equal(canTestCredentials(SUPER, "workspace"), true);
    assert.equal(canTestCredentials(WORKSPACE, "workspace"), true);
    assert.equal(canTestCredentials(WORKSPACE, "shared"), false);
    assert.equal(canTestCredentials(WORKSPACE, "none"), false);
    assert.equal(canTestCredentials(MEMBER, "workspace"), false);
  });

  it("gives setting names to a super admin and to nobody else", () => {
    const missing = ["META_APP_ID", "META_APP_SECRET"];
    assert.deepEqual(visibleMissingSettings(missing, SUPER), missing);
    assert.deepEqual(visibleMissingSettings(missing, WORKSPACE), []);
    assert.deepEqual(visibleMissingSettings(missing, MEMBER), []);
  });
});

describe("starting a connection", () => {
  it("returns the attempt id of the state row it wrote", async () => {
    __setSupabaseAdmin(fakeDb({ oauth_states: { data: { id: "attempt-123" }, error: null } }));
    const result = await startAuthorization({
      platform: "facebook",
      origin: ORIGIN,
      tenantId: "t1",
      userId: "u1",
    });
    assert.equal(result.ready, true);
    assert.equal(result.attemptId, "attempt-123");
    assert.ok(result.url.startsWith("https://www.facebook.com/"));
    assert.equal(result.url.includes(SECRET), false);
  });

  it("blocks with a typed problem, and tells a member no setting names", async () => {
    setEnv({ META_APP_ID: undefined, META_APP_SECRET: undefined });
    const blocked = await startAuthorization({
      platform: "facebook",
      origin: ORIGIN,
      tenantId: "t1",
      userId: "u1",
    });
    assert.equal(blocked.ready, false);
    assert.equal(blocked.problem.code, "PROVIDER_APP_ID_MISSING");

    const forMember = startResultForCaller(blocked, MEMBER);
    assert.deepEqual(forMember.missing, []);
    assert.equal(forMember.reason, forMember.problem.message);
    assertNoEnvNames(forMember, "a member's blocked Connect result");

    const forAdmin = startResultForCaller(blocked, SUPER);
    assert.deepEqual(forAdmin.missing, ["META_APP_ID", "META_APP_SECRET"]);
    assert.equal(forAdmin.problem.technical.setting, "META_APP_ID");
  });

  it("does not hand a database error straight to the browser", async () => {
    __setSupabaseAdmin(
      fakeDb({
        oauth_states: {
          data: null,
          error: { message: 'relation "oauth_states" does not exist' },
        },
      }),
    );
    const blocked = await startAuthorization({
      platform: "facebook",
      origin: ORIGIN,
      tenantId: "t1",
      userId: "u1",
    });
    assert.equal(blocked.ready, false);
    assert.equal(blocked.problem.code, "OAUTH_STATE_UNAVAILABLE");
    assert.equal(blocked.reason.includes("relation"), false);
    assert.ok(blocked.problem.technical.detail.includes("oauth_states"));
  });
});

describe("nothing secret escapes", () => {
  it("keeps secrets out of results and out of the console", async () => {
    let providers;
    const logged = await captureConsole(async () => {
      providers = await evaluateAllProviders({ tenantId: "t1", origin: ORIGIN });
    });
    assertNoSecrets(logged, "the console during a full evaluation");
    assertNoSecrets(JSON.stringify(providers), "a full evaluation");
    assert.equal(JSON.stringify(providers).includes(APP_ID), false);
  });

  it("keeps secrets out of a failing evaluation's console output too", async () => {
    setEnv({ TOKEN_ENCRYPTION_KEYS: `k1:${randomBytes(8).toString("base64")}` });
    __setSupabaseAdmin(
      fakeDb({
        social_accounts: { data: null, error: { message: "column does not exist" } },
      }),
    );
    let providers;
    const logged = await captureConsole(async () => {
      providers = await evaluateAllProviders({ tenantId: "t1", origin: ORIGIN });
    });
    assertNoSecrets(logged, "the console during a failing evaluation");
    assertNoSecrets(JSON.stringify(providers), "a failing evaluation");
  });
});
