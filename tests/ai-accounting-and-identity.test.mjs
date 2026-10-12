// Two things the product believed about itself that were not true:
//
//   1. "Every AI call is counted against the workspace's ceiling, and a
//      workspace that brings its own provider key has its own key used."
//      The WhatsApp assistant -- the highest-volume AI feature there is --
//      called the platform gateway directly, so none of that applied to it.
//
//   2. "One place answers whose number this is." There were two, and they
//      disagreed: the webhook asked the database to normalize the number, the
//      template send compared the raw string.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { readFileSync } from "node:fs";

import {
  callFlashAi,
  generateBotReply,
  resolveContactByPhone,
  testAiProvider,
  sealSecret,
} from "../node_modules/.cache/flas-onboarding.mjs";

// Normalized, because these files are checked out with CRLF on Windows and a
// pattern describing two lines of source would not match them.
const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
    .split("\r\n")
    .join("\n");

const TENANT = "tenant-a";
let rows, rpc, requests, responder;

class Query {
  constructor(table) {
    this.table = table;
    this.filters = [];
  }
  select() {
    return this;
  }
  eq(column, value) {
    this.filters.push((r) => r[column] === value);
    return this;
  }
  not(column, operator, value) {
    if (operator === "is" && value === null) this.filters.push((r) => r[column] != null);
    return this;
  }
  order() {
    return this;
  }
  limit(n) {
    this.take = n;
    return this;
  }
  maybeSingle() {
    this.one = true;
    return this;
  }
  single() {
    this.one = true;
    return this;
  }
  insert(payload) {
    this.payload = payload;
    return this;
  }
  update(patch) {
    this.patch = patch;
    return this;
  }
  then(resolve, reject) {
    const table = (rows[this.table] ??= []);
    let found = table.filter((r) => this.filters.every((f) => f(r)));
    if (this.patch) for (const r of found) Object.assign(r, this.patch);
    if (this.payload) {
      const row = { id: `${this.table}-${table.length + 1}`, ...this.payload };
      table.push(row);
      found = [row];
    }
    if (this.take) found = found.slice(0, this.take);
    return Promise.resolve({ data: this.one ? (found[0] ?? null) : found, error: null }).then(
      resolve,
      reject,
    );
  }
}

const botSettings = {
  enabled: true,
  bot_name: "Flash Assistant",
  instructions: "Be helpful.",
  model: "google/gemini-3.7-flash",
  handoff_keywords: [],
  tenant_id: TENANT,
};

beforeEach(() => {
  rows = {
    conversations: [{ id: "c1", tenant_id: TENANT, contact_id: "contact-1", bot_enabled: true }],
    messages: [
      {
        conversation_id: "c1",
        tenant_id: TENANT,
        sender: "contact",
        body: "Do you deliver to Sharjah?",
        created_at: new Date().toISOString(),
      },
    ],
    contacts: [{ id: "contact-1", tenant_id: TENANT, name: "Angelina", phone: "+971501234567" }],
    products: [],
    business_profiles: [],
    website_sync_state: [],
    contact_identities: [],
  };
  rpc = {
    check_ai_rate_limit: { allowed: true },
    get_tenant_ai_key: null,
    record_ai_usage: null,
    resolve_contact_by_identity: null,
  };
  requests = [];
  responder = () =>
    new Response(
      JSON.stringify({
        choices: [
          { message: { content: JSON.stringify({ text: "Yes, we do.", handoff: false }) } },
        ],
      }),
    );
  globalThis.onboardingDb = {
    from: (table) => new Query(table),
    rpc: async (name, args) => {
      rpc.calls ??= [];
      rpc.calls.push({ name, args });
      return { data: rpc[name] ?? null, error: null };
    },
  };
  process.env.LOVABLE_API_KEY = "test-gateway-key";
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
    return responder();
  };
});

