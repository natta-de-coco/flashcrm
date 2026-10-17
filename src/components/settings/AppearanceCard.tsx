import { Monitor, Moon, Sun, SwatchBook } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useAppearance } from "@/hooks/useAppearance";
import { useI18n } from "@/hooks/useI18n";
import type { ThemeChoice } from "@/lib/appearance";
export const THEME_CHOICES = [
  { id: "light", icon: Sun },
  { id: "grey", icon: SwatchBook },
  { id: "dark", icon: Moon },
  { id: "system", icon: Monitor },
] as const;
export function AppearanceCard() {
  const { preferences, update, storageAvailable } = useAppearance();
  const { t } = useI18n();
  return (
    <Card>
      <CardHeader className="flas-hero rounded-t-xl border-b">
        <CardTitle>{t("appearance.title")}</CardTitle>
        <CardDescription>{t("appearance.browserOnly")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <fieldset>
          <legend className="mb-3 text-sm font-medium">{t("appearance.theme")}</legend>
          <div
            className="grid grid-cols-2 gap-3 sm:grid-cols-4"
            role="radiogroup"
            aria-label={t("appearance.theme")}
          >
            {THEME_CHOICES.map(({ id, icon: Icon }) => (
              <label
                key={id}
                className={`relative cursor-pointer rounded-xl border-2 p-3 transition-colors focus-within:ring-2 focus-within:ring-ring ${preferences.theme === id ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}
              >
                <input
                  type="radio"
                  name="appearance-theme"
                  value={id}
                  checked={preferences.theme === id}
                  onChange={() => update({ theme: id as ThemeChoice })}
                  className="sr-only"
                />
                <div
                  aria-hidden="true"
                  className={`theme-swatch theme-swatch-${id} mb-3 flex h-16 overflow-hidden rounded-md border`}
                >
                  <span className="w-4 bg-[#064e3b]" />
                  <span className="m-2 flex-1 rounded border border-black/10 bg-white/70" />
                </div>
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Icon className="size-4" />
                  {t(`appearance.${id}`)}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-3 text-sm font-medium">{t("appearance.density")}</legend>
          <div className="flex flex-wrap gap-3">
            {(["comfortable", "compact"] as const).map((value) => (
              <label
                key={value}
                className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm"
              >
                <input
                  type="radio"
                  name="appearance-density"
                  value={value}
                  checked={preferences.density === value}
                  onChange={() => update({ density: value })}
                  className="accent-primary"
                />
                {t(`appearance.${value}`)}
              </label>
            ))}
          </div>
        </fieldset>
        {(["effects", "motion", "wallpaper"] as const).map((key) => (
          <label
            key={key}
            className="flex min-h-12 items-center justify-between gap-4 rounded-lg border p-3"
          >
            <span>
              <span className="block text-sm font-medium">{t(`appearance.${key}`)}</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {t(`appearance.${key}Hint`)}
              </span>
            </span>
            <Switch
              aria-label={t(`appearance.${key}`)}
              checked={preferences[key]}
              onCheckedChange={(checked) => update({ [key]: checked })}
            />
          </label>
        ))}
        <p role="status" className="text-xs text-muted-foreground">
          {t(storageAvailable ? "appearance.saved" : "appearance.sessionOnly")}
        </p>
      </CardContent>
    </Card>
  );
}
