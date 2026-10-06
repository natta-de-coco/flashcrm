// Marks a page that is not translated yet as English and left-to-right, so in
// Arabic its English sentences are not laid out backwards while the translated
// frame around it reads right-to-left. `display: contents` adds no box, so the
// layout is untouched; English readers get no wrapper at all.
import { useI18n } from "@/hooks/useI18n";
import { isTranslatedPath } from "@/lib/i18n";
import type { ReactNode } from "react";

export function PageLanguage({ pathname, children }: { pathname: string; children: ReactNode }) {
  const { language } = useI18n();
  if (language === "en" || isTranslatedPath(pathname)) return <>{children}</>;
  return (
    <div lang="en" dir="ltr" className="contents" data-untranslated>
      {children}
    </div>
  );
}