describe("the WhatsApp assistant is accounted for like every other AI feature", () => {
  it("records its usage against the workspace", async () => {
    const reply = await generateBotReply(TENANT, "c1", botSettings);
    assert.equal(reply?.text, "Yes, we do.");
    const usage = (rpc.calls ?? []).find((c) => c.name === "record_ai_usage");
    assert.ok(usage, "the call must land in the usage ledger");
    assert.equal(usage.args._tenant_id, TENANT);
    assert.equal(usage.args._feature, "whatsapp_bot");
    assert.equal(usage.args._ok, true);
  });

  it("does not answer at all once the workspace has hit its AI ceiling", async () => {
    // Refusing to answer hands the thread to a human, which is the honest
    // outcome. Before this, the ceiling simply did not apply to the bot.
    rpc.check_ai_rate_limit = { allowed: false, reason: "daily" };
    assert.equal(await generateBotReply(TENANT, "c1", botSettings), null);
    assert.equal(requests.length, 0, "no provider call may be made past the ceiling");
  });

  it("answers on the workspace's own provider key when one is configured", async () => {
    rpc.get_tenant_ai_key = { provider: "openai", api_key: "sk-workspace-own-key" };
    responder = () =>
      new Response(
        JSON.stringify({
          choices: [
            { message: { content: JSON.stringify({ text: "On our key.", handoff: false }) } },
          ],
        }),
      );
    const reply = await generateBotReply(TENANT, "c1", botSettings);
    assert.equal(reply?.text, "On our key.");
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /api\.openai\.com/);
    assert.match(String(requests[0].headers.Authorization), /sk-workspace-own-key/);
  });

  it("still sends the business prompt and the thread, in order", async () => {
    rows.messages.unshift({
      conversation_id: "c1",
      tenant_id: TENANT,
      sender: "bot",
      body: "Hello! How can I help?",
      created_at: new Date(Date.now() - 60_000).toISOString(),
    });
    await generateBotReply(TENANT, "c1", botSettings);
    const sent = requests[0].body;
    assert.match(sent.messages[0].content, /this business's AI assistant/);
    assert.equal(sent.messages[0].role, "system");
    assert.equal(sent.messages.at(-1).role, "user");
    assert.match(sent.messages.at(-1).content, /Do you deliver to Sharjah\?/);
    assert.equal(sent.response_format.type, "json_object");
    assert.equal(sent.model, "google/gemini-3.7-flash");
  });

  it("no longer calls the AI gateway from the WhatsApp code at all", () => {
    const wa = read("src/lib/wa.server.ts");
    assert.ok(
      !wa.includes("ai.gateway.lovable.dev"),
      "the assistant must go through callFlashAi, which applies the ceiling and the ledger",
    );
    assert.match(wa, /feature: "whatsapp_bot"/);
  });
});

describe("a conversation and a JSON answer work on every provider", () => {
  const turns = [
    { role: "user", content: "Do you ship to Dubai?" },
    { role: "assistant", content: "We do." },
  ];

  it("keeps the platform gateway on an endpoint that accepts both", async () => {
    await callFlashAi("system", "and to Sharjah?", { tenantId: TENANT, turns, json: true });
    assert.match(requests[0].url, /\/v1\/chat\/completions$/);
    assert.equal(requests[0].body.messages.length, 4);
    assert.equal(requests[0].body.response_format.type, "json_object");
  });

  it("maps an assistant turn to Gemini's own name for it", async () => {
    rpc.get_tenant_ai_key = { provider: "google", api_key: "google-key" };
    responder = () =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }));
    await callFlashAi("system", "and to Sharjah?", { tenantId: TENANT, turns, json: true });
    const sent = requests[0].body;
    assert.deepEqual(
      sent.contents.map((c) => c.role),
      ["user", "model", "user"],
    );
    assert.equal(sent.generationConfig.responseMimeType, "application/json");
  });

  it("leaves a single-shot call on the endpoint it already used", async () => {
    responder = () => new Response(JSON.stringify({ output_text: "plain text" }));
    const text = await callFlashAi("system", "one question", { tenantId: TENANT });
    assert.equal(text, "plain text");
    assert.match(requests[0].url, /\/v1\/responses$/);
  });
});

