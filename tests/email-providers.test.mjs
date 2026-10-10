// A company's outbound-email provider, held three ways against itself: what
// the settings screen offers, what the server agrees to save, and what the
// sender can actually send through.
//
// The review finding (PR #1): the screen offered "AWS SES" and "SMTP relay",
// the server saved them, and the sender answered "not implemented" for both —
// so a company that picked one had every email fail, and because it had saved
// its own key the platform's mailer was not used instead. No new provider is
// implemented here. The two are no longer offered or accepted, and a company
// that already saved one is told that it does not send and what to pick.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { runInNewContext } from "node:vm";

import {
  compileComponent,
  hookRuntime,
  jsxRuntime,
  loadLib,
  named,
  nodes,
  text,
} from "./support/component-double.mjs";
import { createDb } from "./support/db-double.mjs";
import { i18nModules } from "./support/i18n-double.mjs";

const { dispatchEmail, getTenantSmtpConfig, saveTenantSmtpConfig, sendTenantEmail } =
  await import("../node_modules/.cache/flas-email.mjs");

const compiled = compileComponent(
  new URL("../src/routes/_authenticated/settings.email.tsx", import.meta.url),
);
const emailProviders = loadLib(new URL("../src/lib/email-providers.ts", import.meta.url));

/** Everything that was ever on offer, plus things that never were. */
const EVER_OFFERED = ["platform", "resend", "postmark", "mailgun", "sendgrid", "ses", "smtp_relay"];
const NEVER_SENT = ["ses", "smtp_relay"];

const settings = (over = {}) => ({
  provider: "platform",
  from_email: null,
  from_name: null,
  reply_to: null,
  region: null,
  domain: null,
  verified: false,
  last_test_at: null,
  last_test_ok: null,
  last_test_error: null,
  ...over,
});

/** The Email delivery screen, with the server functions in the test's hands. */
function page(saved = settings()) {
  const runtime = hookRuntime();
  const saves = [];
  let stored = saved;
  const modules = {
    "react/jsx-runtime": jsxRuntime,
    react: runtime.react,
    "@tanstack/react-router": { createFileRoute: () => (options) => options },
    "@tanstack/react-start": { useServerFn: (fn) => fn },
    ...i18nModules,
    "@/lib/email-providers": emailProviders,
    "@/lib/tenant-smtp.functions": {
      getTenantSmtpConfig: async () => ({ ...stored }),
      saveTenantSmtpConfig: async ({ data }) => {
        saves.push({ ...data });
        stored = { ...stored, provider: data.provider };
        return { ok: true };
      },
      setTenantSmtpApiKey: async () => ({ ok: true }),
      testTenantSmtp: async () => ({ ok: true }),
    },
    sonner: { toast: { success() {}, error() {} } },
  };
  const exports = {};
  runInNewContext(compiled, {
    exports,
    require: (name) => modules[name] ?? new Proxy({}, { get: (_, key) => String(key) }),
  });
  const screen = () => nodes(runtime.render(exports.Route.component, {}));
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const providerSelect = () => screen().find(named("Select"));
  return {
    saves,
    screen,
    settle,
    /** Opens the page and waits for the saved settings to load. */
    async open() {
      screen();
      await settle();
      return screen();
    },
    offered: () =>
      nodes(providerSelect())
        .filter(named("SelectItem"))
        .map((item) => item.props.value),
    chosen: () => providerSelect().props.value,
    choose: (value) => providerSelect().props.onValueChange(value),
    warning: () => screen().find((n) => n.props?.role === "alert"),
    button: (label) => screen().find((n) => named("Button")(n) && text(n).trim() === label),
  };
}

// ── The sender, with the provider's HTTP API replaced ─────────────────────────
const requests = [];
const realFetch = globalThis.fetch;
function providerAnswers() {
  requests.length = 0;
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return new Response(JSON.stringify({ id: "msg-1", MessageID: "msg-1" }), {
      status: 200,
      headers: { "content-type": "application/json", "x-message-id": "msg-1" },
    });
  };
}
const message = {
  from: "Acme Trading <no-reply@acme.test>",
  to: "someone@example.test",
  subject: "Hello",
  text: "Hello",
  domain: "mg.acme.test",
};

/** True when the sender has code for this provider: it reaches the provider. */
async function canSendThrough(provider) {
  providerAnswers();
  const out = await dispatchEmail(provider, "test-key", message);
  return out.ok === true && requests.length === 1;
}

