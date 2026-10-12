// Browser-safe locale layer: every company using Flas picks its own country,
// currency, language and timezone, and every amount, date and AI reply follows
// it. Regional messaging rules are surfaced so a company in the EU, US, India
// or the Gulf is guided by the rules that actually apply to it.

import { COUNTRY_RECORDS, SHARED_CALLING_CODE_OWNER, type ComplianceRegion } from "./countries";

export type { ComplianceRegion } from "./countries";

export type CurrencyOption = { code: string; label: string; symbol: string };

/** Currencies with a preferred label and symbol; the rest are derived below. */
const NAMED_CURRENCIES: CurrencyOption[] = [
  { code: "USD", label: "US Dollar", symbol: "$" },
  { code: "EUR", label: "Euro", symbol: "€" },
  { code: "GBP", label: "British Pound", symbol: "£" },
  { code: "AED", label: "UAE Dirham", symbol: "AED" },
  { code: "SAR", label: "Saudi Riyal", symbol: "SAR" },
  { code: "QAR", label: "Qatari Riyal", symbol: "QAR" },
  { code: "KWD", label: "Kuwaiti Dinar", symbol: "KWD" },
  { code: "OMR", label: "Omani Rial", symbol: "OMR" },
  { code: "BHD", label: "Bahraini Dinar", symbol: "BHD" },
  { code: "INR", label: "Indian Rupee", symbol: "₹" },
  { code: "PKR", label: "Pakistani Rupee", symbol: "₨" },
  { code: "BDT", label: "Bangladeshi Taka", symbol: "৳" },
  { code: "EGP", label: "Egyptian Pound", symbol: "E£" },
  { code: "NGN", label: "Nigerian Naira", symbol: "₦" },
  { code: "ZAR", label: "South African Rand", symbol: "R" },
  { code: "KES", label: "Kenyan Shilling", symbol: "KSh" },
  { code: "TRY", label: "Turkish Lira", symbol: "₺" },
  { code: "CAD", label: "Canadian Dollar", symbol: "C$" },
  { code: "AUD", label: "Australian Dollar", symbol: "A$" },
  { code: "SGD", label: "Singapore Dollar", symbol: "S$" },
  { code: "MYR", label: "Malaysian Ringgit", symbol: "RM" },
  { code: "IDR", label: "Indonesian Rupiah", symbol: "Rp" },
  { code: "PHP", label: "Philippine Peso", symbol: "₱" },
  { code: "BRL", label: "Brazilian Real", symbol: "R$" },
  { code: "MXN", label: "Mexican Peso", symbol: "MX$" },
  { code: "JPY", label: "Japanese Yen", symbol: "¥" },
  { code: "CNY", label: "Chinese Yuan", symbol: "¥" },
];

/**
 * A currency's English name and narrow symbol from the platform's own data, so
 * the list can follow the country table without a hand-kept copy that drifts.
 */
function deriveCurrency(code: string): CurrencyOption {
  let label = code;
  let symbol = code;
  try {
    label = new Intl.DisplayNames(["en"], { type: "currency" }).of(code) ?? code;
  } catch {
    // An engine without DisplayNames still gets a usable option.
  }
  try {
    const part = new Intl.NumberFormat("en", {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
    })
      .formatToParts(0)
      .find((p) => p.type === "currency");
    if (part?.value) symbol = part.value;
  } catch {
    // Keep the code as the symbol.
  }
  return { code, label, symbol };
}

/**
 * Every currency a country in COUNTRIES uses, plus the named ones above. Kept
 * in step with the country table: choosing a country must never select a
 * currency the Currency picker -- and the server's validation -- does not know.
 */
export const CURRENCIES: CurrencyOption[] = (() => {
  const known = new Map(NAMED_CURRENCIES.map((c) => [c.code, c]));
  for (const country of COUNTRY_RECORDS) {
    if (!known.has(country.currency)) known.set(country.currency, deriveCurrency(country.currency));
  }
  return [...known.values()];
})();

export type LanguageOption = { code: string; label: string; native: string; rtl?: boolean };

