// Every country a company using Flas can operate from: its currency, the
// timezone its business day runs on, and its international calling code.
//
// One row per country. The compliance region is not stored here -- it is
// derived from the rules in regionOf() below, so a country cannot drift into
// the wrong set of messaging rules by a typo in one row.
//
// Deliberately absent: Cuba, Iran, North Korea and Syria. Meta's WhatsApp
// Business Platform and Paddle, which bills Flas subscriptions, do not serve
// comprehensively sanctioned jurisdictions, so a company registered there
// could neither message customers nor pay.
//
// For a country spanning several zones (US, Canada, Australia, Brazil, Russia,
// Mexico, Indonesia...) the timezone is the main business hub's. It is only the
// default: Settings offers every IANA zone.

/** [ISO 3166-1 alpha-2, currency, timezone, calling code, English name] */
type Row = readonly [string, string, string, string, string];

const ROWS: readonly Row[] = [
  // ── Gulf ──────────────────────────────────────────────────────────────────
  ["AE", "AED", "Asia/Dubai", "971", "United Arab Emirates"],
  ["SA", "SAR", "Asia/Riyadh", "966", "Saudi Arabia"],
  ["QA", "QAR", "Asia/Qatar", "974", "Qatar"],
  ["KW", "KWD", "Asia/Kuwait", "965", "Kuwait"],
  ["OM", "OMR", "Asia/Muscat", "968", "Oman"],
  ["BH", "BHD", "Asia/Bahrain", "973", "Bahrain"],

  // ── Middle East, Caucasus & Central Asia ─────────────────────────────────
  ["AF", "AFN", "Asia/Kabul", "93", "Afghanistan"],
  ["AM", "AMD", "Asia/Yerevan", "374", "Armenia"],
  ["AZ", "AZN", "Asia/Baku", "994", "Azerbaijan"],
  ["GE", "GEL", "Asia/Tbilisi", "995", "Georgia"],
  ["IQ", "IQD", "Asia/Baghdad", "964", "Iraq"],
  ["IL", "ILS", "Asia/Jerusalem", "972", "Israel"],
  ["JO", "JOD", "Asia/Amman", "962", "Jordan"],
  ["KZ", "KZT", "Asia/Almaty", "7", "Kazakhstan"],
  ["KG", "KGS", "Asia/Bishkek", "996", "Kyrgyzstan"],
  ["LB", "LBP", "Asia/Beirut", "961", "Lebanon"],
  ["PS", "ILS", "Asia/Hebron", "970", "Palestine"],
  ["TJ", "TJS", "Asia/Dushanbe", "992", "Tajikistan"],
  ["TR", "TRY", "Europe/Istanbul", "90", "Türkiye"],
  ["TM", "TMT", "Asia/Ashgabat", "993", "Turkmenistan"],
  ["UZ", "UZS", "Asia/Tashkent", "998", "Uzbekistan"],
  ["YE", "YER", "Asia/Aden", "967", "Yemen"],

  // ── South Asia ───────────────────────────────────────────────────────────
  ["IN", "INR", "Asia/Kolkata", "91", "India"],
  ["PK", "PKR", "Asia/Karachi", "92", "Pakistan"],
  ["BD", "BDT", "Asia/Dhaka", "880", "Bangladesh"],
  ["LK", "LKR", "Asia/Colombo", "94", "Sri Lanka"],
  ["NP", "NPR", "Asia/Kathmandu", "977", "Nepal"],
  ["BT", "BTN", "Asia/Thimphu", "975", "Bhutan"],
  ["MV", "MVR", "Indian/Maldives", "960", "Maldives"],

  // ── East & Southeast Asia ────────────────────────────────────────────────
  ["CN", "CNY", "Asia/Shanghai", "86", "China"],
  ["HK", "HKD", "Asia/Hong_Kong", "852", "Hong Kong"],
  ["MO", "MOP", "Asia/Macau", "853", "Macao"],
  ["TW", "TWD", "Asia/Taipei", "886", "Taiwan"],
  ["JP", "JPY", "Asia/Tokyo", "81", "Japan"],
  ["KR", "KRW", "Asia/Seoul", "82", "South Korea"],
  ["MN", "MNT", "Asia/Ulaanbaatar", "976", "Mongolia"],
  ["SG", "SGD", "Asia/Singapore", "65", "Singapore"],
  ["MY", "MYR", "Asia/Kuala_Lumpur", "60", "Malaysia"],
  ["ID", "IDR", "Asia/Jakarta", "62", "Indonesia"],
  ["PH", "PHP", "Asia/Manila", "63", "Philippines"],
  ["TH", "THB", "Asia/Bangkok", "66", "Thailand"],
  ["VN", "VND", "Asia/Ho_Chi_Minh", "84", "Vietnam"],
  ["KH", "KHR", "Asia/Phnom_Penh", "855", "Cambodia"],
  ["LA", "LAK", "Asia/Vientiane", "856", "Laos"],
  ["MM", "MMK", "Asia/Yangon", "95", "Myanmar"],
  ["BN", "BND", "Asia/Brunei", "673", "Brunei"],
  ["TL", "USD", "Asia/Dili", "670", "Timor-Leste"],

  // ── Oceania ──────────────────────────────────────────────────────────────
  ["AU", "AUD", "Australia/Sydney", "61", "Australia"],
  ["NZ", "NZD", "Pacific/Auckland", "64", "New Zealand"],
  ["FJ", "FJD", "Pacific/Fiji", "679", "Fiji"],
  ["PG", "PGK", "Pacific/Port_Moresby", "675", "Papua New Guinea"],
  ["SB", "SBD", "Pacific/Guadalcanal", "677", "Solomon Islands"],
  ["VU", "VUV", "Pacific/Efate", "678", "Vanuatu"],
  ["WS", "WST", "Pacific/Apia", "685", "Samoa"],
  ["TO", "TOP", "Pacific/Tongatapu", "676", "Tonga"],
  ["KI", "AUD", "Pacific/Tarawa", "686", "Kiribati"],
  ["NR", "AUD", "Pacific/Nauru", "674", "Nauru"],
  ["TV", "AUD", "Pacific/Funafuti", "688", "Tuvalu"],
  ["MH", "USD", "Pacific/Majuro", "692", "Marshall Islands"],
  ["FM", "USD", "Pacific/Pohnpei", "691", "Micronesia"],
  ["PW", "USD", "Pacific/Palau", "680", "Palau"],

  // ── Europe ───────────────────────────────────────────────────────────────
  ["GB", "GBP", "Europe/London", "44", "United Kingdom"],
  ["IE", "EUR", "Europe/Dublin", "353", "Ireland"],
  ["DE", "EUR", "Europe/Berlin", "49", "Germany"],
  ["FR", "EUR", "Europe/Paris", "33", "France"],
  ["ES", "EUR", "Europe/Madrid", "34", "Spain"],
  ["IT", "EUR", "Europe/Rome", "39", "Italy"],
  ["NL", "EUR", "Europe/Amsterdam", "31", "Netherlands"],
  ["BE", "EUR", "Europe/Brussels", "32", "Belgium"],
  ["LU", "EUR", "Europe/Luxembourg", "352", "Luxembourg"],
  ["AT", "EUR", "Europe/Vienna", "43", "Austria"],
  ["PT", "EUR", "Europe/Lisbon", "351", "Portugal"],
  ["GR", "EUR", "Europe/Athens", "30", "Greece"],
  ["CY", "EUR", "Asia/Nicosia", "357", "Cyprus"],
  ["MT", "EUR", "Europe/Malta", "356", "Malta"],
  ["FI", "EUR", "Europe/Helsinki", "358", "Finland"],
  ["EE", "EUR", "Europe/Tallinn", "372", "Estonia"],
  ["LV", "EUR", "Europe/Riga", "371", "Latvia"],
  ["LT", "EUR", "Europe/Vilnius", "370", "Lithuania"],
  ["SK", "EUR", "Europe/Bratislava", "421", "Slovakia"],
  ["SI", "EUR", "Europe/Ljubljana", "386", "Slovenia"],
  ["HR", "EUR", "Europe/Zagreb", "385", "Croatia"],
  // Bulgaria adopted the euro on 1 January 2026.
  ["BG", "EUR", "Europe/Sofia", "359", "Bulgaria"],
  ["SE", "SEK", "Europe/Stockholm", "46", "Sweden"],
  ["DK", "DKK", "Europe/Copenhagen", "45", "Denmark"],
  ["PL", "PLN", "Europe/Warsaw", "48", "Poland"],
  ["CZ", "CZK", "Europe/Prague", "420", "Czechia"],
  ["HU", "HUF", "Europe/Budapest", "36", "Hungary"],
  ["RO", "RON", "Europe/Bucharest", "40", "Romania"],
  ["NO", "NOK", "Europe/Oslo", "47", "Norway"],
  ["IS", "ISK", "Atlantic/Reykjavik", "354", "Iceland"],
  ["LI", "CHF", "Europe/Vaduz", "423", "Liechtenstein"],
  ["CH", "CHF", "Europe/Zurich", "41", "Switzerland"],
  ["AD", "EUR", "Europe/Andorra", "376", "Andorra"],
  ["MC", "EUR", "Europe/Monaco", "377", "Monaco"],
  ["SM", "EUR", "Europe/San_Marino", "378", "San Marino"],
  ["AL", "ALL", "Europe/Tirane", "355", "Albania"],
  ["BA", "BAM", "Europe/Sarajevo", "387", "Bosnia & Herzegovina"],
  ["ME", "EUR", "Europe/Podgorica", "382", "Montenegro"],
  ["MK", "MKD", "Europe/Skopje", "389", "North Macedonia"],
  ["RS", "RSD", "Europe/Belgrade", "381", "Serbia"],
  // IANA has no Pristina zone; Kosovo keeps Belgrade's time.
  ["XK", "EUR", "Europe/Belgrade", "383", "Kosovo"],
  ["MD", "MDL", "Europe/Chisinau", "373", "Moldova"],
  ["UA", "UAH", "Europe/Kyiv", "380", "Ukraine"],
  ["BY", "BYN", "Europe/Minsk", "375", "Belarus"],
  ["RU", "RUB", "Europe/Moscow", "7", "Russia"],

  // ── North America & Caribbean ────────────────────────────────────────────
  ["US", "USD", "America/New_York", "1", "United States"],
  ["CA", "CAD", "America/Toronto", "1", "Canada"],
  ["MX", "MXN", "America/Mexico_City", "52", "Mexico"],
  ["PR", "USD", "America/Puerto_Rico", "1", "Puerto Rico"],
  ["BS", "BSD", "America/Nassau", "1", "Bahamas"],
  ["BB", "BBD", "America/Barbados", "1", "Barbados"],
  ["JM", "JMD", "America/Jamaica", "1", "Jamaica"],
  ["TT", "TTD", "America/Port_of_Spain", "1", "Trinidad & Tobago"],
  ["DO", "DOP", "America/Santo_Domingo", "1", "Dominican Republic"],
  ["AG", "XCD", "America/Antigua", "1", "Antigua & Barbuda"],
  ["DM", "XCD", "America/Dominica", "1", "Dominica"],
  ["GD", "XCD", "America/Grenada", "1", "Grenada"],
  ["KN", "XCD", "America/St_Kitts", "1", "St. Kitts & Nevis"],
  ["LC", "XCD", "America/St_Lucia", "1", "St. Lucia"],
  ["VC", "XCD", "America/St_Vincent", "1", "St. Vincent & Grenadines"],
  ["HT", "HTG", "America/Port-au-Prince", "509", "Haiti"],

  // ── Central & South America ──────────────────────────────────────────────
  ["BZ", "BZD", "America/Belize", "501", "Belize"],
  ["GT", "GTQ", "America/Guatemala", "502", "Guatemala"],
  ["SV", "USD", "America/El_Salvador", "503", "El Salvador"],
  ["HN", "HNL", "America/Tegucigalpa", "504", "Honduras"],
  ["NI", "NIO", "America/Managua", "505", "Nicaragua"],
  ["CR", "CRC", "America/Costa_Rica", "506", "Costa Rica"],
  ["PA", "USD", "America/Panama", "507", "Panama"],
  ["CO", "COP", "America/Bogota", "57", "Colombia"],
  ["VE", "VES", "America/Caracas", "58", "Venezuela"],
  ["EC", "USD", "America/Guayaquil", "593", "Ecuador"],
  ["PE", "PEN", "America/Lima", "51", "Peru"],
  ["BO", "BOB", "America/La_Paz", "591", "Bolivia"],
  ["BR", "BRL", "America/Sao_Paulo", "55", "Brazil"],
  ["PY", "PYG", "America/Asuncion", "595", "Paraguay"],
  ["UY", "UYU", "America/Montevideo", "598", "Uruguay"],
  ["AR", "ARS", "America/Argentina/Buenos_Aires", "54", "Argentina"],
  ["CL", "CLP", "America/Santiago", "56", "Chile"],
  ["GY", "GYD", "America/Guyana", "592", "Guyana"],
  ["SR", "SRD", "America/Paramaribo", "597", "Suriname"],

  // ── North Africa ─────────────────────────────────────────────────────────
  ["EG", "EGP", "Africa/Cairo", "20", "Egypt"],
  ["MA", "MAD", "Africa/Casablanca", "212", "Morocco"],
  ["DZ", "DZD", "Africa/Algiers", "213", "Algeria"],
  ["TN", "TND", "Africa/Tunis", "216", "Tunisia"],
  ["LY", "LYD", "Africa/Tripoli", "218", "Libya"],
  ["SD", "SDG", "Africa/Khartoum", "249", "Sudan"],
  ["MR", "MRU", "Africa/Nouakchott", "222", "Mauritania"],

  // ── Sub-Saharan Africa ───────────────────────────────────────────────────
  ["NG", "NGN", "Africa/Lagos", "234", "Nigeria"],
  ["GH", "GHS", "Africa/Accra", "233", "Ghana"],
  ["KE", "KES", "Africa/Nairobi", "254", "Kenya"],
  ["RW", "RWF", "Africa/Kigali", "250", "Rwanda"],
  ["UG", "UGX", "Africa/Kampala", "256", "Uganda"],
  ["TZ", "TZS", "Africa/Dar_es_Salaam", "255", "Tanzania"],
  ["ET", "ETB", "Africa/Addis_Ababa", "251", "Ethiopia"],
  ["SO", "SOS", "Africa/Mogadishu", "252", "Somalia"],
  ["DJ", "DJF", "Africa/Djibouti", "253", "Djibouti"],
  ["ER", "ERN", "Africa/Asmara", "291", "Eritrea"],
  ["SS", "SSP", "Africa/Juba", "211", "South Sudan"],
  ["BI", "BIF", "Africa/Bujumbura", "257", "Burundi"],
  ["ZA", "ZAR", "Africa/Johannesburg", "27", "South Africa"],
  ["NA", "NAD", "Africa/Windhoek", "264", "Namibia"],
  ["BW", "BWP", "Africa/Gaborone", "267", "Botswana"],
  // Zimbabwe trades largely in US dollars alongside its own currency.
  ["ZW", "USD", "Africa/Harare", "263", "Zimbabwe"],
  ["ZM", "ZMW", "Africa/Lusaka", "260", "Zambia"],
  ["MW", "MWK", "Africa/Blantyre", "265", "Malawi"],
  ["MZ", "MZN", "Africa/Maputo", "258", "Mozambique"],
  ["AO", "AOA", "Africa/Luanda", "244", "Angola"],
  ["LS", "LSL", "Africa/Maseru", "266", "Lesotho"],
  ["SZ", "SZL", "Africa/Mbabane", "268", "Eswatini"],
  ["MG", "MGA", "Indian/Antananarivo", "261", "Madagascar"],
  ["MU", "MUR", "Indian/Mauritius", "230", "Mauritius"],
  ["SC", "SCR", "Indian/Mahe", "248", "Seychelles"],
  ["KM", "KMF", "Indian/Comoro", "269", "Comoros"],
  ["SN", "XOF", "Africa/Dakar", "221", "Senegal"],
  ["CI", "XOF", "Africa/Abidjan", "225", "Côte d’Ivoire"],
  ["ML", "XOF", "Africa/Bamako", "223", "Mali"],
  ["BF", "XOF", "Africa/Ouagadougou", "226", "Burkina Faso"],
  ["NE", "XOF", "Africa/Niamey", "227", "Niger"],
  ["TG", "XOF", "Africa/Lome", "228", "Togo"],
  ["BJ", "XOF", "Africa/Porto-Novo", "229", "Benin"],
  ["GW", "XOF", "Africa/Bissau", "245", "Guinea-Bissau"],
  ["GN", "GNF", "Africa/Conakry", "224", "Guinea"],
  ["SL", "SLE", "Africa/Freetown", "232", "Sierra Leone"],
  ["LR", "LRD", "Africa/Monrovia", "231", "Liberia"],
  ["GM", "GMD", "Africa/Banjul", "220", "Gambia"],
  ["CV", "CVE", "Atlantic/Cape_Verde", "238", "Cape Verde"],
  ["CM", "XAF", "Africa/Douala", "237", "Cameroon"],
  ["GA", "XAF", "Africa/Libreville", "241", "Gabon"],
  ["CG", "XAF", "Africa/Brazzaville", "242", "Congo - Brazzaville"],
  ["CD", "CDF", "Africa/Kinshasa", "243", "Congo - Kinshasa"],
  ["CF", "XAF", "Africa/Bangui", "236", "Central African Republic"],
  ["TD", "XAF", "Africa/Ndjamena", "235", "Chad"],
  ["GQ", "XAF", "Africa/Malabo", "240", "Equatorial Guinea"],
  ["ST", "STN", "Africa/Sao_Tome", "239", "São Tomé & Príncipe"],
];

