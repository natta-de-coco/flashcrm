// The manager portal's subscription screens.
//
// The platform owner found managing subscriptions "very difficult". Each test
// names something that went wrong for them: pages that never opened, a date
// that moved a day after saving, and access that did not match the page.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  addMonths,
  billedBy,
  bucketOf,
  changePatch,
  companyAccess,
  daysBetween,
  describeChanges,
  describeHistory,
  draftFrom,
  extensionBase,
  formatDay,
  isDay,
  needsAttention,
  paidUntilDay,
  paidUntilText,
  paidUntilTimestamp,
  planOptions,
  validateDraft,
} from "../node_modules/.cache/flas-subscription-admin.mjs";

const NOW = new Date("2026-09-11T10:00:00Z");
const company = (over = {}) => ({
  plan: "flash_monthly",
  subscription_status: "active",
  subscription_renews_at: paidUntilTimestamp("2026-10-11"),
  suspended: false,
  paddle_subscription_id: null,
  ...over,
});

describe("every manager page opens", () => {
  it("each parent route renders an <Outlet />, so its child pages are shown", () => {
    // companies.tsx was the parent of the company page, Subscribers and
    // Errors, and settings.tsx of Email settings, without an <Outlet />:
    // clicking them changed the address and kept showing the parent page.
    const files = [];
    const walk = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith(".tsx")) files.push(p);
      }
    };
    walk("src/routes");
    const broken = files
      .filter((f) => !f.endsWith(".index.tsx"))
      .filter((f) => {
        const base = f.slice(0, -".tsx".length);
        const hasChildren = files.some((g) => g !== f && g.startsWith(`${base}.`));
        return hasChildren && !readFileSync(f, "utf8").includes("<Outlet");
      });
    assert.deepEqual(broken, []);
  });
});

describe("a paid-until date reads back as the day that was set", () => {
  it("round-trips a day through storage", () => {
    assert.equal(paidUntilDay(paidUntilTimestamp("2026-10-12")), "2026-10-12");
    assert.equal(formatDay("2026-10-12"), "12 Oct 2026");
  });

  it("does not read the stored moment in the viewer's zone, which was a day late in Dubai", () => {
    const stored = new Date(paidUntilTimestamp("2026-10-12"));
    const dubaiDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(stored);
    assert.equal(dubaiDay, "2026-10-13", "the old reading, shown here so the reason is on record");
    assert.equal(paidUntilDay(stored.toISOString()), "2026-10-12");
  });

  it("reads a Paddle period end as its own day", () => {
    assert.equal(paidUntilDay("2027-08-10T20:00:00Z"), "2027-08-10");
  });

  it("refuses days that do not exist", () => {
    assert.equal(isDay("2026-02-30"), false);
    assert.equal(isDay("2026-02-28"), true);
    assert.equal(isDay("12/10/2026"), false);
  });

  it("says how long is left in words", () => {
    assert.equal(paidUntilText(company(), NOW), "11 Oct 2026 · 30 days left");
    assert.equal(
      paidUntilText(company({ subscription_renews_at: paidUntilTimestamp("2026-09-11") }), NOW),
      "11 Sep 2026 · last day",
    );
    assert.equal(
      paidUntilText(company({ subscription_renews_at: paidUntilTimestamp("2026-09-08") }), NOW),
      "08 Sep 2026 · ended 3 days ago",
    );
    assert.equal(paidUntilText(company({ subscription_renews_at: null }), NOW), "not set");
    assert.equal(daysBetween("2026-09-11", "2026-10-11"), 30);
  });
});

describe("recording a payment", () => {
  it("adds calendar months, keeping month ends valid", () => {
    assert.equal(addMonths("2026-10-12", 1), "2026-11-12");
    assert.equal(addMonths("2026-10-12", 12), "2027-10-12");
    assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
    assert.equal(addMonths("2028-01-31", 1), "2028-02-29");
    assert.equal(addMonths("2026-11-30", 3), "2027-02-28");
  });

  it("counts from the current date while it is ahead, otherwise from today", () => {
    assert.equal(extensionBase("2026-10-11", "2026-09-11"), "2026-10-11");
    assert.equal(extensionBase("2026-09-01", "2026-09-11"), "2026-09-11");
    assert.equal(extensionBase(null, "2026-09-11"), "2026-09-11");
  });
});

describe("the access the page shows is the access the database enforces", () => {
  it("mirrors the latest access_state() definition", () => {
    const dir = "supabase/migrations";
    const defining = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .filter((f) =>
        readFileSync(path.join(dir, f), "utf8").includes("FUNCTION public.access_state"),
      );
    const latest = readFileSync(path.join(dir, defining.at(-1)), "utf8");
    assert.ok(
      latest.includes("NOT IN ('active', 'trialing', 'trial')"),
      "access_state changed: update companyAccess() in subscription-admin.ts to match",
    );
  });

  const past = paidUntilTimestamp("2026-09-01");
  const cases = [
    ["suspended", { suspended: true }, false],
    ["paid, date passed", { subscription_renews_at: past }, true],
    ["trial, date passed", { subscription_status: "trial", subscription_renews_at: past }, true],
    [
      "payment issue, date passed",
      { subscription_status: "past_due", subscription_renews_at: past },
      false,
    ],
    [
      "canceled, date passed",
      { subscription_status: "canceled", subscription_renews_at: past },
      false,
    ],
    ["payment issue, date ahead", { subscription_status: "past_due" }, true],
    ["canceled, date ahead", { subscription_status: "canceled" }, true],
  ];
  for (const [name, over, allowed] of cases) {
    it(`${name}: ${allowed ? "has" : "no"} access`, () => {
      assert.equal(companyAccess(company(over), NOW).allowed, allowed);
    });
  }
});

