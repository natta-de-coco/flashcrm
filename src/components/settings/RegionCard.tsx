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
                <Label>Currency</Label>
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
                <Label>
                  Interface Language
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    — changes site direction &amp; date formatting
                  </span>
                </Label>
                <Select value={locale} onValueChange={setLocale}>
                  <SelectTrigger>
                    <SelectValue>
                      {(() => {
                        const lang = LANGUAGES.find((l) => l.code === locale);
                        return lang ? (
                          <span className="flex items-center gap-2">
                            <span>{lang.native}</span>
                            <span className="text-muted-foreground">({lang.label})</span>
                            {lang.rtl && (
                              <span className="rounded border px-1 text-[10px] font-medium text-primary">
                                RTL
                              </span>
                            )}
                          </span>
                        ) : null;
                      })()}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {LANGUAGES.map((l) => (
                      <SelectItem key={l.code} value={l.code}>
                        <span className="flex items-center gap-2">
                          <span className="min-w-[120px]">{l.native}</span>
                          <span className="text-xs text-muted-foreground">{l.label}</span>
                          {l.rtl && (
                            <span className="rounded border px-1 text-[10px] font-medium text-primary">
                              RTL
                            </span>
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Saved here, applied immediately after saving. Arabic, Urdu, Farsi and Hebrew
                  activate right-to-left layout automatically.
                </p>
              </div>
              <div className="grid gap-1.5">
                <Label>Timezone</Label>
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
