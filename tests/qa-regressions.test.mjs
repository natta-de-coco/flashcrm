// Regressions from the live QA pass on flas.mobidigisol.com.
//
// Each test here corresponds to something a tester actually hit, so a failure
// names the customer-visible symptom rather than the implementation.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { todayInTimeZone } from "../node_modules/.cache/flas-locale.mjs";
import { NAV_SECTIONS } from "../node_modules/.cache/flas-navigation.mjs";

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
