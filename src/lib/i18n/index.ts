// Which language the interface is shown in, for this person.
//
// The workspace's own language (Settings → Region) decides AI replies and how
// numbers and dates read. This is separate and personal: one teammate can work
// in Arabic while another works in English in the same company.
//
// The choice lives in a cookie rather than localStorage so the server can read
// it and render the right language and direction on the first paint -- no
// flash of English, and no hydration mismatch, for an Arabic reader.
import { en, MESSAGES, type MessageKey } from "./messages";

export type { MessageKey } from "./messages";

export type UiLanguage = {
  code: string;
  /** In its own script, so a reader who cannot read English can still find it. */
  native: string;
  rtl: boolean;
};

/**
 * Only languages with a full translation are offered (define.ts makes a
 * missing string a compile error). Listing languages that would show English
 * would promise something the product does not do.
 *
 * Arabic for the Gulf; Malay for Malaysia, Singapore and Brunei; Filipino for
 * the Philippines; Swahili for Kenya, Tanzania, Uganda and Rwanda.
 */
export const UI_LANGUAGES: readonly UiLanguage[] = [
  { code: "en", native: "English", rtl: false },
  { code: "ar", native: "العربية", rtl: true },
  { code: "ms", native: "Bahasa Melayu", rtl: false },
  { code: "fil", native: "Filipino", rtl: false },
  { code: "sw", native: "Kiswahili", rtl: false },
];

export const DEFAULT_UI_LANGUAGE = "en";
export const LANGUAGE_COOKIE = "flas_lang";

export function isSupportedUiLanguage(code: string | null | undefined): code is string {
  return UI_LANGUAGES.some((l) => l.code === code);
}

/** Anything unknown, missing or tampered with is English. */
export function normalizeUiLanguage(code: string | null | undefined): string {
  const lower = (code ?? "").trim().toLowerCase();
  return isSupportedUiLanguage(lower) ? lower : DEFAULT_UI_LANGUAGE;
}

export function isRtlUiLanguage(code: string | null | undefined): boolean {
  return UI_LANGUAGES.find((l) => l.code === code)?.rtl === true;
}

export function directionOf(code: string | null | undefined): "rtl" | "ltr" {
  return isRtlUiLanguage(code) ? "rtl" : "ltr";
}

/**
 * The text for a key in a language, with {name} placeholders filled. Falls back
 * to English for a key not yet translated, so an unfinished translation shows
 * English rather than "nav.inbox.label".
 */
/** What a {placeholder} may be filled with. null and undefined print as nothing. */
export type MessageValues = Record<string, string | number | null | undefined>;

export function translate(language: string, key: MessageKey, values?: MessageValues): string {
  const template = MESSAGES[language]?.[key] ?? en[key] ?? key;
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    // An absent value prints nothing, not the word "undefined".
    name in values ? String(values[name] ?? "") : match,
  );
}

/** Reads the language cookie out of a Cookie header or document.cookie. */
export function languageFromCookieHeader(header: string | null | undefined): string {
  for (const part of (header ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === LANGUAGE_COOKIE) return normalizeUiLanguage(decodeURIComponent(rest.join("=")));
  }
  return DEFAULT_UI_LANGUAGE;
}

/**
 * The Set-Cookie value for a choice. A year, the whole site, and Lax: it is a
 * display preference, not a credential, so it does not need to be HttpOnly --
 * the page itself writes it when the person picks a language.
 */
export function languageCookie(code: string): string {
  return `${LANGUAGE_COOKIE}=${encodeURIComponent(normalizeUiLanguage(code))}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

/** True when the key exists, so a computed key can never print as raw text. */
export function hasMessage(key: string): key is MessageKey {
  return Object.prototype.hasOwnProperty.call(en, key);
}

/** "/companies/errors" → "nav.companies.errors.label". */
export function navMessageKey(to: string, part: "label" | "desc"): string {
  return `nav.${to.replace(/^\//, "").replace(/\//g, ".")}.${part}`;
}

/** True once this browser has a language choice of its own. */
export function hasLanguageCookie(header: string | null | undefined): boolean {
  return (header ?? "").split(";").some((part) => part.trim().startsWith(`${LANGUAGE_COOKIE}=`));
}

/**
 * The company's language becomes a teammate's interface language only until
 * that teammate chooses one: an admin who sets Arabic for the company gives the
 * whole team Arabic by default, and anyone can still switch back.
 */
export function workspaceDefaultLanguage(
  cookieHeader: string | null | undefined,
  workspaceLocale: string | null | undefined,
  current: string,
): string | null {
  if (hasLanguageCookie(cookieHeader)) return null;
  if (!isSupportedUiLanguage(workspaceLocale)) return null;
  return workspaceLocale === current ? null : workspaceLocale;
}

/**
 * The pages whose own text is translated. Screens are translated one by one,
 * and a page not yet done must not be laid out right-to-left in Arabic -- that
 * puts English sentences backwards. Until a page is listed here its content
 * declares itself English and left-to-right, while the translated frame
 * around it (sidebar, header) follows the reader's language.
 */
export const TRANSLATED_PATHS: readonly string[] = ["/auth", "/dashboard", "/contacts"];

export function isTranslatedPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  return TRANSLATED_PATHS.includes(path);
}
