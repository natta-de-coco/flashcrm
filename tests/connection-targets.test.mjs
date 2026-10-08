// Choosing a LinkedIn Company Page or a Business Profile location.
//
// A login often manages several. Discovery used to keep a channel only when
// there was exactly one, and saved the connection with no channel otherwise --
// after which sync could never run. These pin what discovery returns, and that
// a chosen id is accepted only if the provider listed it for this login.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  hasTargetDiscovery,
  listConnectionTargets,
  noTargetReason,
  pickTarget,
  targetProfile,
} from "../node_modules/.cache/flas-connection-targets.mjs";

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Runs fn with fetch answered by route(url); returns what fn returned and the URLs asked. */
const withFetch = async (route, fn) => {
  const real = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url, init) => {
    asked.push({ url: String(url), headers: init?.headers ?? {} });
    return route(String(url));
  };
  try {
    return { result: await fn(), asked };
  } finally {
    globalThis.fetch = real;
  }
};

describe("LinkedIn: the Company Pages a member administers", () => {
  const route = (url) => {
    if (url.includes("/rest/organizationAcls")) {
      return json(200, {
        elements: [
          { organization: "urn:li:organization:111", role: "ADMINISTRATOR", state: "APPROVED" },
          { organization: "urn:li:organization:222", role: "ADMINISTRATOR", state: "APPROVED" },
          // The same Page listed twice must not appear twice in the picker.
          { organization: "urn:li:organization:111", role: "ADMINISTRATOR", state: "APPROVED" },
        ],
      });
    }
    if (url.endsWith("/rest/organizations/111")) {
      return json(200, { localizedName: "Acme Trading", vanityName: "acme-trading" });
    }
    if (url.endsWith("/rest/organizations/222")) return json(403, {});
    return json(404, {});
  };

  it("lists every Page, named, once each", async () => {
    const { result } = await withFetch(route, () => listConnectionTargets("linkedin", "tok"));
    assert.equal(result.ok, true);
    assert.deepEqual(
      result.targets.map((t) => t.id),
      ["111", "222"],
    );
    assert.equal(result.targets[0].name, "Acme Trading");
    assert.equal(result.targets[0].profileUrl, "https://www.linkedin.com/company/acme-trading/");
  });

  it("still offers a Page whose name could not be read, honestly labelled", async () => {
    const { result } = await withFetch(route, () => listConnectionTargets("linkedin", "tok"));
    assert.equal(result.targets[1].name, "Company Page 222");
  });

  it("sends the current LinkedIn API version on every request", async () => {
    const { asked } = await withFetch(route, () => listConnectionTargets("linkedin", "tok"));
    for (const call of asked) assert.equal(call.headers["LinkedIn-Version"], "202608");
  });

  it("explains a refusal instead of returning an empty list", async () => {
    const { result } = await withFetch(
      () => json(403, { message: "Not enough permissions" }),
      () => listConnectionTargets("linkedin", "tok"),
    );
    assert.equal(result.ok, false);
    assert.match(result.reason, /HTTP 403/);
  });
});

describe("Business Profile: the locations a Google account manages", () => {
  const route = (url) => {
    if (url.includes("mybusinessaccountmanagement")) {
      return json(200, {
        accounts: [{ name: "accounts/1", accountName: "Acme Group" }, { name: "accounts/2" }],
      });
    }
    if (url.includes("/accounts/1/locations")) {
      return json(200, {
        locations: [
          {
            name: "locations/10",
            title: "Acme Deira",
            storefrontAddress: { addressLines: ["Deira"] },
          },
          { name: "locations/11", title: "Acme Marina" },
        ],
      });
    }
    if (url.includes("/accounts/2/locations")) {
      return json(200, { locations: [{ name: "locations/20", title: "Acme Sharjah" }] });
    }
    return json(404, {});
  };

  it("lists every location across accounts, with the path reviews are read from", async () => {
    const { result } = await withFetch(route, () =>
      listConnectionTargets("google_business", "tok"),
    );
    assert.equal(result.ok, true);
    assert.deepEqual(
      result.targets.map((t) => t.id),
      ["accounts/1/locations/10", "accounts/1/locations/11", "accounts/2/locations/20"],
    );
    assert.equal(result.targets[0].detail, "Deira");
    assert.equal(result.targets[1].detail, "Acme Group");
  });

  it("says Google must approve API access when it answers with no quota", async () => {
    const { result } = await withFetch(
      () => json(429, {}),
      () => listConnectionTargets("google_business", "tok"),
    );
    assert.equal(result.ok, false);
    assert.match(result.reason, /Google has not yet approved Business Profile API access/);
    assert.match(result.diagnostic, /HTTP 429/);
  });

  it("separates Google's technical refusal from the customer action", async () => {
    const { result } = await withFetch(
      () => json(403, {}),
      () => listConnectionTargets("google_business", "tok"),
    );
    assert.equal(result.ok, false);
    assert.match(result.reason, /enable both Business Profile APIs/);
    assert.match(result.diagnostic, /HTTP 403/);
  });
});

