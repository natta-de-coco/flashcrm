// Regressions from the live QA pass on flas.mobidigisol.com.
//
// Each test here corresponds to something a tester actually hit, so a failure
// names the customer-visible symptom rather than the implementation.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatDayUnambiguous,
  formatMomentUnambiguous,
  isoDayLocal,
  todayInTimeZone,
} from "../node_modules/.cache/flas-locale.mjs";
import { NAV_SECTIONS } from "../node_modules/.cache/flas-navigation.mjs";
import { ConnectSchema } from "../node_modules/.cache/flas-social-schema.mjs";
import {
  CONNECTOR_DEFINITIONS,
  advertisableCapabilities,
  capabilityCeiling,
  implementsAnything,
} from "../node_modules/.cache/flas-registry.mjs";

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

describe("social accounts cannot be connected by pasting a token", () => {
  // Manual token onboarding was switched off (3b529c9): channels connect
  // through Connect & setup, where the provider handles consent, scopes and
  // the choice of Page or account. The schema stays so old imports compile,
  // and must refuse every submission -- complete or not -- with a message
  // that says where to go instead.
  const complete = {
    platform: "instagram",
    label: "Client bakery IG",
    externalId: "17841400000000000",
    accessToken: "IGQVJYtest-token-value",
  };

  it("refuses a complete submission and points to Connect & setup", () => {
    const result = ConnectSchema.safeParse(complete);
    assert.equal(result.success, false);
    const message = result.error.issues.map((i) => i.message).join(" ");
    assert.match(message, /Manual social-token connections are disabled/);
    assert.match(message, /Connect & setup/);
  });

  it("refuses every platform, including TikTok with no account id", () => {
    const { externalId: _omitted, ...noId } = complete;
    for (const platform of [
      "instagram",
      "facebook",
      "youtube",
      "twitter",
      "linkedin",
      "tiktok",
      "google_business",
    ]) {
      assert.equal(ConnectSchema.safeParse({ ...noId, platform }).success, false, platform);
    }
  });

  it("still refuses a missing, empty or whitespace-only token", () => {
    const { accessToken: _omitted, ...withoutToken } = complete;
    assert.throws(() => ConnectSchema.parse(withoutToken));
    assert.throws(() => ConnectSchema.parse({ ...complete, accessToken: "" }));
    assert.throws(() => ConnectSchema.parse({ ...complete, accessToken: "   " }));
  });

  it("rejects an unknown platform", () => {
    assert.throws(() => ConnectSchema.parse({ ...complete, platform: "myspace" }));
  });
});

describe("dates that carry money or access are unambiguous", () => {
  // "10/8/2027" is 10 August to one reader and 8 October to another, and the
  // two cannot be told apart. Reported against the trial date in Settings.
  const aug10 = "2027-08-10T09:00:00Z";

  it("names the month instead of numbering it", () => {
    const out = formatDayUnambiguous(aug10);
    assert.match(out, /Aug/);
    assert.match(out, /2027/);
    assert.doesNotMatch(out, /^\d+\/\d+\/\d+$/);
  });

  it("is stable rather than following the reader's locale", () => {
    assert.equal(formatDayUnambiguous(aug10), formatDayUnambiguous(new Date(aug10)));
  });

  it("shows a placeholder rather than 'Invalid Date'", () => {
    for (const bad of [null, undefined, "", "not-a-date"]) {
      assert.equal(formatDayUnambiguous(bad), "—", `bad input rendered: ${String(bad)}`);
      assert.equal(formatMomentUnambiguous(bad), "—");
    }
  });

  it("renders a time in 24-hour form, so 3 PM is never read as 3 AM", () => {
    const out = formatMomentUnambiguous("2027-08-10T15:04:00Z");
    assert.match(out, /Aug/);
    assert.match(out, /\d{2}:\d{2}/);
  });
});

