// Regressions from the live QA pass on flas.mobidigisol.com.
//
// Each test here corresponds to something a tester actually hit, so a failure
// names the customer-visible symptom rather than the implementation.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { todayInTimeZone } from "../node_modules/.cache/flas-locale.mjs";
import { NAV_SECTIONS } from "../node_modules/.cache/flas-navigation.mjs";
import { ConnectSchema } from "../node_modules/.cache/flas-social-schema.mjs";

describe("issue dates use the workspace timezone, not UTC", () => {
  // The reported case: 2026-09-10 01:00 in Dubai is still 2026-09-09 in UTC,
  // so a quotation raised on the 10th was issued dated the 9th.
  const justAfterDubaiMidnight = new Date("2026-09-09T20:30:00Z");

  it("returns the Dubai calendar day, not the UTC one", () => {
    const clock = Date;
    globalThis.Date = class extends clock {
      constructor(...args) {
        super(...(args.length ? args : [justAfterDubaiMidnight]));
      }
    };
    try {
      assert.equal(todayInTimeZone("Asia/Dubai"), "2026-09-10");
      assert.equal(todayInTimeZone("UTC"), "2026-09-09");
    } finally {
      globalThis.Date = clock;
    }
  });

  it("always returns an ISO calendar date", () => {
    assert.match(todayInTimeZone("Asia/Dubai"), /^\d{4}-\d{2}-\d{2}$/);
    assert.match(todayInTimeZone("America/Los_Angeles"), /^\d{4}-\d{2}-\d{2}$/);
  });

  it("falls back rather than throwing on a missing or bogus zone", () => {
    // A workspace with no timezone set must still be able to raise a document.
    assert.match(todayInTimeZone(null), /^\d{4}-\d{2}-\d{2}$/);
    assert.match(todayInTimeZone(undefined), /^\d{4}-\d{2}-\d{2}$/);
    assert.match(todayInTimeZone("Not/AZone"), /^\d{4}-\d{2}-\d{2}$/);
  });

  it("Dubai is never behind UTC", () => {
    // Guards against a sign error in any future rewrite of the helper.
    assert.ok(todayInTimeZone("Asia/Dubai") >= todayInTimeZone("UTC"));
  });
});

describe("global search can reach every page in the sidebar", () => {
  const items = NAV_SECTIONS.flatMap((s) => s.items);

  /** The string cmdk matches against, mirroring CommandPalette's `value`. */
  const haystack = (item) => `${item.label} ${item.desc} ${item.keywords ?? ""}`.toLowerCase();
  const search = (term) => items.filter((i) => haystack(i).includes(term.toLowerCase()));

  it("indexes Quotes & Invoices at all", () => {
    // It was reachable from the sidebar but absent from the palette's own copy
    // of the nav, so searching "invoice" returned an unrelated page.
    assert.ok(items.some((i) => i.to === "/sales"));
  });

  it("finds the sales page for the words a customer actually types", () => {
    for (const term of ["invoice", "quote", "quotation", "bill", "receipt", "vat", "payment"]) {
      const hits = search(term);
      assert.ok(
        hits.some((h) => h.to === "/sales"),
        `"${term}" should reach /sales, got: ${hits.map((h) => h.to).join(", ") || "nothing"}`,
      );
    }
  });

  it("routes other common terms to the right page", () => {
    const expected = {
      product: "/catalog",
      integration: "/connect",
      whatsapp: "/connect",
      seo: "/seo-blog",
      chatbot: "/chatbot",
      campaign: "/campaign-planner",
    };
    for (const [term, to] of Object.entries(expected)) {
      const hits = search(term);
      assert.ok(
        hits.some((h) => h.to === to),
        `"${term}" should reach ${to}, got: ${hits.map((h) => h.to).join(", ") || "nothing"}`,
      );
    }
  });

  it("indexes the pages that were missing entirely", () => {
    for (const to of ["/sales", "/chatbot", "/campaign-planner", "/connect"]) {
      assert.ok(
        items.some((i) => i.to === to),
        `${to} is missing from the navigation index`,
      );
    }
  });

  it("every nav item is searchable and routable", () => {
    for (const item of items) {
      assert.ok(item.to?.startsWith("/"), `bad route: ${JSON.stringify(item)}`);
      assert.ok(item.label?.trim(), `missing label for ${item.to}`);
      assert.ok(item.desc?.trim(), `missing description for ${item.to}`);
    }
  });

  it("has no duplicate routes, which would double every search hit", () => {
    const routes = items.map((i) => i.to);
    assert.equal(new Set(routes).size, routes.length);
  });
});

describe("the manual social-connect endpoint refuses a credential-less account", () => {
  const valid = {
    platform: "instagram",
    label: "Client bakery IG",
    externalId: "17841400000000000",
    accessToken: "IGQVJYtest-token-value",
  };

  it("accepts a complete submission", () => {
    assert.equal(ConnectSchema.parse(valid).accessToken, valid.accessToken);
  });

  it("rejects a missing access token", () => {
    // The form fix alone did not close this: the endpoint is callable directly.
    const { accessToken: _omitted, ...withoutToken } = valid;
    assert.throws(() => ConnectSchema.parse(withoutToken));
  });

  it("rejects an empty access token", () => {
    // `.optional()` with no minimum let "" through, storing an account that
    // looked connected and failed on first sync.
    assert.throws(() => ConnectSchema.parse({ ...valid, accessToken: "" }));
  });

  it("rejects a whitespace-only access token", () => {
    assert.throws(() => ConnectSchema.parse({ ...valid, accessToken: "   " }));
  });

  it("trims a surrounding-whitespace token rather than storing it padded", () => {
    // Pasted credentials routinely carry a trailing newline.
    const parsed = ConnectSchema.parse({ ...valid, accessToken: "  tok-en  " });
    assert.equal(parsed.accessToken, "tok-en");
  });

  it("still allows TikTok to omit the account id", () => {
    // TikTok resolves the account from the token; requiring an id would break it.
    const { externalId: _omitted, ...noId } = valid;
    assert.doesNotThrow(() => ConnectSchema.parse({ ...noId, platform: "tiktok" }));
  });

  it("rejects an unknown platform", () => {
    assert.throws(() => ConnectSchema.parse({ ...valid, platform: "myspace" }));
  });
});