describe("AI resilience respects workspace choice and records actual outcomes", () => {
  const googleReply = () =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "OK" }] } }] }));
  function enableBackups() {
    rpc.get_tenant_ai_resilience = true;
    rpc.get_tenant_ai_key = { provider: "google", api_key: "google-key" };
    rows.ai_provider_keys = [
      { tenant_id: TENANT, provider: "google", api_key: "google-key", active: true },
      { tenant_id: "other-tenant", provider: "anthropic", api_key: "other-secret", active: true },
      { tenant_id: TENANT, provider: "openai", api_key: "own-backup", active: true },
    ];
  }
  it("uses the current Google model", async () => {
    rpc.get_tenant_ai_key = { provider: "google", api_key: "google-key" };
    responder = googleReply;
    await callFlashAi("system", "hello", { tenantId: TENANT });
    assert.match(requests[0].url, /gemini-3\.8-flash:generateContent$/);
  });
  it("does not turn on backups without workspace opt-in", async () => {
    rpc.get_tenant_ai_key = { provider: "google", api_key: "google-key" };
    responder = () => new Response("secret upstream body", { status: 404 });
    await assert.rejects(callFlashAi("system", "hello", { tenantId: TENANT }), /configured model/);
    assert.equal(requests.length, 1);
  });
  it("tries only this workspace's active backups and records both outcomes", async () => {
    enableBackups();
    responder = () =>
      requests.length === 1
        ? new Response("quota", { status: 429 })
        : new Response(JSON.stringify({ choices: [{ message: { content: "backup reply" } }] }));
    assert.equal(await callFlashAi("system", "hello", { tenantId: TENANT }), "backup reply");
    assert.equal(requests.length, 2);
    assert.equal(requests[1].headers.Authorization, "Bearer own-backup");
    const outcomes = rpc.calls
      .filter((x) => x.name === "record_ai_usage")
      .map((x) => [x.args._provider, x.args._ok]);
    assert.deepEqual(outcomes, [
      ["google", false],
      ["openai", true],
    ]);
  });
  it("uses built-in AI after the saved providers fail", async () => {
    enableBackups();
    responder = () =>
      requests.length < 3
        ? new Response("down", { status: 503 })
        : new Response(JSON.stringify({ output_text: "built-in reply" }));
    assert.equal(await callFlashAi("system", "hello", { tenantId: TENANT }), "built-in reply");
    assert.match(requests[2].url, /ai\.gateway\.lovable\.dev/);
  });
  it("does not switch providers to evade a safety refusal", async () => {
    enableBackups();
    responder = () => new Response(JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } }));
    await assert.rejects(callFlashAi("system", "hello", { tenantId: TENANT }), /safely answer/);
    assert.equal(requests.length, 1);
  });
  it("never leaks an upstream error body or credential", async () => {
    responder = () => new Response("test-gateway-key private customer text", { status: 500 });
    await assert.rejects(callFlashAi("system", "hello", { tenantId: TENANT }), (error) => {
      assert.doesNotMatch(error.message, /test-gateway-key|private customer/);
      return /temporarily unavailable/.test(error.message);
    });
  });
  it("counts malformed JSON and empty responses as failures", async () => {
    for (const body of ["not json", "{}", '{"output_text":42}']) {
      rpc.calls = [];
      responder = () => new Response(body);
      await assert.rejects(callFlashAi("system", "hello", { tenantId: TENANT }));
      assert.deepEqual(
        rpc.calls.filter((x) => x.name === "record_ai_usage").map((x) => x.args._ok),
        [false],
      );
    }
  });
  it("a health test does not pass by silently using a backup", async () => {
    enableBackups();
    responder = () => new Response("bad key", { status: 401 });
    await assert.rejects(testAiProvider(TENANT, "google"), /authenticate/);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.contents[0].parts[0].text, "Reply with OK.");
  });
  it("decrypts saved keys on the server", async () => {
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    try {
      rpc.get_tenant_ai_key = { provider: "google", api_key: await sealSecret("google-key") };
      responder = googleReply;
      await callFlashAi("system", "hello", { tenantId: TENANT });
      assert.equal(requests[0].headers["x-goog-api-key"], "google-key");
    } finally {
      delete process.env.TOKEN_ENCRYPTION_KEY;
    }
  });
  it("backs up after a network failure but never exceeds the candidate list", async () => {
    enableBackups();
    responder = () => {
      throw new TypeError("network down");
    };
    await assert.rejects(
      callFlashAi("system", "hello", { tenantId: TENANT }),
      /could not be reached/,
    );
    assert.equal(requests.length, 3);
  });
  it("keeps quota failures as a human handoff, even with backups", async () => {
    enableBackups();
    rpc.check_ai_rate_limit = { allowed: false, reason: "daily" };
    assert.equal(await generateBotReply(TENANT, "c1", botSettings), null);
    await assert.rejects(
      generateBotReply(TENANT, "c1", botSettings, { throwOnFailure: true }),
      /daily AI limit/,
    );
    assert.equal(requests.length, 0);
  });
});