const db = createDb();
const ADMIN = "user-admin";
const TENANT = "tenant-acme";
const context = { supabase: db.client, userId: ADMIN };
const savedRow = () => db.table("tenant_smtp_config").find((row) => row.tenant_id === TENANT);

beforeEach(() => {
  globalThis.emailDb = db.client;
  globalThis.emailAudits = [];
  globalThis.fetch = realFetch;
  db.reset({
    profiles: [{ id: ADMIN, tenant_id: TENANT, staff_role: "company_admin" }],
    tenant_smtp_config: [],
  });
});

describe("the email settings screen offers only what can send", () => {
  it("offers a sender the code really has for every provider on the list", async () => {
    const h = page();
    await h.open();
    const offered = h.offered();
    assert.ok(offered.includes("platform"), "the platform default stays on offer");
    assert.ok(offered.length > 1, "and at least one provider of the company's own");
    for (const provider of offered.filter((p) => p !== "platform")) {
      assert.equal(
        await canSendThrough(provider),
        true,
        `"${provider}" is offered but nothing can be sent through it`,
      );
    }
  });

  it("no longer offers AWS SES or SMTP relay", async () => {
    const h = page();
    await h.open();
    for (const provider of NEVER_SENT) assert.equal(h.offered().includes(provider), false);
  });

  it("still offers everything that does send", async () => {
    const h = page();
    await h.open();
    assert.deepEqual([...h.offered()].sort(), [...emailProviders.SELECTABLE_PROVIDERS].sort());
    for (const provider of emailProviders.SENDING_PROVIDERS)
      assert.equal(await canSendThrough(provider), true, provider);
  });

  it("shows no warning to a company on a provider that sends", async () => {
    for (const provider of ["platform", "resend"]) {
      const h = page(settings({ provider }));
      await h.open();
      assert.equal(h.warning(), undefined);
      assert.equal(h.chosen(), provider);
      assert.equal(h.button("Save settings").props.disabled, false);
    }
  });
});

describe("a company that already saved a provider that never sent", () => {
  for (const [provider, name] of [
    ["ses", "AWS SES"],
    ["smtp_relay", "SMTP relay"],
  ]) {
    it(`is told ${name} does not send, and what to choose instead`, async () => {
      const h = page(settings({ provider }));
      await h.open();
      const words = text(h.warning());
      assert.match(words, new RegExp(name), "it names what they picked");
      assert.match(words, /not supported/);
      for (const working of ["Resend", "Postmark", "Mailgun", "SendGrid"])
        assert.match(words, new RegExp(working), `it names ${working} as a choice`);
    });

    it(`cannot save ${name} again, only replace it`, async () => {
      const h = page(settings({ provider }));
      await h.open();
      assert.equal(h.chosen(), "", "nothing is shown as chosen: the saved one is not on the list");
      assert.equal(h.button("Save settings").props.disabled, true);

      h.choose("resend");
      assert.equal(h.button("Save settings").props.disabled, false);
      assert.ok(h.warning(), "still warned until the new choice is actually saved");
      h.button("Save settings").props.onClick();
      await h.settle();
      assert.equal(h.saves.length, 1);
      assert.equal(h.saves[0].provider, "resend");
      assert.equal(h.warning(), undefined, "saved: the warning is gone");
    });

    it(`is not asked for an API key for ${name}`, async () => {
      // The key card invites pasting a key that nothing will ever use.
      const h = page(settings({ provider }));
      await h.open();
      assert.equal(h.button("Save API key"), undefined);
    });
  }
});

