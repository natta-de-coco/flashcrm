// Reports for GA4, Search Console and Meta Ads, and choosing what they report on.
//
// These connectors used to connect and then do nothing. The tests pin the
// request each provider is sent -- the wrong date window or an unaggregated
// query silently produces wrong numbers -- and that figures are passed through
// as the provider reported them, not estimated.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ga4Report,
  hasReports,
  metaAdsReport,
  reportHeadline,
  searchConsoleReport,
} from "../node_modules/.cache/flas-reports.mjs";
import { listConnectionTargets } from "../node_modules/.cache/flas-connection-targets.mjs";

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const withFetch = async (route, fn) => {
  const real = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url, init) => {
    const entry = {
      url: String(url),
      auth: init?.headers?.Authorization ?? null,
      body: init?.body ? JSON.parse(init.body) : null,
    };
    asked.push(entry);
    return route(entry);
  };
  try {
    return { result: await fn(), asked };
  } finally {
    globalThis.fetch = real;
  }
};

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

describe("Google Analytics 4", () => {
  const route = () =>
    json(200, {
      metricHeaders: [
        { name: "sessions" },
        { name: "totalUsers" },
        { name: "screenPageViews" },
        { name: "keyEvents" },
      ],
      rows: [
        {
          dimensionValues: [{ value: "Organic Search" }],
          metricValues: [{ value: "120" }, { value: "90" }, { value: "300" }, { value: "4" }],
        },
      ],
      totals: [
        { metricValues: [{ value: "500" }, { value: "380" }, { value: "1400" }, { value: "12" }] },
      ],
    });

  it("reports the provider's own totals and rows", async () => {
    const { result } = await withFetch(route, () => ga4Report("tok", "properties/123"));
    const totals = Object.fromEntries(result.totals.map((m) => [m.key, m.value]));
    assert.deepEqual(totals, {
      sessions: 500,
      totalUsers: 380,
      screenPageViews: 1400,
      keyEvents: 12,
    });
    assert.equal(result.table.rows[0].label, "Organic Search");
    assert.equal(result.table.rows[0].values.sessions, 120);
  });

  it("asks for the totals row and 28 full days ending yesterday", async () => {
    const { asked } = await withFetch(route, () => ga4Report("tok", "properties/123"));
    assert.match(asked[0].url, /properties\/123:runReport$/);
    assert.equal(asked[0].auth, "Bearer tok");
    assert.deepEqual(asked[0].body.metricAggregations, ["TOTAL"]);
    assert.equal(asked[0].body.dateRanges[0].endDate, daysAgo(1));
    assert.equal(asked[0].body.dateRanges[0].startDate, daysAgo(28));
  });

  it("refuses to run without a chosen property", async () => {
    await assert.rejects(ga4Report("tok", ""), /GA4 property/);
    await assert.rejects(ga4Report("tok", "123"), /GA4 property/);
  });

  it("surfaces the provider's refusal", async () => {
    await assert.rejects(
      withFetch(
        () => json(403, { error: { message: "User does not have sufficient permissions" } }),
        () => ga4Report("tok", "properties/123"),
      ),
      /sufficient permissions/,
    );
  });
});

describe("Search Console", () => {
  const route = (req) =>
    req.body?.dimensions
      ? json(200, {
          rows: [{ keys: ["flas crm"], clicks: 40, impressions: 900, ctr: 0.044, position: 3.2 }],
        })
      : json(200, { rows: [{ clicks: 120, impressions: 5000, ctr: 0.024, position: 8.7 }] });

  it("reports totals and top queries", async () => {
    const { result } = await withFetch(route, () =>
      searchConsoleReport("tok", "sc-domain:flas.example"),
    );
    const totals = Object.fromEntries(result.totals.map((m) => [m.key, m.value]));
    assert.deepEqual(totals, { clicks: 120, impressions: 5000, ctr: 0.024, position: 8.7 });
    assert.equal(result.table.rows[0].label, "flas crm");
  });

  it("ends three days ago, because recent days are not reported yet", async () => {
    const { asked, result } = await withFetch(route, () =>
      searchConsoleReport("tok", "https://flas.example/"),
    );
    for (const call of asked) assert.equal(call.body.endDate, daysAgo(3));
    assert.match(result.note, /delay/);
  });

  it("encodes the site in the URL, so a domain property reaches the right endpoint", async () => {
    const { asked } = await withFetch(route, () =>
      searchConsoleReport("tok", "sc-domain:flas.example"),
    );
    assert.ok(asked[0].url.includes("sites/sc-domain%3Aflas.example/searchAnalytics/query"));
  });
});

