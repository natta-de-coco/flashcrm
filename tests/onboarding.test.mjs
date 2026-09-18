import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { createHmac, randomBytes } from "node:crypto";
import {
  openSecret,
  publicKnowledgeUrl,
  relevantWebsiteExcerpts,
  syncWebsiteKnowledge,
  sealSecret,
  resolveWaCredentials,
  verifyWaSignature,
  getBotSettings,
  generateBotReply,
  needsHumanHandoff,
  ingestInboundMessage,
  oauthPreflight,
  startAuthorization,
  getIntegrationReadiness,
  selectMetaTarget,
  selectConnectionTarget,
  saveAuthorizedConnection,
  processWaPayload,
} from "../node_modules/.cache/flas-onboarding.mjs";

let rows, operations, failingTable;
const tenant = "tenant-a";
class Query {
  constructor(table) {
    this.table = table;
    this.filters = [];
    this.mode = "read";
    this.max = Infinity;
  }
  select() {
    return this;
  }
  eq(k, v) {
    this.filters.push((r) => r[k] === v);
    return this;
  }
  neq(k, v) {
    this.filters.push((r) => r[k] !== v);
    return this;
  }
  is(k, v) {
    return this.eq(k, v);
  }
  order(column, options = {}) {
    this.sort = { column, ascending: options.ascending !== false };
    return this;
  }
  limit(n) {
    this.max = n;
    return this;
  }
  maybeSingle() {
    this.singleRow = true;
    return this;
  }
  single() {
    return this.maybeSingle();
  }
  insert(payload) {
    this.mode = "insert";
    this.payload = payload;
    return this;
  }
  upsert(payload) {
    return this.insert(payload);
  }
  update(payload) {
    this.mode = "update";
    this.payload = payload;
    return this;
  }
  delete() {
    this.mode = "delete";
    return this;
  }
  then(resolve, reject) {
    try {
      operations.push({ table: this.table, mode: this.mode });
      if (failingTable === this.table)
        return Promise.resolve({ data: null, error: { message: "Unavailable" } }).then(
          resolve,
          reject,
        );
      const table = (rows[this.table] ??= []);
      let found = table.filter((r) => this.filters.every((f) => f(r)));
      if (this.sort)
        found.sort(
          (a, b) =>
            String(a[this.sort.column]).localeCompare(String(b[this.sort.column])) *
            (this.sort.ascending ? 1 : -1),
        );
      found = found.slice(0, this.max);
      if (this.mode === "update") for (const row of found) Object.assign(row, this.payload);
      if (this.mode === "insert") {
        found = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((payload, i) => ({
          id: `created-${table.length + i}`,
          ...payload,
        }));
        table.push(...found);
      }
      if (this.mode === "delete") rows[this.table] = table.filter((r) => !found.includes(r));
      return Promise.resolve({
        data: this.singleRow ? (found[0] ?? null) : found,
        error: null,
      }).then(resolve, reject);
    } catch (e) {
      return Promise.reject(e).then(resolve, reject);
    }
  }
}
const db = {
  from: (table) => new Query(table),
  rpc: async (name) => ({
    data: name === "integration_oauth_storage_ready" ? true : tenant,
    error: null,
  }),
};
const context = { supabase: db, userId: "member" };
beforeEach(() => {
  rows = { profiles: [{ id: "member", tenant_id: tenant, staff_role: "member" }] };
  operations = [];
  failingTable = null;
  globalThis.onboardingDb = db;
  process.env.PUBLIC_APP_URL = "https://staging.example.test";
  process.env.OAUTH_ALLOWED_ORIGINS = " https://staging.example.test ";
  process.env.META_APP_ID = "test-app";
  process.env.META_APP_SECRET = "test-secret";
  process.env.TOKEN_ENCRYPTION_KEYS = `test:${randomBytes(32).toString("base64")}`;
  delete process.env.TOKEN_ENCRYPTION_KEY;
});

test("readiness and authorization agree; readiness writes nothing and exposes no admin diagnostics", async () => {
  const { rows: result } = await getIntegrationReadiness({
    data: { origin: process.env.PUBLIC_APP_URL },
    context,
  });
  const facebook = result.find((r) => r.id === "facebook");
  assert.equal(facebook.ready, true);
  assert.equal(facebook.callbackUri, null);
  assert.deepEqual(facebook.missing, []);
  assert.ok(operations.every((o) => o.mode === "read"));
  const auth = await startAuthorization({
    platform: "facebook",
    origin: process.env.PUBLIC_APP_URL,
    tenantId: tenant,
    userId: "member",
  });
  assert.equal(auth.ready, true);
  assert.equal(
    new URL(auth.url).searchParams.get("redirect_uri"),
    "https://staging.example.test/api/public/oauth-callback",
  );
  assert.equal(rows.oauth_states.length, 1);
  assert.equal(rows.oauth_states[0].state, undefined);
  assert.match(rows.oauth_states[0].state_hash, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(result).includes("test-secret"));
});

