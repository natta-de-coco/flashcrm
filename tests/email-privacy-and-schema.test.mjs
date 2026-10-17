// tests/email-privacy-and-schema.test.mjs
// Verification suite for Stage 1 of Issue #78 & Codex Settings Audit:
// 1. tenant-smtp.functions.ts: resolveTenantAdmin role gate, getTenantSmtpConfig opt-in defaults, failed read state
// 2. user-email-accounts.functions.ts: personal mailbox isolation, shared/marketing admin check,
//    invalidation of verification on credential edit, deleteUserEmailAccount authorization
// 3. Schema hardening: non-destructive storage budget calculation, tenant SMTP null fallback removal
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

describe("Stage 1: Tenant SMTP Security and Opt-In Defaults", () => {
  const tenantSmtpSource = readFileSync("src/lib/tenant-smtp.functions.ts", "utf8");

  it("resolveTenantAdmin checks staff_role for company_admin or super_admin", () => {
    assert.match(
      tenantSmtpSource,
      /const role = String\(profile\.staff_role \?\? ""\);/,
      "Must extract staff_role",
    );
    assert.match(
      tenantSmtpSource,
      /!\["company_admin", "super_admin"\]\.includes\(role\)/,
      "Must forbid non-admin roles from managing workspace SMTP",
    );
    assert.match(
      tenantSmtpSource,
      /throw new Error\("Forbidden: requires company admin or super admin privileges"\)/,
      "Must raise clear forbidden error",
    );
  });

  it("getTenantSmtpConfig handles failed read error without swallowing", () => {
    assert.match(
      tenantSmtpSource,
      /const \{ data: row, error \} = await supabaseAdmin/,
      "Must capture error from supabaseAdmin read",
    );
    assert.match(
      tenantSmtpSource,
      /if \(error\) \{\s*throw new Error\(`Failed to load email settings: \$\{error\.message\}`\);?\s*\}/,
      "Must bubble read errors rather than falling back to default object",
    );
  });

  it("getTenantSmtpConfig returns opt-in defaults (welcomeEmailEnabled=false)", () => {
    assert.match(
      tenantSmtpSource,
      /welcomeEmailEnabled: false,/,
      "Must default welcomeEmailEnabled to false (opt-in)",
    );
    assert.match(
      tenantSmtpSource,
      /welcomeDiscountPercent: 0,/,
      "Must default welcomeDiscountPercent to 0",
    );
    assert.match(
      tenantSmtpSource,
      /welcomeDiscountCode: "",/,
      "Must default welcomeDiscountCode to empty string",
    );
  });

  it("saveTenantSmtpConfig enforces opt-in defaults", () => {
    assert.match(
      tenantSmtpSource,
      /welcome_email_enabled:\s*data\.welcomeEmailEnabled \?\? existingRow\?\.welcome_email_enabled \?\? false,/,
      "Must fallback to false when saving unspecified welcome_email_enabled",
    );
    assert.match(tenantSmtpSource, /verified: false,/, "Must reset verification state on save");
  });
});

describe("Stage 1: Multi-User Email Accounts Privacy & Ownership", () => {
  const userEmailSource = readFileSync("src/lib/user-email-accounts.functions.ts", "utf8");

  it("saveUserEmailAccount restricts shared/marketing accounts to workspace admins", () => {
    assert.match(
      userEmailSource,
      /const isAdmin = \["company_admin", "super_admin"\]\.includes\(String\(profile\.staff_role \?\? ""\)\);/,
      "Must determine isAdmin based on canonical staff_role",
    );
    assert.match(
      userEmailSource,
      /\(data\.accountType === "shared" \|\| data\.accountType === "marketing"\) && !isAdmin/,
      "Must gate shared/marketing accounts to workspace admins",
    );
  });

  it("saveUserEmailAccount prevents editing another user's personal mailbox", () => {
    assert.match(
      userEmailSource,
      /existing\.account_type === "personal" && existing\.user_id !== context\.userId && !isAdmin/,
      "Must prevent non-admin staff from editing other staff personal accounts",
    );
  });

  it("saveUserEmailAccount resets verification state on credential save", () => {
    assert.match(
      userEmailSource,
      /verified: false,\s*last_test_ok: null,\s*last_test_error: null,/,
      "Must invalidate verification state whenever account is saved or updated",
    );
  });

  it("testUserEmailAccount enforces personal mailbox ownership", () => {
    assert.match(
      userEmailSource,
      /acc\.account_type === "personal" && acc\.user_id !== context\.userId && !isAdmin/,
      "Must prevent non-admin staff from testing other staff personal accounts",
    );
  });

  it("deleteUserEmailAccount is implemented and strictly enforces tenant and role ownership", () => {
    assert.match(
      userEmailSource,
      /export const deleteUserEmailAccount = createServerFn/,
      "Must export deleteUserEmailAccount server function",
    );
    assert.match(
      userEmailSource,
      /acc\.account_type === "personal" && acc\.user_id !== context\.userId && !isAdmin/,
      "Must prevent unauthorized deletion of personal accounts",
    );
    assert.match(
      userEmailSource,
      /\(acc\.account_type === "shared" \|\| acc\.account_type === "marketing"\) && !isAdmin/,
      "Must require admin privileges to delete shared/marketing accounts",
    );
    assert.match(
      userEmailSource,
      /\.delete\(\)\s*\.eq\("id", data\.accountId\)\s*\.eq\("tenant_id", profile\.tenant_id\)/,
      "Must scope deletion strictly by ID and tenant ID",
    );
  });
});

