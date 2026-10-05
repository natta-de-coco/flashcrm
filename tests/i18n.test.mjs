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

describe("a language cookie that cannot be read", () => {
  // This runs in the browser on every navigation. decodeURIComponent throws on
  // a malformed escape, and that took the whole page to the error screen until
  // the cookie was cleared -- over a display preference.
  it("is treated as no choice instead of throwing", () => {
    assert.equal(i18n.languageFromCookieHeader("flas_lang=%"), "en");
    assert.equal(i18n.languageFromCookieHeader("sb=1; flas_lang=%ZZ; theme=dark"), "en");
  });
});

describe("the company's language as a default", () => {
  // What the browser holds after the company's Arabic was applied for someone
  // who never picked a language.
  const inherited = "flas_lang=ar; flas_lang_auto=1";

  it("applies to a teammate who has never chosen", () => {
    assert.equal(i18n.workspaceDefaultLanguage("sb=1", "ar", "en"), "ar");
  });

  it("never overrides a teammate's own choice", () => {
    assert.equal(i18n.hasChosenLanguage("flas_lang=en"), true);
    assert.equal(i18n.workspaceDefaultLanguage("flas_lang=en", "ar", "en"), null);
  });

  it("does not count an inherited default as the teammate's own choice", () => {
    // Applying the default writes the language cookie so the server can render
    // it. That used to look like a personal choice, so a later change of the
    // company's language never reached a teammate who had chosen nothing.
    assert.equal(i18n.hasChosenLanguage(inherited), false);
    assert.equal(i18n.hasChosenLanguage("sb=1"), false);
    assert.equal(i18n.workspaceDefaultLanguage(inherited, "ms", "ar"), "ms");
  });

  it("returns an inheriting teammate to English when the company picks a language the interface lacks", () => {
    assert.equal(i18n.workspaceDefaultLanguage(inherited, "fr", "ar"), "en");
    assert.equal(i18n.workspaceDefaultLanguage("", "fr", "en"), null);
  });

  it("waits for the workspace to load before deciding", () => {
    assert.equal(i18n.workspaceDefaultLanguage(inherited, undefined, "ar"), null);
  });

  it("does nothing when it is already showing", () => {
    assert.equal(i18n.workspaceDefaultLanguage("", "ar", "ar"), null);
    assert.equal(i18n.workspaceDefaultLanguage(inherited, "ar", "ar"), null);
  });

  it("marks an inherited language, and clears the mark when the person chooses", () => {
    assert.equal(
      i18n.inheritedLanguageCookie(true),
      "flas_lang_auto=1; Path=/; Max-Age=31536000; SameSite=Lax",
    );
    assert.equal(
      i18n.inheritedLanguageCookie(false),
      "flas_lang_auto=; Path=/; Max-Age=0; SameSite=Lax",
    );
    const hook = read("src/hooks/useI18n.tsx");
    assert.match(hook, /setLanguage: \(code, \{ inherited = false \} = \{\}\) => \{/);
    assert.match(hook, /document\.cookie = inheritedLanguageCookie\(inherited\);/);
    const shell = read("src/routes/_authenticated/route.tsx");
    assert.match(shell, /if \(next\) setLanguage\(next, \{ inherited: true \}\);/);
  });

  it("re-reads the workspace after an admin saves the company language", () => {
    // The workspace record is loaded once per signed-in user. Without this the
    // newly saved default reached nobody until a full reload.
    const card = read("src/components/settings/RegionCard.tsx");
    assert.match(card, /const \{ refresh \} = useTenant\(\);/);
    assert.match(card, /void refresh\(\);/);
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

describe("a page kept in English is not laid out backwards", () => {
  // Arabic turns the whole document right-to-left. A page whose text is English
  // would read backwards, so the legal pages and the blog mark themselves
  // English and left-to-right, while the translated frame keeps the reader's
  // direction. Every other page is translated.
  it("treats every page as translated except the legal texts and the blog", () => {
    for (const path of [
      "/",
      "/dashboard",
      "/settings",
      "/inbox",
      "/pricing",
      "/companies/errors",
    ]) {
      assert.equal(i18n.isTranslatedPath(path), true, path);
    }
    assert.equal(i18n.isTranslatedPath("/dashboard/"), true, "a trailing slash is the same page");
    for (const path of ["/terms", "/privacy", "/privacy/", "/blog", "/blog/whatsapp-api-cost"]) {
      assert.equal(i18n.isTranslatedPath(path), false, path);
    }
  });

  it("does not mistake a page that merely starts with the same letters", () => {
    assert.equal(i18n.isTranslatedPath("/blogroll"), true);
    assert.equal(i18n.isTranslatedPath("/terms-of-sale"), true);
  });

  it("lists only pages that exist", () => {
    for (const path of i18n.ENGLISH_ONLY_PATHS) {
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

describe("a public page's FAQ reads the same on the page and in its structured data", () => {
  // Google takes the FAQ from the page's JSON-LD, which is built from the
  // page's own array, and requires it to match the text a visitor sees. The
  // visible English comes from the message files, so the two must be the same
  // sentences.
  for (const [prefix, file] of [
    ["home.faq.", "src/routes/index.tsx"],
    ["pricing.faq.", "src/routes/pricing.tsx"],
    ["whatsappBusinessApi.faq.", "src/routes/whatsapp-business-api.tsx"],
  ]) {
    it(file, () => {
      const source = read(file);
      const keys = Object.keys(en).filter((key) => key.startsWith(prefix));
      assert.ok(keys.length >= 10, `${prefix} has ${keys.length} messages`);
      for (const key of keys) {
        assert.ok(source.includes(en[key]), `${key} differs from the page's own array`);
      }
    });
  }
});
