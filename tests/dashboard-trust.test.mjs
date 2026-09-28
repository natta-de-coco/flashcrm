// A dashboard that disagrees with itself, and machine text shown to customers.
// QA 26 Sep 2026: H11, M7 and §5.
//
//   npm run test:audit-punchlist
//
// MUTATION=count_both_directions counts outbound social replies as waiting for
// a reply again — the Inbox badge filters `direction = 'in'`, so the suite MUST
// fail: that is the 27-against-22 defect.
// MUTATION=guess_cause makes the mapper invent a cause for text it does not
// recognise. The suite MUST fail: saying "check your connection" when we do not
// know sends people to fix something that is not broken.
//
// The last block reads the routed sources, so removing one of these fixes fails
// the suite even where the defect needs a database to reproduce.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

mkdirSync("node_modules/.cache", { recursive: true });
const bundle = (name) => {
  buildSync({
    entryPoints: [`src/lib/${name}.ts`],
    outfile: `node_modules/.cache/flas-${name}.mjs`,
    format: "esm",
    platform: "node",
    bundle: true,
    logLevel: "error",
  });
  return import(`../node_modules/.cache/flas-${name}.mjs`);
};

const figures = await bundle("dashboard-figures");
const counts = await bundle("integration-counts");
const errors = await bundle("plain-error");

const MUTATION = process.env.MUTATION ?? "";
if (MUTATION) console.log(`!! MUTATION: ${MUTATION} — the suite must FAIL`);

/* ------------------------------------------------------------------ */
/* M7 — the numbers agree, or say why they cannot                      */
/* ------------------------------------------------------------------ */

describe("business health score (M7: brief said 62, card said 60)", () => {
  test("is the plain mean of the factor scores, with no hidden weights", () => {
    const { score, grade } = figures.summariseHealth([
      { score: 100 },
      { score: 50 },
      { score: 50 },
      { score: 50 },
      { score: 50 },
    ]);
    assert.equal(score, 60);
    assert.equal(grade, "Needs work");
  });

  test("the same factors always produce the same score", () => {
    const factors = [{ score: 71 }, { score: 12 }, { score: 100 }, { score: 4 }, { score: 63 }];
    assert.equal(figures.summariseHealth(factors).score, figures.summariseHealth(factors).score);
    assert.equal(figures.summariseHealth(factors).score, 50);
  });

  test("grade boundaries", () => {
    assert.equal(figures.healthGrade(85), "Excellent");
    assert.equal(figures.healthGrade(84), "Good");
    assert.equal(figures.healthGrade(70), "Good");
    assert.equal(figures.healthGrade(69), "Needs work");
    assert.equal(figures.healthGrade(50), "Needs work");
    assert.equal(figures.healthGrade(49), "At risk");
  });

  test("no factors is 0, not a division by zero", () => {
    assert.equal(figures.summariseHealth([]).score, 0);
  });

  test("the method is stated to the reader, and says the weights are equal", () => {
    assert.match(figures.HEALTH_METHOD_NOTE, /equally/i);
    assert.match(figures.HEALTH_METHOD_NOTE, /every refresh|recalculated/i);
  });
});

