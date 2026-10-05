// Every screen's text, combined. Adding a screen: write src/lib/i18n/screens/<name>.ts
// and list it here. The compiler then enforces that it carries every language.
import { TRANSLATED_LANGUAGES } from "./define";
import auth from "./screens/auth";
import catalog from "./screens/catalog";
import chatbot from "./screens/chatbot";
import common from "./screens/common";
import contactCard from "./screens/contact-card";
import contacts from "./screens/contacts";
import dashboard from "./screens/dashboard";
import inbox from "./screens/inbox";
import invoiceBrandingCard from "./screens/invoice-branding-card";
import invoiceBuilder from "./screens/invoice-builder";
import marketing from "./screens/marketing";
import nav from "./screens/nav";
import sales from "./screens/sales";
import settings from "./screens/settings";
import shell from "./screens/shell";
import socialInbox from "./screens/social-inbox";

const SCREENS = [
  auth,
  catalog,
  chatbot,
  common,
  contactCard,
  contacts,
  dashboard,
  inbox,
  invoiceBrandingCard,
  invoiceBuilder,
  marketing,
  nav,
  sales,
  settings,
  shell,
  socialInbox,
] as const;

type KeysOf<T> = T extends unknown ? keyof T : never;

/** Every key any screen defines. */
export type MessageKey = KeysOf<(typeof SCREENS)[number]["en"]> & string;

/** English: the source every other language is checked against. */
export const en = Object.assign({}, ...SCREENS.map((s) => s.en)) as Record<MessageKey, string>;

/** Each language's text, keyed by language code. */
export const MESSAGES: Record<string, Partial<Record<MessageKey, string>>> = {
  en,
  ...Object.fromEntries(
    TRANSLATED_LANGUAGES.map((language) => [
      language,
      Object.assign({}, ...SCREENS.map((s) => s[language])),
    ]),
  ),
};

/** For tests: the screens as declared, so keys can be checked for collisions. */
export const SCREEN_LIST = SCREENS;