describe("the server accepts only a provider that can send", () => {
  it("refuses AWS SES and SMTP relay when asked directly, and saves nothing", async () => {
    // The screen's list is not the control: a request can be made without it.
    for (const provider of NEVER_SENT) {
      await assert.rejects(saveTenantSmtpConfig({ data: { provider }, context }));
      assert.equal(savedRow(), undefined, `${provider} must not be stored`);
    }
  });

  it("never stores a provider nothing can be sent through", async () => {
    for (const provider of [...EVER_OFFERED, "lovable", "smtp", "RESEND", ""]) {
      db.table("tenant_smtp_config").length = 0;
      const accepted = await saveTenantSmtpConfig({ data: { provider }, context }).then(
        () => true,
        () => false,
      );
      if (!accepted) {
        assert.equal(savedRow(), undefined, `"${provider}" was refused but stored anyway`);
        continue;
      }
      assert.equal(savedRow().provider, provider);
      if (provider !== "platform")
        assert.equal(await canSendThrough(provider), true, `"${provider}" was saved`);
    }
  });

  it("saves every provider the screen offers", async () => {
    const h = page();
    await h.open();
    for (const provider of h.offered()) {
      db.table("tenant_smtp_config").length = 0;
      await saveTenantSmtpConfig({
        data: { provider, fromEmail: "no-reply@acme.test" },
        context,
      });
      assert.equal(savedRow().provider, provider);
    }
  });

  it("lets a company move off a provider that never sent", async () => {
    db.table("tenant_smtp_config").push({ tenant_id: TENANT, provider: "ses", verified: true });
    await saveTenantSmtpConfig({ data: { provider: "resend" }, context });
    assert.equal(savedRow().provider, "resend");
    assert.equal(db.table("tenant_smtp_config").length, 1);
  });

  it("does not say saved when the database refuses", async () => {
    db.table("tenant_smtp_config").push({ tenant_id: TENANT, provider: "ses" });
    db.fail("tenant_smtp_config:upsert", { message: "connection reset" });
    await assert.rejects(
      saveTenantSmtpConfig({ data: { provider: "resend" }, context }),
      /could not be saved/,
    );
    assert.equal(savedRow().provider, "ses", "nothing changed, and nobody was told it had");
    assert.deepEqual(globalThis.emailAudits, [], "and no audit entry claims a save");
  });

  it("does not show the platform default when the saved settings cannot be read", async () => {
    // "Platform default" on screen would hide the warning from exactly the
    // company that needs it, and pressing Save would then overwrite its row.
    db.table("tenant_smtp_config").push({ tenant_id: TENANT, provider: "ses" });
    db.fail("tenant_smtp_config:read", { message: "statement timeout" });
    await assert.rejects(getTenantSmtpConfig({ context }), /could not be loaded/);
    db.recover("tenant_smtp_config:read");
    assert.equal((await getTenantSmtpConfig({ context })).provider, "ses");
  });

  it("reads the platform default for a company that has saved nothing", async () => {
    assert.equal((await getTenantSmtpConfig({ context })).provider, "platform");
  });
});

describe("the sender is honest about a provider it has no code for", () => {
  for (const [provider, name] of [
    ["ses", "AWS SES"],
    ["smtp_relay", "SMTP relay"],
  ]) {
    it(`says in plain words that ${name} did not send`, async () => {
      providerAnswers();
      const out = await dispatchEmail(provider, "test-key", message);
      assert.equal(out.ok, false);
      assert.equal(requests.length, 0, "nothing was sent anywhere");
      assert.match(out.error, new RegExp(name));
      assert.match(out.error, /not sent/);
      assert.match(out.error, /Resend, Postmark, Mailgun or SendGrid/);
      assert.doesNotMatch(out.error, /dispatcher|\.ts\b|not implemented/, "no developer notes");
    });
  }

  it("fails a company's email, clearly, rather than pretending it went", async () => {
    // Their own key is saved, so the platform's mailer is not used instead.
    db.table("tenant_smtp_config").push({
      tenant_id: TENANT,
      provider: "ses",
      from_email: "no-reply@acme.test",
    });
    db.state.rpcResults.get_tenant_smtp_api_key = "their-own-key";
    providerAnswers();
    const out = await sendTenantEmail(TENANT, {
      to: "someone@example.test",
      subject: "Activate acme.test",
      text: "link",
    });
    assert.equal(out.ok, false);
    assert.equal(requests.length, 0);
    assert.match(out.error, /AWS SES is not supported/);
    const logged = db.state.rpcCalls.find((call) => call.name === "log_email_delivery");
    assert.equal(logged.args._status, "failed", "the delivery log says it failed");
    assert.match(logged.args._error, /AWS SES is not supported/);
  });
});

