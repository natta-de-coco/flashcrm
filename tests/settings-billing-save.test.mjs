import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const require = createRequire(import.meta.url);
mkdirSync("node_modules/.cache", { recursive: true });
await build({
  entryPoints: ["src/lib/billing.functions.ts"],
  outfile: "node_modules/.cache/settings-billing-save.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["react", "react-dom"],
  logLevel: "error",
  plugins: [
    {
      name: "billing-save-boundaries",
      setup(bundle) {
        for (const [filter, name] of [
          [/^@tanstack\/react-start$/, "server-fn"],
          [/^@tanstack\/react-start\//, "auth"],
          [/auth-middleware$/, "auth"],
          [/^@\/lib\/billing.server$/, "billing"],
          [/^@\/lib\/audit.server$/, "audit"],
          [/client\.server$/, "admin"],
        ])
          bundle.onResolve({ filter }, () => ({ path: name, namespace: "billing-save-test" }));
        bundle.onLoad({ filter: /.*/, namespace: "billing-save-test" }, ({ path }) => ({
          contents:
            path === "server-fn"
              ? `export function createServerFn(){let validate=x=>x;const builder={middleware:()=>builder,inputValidator(fn){validate=fn;return builder},handler(fn){return async args=>fn({...args,data:validate(args.data)})}};return builder}`
              : path === "auth"
                ? "export const requireSupabaseAuth={};"
                : path === "billing"
                  ? `export async function requireTenantId(client){const result=await client.rpc('current_tenant_id');if(result.error)throw result.error;if(!result.data)throw new Error('No workspace');return result.data} export async function ensureBillingSettings(client,tenantId){globalThis.__billingSaveTest.prepared.push(tenantId);return {tenant_id:tenantId}}`
                  : path === "audit"
                    ? "export async function logAudit(event){globalThis.__billingSaveTest.audits.push(event)}"
                    : "export const supabaseAdmin={};",
          loader: "js",
        }));
      },
    },
  ],
});
const { saveBillingProfile } = require("../node_modules/.cache/settings-billing-save.cjs");

function fixture(options = {}) {
  const state = {
    prepared: [],
    audits: [],
    calls: [],
    billing: { tenant_id: "tenant-A", logo_url: "https://example.test/old.png", vat_number: "OLD" },
    business: options.missingBusiness
      ? null
      : {
          tenant_id: "tenant-A",
          tax_registration_number: "OLD",
          business_name: "Existing business",
          description: "Keep the advisor profile",
        },
    otherBusiness: {
      tenant_id: "tenant-B",
      tax_registration_number: "OTHER",
      business_name: "Other business",
    },
  };
  globalThis.__billingSaveTest = state;
  const client = {
    rpc: async (name) => {
      assert.equal(name, "current_tenant_id");
      return { data: options.noTenant ? null : "tenant-A", error: options.tenantError ?? null };
    },
    from(table) {
      const call = {
        table,
        op: "select",
        filters: [],
        payload: null,
        columns: null,
        upsertOptions: null,
      };
      const run = async () => {
        state.calls.push(structuredClone(call));
        if (table === "profiles")
          return { data: { staff_role: options.role ?? "company_admin" }, error: null };
        if (table === "billing_settings") {
          assert.equal(call.op, "update", "Billing must update the initialized workspace row");
          assert.deepEqual(call.filters, [["tenant_id", "tenant-A"]]);
          if (options.billingError) return { data: null, error: options.billingError };
          if (options.noBillingRow) return { data: null, error: null };
          Object.assign(state.billing, call.payload);
          return { data: { tenant_id: "tenant-A" }, error: null };
        }
        assert.equal(table, "business_profiles");
        assert.equal(call.op, "upsert", "The tax mirror must also support a missing profile");
        assert.deepEqual(call.filters, []);
        assert.deepEqual(call.upsertOptions, { onConflict: "tenant_id" });
        assert.deepEqual(Object.keys(call.payload).sort(), [
          "tax_registration_number",
          "tenant_id",
        ]);
        assert.equal(
          call.payload.tenant_id,
          "tenant-A",
          "Only the resolved workspace may be written",
        );
        if (options.mirrorThrows) throw new Error("Private database transport detail");
        if (options.mirrorError) return { data: null, error: options.mirrorError };
        if (options.noMirrorRow) return { data: null, error: null };
        if (state.business) Object.assign(state.business, call.payload);
        else state.business = { ...call.payload };
        // Like PostgREST, a write without .select() does not return the row.
        const returnedRow = options.mismatchedMirrorRow
          ? { tenant_id: "tenant-B" }
          : options.missingMirrorTenant
            ? {}
            : { tenant_id: state.business.tenant_id };
        return { data: call.columns ? returnedRow : null, error: null };
      };
      const chain = {
        select(columns) {
          call.columns = columns;
          return chain;
        },
        eq(column, value) {
          call.filters.push([column, value]);
          return chain;
        },
        update(payload) {
          call.op = "update";
          call.payload = payload;
          return chain;
        },
        upsert(payload, upsertOptions) {
          call.op = "upsert";
          call.payload = payload;
          call.upsertOptions = upsertOptions;
          return chain;
        },
        single: run,
        maybeSingle: run,
        then: (resolve, reject) => run().then(resolve, reject),
      };
      return chain;
    },
  };
  return {
    ...state,
    get business() {
      return state.business;
    },
    save: (data) => saveBillingProfile({ data, context: { userId: "caller-A", supabase: client } }),
    writes: (table) =>
      state.calls.filter((call) => ["update", "upsert"].includes(call.op) && call.table === table),
  };
}

test("a hosted HTTPS logo is actually persisted for the authenticated workspace", async () => {
  const db = fixture();
  assert.deepEqual(
    await db.save({ logo_url: "  https://example.test/new.png  ", tenant_id: "tenant-B" }),
    { ok: true },
  );
  assert.equal(db.billing.logo_url, "https://example.test/new.png");
  assert.equal(db.billing.vat_number, "OLD");
  assert.deepEqual(db.prepared, ["tenant-A"]);
  assert.deepEqual(db.calls[0].filters, [["id", "caller-A"]]);
  assert.equal(db.writes("billing_settings")[0].columns, "tenant_id");
  assert.equal(db.writes("business_profiles").length, 0);
  assert.equal(db.audits[0].tenantId, "tenant-A");
});

for (const logo of [null, "", "  "])
  test(`a logo can be cleared with ${JSON.stringify(logo)}`, async () => {
    const db = fixture();
    await db.save({ logo_url: logo });
    assert.equal(db.billing.logo_url, null);
    assert.equal(db.writes("billing_settings")[0].payload.logo_url, null);
  });

test("omitted logo and tax fields leave existing values and the tax mirror untouched", async () => {
  const db = fixture();
  await db.save({
    phone: "+971500000001",
    logo_url: undefined,
    tax_registration_number: undefined,
  });
  const patch = db.writes("billing_settings")[0].payload;
  assert.equal(Object.hasOwn(patch, "logo_url"), false);
  assert.equal(Object.hasOwn(patch, "vat_number"), false);
  assert.equal(db.billing.logo_url, "https://example.test/old.png");
  assert.equal(db.billing.vat_number, "OLD");
  assert.equal(db.business.tax_registration_number, "OLD");
  assert.equal(db.writes("business_profiles").length, 0);
});

test("an insecure logo URL is still refused before a database write", async () => {
  const db = fixture();
  await assert.rejects(db.save({ logo_url: "http://example.test/logo.png" }), /secure https/);
  assert.equal(db.calls.length, 0);
});

test("explicit null tax number clears both records, even when the legacy alias has old text", async () => {
  const db = fixture();
  assert.deepEqual(await db.save({ tax_registration_number: null, vat_number: "STALE-ALIAS" }), {
    ok: true,
  });
  assert.equal(db.billing.vat_number, null);
  assert.equal(db.business.tax_registration_number, null);
  assert.equal(db.writes("business_profiles")[0].columns, "tenant_id");
  assert.equal(db.audits[0].details.trn, null);
});

test("the named tax number takes precedence over a conflicting legacy alias", async () => {
  const db = fixture();
  await db.save({ tax_registration_number: "NEW", vat_number: "OLD-ALIAS" });
  assert.equal(db.billing.vat_number, "NEW");
  assert.equal(db.business.tax_registration_number, "NEW");
});

test("a missing business profile is created only for the resolved workspace", async () => {
  const db = fixture({ missingBusiness: true });
  const otherBefore = structuredClone(db.otherBusiness);
  assert.deepEqual(await db.save({ tax_registration_number: "NEW", tenant_id: "tenant-B" }), {
    ok: true,
  });
  assert.equal(db.billing.vat_number, "NEW");
  assert.deepEqual(db.business, { tenant_id: "tenant-A", tax_registration_number: "NEW" });
  assert.deepEqual(db.otherBusiness, otherBefore);
  assert.equal(db.writes("business_profiles")[0].columns, "tenant_id");
  assert.equal(db.audits.length, 1);
  assert.equal(db.audits[0].tenantId, "tenant-A");
});

test("updating the tax mirror preserves the existing business profile and other workspace", async () => {
  const db = fixture();
  const otherBefore = structuredClone(db.otherBusiness);
  await db.save({ tax_registration_number: "NEW", tenant_id: "tenant-B" });
  assert.equal(db.business.business_name, "Existing business");
  assert.equal(db.business.description, "Keep the advisor profile");
  assert.equal(db.business.tax_registration_number, "NEW");
  assert.deepEqual(db.otherBusiness, otherBefore);
});

test("an explicit tax clear can also initialize a missing business profile", async () => {
  const db = fixture({ missingBusiness: true });
  assert.deepEqual(await db.save({ tax_registration_number: null, vat_number: "STALE" }), {
    ok: true,
  });
  assert.equal(db.billing.vat_number, null);
  assert.deepEqual(db.business, { tenant_id: "tenant-A", tax_registration_number: null });
});

for (const options of [{ mismatchedMirrorRow: true }, { missingMirrorTenant: true }])
  test(`a ${Object.keys(options)[0]} cannot confirm the tax mirror save`, async () => {
    const db = fixture(options);
    await assert.rejects(db.save({ tax_registration_number: "NEW" }), (error) => {
      assert.match(error.message, /settings were saved, but the business profile tax number/);
      assert.doesNotMatch(error.message, /tenant-[AB]|Tax mirror/);
      return true;
    });
    assert.equal(db.billing.vat_number, "NEW");
    assert.equal(db.audits.length, 0, "An unconfirmed mirror must not get a complete-save audit");
  });

for (const vat of ["LEGACY", null])
  test(`the legacy VAT alias still supports ${vat === null ? "clearing" : "saving"}`, async () => {
    const db = fixture();
    await db.save({ vat_number: vat });
    assert.equal(db.billing.vat_number, vat);
    assert.equal(db.business.tax_registration_number, vat);
  });

for (const options of [
  { mirrorError: { message: "Private database policy detail" } },
  { noMirrorRow: true },
  { mirrorThrows: true },
])
  test(`a ${Object.keys(options)[0]} refuses full success after the primary save`, async () => {
    const db = fixture(options);
    await assert.rejects(db.save({ tax_registration_number: null }), (error) => {
      assert.match(error.message, /settings were saved, but the business profile tax number/);
      assert.doesNotMatch(error.message, /Private database/);
      return true;
    });
    assert.equal(db.billing.vat_number, null, "The separate primary update has already committed");
    assert.equal(db.business.tax_registration_number, "OLD");
    assert.equal(db.audits.length, 0, "A partial save must not get a complete-save audit");
  });

for (const options of [
  { billingError: new Error("Primary settings write refused") },
  { noBillingRow: true },
])
  test(`a ${Object.keys(options)[0]} stops before any mirror or success audit`, async () => {
    const db = fixture(options);
    await assert.rejects(
      db.save({ tax_registration_number: null, logo_url: null }),
      /Primary settings write refused|Company settings could not be saved/,
    );
    assert.equal(db.billing.vat_number, "OLD");
    assert.equal(db.writes("business_profiles").length, 0);
    assert.equal(db.audits.length, 0);
  });

for (const role of ["staff", "marketing_manager", "seo_editor"])
  test(`${role} cannot save invoice company details`, async () => {
    const db = fixture({ role });
    await assert.rejects(db.save({ logo_url: null }), /Only a company admin/);
    assert.equal(db.prepared.length, 0);
    assert.equal(db.calls.filter((call) => call.op === "update").length, 0);
  });

test("a super admin still saves only their resolved workspace", async () => {
  const db = fixture({ role: "super_admin" });
  await db.save({ logo_url: "https://example.test/admin.png" });
  assert.equal(db.billing.logo_url, "https://example.test/admin.png");
  assert.equal(db.audits[0].tenantId, "tenant-A");
});

for (const options of [{ noTenant: true }, { tenantError: new Error("Workspace unavailable") }])
  test(`a ${Object.keys(options)[0]} cannot initialize or write settings`, async () => {
    const db = fixture(options);
    await assert.rejects(db.save({ logo_url: null }), /No workspace|Workspace unavailable/);
    assert.equal(db.prepared.length, 0);
    assert.equal(db.calls.filter((call) => call.op === "update").length, 0);
  });