export const LANGUAGES: LanguageOption[] = [
  { code: "en", label: "English", native: "English" },
  { code: "ar", label: "Arabic", native: "العربية", rtl: true },
  { code: "ur", label: "Urdu", native: "اردو", rtl: true },
  { code: "hi", label: "Hindi", native: "हिन्दी" },
  { code: "fr", label: "French", native: "Français" },
  { code: "es", label: "Spanish", native: "Español" },
  { code: "pt", label: "Portuguese", native: "Português" },
  { code: "de", label: "German", native: "Deutsch" },
  { code: "it", label: "Italian", native: "Italiano" },
  { code: "tr", label: "Turkish", native: "Türkçe" },
  { code: "id", label: "Indonesian", native: "Bahasa Indonesia" },
  { code: "ms", label: "Malay", native: "Bahasa Melayu" },
  { code: "bn", label: "Bengali", native: "বাংলা" },
  { code: "fil", label: "Filipino", native: "Filipino" },
  { code: "sw", label: "Swahili", native: "Kiswahili" },
  { code: "zh", label: "Chinese (Simplified)", native: "简体中文" },
];

export type CountryOption = {
  code: string;
  name: string;
  currency: string;
  timezone: string;
  /** International calling code, without the plus: "971". */
  callingCode: string;
  region: ComplianceRegion;
};

/**
 * Every country a company can operate from, sorted by English name. Built from
 * src/lib/countries.ts, which holds one row per country; the original 30 keep
 * exactly the currency, timezone and region they had, so no saved workspace
 * changes meaning.
 */
export const COUNTRIES: CountryOption[] = [...COUNTRY_RECORDS].sort((a, b) =>
  a.name.localeCompare(b.name, "en"),
);

export type ComplianceProfile = {
  region: ComplianceRegion;
  label: string;
  /** Rules the workspace must follow when messaging or emailing contacts. */
  rules: string[];
  /** Opt-in strength Flas enforces before any campaign can go out. */
  consent: "explicit" | "prior_relationship" | "opt_out";
};

export const COMPLIANCE: Record<ComplianceRegion, ComplianceProfile> = {
  eu: {
    region: "eu",
    label: "EU — GDPR & ePrivacy",
    consent: "explicit",
    rules: [
      "Freely given, recorded opt-in before the first marketing message.",
      "One-click unsubscribe and STOP handling in every campaign.",
      "Honour access and erasure requests within 30 days.",
      "Keep the lawful basis and consent timestamp on every contact.",
    ],
  },
  uk: {
    region: "uk",
    label: "UK — UK GDPR & PECR",
    consent: "explicit",
    rules: [
      "Recorded opt-in, or a genuine soft opt-in from an existing purchase.",
      "Identify the sender and provide an opt-out in every message.",
      "Screen against your own suppression list before every send.",
    ],
  },
  us: {
    region: "us",
    label: "US — TCPA & CAN-SPAM",
    consent: "explicit",
    rules: [
      "Prior express written consent for marketing SMS/WhatsApp.",
      "Honour STOP immediately and keep the proof of consent.",
      "No sends outside 8am–9pm in the contact's own timezone.",
      "Postal address and unsubscribe in every marketing email.",
    ],
  },
  canada: {
    region: "canada",
    label: "Canada — CASL",
    consent: "explicit",
    rules: [
      "Express or documented implied consent, with the source recorded.",
      "Sender identification and a working unsubscribe in every message.",
      "Implied consent expires — re-confirm within 24 months.",
    ],
  },
  gcc: {
    region: "gcc",
    label: "Gulf — UAE PDPL / KSA PDPL & TRA rules",
    consent: "explicit",
    rules: [
      "Registered sender identity and recorded opt-in for promotions.",
      "Arabic-friendly opt-out wording alongside English.",
      "Respect Friday/holiday and night-time quiet hours.",
    ],
  },
  india: {
    region: "india",
    label: "India — DPDP Act & TRAI",
    consent: "explicit",
    rules: [
      "Consent notice in the contact's language, with a withdrawal path.",
      "Use registered templates and headers for commercial messaging.",
      "No promotional messages during TRAI restricted hours (9pm–9am).",
    ],
  },
  apac: {
    region: "apac",
    label: "APAC — PDPA family",
    consent: "explicit",
    rules: [
      "Recorded opt-in and a per-channel withdrawal option.",
      "Check national do-not-call registries before promotional sends.",
      "Keep data-transfer notices when hosting outside the country.",
    ],
  },
  global: {
    region: "global",
    label: "General best practice",
    consent: "prior_relationship",
    rules: [
      "Only message people who asked to hear from you.",
      "Always offer an opt-out and honour it immediately.",
      "Keep the consent source and timestamp on record.",
    ],
  },
};

export type TenantLocale = {
  country: string;
  currency: string;
  locale: string;
  timezone: string;
  region: ComplianceRegion;
};

