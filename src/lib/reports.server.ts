/*
 * Reports for the connectors whose whole point is numbers: Google Analytics 4,
 * Google Search Console and Meta Ads.
 *
 * Until now each of these connected and then did nothing -- the registry said
 * so ("connection stored only", "no spend reporting is built"). This reads the
 * last 28 days from each provider's own reporting API with the permissions
 * customers already granted (analytics.readonly, webmasters.readonly,
 * ads_read), so no one has to reconnect.
 *
 * Every fetcher returns the same shape, so one screen renders all three and a
 * provider's figures are never reshaped by the UI. Figures are the provider's
 * own; nothing here estimates, samples or fills in a missing value.
 */

export type ReportMetric = {
  key: string;
  label: string;
  value: number;
  format: "number" | "percent" | "currency" | "decimal";
  currency?: string | undefined;
};

export type ReportTable = {
  title: string;
  columns: { key: string; label: string; format: ReportMetric["format"] }[];
  rows: { label: string; values: Record<string, number> }[];
};

export type ChannelReport = {
  platform: "google_analytics" | "search_console" | "meta_ads";
  /** Inclusive calendar dates the figures cover, as the provider reported them. */
  from: string;
  to: string;
  totals: ReportMetric[];
  table: ReportTable;
  /** A caveat the reader needs, e.g. Search Console's reporting delay. */
  note: string | null;
};

export const REPORT_PLATFORMS = ["google_analytics", "search_console", "meta_ads"] as const;

export function hasReports(platform: string): boolean {
  return (REPORT_PLATFORMS as readonly string[]).includes(platform);
}

const DAYS = 28;

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Last full `days` days ending `endOffset` days ago, as YYYY-MM-DD. */
function window(days: number, endOffset: number): { from: string; to: string } {
  const end = new Date(Date.now() - endOffset * 86_400_000);
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);
  return { from: isoDay(start), to: isoDay(end) };
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

type MetricValue = { value?: string };
type ReportRow = {
  dimensionValues?: MetricValue[];
  metricValues?: MetricValue[];
  keys?: string[];
  clicks?: unknown;
  impressions?: unknown;
  ctr?: unknown;
  position?: unknown;
};
type ReportJson = {
  error?: { message?: string; status?: string };
  error_description?: string;
  metricHeaders?: { name?: string }[];
  totals?: { metricValues?: MetricValue[] }[];
  rows?: ReportRow[];
  currency?: string;
  data?: {
    campaign_name?: string;
    spend?: unknown;
    reach?: unknown;
    clicks?: unknown;
    impressions?: unknown;
    ctr?: unknown;
    cpc?: unknown;
  }[];
};
async function readJson(res: Response, provider: string): Promise<ReportJson> {
  const json: ReportJson = await res.json().catch(() => ({}));
  if (!res.ok || json?.error) {
    const detail =
      json?.error?.message ??
      json?.error?.status ??
      json?.error_description ??
      `HTTP ${res.status}`;
    throw new Error(`${provider} refused the report request: ${String(detail).slice(0, 300)}`);
  }
  return json;
}

/** Google Analytics 4: traffic by default channel group, via the Data API. */
export async function ga4Report(token: string, property: string): Promise<ChannelReport> {
  if (!/^properties\/\d+$/.test(property)) {
    throw new Error("Choose which GA4 property this connection should report on.");
  }
  const range = window(DAYS, 1);
  const metrics = ["sessions", "totalUsers", "screenPageViews", "keyEvents"];
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/${property}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      dateRanges: [{ startDate: range.from, endDate: range.to }],
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: metrics.map((name) => ({ name })),
      metricAggregations: ["TOTAL"],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 10,
    }),
  });
  const json = await readJson(res, "Google Analytics");
  const headerNames: string[] = (json?.metricHeaders ?? []).map((h) => String(h?.name));
  const at = (values: MetricValue[] | undefined, name: string) =>
    num(values?.[headerNames.indexOf(name)]?.value);
  const totals = json?.totals?.[0]?.metricValues as MetricValue[] | undefined;

  return {
    platform: "google_analytics",
    ...range,
    totals: [
      { key: "sessions", label: "Sessions", value: at(totals, "sessions"), format: "number" },
      { key: "totalUsers", label: "Users", value: at(totals, "totalUsers"), format: "number" },
      {
        key: "screenPageViews",
        label: "Views",
        value: at(totals, "screenPageViews"),
        format: "number",
      },
      { key: "keyEvents", label: "Key events", value: at(totals, "keyEvents"), format: "number" },
    ],
    table: {
      title: "Traffic by channel",
      columns: [
        { key: "sessions", label: "Sessions", format: "number" },
        { key: "totalUsers", label: "Users", format: "number" },
        { key: "keyEvents", label: "Key events", format: "number" },
      ],
      rows: (json?.rows ?? []).map((row) => ({
        label: String(row?.dimensionValues?.[0]?.value ?? "(not set)"),
        values: {
          sessions: at(row?.metricValues, "sessions"),
          totalUsers: at(row?.metricValues, "totalUsers"),
          keyEvents: at(row?.metricValues, "keyEvents"),
        },
      })),
    },
    note: null,
  };
}

