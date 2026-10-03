// "We need an option to change language." The Settings language field saved a
// value nothing read, and <html lang="en"> was hard-coded. These pin the
// translation layer: a language we offer is complete, a missing key falls back
// to English rather than printing the key, the cookie cannot be tampered into
// anything else, and the server and the shell honour the direction.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function loadLib(relative, modules = {}) {
  const compiled = ts.transpileModule(readFileSync(new URL(relative, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, require: (id) => modules[id] ?? {} });
  return exports;
}
const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
    .split("\r\n")
    .join("\n");

const { en } = loadLib("../src/lib/i18n/en.ts");
const { ar } = loadLib("../src/lib/i18n/ar.ts");
const i18n = loadLib("../src/lib/i18n/index.ts", { "./en": { en }, "./ar": { ar } });
// Icons are irrelevant to which keys exist.
const { NAV_SECTIONS, MANAGER_SECTION } = loadLib("../src/lib/navigation.ts", {
  "lucide-react": new Proxy({}, { get: () => () => null }),
});

const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("a language we offer is a finished translation", () => {
  it("offers only languages that have one", () => {
    assert.deepEqual(
      [...i18n.UI_LANGUAGES].map((l) => l.code),
      ["en", "ar"],
    );
  });

  it("translates every English key into Arabic", () => {
    const missing = Object.keys(en).filter((key) => !(key in ar));
    assert.deepEqual(missing, [], `untranslated: ${missing.join(", ")}`);
  });

  it("has no Arabic key that English does not define", () => {
    const orphans = Object.keys(ar).filter((key) => !(key in en));
    assert.deepEqual(orphans, []);
  });

  it("keeps every {placeholder} the English text has", () => {
    for (const key of Object.keys(ar)) {
      assert.deepEqual(placeholders(ar[key]), placeholders(en[key]), key);
    }
  });

  it("is written in Arabic, not copied English", () => {
    const arabic = /[؀-ۿ]/;
    for (const [key, text] of Object.entries(ar)) {
      assert.match(text, arabic, `${key} has no Arabic letters`);
    }
  });

  it("marks Arabic as right-to-left", () => {
    assert.equal(i18n.directionOf("ar"), "rtl");
    assert.equal(i18n.directionOf("en"), "ltr");
  });
});

describe("every navigation entry has its text", () => {
  const items = [...NAV_SECTIONS, MANAGER_SECTION].flatMap((section) => [...section.items]);

  it("covers each item's label and description", () => {
    for (const item of items) {
      for (const part of ["label", "desc"]) {
        const key = i18n.navMessageKey(item.to, part);
        assert.ok(i18n.hasMessage(key), `${item.to} has no ${key}`);
      }
    }
  });

  it("keeps the English the sidebar showed before", () => {
    for (const item of items) {
      assert.equal(i18n.translate("en", i18n.navMessageKey(item.to, "label")), item.label);
      assert.equal(i18n.translate("en", i18n.navMessageKey(item.to, "desc")), item.desc);
    }
  });

  it("covers each section title", () => {
    for (const section of [...NAV_SECTIONS, MANAGER_SECTION]) {
      assert.ok(i18n.hasMessage(`nav.section.${section.title.toLowerCase()}`), section.title);
    }
  });
});

describe("translating", () => {
  it("fills placeholders", () => {
    assert.equal(i18n.translate("en", "auth.resendIn", { seconds: 42 }), "Resend available in 42s");
    assert.match(i18n.translate("ar", "auth.resendIn", { seconds: 42 }), /42/);
  });

  it("shows English, never the key, for a language that lacks a string", () => {
    assert.equal(i18n.translate("fr", "shell.signOut"), "Sign out");
  });

  it("refuses a computed key that does not exist", () => {
    assert.equal(i18n.hasMessage("nav.not-a-page.label"), false);
    assert.equal(i18n.hasMessage("toString"), false, "an inherited name is not a key");
  });
});

describe("the language cookie", () => {
  it("is read from among other cookies", () => {
    assert.equal(i18n.languageFromCookieHeader("sb=1; flas_lang=ar; theme=dark"), "ar");
  });

  it("is English when absent", () => {
    assert.equal(i18n.languageFromCookieHeader(""), "en");
    assert.equal(i18n.languageFromCookieHeader(undefined), "en");
  });

  it("cannot be set to anything we do not offer", () => {
    // It ends up in <html lang>; a crafted value must not.
    assert.equal(i18n.languageFromCookieHeader('flas_lang="><script>'), "en");
    assert.equal(i18n.languageFromCookieHeader("flas_lang=xx"), "en");
    assert.equal(i18n.languageFromCookieHeader("flas_lang=AR"), "ar");
  });

  it("is written for a year, site-wide, and only with an offered value", () => {
    assert.equal(i18n.languageCookie("ar"), "flas_lang=ar; Path=/; Max-Age=31536000; SameSite=Lax");
    assert.match(i18n.languageCookie("klingon"), /^flas_lang=en;/);
  });
});

describe("the company's language as a default", () => {
  it("applies to a teammate who has never chosen", () => {
    assert.equal(i18n.workspaceDefaultLanguage("sb=1", "ar", "en"), "ar");
  });

  it("never overrides a teammate's own choice", () => {
    assert.equal(i18n.workspaceDefaultLanguage("flas_lang=en", "ar", "en"), null);
  });

  it("does nothing for a language the interface does not have yet", () => {
    assert.equal(i18n.workspaceDefaultLanguage("", "fr", "en"), null);
  });

  it("does nothing when it is already showing", () => {
    assert.equal(i18n.workspaceDefaultLanguage("", "ar", "ar"), null);
  });
});

describe("the page is rendered in the chosen language and direction", () => {
  const root = read("src/routes/__root.tsx");
  const shell = read("src/routes/_authenticated/route.tsx");
  const auth = read("src/routes/auth.tsx");

  it("reads the language before rendering, on the server too", () => {
    assert.match(root, /beforeLoad: \(\) => \(\{ uiLanguage: readUiLanguage\(\) \}\)/);
    assert.match(root, /<html lang=\{uiLanguage\} dir=\{directionOf\(uiLanguage\)\}>/);
    assert.ok(!root.includes('<html lang="en">'), "the language was hard-coded");
  });

  it("puts the sidebar's resize edge and menu on the reading side", () => {
    assert.match(shell, /-end-1 w-2 cursor-col-resize/);
    assert.ok(!shell.includes("-right-1 w-2"), "a physical edge does not flip");
    assert.match(shell, /side=\{dir === "rtl" \? "right" : "left"\}/);
    assert.match(shell, /dir === "rtl" \? startX - ev\.clientX : ev\.clientX - startX/);
  });

  it("offers the switcher in the shell and on the sign-in page", () => {
    assert.ok(shell.split("<LanguageSwitcher").length - 1 >= 3, "sidebar, mobile menu, header");
    assert.match(auth, /<LanguageSwitcher /);
  });

  it("leaves no hard-coded English on the sign-in page", () => {
    for (const text of [
      "Every WhatsApp conversation, in one shared inbox.",
      "Forgot your password?",
      "Back to sign in",
      "Use a different email",
      '"Signing in…"',
      "Two-factor code",
    ]) {
      assert.ok(!auth.includes(text), `still hard-coded: ${text}`);
    }
  });
});
