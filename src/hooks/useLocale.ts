// Reads the workspace's saved locale from the DB and applies it live to the
// <html> element so that:
//   • lang="ar" / lang="fr" etc. lets the browser apply correct typography
//   • dir="rtl" makes Tailwind's rtl: variants activate for Arabic, Urdu, Farsi, Hebrew
//
// This is the single source of truth for the active language. Consuming
// components call `useLocale()` to know the current code and RTL flag without
// repeating the query.
import { getWorkspaceRegion } from "@/lib/workspace.functions";
import { isRtl, LANGUAGES, type LanguageOption } from "@/lib/locale";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

export type ActiveLocale = {
  code: string;
  rtl: boolean;
  language: LanguageOption | undefined;
  /** ISO country code, e.g. "AE" */
  country: string;
  /** ISO currency code, e.g. "AED" */
  currency: string;
  timezone: string;
};

const FALLBACK: ActiveLocale = {
  code: "en",
  rtl: false,
  language: LANGUAGES.find((l) => l.code === "en"),
  country: "AE",
  currency: "AED",
  timezone: "Asia/Dubai",
};

/**
 * Returns the active workspace locale and keeps the <html> element's `lang`
 * and `dir` attributes synchronised. Safe to call from any React tree that
 * sits inside <AuthProvider>; it degrades gracefully to English when the user
 * is signed out or the query hasn't resolved yet.
 */
export function useLocale(): ActiveLocale {
  const getRegion = useServerFn(getWorkspaceRegion);
  const { data } = useQuery({
    queryKey: ["workspace-region"],
    queryFn: () => getRegion(),
    // Locale rarely changes; a long stale time avoids redundant re-fetches.
    staleTime: 5 * 60 * 1000,
  });

  const active = useMemo<ActiveLocale>(() => {
    const code = data?.locale ?? "en";
    const rtl = isRtl(code);
    const language = LANGUAGES.find((l) => l.code === code);
    return {
      code,
      rtl,
      language,
      country: data?.country ?? FALLBACK.country,
      currency: data?.currency ?? FALLBACK.currency,
      timezone: data?.timezone ?? FALLBACK.timezone,
    };
  }, [data]);

  // Apply lang + dir to <html> whenever the locale changes. This is safe in
  // SSR because this hook only runs in the browser (useEffect is client-only).
  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute("lang", active.code);
    html.setAttribute("dir", active.rtl ? "rtl" : "ltr");

    // Persist a cookie so the next server render can set the correct lang
    // attribute before hydration (avoids a flash of wrong direction).
    try {
      document.cookie = `flas_locale=${active.code}; path=/; max-age=31536000; SameSite=Lax`;
    } catch {
      // Cookie write may be blocked in very strict browser settings — harmless.
    }
  }, [active.code, active.rtl]);

  return active;
}
