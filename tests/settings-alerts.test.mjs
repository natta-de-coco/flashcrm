import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
mkdirSync("node_modules/.cache", { recursive: true });
const plugin = {
  name: "settings-test-adapters",
  setup(build) {
    build.onResolve({ filter: /^@tanstack\/react-start$/ }, () => ({
      path: "server-fn",
      namespace: "settings-test",
    }));
    build.onResolve({ filter: /^@tanstack\/react-start\// }, () => ({
      path: "auth",
      namespace: "settings-test",
    }));
    build.onResolve({ filter: /auth-middleware$/ }, () => ({
      path: "auth",
      namespace: "settings-test",
    }));
    build.onResolve({ filter: /client\.server$/ }, () => ({
      path: "admin",
      namespace: "settings-test",
    }));
    build.onResolve({ filter: /^@\/lib\/billing.server$/ }, () => ({
      path: "billing",
      namespace: "settings-test",
    }));
    build.onResolve({ filter: /^@\/lib\/audit.server$/ }, () => ({
      path: "audit",
      namespace: "settings-test",
    }));
    build.onLoad({ filter: /.*/, namespace: "settings-test" }, ({ path }) => ({
      contents:
        path === "server-fn"
          ? `export function createServerFn(){let validate=x=>x;const builder={middleware:()=>builder,inputValidator(fn){validate=fn;return builder},handler(fn){return async args=>fn({...args,data:validate(args.data)})}};return builder}`
          : path === "auth"
            ? `export const requireSupabaseAuth={};`
            : path === "billing"
              ? `export async function ensureBillingSettings(){return {tenant_id:'tenant-A'}};export async function requireTenantId(client){const result=await client.rpc('current_tenant_id');if(result.error)throw result.error;if(!result.data)throw new Error('No workspace');return result.data}`
              : path === "audit"
                ? `export async function logAudit(){throw new Error('Audit must not run after an unsuccessful save')}`
                : `export const supabaseAdmin=new Proxy({}, {get:(_,key)=>globalThis.__settingsAdmin[key]});`,
      loader: "js",
    }));
  },
};
async function bundle(file, name) {
  await build({
    entryPoints: [file],
    outfile: `node_modules/.cache/${name}.cjs`,
    platform: "node",
    format: "cjs",
    bundle: true,
    plugins: [plugin],
    external: ["react", "react-dom"],
    logLevel: "error",
  });
  return require(`../node_modules/.cache/${name}.cjs`);
}
const alerts = await bundle("src/lib/lead-alerts.functions.ts", "settings-alert-endpoints");
const dispatcher = await bundle("src/lib/lead-alerts.server.ts", "settings-alert-dispatch");
const profile = await bundle("src/lib/profile-settings.functions.ts", "settings-profile-endpoints");
const billing = await bundle("src/lib/billing.functions.ts", "settings-billing-endpoints");
const billingForm = await bundle("src/lib/settings-billing-profile.ts", "settings-billing-form");
const notifications = await bundle(
  "src/lib/notifications.functions.ts",
  "settings-notification-endpoints",
);
function client(resolve) {
  const calls = [];
  return {
    calls,
    rpc: async (name) => ({ data: "tenant-A", error: null }),
    from(table) {
      const q = { table, op: "select", filters: [], payload: null };
      const run = async () => {
        calls.push(structuredClone(q));
        return resolve(q);
      };
      const chain = {
        select(columns, options) {
          q.columns = columns;
          q.options = options;
          return chain;
        },
        eq(column, value) {
          q.filters.push([column, value]);
          return chain;
        },
        in(column, value) {
          q.filters.push([column, value]);
          return chain;
        },
        is(column, value) {
          q.filters.push([column, value]);
          return chain;
        },
        order() {
          return chain;
        },
        limit() {
          return chain;
        },
        update(payload) {
          q.op = "update";
          q.payload = payload;
          return chain;
        },
        upsert(payload) {
          q.op = "upsert";
          q.payload = payload;
          return chain;
        },
        insert(payload) {
          q.op = "insert";
          q.payload = payload;
          return chain;
        },
        maybeSingle: run,
        single: run,
        then: (accept, reject) => run().then(accept, reject),
      };
      return chain;
    },
  };
}
const preferences = {
  leadAlertsEnabled: true,
  alertEmailAddresses: [],
  alertWhatsappEnabled: false,
  alertWhatsappPhone: null,
};
const context = (role = "company_admin", error = null) => ({
  userId: "caller-A",
  supabase: client(() => ({ data: { tenant_id: "tenant-A", staff_role: role }, error })),
});
test("ordinary roles cannot read or change company alert preferences through the server", async () => {
  globalThis.__settingsAdmin = client(() => {
    throw new Error("Service access must not happen");
  });
  for (const role of ["staff", "marketing_manager", "seo_editor", null])
    for (const endpoint of [alerts.getLeadAlertSettings, alerts.saveLeadAlertSettings])
      await assert.rejects(
        endpoint({ context: context(role), data: preferences }),
        /company admin/,
      );
  assert.equal(globalThis.__settingsAdmin.calls.length, 0);
});
test("manager alert operations use the caller's company, and reject caller-supplied tenant IDs", async () => {
  const db = client((q) => ({
    data: q.op === "select" ? { lead_alerts_enabled: true } : null,
    error: null,
  }));
  globalThis.__settingsAdmin = db;
  await alerts.getLeadAlertSettings({ context: context() });
  await alerts.saveLeadAlertSettings({
    context: context(),
    data: { ...preferences, alertEmailAddresses: [" One@EXAMPLE.test ", "one@example.test"] },
  });
  assert.deepEqual(db.calls[0].filters, [["tenant_id", "tenant-A"]]);
  assert.equal(db.calls[1].payload.tenant_id, "tenant-A");
  assert.deepEqual(db.calls[1].payload.alert_email_addresses, ["one@example.test"]);
  await assert.rejects(
    alerts.saveLeadAlertSettings({
      context: context(),
      data: { ...preferences, tenantId: "tenant-B" },
    }),
  );
});
test("alert read errors do not masquerade as default preferences", async () => {
  globalThis.__settingsAdmin = client(() => ({
    data: null,
    error: new Error("database unavailable"),
  }));
  await assert.rejects(alerts.getLeadAlertSettings({ context: context() }), /database unavailable/);
  await assert.rejects(
    alerts.getLeadAlertSettings({
      context: context("company_admin", new Error("profile read failed")),
    }),
    /profile read failed/,
  );
});
test("a raw WhatsApp alert cannot be re-enabled through preferences", async () => {
  globalThis.__settingsAdmin = client(() => {
    throw new Error("No write");
  });
  await assert.rejects(
    alerts.saveLeadAlertSettings({
      context: context(),
      data: { ...preferences, alertWhatsappEnabled: true, alertWhatsappPhone: "+971500000001" },
    }),
    /approved messaging/,
  );
});
test("the caller can change only their own display name, never their role or company", async () => {
  const db = client((q) => ({
    data: { full_name: q.payload?.full_name ?? "Previous" },
    error: null,
  }));
  const ctx = { userId: "caller-A", supabase: db };
  assert.deepEqual(
    await profile.saveOwnProfileSettings({ context: ctx, data: { fullName: "  Test name  " } }),
    { fullName: "Test name" },
  );
  assert.deepEqual(db.calls[0].payload, { full_name: "Test name" });
  assert.deepEqual(db.calls[0].filters, [["id", "caller-A"]]);
  for (const key of ["staff_role", "tenant_id", "userId", "email"])
    await assert.rejects(
      profile.saveOwnProfileSettings({
        context: ctx,
        data: { fullName: "Changed", [key]: "malicious" },
      }),
    );
});
test("missing or unreadable profiles cannot report successful profile saves", async () => {
  const missing = { userId: "caller-A", supabase: client(() => ({ data: null, error: null })) };
  await assert.rejects(profile.getOwnProfileSettings({ context: missing }), /not ready/);
  await assert.rejects(
    profile.saveOwnProfileSettings({ context: missing, data: { fullName: "Test" } }),
    /could not be saved/,
  );
});
test("opening company settings is read-only, and failed reads are surfaced", async () => {
  const db = client((q) => {
    assert.equal(q.op, "select");
    return { data: { vat_number: "TEST-TAX" }, error: null };
  });
  const result = await billing.getBillingProfile({ context: { userId: "caller-A", supabase: db } });
  assert.equal(result.tax_registration_number, "TEST-TAX");
  assert.deepEqual(db.calls[0].filters, [["tenant_id", "tenant-A"]]);
  await assert.rejects(
    billing.getBillingProfile({
      context: {
        userId: "caller-A",
        supabase: client(() => ({ data: null, error: new Error("read failed") })),
      },
    }),
    /read failed/,
  );
});
test("the first company settings edit preserves existing business details and tax without a GET write", async () => {
  const db = client((q) => {
    assert.equal(q.op, "select", "Opening Settings must not initialize billing rows");
    const rows = {
      billing_settings: null,
      business_profiles: {
        business_name: "Existing sample company",
        city: "Dubai",
        country: "AE",
        website_url: "https://example.test",
        tax_registration_number: "EXISTING-TAX",
      },
      organizations: { name: "Workspace name" },
    };
    return { data: rows[q.table], error: null };
  });
  const loaded = await billing.getBillingProfile({ context: { userId: "caller-A", supabase: db } });
  const draft = billingForm.billingProfileDraft(loaded);
  // The actual Settings form sends every draft field, even for an unrelated edit.
  const firstSave = billingForm.billingProfilePatch({ ...draft, phone: "+971500000001" });
  assert.equal(firstSave.legal_name, "Existing sample company");
  assert.equal(firstSave.trade_name, "Existing sample company");
  assert.equal(firstSave.address, "Dubai");
  assert.equal(firstSave.website, "https://example.test");
  assert.equal(firstSave.vat_number, "EXISTING-TAX");
  assert.equal(firstSave.tax_registration_number, "EXISTING-TAX");
  assert.equal(firstSave.phone, "+971500000001");
  assert.equal(firstSave.tax_label, "VAT");
  assert.equal(firstSave.default_tax_rate, 5);
  assert.equal(firstSave.default_payment_terms, "Net 30");
  assert.equal(loaded.country, "AE");
  for (const call of db.calls)
    assert.deepEqual(call.filters, [
      [call.table === "organizations" ? "id" : "tenant_id", "tenant-A"],
    ]);
});