describe("a chosen account is accepted only if the login manages it", () => {
  const listed = [
    { id: "111", name: "Acme Trading", detail: null, profileUrl: null },
    { id: "222", name: "Acme Retail", detail: null, profileUrl: null },
  ];

  it("accepts an id the provider listed", () => {
    assert.equal(pickTarget(listed, "222")?.name, "Acme Retail");
  });

  it("rejects an id it did not list, however it was obtained", () => {
    assert.equal(pickTarget(listed, "999"), null);
  });

  it("stores the id, name and link of the chosen account", () => {
    assert.deepEqual(targetProfile({ ...listed[0], profileUrl: "https://x" }), {
      external_id: "111",
      name: "Acme Trading",
      profile_url: "https://x",
    });
  });
});

describe("which platforms use the picker", () => {
  it("LinkedIn and Business Profile do; others do not", () => {
    assert.equal(hasTargetDiscovery("linkedin"), true);
    assert.equal(hasTargetDiscovery("google_business"), true);
    assert.equal(hasTargetDiscovery("youtube"), true);
    assert.equal(hasTargetDiscovery("facebook"), false);
  });

  it("a login that manages nothing gets a reason, not a blank connection", () => {
    assert.match(noTargetReason("linkedin"), /administrator/);
    assert.match(noTargetReason("google_business"), /location/);
  });
});

describe("complete asset discovery", () => {
  it("offers every YouTube channel returned by this grant, including later pages", async () => {
    const { result, asked } = await withFetch(
      (url) =>
        url.includes("pageToken=next")
          ? json(200, { items: [{ id: "second", snippet: { title: "Second" } }] })
          : json(200, {
              items: [{ id: "first", snippet: { title: "First" } }],
              nextPageToken: "next",
            }),
      () => listConnectionTargets("youtube", "private-test-token"),
    );
    assert.deepEqual(
      result.targets.map((t) => t.id),
      ["first", "second"],
    );
    assert.ok(
      asked.every(
        (c) =>
          c.headers.Authorization === "Bearer private-test-token" &&
          !c.url.includes("private-test-token"),
      ),
    );
  });
  it("a failed later page refuses selection instead of returning an incomplete list", async () => {
    const { result } = await withFetch(
      (url) =>
        url.includes("pageToken=next")
          ? json(403, {})
          : json(200, { items: [{ id: "first" }], nextPageToken: "next" }),
      () => listConnectionTargets("youtube", "token"),
    );
    assert.equal(result.ok, false);
    assert.deepEqual(result.targets, []);
  });
  it("refuses repeated pagination cursors instead of looping indefinitely", async () => {
    const { result, asked } = await withFetch(
      () => json(200, { items: [], nextPageToken: "same" }),
      () => listConnectionTargets("youtube", "token"),
    );
    assert.equal(result.ok, false);
    assert.equal(asked.length, 2);
  });
  it("uses the original Meta endpoint for later pages, never an untrusted next URL", async () => {
    const { result, asked } = await withFetch(
      (url) =>
        url.includes("after=cursor")
          ? json(200, { data: [{ id: "act_2" }] })
          : json(200, {
              data: [{ id: "act_1" }],
              paging: { next: "https://attacker.example/steal", cursors: { after: "cursor" } },
            }),
      () => listConnectionTargets("meta_ads", "token"),
    );
    assert.equal(result.targets.length, 2);
    assert.ok(asked.every((c) => new URL(c.url).hostname === "graph.facebook.com"));
  });
  it("a Business Profile location refusal does not masquerade as no locations", async () => {
    const { result } = await withFetch(
      (url) =>
        url.includes("accountmanagement")
          ? json(200, { accounts: [{ name: "accounts/1" }] })
          : json(403, {}),
      () => listConnectionTargets("google_business", "token"),
    );
    assert.equal(result.ok, false);
    assert.deepEqual(result.targets, []);
  });
});

