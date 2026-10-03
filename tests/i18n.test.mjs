// "We need an option to change language." The Settings language field saved a
// value nothing read, and <html lang="en"> was hard-coded. These pin the
// translation layer: every language we offer is complete on every screen, a
// missing key falls back to English rather than printing the key, the cookie
// cannot be tampered into anything else, and the server and the shell honour
// the direction.
//
// define.ts already makes a missing translation a compile error; these tests
// check what the compiler cannot -- placeholders, script, collisions.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

import * as i18n from "../node_modules/.cache/flas-i18n.mjs";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
    .split("\r\n")
    .join("\n");

const { MESSAGES, SCREEN_LIST, TRANSLATED_LANGUAGES, NAV_SECTIONS, MANAGER_SECTION } = i18n;
const en = MESSAGES.en;
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("every language we offer is a finished translation", () => {
  it("offers English, Arabic, Malay, Filipino and Swahili", () => {
    assert.deepEqual(
      i18n.UI_LANGUAGES.map((l) => l.code),
      ["en", "ar", "ms", "fil", "sw"],
    );
  });

  it("offers exactly the languages every screen is translated into", () => {
    assert.deepEqual(
      i18n.UI_LANGUAGES.map((l) => l.code).filter((c) => c !== "en"),
      [...TRANSLATED_LANGUAGES],
    );
  });

  for (const language of TRANSLATED_LANGUAGES) {
    it(`${language}: every English key, and no key English lacks`, () => {
      const text = MESSAGES[language];
      assert.deepEqual(
        Object.keys(en).filter((k) => !(k in text)),
        [],
      );
      assert.deepEqual(
        Object.keys(text).filter((k) => !(k in en)),
        [],
      );
    });

    it(`${language}: keeps every {placeholder}`, () => {
      for (const [key, text] of Object.entries(MESSAGES[language])) {
        assert.deepEqual(placeholders(text), placeholders(en[key]), `${language} ${key}`);
      }
    });

    it(`${language}: no empty string`, () => {
      for (const [key, text] of Object.entries(MESSAGES[language])) {
        assert.ok(text.trim().length > 0, `${language} ${key}`);
      }
    });
  }

  it("Arabic is written in Arabic script, not copied English", () => {
    for (const [key, text] of Object.entries(MESSAGES.ar)) {
      assert.match(text, /[؀-ۿ]/, `${key} has no Arabic letters`);
    }
  });

  it("the Latin-script languages are translated, not copied English", () => {
    // Product words (WhatsApp, Inbox, PDF) can rightly stay English, so this
    // asks that most strings differ, not all.
    for (const language of ["ms", "fil", "sw"]) {
      const keys = Object.keys(en);
      const same = keys.filter((k) => MESSAGES[language][k] === en[k]).length;
      assert.ok(
        same / keys.length < 0.25,
        `${language}: ${same}/${keys.length} identical to English`,
      );
    }
  });

  it("no two screens define the same key", () => {
    const seen = new Map();
    for (const [index, screen] of SCREEN_LIST.entries()) {
      for (const key of Object.keys(screen.en)) {
        assert.ok(!seen.has(key), `${key} is in screens ${seen.get(key)} and ${index}`);
        seen.set(key, index);
      }
    }
  });

  it("only Arabic is right-to-left", () => {
    assert.equal(i18n.directionOf("ar"), "rtl");
    for (const code of ["en", "ms", "fil", "sw"]) assert.equal(i18n.directionOf(code), "ltr");
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

describe("a page not yet translated is not laid out backwards", () => {
  // Arabic turns the whole document right-to-left. A page whose text is still
  // English would read backwards, so until it is translated it marks itself
  // English and left-to-right, while the translated frame keeps the reader's
  // direction.
  it("knows which pages are translated", () => {
    assert.equal(i18n.isTranslatedPath("/dashboard"), true);
    assert.equal(i18n.isTranslatedPath("/dashboard/"), true, "a trailing slash is the same page");
    assert.equal(i18n.isTranslatedPath("/settings"), false);
    assert.equal(i18n.isTranslatedPath("/"), false);
  });

  it("lists only pages that exist", () => {
    for (const path of i18n.TRANSLATED_PATHS) {
      const name = path.replace(/^\//, "");
      const candidates = [`src/routes/${name}.tsx`, `src/routes/_authenticated/${name}.tsx`];
      assert.ok(
        candidates.some((file) => {
          try {
            read(file);
            return true;
          } catch {
            return false;
          }
        }),
        `${path} has no route file`,
      );
    }
  });

  it("marks untranslated content English and left-to-right, and only then", () => {
    const wrapper = read("src/components/PageLanguage.tsx");
    assert.match(
      wrapper,
      /if \(language === "en" \|\| isTranslatedPath\(pathname\)\) return <>\{children\}<\/>;/,
    );
    assert.match(wrapper, /<div lang="en" dir="ltr" className="contents" data-untranslated>/);
  });

  it("wraps public pages at the root and app pages inside the shell, never the sidebar", () => {
    const root = read("src/routes/__root.tsx");
    assert.match(root, /m\.routeId === "\/_authenticated"/);
    assert.match(root, /<PageLanguage pathname=\{pathname\}>\s*<Outlet \/>\s*<\/PageLanguage>/);
    const shell = read("src/routes/_authenticated/route.tsx");
    assert.equal(
      shell.split("<PageLanguage pathname={pathname}>").length - 1,
      2,
      "both content outlets",
    );
  });
});