describe("Stage 1: Forward Migration Schema Hardening", () => {
  const migrationSource = readFileSync(
    "supabase/migrations/20261014160000_email_schema_and_privacy_hardening.sql",
    "utf8",
  );

  it("revokes TRUNCATE/DELETE on platform_email_config from authenticated", () => {
    assert.match(
      migrationSource,
      /REVOKE ALL ON public\.platform_email_config FROM authenticated;/,
      "Must revoke broad ALL from authenticated",
    );
    assert.match(
      migrationSource,
      /GRANT SELECT, UPDATE ON public\.platform_email_config TO authenticated;/,
      "Must grant only SELECT, UPDATE to authenticated",
    );
  });

  it("restricts tenant_smtp_config columns from browser authenticated read (hiding credentials)", () => {
    assert.match(
      migrationSource,
      /REVOKE ALL ON public\.tenant_smtp_config FROM authenticated;/,
      "Must revoke ALL on tenant_smtp_config from authenticated",
    );
    assert.doesNotMatch(
      migrationSource,
      /GRANT SELECT \([^)]*smtp_pass_enc[^)]*\) ON public\.tenant_smtp_config/,
      "Must NOT grant SELECT on smtp_pass_enc to authenticated",
    );
    assert.doesNotMatch(
      migrationSource,
      /GRANT SELECT \([^)]*imap_pass_enc[^)]*\) ON public\.tenant_smtp_config/,
      "Must NOT grant SELECT on imap_pass_enc to authenticated",
    );
    assert.doesNotMatch(
      migrationSource,
      /GRANT SELECT \([^)]*api_key_enc[^)]*\) ON public\.tenant_smtp_config/,
      "Must NOT grant SELECT on api_key_enc to authenticated",
    );
  });

  it("removes cross-tenant LIMIT 1 fallback in guard_campaign_verified_smtp", () => {
    assert.match(
      migrationSource,
      /IF NEW\.tenant_id IS NULL THEN\s*RAISE EXCEPTION 'Cannot schedule or send campaign without a valid tenant_id';/s,
      "Must reject campaigns without tenant_id",
    );
    const fnBody = migrationSource.slice(
      migrationSource.indexOf("CREATE OR REPLACE FUNCTION public.guard_campaign_verified_smtp"),
      migrationSource.indexOf("$$;", migrationSource.indexOf("guard_campaign_verified_smtp")),
    );
    assert.doesNotMatch(
      fnBody,
      /LIMIT 1/,
      "Function body must not contain LIMIT 1 cross-tenant fallback",
    );
  });

  it("ensures drip automations duplicate pre-checks and reconciliation before indexing", () => {
    assert.match(
      migrationSource,
      /-- 3a\. Duplicate pre-check on drip_sequences/,
      "Must pre-check duplicate drip sequences",
    );
    assert.match(
      migrationSource,
      /-- 3b\. Duplicate pre-check on drip_steps/,
      "Must pre-check duplicate drip steps",
    );
    assert.match(
      migrationSource,
      /SET status = 'paused'/,
      "Must safely reconcile duplicate active enrollments by pausing older duplicates",
    );
    assert.match(
      migrationSource,
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_drip_sequences_tenant_trigger\s*ON public\.drip_sequences \(tenant_id, trigger_event\);/,
      "Must ensure unique trigger event per tenant",
    );
    assert.match(
      migrationSource,
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_drip_steps_sequence_step\s*ON public\.drip_steps \(sequence_id, step_number\);/,
      "Must ensure unique step number per sequence",
    );
    assert.match(
      migrationSource,
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_drip_enrollments_active_unique\s*ON public\.drip_enrollments \(tenant_id, sequence_id, email\)\s*WHERE status IN \('enrolled', 'in_progress'\);/,
      "Must ensure unique active enrollment per tenant, sequence, and email",
    );
  });

  it("handles concurrent sequence and enrollment creation in drip-automation.server.ts", () => {
    const dripServerSource = readFileSync("src/lib/drip-automation.server.ts", "utf8");
    assert.match(
      dripServerSource,
      /const \{ data: raced \} = await db\s*\.from\("drip_sequences"\)/,
      "Must resolve concurrent default sequence race condition",
    );
    assert.match(
      dripServerSource,
      /const \{ data: activeExisting \} = await db\s*\.from\("drip_enrollments"\)/,
      "Must resolve concurrent active enrollment race condition",
    );
  });

  it("provides explicit tenant RLS policy for drip_steps", () => {
    assert.match(
      migrationSource,
      /CREATE POLICY "drip_steps_tenant_isolation" ON public\.drip_steps/,
      "Must create tenant isolation policy for drip_steps",
    );
  });

  it("replaces check_and_prune_tenant_email_storage with non-destructive version", () => {
    assert.doesNotMatch(
      migrationSource,
      /DELETE FROM public\.portal_email_messages/,
      "Must NOT delete any emails in storage budget calculation",
    );
    assert.match(migrationSource, /'purged_count', 0/, "Must report purged_count as 0");
  });
});