/**
 * Platform fallback, used only when a workspace has no country at all.
 *
 * These three must agree with each other. They previously did not -- the
 * country said AE while the currency said USD and the timezone said UTC -- so
 * a UAE workspace displayed dollars on a London clock.
 */
export const DEFAULT_LOCALE: TenantLocale = {
  country: "AE",
  currency: "AED",
  locale: "en",
  timezone: "Asia/Dubai",
  region: "gcc",
};

/**
 * The values organizations columns carry when nobody has chosen anything.
 *
 * organizations.currency is `NOT NULL DEFAULT 'USD'`, so a workspace that has
 * never visited Settings holds the literal string "USD" rather than NULL. That
 * defeated the country-derived fallback below, which only fired on null — and
 * is why picking the UAE still showed dollars. When the stored value is one of
 * these and the country implies something else, the country wins.
 */
const UNSET_CURRENCY = "USD";
const UNSET_TIMEZONE = "UTC";

export function countryOption(code: string | null | undefined): CountryOption | undefined {
  return COUNTRIES.find((c) => c.code === (code ?? "").toUpperCase());
}

/**
 * E.164 calling code -> country, longest prefix first so +1 (US/Canada) or +7
 * (Russia/Kazakhstan) does not swallow a code that only shares its first digit.
 * A code several countries share goes to the owner named in countries.ts.
 */
const CALLING_CODES: [string, string][] = COUNTRY_RECORDS.filter((c) => {
  const owner = SHARED_CALLING_CODE_OWNER[c.callingCode];
  return !owner || owner === c.code;
})
  .map((c): [string, string] => [c.callingCode, c.code])
  .sort((a, b) => b[0].length - a[0].length);

/** Best-effort country from a phone number's calling code. No new tracking
 *  needed — contacts don't have a city/country field today, so this is the
 *  only geographic signal that already exists for every WhatsApp contact.
 *  Approximate: shared codes (e.g. +1) collapse multiple countries into one,
 *  and this says nothing about where someone actually lives, only which
 *  country issued their number. */
export function inferCountryFromPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d]/g, "");
  if (!digits) return null;
  for (const [code, country] of CALLING_CODES) {
    if (digits.startsWith(code)) return country;
  }
  return null;
}

export function regionForCountry(code: string | null | undefined): ComplianceRegion {
  return countryOption(code)?.region ?? "global";
}

export function complianceFor(
  country: string | null | undefined,
  override?: string | null,
): ComplianceProfile {
  const key = (override ?? regionForCountry(country)) as ComplianceRegion;
  return COMPLIANCE[key] ?? COMPLIANCE.global;
}

export function resolveTenantLocale(
  org: {
    country?: string | null;
    currency?: string | null;
    locale?: string | null;
    timezone?: string | null;
    compliance_region?: string | null;
  } | null,
): TenantLocale {
  const country = (org?.country ?? DEFAULT_LOCALE.country).toUpperCase();
  const forCountry = countryOption(country);

  // A stored value counts as "chosen" unless it is the column default and the
  // country disagrees with it. A genuine US workspace is unaffected: its
  // country is US, whose currency is USD, so deriving from the country returns
  // the same answer.
  const chosenCurrency =
    org?.currency && !(org.currency.toUpperCase() === UNSET_CURRENCY && forCountry?.currency)
      ? org.currency
      : (forCountry?.currency ?? DEFAULT_LOCALE.currency);

  const chosenTimezone =
    org?.timezone && !(org.timezone === UNSET_TIMEZONE && forCountry?.timezone)
      ? org.timezone
      : (forCountry?.timezone ?? DEFAULT_LOCALE.timezone);

  return {
    country,
    currency: chosenCurrency.toUpperCase(),
    locale: org?.locale ?? DEFAULT_LOCALE.locale,
    timezone: chosenTimezone,
    region: (org?.compliance_region as ComplianceRegion | null) ?? regionForCountry(country),
  };
}

/** Intl tag such as "ar-AE" so numbers and dates read naturally. */
export function intlTag(locale: TenantLocale): string {
  return `${locale.locale}-${locale.country}`;
}