describe("social interactions waiting for a reply (M7: 27 against an Inbox badge of 22)", () => {
  // The dashboard counted every open interaction; sending a reply inserts an
  // outbound row that also defaults to status 'open'. Five replies sent is
  // exactly the 27-vs-22 gap QA saw.
  const inboundOpen = [
    { account_id: "a", direction: "in", status: "open" },
    { account_id: "a", direction: "in", status: "open" },
    { account_id: "b", direction: "in", status: "open" },
  ];
  const outboundOpen = [
    { account_id: "a", direction: "out", status: "open" },
    { account_id: "b", direction: "out", status: "open" },
  ];

  /** What the Inbox badge asks the database for (inbox.tsx). */
  const inboxBadgeCount = (rows) =>
    rows.filter((r) => r.direction === "in" && r.status === "open").length;

  /** What the dashboard's sample query now returns. */
  const dashboardSample = (rows) =>
    MUTATION === "count_both_directions"
      ? rows.filter((r) => r.status === "open")
      : rows.filter((r) => r.direction === "in" && r.status === "open");

  test("the dashboard total is the Inbox badge's own number", () => {
    const rows = [...inboundOpen, ...outboundOpen];
    const sample = dashboardSample(rows);
    const sampledByAccount = new Map();
    for (const row of sample) {
      sampledByAccount.set(row.account_id, (sampledByAccount.get(row.account_id) ?? 0) + 1);
    }
    const pending = figures.reconcileSocialPending({
      exactTotal: sample.length,
      sampledByAccount,
    });
    assert.equal(pending.total, inboxBadgeCount(rows));
    assert.equal(pending.total, 3);
  });

  test("the per-account badges add up to the total", () => {
    const pending = figures.reconcileSocialPending({
      exactTotal: 3,
      sampledByAccount: new Map([
        ["a", 2],
        ["b", 1],
      ]),
    });
    assert.equal(pending.counted, pending.total);
    assert.equal(pending.partial, false);
    assert.equal(figures.pendingBreakdownNote(pending), null);
  });

  test("a capped sample is declared, not quietly short of the total", () => {
    const pending = figures.reconcileSocialPending({
      exactTotal: 640,
      sampledByAccount: new Map([["a", 500]]),
    });
    assert.equal(pending.partial, true);
    const note = figures.pendingBreakdownNote(pending);
    assert.match(note, /500/);
    assert.match(note, /640/);
  });
});

describe("the AI brief is a snapshot, not a live figure (M7)", () => {
  test("a cached brief older than the divergence window warns and offers Regenerate", () => {
    const note = figures.briefSnapshotNote({
      generatedAtTime: "08:14",
      cached: true,
      ageMs: figures.BRIEF_DIVERGENCE_MS,
    });
    assert.match(note, /08:14/);
    assert.match(note, /can differ|differ/i);
    assert.match(note, /Regenerate/);
  });

  test("a brief only minutes old says it is a snapshot without crying wolf", () => {
    const note = figures.briefSnapshotNote({
      generatedAtTime: "08:14",
      cached: true,
      ageMs: 60_000,
    });
    assert.match(note, /08:14/);
    assert.doesNotMatch(note, /Regenerate/);
  });

  test("a brief just written says it shares the cards' figures", () => {
    const note = figures.briefSnapshotNote({
      generatedAtTime: "08:14",
      cached: false,
      ageMs: 0,
    });
    assert.match(note, /just now/i);
  });
});

/* ------------------------------------------------------------------ */
/* M1 and M4 — what the Integrations page counts                       */
/* ------------------------------------------------------------------ */

describe("finish connecting banner (M1)", () => {
  const pendingFacebook = {
    id: "p1",
    platform: "facebook",
    active: true,
    external_id: null,
    connect_method: "oauth",
  };
  const connectedFacebook = {
    id: "c1",
    platform: "facebook",
    active: true,
    external_id: "1234",
    connect_method: "oauth",
  };
  const pendingInstagram = {
    id: "p2",
    platform: "instagram",
    active: true,
    external_id: null,
    connect_method: "oauth",
  };

  test("a platform that is already connected is not asked to finish", () => {
    const prompts = counts.pendingConnectionPrompts([pendingFacebook, connectedFacebook]);
    assert.deepEqual(
      prompts.map((p) => p.id),
      [],
    );
  });

  test("a platform with nothing chosen yet is still asked", () => {
    const prompts = counts.pendingConnectionPrompts([
      pendingFacebook,
      connectedFacebook,
      pendingInstagram,
    ]);
    assert.deepEqual(
      prompts.map((p) => p.platform),
      ["instagram"],
    );
  });

  test("manual and inactive rows never raise the banner", () => {
    const prompts = counts.pendingConnectionPrompts([
      { ...pendingInstagram, connect_method: "manual" },
      { ...pendingInstagram, id: "p3", active: false },
    ]);
    assert.deepEqual(prompts, []);
  });
});

