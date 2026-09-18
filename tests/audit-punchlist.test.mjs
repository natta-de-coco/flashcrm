import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

describe("audit punch-list security fixes", () => {
  test("organizations SELECT is restricted to current tenant or super admin", async () => {
    const sql = await read("supabase/migrations/20260914090000_audit_punchlist_security.sql");
    assert.match(sql, /ALTER TABLE public\.organizations ENABLE ROW LEVEL SECURITY/i);
    assert.match(sql, /CREATE POLICY "orgs_read_own_tenant"/i);
    assert.match(sql, /id = public\.current_tenant_id\(\) OR public\.is_super_admin\(\)/i);
  });

  test("OAuth state consume and purge functions are not executable by browser roles", async () => {
    const sql = await read("supabase/migrations/20260914090000_audit_punchlist_security.sql");
    assert.match(
      sql,
      /REVOKE EXECUTE ON FUNCTION public\.consume_oauth_state_hash\(text\) FROM anon, authenticated/i,
    );
    assert.match(
      sql,
      /GRANT EXECUTE ON FUNCTION public\.consume_oauth_state_hash\(text\) TO service_role/i,
    );
    assert.match(sql, /REVOKE ALL ON public\.oauth_states FROM anon, authenticated/i);
  });

  test("contacts are rejected without a reachable channel and phone is E.164", async () => {
    const sql = await read("supabase/migrations/20260914090000_audit_punchlist_security.sql");
    assert.match(sql, /A contact needs at least one reachable channel/i);
    assert.match(sql, /\^\\\+\[1-9\]\[0-9\]\{7,14\}\$/);
    assert.match(sql, /contacts_reachability_guard/i);
  });
});

describe("integration readiness", () => {
  test("preflight checks credentials, app URL, origin and encryption without launching OAuth", async () => {
    const source = await read("src/lib/integration-readiness.functions.ts");
    const preflight = await read("src/lib/oauth-preflight.server.ts");
    assert.match(source, /oauthPreflight/);
    assert.match(preflight, /resolveCredentials/);
    assert.match(preflight, /PUBLIC_APP_URL/);
    assert.match(preflight, /resolveAllowedOrigin/);
    assert.match(preflight, /encryptionConfigured/);
    // A documentation comment may mention startAuthorization(), but readiness
    // must never actually call it with an argument object (that would write
    // oauth_states/audit side effects just by rendering the page).
    assert.doesNotMatch(source, /\bstartAuthorization\s*\(\s*\{/);
  });

  test("normal-user readiness does not return raw environment key names", async () => {
    const source = await read("src/lib/integration-readiness.functions.ts");
    assert.match(source, /missing: seesPlatform/);
    // Only FLAS staff: a company owner is an admin of their workspace, not of FLAS.
    assert.match(source, /const seesPlatform = role === "super_admin";/);
  });

  test("the Integrations route uses the audit-fixed readiness UI", async () => {
    const route = await read("src/routes/_authenticated/connect.tsx");
    assert.match(route, /IntegrationsAuditFixed/);
    const ui = await read("src/components/integrations-v2/IntegrationsAuditFixed.tsx");
    assert.match(ui, /getIntegrationReadiness/);
    assert.match(ui, /CredentialsStep/);
    assert.match(ui, /id="ai-keys"/);
  });
});

describe("noise control", () => {
  test("aborted navigation fetches are excluded from telemetry", async () => {
    const source = await read("src/lib/telemetry.ts");
    assert.match(source, /isAbortLikeError/);
    assert.match(source, /event\.preventDefault\(\)/);
  });
});