test("all setup failures are reported to admins and none create an OAuth attempt", async () => {
  rows.profiles[0].staff_role = "company_admin";
  delete process.env.META_APP_ID;
  delete process.env.META_APP_SECRET;
  process.env.PUBLIC_APP_URL = "staging.example.test";
  process.env.OAUTH_ALLOWED_ORIGINS = "https://another.example.test";
  process.env.TOKEN_ENCRYPTION_KEYS = "malformed";
  failingTable = "oauth_states";
  const { rows: result } = await getIntegrationReadiness({
    data: { origin: "https://staging.example.test" },
    context,
  });
  const row = result.find((r) => r.id === "facebook");
  assert.equal(row.ready, false);
  for (const code of [
    "PROVIDER_ID_MISSING",
    "PROVIDER_SECRET_MISSING",
    "PUBLIC_APP_URL_MISSING",
    "OAUTH_ORIGIN_MISSING",
    "TOKEN_ENCRYPTION_MISSING",
    "OAUTH_STORAGE_UNAVAILABLE",
  ])
    assert.ok(
      row.blockers.some((b) => b.code === code),
      code,
    );
  assert.equal(
    (
      await startAuthorization({
        platform: "facebook",
        origin: "https://staging.example.test",
        tenantId: tenant,
        userId: "member",
      })
    ).ready,
    false,
  );
  assert.ok(operations.every((o) => o.mode === "read"));
});

test("unreadable workspace credentials fail closed instead of silently switching apps", async () => {
  rows.platform_apps = [
    {
      tenant_id: tenant,
      provider: "meta",
      client_id: "workspace-app",
      client_secret: "enc:v1:missing:abc:def",
    },
  ];
  const result = await oauthPreflight("meta", tenant, process.env.PUBLIC_APP_URL);
  assert.equal(result.ready, false);
  assert.equal(result.credentialError, true);
});

test("shared Meta login configuration is never sent with a different workspace app", async () => {
  process.env.META_LOGIN_CONFIG_ID = "shared-config";
  rows.platform_apps = [
    {
      tenant_id: tenant,
      provider: "meta",
      client_id: "workspace-app",
      client_secret: "legacy-test-secret",
    },
  ];
  try {
    const result = await startAuthorization({
      platform: "facebook",
      origin: process.env.PUBLIC_APP_URL,
      tenantId: tenant,
      userId: "member",
    });
    assert.equal(result.ready, true);
    assert.equal(new URL(result.url).searchParams.has("config_id"), false);
  } finally {
    delete process.env.META_LOGIN_CONFIG_ID;
  }
});

test("both asset-selection handlers reject accounts from another tenant before contacting a provider", async () => {
  rows.social_accounts = [
    {
      id: "foreign",
      tenant_id: "tenant-b",
      platform: "facebook",
      access_token: "private",
      external_id: null,
    },
  ];
  await assert.rejects(
    selectMetaTarget({ data: { accountId: "foreign", pageId: "page" }, context }),
    /authorization/,
  );
  await assert.rejects(
    selectConnectionTarget({ data: { accountId: "foreign", targetId: "channel" }, context }),
    /not found/,
  );
  assert.ok(operations.every((o) => o.mode === "read"));
});

test("reconnecting preserves channel identity, history and refresh token; stores only encrypted new tokens", async () => {
  rows.social_accounts = [
    {
      id: "original",
      tenant_id: tenant,
      platform: "youtube",
      external_id: "channel",
      refresh_token: "old-refresh",
      connection_state: "disconnected",
      history: "keep",
    },
  ];
  const id = await saveAuthorizedConnection({
    tenantId: tenant,
    platform: "youtube",
    token: "new-token",
    expiresAt: null,
    grantedScopes: [],
    profile: { external_id: "channel", name: "Channel" },
    permissions: [],
  });
  assert.equal(id, "original");
  assert.equal(rows.social_accounts.length, 1);
  assert.equal(rows.social_accounts[0].history, "keep");
  assert.equal(await openSecret(rows.social_accounts[0].refresh_token), "old-refresh");
  assert.match(rows.social_accounts[0].refresh_token, /^enc:v1:/);
  assert.match(rows.social_accounts[0].access_token, /^enc:v1:/);
});

