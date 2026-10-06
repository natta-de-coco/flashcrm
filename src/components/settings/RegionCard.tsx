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
import { SearchableSelect, type SearchableOption } from "@/components/ui/searchable-select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  allTimeZones,
  complianceFor,
  countryName,
  countryOption,
  COUNTRIES,
  CURRENCIES,
  currencyName,
  formatMoney,
  LANGUAGES,
  resolveTenantLocale,
  DEFAULT_LOCALE,
} from "@/lib/locale";
import { getWorkspaceRegion, saveWorkspaceRegion } from "@/lib/workspace.functions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Globe2, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@/hooks/useI18n";
import { useTenant } from "@/hooks/useTenant";

export function RegionCard() {
  const { t, tr, tx, language } = useI18n();
  const { refresh } = useTenant();
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
      // The workspace record is loaded once per signed-in user, so the saved
      // company language would not reach anyone -- this admin included --
      // until a full reload.
      void refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const preview = resolveTenantLocale({ country, currency, locale, timezone });

  // Named and sorted in the reader's language. The English name, the ISO code
  // and the calling code still find a country: "UAE", "AE" and "+971" all work
  // whichever language the list is shown in.
  const countryOptions = useMemo<SearchableOption[]>(() => {
    const options = COUNTRIES.map((c) => ({
      value: c.code,
      label: countryName(c.code, language),
      keywords: [c.name, c.code, `+${c.callingCode}`],
    }));
    return options.sort((a, b) => a.label.localeCompare(b.label, sortLocale(language)));
  }, [language]);

  const currencyOptions = useMemo<SearchableOption[]>(
    () =>
      CURRENCIES.map((c) => ({
        value: c.code,
        label: `${c.code} — ${currencyName(c.code, language)}`,
        keywords: [c.label, c.symbol],
      })),
    [language],
  );

  // Every zone, not one per country, with the country's own default first and
  // the GMT offset shown so "Los Angeles" and "GMT-7" both find Pacific time.
  const timezoneOptions = useMemo<SearchableOption[]>(() => {
    const countryDefault = countryOption(country)?.timezone;
    const ordered = Array.from(
      new Set([countryDefault, timezone, ...allTimeZones()].filter(Boolean) as string[]),
    );
    return ordered.map((zone) => {
      const offset = gmtOffset(zone);
      const city = zone.split("/").pop()?.replace(/_/g, " ") ?? zone;
      return {
        value: zone,
        label: offset ? `${zone.replace(/_/g, " ")} (${offset})` : zone.replace(/_/g, " "),
        keywords: [city, offset].filter(Boolean) as string[],
      };
    });
  }, [country, timezone]);
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
              <div className="grid content-start gap-1.5">
                <Label>{t("regionCard.country")}</Label>
                <SearchableSelect
                  ariaLabel={t("regionCard.country")}
                  value={country}
                  options={countryOptions}
                  searchPlaceholder={t("regionCard.searchCountry")}
                  emptyText={t("regionCard.noCountryMatches")}
                  onChange={(value) => {
                    setCountry(value);
                    const option = countryOption(value);
                    if (option) {
                      setCurrency(option.currency);
                      setTimezone(option.timezone);
                    }
                  }}
                />
              </div>
              <div className="grid content-start gap-1.5">
                <Label>{t("regionCard.currency")}</Label>
                <SearchableSelect
                  ariaLabel={t("regionCard.currency")}
                  value={currency}
                  options={currencyOptions}
                  searchPlaceholder={t("regionCard.searchCurrency")}
                  emptyText={t("regionCard.noCurrencyMatches")}
                  onChange={setCurrency}
                />
              </div>
              <div className="grid content-start gap-1.5">
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
              <div className="grid content-start gap-1.5">
                <Label>{t("regionCard.timezone")}</Label>
                <SearchableSelect
                  ariaLabel={t("regionCard.timezone")}
                  value={timezone}
                  options={timezoneOptions}
                  searchPlaceholder={t("regionCard.searchTimezone")}
                  emptyText={t("regionCard.noTimezoneMatches")}
                  onChange={setTimezone}
                />
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
                <ShieldCheck className="size-4 text-primary" />{" "}
                {tx(`regionCard.compliance.${compliance.region}.label`, compliance.label)}
              </p>
              <ul className="mt-1.5 grid gap-1 text-xs text-muted-foreground">
                {compliance.rules.map((rule, i) => (
                  <li key={rule}>
                    • {tx(`regionCard.compliance.${compliance.region}.rule.${i}`, rule)}
                  </li>
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

/** The interface language as a locale the engine can sort by; English if it cannot. */
function sortLocale(language: string): string {
  try {
    return Intl.Collator.supportedLocalesOf([language])[0] ?? "en";
  } catch {
    return "en";
  }
}

/** "GMT+4" for Asia/Dubai, right now: offsets move with daylight saving. */
function gmtOffset(zone: string): string {
  try {
    return (
      new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
        .formatToParts(new Date())
        .find((p) => p.type === "timeZoneName")?.value ?? ""
    );
  } catch {
    return "";
  }
}
