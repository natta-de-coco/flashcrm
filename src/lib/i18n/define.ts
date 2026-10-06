// One file per screen, holding that screen's text in every language.
//
// Every translated language must cover every English key: the types below make
// a missing string a compile error, so a half-translated screen cannot ship
// and show a mix of languages. Adding a language means adding it here, and the
// compiler then lists every screen that still needs it.

export const TRANSLATED_LANGUAGES = ["ar", "ms", "fil", "sw"] as const;
export type TranslatedLanguage = (typeof TRANSLATED_LANGUAGES)[number];

export type ScreenMessages<E extends Record<string, string>> = { en: E } & {
  [L in TranslatedLanguage]: { [K in keyof E]: string };
};

/** Declares a screen's messages; `const` keeps the keys literal for typing. */
export function screen<const E extends Record<string, string>>(
  messages: ScreenMessages<E>,
): ScreenMessages<E> {
  return messages;
}
