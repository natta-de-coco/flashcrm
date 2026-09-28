import { test } from "node:test";
import assert from "node:assert/strict";
import { templateParameterCount, renderTemplateBody } from "../src/lib/wa-template-parameters.ts";

test("repeated placeholders reuse their positional value", () => {
  assert.equal(templateParameterCount("Hi {{1}}, order {{2}} for {{1}}"), 2);
  assert.equal(
    renderTemplateBody("Hi {{1}}, order {{2}} for {{1}}", ["Sam", "42"]),
    "Hi Sam, order 42 for Sam",
  );
});
test("replacement never interprets customer input as another placeholder", () => {
  assert.equal(renderTemplateBody("{{1}} {{2}}", ["{{2}}", "$&"]), "{{2}} $&");
});
test("missing, blank, oversized and extra variables fail closed", () => {
  for (const values of [[], [" "], ["x".repeat(501)], ["a", "b"]]) {
    assert.throws(() => renderTemplateBody("{{1}}", values));
  }
});
test("named, nonconsecutive and excessive parameters are visibly unsupported", () => {
  for (const body of ["{{name}}", "{{2}}", "{{0}}", "{{11}}"])
    assert.throws(() => templateParameterCount(body));
});
test("static and whitespace-separated placeholders render accurately", () => {
  assert.equal(renderTemplateBody("Hello", []), "Hello");
  assert.equal(renderTemplateBody("Hello {{ 1 }}", ["Sam"]), "Hello Sam");
});