describe("connected count (M4: WhatsApp was not counted)", () => {
  const accounts = [
    { id: "a", platform: "facebook", active: true, external_id: "1", connect_method: "oauth" },
    { id: "b", platform: "instagram", active: true, external_id: "2", connect_method: "oauth" },
    // The abandoned sign-in from M1 is not a connection.
    { id: "c", platform: "youtube", active: true, external_id: null, connect_method: "oauth" },
  ];

  test("counts social accounts plus every active WhatsApp number", () => {
    assert.equal(
      counts.connectedChannelCount({
        accounts,
        whatsappNumbers: [{ active: true }, { active: false }],
      }),
      3,
    );
  });

  test("matches what the cards below it list", () => {
    assert.equal(counts.identifiedAccounts(accounts).length, 2);
  });
});

/* ------------------------------------------------------------------ */
/* §5 and H11 — machine text never reaches the reader                  */
/* ------------------------------------------------------------------ */

describe("plain error mapper (QA §5)", () => {
  test('the ambiguous "period" column becomes a sentence about Flas, not the customer', () => {
    const plain = errors.toPlainError('column reference "period" is ambiguous', {
      action: "save this document",
    });
    assert.equal(plain.kind, "flas_fault");
    assert.match(plain.message, /could not save this document/i);
    assert.match(plain.message, /fault inside Flas|not in anything you entered/i);
    assert.doesNotMatch(plain.message, /column|ambiguous|period/i);
    // The original is kept for the log, never thrown away.
    assert.match(plain.technical, /column reference "period" is ambiguous/);
  });

  test("Meta's #100 on a missing field is reported as permanent, not a hiccup", () => {
    const plain = errors.toPlainError(
      "(#100) Tried accessing nonexisting field (analytics) on node type (WhatsAppBusinessPhoneNumber)",
    );
    assert.equal(plain.kind, "provider_unsupported");
    assert.equal(plain.retryable, false);
    assert.match(plain.message, /analytics/);
    assert.doesNotMatch(plain.message, /#100|node type/);
  });

  test("an expired token tells the reader to reconnect", () => {
    const plain = errors.toPlainError("Error validating access token: Session has expired");
    assert.equal(plain.kind, "provider_auth");
    assert.match(plain.message, /Reconnect/i);
  });

  test("a rate limit says it clears by itself and nothing was lost", () => {
    const plain = errors.toPlainError("(#4) Application request limit reached");
    assert.equal(plain.kind, "provider_rate_limit");
    assert.equal(plain.retryable, true);
  });

  test("a not-null violation names the field that was empty", () => {
    const plain = errors.toPlainError(
      'null value in column "issue_date" of relation "sales_documents" violates not-null constraint',
    );
    assert.equal(plain.kind, "missing_detail");
    assert.match(plain.message, /issue date/);
  });

  test("row-level security becomes a permission sentence, not a database term", () => {
    const plain = errors.toPlainError(
      'new row violates row-level security policy for table "sales_documents"',
    );
    assert.equal(plain.kind, "not_allowed");
    assert.doesNotMatch(plain.message, /row-level|policy/i);
  });

  test("an unrecognised failure admits it instead of inventing a cause", () => {
    const plain = errors.toPlainError("zxq-4419: unexpected condition in widget pipeline");
    assert.equal(plain.recognised, false);
    const message =
      MUTATION === "guess_cause"
        ? "We could not do that. Check your internet connection and try again."
        : plain.message;
    assert.match(message, /could not identify the cause/i);
    assert.doesNotMatch(message, /internet connection|try a different browser/i);
    // Nothing of the raw text is shown, but it is available to log.
    assert.doesNotMatch(message, /zxq-4419/);
    assert.match(plain.technical, /zxq-4419/);
  });

  test("reads a thrown Error, a string, and a supabase-shaped object", () => {
    assert.match(errors.rawErrorText(new Error("boom")), /boom/);
    assert.match(errors.rawErrorText("boom"), /boom/);
    assert.match(errors.rawErrorText({ message: "boom" }), /boom/);
    assert.match(errors.rawErrorText({ details: "boom" }), /boom/);
  });

  test("H11: the Meta analytics gap names the WABA id, not a retry", () => {
    assert.match(errors.META_ANALYTICS_UNAVAILABLE, /WhatsApp Business Account/);
    assert.match(errors.META_ANALYTICS_UNAVAILABLE, /connection itself is fine/);
    assert.doesNotMatch(errors.META_ANALYTICS_UNAVAILABLE, /try again/i);
  });
});

/* ------------------------------------------------------------------ */
/* The wiring, in the sources the app actually routes                  */
/* ------------------------------------------------------------------ */

describe("the fixes are wired into the routed screens", () => {
  test("H11: no request asks Meta for analytics on a phone-number node", async () => {
    const source = await read("src/lib/meta-health.functions.ts");
    assert.doesNotMatch(source, /fields=analytics/);
    assert.match(source, /META_ANALYTICS_UNAVAILABLE/);
    assert.match(source, /metaAnalytics: \{ available: false/);
  });

  test("H11: the dashboard states the limitation once and drops the per-number badge", async () => {
    const source = await read("src/routes/_authenticated/dashboard.tsx");
    assert.match(source, /metaAnalytics\.reason/);
    // The per-number badge and the field behind it are both gone.
    assert.doesNotMatch(source, /n\.analyticsMissing/);
    assert.doesNotMatch(source, /<AlertTriangle className="size-3" \/> analytics missing/);
  });

  test("§5: monitoring never prints the provider's own error text", async () => {
    const source = await read("src/routes/_authenticated/monitoring.tsx");
    assert.doesNotMatch(source, /\$\{n\.meta\.error\}/);
    assert.match(source, /metaUnavailableReason\(n\.meta\.error\)/);
    // The raw text still has to reach a log.
    assert.match(source, /console\.warn\(.*Meta analytics unavailable/s);
  });

  test("M7: the dashboard counts pending replies exactly as the Inbox badge does", async () => {
    const dashboard = await read("src/lib/dashboard.server.ts");
    const inbox = await read("src/routes/_authenticated/inbox.tsx");
    // Both sides: incoming only, open only.
    assert.match(inbox, /\.eq\("direction", "in"\)/);
    assert.match(inbox, /\.eq\("status", "open"\)/);
    const pendingCount =
      /social_interactions"\)\s*\.select\("id", \{ count: "exact", head: true \}\)\s*\.eq\("direction", "in"\)\s*\.eq\("status", "open"\)/;
    assert.match(dashboard, pendingCount);
    assert.match(dashboard, /reconcileSocialPending/);
    // …and the sample that feeds the per-account badges is filtered the same way.
    assert.match(
      dashboard,
      /\.select\("id, account_id, kind, status, created_at"\)\s*\.eq\("direction", "in"\)\s*\.eq\("status", "open"\)/,
    );
  });

  test("M7: one implementation of the health score, and the method is on the card", async () => {
    const dashboard = await read("src/lib/dashboard.server.ts");
    const route = await read("src/routes/_authenticated/dashboard.tsx");
    assert.match(dashboard, /summariseHealth\(factors\)/);
    assert.doesNotMatch(dashboard, /factors\.reduce\(\(sum, f\) => sum \+ f\.score/);
    assert.match(route, /HEALTH_METHOD_NOTE/);
    assert.match(route, /briefSnapshotNote\(/);
  });

  test("M1, M2, M4: the Integrations tiles", async () => {
    const source = await read("src/components/integrations-v2/IntegrationsAuditFixed.tsx");
    // M1 — the banner is derived, not a raw filter on unidentified rows.
    assert.match(source, /pendingConnectionPrompts\(allAccounts\)/);
    assert.doesNotMatch(source, /allAccounts\.filter\(\s*\(a\) => a\.active && !a\.external_id/);
    // M2 — every tile can say "not known yet" instead of zero.
    assert.match(source, /loading=\{connectionsPending\}/);
    assert.match(source, /loading=\{readinessPending\}/);
    assert.match(source, /loading \? \(\s*<Skeleton/);
    // M4 — WhatsApp numbers are part of "Connected".
    assert.match(source, /connectedChannelCount\(\{/);
    assert.match(source, /value=\{connectedTotal\}/);
    // M3 — a failed health report is stated on the page.
    assert.match(source, /healthReport\.isError/);
  });

  test("§5: the billing save path maps machine text but keeps written messages", async () => {
    const source = await read("src/lib/billing.functions.ts");
    assert.match(source, /toPlainError/);
    assert.match(source, /if \(!plain\.recognised\) throw error;/);
    assert.match(source, /console\.error\("\[billing\] saveSalesDocument failed"/);
  });
});