describe("YouTube: account discovery and error diagnosis", () => {
  it("omits bare and encoded secrets and private URLs rather than guessing their format", async () => {
    const sensitive =
      "ya29.unlabelled-token private@example.test https://private.test/?code%3Dsecret";
    const { result } = await withFetch(
      () =>
        json(403, {
          error: {
            code: sensitive,
            message: sensitive,
            errors: [{ reason: sensitive, domain: sensitive }],
          },
        }),
      () => listConnectionTargets("youtube", "token"),
    );
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result), /ya29|private@example|private.test|code%3Dsecret/);
    assert.match(result.diagnostic, /reason=unknown/);
  });

  it("uses structured Google ErrorInfo even when it is not the first detail", async () => {
    const { result } = await withFetch(
      () => json(403, { error: { details: [{ metadata: {} }, { reason: "SERVICE_DISABLED" }] } }),
      () => listConnectionTargets("youtube", "token"),
    );
    assert.match(result.reason, /not enabled/);
    assert.match(result.diagnostic, /SERVICE_DISABLED/);
  });

  it("keeps the real 429 status in quota diagnostics", async () => {
    const { result } = await withFetch(
      () => json(429, { error: { errors: [{ reason: "rateLimitExceeded" }] } }),
      () => listConnectionTargets("youtube", "token"),
    );
    assert.match(result.diagnostic, /HTTP 429/);
    assert.doesNotMatch(result.diagnostic, /HTTP 403/);
  });

  it("handles a non-JSON refusal without exposing the provider response", async () => {
    const { result } = await withFetch(
      () => new Response("<html>private-token</html>", { status: 403 }),
      () => listConnectionTargets("youtube", "token"),
    );
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result), /private-token|html/);
  });
  it("diagnoses YouTube Data API v3 disabled in Google Cloud Console (accessNotConfigured)", async () => {
    const { result } = await withFetch(
      () =>
        json(403, {
          error: {
            code: 403,
            message:
              "YouTube Data API v3 has not been used in project 123456 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/youtube.googleapis.com/overview?project=123456 then retry.",
            errors: [
              {
                message: "YouTube Data API v3 has not been used in project 123456 before...",
                domain: "usageLimits",
                reason: "accessNotConfigured",
              },
            ],
            status: "PERMISSION_DENIED",
          },
        }),
      () => listConnectionTargets("youtube", "token-abc-123"),
    );
    assert.equal(result.ok, false);
    assert.deepEqual(result.targets, []);
    assert.match(result.reason, /YouTube Data API v3 is not enabled in the Google Cloud project/);
    assert.match(result.diagnostic, /accessNotConfigured/);
    assert.match(result.diagnostic, /HTTP 403/);
    // Credential safety: no token in reason or diagnostic
    assert.equal(result.reason.includes("token-abc-123"), false);
    assert.equal(result.diagnostic.includes("token-abc-123"), false);
  });

  it("diagnoses quota exhaustion (quotaExceeded)", async () => {
    const { result } = await withFetch(
      () =>
        json(403, {
          error: {
            code: 403,
            message: "The request cannot be completed because you have exceeded your quota.",
            errors: [
              {
                message: "The request cannot be completed because you have exceeded your quota.",
                domain: "youtube.quota",
                reason: "quotaExceeded",
              },
            ],
          },
        }),
      () => listConnectionTargets("youtube", "token"),
    );
    assert.equal(result.ok, false);
    assert.deepEqual(result.targets, []);
    assert.match(result.reason, /YouTube API quota has been exceeded/);
    assert.match(result.diagnostic, /quotaExceeded/);
  });

  it("diagnoses insufficient permissions when scope was declined", async () => {
    const { result } = await withFetch(
      () =>
        json(403, {
          error: {
            code: 403,
            message: "The caller does not have permission",
            errors: [
              {
                message: "The caller does not have permission",
                domain: "global",
                reason: "insufficientPermissions",
              },
            ],
            status: "PERMISSION_DENIED",
          },
        }),
      () => listConnectionTargets("youtube", "token"),
    );
    assert.equal(result.ok, false);
    assert.deepEqual(result.targets, []);
    assert.match(result.reason, /did not grant channel access permissions/);
    assert.match(result.diagnostic, /insufficientPermissions/);
  });

  it("diagnoses YouTube signup required / no channel attached", async () => {
    const { result } = await withFetch(
      () =>
        json(403, {
          error: {
            code: 403,
            message: "The user has not completed the YouTube sign-up process.",
            errors: [
              {
                message: "The user has not completed the YouTube sign-up process.",
                domain: "youtube.header",
                reason: "youtubeSignupRequired",
              },
            ],
          },
        }),
      () => listConnectionTargets("youtube", "token"),
    );
    assert.equal(result.ok, false);
    assert.deepEqual(result.targets, []);
    assert.match(result.reason, /No active YouTube channel was found/);
    assert.match(result.diagnostic, /youtubeSignupRequired/);
  });

  it("handles generic 403 refusal with actionable recovery guidance", async () => {
    const { result } = await withFetch(
      () => json(403, { error: { code: 403, message: "Forbidden" } }),
      () => listConnectionTargets("youtube", "token"),
    );
    assert.equal(result.ok, false);
    assert.deepEqual(result.targets, []);
    assert.match(result.reason, /refused access to your YouTube channels/);
    assert.match(result.diagnostic, /HTTP 403/);
  });

  it("provides helpful recovery guidance when user has zero channels on login (empty items)", async () => {
    const { result } = await withFetch(
      () => json(200, { items: [] }),
      () => listConnectionTargets("youtube", "token"),
    );
    assert.equal(result.ok, true);
    assert.deepEqual(result.targets, []);
    const reason = noTargetReason("youtube");
    assert.match(reason, /Brand Account/);
    assert.match(reason, /No YouTube channel was returned/);
  });

  it("discovers active channels with custom vanity handles and links", async () => {
    const { result } = await withFetch(
      () =>
        json(200, {
          items: [
            {
              id: "UC_channel_123",
              snippet: { title: "Acme Corp TV", customUrl: "@acmecorp" },
            },
          ],
        }),
      () => listConnectionTargets("youtube", "token"),
    );
    assert.equal(result.ok, true);
    assert.equal(result.targets.length, 1);
    assert.equal(result.targets[0].id, "UC_channel_123");
    assert.equal(result.targets[0].name, "Acme Corp TV");
    assert.equal(result.targets[0].detail, "@acmecorp");
    assert.equal(result.targets[0].profileUrl, "https://www.youtube.com/channel/UC_channel_123");
  });

  it("scrubs any token material from error diagnostics", async () => {
    const { result } = await withFetch(
      () =>
        json(403, {
          error: {
            code: 403,
            message:
              "Failed request with access_token=secret_tok_99999 and client_secret=very_secret",
            errors: [{ reason: "accessNotConfigured" }],
          },
        }),
      () => listConnectionTargets("youtube", "token"),
    );
    assert.equal(result.ok, false);
    assert.equal(result.diagnostic.includes("secret_tok_99999"), false);
    assert.equal(result.diagnostic.includes("very_secret"), false);
    assert.match(result.diagnostic, /accessNotConfigured/);
    assert.ok(!result.diagnostic.includes("Failed request"));
  });
});
