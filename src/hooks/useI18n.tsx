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
import { createContext, useContext, useMemo, type ReactNode } from "react";

type I18n = {
  language: string;
  dir: "ltr" | "rtl";
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
  setLanguage: (code: string) => void;
};

const I18nContext = createContext<I18n>({
  language: DEFAULT_UI_LANGUAGE,
  dir: "ltr",
  t: (key, values) => translate(DEFAULT_UI_LANGUAGE, key, values),
  setLanguage: () => {},
});

export function I18nProvider({ language, children }: { language: string; children: ReactNode }) {
  const router = useRouter();
  const value = useMemo<I18n>(
    () => ({
      language,
      dir: directionOf(language),
      t: (key, values) => translate(language, key, values),
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