test("saving stops when encryption disappears after sign-in", async () => {
  delete process.env.TOKEN_ENCRYPTION_KEYS;
  await assert.rejects(
    saveAuthorizedConnection({
      tenantId: tenant,
      platform: "facebook",
      token: "do-not-store",
      expiresAt: null,
      profile: { external_id: "page" },
      permissions: [],
    }),
    /Secure credential storage/,
  );
  assert.ok(operations.every((o) => o.mode === "read"));
});

test("WhatsApp resolves only the selected workspace number and opens encrypted credentials", async () => {
  process.env.WHATSAPP_ACCESS_TOKEN = "must-not-fallback";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "unbound-platform-number";
  rows.wa_numbers = [
    {
      id: "a",
      tenant_id: tenant,
      active: true,
      is_default: true,
      phone_number_id: "phone-a",
      access_token: await sealSecret("token-a"),
    },
    {
      id: "b",
      tenant_id: "other",
      active: true,
      is_default: true,
      phone_number_id: "phone-b",
      access_token: "token-b",
    },
  ];
  assert.deepEqual(await resolveWaCredentials(tenant), {
    token: "token-a",
    phoneNumberId: "phone-a",
  });
  await assert.rejects(resolveWaCredentials(tenant, "b"), /No connected WhatsApp/);
  rows.wa_numbers[0].active = false;
  await assert.rejects(resolveWaCredentials(tenant), /No connected WhatsApp/);
  await assert.rejects(resolveWaCredentials(""), /workspace/);
  delete process.env.WHATSAPP_ACCESS_TOKEN;
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
});

test("bot settings never borrow another business's global instructions", async () => {
  rows.bot_settings = [{ id: true, instructions: "Another company private instructions" }];
  assert.equal(await getBotSettings(tenant), null);
  rows.tenant_bot_settings = [{ tenant_id: "other", instructions: "Private" }];
  assert.equal(await getBotSettings(tenant), null);
});

const botSettings = {
  enabled: true,
  bot_name: "Sam",
  greeting: "Hey, how can I help?",
  instructions: "We sell coffee and can help customers choose their blend.",
  model: "test-model",
  handoff_keywords: [],
};

test("bot uses only this tenant's catalog and latest conversation messages in chronological order", async () => {
  process.env.LOVABLE_API_KEY = "test-gateway-key";
  rows.conversations = [{ id: "chat", tenant_id: tenant }];
  rows.messages = Array.from({ length: 35 }, (_, i) => ({
    tenant_id: tenant,
    conversation_id: "chat",
    sender: "contact",
    body: `message-${i}`,
    created_at: String(i).padStart(2, "0"),
  }));
  rows.messages.push({
    tenant_id: "other",
    conversation_id: "chat",
    body: "PRIVATE MESSAGE",
    created_at: "99",
  });
  rows.products = [
    {
      tenant_id: tenant,
      title: "Coffee",
      sku: "coffee",
      price: 25,
      description: "Medium roast",
      specs: {},
    },
    { tenant_id: "other", title: "PRIVATE PRODUCT", price: 999 },
  ];
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (_, options) => {
    request = JSON.parse(options.body);
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                text: "Hey! Do you prefer a light or a stronger roast?",
                handoff: false,
              }),
            },
          },
        ],
      }),
    );
  };
  try {
    const result = await generateBotReply(tenant, "chat", botSettings);
    assert.equal(result.handoff, false);
    assert.equal(request.messages.length, 31);
    assert.equal(request.messages[1].content, "message-5");
    assert.equal(request.messages.at(-1).content, "message-34");
    assert.match(request.messages[0].content, /Coffee/);
    assert.match(request.messages[0].content, /Never pretend to be a human/);
    assert.ok(!JSON.stringify(request).includes("PRIVATE"));
    request = null;
    assert.equal(await generateBotReply("other", "chat", botSettings), null);
    assert.equal(request, null);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.LOVABLE_API_KEY;
  }
});