/** Search Console: clicks, impressions, CTR and position, and the top queries. */
export async function searchConsoleReport(token: string, siteUrl: string): Promise<ChannelReport> {
  if (!siteUrl)
    throw new Error("Choose which Search Console site this connection should report on.");
  // Search Console data lags by two to three days; asking for them returns
  // zeros that read as a collapse in traffic. The window ends three days ago.
  const range = window(DAYS, 3);
  const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const ask = (body: Record<string, unknown>) =>
    fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ startDate: range.from, endDate: range.to, ...body }),
    }).then((res) => readJson(res, "Search Console"));

  const [overall, byQuery] = await Promise.all([
    ask({}),
    ask({ dimensions: ["query"], rowLimit: 10 }),
  ]);
  const total = overall?.rows?.[0] ?? {};

  return {
    platform: "search_console",
    ...range,
    totals: [
      { key: "clicks", label: "Clicks", value: num(total.clicks), format: "number" },
      { key: "impressions", label: "Impressions", value: num(total.impressions), format: "number" },
      { key: "ctr", label: "CTR", value: num(total.ctr), format: "percent" },
      { key: "position", label: "Avg. position", value: num(total.position), format: "decimal" },
    ],
    table: {
      title: "Top search queries",
      columns: [
        { key: "clicks", label: "Clicks", format: "number" },
        { key: "impressions", label: "Impressions", format: "number" },
        { key: "ctr", label: "CTR", format: "percent" },
        { key: "position", label: "Position", format: "decimal" },
      ],
      rows: (byQuery?.rows ?? []).map((row) => ({
        label: String(row?.keys?.[0] ?? "(not set)"),
        values: {
          clicks: num(row?.clicks),
          impressions: num(row?.impressions),
          ctr: num(row?.ctr),
          position: num(row?.position),
        },
      })),
    },
    note: "Search Console reports with a two to three day delay, so the period ends three days ago.",
  };
}

/** Meta Ads: account totals and the top campaigns by spend, via the Insights API. */
export async function metaAdsReport(token: string, adAccountId: string): Promise<ChannelReport> {
  if (!/^act_\d+$/.test(adAccountId)) {
    throw new Error("Choose which ad account this connection should report on.");
  }
  const range = window(DAYS, 1);
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  const base = `https://graph.facebook.com/v21.0/${adAccountId}`;
  const timeRange = encodeURIComponent(JSON.stringify({ since: range.from, until: range.to }));

  const [account, overall, campaigns] = await Promise.all([
    fetch(`${base}?fields=currency`, auth).then((res) => readJson(res, "Meta")),
    fetch(
      `${base}/insights?level=account&time_range=${timeRange}&fields=spend,impressions,reach,clicks,ctr,cpc`,
      auth,
    ).then((res) => readJson(res, "Meta")),
    fetch(
      `${base}/insights?level=campaign&time_range=${timeRange}&fields=campaign_name,spend,impressions,clicks,ctr&sort=spend_descending&limit=10`,
      auth,
    ).then((res) => readJson(res, "Meta")),
  ]);
  const currency = typeof account?.currency === "string" ? account.currency : undefined;
  const total = overall?.data?.[0] ?? {};

  return {
    platform: "meta_ads",
    ...range,
    totals: [
      { key: "spend", label: "Spend", value: num(total.spend), format: "currency", currency },
      { key: "reach", label: "Reach", value: num(total.reach), format: "number" },
      { key: "clicks", label: "Clicks", value: num(total.clicks), format: "number" },
      // Meta reports CTR as a percentage figure (1.5 means 1.5%); stored as a
      // fraction so every report formats percentages the same way.
      { key: "ctr", label: "CTR", value: num(total.ctr) / 100, format: "percent" },
      { key: "cpc", label: "CPC", value: num(total.cpc), format: "currency", currency },
    ],
    table: {
      title: "Top campaigns by spend",
      columns: [
        { key: "spend", label: "Spend", format: "currency" },
        { key: "impressions", label: "Impressions", format: "number" },
        { key: "clicks", label: "Clicks", format: "number" },
        { key: "ctr", label: "CTR", format: "percent" },
      ],
      rows: (campaigns?.data ?? []).map((row) => ({
        label: String(row?.campaign_name ?? "(unnamed campaign)"),
        values: {
          spend: num(row?.spend),
          impressions: num(row?.impressions),
          clicks: num(row?.clicks),
          ctr: num(row?.ctr) / 100,
        },
      })),
    },
    note: currency ? null : "Spend is in the ad account's own currency.",
  };
}

export async function fetchChannelReport(
  platform: string,
  token: string,
  externalId: string,
): Promise<ChannelReport> {
  if (platform === "google_analytics") return ga4Report(token, externalId);
  if (platform === "search_console") return searchConsoleReport(token, externalId);
  if (platform === "meta_ads") return metaAdsReport(token, externalId);
  throw new Error("This platform has no report.");
}

/** Headline figures kept on the connection row, for the dashboard. */
export function reportHeadline(report: ChannelReport): Record<string, number> {
  return Object.fromEntries(report.totals.map((m) => [m.key, m.value]));
}
