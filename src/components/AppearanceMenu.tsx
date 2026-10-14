import { useEffect, useState } from "react";
import { Laptop, Moon, Sun } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { APPEARANCE_KEY, appearanceOf, isDarkAppearance, type Appearance } from "@/lib/appearance";

export function AppearanceMenu() {
  const { t } = useI18n();
  const [appearance, setAppearance] = useState<Appearance>("system");

  useEffect(() => {
    const system = window.matchMedia("(prefers-color-scheme: dark)");
    let preference: Appearance = "system";
    const apply = () => {
      document.documentElement.classList.toggle(
        "dark",
        isDarkAppearance(preference, system.matches),
      );
      setAppearance(preference);
    };
    try {
      preference = appearanceOf(window.localStorage.getItem(APPEARANCE_KEY));
    } catch {
      /* browser storage can be disabled */
    }
    apply();
    const storage = (event: StorageEvent) => {
      if (event.key === APPEARANCE_KEY || event.key === null) {
        preference = appearanceOf(event.newValue);
        apply();
      }
    };
    const changed = (event: Event) => {
      preference = appearanceOf((event as CustomEvent).detail);
      apply();
    };
    system.addEventListener("change", apply);
    window.addEventListener("storage", storage);
    window.addEventListener("flas:appearance", changed);
    return () => {
      system.removeEventListener("change", apply);
      window.removeEventListener("storage", storage);
      window.removeEventListener("flas:appearance", changed);
    };
  }, []);

  const choose = (value: string) => {
    const next = appearanceOf(value);
    setAppearance(next);
    document.documentElement.classList.toggle(
      "dark",
      isDarkAppearance(next, window.matchMedia("(prefers-color-scheme: dark)").matches),
    );
    try {
      window.localStorage.setItem(APPEARANCE_KEY, next);
    } catch {
      /* usable without persistence */
    }
    window.dispatchEvent(new CustomEvent("flas:appearance", { detail: next }));
  };
  const Icon = appearance === "dark" ? Moon : appearance === "light" ? Sun : Laptop;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("shell.appearance")}
          title={t("shell.appearance")}
        >
          <Icon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={appearance} onValueChange={choose}>
          <DropdownMenuRadioItem value="light">{t("shell.light")}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">{t("shell.dark")}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">{t("shell.system")}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
