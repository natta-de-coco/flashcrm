// A site is pinned to the address it registered. The WordPress plugin and the
// popup both report their address as a full URL (`home_url()` and
// `window.location.origin`: "https://shop.example", maybe with a folder), but
// the check compared a request's host name with that value letter for letter,
// so the site's own visitors were refused: no leads, and a chat widget that
// answered every message with 403.
//
//   npm run test:public-intake   (this file is in its list; it needs the route
//   bundles that script builds)
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import { buildSync } from "esbuild";

import { createDb } from "./support/db-double.mjs";
import { Route as activateRoute } from "../node_modules/.cache/flas-plugin-activate-route.mjs";
import { Route as collectRoute } from "../node_modules/.cache/flas-leads-collect.mjs";
import { Route as widgetRoute } from "../node_modules/.cache/flas-widget-chat.mjs";
import { Route as wordpressRoute } from "../node_modules/.cache/flas-webhook-wordpress.mjs";

mkdirSync("node_modules/.cache", { recursive: true });
buildSync({
  entryPoints: ["src/lib/domain-pin.ts"],
  outfile: "node_modules/.cache/flas-domain-pin.mjs",
  format: "esm",
  platform: "node",
  bundle: true,
  logLevel: "error",
});
buildSync({
  entryPoints: ["src/lib/homepage-widget.ts"],
  outfile: "node_modules/.cache/flas-homepage-widget-pin.mjs",
  format: "esm",
  platform: "node",
  bundle: true,
  logLevel: "error",
});
const { checkDomainPin, siteHostname } = await import("../node_modules/.cache/flas-domain-pin.mjs");
const { domainCoversHost, pickHomepageSite } =
  await import("../node_modules/.cache/flas-homepage-widget-pin.mjs");

// ---- the rule itself -------------------------------------------------------

const asking = (headers) => new Request("https://flas.mobidigisol.com/api/public/x", { headers });
const fromOrigin = (stored, origin) => checkDomainPin(asking({ origin }), stored);

describe("a site that reported its full address is still recognised", () => {
  it("accepts the site's own origin when the stored address is a full URL", () => {
    // The reported bug: stored by the plugin as home_url(), compared with a host name.
    assert.equal(fromOrigin("https://shop.example", "https://shop.example"), true);
  });

  for (const stored of [
    "https://shop.example/blog", // WordPress in a sub-folder
    "http://shop.example",
    "https://shop.example:8443",
    "HTTPS://SHOP.EXAMPLE",
    "https://shop.example/",
    "  https://shop.example/blog/  ",
    "shop.example/blog", // no scheme, with a folder
    "shop.example:8080", // no scheme, with a port
    "https://shop.example./", // fully-qualified trailing dot
  ]) {
    it(`accepts the site's own origin for the stored value ${JSON.stringify(stored)}`, () => {
      assert.equal(fromOrigin(stored, "https://shop.example"), true);
    });
  }

  it("accepts a visitor on a port the site was not registered with", () => {
    assert.equal(fromOrigin("https://shop.example", "https://shop.example:8443"), true);
  });

  it("treats shop.example and www.shop.example as the same site, both ways round", () => {
    assert.equal(fromOrigin("https://www.shop.example", "https://shop.example"), true);
    assert.equal(fromOrigin("https://shop.example", "https://www.shop.example"), true);
    assert.equal(fromOrigin("www.shop.example", "https://shop.example"), true);
    assert.equal(fromOrigin("https://www.shop.example", "https://www.shop.example"), true);
  });

  it("accepts a sub-domain of a site stored as a full address", () => {
    assert.equal(fromOrigin("https://shop.example", "https://blog.shop.example"), true);
    assert.equal(fromOrigin("https://shop.example/blog", "https://shop.shop.example"), true);
  });

  it("uses the Referer when there is no Origin, for a full address", () => {
    const referer = (stored, value) => checkDomainPin(asking({ referer: value }), stored);
    assert.equal(referer("https://shop.example", "https://shop.example/pricing?plan=2"), true);
    assert.equal(
      referer("https://shop.example", "https://evil.example/?u=https://shop.example"),
      false,
    );
  });
});