// ── A database error is not "this company has no settings" ────────────────────
// The sender reads the company's row, then its key. Both used to ignore `error`,
// so a read that failed looked like "no settings saved" and the email went out
// through the platform's own mailer, from the platform's address, with `ok: true`.
describe("a database error does not send a company's email through the platform mailer", () => {
  const mail = { to: "someone@example.test", subject: "Activate acme.test", text: "link" };
  const COMPANY_ROW = {
    tenant_id: TENANT,
    provider: "sendgrid",
    from_email: "no-reply@acme.test",
  };
  const envBefore = {};
  const quietLog = console.error;
  let logged;
  let keyFault;
  let sent;

  /** What the platform's mailer or the company's provider is asked to do. */
  function mailerRecords() {
    sent = [];
    globalThis.fetch = async (url, init) => {
      sent.push({
        url: String(url),
        auth: String(init?.headers?.Authorization ?? ""),
        body: String(init?.body ?? ""),
      });
      return new Response(JSON.stringify({ id: "msg-1" }), {
        status: 200,
        headers: { "content-type": "application/json", "x-message-id": "msg-1" },
      });
    };
  }

  beforeEach(() => {
    for (const k of ["PLATFORM_EMAIL_PROVIDER", "PLATFORM_EMAIL_API_KEY", "PLATFORM_EMAIL_FROM"])
      envBefore[k] = process.env[k];
    process.env.PLATFORM_EMAIL_PROVIDER = "resend";
    process.env.PLATFORM_EMAIL_API_KEY = "platform-secret-key";
    process.env.PLATFORM_EMAIL_FROM = "no-reply@flas.test";
    logged = [];
    console.error = (...args) =>
      logged.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    // The double's rpc never fails; this one can, for the key lookup only.
    keyFault = null;
    globalThis.emailDb = {
      ...db.client,
      rpc: async (name, args) => {
        if (name === "get_tenant_smtp_api_key" && keyFault) {
          db.state.rpcCalls.push({ name, args });
          return { data: null, error: keyFault };
        }
        return db.client.rpc(name, args);
      },
    };
    db.table("tenant_smtp_config").push({ ...COMPANY_ROW });
    db.state.rpcResults.get_tenant_smtp_api_key = "their-own-key";
    mailerRecords();
  });

  afterEach(() => {
    console.error = quietLog;
    for (const [k, v] of Object.entries(envBefore)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const deliveryLog = () => db.state.rpcCalls.find((call) => call.name === "log_email_delivery");

  it("sends nothing when the company's settings cannot be read", async () => {
    db.fail("tenant_smtp_config:read", { message: "statement timeout" });
    const out = await sendTenantEmail(TENANT, mail);
    assert.equal(out.ok, false);
    assert.deepEqual(sent, [], "no request went anywhere, least of all to the platform mailer");
    assert.match(out.error, /could not be read/);
    assert.match(out.error, /not sent/);
    assert.doesNotMatch(out.error, /statement timeout/, "the technical reason is for the log");
    assert.ok(
      logged.some((line) => /statement timeout/.test(line)),
      "the technical reason is logged",
    );
    assert.equal(deliveryLog().args._status, "failed", "the delivery log says it failed");
    assert.doesNotMatch(deliveryLog().args._error, /statement timeout/);
  });

  it("sends nothing when the company's key cannot be read", async () => {
    keyFault = { message: "permission denied for function get_tenant_smtp_api_key" };
    const out = await sendTenantEmail(TENANT, mail);
    assert.equal(out.ok, false);
    assert.deepEqual(sent, [], "the platform mailer is not used in its place");
    assert.match(out.error, /could not be read/);
    assert.match(out.error, /not sent/);
    assert.doesNotMatch(out.error, /permission denied|get_tenant_smtp_api_key/);
    assert.ok(logged.some((line) => /permission denied/.test(line)));
    assert.equal(deliveryLog().args._status, "failed");
    assert.doesNotMatch(deliveryLog().args._error, /permission denied/);
  });

  it("still uses the platform mailer for a company that has saved nothing", async () => {
    db.table("tenant_smtp_config").length = 0;
    const out = await sendTenantEmail(TENANT, mail);
    assert.equal(out.ok, true);
    assert.equal(sent.length, 1);
    assert.match(sent[0].url, /api\.resend\.com/);
    assert.match(sent[0].auth, /platform-secret-key/);
  });

  it("sends through the company's own provider once the database recovers", async () => {
    db.fail("tenant_smtp_config:read", { message: "statement timeout" });
    assert.equal((await sendTenantEmail(TENANT, mail)).ok, false);
    db.recover("tenant_smtp_config:read");
    keyFault = { message: "connection reset" };
    assert.equal((await sendTenantEmail(TENANT, mail)).ok, false);
    keyFault = null;
    assert.deepEqual(sent, [], "neither failure sent anything");

    const out = await sendTenantEmail(TENANT, mail);
    assert.equal(out.ok, true);
    assert.equal(sent.length, 1);
    assert.match(sent[0].url, /api\.sendgrid\.com/, "their own provider, not the platform's");
    assert.match(sent[0].auth, /their-own-key/);
    assert.doesNotMatch(sent[0].auth, /platform-secret-key/);
  });
});
