import { Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppearance } from "@/hooks/useAppearance";
import { useI18n } from "@/hooks/useI18n";
import type { ThemeChoice } from "@/lib/appearance";
export function AppearanceMenu({
  className,
  compact = true,
}: {
  className?: string;
  compact?: boolean;
}) {
  const { preferences, update } = useAppearance();
  const { t, dir } = useI18n();
  return (
    <DropdownMenu dir={dir}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={compact ? "icon" : "default"}
          className={className}
          aria-label={t("appearance.title")}
        >
          <Palette className="size-4" />
          {!compact && t("appearance.title")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={preferences.theme}
          onValueChange={(theme) => update({ theme: theme as ThemeChoice })}
        >
          {(["light", "grey", "dark", "system"] as const).map((id) => (
            <DropdownMenuRadioItem key={id} value={id}>
              {t(`appearance.${id}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
