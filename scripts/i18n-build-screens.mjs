// Builds src/lib/i18n/screens/<name>.ts from what i18n-extract.mjs wrote:
//   <dir>/<ns>.en.json   { "ns.key": "English" }
//   <dir>/<ns>.tr.json   { "ns.key": ["Arabic", "Malay", "Filipino", "Swahili"] }
// and rewrites the screen list in src/lib/i18n/messages.ts from the files that
// exist. It refuses a namespace with a missing or extra translation, a lost
// {placeholder}, or an empty string, and says which key -- the compiler would
// catch a missing one too, but not a placeholder that changed its name.
//
// A screen that already exists is added to, not replaced: its current messages
// are kept and the ones in <dir> are laid over them, so extracting the new text
// of a page that is already translated cannot throw its translations away.
// Pass --replace to write exactly what <dir> holds (to delete a message).
//
// Usage: node scripts/i18n-build-screens.mjs <dir> [--replace] [ns...]   (no ns = every one with both files)
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const replace = args.includes("--replace");
const [dir, ...only] = args.filter((arg) => arg !== "--replace");
if (!dir) {
  console.error("usage: node scripts/i18n-build-screens.mjs <dir> [--replace] [ns...]");
  process.exit(1);
}
const LANGS = ["ar", "ms", "fil", "sw"];
const SCREENS_DIR = "src/lib/i18n/screens";
const kebab = (ns) => ns.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
const camel = (file) => file.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
const placeholders = (s) =>
  [...s.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join(",");

/** The messages a screen file holds now: { en, ar, ms, fil, sw }, or null. */
function current(ns) {
  const file = `${SCREENS_DIR}/${kebab(ns)}.ts`;
  if (!existsSync(file)) return null;
  const source = readFileSync(file, "utf8");
  const start = source.indexOf("screen(");
  const end = source.lastIndexOf(")");
  if (start < 0 || end < start) return null;
  try {
    // The argument of screen(...) is a plain object literal.
    return new Function(`return (${source.slice(start + "screen(".length, end)});`)();
  } catch {
    return null;
  }
}

const namespaces = (
  only.length
    ? only
    : readdirSync(dir)
        .filter((f) => f.endsWith(".en.json"))
        .map((f) => f.slice(0, -8))
).filter((ns) => existsSync(`${dir}/${ns}.en.json`) && existsSync(`${dir}/${ns}.tr.json`));

const problems = [];
let built = 0;
for (const ns of namespaces) {
  const kept = replace ? null : current(ns);
  const en = {};
  const tr = {};
  for (const key of Object.keys(kept?.en ?? {})) {
    en[key] = kept.en[key];
    tr[key] = LANGS.map((lang) => kept[lang]?.[key]);
  }
  Object.assign(en, JSON.parse(readFileSync(`${dir}/${ns}.en.json`, "utf8")));
  Object.assign(tr, JSON.parse(readFileSync(`${dir}/${ns}.tr.json`, "utf8")));
  const before = problems.length;
  for (const key of Object.keys(en)) {
    const row = tr[key];
    if (!Array.isArray(row) || row.length !== LANGS.length) {
      problems.push(`${ns}: ${key} needs ${LANGS.length} translations`);
      continue;
    }
    row.forEach((value, i) => {
      if (typeof value !== "string" || value.trim() === "")
        problems.push(`${ns}: ${key} [${LANGS[i]}] is empty`);
      else if (placeholders(value) !== placeholders(en[key]))
        problems.push(
          `${ns}: ${key} [${LANGS[i]}] placeholders {${placeholders(value)}} ≠ {${placeholders(en[key])}}`,
        );
      else if (
        /^\s/.test(en[key]) !== /^\s/.test(value) ||
        /\s$/.test(en[key]) !== /\s$/.test(value)
      )
        problems.push(`${ns}: ${key} [${LANGS[i]}] must keep the leading/trailing space`);
    });
  }
  for (const key of Object.keys(tr))
    if (!(key in en)) problems.push(`${ns}: ${key} is translated but not in English`);
  if (problems.length > before) continue;

  const block = (name, pick) =>
    `  ${name}: {\n${Object.keys(en)
      .map((key) => `    ${JSON.stringify(key)}: ${JSON.stringify(pick(key))},`)
      .join("\n")}\n  },`;
  const source = [
    `// Text for the "${ns}" screen, in every language. Extracted by`,
    "// scripts/i18n-extract.mjs; the Arabic, Malay, Filipino and Swahili are by",
    "// Claude and want a native speaker's review.",
    'import { screen } from "../define";',
    "",
    "export default screen({",
    block("en", (key) => en[key]),
    ...LANGS.map((lang, i) => block(lang, (key) => tr[key][i])),
    "});",
    "",
  ].join("\n");
  writeFileSync(`${SCREENS_DIR}/${kebab(ns)}.ts`, source);
  built++;
}

if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`${problems.length} problem(s); the affected screens were not written`);
}

// The screen list, from the files that exist.
const screenFiles = readdirSync(SCREENS_DIR)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => f.slice(0, -3))
  .sort();
const messagesPath = "src/lib/i18n/messages.ts";
const messages = readFileSync(messagesPath, "utf8").split("\r\n").join("\n");
const imports = screenFiles.map((f) => `import ${camel(f)} from "./screens/${f}";`).join("\n");
const list = `const SCREENS = [\n${screenFiles.map((f) => `  ${camel(f)},`).join("\n")}\n] as const;`;
const next = messages
  .replace(
    /(import \{ TRANSLATED_LANGUAGES \} from "\.\/define";\n)(?:import \w+ from "\.\/screens\/[^"]+";\n)+/,
    `$1${imports}\n`,
  )
  .replace(/const SCREENS = \[[^\]]*\] as const;/, list);
if (next === messages && !messages.includes(imports)) {
  console.error("could not update the screen list in messages.ts");
  process.exit(1);
}
writeFileSync(messagesPath, next);
console.log(`built ${built} screen file(s); ${screenFiles.length} screens registered`);
process.exit(problems.length ? 1 : 0);
