// The interface language, for any component: useI18n().t("nav.inbox.label").
//
// The language comes from the root route's context, which reads the cookie on
// every load and navigation. Changing it writes the cookie and reloads the
// route data, so the server-rendered <html lang dir> and the screen can never
// disagree about which language is showing.
import {
  DEFAULT_UI_LANGUAGE,
  directionOf,
  languageCookie,
  translate,
  type MessageKey,
} from "@/lib/i18n";
import { useRouter } from "@tanstack/react-router";
import { createContext, Fragment, useContext, useMemo, type ReactNode } from "react";

type I18n = {
  language: string;
  dir: "ltr" | "rtl";
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
  /**
   * A sentence with elements inside it -- a link, a code sample -- as
   * {placeholders}. Word order differs between languages, so the element goes
   * where the translation puts it rather than where the English had it.
   */
  tr: (key: MessageKey, nodes: Record<string, ReactNode>) => ReactNode;
  setLanguage: (code: string) => void;
};

/** Splits translated text on {name} and puts each node where its name is. */
export function interleave(text: string, nodes: Record<string, ReactNode>): ReactNode[] {
  return text.split(/(\{\w+\})/g).map((part, index) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1];
    return name && name in nodes ? <Fragment key={index}>{nodes[name]}</Fragment> : part;
  });
}

const I18nContext = createContext<I18n>({
  language: DEFAULT_UI_LANGUAGE,
  dir: "ltr",
  t: (key, values) => translate(DEFAULT_UI_LANGUAGE, key, values),
  tr: (key, nodes) => interleave(translate(DEFAULT_UI_LANGUAGE, key), nodes),
  setLanguage: () => {},
});

export function I18nProvider({ language, children }: { language: string; children: ReactNode }) {
  const router = useRouter();
  const value = useMemo<I18n>(
    () => ({
      language,
      dir: directionOf(language),
      t: (key, values) => translate(language, key, values),
      tr: (key, nodes) => interleave(translate(language, key), nodes),
      setLanguage: (code) => {
        document.cookie = languageCookie(code);
        // Re-reads the cookie in the root route, which re-renders <html> with
        // the new lang and dir and every translated string with it.
        void router.invalidate();
      },
    }),
    [language, router],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  return useContext(I18nContext);
}
