// ═════════════════════════════════════════════════════════════════════════════
// Flas CRM — Milestone 1 Access Control & Security Boundary Test Suite
// Adversarial Empirical Verification by Milestone 1 Challenger 2
// ═════════════════════════════════════════════════════════════════════════════

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";

// ─────────────────────────────────────────────────────────────────────────────
// Setup Environment & Native Mocks
// ─────────────────────────────────────────────────────────────────────────────
const testKey = () => crypto.randomBytes(32).toString("base64");
const K1 = testKey();
const K2 = testKey();

process.env.SUPABASE_URL = "https://flas-test.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_testkey123";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_service_role_key_123";
process.env.EMAIL_TOKEN_ENCRYPTION_KEYS = `k1:${K1},k2:${K2}`;
process.env.EMAIL_TOKEN_ACTIVE_KEY_ID = "k1";

let serverFns;
let runWithStartContext;
let eventStorage;

// Shared mutable mock state for config data tests
let mockStoredConfig = null;
let origFetch = globalThis.fetch;

// Helper to extract authorization header regardless of Headers object or plain object
function getAuthHeader(headers) {
  if (!headers) return null;
  if (typeof headers.get === "function") {
    return headers.get("authorization");
  }
  return headers.authorization || headers.Authorization || null;
}

before(async () => {
  fs.mkdirSync("node_modules/.cache", { recursive: true });

  // Plugin to supply extractedFn {} to .handler() calls as required by TanStack Start runtime
  const handlerTransformPlugin = {
    name: "handler-transform",
    setup(b) {
      b.onLoad({ filter: /platform-email\.functions\.ts$/ }, async (args) => {
        let code = fs.readFileSync(args.path, "utf8");
        code = code.replace(/\.handler\(/g, ".handler({}, ");
        return { contents: code, loader: "ts" };
      });
    },
  };

  await build({
    entryPoints: ["src/lib/platform-email.functions.ts"],
    outfile: "node_modules/.cache/flas-platform-email-bundle.mjs",
    format: "esm",
    platform: "node",
    bundle: true,
    alias: {
      "@": path.resolve("src"),
    },
    plugins: [handlerTransformPlugin],
    external: [
      "@tanstack/react-start",
      "@supabase/supabase-js",
      "zod",
    ],
    logLevel: "error",
  });

  const storageCtx = await import("@tanstack/start-storage-context");
  runWithStartContext = storageCtx.runWithStartContext;

  await import("@tanstack/react-start/server");
  eventStorage = globalThis[Symbol.for("tanstack-start:event-storage")];

  serverFns = await import("../node_modules/.cache/flas-platform-email-bundle.mjs");

  // Install resilient fetch mock for Supabase PostgREST & Auth
  globalThis.fetch = async (url, opts) => {
    const urlStr = String(url);
    const authHeader = getAuthHeader(opts?.headers);

    // 1. Supabase Auth getUser endpoint
    if (urlStr.includes("/auth/v1/user")) {
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ message: "Invalid token" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }
      // Extract sub from the bearer JWT
      const token = authHeader.replace("Bearer ", "");
      const parts = token.split(".");
      let sub = "user_default";
      if (parts.length === 3) {
        try {
          const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
          sub = payload.sub || sub;
        } catch {}
      }

      return new Response(
        JSON.stringify({
          id: sub,
          email: `${sub}@mobidigisol.com`,
          app_metadata: {},
          user_metadata: {},
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    // 2. Supabase access_state RPC
    if (urlStr.includes("/rest/v1/rpc/access_state")) {
      if (opts?.body && typeof opts.body === "string" && opts.body.includes("user_suspended")) {
        return new Response(JSON.stringify("user_suspended"), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify("active"), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    // 3. Profiles query for role authorization (deterministic mapping based on user ID)
    if (urlStr.includes("/rest/v1/profiles")) {
      if (urlStr.includes("user_missing_profile")) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (urlStr.includes("user_null_role")) {
        return new Response(JSON.stringify([{ staff_role: null }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (urlStr.includes("user_super_admin")) {
        return new Response(JSON.stringify([{ staff_role: "super_admin" }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      // Check specific role names encoded in user id: user_<role>
      const match = /user_([a-z_]+)/.exec(urlStr);
      const role = match ? match[1] : "user";
      return new Response(
        JSON.stringify([{ staff_role: role }]),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    // 4. Platform email config table query
    if (urlStr.includes("/rest/v1/platform_email_config")) {
      if (opts?.method === "POST" || opts?.method === "PATCH") {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify(mockStoredConfig ? [mockStoredConfig] : []),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
});

after(() => {
  globalThis.fetch = origFetch;
});

// Helper to generate a valid base64url signed JWT format
function generateTestJwt(payload = {}) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(
    JSON.stringify({
      sub: payload.sub || "user_super_admin",
      email: payload.email || "challenger@mobidigisol.com",
      exp: payload.exp !== undefined ? payload.exp : Math.floor(Date.now() / 1000) + 3600,
      ...payload,
    })
  ).toString("base64url");
  const sig = Buffer.from("simulated_signature_bytes").toString("base64url");
  return `${header}.${body}.${sig}`;
}

// Pipeline executor simulating TanStack Start request execution
async function executeServerCall(serverFn, options = {}) {
  const { headers = {}, data = undefined } = options;
  const req = new Request("http://localhost/api/server-fn", {
    method: "POST",
    headers,
  });

  return await runWithStartContext(
    { request: req, executedRequestMiddlewares: new Set() },
    async () => {
      return await eventStorage.run({ h3Event: { req } }, async () => {
        return await serverFn.__executeServer({ data, context: {} });
      });
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Part 1: Server Function Authorization & Unauthenticated Rejection
// ─────────────────────────────────────────────────────────────────────────────
describe("M1 Challenge: Unauthenticated Calls Rejection", () => {
  test("AC-1: getPlatformEmailConfig rejects calls with no Authorization header", async () => {
    const res = await executeServerCall(serverFns.getPlatformEmailConfig, { headers: {} });
    assert.equal(res.result, undefined);
    assert.ok(res.error, "Must produce error on missing auth header");
    assert.match(res.error.message, /No authorization header provided/i);
  });

  test("AC-2: getPlatformEmailConfig rejects non-Bearer authentication scheme (Basic)", async () => {
    const res = await executeServerCall(serverFns.getPlatformEmailConfig, {
      headers: { authorization: "Basic YWRtaW46cGFzc3dvcmQ=" },
    });
    assert.equal(res.result, undefined);
    assert.ok(res.error);
    assert.match(res.error.message, /Only Bearer tokens are supported/i);
  });

  test("AC-3: getPlatformEmailConfig rejects empty Bearer token", async () => {
    const res = await executeServerCall(serverFns.getPlatformEmailConfig, {
      headers: { authorization: "Bearer " },
    });
    assert.equal(res.result, undefined);
    assert.ok(res.error);
    assert.match(res.error.message, /Only Bearer tokens are supported|No token provided/i);
  });

  test("AC-4: getPlatformEmailConfig rejects malformed JWT structure (not 3 parts)", async () => {
    const res = await executeServerCall(serverFns.getPlatformEmailConfig, {
      headers: { authorization: "Bearer invalid-jwt-part1.part2" },
    });
    assert.equal(res.result, undefined);
    assert.ok(res.error);
    assert.match(res.error.message, /Invalid token/i);
  });

  test("AC-5: savePlatformEmailConfig rejects unauthenticated requests", async () => {
    const res = await executeServerCall(serverFns.savePlatformEmailConfig, {
      headers: {},
      data: {
        smtpHost: "smtp.mobidigisol.com",
        smtpPort: 465,
        smtpUser: "flas@mobidigisol.com",
        smtpPass: "secret",
      },
    });
    assert.equal(res.result, undefined);
    assert.ok(res.error);
    assert.match(res.error.message, /No authorization header provided/i);
  });

  test("AC-6: testPlatformEmailConnection rejects unauthenticated requests", async () => {
    const res = await executeServerCall(serverFns.testPlatformEmailConnection, {
      headers: {},
      data: { type: "smtp" },
    });
    assert.equal(res.result, undefined);
    assert.ok(res.error);
    assert.match(res.error.message, /No authorization header provided/i);
  });

  test("AC-7: sendPlatformTestEmail rejects unauthenticated requests", async () => {
    const res = await executeServerCall(serverFns.sendPlatformTestEmail, {
      headers: {},
      data: { recipient: "admin@mobidigisol.com" },
    });
    assert.equal(res.result, undefined);
    assert.ok(res.error);
    assert.match(res.error.message, /No authorization header provided/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 2: Role Authorization Matrix (Non-Super-Admin Roles Rejected)
// ─────────────────────────────────────────────────────────────────────────────
describe("M1 Challenge: Non-Super-Admin Role Enforcement", () => {
  const unauthorizedRoles = [
    "company_admin",
    "staff",
    "marketing_manager",
    "seo_editor",
    "user",
    "viewer",
    "billing_manager",
  ];

  for (const role of unauthorizedRoles) {
    const jwt = generateTestJwt({ sub: `user_${role}` });

    test(`ROLE-1 [${role}]: getPlatformEmailConfig is strictly forbidden`, async () => {
      const res = await executeServerCall(serverFns.getPlatformEmailConfig, {
        headers: { authorization: `Bearer ${jwt}` },
      });
      assert.equal(res.result, undefined, `Role ${role} must not receive config result`);
      assert.ok(res.error, `Role ${role} must receive an error`);
      assert.match(
        res.error.message,
        /This area is only available to the Flas platform manager/i,
        `Expected platform manager rejection for role ${role}`
      );
    });

    test(`ROLE-2 [${role}]: savePlatformEmailConfig is strictly forbidden`, async () => {
      const res = await executeServerCall(serverFns.savePlatformEmailConfig, {
        headers: { authorization: `Bearer ${jwt}` },
        data: {
          smtpHost: "smtp.attacker.test",
          smtpPort: 465,
          smtpUser: "hacker@test.com",
          smtpPass: "attack",
        },
      });
      assert.equal(res.result, undefined);
      assert.ok(res.error);
      assert.match(res.error.message, /This area is only available to the Flas platform manager/i);
    });

    test(`ROLE-3 [${role}]: testPlatformEmailConnection is strictly forbidden`, async () => {
      const res = await executeServerCall(serverFns.testPlatformEmailConnection, {
        headers: { authorization: `Bearer ${jwt}` },
        data: { type: "smtp" },
      });
      assert.equal(res.result, undefined);
      assert.ok(res.error);
      assert.match(res.error.message, /This area is only available to the Flas platform manager/i);
    });

    test(`ROLE-4 [${role}]: sendPlatformTestEmail is strictly forbidden`, async () => {
      const res = await executeServerCall(serverFns.sendPlatformTestEmail, {
        headers: { authorization: `Bearer ${jwt}` },
        data: { recipient: "target@test.com" },
      });
      assert.equal(res.result, undefined);
      assert.ok(res.error);
      assert.match(res.error.message, /This area is only available to the Flas platform manager/i);
    });
  }

  test("ROLE-5: User with missing profile row is strictly rejected", async () => {
    const jwt = generateTestJwt({ sub: "user_missing_profile" });
    const res = await executeServerCall(serverFns.getPlatformEmailConfig, {
      headers: { authorization: `Bearer ${jwt}` },
    });
    assert.equal(res.result, undefined);
    assert.ok(res.error);
    assert.match(res.error.message, /This area is only available to the Flas platform manager/i);
  });

  test("ROLE-6: User with null staff_role is strictly rejected", async () => {
    const jwt = generateTestJwt({ sub: "user_null_role" });
    const res = await executeServerCall(serverFns.getPlatformEmailConfig, {
      headers: { authorization: `Bearer ${jwt}` },
    });
    assert.equal(res.result, undefined);
    assert.ok(res.error);
    assert.match(res.error.message, /This area is only available to the Flas platform manager/i);
  });

  test("ROLE-7: Suspended user is blocked at middleware access_state check", async () => {
    const jwt = generateTestJwt({ sub: "user_suspended" });
    const res = await executeServerCall(serverFns.getPlatformEmailConfig, {
      headers: { authorization: `Bearer ${jwt}` },
    });
    assert.equal(res.result, undefined);
    assert.ok(res.error);
    assert.match(res.error.message, /Your account has been suspended/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 3: Password Masking & Credential Leakage Prevention
// ─────────────────────────────────────────────────────────────────────────────
describe("M1 Challenge: Password Masking & Zero Plaintext Leakage", () => {
  const superAdminJwt = generateTestJwt({ sub: "user_super_admin" });
  const PLAINTEXT_PASSWORD = "P@ssw0rd!SuperSecret2026NeverLeak";
  const CIPHERTEXT_ENVELOPE = "v1:k1:bW9ja0lWMTIzNDU2:bW9ja0NpcGhlcnRleHQxMjM0NTY3ODkw:bW9ja1RhZzEyMzQ1Ng";

  before(() => {
    mockStoredConfig = {
      id: "00000000-0000-0000-0000-000000000001",
      from_email: "flas@mobidigisol.com",
      from_name: "Flas CRM",
      smtp_host: "smtp.mobidigisol.com",
      smtp_port: 465,
      smtp_secure: true,
      smtp_user: "flas@mobidigisol.com",
      smtp_pass_enc: CIPHERTEXT_ENVELOPE,
      imap_host: "imap.mobidigisol.com",
      imap_port: 993,
      imap_secure: true,
      imap_user: "flas@mobidigisol.com",
      imap_pass_enc: CIPHERTEXT_ENVELOPE,
      verified: true,
      last_test_at: "2026-10-09T12:00:00Z",
      last_test_ok: true,
      last_test_error: null,
      updated_at: "2026-10-09T12:00:00Z",
    };
  });

  test("MASK-1: getPlatformEmailConfig returns masked bullet strings for SMTP and IMAP", async () => {
    const res = await executeServerCall(serverFns.getPlatformEmailConfig, {
      headers: { authorization: `Bearer ${superAdminJwt}` },
    });

    assert.equal(res.error, undefined, `Expected no error, got ${res.error?.message}`);
    assert.ok(res.result, "Must return public config object");

    // Must return masked strings
    assert.equal(res.result.smtpPasswordMasked, "••••••••");
    assert.equal(res.result.smtpPassMasked, "••••••••");
    assert.equal(res.result.imapPasswordMasked, "••••••••");
    assert.equal(res.result.imapPassMasked, "••••••••");

    // Must return boolean flags
    assert.equal(res.result.hasSmtpPassword, true);
    assert.equal(res.result.smtpPassConfigured, true);
    assert.equal(res.result.hasImapPassword, true);
    assert.equal(res.result.imapPassConfigured, true);
  });

  test("MASK-2: Raw ciphertext envelope never appears in getPlatformEmailConfig response", async () => {
    const res = await executeServerCall(serverFns.getPlatformEmailConfig, {
      headers: { authorization: `Bearer ${superAdminJwt}` },
    });

    assert.ok(res.result, "Must return result for super_admin");
    const serialized = JSON.stringify(res.result);

    // Verify neither plaintext nor ciphertext envelope exists anywhere in payload
    assert.equal(serialized.includes(PLAINTEXT_PASSWORD), false, "Plaintext password leaked!");
    assert.equal(serialized.includes(CIPHERTEXT_ENVELOPE), false, "Ciphertext envelope leaked!");
    assert.equal(serialized.includes("smtp_pass_enc"), false, "DB column smtp_pass_enc exposed!");
    assert.equal(serialized.includes("imap_pass_enc"), false, "DB column imap_pass_enc exposed!");

    // Verify all keys in response adhere to strict public schema
    const allowedKeys = new Set([
      "configured",
      "id",
      "fromEmail",
      "fromName",
      "smtpHost",
      "smtpPort",
      "smtpSecure",
      "smtpUser",
      "hasSmtpPassword",
      "smtpPassConfigured",
      "smtpPasswordMasked",
      "smtpPassMasked",
      "imapHost",
      "imapPort",
      "imapSecure",
      "imapUser",
      "hasImapPassword",
      "imapPassConfigured",
      "imapPasswordMasked",
      "imapPassMasked",
      "verified",
      "lastTestAt",
      "lastTestOk",
      "lastTestError",
      "lastTestLatencyMs",
      "updatedAt",
    ]);

    for (const key of Object.keys(res.result)) {
      assert.ok(allowedKeys.has(key), `Disallowed property '${key}' in public response`);
    }
  });

  test("MASK-3: Unconfigured passwords return empty string masking and false boolean indicators", async () => {
    mockStoredConfig = {
      ...mockStoredConfig,
      smtp_pass_enc: null,
      imap_pass_enc: null,
    };

    const res = await executeServerCall(serverFns.getPlatformEmailConfig, {
      headers: { authorization: `Bearer ${superAdminJwt}` },
    });

    assert.equal(res.error, undefined);
    assert.ok(res.result);
    assert.equal(res.result.hasSmtpPassword, false);
    assert.equal(res.result.smtpPasswordMasked, "");
    assert.equal(res.result.hasImapPassword, false);
    assert.equal(res.result.imapPasswordMasked, "");
  });

  test("MASK-4: Empty configuration state (table empty) returns safe defaults with zero secret leak", async () => {
    mockStoredConfig = null;

    const res = await executeServerCall(serverFns.getPlatformEmailConfig, {
      headers: { authorization: `Bearer ${superAdminJwt}` },
    });

    assert.equal(res.error, undefined);
    assert.ok(res.result);
    assert.equal(res.result.configured, false);
    assert.equal(res.result.fromEmail, "flas@mobidigisol.com");
    assert.equal(res.result.hasSmtpPassword, false);
    assert.equal(res.result.smtpPasswordMasked, "");
    assert.equal(res.result.hasImapPassword, false);
    assert.equal(res.result.imapPasswordMasked, "");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 4: UI Behavior & Route Protection Boundary
// ─────────────────────────────────────────────────────────────────────────────
describe("M1 Challenge: UI Behavior, Route Protection & Navigation", () => {
  const routePath = path.resolve("src/routes/_authenticated/companies.email-settings.tsx");
  const cardPath = path.resolve("src/components/companies/PlatformEmailSettingsCard.tsx");
  const navPath = path.resolve("src/lib/navigation.ts");
  const layoutPath = path.resolve("src/routes/_authenticated/route.tsx");

  test("UI-1: Route file exists and enforces super_admin gate", () => {
    assert.ok(fs.existsSync(routePath), "Route file must exist");
    const content = fs.readFileSync(routePath, "utf8");

    // Verify route path registration
    assert.ok(
      content.includes("/_authenticated/companies/email-settings"),
      "Must register createFileRoute for /_authenticated/companies/email-settings"
    );

    // Verify useAuth check
    assert.ok(content.includes("useAuth()"), "Must check user authentication state");
    assert.ok(content.includes("isSuperAdmin"), "Must check isSuperAdmin role");

    // Verify blocked rendering for unauthorized callers
    assert.ok(
      content.includes("!isSuperAdmin"),
      "Must contain conditional denial for !isSuperAdmin"
    );
    assert.ok(
      content.includes("This area is only available to the Flas platform manager"),
      "Must display unauthorized message to non-super-admins"
    );

    // Verify robots noindex meta tag
    assert.ok(
      content.includes('name: "robots", content: "noindex"'),
      "Must set robots noindex meta tag on super admin settings route"
    );
  });

  test("UI-2: PlatformEmailSettingsCard contains internal authorization guard", () => {
    assert.ok(fs.existsSync(cardPath), "Component file must exist");
    const content = fs.readFileSync(cardPath, "utf8");

    // Component must re-verify isSuperAdmin internally
    assert.ok(content.includes("const { isSuperAdmin"), "Card must verify isSuperAdmin");
    assert.ok(
      content.includes("if (!authLoading && !isSuperAdmin)"),
      "Card must guard rendering if not super admin"
    );

    // Component query must be disabled for non-super-admins
    assert.ok(
      content.includes("enabled: isSuperAdmin"),
      "Query must be disabled when isSuperAdmin is false"
    );

    // From email must be locked and disabled
    assert.ok(
      content.includes('value="flas@mobidigisol.com"'),
      "From email must be fixed to flas@mobidigisol.com"
    );
    assert.ok(
      content.includes("disabled") && content.includes("readOnly"),
      "From email input must be disabled and readOnly"
    );

    // Passwords must use password input type with eye toggle
    assert.ok(
      content.includes('type={showSmtpPass ? "text" : "password"}'),
      "SMTP password input must mask input chars by default"
    );
    assert.ok(
      content.includes('type={showImapPass ? "text" : "password"}'),
      "IMAP password input must mask input chars by default"
    );
  });

  test("UI-3: Navigation MANAGER_SECTION contains Platform Email route", async () => {
    assert.ok(fs.existsSync(navPath), "Navigation definition file must exist");
    const navMod = await import("../src/lib/navigation.ts");

    assert.ok(navMod.MANAGER_SECTION, "MANAGER_SECTION must be exported");
    assert.equal(navMod.MANAGER_SECTION.title, "Manager");

    const emailItem = navMod.MANAGER_SECTION.items.find(
      (item) => item.to === "/companies/email-settings"
    );
    assert.ok(emailItem, "MANAGER_SECTION must include /companies/email-settings");
    assert.equal(emailItem.label, "Platform Email");
  });

  test("UI-4: Layout strictly hides MANAGER_SECTION from non-super-admins", () => {
    assert.ok(fs.existsSync(layoutPath), "Layout route file must exist");
    const content = fs.readFileSync(layoutPath, "utf8");

    // Must conditionally include MANAGER_SECTION based on isSuperAdmin
    assert.ok(
      content.includes("isSuperAdmin ? [...NAV_SECTIONS, MANAGER_SECTION] : NAV_SECTIONS"),
      "Layout must strictly gate MANAGER_SECTION on isSuperAdmin"
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 5: Zod Schema & Input Boundary Hardening
// ─────────────────────────────────────────────────────────────────────────────
describe("M1 Challenge: Input Validation & Boundary Hardening", () => {
  const superAdminJwt = generateTestJwt({ sub: "user_super_admin" });

  test("INPUT-1: savePlatformEmailConfig rejects invalid fromEmail format", async () => {
    const res = await executeServerCall(serverFns.savePlatformEmailConfig, {
      headers: { authorization: `Bearer ${superAdminJwt}` },
      data: {
        fromEmail: "invalid-not-an-email",
        smtpHost: "smtp.mobidigisol.com",
        smtpPort: 465,
        smtpUser: "flas@mobidigisol.com",
        smtpPass: "secret",
      },
    });

    assert.equal(res.result, undefined);
    assert.ok(res.error, "Zod must reject malformed email");
  });

  test("INPUT-2: savePlatformEmailConfig rejects empty smtpHost", async () => {
    const res = await executeServerCall(serverFns.savePlatformEmailConfig, {
      headers: { authorization: `Bearer ${superAdminJwt}` },
      data: {
        smtpHost: "",
        smtpPort: 465,
        smtpUser: "flas@mobidigisol.com",
        smtpPass: "secret",
      },
    });

    assert.equal(res.result, undefined);
    assert.ok(res.error, "Zod must reject empty smtpHost");
  });

  test("INPUT-3: savePlatformEmailConfig rejects out-of-range port numbers", async () => {
    // Port > 65535
    const resHigh = await executeServerCall(serverFns.savePlatformEmailConfig, {
      headers: { authorization: `Bearer ${superAdminJwt}` },
      data: {
        smtpHost: "smtp.mobidigisol.com",
        smtpPort: 70000,
        smtpUser: "flas@mobidigisol.com",
        smtpPass: "secret",
      },
    });
    assert.equal(resHigh.result, undefined);
    assert.ok(resHigh.error, "Port 70000 must be rejected");

    // Port < 1
    const resLow = await executeServerCall(serverFns.savePlatformEmailConfig, {
      headers: { authorization: `Bearer ${superAdminJwt}` },
      data: {
        smtpHost: "smtp.mobidigisol.com",
        smtpPort: 0,
        smtpUser: "flas@mobidigisol.com",
        smtpPass: "secret",
      },
    });
    assert.equal(resLow.result, undefined);
    assert.ok(resLow.error, "Port 0 must be rejected");
  });

  test("INPUT-4: testPlatformEmailConnection rejects unsupported test types", async () => {
    const res = await executeServerCall(serverFns.testPlatformEmailConnection, {
      headers: { authorization: `Bearer ${superAdminJwt}` },
      data: { type: "telnet" },
    });

    assert.equal(res.result, undefined);
    assert.ok(res.error, "Zod enum must reject type 'telnet'");
  });

  test("INPUT-5: sendPlatformTestEmail rejects malformed recipient email", async () => {
    const res = await executeServerCall(serverFns.sendPlatformTestEmail, {
      headers: { authorization: `Bearer ${superAdminJwt}` },
      data: { recipient: "bad-recipient-address" },
    });

    assert.equal(res.result, undefined);
    assert.ok(res.error, "Zod must reject bad recipient email");
  });
});