describe("what already worked keeps working", () => {
  it("accepts a bare host name, a sub-domain of it, and no pin at all", () => {
    assert.equal(fromOrigin("shop.example", "https://shop.example"), true);
    assert.equal(fromOrigin("SHOP.example", "https://shop.example"), true);
    assert.equal(fromOrigin("shop.example", "https://blog.shop.example"), true);
    assert.equal(checkDomainPin(asking({}), null), true);
    assert.equal(checkDomainPin(asking({ origin: "https://anything.example" }), null), true);
    assert.equal(checkDomainPin(asking({}), ""), true);
  });

  it("uses the Referer when there is no Origin", () => {
    const referer = (stored, value) => checkDomainPin(asking({ referer: value }), stored);
    assert.equal(referer("shop.example", "https://shop.example/pricing?plan=2"), true);
    assert.equal(referer("shop.example", "https://evil.example/?u=https://shop.example"), false);
  });
});

describe("a site is still refused when the request is not from it", () => {
  for (const stored of ["https://shop.example", "https://shop.example/blog", "shop.example"]) {
    for (const origin of [
      "https://evilshop.example", // longer name that merely ends the same way
      "https://shop.example.evil.com", // the registered name used as a prefix
      "https://other.example",
      "https://xshop.example",
      "https://example",
    ]) {
      it(`refuses ${origin} for the stored value ${JSON.stringify(stored)}`, () => {
        assert.equal(fromOrigin(stored, origin), false);
      });
    }
  }

  it("refuses a request that names no origin at all", () => {
    assert.equal(checkDomainPin(asking({}), "https://shop.example"), false);
    assert.equal(checkDomainPin(asking({}), "shop.example"), false);
  });

  it("refuses an origin that cannot be read", () => {
    for (const origin of ["null", "not a url", "://", "https://"]) {
      assert.equal(fromOrigin("https://shop.example", origin), false, origin);
    }
  });

  it("refuses when the stored value cannot be read as an address", () => {
    // A pin that cannot be understood must close the door, not open it.
    for (const stored of [
      "http://",
      "??",
      "   ",
      "https://",
      "a b",
      "[::1]",
      "http://:80",
      "/blog",
    ]) {
      assert.equal(fromOrigin(stored, "https://shop.example"), false, JSON.stringify(stored));
      assert.equal(fromOrigin(stored, "https://evil.example"), false, JSON.stringify(stored));
    }
  });

  it("does not let the Referer rescue a wrong Origin", () => {
    // Origin wins when both are sent, as before.
    assert.equal(
      checkDomainPin(
        asking({ origin: "https://evil.example", referer: "https://shop.example/" }),
        "https://shop.example",
      ),
      false,
    );
  });
});

