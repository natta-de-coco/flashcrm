// Adding a WhatsApp number.
//
// The number's access token and app secret were inserted straight from the
// browser and stored exactly as typed. These tests pin the server-side path
// that replaced it: sealed credentials, the caller's own workspace, admins
// only, no duplicate routing, and no secret coming back to the browser.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  WhatsAppNumberSchema,
  addWhatsAppNumber,
} from "../node_modules/.cache/flas-onboarding.mjs";

const TOKEN = "EAAG-test-whatsapp-access-token-0123456789";
const APP_SECRET = "0123456789abcdef0123456789abcdef";
const INPUT = {
  label: "Main number",
  displayPhone: "+971 50 000 0000",
  phoneNumberId: "112233445566778",
  accessToken: TOKEN,
  appSecret: APP_SECRET,
};

function withKeys(fn) {
  const before = process.env.TOKEN_ENCRYPTION_KEYS;
  process.env.TOKEN_ENCRYPTION_KEYS = `k1:${randomBytes(32).toString("base64")}`;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (before === undefined) delete process.env.TOKEN_ENCRYPTION_KEYS;
      else process.env.TOKEN_ENCRYPTION_KEYS = before;
    });
}

// The caller's own profile decides the workspace and whether they are an admin.
function context(role = "company_admin", tenant = "tenant-a") {
  return {
    userId: "user-1",
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: role ? { tenant_id: tenant, staff_role: role } : null,
            }),
          }),
        }),
      }),
    },
  };
}

// Service-role double for wa_numbers: filtered reads, counts and one insert.
function database(rows = []) {
  const inserted = [];
  globalThis.onboardingDb = {
    from(table) {
      assert.equal(table, "wa_numbers");
      const filters = [];
      const q = {
        select(_cols, options) {
          q.options = options;
          return q;
        },
        eq(column, value) {
          filters.push([column, value]);
          return q;
        },
        insert(row) {
          q.row = row;
          return q;
        },
        single: async () => {
          const id = `wa-${inserted.length + 1}`;
          inserted.push({ id, ...q.row });
          return { data: { id }, error: null };
        },
        then(resolve, reject) {
          const match = rows.filter((r) => filters.every(([c, v]) => r[c] === v));
          return Promise.resolve(
            q.options?.head ? { count: match.length, error: null } : { data: match, error: null },
          ).then(resolve, reject);
        },
      };
      return q;
    },
  };
  return inserted;
}

describe("adding a WhatsApp number", () => {
  it("stores the token and app secret encrypted, never as typed", () =>
    withKeys(async () => {
      const inserted = database();
      await addWhatsAppNumber({ data: INPUT, context: context() });
      const row = inserted[0];
      assert.match(row.access_token, /^enc:v1:/);
      assert.match(row.app_secret, /^enc:v1:/);
      assert.ok(!JSON.stringify(row).includes(TOKEN));
      assert.ok(!JSON.stringify(row).includes(APP_SECRET));
    }));

  it("saves into the caller's own workspace, first number as the default", () =>
    withKeys(async () => {
      const inserted = database();
      await addWhatsAppNumber({ data: INPUT, context: context("company_admin", "tenant-a") });
      assert.equal(inserted[0].tenant_id, "tenant-a");
      assert.equal(inserted[0].is_default, true);
    }));

  it("does not make a second number the default", () =>
    withKeys(async () => {
      const inserted = database([
        { id: "old", tenant_id: "tenant-a", phone_number_id: "999", active: true },
      ]);
      await addWhatsAppNumber({ data: INPUT, context: context() });
      assert.equal(inserted[0].is_default, false);
    }));

  it("returns only the new id, no credential", () =>
    withKeys(async () => {
      database();
      const result = await addWhatsAppNumber({ data: INPUT, context: context() });
      assert.deepEqual(Object.keys(result), ["id"]);
    }));

  it("refuses anyone who is not a company admin", () =>
    withKeys(async () => {
      const inserted = database();
      await assert.rejects(
        addWhatsAppNumber({ data: INPUT, context: context("agent") }),
        /Only company admins/,
      );
      assert.equal(inserted.length, 0);
    }));

  it("refuses to store anything when token encryption is not configured", async () => {
    const before = process.env.TOKEN_ENCRYPTION_KEYS;
    delete process.env.TOKEN_ENCRYPTION_KEYS;
    delete process.env.TOKEN_ENCRYPTION_KEY;
    try {
      const inserted = database();
      await assert.rejects(
        addWhatsAppNumber({ data: INPUT, context: context() }),
        /secure token storage/,
      );
      assert.equal(inserted.length, 0);
    } finally {
      if (before !== undefined) process.env.TOKEN_ENCRYPTION_KEYS = before;
    }
  });

  it("refuses a number that is already connected, here or in another workspace", () =>
    withKeys(async () => {
      const here = database([
        { id: "x", tenant_id: "tenant-a", phone_number_id: INPUT.phoneNumberId, active: true },
      ]);
      await assert.rejects(
        addWhatsAppNumber({ data: INPUT, context: context() }),
        /already connected to this workspace/,
      );
      assert.equal(here.length, 0);

      const elsewhere = database([
        { id: "y", tenant_id: "tenant-b", phone_number_id: INPUT.phoneNumberId, active: true },
      ]);
      await assert.rejects(
        addWhatsAppNumber({ data: INPUT, context: context() }),
        /already connected to another workspace/,
      );
      assert.equal(elsewhere.length, 0);
    }));
});

describe("what the browser may send", () => {
  it("accepts a complete number", () => {
    assert.equal(WhatsAppNumberSchema.parse(INPUT).phoneNumberId, INPUT.phoneNumberId);
  });

  it("ignores a workspace id supplied by the browser", () => {
    const parsed = WhatsAppNumberSchema.parse({ ...INPUT, tenantId: "someone-else" });
    assert.equal("tenantId" in parsed, false);
  });

  it("rejects a phone number instead of the phone number ID, and short tokens", () => {
    assert.throws(() => WhatsAppNumberSchema.parse({ ...INPUT, phoneNumberId: "+971500000000" }));
    assert.throws(() => WhatsAppNumberSchema.parse({ ...INPUT, accessToken: "short" }));
  });
});

describe("the browser can no longer write WhatsApp credentials", () => {
  const read = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

  it("no screen inserts into wa_numbers directly", () => {
    for (const file of [
      "src/components/integrations/CredentialsStep.tsx",
      "src/components/integrations/IntegrationSettings.tsx",
    ]) {
      assert.doesNotMatch(read(file), /from\("wa_numbers"\)\s*\.insert\(/, file);
    }
  });

  it("the migration removes browser inserts and token updates", () => {
    const sql = read("supabase/migrations/20260918100000_whatsapp_credentials_server_only.sql");
    assert.match(sql, /REVOKE INSERT ON public\.wa_numbers FROM anon, authenticated;/);
    assert.match(sql, /REVOKE UPDATE ON public\.wa_numbers FROM anon, authenticated;/);
    const grant = sql.match(/GRANT UPDATE \(([^)]*)\)/)[1];
    assert.doesNotMatch(grant, /access_token|app_secret/);
  });
});