test("company settings without billing or business details use the scoped workspace name", async () => {
  const db = client((q) => ({
    data: q.table === "organizations" ? { name: "New sample company" } : null,
    error: null,
  }));
  const result = await billing.getBillingProfile({ context: { userId: "caller-A", supabase: db } });
  assert.equal(result.legal_name, "New sample company");
  assert.equal(result.trade_name, "New sample company");
  assert.equal(result.tax_registration_number, null);
  const firstSave = billingForm.billingProfilePatch({
    ...billingForm.billingProfileDraft(result),
    phone: "+971500000001",
  });
  assert.equal(firstSave.tax_label, "VAT");
  assert.equal(firstSave.default_tax_rate, 5);
  assert.equal(firstSave.default_payment_terms, "Net 30");
  assert.ok(db.calls.every((call) => call.op === "select"));
});

test("saved billing values remain authoritative over business-profile seed values", async () => {
  for (const vat of ["SAVED-TAX", ""]) {
    const saved = {
      legal_name: "Saved invoice company",
      address: null,
      website: "",
      vat_number: vat,
      tax_label: "GST",
      default_tax_rate: 0,
      default_payment_terms: "Payment on receipt",
    };
    const db = client((q) => {
      assert.notEqual(
        q.table,
        "organizations",
        "Saved billing does not need an initialization seed",
      );
      return {
        data:
          q.table === "billing_settings"
            ? saved
            : {
                business_name: "Different business name",
                city: "Different city",
                website_url: "https://other.test",
                tax_registration_number: "PROFILE-TAX",
              },
        error: null,
      };
    });
    const result = await billing.getBillingProfile({
      context: { userId: "caller-A", supabase: db },
    });
    assert.equal(result.legal_name, saved.legal_name);
    assert.equal(result.address, null);
    assert.equal(result.website, "");
    assert.equal(result.tax_registration_number, vat);
    assert.equal(result.tax_label, saved.tax_label);
    assert.equal(result.default_tax_rate, saved.default_tax_rate);
    assert.equal(result.default_payment_terms, saved.default_payment_terms);
  }
});