describe("which companies need attention", () => {
  const cases = [
    ["30 days left", {}, "paid", false],
    ["5 days left", { subscription_renews_at: paidUntilTimestamp("2026-09-16") }, "expiring", true],
    ["date passed", { subscription_renews_at: paidUntilTimestamp("2026-09-01") }, "expired", true],
    ["payment issue", { subscription_status: "past_due" }, "past_due", true],
    ["paid with no date", { subscription_renews_at: null }, "no_date", true],
    [
      "trial with no date",
      { subscription_status: "trial", subscription_renews_at: null },
      "trial",
      false,
    ],
    ["suspended", { suspended: true }, "suspended", false],
  ];
  for (const [name, over, bucket, attention] of cases) {
    it(`${name} → ${bucket}`, () => {
      const b = bucketOf(company(over), NOW);
      assert.equal(b, bucket);
      assert.equal(needsAttention(b), attention);
    });
  }
});

describe("a save says what it will do before it is sent", () => {
  it("recording a year for a lapsed payment-issue company restores access", () => {
    const before = company({
      subscription_status: "past_due",
      subscription_renews_at: paidUntilTimestamp("2026-09-01"),
    });
    const changes = describeChanges(
      before,
      { plan: "flash_monthly", status: "active", paidUntil: "2027-09-11" },
      NOW,
    );
    assert.deepEqual(changes, [
      "Status: Payment issue → Paid",
      "Paid until: 01 Sep 2026 → 11 Sep 2027",
      "Access: this company gets access back now.",
    ]);
  });

  it("marking a lapsed paid company as a payment issue warns that access stops", () => {
    const before = company({ subscription_renews_at: paidUntilTimestamp("2026-09-01") });
    const changes = describeChanges(
      before,
      { plan: "flash_monthly", status: "past_due", paidUntil: "2026-09-01" },
      NOW,
    );
    assert.ok(changes.includes("Access: everyone at this company loses access now."));
  });

  it("opening the form changes nothing", () => {
    for (const c of [
      company(),
      company({ plan: null }),
      company({ subscription_status: "trialing" }),
      company({ subscription_renews_at: null }),
    ]) {
      assert.deepEqual(changePatch(c, draftFrom(c)), {});
      assert.deepEqual(describeChanges(c, draftFrom(c), NOW), []);
    }
  });

  it("sends only what changed", () => {
    const c = company();
    assert.deepEqual(changePatch(c, { ...draftFrom(c), plan: "flash_yearly" }), {
      plan: "flash_yearly",
    });
  });

  it("will not mark a company Paid without a date", () => {
    assert.equal(
      validateDraft({ plan: "flash_monthly", status: "active", paidUntil: null }),
      "Set the date this company has paid until.",
    );
    assert.equal(validateDraft({ plan: "flash_monthly", status: "trial", paidUntil: null }), null);
  });
});

describe("history reads in words", () => {
  it("Paddle updates", () => {
    assert.equal(
      describeHistory("billing.subscription_sync", {
        status: "active",
        periodEnd: "2027-08-10T20:00:00Z",
      }),
      "Paddle: Paid, paid until 10 Aug 2027",
    );
  });

  it("changes made in the new form", () => {
    assert.equal(
      describeHistory("company.subscription_update", {
        changes: ["Status: Free trial → Paid", "Paid until: not set → 11 Oct 2026"],
      }),
      "Status: Free trial → Paid · Paid until: not set → 11 Oct 2026",
    );
  });

  it("records written by the old page", () => {
    assert.equal(
      describeHistory("company.subscription_update", {
        subscription_status: "active",
        subscription_renews_at: "2026-10-12T23:59:59.000Z",
      }),
      "Status set to Paid · Paid until 12 Oct 2026",
    );
    assert.equal(describeHistory("company.subscription_update", { suspended: true }), "Suspended");
  });
});

describe("plans and billing", () => {
  it("offers the two plans sold, plus the one a company is on", () => {
    assert.deepEqual(
      planOptions("flash_monthly_20").map((o) => o.label),
      ["Monthly (launch price)", "Monthly", "Yearly"],
    );
    assert.equal(planOptions("flash_yearly").length, 2);
  });

  it("tells card payers from manual payers", () => {
    assert.equal(billedBy({ paddle_subscription_id: "sub_01" }), "paddle");
    assert.equal(billedBy({ paddle_subscription_id: null }), "manual");
  });
});
