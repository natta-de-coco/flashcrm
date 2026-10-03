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
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

const COUNTRY_OPTIONS: SearchableOption[] = COUNTRIES.map((c) => ({
  value: c.code,
  label: c.name,
  // "+971" and "AE" both find the UAE.
  keywords: [c.code, `+${c.callingCode}`],
}));

const CURRENCY_OPTIONS: SearchableOption[] = CURRENCIES.map((c) => ({
  value: c.code,
  label: `${c.code} — ${c.label}`,
  keywords: [c.symbol],
}));

export function RegionCard() {
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
      toast.success("Regional settings saved — amounts, dates and AI replies now follow them.");
      void qc.invalidateQueries({ queryKey: ["workspace-region"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const preview = resolveTenantLocale({ country, currency, locale, timezone });

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
          <Globe2 className="size-4 text-primary" /> Region, currency &amp; language
        </CardTitle>
        <CardDescription>
          Flas adapts to where your business operates: invoices, dates, campaign timing and the
          marketing rules we enforce all follow this.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {region.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>Country</Label>
                <SearchableSelect
                  ariaLabel="Country"
                  value={country}
                  options={COUNTRY_OPTIONS}
                  searchPlaceholder="Search by name, code or +calling code…"
                  emptyText="No country matches."
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
              <div className="grid gap-1.5">
                <Label>Currency</Label>
                <SearchableSelect
                  ariaLabel="Currency"
                  value={currency}
                  options={CURRENCY_OPTIONS}
                  searchPlaceholder="Search currencies…"
                  emptyText="No currency matches."
                  onChange={setCurrency}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Language</Label>
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
              </div>
              <div className="grid gap-1.5">
                <Label>Timezone</Label>
                <SearchableSelect
                  ariaLabel="Timezone"
                  value={timezone}
                  options={timezoneOptions}
                  searchPlaceholder="Search a city or GMT offset…"
                  emptyText="No timezone matches."
                  onChange={setTimezone}
                />
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Preview: {formatMoney(1999.5, preview)} ·{" "}
              {new Intl.DateTimeFormat(`${locale}-${country}`, {
                dateStyle: "long",
                timeZone: timezone,
              }).format(new Date())}
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
              {mutation.isPending ? "Saving…" : "Save regional settings"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
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
