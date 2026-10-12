// useI18n for a component that a test runs outside React: it answers in
// English, from the real message files, so a test still reads the words a
// person would see and a renamed key fails here rather than in production.
import { readdirSync, readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function englishMessages() {
  const dir = new URL("../../src/lib/i18n/screens/", import.meta.url);
  const english = {};
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".ts")) continue;
    const compiled = ts.transpileModule(readFileSync(new URL(file, dir), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText;
    const exports = {};
    // Each screen file is `export default screen({ en, ar, … })`.
    runInNewContext(compiled, { exports, require: () => ({ screen: (messages) => messages }) });
    Object.assign(english, exports.default?.en);
  }
  return english;
}

export const ENGLISH = englishMessages();

const known = (key) => Object.prototype.hasOwnProperty.call(ENGLISH, key);

const fill = (text, values = {}) =>
  text.replace(/\{(\w+)\}/g, (whole, name) =>
    name in values ? String(values[name] ?? "") : whole,
  );

function t(key, values) {
  if (!known(key)) throw new Error(`no message "${key}" in src/lib/i18n/screens`);
  return fill(ENGLISH[key], values);
}

/** Same splitting as interleave() in src/hooks/useI18n.tsx, without React keys. */
function tr(key, nodes = {}) {
  if (!known(key)) throw new Error(`no message "${key}" in src/lib/i18n/screens`);
  return ENGLISH[key].split(/(\{\w+\})/g).map((part) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1];
    return name && name in nodes ? nodes[name] : part;
  });
}

const i18n = {
  language: "en",
  dir: "ltr",
  t,
  tr,
  tx: (key, fallback, values) => (known(key) ? fill(ENGLISH[key], values) : fallback),
  setLanguage: () => {},
};

/** Drop-in for the "@/hooks/useI18n" and "@/lib/i18n" modules in a require map. */
export const i18nModules = {
  "@/hooks/useI18n": { useI18n: () => i18n },
  "@/lib/i18n": {
    hasMessage: known,
    navMessageKey: (to, part) => `nav.${to.replace(/^\//, "").replace(/\//g, ".")}.${part}`,
  },
};