describe("a date input is filled with the viewer's calendar day", () => {
  it('returns YYYY-MM-DD, which is what <input type="date"> requires', () => {
    assert.match(isoDayLocal("2027-08-10T09:00:00Z"), /^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns an empty string for nothing, leaving the field blank", () => {
    // Not "—": that is not a valid date-input value and would be rejected.
    for (const bad of [null, undefined, "", "not-a-date"]) {
      assert.equal(isoDayLocal(bad), "");
    }
  });

  it("does not shift a midday timestamp to another day", () => {
    // Midday UTC is the same calendar day in every zone from -11 to +12, so
    // this holds wherever the test runs.
    assert.equal(isoDayLocal("2027-08-10T12:00:00Z"), "2027-08-10");
  });
});

describe("the app does not offer what it cannot do", () => {
  // These assertions are deliberately exact. They are not describing a bug --
  // they pin what Flas genuinely implements today, so that building a feature
  // (or shipping a connector that does nothing) has to update this list and
  // cannot pass unnoticed.

  it("can only publish to WordPress", () => {
    // Every social connector's `publish` is notBuilt: the scopes are requested
    // but no posting code exists for any of them. The composer filters on this,
    // so it must stay true or the composer starts offering dead targets.
    const canPublish = CONNECTOR_DEFINITIONS.filter((c) =>
      capabilityCeiling(c.platform ?? c.id).has("publish"),
    ).map((c) => c.displayName);
    assert.deepEqual(canPublish, ["WordPress"]);
  });

  it("knows exactly which connectors deliver nothing", () => {
    // A connector with no usable capability authorises, stores a token and
    // gives the customer no feature. The card now says so out loud; this keeps
    // the list honest.
    // Keyed on implementsAnything, not on advertisableCapabilities being
    // empty: the latter requires status "implemented", which WhatsApp,
    // Instagram and YouTube never reach while awaiting provider review, so it
    // would wrongly call the product's core channel dead.
    const dead = CONNECTOR_DEFINITIONS.filter((c) => !implementsAnything(c)).map(
      (c) => c.displayName,
    );
    // Google Analytics 4 left this list when its property picker and 28-day
    // traffic report were built.
    assert.deepEqual(dead.sort(), ["Google Ads", "LinkedIn Ads", "Threads"]);
  });

  it("never advertises a capability it has not implemented", () => {
    // The invariant behind both of the above: an advertised badge must be
    // backed by real code, never by a requested scope alone.
    for (const connector of CONNECTOR_DEFINITIONS) {
      for (const cap of advertisableCapabilities(connector)) {
        const facts = connector.capabilities[cap.key];
        assert.ok(
          facts.providerSupports && facts.flasImplements,
          `${connector.displayName} advertises ${cap.key} without implementing it`,
        );
      }
    }
  });

  it("WhatsApp remains the most complete channel", () => {
    // It is the product's core; a regression that quietly narrowed it would
    // otherwise be invisible until customers noticed.
    const wa = CONNECTOR_DEFINITIONS.find((c) => (c.platform ?? c.id) === "whatsapp");
    assert.ok(implementsAnything(wa), "WhatsApp implements nothing — that cannot be right");
    for (const expected of ["direct_messages_read", "direct_messages_send", "webhooks"]) {
      const facts = wa.capabilities[expected];
      assert.ok(facts.flasImplements, `WhatsApp lost ${expected}`);
    }
  });
});

describe("WordPress site connection enforces SSRF validation", () => {
  it("rejects loopback, internal private RFC1918, and cloud metadata targets", async () => {
    const { isSafeWordPressUrl } = await import("../node_modules/.cache/flas-invoices.mjs");

    // Rejects non-http(s)
    assert.equal(isSafeWordPressUrl("ftp://example.com"), false);
    assert.equal(isSafeWordPressUrl("file:///etc/passwd"), false);
    assert.equal(isSafeWordPressUrl("javascript:alert(1)"), false);

    // Rejects loopback & internal
    assert.equal(isSafeWordPressUrl("http://localhost"), false);
    assert.equal(isSafeWordPressUrl("http://localhost:8080/wp"), false);
    assert.equal(isSafeWordPressUrl("http://site.localhost"), false);
    assert.equal(isSafeWordPressUrl("http://127.0.0.1"), false);
    assert.equal(isSafeWordPressUrl("http://127.0.0.1:3000"), false);
    assert.equal(isSafeWordPressUrl("http://[::1]"), false);

    // Rejects cloud metadata
    assert.equal(isSafeWordPressUrl("http://169.254.169.254"), false);
    assert.equal(isSafeWordPressUrl("http://169.254.169.254/latest/meta-data"), false);
    assert.equal(isSafeWordPressUrl("http://metadata.google.internal"), false);

    // Rejects RFC1918 private ranges
    assert.equal(isSafeWordPressUrl("http://10.0.0.1"), false);
    assert.equal(isSafeWordPressUrl("http://172.16.0.1"), false);
    assert.equal(isSafeWordPressUrl("http://192.168.1.1"), false);

    // Allows legitimate public domains
    assert.equal(isSafeWordPressUrl("https://myblog.example.com"), true);
    assert.equal(isSafeWordPressUrl("https://wp.mobidigisol.com"), true);
    assert.equal(isSafeWordPressUrl("http://atozsecurityequipment.com"), true);
  });
});
