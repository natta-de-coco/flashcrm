// "We need more countries": Flas offered 30. Every row of the new table is
// checked against the platform itself -- a real ISO region, a real timezone, a
// currency Intl can format -- and the original 30 are pinned to the exact
// values they had, because a saved workspace must not change meaning.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);

function loadLib(relative, modules = {}) {
  const compiled = ts.transpileModule(readFileSync(new URL(relative, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  runInNewContext(compiled, {
    exports,
    require: (id) => modules[id] ?? require(id),
    Intl,
  });
  return exports;
}

const countries = loadLib("../src/lib/countries.ts");
const locale = loadLib("../src/lib/locale.ts", { "./countries": countries });
const { RegionSchema } = loadLib("../src/lib/region-schema.ts", { "@/lib/locale": locale });
const { COUNTRIES, CURRENCIES } = locale;

// The 30 Flas shipped with, as they were on main before this change.
const ORIGINAL = [
  ["AE", "AED", "Asia/Dubai", "gcc"],
  ["SA", "SAR", "Asia/Riyadh", "gcc"],
  ["QA", "QAR", "Asia/Qatar", "gcc"],
  ["KW", "KWD", "Asia/Kuwait", "gcc"],
  ["OM", "OMR", "Asia/Muscat", "gcc"],
  ["BH", "BHD", "Asia/Bahrain", "gcc"],
  ["GB", "GBP", "Europe/London", "uk"],
  ["IE", "EUR", "Europe/Dublin", "eu"],
  ["DE", "EUR", "Europe/Berlin", "eu"],
  ["FR", "EUR", "Europe/Paris", "eu"],
  ["ES", "EUR", "Europe/Madrid", "eu"],
  ["IT", "EUR", "Europe/Rome", "eu"],
  ["NL", "EUR", "Europe/Amsterdam", "eu"],
  ["US", "USD", "America/New_York", "us"],
  ["CA", "CAD", "America/Toronto", "canada"],
  ["MX", "MXN", "America/Mexico_City", "global"],
  ["BR", "BRL", "America/Sao_Paulo", "global"],
  ["IN", "INR", "Asia/Kolkata", "india"],
  ["PK", "PKR", "Asia/Karachi", "apac"],
  ["BD", "BDT", "Asia/Dhaka", "apac"],
  ["SG", "SGD", "Asia/Singapore", "apac"],
  ["MY", "MYR", "Asia/Kuala_Lumpur", "apac"],
  ["ID", "IDR", "Asia/Jakarta", "apac"],
  ["PH", "PHP", "Asia/Manila", "apac"],
  ["AU", "AUD", "Australia/Sydney", "apac"],
  ["TR", "TRY", "Europe/Istanbul", "global"],
  ["EG", "EGP", "Africa/Cairo", "global"],
  ["NG", "NGN", "Africa/Lagos", "global"],
  ["KE", "KES", "Africa/Nairobi", "global"],
  ["ZA", "ZAR", "Africa/Johannesburg", "global"],
];

describe("the country list", () => {
  it("covers the world, not 30 countries", () => {
    assert.ok(COUNTRIES.length >= 180, `only ${COUNTRIES.length} countries`);
  });

  it("has each country once", () => {
    const codes = COUNTRIES.map((c) => c.code);
    assert.equal(new Set(codes).size, codes.length);
  });

  it("uses real ISO region codes", () => {
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    for (const c of COUNTRIES) {
      assert.match(c.code, /^[A-Z]{2}$/, c.code);
      assert.notEqual(names.of(c.code), c.code, `${c.code} is not a region Intl knows`);
    }
  });

  it("gives every country a timezone the platform can format in", () => {
    for (const c of COUNTRIES) {
      assert.ok(locale.isValidTimeZone(c.timezone), `${c.code}: ${c.timezone}`);
    }
  });

  it("gives every country a currency the Currency picker and the server accept", () => {
    const offered = new Set(CURRENCIES.map((c) => c.code));
    for (const c of COUNTRIES) {
      assert.ok(offered.has(c.currency), `${c.code} uses ${c.currency}, which is not offered`);
      assert.doesNotThrow(() =>
        new Intl.NumberFormat("en", { style: "currency", currency: c.currency }).format(1),
      );
    }
  });

  it("offers the currencies invoices already use, Rwanda's included", () => {
    const offered = new Set(CURRENCIES.map((c) => c.code));
    // billing-math.ts lists these for documents; a workspace must be able to pick them.
    for (const code of [
      "AED",
      "USD",
      "EUR",
      "GBP",
      "SAR",
      "QAR",
      "OMR",
      "KWD",
      "BHD",
      "INR",
      "RWF",
      "PKR",
    ]) {
      assert.ok(offered.has(code), code);
    }
    assert.ok(COUNTRIES.some((c) => c.code === "RW"));
  });

  it("is sorted by name for the picker", () => {
    // Spread first: the array comes from the sandbox realm, where deepEqual also
    // compares prototypes.
    const names = [...COUNTRIES].map((c) => c.name);
    assert.deepEqual(
      names,
      [...names].sort((a, b) => a.localeCompare(b, "en")),
    );
  });

  it("leaves out the jurisdictions Meta and Paddle do not serve", () => {
    for (const code of ["CU", "IR", "KP", "SY"]) {
      assert.equal(locale.countryOption(code), undefined, code);
    }
  });
});

describe("a workspace saved before this change means the same thing after it", () => {
  for (const [code, currency, timezone, region] of ORIGINAL) {
    it(`${code} keeps ${currency}, ${timezone}, ${region}`, () => {
      const c = locale.countryOption(code);
      assert.ok(c, `${code} disappeared`);
      assert.equal(c.currency, currency);
      assert.equal(c.timezone, timezone);
      assert.equal(c.region, region);
    });
  }
});

describe("the messaging rules a country gets", () => {
  it("applies GDPR across the whole EU and EEA", () => {
    for (const code of [
      "AT",
      "BE",
      "BG",
      "HR",
      "CY",
      "CZ",
      "DK",
      "EE",
      "FI",
      "FR",
      "DE",
      "GR",
      "HU",
      "IE",
      "IT",
      "LV",
      "LT",
      "LU",
      "MT",
      "NL",
      "PL",
      "PT",
      "RO",
      "SK",
      "SI",
      "ES",
      "SE",
      "IS",
      "LI",
      "NO",
    ]) {
      assert.equal(locale.regionForCountry(code), "eu", code);
    }
  });

  it("keeps the six Gulf states on the Gulf rules", () => {
    for (const code of ["AE", "SA", "QA", "KW", "OM", "BH"]) {
      assert.equal(locale.regionForCountry(code), "gcc", code);
    }
  });

  it("does not claim GDPR for a European country outside the EEA", () => {
    // Switzerland, Serbia and the UK have their own laws; calling them GDPR
    // would show the wrong rules.
    assert.equal(locale.regionForCountry("CH"), "global");
    assert.equal(locale.regionForCountry("RS"), "global");
    assert.equal(locale.regionForCountry("GB"), "uk");
  });

  it("treats Puerto Rico as US territory under the TCPA", () => {
    assert.equal(locale.regionForCountry("PR"), "us");
  });
});

describe("reading a country off a phone number", () => {
  const from = (phone) => locale.inferCountryFromPhone(phone);

  it("still reads the numbers it always did", () => {
    assert.equal(from("+971 50 123 4567"), "AE");
    assert.equal(from("966501234567"), "SA");
    assert.equal(from("+44 7700 900123"), "GB");
    assert.equal(from("+91 98765 43210"), "IN");
    assert.equal(from("+234 803 123 4567"), "NG");
  });

  it("reads the new countries", () => {
    assert.equal(from("+250 788 123 456"), "RW");
    assert.equal(from("+233 24 123 4567"), "GH");
    assert.equal(from("+212 6 12 34 56 78"), "MA");
    assert.equal(from("+81 90 1234 5678"), "JP");
  });

  it("gives a shared code to its owner, not to whichever row came first", () => {
    assert.equal(from("+1 415 555 0100"), "US");
    assert.equal(from("+7 912 345 6789"), "RU");
  });

  it("prefers the longest code: +211 is South Sudan, not +21-something or +2", () => {
    assert.equal(from("+211 912 345 678"), "SS");
    assert.equal(from("+20 100 123 4567"), "EG");
  });
});

describe("country names follow the reader's language", () => {
  it("is English by default", () => {
    assert.equal(locale.countryName("AE"), "United Arab Emirates");
  });

  it("reads Arabic for an Arabic reader", () => {
    const name = locale.countryName("AE", "ar");
    assert.notEqual(name, "United Arab Emirates");
    assert.match(name, /[؀-ۿ]/, "expected Arabic script");
  });
});

describe("what the server accepts", () => {
  const valid = { country: "RW", currency: "RWF", locale: "en", timezone: "Africa/Kigali" };

  it("accepts a country that was not on the old list", () => {
    assert.equal(RegionSchema.safeParse(valid).success, true);
  });

  it("accepts any real timezone, not only a country's default", () => {
    assert.equal(
      RegionSchema.safeParse({
        ...valid,
        country: "US",
        currency: "USD",
        timezone: "America/Los_Angeles",
      }).success,
      true,
    );
  });

  it("refuses a timezone that is not one", () => {
    // It accepted any string, and an unknown zone broke every date shown.
    assert.equal(
      RegionSchema.safeParse({ ...valid, timezone: "Mars/Olympus_Mons" }).success,
      false,
    );
  });

  it("refuses a country that is not on the list", () => {
    assert.equal(RegionSchema.safeParse({ ...valid, country: "XX" }).success, false);
  });
});

describe("the timezone picker", () => {
  it("offers far more than one zone per country", () => {
    const zones = locale.allTimeZones();
    assert.ok(zones.includes("America/Los_Angeles"));
    assert.ok(zones.includes("Australia/Perth"));
    assert.equal(zones[0], "UTC");
  });
});

describe("a searchable picker's list is as wide as the field it opens from", () => {
  it("reads the trigger's width with Tailwind 4's variable syntax", () => {
    // `w-[--radix-popover-trigger-width]` is Tailwind 3 syntax and resolves to
    // nothing in Tailwind 4, so the list fell back to its minimum width:
    // long timezone names were cut off and narrow cards overflowed.
    const picker = readFileSync(
      new URL("../src/components/ui/searchable-select.tsx", import.meta.url),
      "utf8",
    );
    assert.match(picker, /w-\(--radix-popover-trigger-width\)/);
    assert.ok(!/-\[--[a-z]/.test(picker), "a bare --variable in square brackets does nothing");
  });
});

const readSource = (relative) =>
  readFileSync(new URL(relative, import.meta.url), "utf8")
    .split("\r\n")
    .join("\n");

describe("currency names follow the reader's language", () => {
  it("is the English label by default", () => {
    const aed = CURRENCIES.find((c) => c.code === "AED");
    assert.equal(locale.currencyName("AED"), aed.label);
    assert.equal(locale.currencyName("aed"), aed.label, "the code is case-insensitive");
  });

  it("reads Arabic for an Arabic reader", () => {
    const name = locale.currencyName("AED", "ar");
    assert.match(name, /[؀-ۿ]/, "expected Arabic script");
  });

  it("falls back to what it was given rather than printing nothing", () => {
    assert.equal(locale.currencyName("ZZZ", "ar"), "ZZZ");
    assert.equal(locale.currencyName(null, "ar"), "");
  });
});

describe("the Region card after the five-language merge", () => {
  const card = readSource("../src/components/settings/RegionCard.tsx");
  const picker = readSource("../src/components/ui/searchable-select.tsx");
  const messages = readSource("../src/lib/i18n/screens/region-card.ts");

  it("keeps a searchable picker for country, currency and timezone", () => {
    assert.equal(card.split("<SearchableSelect").length - 1, 3);
    assert.match(card, /options=\{countryOptions\}/);
    assert.match(card, /options=\{currencyOptions\}/);
    assert.match(card, /options=\{timezoneOptions\}/);
    assert.match(card, /allTimeZones\(\)/, "every zone, not one per country");
  });

  it("names countries in the reader's language and still finds them in English", () => {
    assert.match(card, /label: countryName\(c\.code, language\)/);
    // The English name, the ISO code and the calling code are search keywords,
    // so "UAE", "AE" and "+971" work in any interface language.
    assert.match(card, /keywords: \[c\.name, c\.code, `\+\$\{c\.callingCode\}`\]/);
    assert.match(card, /currencyName\(c\.code, language\)/);
  });

  it("has no English of its own in the picker", () => {
    // The picker's texts are required props: a caller cannot leave one out
    // and ship an untranslated "Search…".
    assert.ok(!picker.includes('"Search…"'), "an English default search placeholder");
    assert.ok(!picker.includes('"Nothing matches."'), "an English default empty text");
    assert.match(picker, /searchPlaceholder: string;/);
    assert.match(picker, /emptyText: string;/);
    for (const key of [
      "regionCard.searchCountry",
      "regionCard.noCountryMatches",
      "regionCard.searchCurrency",
      "regionCard.noCurrencyMatches",
      "regionCard.searchTimezone",
      "regionCard.noTimezoneMatches",
    ]) {
      assert.ok(card.includes(`t("${key}")`), `${key} is not used`);
      assert.ok(messages.includes(`"${key}"`), `${key} has no message`);
    }
  });

  it("keeps what the language work added: honest toast, refreshed workspace", () => {
    assert.match(card, /toast\.success\(t\("regionCard\.regionalSettingsSaved"\)\)/);
    assert.match(card, /void refresh\(\);/);
    assert.ok(!card.includes("AI replies now follow"), "the old promise about AI replies is back");
  });

  it("says each region's marketing rules in the message file exactly as the library has them", () => {
    // The card looks the rules up by region; English must stay the library's
    // own wording, and every rule needs a message or it shows untranslated.
    for (const [region, profile] of Object.entries(locale.COMPLIANCE)) {
      assert.ok(
        messages.includes(
          `"regionCard.compliance.${region}.label": ${JSON.stringify(profile.label)}`,
        ),
        `${region} label`,
      );
      profile.rules.forEach((rule, i) => {
        assert.ok(messages.includes(JSON.stringify(rule)), `${region} rule ${i}: ${rule}`);
        assert.ok(messages.includes(`"regionCard.compliance.${region}.rule.${i}"`));
      });
    }
  });
});

describe("regional settings belong to the caller's own workspace", () => {
  const server = readSource("../src/lib/workspace.functions.ts");

  it("takes the workspace from the signed-in user, never from the request", () => {
    // Both functions look the tenant up from the caller's profile. Nothing the
    // browser sends can name another company's row.
    assert.equal(server.split('.eq("id", context.userId)').length - 1, 2);
    assert.equal(server.split('.eq("id", profile.tenant_id)').length - 1, 2);
    assert.ok(!/data\.tenant_?[iI]d|data\.organization/.test(server), "a tenant id from input");
    const accepted = Object.keys(RegionSchema.shape ?? {});
    assert.deepEqual([...accepted].sort(), ["country", "currency", "locale", "timezone"]);
  });

  it("lets only a company admin change them", () => {
    assert.match(server, /\["company_admin", "super_admin"\]\.includes\(profile\.staff_role/);
  });
});

describe("what a searchable picker matches", () => {
  const { optionSearchScore, foldForSearch } = loadLib("../src/lib/option-search.ts");
  const saudi = ["المملكة العربية السعودية", "Saudi Arabia", "SA", "+966"];
  const kyrgyzstan = ["قيرغيزستان", "Kyrgyzstan", "KG", "+996"];
  const jordan = ["الأردن", "Jordan", "JO", "+962"];
  const uae = ["الإمارات العربية المتحدة", "United Arab Emirates", "AE", "+971"];

  it("finds a country by its calling code and nothing that merely resembles it", () => {
    // The fuzzy default listed +996, +976, +962, +964 and +965 for "+966".
    assert.ok(optionSearchScore(saudi, "+966") > 0);
    assert.equal(optionSearchScore(kyrgyzstan, "+966"), 0);
    assert.equal(optionSearchScore(jordan, "+966"), 0);
  });

  it("finds it by English name, local name or code, in any interface language", () => {
    assert.ok(optionSearchScore(uae, "united arab") > 0);
    assert.ok(optionSearchScore(uae, "emirates united") > 0, "words in any order");
    assert.ok(optionSearchScore(uae, "ae") > 0);
    assert.ok(optionSearchScore(uae, "الإمارات") > 0);
    assert.equal(optionSearchScore(uae, "zzzz"), 0);
  });

  it("forgives the Arabic spellings people type interchangeably, and accents", () => {
    assert.ok(optionSearchScore(uae, "الامارات") > 0, "alef without hamza");
    assert.ok(optionSearchScore(jordan, "الاردن") > 0);
    assert.equal(foldForSearch("São Paulo"), "sao paulo");
  });

  it("puts an exact code ahead of a longer name that merely contains it", () => {
    const samoa = ["Samoa", "WS", "+685"];
    assert.ok(optionSearchScore(saudi, "sa") > optionSearchScore(samoa, "sa"));
    assert.ok(optionSearchScore(samoa, "sa") > 0);
  });

  it("shows everything before anything is typed", () => {
    assert.equal(optionSearchScore(saudi, ""), 1);
    assert.equal(optionSearchScore(saudi, "   "), 1);
  });

  it("is what the picker uses", () => {
    const picker = readSource("../src/components/ui/searchable-select.tsx");
    assert.match(
      picker,
      /optionSearchScore\(\[\.\.\.\(keywords \?\? \[\]\), itemValue\], search\)/,
    );
  });
});