test("a model handoff actually pauses the bot and queues the conversation", async () => {
  process.env.LOVABLE_API_KEY = "test-gateway-key";
  rows.tenant_bot_settings = [{ tenant_id: tenant, ...botSettings }];
  rows.conversations = [
    { id: "chat", tenant_id: tenant, web_session_id: "session", bot_enabled: true },
  ];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                text: "I’ll leave this with the team so they can confirm.",
                handoff: true,
              }),
            },
          },
        ],
      }),
    );
  try {
    const result = await ingestInboundMessage({
      tenantId: tenant,
      channel: "web",
      sessionId: "session",
      text: "Can you guarantee tomorrow delivery?",
    });
    assert.match(result.reply, /team/);
    assert.equal(rows.conversations[0].bot_enabled, false);
    assert.equal(rows.conversations[0].status, "pending");
    assert.ok(needsHumanHandoff("Can I speak to a real person?", []));
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.LOVABLE_API_KEY;
  }
});

test("WhatsApp webhook batches cannot borrow the first number's app signature", async () => {
  rows.wa_numbers = [
    { phone_number_id: "a", active: true, app_secret: await sealSecret("app-a") },
    { phone_number_id: "b", active: true, app_secret: "app-b" },
  ];
  const raw = "signed payload";
  const signature = `sha256=${createHmac("sha256", "app-a").update(raw).digest("hex")}`;
  assert.equal(await verifyWaSignature(raw, ["a"], signature), true);
  assert.equal(await verifyWaSignature(raw, ["a", "b"], signature), false);
  assert.equal(await verifyWaSignature(raw, ["unknown"], signature), false);
  assert.equal(await verifyWaSignature("tampered", ["a"], signature), false);
});

test("website addresses reject local targets and discard query credentials", () => {
  for (const url of [
    "http://127.0.0.1",
    "http://169.254.169.254",
    "http://[::1]",
    "http://example.local.",
    "https://user:secret@example.com",
    "http://2130706433",
    "https://example.com:8443",
  ]) {
    assert.throws(() => publicKnowledgeUrl(url));
  }
  assert.equal(
    publicKnowledgeUrl("https://example.com/products?token=private#x"),
    "https://example.com/products",
  );
});

test("website retrieval finds relevant passages beyond the first paragraph and excludes older/different sources", () => {
  const page = {
    url: "https://example.com/shipping",
    title: "Shipping",
    indexed_at: "fresh",
    summary: "Company introduction. ".repeat(100) + "Furniture delivery takes three working days.",
  };
  const excerpts = relevantWebsiteExcerpts(
    [
      page,
      { ...page, url: "https://example.com.evil.com/shipping", summary: "PRIVATE" },
      { ...page, indexed_at: "old", summary: "OLD POLICY" },
    ],
    "How long does furniture delivery take?",
    "https://example.com",
    "fresh",
  );
  assert.ok(excerpts.some((p) => p.text.includes("three working days")));
  assert.ok(!JSON.stringify(excerpts).includes("PRIVATE"));
  assert.ok(!JSON.stringify(excerpts).includes("OLD POLICY"));
  assert.ok(excerpts.length <= 6);
});

test("reading a public website uses only the crawler endpoint, saves this tenant and reports partial discovery", async () => {
  process.env.FIRECRAWL_API_KEY = "test-crawler-key";
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.firecrawl.dev/v2/scrape");
    const request = JSON.parse(options.body);
    calls.push(request.url);
    if (request.url.includes("/failed")) return new Response("unavailable", { status: 503 });
    return new Response(
      JSON.stringify({
        success: true,
        data: {
          markdown:
            "Furniture delivery takes three working days. Contact the team to confirm stock.",
          metadata: { sourceURL: request.url, title: "Delivery" },
          links: [
            "https://example.com/failed",
            "https://evil.com/private",
            "http://127.0.0.1/admin",
          ],
        },
      }),
    );
  };
  try {
    const result = await syncWebsiteKnowledge(db, "https://example.com", tenant);
    assert.equal(result.pages, 1);
    assert.equal(result.skipped, 1);
    assert.deepEqual(calls, ["https://example.com/", "https://example.com/failed"]);
    assert.equal(rows.website_pages[0].tenant_id, tenant);
    assert.equal(rows.website_sync_state[0].tenant_id, tenant);
    assert.equal(rows.website_pages[0].indexed_at, rows.website_sync_state[0].last_synced_at);
    assert.ok(!JSON.stringify(rows).includes("test-crawler-key"));
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.FIRECRAWL_API_KEY;
  }
});

