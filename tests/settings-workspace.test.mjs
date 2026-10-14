import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
mkdirSync("node_modules/.cache", { recursive: true });
function bundle(file, name) {
  buildSync({
    entryPoints: [file],
    outfile: `node_modules/.cache/${name}.cjs`,
    platform: "node",
    format: "cjs",
    bundle: true,
    logLevel: "error",
  });
  return require(`../node_modules/.cache/${name}.cjs`);
}
const settings = bundle("src/lib/settings-workspace.ts", "settings-workspace");
const billing = bundle("src/lib/settings-billing-profile.ts", "settings-billing");
const permissions = bundle("src/lib/permissions.ts", "settings-permissions");
test("personal settings are reachable without opening company email setup", () => {
  for (const role of ["staff", "marketing_manager", "seo_editor"]) {
    assert.equal(permissions.canOpen(role, "/settings"), true);
    assert.equal(permissions.canOpen(role, "/settings/email"), false);
  }
  for (const role of [null, undefined, "unknown"]) assert.equal(permissions.canOpen(role, "/settings"), false);
  assert.equal(permissions.canOpen("company_admin", "/settings/email"), true);
});
test("settings deep links accept only real section IDs", () => {
  assert.deepEqual(settings.parseSettingsSearch({ section: "invoices" }), { section: "invoices" });
  for (const section of [
    "billing/../security",
    "developer",
    ["company"],
    { id: "team" },
    undefined,
  ])
    assert.deepEqual(settings.parseSettingsSearch({ section }), {});
});
test("unknown and staff roles cannot discover company configuration", () => {
  for (const role of [null, undefined, "staff", "seo_editor", "marketing_manager", "unknown"]) {
    assert.deepEqual(
      settings.settingsSectionsFor(role).map((x) => x.id),
      ["profile", "security"],
    );
    assert.equal(settings.selectedSettingsSection("invoices", role), "profile");
  }
  for (const role of ["company_admin", "super_admin"])
    assert.equal(settings.settingsSectionsFor(role).length, 9);
});
test("a failed or absent read cannot create a loaded/saveable draft", () => {
  const state = settings.createSettingsDraft("A", { country: "AE" });
  assert.equal(state.loaded, false);
  assert.equal(settings.settingsDraftDirty(state), false);
  assert.equal(settings.synchronizeSettingsDraft(state, "A", { country: "AE" }, undefined), state);
});
test("a background refresh never overwrites edited region or logo values", () => {
  for (const key of ["country", "logo_url", "legal_name"]) {
    const initial = settings.createSettingsDraft("A", { [key]: "" }, { [key]: "saved" });
    const edited = { ...initial, draft: { [key]: "edited" } };
    assert.equal(settings.settingsDraftDirty(edited), true);
    const refreshed = settings.synchronizeSettingsDraft(
      edited,
      "A",
      { [key]: "" },
      { [key]: "refreshed" },
    );
    assert.deepEqual(refreshed.draft, edited.draft);
    assert.equal(settings.settingsDraftDirty(refreshed), true);
    assert.deepEqual(settings.resetSettingsDraft(refreshed).draft, { [key]: "refreshed" });
  }
});
test("clean settings follow genuine server updates", () => {
  const state = settings.createSettingsDraft("A", { name: "" }, { name: "first" });
  assert.deepEqual(
    settings.synchronizeSettingsDraft(state, "A", { name: "" }, { name: "second" }).draft,
    { name: "second" },
  );
});
test("resetting other edits keeps a separately uploaded and saved logo", () => {
  const initial = settings.createSettingsDraft(
    "A",
    { logo_url: "", terms: "" },
    { logo_url: "old", terms: "saved terms" },
  );
  const edited = { ...initial, draft: { logo_url: "uploaded", terms: "unsaved terms" } };
  const acknowledged = settings.acknowledgeSettingsDraft(edited, { logo_url: "uploaded" });
  assert.equal(settings.settingsDraftDirty(acknowledged), true);
  assert.deepEqual(settings.resetSettingsDraft(acknowledged).draft, {
    logo_url: "uploaded",
    terms: "saved terms",
  });
});
test("changing workspace discards the prior workspace's baseline and draft", () => {
  const original = settings.createSettingsDraft("A", { name: "" }, { name: "Company A" });
  original.draft = { name: "A's unsaved data" };
  const next = settings.synchronizeSettingsDraft(original, "B", { name: "" }, undefined);
  assert.equal(next.scope, "B");
  assert.equal(next.loaded, false);
  assert.deepEqual(next.draft, { name: "" });
  assert.deepEqual(
    settings.synchronizeSettingsDraft(next, "B", { name: "" }, { name: "Company B" }).draft,
    { name: "Company B" },
  );
});
test("switching settings sections is allowed, leaving dirty settings is blocked", () => {
  for (const path of ["/settings", "/settings/"])
    assert.equal(settings.shouldLeaveSettings(true, path), false);
  for (const path of ["/inbox", "/settings/email", "/settings-other"])
    assert.equal(settings.shouldLeaveSettings(true, path), true);
  assert.equal(settings.shouldLeaveSettings(false, "/inbox"), false);
});
test("invalid tax rates cannot silently become zero", () => {
  for (const taxRate of ["", "NaN", "Infinity", "-1", "101"]) {
    const value = { ...billing.EMPTY_BILLING_PROFILE, taxRate };
    assert.equal(billing.billingProfileProblem(value), "taxRate");
    assert.throws(() => billing.billingProfilePatch(value), /taxRate/);
  }
  for (const taxRate of ["0", "5", "15", "100"])
    assert.equal(
      billing.billingProfilePatch({ ...billing.EMPTY_BILLING_PROFILE, taxRate }).default_tax_rate,
      Number(taxRate),
    );
});
test("billing links refuse scripts and embedded credentials; payment links require HTTPS", () => {
  for (const website of [
    "javascript:alert(1)",
    "file:///local",
    "https://user:password@example.test",
  ])
    assert.equal(
      billing.billingProfileProblem({ ...billing.EMPTY_BILLING_PROFILE, website }),
      "website",
    );
  assert.equal(
    billing.billingProfileProblem({
      ...billing.EMPTY_BILLING_PROFILE,
      paymentUrl: "http://example.test/pay",
    }),
    "paymentUrl",
  );
  assert.equal(
    billing.billingProfileProblem({ ...billing.EMPTY_BILLING_PROFILE, email: "bad address" }),
    "email",
  );
  assert.equal(
    billing.billingProfileProblem({
      ...billing.EMPTY_BILLING_PROFILE,
      website: "https://example.test",
      paymentUrl: "https://example.test/pay",
      email: "test@example.test",
    }),
    null,
  );
});
test("the settings route preserves every existing card and isolates logo from company details", () => {
  const route = readFileSync("src/routes/_authenticated/settings.index.tsx", "utf8");
  for (const name of [
    "RegionCard",
    "CompanyBillingProfileCard",
    "BillingCard",
    "InvoiceBrandingCard",
    "AuditLogCard",
    "EmailMarketingCard",
    "LeadAlertsSettingsCard",
    "SecurityCard",
    "DataPrivacyCard",
    "TeamCard",
  ])
    assert.ok(route.includes(`<${name}`), name);
  assert.match(route, /InvoiceBrandingCard showCompanyDetails=\{false\}/);
  const brand = readFileSync("src/components/settings/InvoiceBrandingCard.tsx", "utf8");
  assert.match(
    brand,
    /showCompanyDetails \? companyDetails : \{ default_terms: snapshot.default_terms \}/,
  );
  assert.match(route, /SettingsDraftProvider/);
});