test("failed business or workspace seed reads cannot become a blank saveable company form", async () => {
  for (const unavailable of ["business_profiles", "organizations"]) {
    const db = client((q) => ({
      data: null,
      error: q.table === unavailable ? new Error(`${unavailable} unavailable`) : null,
    }));
    await assert.rejects(
      billing.getBillingProfile({ context: { userId: "caller-A", supabase: db } }),
      new RegExp(`${unavailable} unavailable`),
    );
    assert.ok(db.calls.every((call) => call.op === "select"));
  }
});

test("a zero-row billing update cannot acknowledge a successful settings save", async () => {
  const db = client((q) =>
    q.table === "profiles"
      ? { data: { staff_role: "company_admin" }, error: null }
      : { data: null, error: null },
  );
  await assert.rejects(
    billing.saveBillingProfile({
      context: { userId: "caller-A", supabase: db },
      data: { legal_name: "Sample" },
    }),
    /could not be saved/,
  );
  assert.deepEqual(db.calls.find((q) => q.op === "update").filters, [["tenant_id", "tenant-A"]]);
});
test("lead notification dispatcher never claims an email/WA send without transport", async () => {
  const db = client((q) =>
    q.table === "tenant_alert_settings"
      ? {
          data: {
            lead_alerts_enabled: true,
            alert_email_addresses: ["test@example.test"],
            alert_whatsapp_enabled: true,
            alert_whatsapp_phone: "+971500000001",
          },
          error: null,
        }
      : {
          data:
            q.table === "profiles"
              ? [{ id: "admin-A", email: "admin@example.test", staff_role: "company_admin" }]
              : null,
          error: null,
        },
  );
  globalThis.__settingsAdmin = db;
  const result = await dispatcher.dispatchSalesLeadAlert({
    tenantId: "tenant-A",
    email: "demo@example.test",
  });
  assert.equal(result.notifiedEmails, 0);
  assert.equal(result.notifiedWhatsApp, false);
  assert.equal(result.notifiedInApp, true);
  assert.match(result.emailNotSent, /not emailed/);
  const evidence = db.calls.find((q) => q.table === "lead_alerts_log");
  assert.equal(evidence.payload.length, 2);
  assert.ok(evidence.payload.every((row) => row.status === "failed"));
  const notification = db.calls.find((q) => q.table === "workspace_notifications");
  assert.equal(notification.payload[0].tenant_id, "tenant-A");
  assert.equal(notification.payload[0].recipient_user_id, "admin-A");
});
test("disabled notifications and failed settings reads cannot trigger any write", async () => {
  for (const error of [null, new Error("failed")]) {
    const db = client((q) => ({ data: { lead_alerts_enabled: false }, error }));
    globalThis.__settingsAdmin = db;
    if (error)
      await assert.rejects(
        dispatcher.dispatchSalesLeadAlert({ tenantId: "tenant-A", email: "demo@example.test" }),
        /no alerts were sent/,
      );
    else
      assert.deepEqual(
        await dispatcher.dispatchSalesLeadAlert({
          tenantId: "tenant-A",
          email: "demo@example.test",
        }),
        { notifiedEmails: 0, notifiedWhatsApp: false, notifiedInApp: false },
      );
    assert.equal(db.calls.length, 1);
  }
});
test("an in-app database error is not counted as a successful notification", async () => {
  const db = client((q) =>
    q.table === "tenant_alert_settings"
      ? {
          data: { lead_alerts_enabled: true, alert_email_addresses: ["test@example.test"] },
          error: null,
        }
      : q.table === "workspace_notifications"
        ? { data: null, error: new Error("insert refused") }
        : {
            data:
              q.table === "profiles"
                ? [{ id: "admin-A", email: "admin@example.test", staff_role: "company_admin" }]
                : null,
            error: null,
          },
  );
  globalThis.__settingsAdmin = db;
  await assert.rejects(
    dispatcher.dispatchSalesLeadAlert({ tenantId: "tenant-A", email: "demo@example.test" }),
    /could not be saved/,
  );
});
test("notifications list and read acknowledgements are bound to caller and company", async () => {
  const id = "aaaaaaaa-0000-0000-0000-000000000001";
  const db = client((q) =>
    q.table === "profiles"
      ? { data: { tenant_id: "tenant-A", staff_role: "staff" }, error: null }
      : { data: q.options?.head ? null : [{ id }], count: q.options?.head ? 1 : null, error: null },
  );
  const ctx = { userId: "caller-A", supabase: db };
  const result = await notifications.listOwnNotifications({ context: ctx });
  assert.equal(result.unreadCount, 1);
  assert.deepEqual(
    await notifications.markOwnNotificationsRead({ context: ctx, data: { ids: [id] } }),
    { updatedIds: [id] },
  );
  for (const call of db.calls.filter((q) => q.table === "workspace_notifications")) {
    assert.ok(call.filters.some(([key, value]) => key === "tenant_id" && value === "tenant-A"));
    assert.ok(
      call.filters.some(([key, value]) => key === "recipient_user_id" && value === "caller-A"),
    );
    if (call.op === "update") assert.deepEqual(Object.keys(call.payload), ["read_at"]);
  }
  await assert.rejects(
    notifications.markOwnNotificationsRead({
      context: ctx,
      data: { ids: [id], tenant_id: "tenant-B" },
    }),
  );
});
test("notification failures do not become an empty inbox or successful read count", async () => {
  const id = "aaaaaaaa-0000-0000-0000-000000000001";
  for (const role of ["seo_editor", null])
    await assert.rejects(
      notifications.listOwnNotifications({ context: context(role) }),
      /not available/,
    );
  const db = client((q) =>
    q.table === "profiles"
      ? { data: { tenant_id: "tenant-A", staff_role: "staff" }, error: null }
      : { data: [], count: null, error: null },
  );
  await assert.rejects(
    notifications.listOwnNotifications({ context: { userId: "caller-A", supabase: db } }),
    /database setup/,
  );
  assert.deepEqual(
    await notifications.markOwnNotificationsRead({
      context: { userId: "caller-A", supabase: db },
      data: { ids: [id] },
    }),
    { updatedIds: [] },
  );
});