test("an unconfigured website reader does not fetch or claim ready", async () => {
  delete process.env.FIRECRAWL_API_KEY;
  await assert.rejects(syncWebsiteKnowledge(db, "https://example.com", tenant), /one-time setup/);
  assert.equal(rows.website_sync_state, undefined);
});

test("customer replies receive relevant website knowledge only from the current workspace snapshot", async () => {
  process.env.LOVABLE_API_KEY = "test-gateway-key";
  rows.conversations = [{ id: "chat", tenant_id: tenant }];
  rows.messages = [
    {
      conversation_id: "chat",
      tenant_id: tenant,
      sender: "contact",
      body: "How long is furniture delivery?",
      created_at: "today",
    },
  ];
  rows.website_sync_state = [
    {
      tenant_id: tenant,
      site_url: "https://example.com",
      status: "ready",
      last_synced_at: "fresh",
    },
  ];
  rows.website_pages = [
    {
      tenant_id: tenant,
      url: "https://example.com/delivery",
      title: "Delivery",
      summary: "Furniture delivery is three working days.",
      indexed_at: "fresh",
    },
    {
      tenant_id: "other",
      url: "https://example.com/delivery",
      title: "Delivery",
      summary: "PRIVATE OTHER TENANT",
      indexed_at: "fresh",
    },
  ];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_, options) => {
    const request = JSON.parse(options.body);
    assert.match(request.messages[0].content, /three working days/);
    assert.ok(!options.body.includes("PRIVATE OTHER TENANT"));
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                text: "The website says three working days. The team can confirm availability.",
                handoff: false,
              }),
            },
          },
        ],
      }),
    );
  };
  try {
    assert.ok(await generateBotReply(tenant, "chat", botSettings));
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.LOVABLE_API_KEY;
  }
});

// Meta redelivers a webhook it thinks was not received. A redelivered message
// must not be counted as unread again or answered again: the unique index on
// wa_message_id rejected the duplicate row, but that error was ignored and the
// bot replied a second time.
function watchInbound() {
  const calls = { fetch: 0, unread: 0 };
  const realFetch = globalThis.fetch;
  const realRpc = db.rpc;
  globalThis.fetch = async () => {
    calls.fetch += 1;
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ text: "Hello!", handoff: false }) } }],
      }),
    );
  };
  db.rpc = async (name, args) => {
    if (name === "increment_unread_count") calls.unread += 1;
    return realRpc(name, args);
  };
  return {
    calls,
    restore() {
      globalThis.fetch = realFetch;
      db.rpc = realRpc;
      delete process.env.LOVABLE_API_KEY;
    },
  };
}

function botReady() {
  process.env.LOVABLE_API_KEY = "test-gateway-key";
  rows.tenant_bot_settings = [{ tenant_id: tenant, ...botSettings }];
}

const redelivered = {
  tenantId: tenant,
  channel: "whatsapp",
  phone: "+971500000000",
  text: "Do you have this in blue?",
  waMessageId: "wamid.redelivered",
};

test("a redelivered WhatsApp message is not counted or answered twice", async () => {
  botReady();
  rows.messages = [
    { id: "m1", conversation_id: "chat", wa_message_id: "wamid.redelivered", tenant_id: tenant },
  ];
  const w = watchInbound();
  try {
    const result = await ingestInboundMessage(redelivered);
    assert.equal(result.duplicate, true);
    assert.equal(result.reply, null);
    assert.equal(rows.messages.length, 1);
    assert.equal(w.calls.fetch, 0, "the bot was not asked for a second reply");
    assert.equal(w.calls.unread, 0, "the unread count did not go up again");
  } finally {
    w.restore();
  }
});

test("two deliveries racing past the check stop at the unique index", async () => {
  botReady();
  const realFrom = db.from;
  db.from = (table) => {
    const q = realFrom(table);
    if (table === "messages") {
      q.insert = () => ({
        then: (resolve, reject) =>
          Promise.resolve({
            data: null,
            error: { code: "23505", message: "duplicate key value" },
          }).then(resolve, reject),
      });
    }
    return q;
  };
  const w = watchInbound();
  try {
    const result = await ingestInboundMessage(redelivered);
    assert.equal(result.duplicate, true);
    assert.equal(w.calls.fetch, 0);
    assert.equal(w.calls.unread, 0);
  } finally {
    db.from = realFrom;
    w.restore();
  }
});

