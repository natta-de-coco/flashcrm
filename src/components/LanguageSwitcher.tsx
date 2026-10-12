// Change the interface language. Each language is named in its own script, so
// someone who cannot read English can still find "العربية".
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/hooks/useI18n";
import { UI_LANGUAGES } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Languages } from "lucide-react";

type Props = {
  /** Icon only, for a tight header. */
  compact?: boolean;
  className?: string;
};

export function LanguageSwitcher({ compact = false, className }: Props) {
  const { language, dir, t, setLanguage } = useI18n();
  const current = UI_LANGUAGES.find((l) => l.code === language) ?? UI_LANGUAGES[0]!;

  return (
    // dir is passed down because the menu is portalled outside <html dir>'s
    // reach of Radix's own direction context.
    <DropdownMenu dir={dir}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={compact ? "icon" : "sm"}
          aria-label={t("language.choose")}
          className={cn("gap-2", className)}
        >
          <Languages className="size-4 shrink-0" />
          {compact ? null : <span>{current.native}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuLabel>{t("language.label")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={language} onValueChange={setLanguage}>
          {UI_LANGUAGES.map((option) => (
            <DropdownMenuRadioItem
              key={option.code}
              value={option.code}
              lang={option.code}
              dir={option.rtl ? "rtl" : "ltr"}
            >
              {option.native}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
