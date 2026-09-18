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
