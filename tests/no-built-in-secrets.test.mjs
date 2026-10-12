// This repository is public. A key that has a fallback written in the source
// ("use the setting, or else this text") is a key anyone can read: if the
// setting is ever missing in production, the published text becomes the key.
// The unsubscribe link was signed that way until it was removed. This test
// fails on any line in src/ that puts a text value behind a secret, key, token
// or password setting, so the pattern cannot come back unnoticed.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

// process.env.NAME or process.env["NAME"], where NAME says it is a secret,
// followed by || or ?? and then a quoted text that is not empty.
const FALLBACK =
  /process\.env(?:\.|\[\s*["'`])\w*(?:SECRET|KEY|TOKEN|PASSWORD)\w*["'`]?\s*\]?\s*(?:\|\||\?\?)\s*(["'`])(?!\1)/i;

const srcRoot = new URL("../src/", import.meta.url);

function sourceFiles(dir = "") {
  const out = [];
  for (const entry of readdirSync(new URL(dir, srcRoot), { withFileTypes: true })) {
    const path = `${dir}${entry.name}`;
    if (entry.isDirectory()) out.push(...sourceFiles(`${path}/`));
    else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) out.push(path);
  }
  return out;
}

describe("no key has a built-in fallback value", () => {
  it("the pattern recognises the shapes it is meant to catch", () => {
    const bad = [
      'const k = process.env["APP_SIGNING_SECRET"] || "placeholder-value";',
      "const k = process.env.API_KEY ?? 'placeholder-value';",
      "const k = process.env['SOME_TOKEN'] || `placeholder-value`;",
      'const k = process.env.DB_PASSWORD || "x";',
    ];
    for (const line of bad) assert.match(line, FALLBACK, line);
  });

  it("the pattern leaves alone what is allowed", () => {
    const fine = [
      'const url = process.env["PUBLIC_APP_URL"] || "https://example.com";',
      'const k = process.env["APP_SIGNING_SECRET"] ?? "";',
      'const k = (process.env.API_KEY || "").trim();',
      'const k = process.env["APP_SIGNING_SECRET"];',
      "const k = process.env.API_KEY ?? process.env.OTHER_KEY;",
    ];
    for (const line of fine) assert.doesNotMatch(line, FALLBACK, line);
  });

  it("nothing under src/ falls back to a written-in key", () => {
    const found = [];
    for (const file of sourceFiles()) {
      const text = readFileSync(new URL(file, srcRoot), "utf8").split("\r\n").join("\n");
      text.split("\n").forEach((line, i) => {
        if (FALLBACK.test(line)) found.push(`src/${file}:${i + 1}`);
      });
    }
    assert.deepEqual(found, [], "a key must not have a value written in the source");
  });
});