describe("Meta Ads", () => {
  const route = (req) => {
    if (req.url.includes("?fields=currency")) return json(200, { currency: "AED" });
    if (req.url.includes("level=account")) {
      return json(200, {
        data: [
          {
            spend: "812.50",
            impressions: "40000",
            reach: "21000",
            clicks: "600",
            ctr: "1.5",
            cpc: "1.35",
          },
        ],
      });
    }
    return json(200, {
      data: [
        {
          campaign_name: "Ramadan offer",
          spend: "500",
          impressions: "25000",
          clicks: "400",
          ctr: "1.6",
        },
      ],
    });
  };

  it("reports spend in the account's currency and CTR as a fraction", async () => {
    const { result } = await withFetch(route, () => metaAdsReport("tok", "act_111"));
    const spend = result.totals.find((m) => m.key === "spend");
    assert.equal(spend.value, 812.5);
    assert.equal(spend.currency, "AED");
    // Meta sends 1.5 meaning 1.5%; every report stores percentages as fractions.
    assert.equal(result.totals.find((m) => m.key === "ctr").value, 0.015);
    assert.equal(result.table.rows[0].label, "Ramadan offer");
  });

  it("uses the Authorization header, never a token in the URL", async () => {
    const { asked } = await withFetch(route, () => metaAdsReport("tok", "act_111"));
    for (const call of asked) {
      assert.equal(call.auth, "Bearer tok");
      assert.doesNotMatch(call.url, /access_token=/);
    }
  });

  it("refuses to run without a chosen ad account", async () => {
    await assert.rejects(metaAdsReport("tok", "111"), /ad account/);
  });
});

describe("report plumbing", () => {
  it("only the three report connectors have reports", () => {
    assert.equal(hasReports("google_analytics"), true);
    assert.equal(hasReports("search_console"), true);
    assert.equal(hasReports("meta_ads"), true);
    assert.equal(hasReports("youtube"), false);
  });

  it("keeps the headline figures for the dashboard", () => {
    const headline = reportHeadline({
      totals: [
        { key: "clicks", label: "Clicks", value: 5, format: "number" },
        { key: "ctr", label: "CTR", value: 0.1, format: "percent" },
      ],
    });
    assert.deepEqual(headline, { clicks: 5, ctr: 0.1 });
  });
});

describe("choosing what a report connector reports on", () => {
  it("lists GA4 properties across accounts", async () => {
    const { result } = await withFetch(
      () =>
        json(200, {
          accountSummaries: [
            {
              displayName: "Acme",
              propertySummaries: [
                { property: "properties/1", displayName: "acme.ae" },
                { property: "properties/2", displayName: "shop.acme.ae" },
              ],
            },
          ],
        }),
      () => listConnectionTargets("google_analytics", "tok"),
    );
    assert.deepEqual(
      result.targets.map((t) => [t.id, t.name, t.detail]),
      [
        ["properties/1", "acme.ae", "Acme"],
        ["properties/2", "shop.acme.ae", "Acme"],
      ],
    );
  });

  it("lists verified Search Console sites and skips unverified ones", async () => {
    const { result } = await withFetch(
      () =>
        json(200, {
          siteEntry: [
            { siteUrl: "sc-domain:acme.ae", permissionLevel: "siteOwner" },
            { siteUrl: "https://old.acme.ae/", permissionLevel: "siteUnverifiedUser" },
          ],
        }),
      () => listConnectionTargets("search_console", "tok"),
    );
    assert.deepEqual(
      result.targets.map((t) => [t.id, t.name, t.detail]),
      [["sc-domain:acme.ae", "acme.ae", "Owner"]],
    );
  });

  it("lists Meta ad accounts with their currency and status", async () => {
    const { result, asked } = await withFetch(
      () =>
        json(200, {
          data: [
            { id: "act_1", name: "Acme Ads", currency: "AED", account_status: 1 },
            { id: "act_2", name: "Old Ads", currency: "USD", account_status: 2 },
          ],
        }),
      () => listConnectionTargets("meta_ads", "tok"),
    );
    assert.deepEqual(
      result.targets.map((t) => [t.id, t.detail]),
      [
        ["act_1", "AED · active"],
        ["act_2", "USD · not active"],
      ],
    );
    assert.doesNotMatch(asked[0].url, /access_token=/);
  });
});
