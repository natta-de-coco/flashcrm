// The chat widget on Flas's own marketing pages: which site's key it loads.
//
//   npm run test:homepage-widget
//
// The case that matters most is the hijack: lead_sites.domain is not unique,
// so a customer can register a site with Flas's own domain. If that site's key
// were ever chosen, the customer's inbox would receive every homepage visitor's
// name and WhatsApp number.
//
// MUTATION=any_tenant ignores the owner restriction. The suite MUST fail.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync("node_modules/.cache", { recursive: true });
buildSync({
  entryPoints: ["src/lib/homepage-widget.ts"],
  outfile: "node_modules/.cache/flas-homepage-widget.mjs",
  format: "esm",
  platform: "node",
  bundle: true,
  logLevel: "error",
});
const mod = await import("../node_modules/.cache/flas-homepage-widget.mjs");
const { domainCoversHost } = mod;

const MUTATION = process.env.MUTATION ?? "";
if (MUTATION === "any_tenant") console.log("!! MUTATION: owner restriction off — the suite must FAIL");
const pick = (sites, owners, host) =>
  mod.pickHomepageSite(
    sites,
    MUTATION === "any_tenant" ? [...new Set(sites.map((s) => s.tenant_id))] : owners,
    host,
  );

const OWNER = "owner-tenant";
const CUSTOMER = "customer-tenant";
const site = (over) => ({
  site_key: "key-owner",
  domain: "flas.mobidigisol.com",
  active: true,
  status: "active",
  tenant_id: OWNER,
  created_at: "2026-09-01T00:00:00Z",
  ...over,
});

describe("domain matching (same rule the chat endpoint enforces)", () => {
  test("exact host and subdomains match", () => {
    assert.equal(domainCoversHost("mobidigisol.com", "flas.mobidigisol.com"), true);
    assert.equal(domainCoversHost("flas.mobidigisol.com", "flas.mobidigisol.com"), true);
    assert.equal(domainCoversHost("FLAS.mobidigisol.com ", "flas.mobidigisol.com"), true);
  });
  test("lookalikes do not match", () => {
    assert.equal(domainCoversHost("flas.mobidigisol.com", "flas.mobidigisol.com.evil.test"), false);
    assert.equal(domainCoversHost("mobidigisol.com", "evilmobidigisol.com"), false);
    assert.equal(domainCoversHost(null, "flas.mobidigisol.com"), false);
    assert.equal(domainCoversHost("", "flas.mobidigisol.com"), false);
  });
});

describe("which site the homepage widget uses", () => {
  test("the owner's active site for this domain is used", () => {
    assert.equal(pick([site()], [OWNER], "flas.mobidigisol.com"), "key-owner");
  });

  test("a customer's site registered with Flas's domain is never used", () => {
    const hijack = site({ site_key: "key-customer", tenant_id: CUSTOMER, created_at: "2026-01-01T00:00:00Z" });
    assert.equal(pick([hijack], [OWNER], "flas.mobidigisol.com"), null);
    assert.equal(pick([hijack, site()], [OWNER], "flas.mobidigisol.com"), "key-owner");
  });

  test("an inactive, pending or unpinned owner site shows no widget", () => {
    assert.equal(pick([site({ active: false })], [OWNER], "flas.mobidigisol.com"), null);
    assert.equal(pick([site({ status: "pending" })], [OWNER], "flas.mobidigisol.com"), null);
    assert.equal(pick([site({ domain: null })], [OWNER], "flas.mobidigisol.com"), null);
  });

  test("a site for another domain is not used on this one", () => {
    assert.equal(pick([site({ domain: "atozsecurity.ae" })], [OWNER], "flas.mobidigisol.com"), null);
  });

  test("with two matching owner sites, the oldest wins, so adding one never swaps it", () => {
    const newer = site({ site_key: "key-newer", created_at: "2026-09-10T00:00:00Z" });
    assert.equal(pick([newer, site()], [OWNER], "flas.mobidigisol.com"), "key-owner");
  });

  test("no owner workspace means no widget", () => {
    assert.equal(pick([site()], [], "flas.mobidigisol.com"), null);
  });
});
