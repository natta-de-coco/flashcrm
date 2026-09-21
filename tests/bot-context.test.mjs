import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { generateBotReply } from "../node_modules/.cache/flas-onboarding.mjs";

// What the bot is told about time, the customer and the business decides
// whether a reply reads as the business answering or as a chatbot guessing.

function loadLib(relative) {
  const compiled = ts.transpileModule(readFileSync(new URL(relative, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, require: () => ({}) });
  return exports;
}
const { waitedFor, isLate, lateReplyRule } = loadLib("../src/lib/conversation-timing.ts");

const tenant = "tenant-a";
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();
const minutesAgo = (n) => new Date(Date.now() - n * 60000).toISOString();

let rows, sent;

class Query {
  constructor(table) {
    this.table = table;
    this.filters = [];
  }
  select() {
    return this;
  }
  eq(k, v) {
    this.filters.push((r) => r[k] === v);
    return this;
  }
  order(column, options = {}) {
    this.sort = { column, ascending: options.ascending !== false };
    return this;
  }
  limit() {
    return this;
  }
  maybeSingle() {
    this.one = true;
    return this;
  }
  single() {
    return this.maybeSingle();
  }
  then(resolve, reject) {
    let found = (rows[this.table] ?? []).filter((r) => this.filters.every((f) => f(r)));
    if (this.sort)
      found = [...found].sort(
        (a, b) =>
          String(a[this.sort.column] ?? "").localeCompare(String(b[this.sort.column] ?? "")) *
          (this.sort.ascending ? 1 : -1),
      );
    return Promise.resolve({ data: this.one ? (found[0] ?? null) : found, error: null }).then(
      resolve,
      reject,
    );
  }
}

const settings = {
  enabled: true,
  bot_name: "Flas",
  greeting: "Hi!",
  instructions: "We sell furniture in Dubai. Delivery across the UAE.",
  model: "google/gemini-2.5-flash",
  handoff_keywords: ["human"],
};

beforeEach(() => {
  sent = null;
  rows = {
    conversations: [{ id: "c1", tenant_id: tenant, bot_enabled: true, contacts: { name: "Sara" } }],
    business_profiles: [
      {
        tenant_id: tenant,
        business_name: "A to Z Furniture",
        city: "Dubai",
        country: "UAE",
        currency: "AED",
      },
    ],
    products: [],
    website_sync_state: [],
    messages: [],
  };
  globalThis.onboardingDb = {
    from: (table) => new Query(table),
    rpc: async () => ({ data: tenant, error: null }),
  };
  process.env.LOVABLE_API_KEY = "test-gateway-key";
  globalThis.fetch = async (_url, init) => {
    sent = JSON.parse(init.body);
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ text: "ok", handoff: false }) } }],
      }),
    );
  };
});

const prompt = () => sent.messages[0].content;
const conversation = () => sent.messages.slice(1);

test("a customer who has been waiting for days is answered as one", async () => {
  rows.messages = [
    {
      conversation_id: "c1",
      tenant_id: tenant,
      sender: "contact",
      body: "Do you deliver to Sharjah?",
      created_at: daysAgo(5),
    },
  ];
  await generateBotReply(tenant, "c1", settings);
  assert.match(prompt(), /last message arrived 5 days ago and is still unanswered/);
  assert.match(prompt(), /acknowledging the wait/);
  assert.match(conversation()[0].content, /^\[5 days ago\] Do you deliver to Sharjah\?$/);
});

test("a message answered straight away carries no apology instruction", async () => {
  rows.messages = [
    {
      conversation_id: "c1",
      tenant_id: tenant,
      sender: "contact",
      body: "Are you open?",
      created_at: minutesAgo(1),
    },
  ];
  await generateBotReply(tenant, "c1", settings);
  assert.doesNotMatch(prompt(), /still unanswered/);
  assert.match(conversation()[0].content, /^\[just now\] Are you open\?$/);
});

test("the bot knows the date, the customer and the business it speaks for", async () => {
  rows.messages = [
    {
      conversation_id: "c1",
      tenant_id: tenant,
      sender: "contact",
      body: "Price?",
      created_at: minutesAgo(5),
    },
  ];
  await generateBotReply(tenant, "c1", settings);
  assert.match(prompt(), /\nNow: \w{3}, \d{2} \w{3} \d{4}/);
  assert.match(prompt(), /\nCustomer: Sara/);
  assert.match(prompt(), /\nBusiness: A to Z Furniture, Dubai, UAE \| prices in AED/);
});

test("an unknown customer and a business with no profile still read cleanly", async () => {
  rows.conversations = [{ id: "c1", tenant_id: tenant, bot_enabled: true }];
  rows.business_profiles = [];
  rows.messages = [
    {
      conversation_id: "c1",
      tenant_id: tenant,
      sender: "contact",
      body: "Hello",
      created_at: minutesAgo(5),
    },
  ];
  await generateBotReply(tenant, "c1", settings);
  assert.match(prompt(), /\nCustomer: not known yet/);
  assert.match(prompt(), /\nBusiness: as described in the instructions/);
  assert.doesNotMatch(prompt(), /undefined|null/);
});

test("waiting time is said the way a person would say it", () => {
  const now = Date.parse("2026-09-21T12:00:00Z");
  const ago = (ms) => new Date(now - ms).toISOString();
  assert.equal(waitedFor(ago(30_000), now), "just now");
  assert.equal(waitedFor(ago(25 * 60_000), now), "25 minutes ago");
  assert.equal(waitedFor(ago(60 * 60_000), now), "an hour ago");
  assert.equal(waitedFor(ago(5 * 60 * 60_000), now), "5 hours ago");
  assert.equal(waitedFor(ago(26 * 60 * 60_000), now), "yesterday");
  assert.equal(waitedFor(ago(5 * 864e5), now), "5 days ago");
  assert.equal(waitedFor(ago(30 * 864e5), now), "4 weeks ago");
  assert.equal(waitedFor(null, now), null);
  assert.equal(waitedFor("not a date", now), null);
  assert.equal(isLate(ago(60 * 60_000), now), false);
  assert.equal(isLate(ago(6 * 60 * 60_000), now), true);
  assert.match(lateReplyRule("3 days ago"), /arrived 3 days ago/);
});