/** GDPR applies across the EU and the wider European Economic Area. */
const EEA = new Set([
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
]);
const GCC = new Set(["AE", "SA", "QA", "KW", "OM", "BH"]);
/** The PDPA family: recorded opt-in, national do-not-call registries, transfer notices. */
const APAC = new Set([
  "PK",
  "BD",
  "LK",
  "NP",
  "BT",
  "MV",
  "CN",
  "HK",
  "MO",
  "TW",
  "JP",
  "KR",
  "MN",
  "SG",
  "MY",
  "ID",
  "PH",
  "TH",
  "VN",
  "KH",
  "LA",
  "MM",
  "BN",
  "TL",
  "AU",
  "NZ",
  "FJ",
  "PG",
  "SB",
  "VU",
  "WS",
  "TO",
  "KI",
  "NR",
  "TV",
  "MH",
  "FM",
  "PW",
]);

export type ComplianceRegion = "eu" | "uk" | "us" | "canada" | "gcc" | "india" | "apac" | "global";

export function regionOf(code: string): ComplianceRegion {
  if (code === "GB") return "uk";
  // Puerto Rico is US territory: the TCPA applies there.
  if (code === "US" || code === "PR") return "us";
  if (code === "CA") return "canada";
  if (code === "IN") return "india";
  if (GCC.has(code)) return "gcc";
  if (EEA.has(code)) return "eu";
  if (APAC.has(code)) return "apac";
  return "global";
}

export type CountryRecord = {
  code: string;
  name: string;
  currency: string;
  timezone: string;
  callingCode: string;
  region: ComplianceRegion;
};

export const COUNTRY_RECORDS: readonly CountryRecord[] = ROWS.map(
  ([code, currency, timezone, callingCode, name]) => ({
    code,
    name,
    currency,
    timezone,
    callingCode,
    region: regionOf(code),
  }),
);

/**
 * A calling code several countries share is attributed to one of them when a
 * number is read. +1 covers the US, Canada and the Caribbean; +7 Russia and
 * Kazakhstan. Without a rule here, whichever row came first would win.
 */
export const SHARED_CALLING_CODE_OWNER: Readonly<Record<string, string>> = {
  "1": "US",
  "7": "RU",
};
