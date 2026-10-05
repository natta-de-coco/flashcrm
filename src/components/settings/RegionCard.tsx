// Region, currency and language for this workspace, plus the marketing rules
// Flas enforces for the selected country.
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  complianceFor,
  countryOption,
  COUNTRIES,
  CURRENCIES,
  formatMoney,
  LANGUAGES,
  resolveTenantLocale,
  DEFAULT_LOCALE,
} from "@/lib/locale";
import { getWorkspaceRegion, saveWorkspaceRegion } from "@/lib/workspace.functions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Globe2, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@/hooks/useI18n";

export function RegionCard() {
  const { t, tr } = useI18n();
  const qc = useQueryClient();
  const save = useServerFn(saveWorkspaceRegion);
  const region = useQuery({ queryKey: ["workspace-region"], queryFn: () => getWorkspaceRegion() });

  const [country, setCountry] = useState("AE");
  const [currency, setCurrency] = useState(DEFAULT_LOCALE.currency);
  const [locale, setLocale] = useState("en");
  const [timezone, setTimezone] = useState(DEFAULT_LOCALE.timezone);

  useEffect(() => {
    if (!region.data) return;
    setCountry(region.data.country);
    setCurrency(region.data.currency);
    setLocale(region.data.locale);
    setTimezone(region.data.timezone);
  }, [region.data]);

  const mutation = useMutation({
    mutationFn: async () => save({ data: { country, currency, locale, timezone } }),
    onSuccess: () => {
      // It used to promise that AI replies follow the language. They do not:
      // the chatbot answers in the customer's own language.
      toast.success(t("regionCard.regionalSettingsSaved"));
      void qc.invalidateQueries({ queryKey: ["workspace-region"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const preview = resolveTenantLocale({ country, currency, locale, timezone });
  const compliance = complianceFor(country);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Globe2 className="size-4 text-primary" /> {t("regionCard.regionCurrencyLanguage")}
        </CardTitle>
        <CardDescription>{t("regionCard.flasAdaptsToWhereYour")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {region.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>{t("regionCard.country")}</Label>
                <Select
                  value={country}
                  onValueChange={(value) => {
                    setCountry(value);
                    const option = countryOption(value);
                    if (option) {
                      setCurrency(option.currency);
                      setTimezone(option.timezone);
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COUNTRIES.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>{t("regionCard.currency")}</Label>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.code} — {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>{t("regionCard.companyLanguage")}</Label>
                <Select value={locale} onValueChange={setLocale}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map((l) => (
                      <SelectItem key={l.code} value={l.code}>
                        {l.label} — {l.native}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t("regionCard.theInterfaceLanguageForTeammates")}
                </p>
              </div>
              <div className="grid gap-1.5">
                <Label>{t("regionCard.timezone")}</Label>
                <Select value={timezone} onValueChange={setTimezone}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from(
                      new Set([timezone, "UTC", ...COUNTRIES.map((c) => c.timezone)]),
                    ).map((tz) => (
                      <SelectItem key={tz} value={tz}>
                        {tz}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              {tr("regionCard.preview", {
                formatMoney: formatMoney(1999.5, preview),
                format: new Intl.DateTimeFormat(`${locale}-${country}`, {
                  dateStyle: "long",
                  timeZone: timezone,
                }).format(new Date()),
              })}
            </p>

            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck className="size-4 text-primary" /> {compliance.label}
              </p>
              <ul className="mt-1.5 grid gap-1 text-xs text-muted-foreground">
                {compliance.rules.map((rule) => (
                  <li key={rule}>• {rule}</li>
                ))}
              </ul>
            </div>

            <Button
              className="w-fit"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? t("regionCard.saving") : t("regionCard.saveRegionalSettings")}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