export function formatMoney(amount: number, locale: TenantLocale): string {
  try {
    return new Intl.NumberFormat(intlTag(locale), {
      style: "currency",
      currency: locale.currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${locale.currency} ${amount.toFixed(2)}`;
  }
}

/**
 * Today's calendar date in a given zone, as YYYY-MM-DD.
 *
 * `new Date().toISOString().slice(0, 10)` is the UTC date, which is the wrong
 * day for the first hours of every morning east of Greenwich: at 01:00 in
 * Dubai it still reads yesterday. That is how a quotation raised on the 10th
 * was issued dated the 9th.
 *
 * en-CA is used purely because its Intl output is already YYYY-MM-DD.
 */
export function todayInTimeZone(timeZone: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    // An unknown zone string must not break document creation.
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * A calendar date nobody can misread: "10 Aug 2027".
 *
 * toLocaleDateString() renders 10 August 2027 as "10/8/2027" for one reader
 * and "August 10 2027" for another, and the two are indistinguishable. That
 * matters most where the date carries money or access -- a paid-until date in
 * the manager portal, a renewal date on a billing card.
 *
 * Deliberately not locale-driven: the whole point is that every reader sees
 * the same unambiguous string.
 */
export function formatDayUnambiguous(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** The same, with a time: "10 Aug 2027, 15:04". */
export function formatMomentUnambiguous(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  } catch {
    return date.toISOString().replace("T", " ").slice(0, 16);
  }
}

/**
 * A timestamp as a YYYY-MM-DD calendar day in the *viewer's* zone, for
 * <input type="date">.
 *
 * toISOString().slice(0, 10) is the UTC day, so a renewal stored at
 * 2027-08-10T20:00Z showed as the 10th to a manager in Dubai for whom it is
 * already the 11th -- the same off-by-a-day that dated quotations wrongly.
 */
export function isoDayLocal(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function formatDate(value: string | Date, locale: TenantLocale): string {
  const date = typeof value === "string" ? new Date(value) : value;
  try {
    return new Intl.DateTimeFormat(intlTag(locale), {
      dateStyle: "medium",
      timeZone: locale.timezone,
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function formatDateTime(value: string | Date, locale: TenantLocale): string {
  const date = typeof value === "string" ? new Date(value) : value;
  try {
    return new Intl.DateTimeFormat(intlTag(locale), {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: locale.timezone,
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

export function languageName(code: string | null | undefined): string {
  return LANGUAGES.find((l) => l.code === code)?.label ?? "English";
}

export function isRtl(code: string | null | undefined): boolean {
  return LANGUAGES.find((l) => l.code === code)?.rtl === true;
}

/**
 * A country's name in the reader's language: "United Arab Emirates" in
 * English, "الإمارات العربية المتحدة" in Arabic. Comes from the platform's own
 * data, so all ~190 names are translated without a hand-kept list. Falls back
 * to the English name in countries.ts when the engine has no DisplayNames.
 */
export function countryName(code: string | null | undefined, language = "en"): string {
  const upper = (code ?? "").toUpperCase();
  const english = countryOption(upper)?.name ?? upper;
  if (!upper || language === "en") return english;
  try {
    const name = new Intl.DisplayNames([language], { type: "region" }).of(upper);
    return name && name !== upper ? name : english;
  } catch {
    return english;
  }
}

/**
 * A currency's name in the interface language: "UAE Dirham" in English,
 * "درهم إماراتي" in Arabic. From the platform's own data, like countryName, so
 * every currency in the picker is named without a hand-kept list. Falls back
 * to the English label when the engine has no name for it.
 */
export function currencyName(code: string | null | undefined, language = "en"): string {
  const upper = (code ?? "").toUpperCase();
  const english = CURRENCIES.find((c) => c.code === upper)?.label ?? upper;
  if (!upper || language === "en") return english;
  try {
    const name = new Intl.DisplayNames([language], { type: "currency" }).of(upper);
    return name && name !== upper ? name : english;
  } catch {
    return english;
  }
}

/** True when the zone is a real IANA zone this engine can format in. */
export function isValidTimeZone(zone: string | null | undefined): boolean {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Every timezone a workspace can choose. Offering only each country's main
 * zone left a US company in Los Angeles, or an Australian one in Perth, unable
 * to pick its own clock.
 */
export function allTimeZones(): string[] {
  const zones = new Set<string>(["UTC"]);
  try {
    const supported = (
      Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf?.("timeZone");
    for (const zone of supported ?? []) zones.add(zone);
  } catch {
    // Older engines: the country defaults below are still offered.
  }
  for (const country of COUNTRIES) zones.add(country.timezone);
  return [...zones].sort((a, b) => (a === "UTC" ? -1 : b === "UTC" ? 1 : a.localeCompare(b)));
}