describe("siteHostname reads whatever a site reported", () => {
  const cases = [
    ["https://shop.example", "shop.example"],
    ["https://Shop.Example/Blog?x=1#top", "shop.example"],
    ["http://www.shop.example:8080/", "shop.example"],
    ["shop.example", "shop.example"],
    ["  shop.example/blog  ", "shop.example"],
    ["shop.example:8080", "shop.example"],
    ["WWW.SHOP.EXAMPLE.", "shop.example"],
    ["https://blog.shop.example", "blog.shop.example"],
    ["https://www.www.shop.example", "www.shop.example"], // only one www. is dropped
    ["https://user:pass@shop.example/", "shop.example"],
    ["localhost", "localhost"],
    ["https://münchen.example", "xn--mnchen-3ya.example"],
    ["", null],
    ["   ", null],
    [null, null],
    [undefined, null],
    ["http://", null],
    ["??", null],
    ["https://", null],
    ["a b", null],
    ["https://[::1]/", null], // an address literal is not a site name
    ["https://a_b.example", null],
    ["/blog", null], // a path, not an address
    ["//shop.example", null],
  ];
  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} -> ${JSON.stringify(expected)}`, () => {
      assert.equal(siteHostname(input), expected);
    });
  }
});

// ---- the places that use it ------------------------------------------------

const db = createDb();
const SITE_KEY = "site-key-public-0001";
const SECRET = "webhook-secret-for-tests";
const SESSION = "s".repeat(40);

globalThis.publicIntake = {
  db: db.client,
  audits: [],
  emails: [],
  emailResult: { ok: true },
};

const siteRow = (over = {}) => ({
  id: "site-1",
  tenant_id: "company-1",
  name: "Shop",
  platform: "wordpress",
  status: "active",
  active: true,
  domain: "https://shop.example",
  site_key: SITE_KEY,
  webhook_secret: SECRET,
  activation_token: "token-that-is-long-enough-000",
  admin_email: "owner@shop.example",
  ...over,
});

beforeEach(() => {
  db.reset({
    lead_sites: [siteRow()],
    organizations: [{ id: "company-1", suspended: false, subscription_status: "active" }],
    contacts: [],
    conversations: [],
    messages: [],
    leads: [],
    lead_routing_rules: [],
    contact_identities: [],
    webhook_dedup: [],
    api_keys: [],
    bot_settings: [],
    audit_log: [],
  });
  db.unique("webhook_dedup", ["event_source", "event_id"]);
  globalThis.publicIntake.audits = [];
  globalThis.publicIntake.emails = [];
});

const collect = (origin) =>
  collectRoute.options.server.handlers.POST({
    request: new Request("https://flas.mobidigisol.com/api/public/leads/collect", {
      method: "POST",
      headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
      body: JSON.stringify({ siteKey: SITE_KEY, email: "buyer@example.com", consent: true }),
    }),
  });

const chat = (origin) =>
  widgetRoute.options.server.handlers.POST({
    request: new Request("https://flas.mobidigisol.com/api/public/widget/chat", {
      method: "POST",
      headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
      body: JSON.stringify({ siteKey: SITE_KEY, sessionId: SESSION, message: "hello" }),
    }),
  });

const webhook = (origin) => {
  const rawBody = JSON.stringify({ email: "lead@shop.example", name: "Lead", consent: true });
  return wordpressRoute.options.server.handlers.POST({
    request: new Request("https://flas.mobidigisol.com/api/public/webhooks/wordpress", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-flash-site-key": SITE_KEY,
        "x-flash-signature": createHmac("sha256", SECRET).update(rawBody, "utf8").digest("hex"),
        ...(origin ? { origin } : {}),
      },
      body: rawBody,
    }),
  });
};

describe("a site already stored with its full address collects leads again", () => {
  // No data fix: rows the plugin wrote before this change are read correctly.
  it("takes a lead from the site's own pages", async () => {
    const response = await collect("https://shop.example");
    assert.equal(response.status, 200);
    assert.equal(db.table("leads").length, 1);
  });

  it("takes a lead from the www version of the site too", async () => {
    assert.equal((await collect("https://www.shop.example")).status, 200);
  });

  it("still turns away another site, and a request with no origin", async () => {
    assert.equal((await collect("https://evilshop.example")).status, 403);
    assert.equal((await collect("https://shop.example.evil.com")).status, 403);
    assert.equal((await collect(null)).status, 403);
    assert.equal(db.table("leads").length, 0);
  });

  it("refuses everything when the stored address cannot be read", async () => {
    db.table("lead_sites")[0].domain = "http://";
    assert.equal((await collect("https://shop.example")).status, 403);
    assert.equal(db.table("leads").length, 0);
  });

  it("answers the site's own chat widget instead of refusing it", async () => {
    assert.equal((await chat("https://shop.example")).status, 200);
  });

  it("still refuses the chat widget on another site", async () => {
    assert.equal((await chat("https://evilshop.example")).status, 403);
    assert.equal((await chat(null)).status, 403);
  });

  it("accepts a signed webhook sent with the site's own origin, and refuses another", async () => {
    assert.equal((await webhook("https://shop.example")).status, 200);
    assert.equal((await webhook("https://evil.example")).status, 403);
  });

  it("accepts a signed webhook with no origin (server to server) as before", async () => {
    assert.equal((await webhook(null)).status, 200);
  });
});

describe("plugin activation stores the site's name, not its address", () => {
  const activate = (body) =>
    activateRoute.options.server.handlers.POST({
      request: new Request("https://flas.mobidigisol.com/api/public/plugin/activate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ siteKey: SITE_KEY, adminEmail: "owner@shop.example", ...body }),
      }),
    });

  beforeEach(() => {
    db.table("lead_sites")[0] = siteRow({ status: "pending", domain: null });
  });

  for (const [reported, stored] of [
    ["https://shop.example/", "shop.example"],
    ["https://shop.example/blog", "shop.example"],
    ["http://Shop.Example:8080", "shop.example"],
    ["https://www.shop.example", "shop.example"],
    ["shop.example", "shop.example"],
  ]) {
    it(`stores ${JSON.stringify(stored)} when the plugin reports ${JSON.stringify(reported)}`, async () => {
      const response = await activate({ domain: reported, platform: "wordpress" });
      assert.equal(response.status, 200);
      assert.equal(db.table("lead_sites")[0].domain, stored);
    });
  }

  it("refuses an invalid supplied address before any activation side effects", async () => {
    for (const junk of ["??", "http://", "   ", "a b"]) {
      const response = await activate({ domain: junk });
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, /website address/i);
      assert.equal(db.table("lead_sites")[0].domain, null, JSON.stringify(junk));
      assert.equal(db.table("lead_sites")[0].status, "pending");
      assert.equal(globalThis.publicIntake.emails.length, 0);
      assert.equal(globalThis.publicIntake.audits.length, 0);
    }
  });

  it("keeps the address a pending site already had when the new one is junk", async () => {
    db.table("lead_sites")[0].domain = "shop.example";
    assert.equal((await activate({ domain: "??" })).status, 400);
    assert.equal(db.table("lead_sites")[0].domain, "shop.example");
  });

  it("preserves the existing domain when the caller omits it", async () => {
    db.table("lead_sites")[0].domain = "shop.example";
    assert.equal((await activate({})).status, 200);
    assert.equal(db.table("lead_sites")[0].domain, "shop.example");
  });

  it("stores an address that then passes the pin for the site's own origin", async () => {
    await activate({ domain: "https://shop.example/" });
    const stored = db.table("lead_sites")[0].domain;
    assert.equal(fromOrigin(stored, "https://shop.example"), true);
    assert.equal(fromOrigin(stored, "https://evilshop.example"), false);
  });

  it("still collects leads for the site after the plugin activates it", async () => {
    await activate({ domain: "https://shop.example/blog" });
    db.table("lead_sites")[0].status = "active";
    assert.equal((await collect("https://shop.example")).status, 200);
  });
});

describe("the chat widget on Flas's own pages follows the same rule as the endpoint", () => {
  it("covers the host for a stored full address, as the chat endpoint does", () => {
    assert.equal(domainCoversHost("https://flas.mobidigisol.com", "flas.mobidigisol.com"), true);
    assert.equal(domainCoversHost("https://www.mobidigisol.com/", "flas.mobidigisol.com"), true);
    assert.equal(domainCoversHost("https://flas.mobidigisol.com", "evil.test"), false);
    assert.equal(
      domainCoversHost("https://flas.mobidigisol.com", "flas.mobidigisol.com.evil.test"),
      false,
    );
    assert.equal(domainCoversHost("http://", "flas.mobidigisol.com"), false);
    assert.equal(domainCoversHost(null, "flas.mobidigisol.com"), false);
  });

  it("picks the owner's site whose stored address is a full URL", () => {
    const sites = [
      {
        site_key: "key-owner",
        domain: "https://flas.mobidigisol.com/",
        active: true,
        status: "active",
        tenant_id: "owner-tenant",
        created_at: "2026-09-01T00:00:00Z",
      },
    ];
    assert.equal(pickHomepageSite(sites, ["owner-tenant"], "flas.mobidigisol.com"), "key-owner");
    assert.equal(pickHomepageSite(sites, ["someone-else"], "flas.mobidigisol.com"), null);
  });
});
