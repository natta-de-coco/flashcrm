import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { z } from "zod";

const source = readFileSync(new URL("../src/lib/crm.functions.ts", import.meta.url), "utf8");
// Execute the actual input validator, including its refinements.
const schemaText = source.split("const TemplateSchema = ")[1].split("/** Sends")[0];
const schema = new Function("z", `return ${schemaText}`)(z);
const templateId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";

test("a conversation cannot lend its consent to a substituted recipient", () => {
  assert.equal(
    schema.safeParse({ templateId, conversationId, phone: "971501234567" }).success,
    false,
  );
});
test("a template request requires exactly one recipient source", () => {
  assert.equal(schema.safeParse({ templateId }).success, false);
  assert.equal(schema.safeParse({ templateId, conversationId }).success, true);
  assert.equal(schema.safeParse({ templateId, phone: "971501234567" }).success, true);
});
test("invalid conversation identifiers fail before database access", () => {
  assert.equal(schema.safeParse({ templateId, conversationId: "not-a-uuid" }).success, false);
});
