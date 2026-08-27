// Browser-safe locale layer: every company using Flas picks its own country,
// currency, language and timezone, and every amount, date and AI reply follows
// it. Regional messaging rules are surfaced so a company in the EU, US, India
// or the Gulf is guided by the rules that actually apply to it.

export type CurrencyOption = { code: string; label: string; symbol: string };

export const CURRENCIES: CurrencyOption[] = [
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
  region: ComplianceRegion;
};

export type ComplianceRegion = "eu" | "uk" | "us" | "canada" | "gcc" | "india" | "apac" | "global";

export const COUNTRIES: CountryOption[] = [
  { code: "AE", name: "United Arab Emirates", currency: "AED", timezone: "Asia/Dubai", region: "gcc" },
  { code: "SA", name: "Saudi Arabia", currency: "SAR", timezone: "Asia/Riyadh", region: "gcc" },
  { code: "QA", name: "Qatar", currency: "QAR", timezone: "Asia/Qatar", region: "gcc" },
  { code: "KW", name: "Kuwait", currency: "KWD", timezone: "Asia/Kuwait", region: "gcc" },
  { code: "OM", name: "Oman", currency: "OMR", timezone: "Asia/Muscat", region: "gcc" },
  { code: "BH", name: "Bahrain", currency: "BHD", timezone: "Asia/Bahrain", region: "gcc" },
  { code: "GB", name: "United Kingdom", currency: "GBP", timezone: "Europe/London", region: "uk" },
  { code: "IE", name: "Ireland", currency: "EUR", timezone: "Europe/Dublin", region: "eu" },
  { code: "DE", name: "Germany", currency: "EUR", timezone: "Europe/Berlin", region: "eu" },
  { code: "FR", name: "France", currency: "EUR", timezone: "Europe/Paris", region: "eu" },
  { code: "ES", name: "Spain", currency: "EUR", timezone: "Europe/Madrid", region: "eu" },
  { code: "IT", name: "Italy", currency: "EUR", timezone: "Europe/Rome", region: "eu" },
  { code: "NL", name: "Netherlands", currency: "EUR", timezone: "Europe/Amsterdam", region: "eu" },
  { code: "US", name: "United States", currency: "USD", timezone: "America/New_York", region: "us" },
  { code: "CA", name: "Canada", currency: "CAD", timezone: "America/Toronto", region: "canada" },
  { code: "MX", name: "Mexico", currency: "MXN", timezone: "America/Mexico_City", region: "global" },
  { code: "BR", name: "Brazil", currency: "BRL", timezone: "America/Sao_Paulo", region: "global" },
  { code: "IN", name: "India", currency: "INR", timezone: "Asia/Kolkata", region: "india" },
  { code: "PK", name: "Pakistan", currency: "PKR", timezone: "Asia/Karachi", region: "apac" },
  { code: "BD", name: "Bangladesh", currency: "BDT", timezone: "Asia/Dhaka", region: "apac" },
  { code: "SG", name: "Singapore", currency: "SGD", timezone: "Asia/Singapore", region: "apac" },
  { code: "MY", name: "Malaysia", currency: "MYR", timezone: "Asia/Kuala_Lumpur", region: "apac" },
  { code: "ID", name: "Indonesia", currency: "IDR", timezone: "Asia/Jakarta", region: "apac" },
  { code: "PH", name: "Philippines", currency: "PHP", timezone: "Asia/Manila", region: "apac" },
  { code: "AU", name: "Australia", currency: "AUD", timezone: "Australia/Sydney", region: "apac" },
  { code: "TR", name: "Türkiye", currency: "TRY", timezone: "Europe/Istanbul", region: "global" },
  { code: "EG", name: "Egypt", currency: "EGP", timezone: "Africa/Cairo", region: "global" },
  { code: "NG", name: "Nigeria", currency: "NGN", timezone: "Africa/Lagos", region: "global" },
  { code: "KE", name: "Kenya", currency: "KES", timezone: "Africa/Nairobi", region: "global" },
  { code: "ZA", name: "South Africa", currency: "ZAR", timezone: "Africa/Johannesburg", region: "global" },
];

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

export const DEFAULT_LOCALE: TenantLocale = {
  country: "AE",
  currency: "USD",
  locale: "en",
  timezone: "UTC",
  region: "gcc",
};

export function countryOption(code: string | null | undefined): CountryOption | undefined {
  return COUNTRIES.find((c) => c.code === (code ?? "").toUpperCase());
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

export function resolveTenantLocale(org: {
  country?: string | null;
  currency?: string | null;
  locale?: string | null;
  timezone?: string | null;
  compliance_region?: string | null;
} | null): TenantLocale {
  const country = (org?.country ?? DEFAULT_LOCALE.country).toUpperCase();
  return {
    country,
    currency: (org?.currency ?? countryOption(country)?.currency ?? DEFAULT_LOCALE.currency).toUpperCase(),
    locale: org?.locale ?? DEFAULT_LOCALE.locale,
    timezone: org?.timezone ?? countryOption(country)?.timezone ?? DEFAULT_LOCALE.timezone,
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