test("a message that could not be saved is never answered", async () => {
  botReady();
  const realFrom = db.from;
  db.from = (table) => {
    const q = realFrom(table);
    if (table === "messages") {
      q.insert = () => ({
        then: (resolve, reject) =>
          Promise.resolve({ data: null, error: { code: "XX000", message: "Unavailable" } }).then(
            resolve,
            reject,
          ),
      });
    }
    return q;
  };
  const w = watchInbound();
  try {
    await assert.rejects(ingestInboundMessage(redelivered), /Could not store the inbound message/);
    assert.equal(w.calls.fetch, 0);
  } finally {
    db.from = realFrom;
    w.restore();
  }
});

// The webhook claims each message id before handling it. A claim that outlives
// a failed attempt made the in-app Retry skip the message and report success.
function webhookDouble() {
  const realFrom = db.from;
  const realRpc = db.rpc;
  const faults = { messages: null, webhook_dedup: null };
  // As in production: a returning number resolves to the contact it created.
  const digits = (v) => String(v ?? "").replace(/[^0-9]/g, "");
  db.rpc = async (name, args) => {
    if (name !== "resolve_contact_by_identity") return realRpc(name, args);
    const hit = (rows.contact_identities ?? []).find(
      (r) =>
        r.tenant_id === args._tenant_id &&
        r.kind === args._kind &&
        digits(r.value) === digits(args._value),
    );
    return { data: hit ? [{ contact_id: hit.contact_id, branch_id: null }] : [], error: null };
  };
  const refuse = (error) => ({
    then: (resolve, reject) => Promise.resolve({ data: null, error }).then(resolve, reject),
  });
  db.from = (table) => {
    const q = realFrom(table);
    const insert = q.insert.bind(q);
    q.insert = (payload) => {
      if (faults[table]) return refuse(faults[table]);
      // webhook_dedup's primary key, which the in-memory double does not enforce.
      const taken =
        table === "webhook_dedup" &&
        (rows.webhook_dedup ?? []).some(
          (r) => r.event_source === payload.event_source && r.event_id === payload.event_id,
        );
      if (taken) return refuse({ code: "23505", message: "duplicate key value" });
      return insert(payload);
    };
    return q;
  };
  return {
    faults,
    restore() {
      db.from = realFrom;
      db.rpc = realRpc;
    },
  };
}

const inboundWebhook = (id) => ({
  entry: [
    {
      changes: [
        {
          value: {
            metadata: { phone_number_id: "pn-1" },
            contacts: [{ profile: { name: "Sara" } }],
            messages: [{ id, from: "971500000000", type: "text", text: { body: "In stock?" } }],
          },
        },
      ],
    },
  ],
});
const storedWith = (id) => (rows.messages ?? []).filter((m) => m.wa_message_id === id);

test("retrying a webhook whose message could not be saved stores it the second time", async () => {
  rows.wa_numbers = [{ id: "num-1", tenant_id: tenant, phone_number_id: "pn-1", active: true }];
  const w = webhookDouble();
  try {
    w.faults.messages = { code: "XX000", message: "Unavailable" };
    await assert.rejects(
      processWaPayload(inboundWebhook("wamid.retry")),
      /Could not store the inbound message/,
    );
    assert.equal((rows.webhook_dedup ?? []).length, 0, "the claim was given back");

    // The database recovered and someone pressed Retry on the failed event.
    w.faults.messages = null;
    assert.equal(await processWaPayload(inboundWebhook("wamid.retry")), 1);
    assert.equal(storedWith("wamid.retry").length, 1);
    assert.equal(storedWith("wamid.retry")[0].tenant_id, tenant);
    assert.equal(rows.conversations.length, 1, "the retry reused the conversation");

    // Meta delivers the same message again: skipped, still stored once.
    assert.equal(await processWaPayload(inboundWebhook("wamid.retry")), 0);
    assert.equal(storedWith("wamid.retry").length, 1);
  } finally {
    w.restore();
  }
});

test("a transient failure recording the webhook event does not drop the message", async () => {
  rows.wa_numbers = [{ id: "num-1", tenant_id: tenant, phone_number_id: "pn-1", active: true }];
  const w = webhookDouble();
  const realError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(" "));
  try {
    w.faults.webhook_dedup = { code: "57014", message: "statement timeout" };
    await processWaPayload(inboundWebhook("wamid.transient"));
    assert.equal(storedWith("wamid.transient").length, 1);
    assert.ok(
      logged.some((line) => line.includes("could not record event for deduplication")),
      "the failure is logged, not silent",
    );
  } finally {
    console.error = realError;
    w.restore();
  }
});