describe("one place answers whose number this is", () => {
  it("finds the contact the database resolves the number to", async () => {
    rpc.resolve_contact_by_identity = [{ contact_id: "contact-1", branch_id: "branch-9" }];
    assert.deepEqual(await resolveContactByPhone(TENANT, "971501234567"), {
      contactId: "contact-1",
      branchId: "branch-9",
    });
  });

  it("falls back to the legacy column for a contact no identity row covers", async () => {
    assert.deepEqual(await resolveContactByPhone(TENANT, "+971501234567"), {
      contactId: "contact-1",
      branchId: null,
    });
  });

  it("does not guess when the number belongs to nobody", async () => {
    assert.equal(await resolveContactByPhone(TENANT, "+441234567890"), null);
  });

  it("never looks outside the workspace it was asked about", async () => {
    assert.equal(await resolveContactByPhone("tenant-b", "+971501234567"), null);
  });

  it("is what the template send uses, so a saved contact is not called unknown", () => {
    // The template send lives in the send pipeline now; the API function
    // only names the workspace and hands over.
    const crm = read("src/lib/wa-send.server.ts");
    assert.match(crm, /resolveContactByPhone/);
    assert.match(read("src/lib/crm.functions.ts"), /sendTemplate\(\{/);
    assert.ok(
      !/\.eq\("phone", phone\)/.test(crm),
      "comparing the raw string made a contact saved in another format invisible",
    );
  });
});

describe("the migrations that go with these fixes", () => {
  const identity = read("supabase/migrations/20260925120000_phone_identity_one_canonical_form.sql");
  const defaults = read(
    "supabase/migrations/20260925121000_default_wa_number_is_per_workspace.sql",
  );

  it("gives a phone number one canonical form: its digits", () => {
    assert.match(identity, /regexp_replace\(btrim\(_value\), '\[\^0-9\]', '', 'g'\)/);
    assert.match(identity, /'\^00', ''/);
    // The stored column has to be recomputed, not just the function replaced.
    assert.match(identity, /DROP COLUMN IF EXISTS normalized/);
    assert.match(identity, /ADD COLUMN normalized text\s*\n?\s*GENERATED ALWAYS AS/);
  });

  it("reports colliding contacts instead of losing one", () => {
    assert.match(identity, /RAISE WARNING/);
    assert.match(identity, /unique index NOT created/);
  });

  it("makes the default WhatsApp number one per workspace", () => {
    assert.match(defaults, /DROP INDEX IF EXISTS public\.wa_numbers_single_default;/);
    assert.match(
      defaults,
      /CREATE UNIQUE INDEX IF NOT EXISTS wa_numbers_single_default_per_tenant\s*\n?\s*ON public\.wa_numbers \(tenant_id\)\s*\n?\s*WHERE is_default;/,
    );
  });
});
