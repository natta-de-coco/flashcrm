// What "Connected" requires, and how a check's answer becomes a state. Pure functions only: the
// handlers, the database and the network are in tests/integration-health.test.mjs.
//
//   npm run test:connection-state
//
// Issue #77, item 2. Before this, the Connect accounts screen could never show Connected (the
// server never sent it the proof it reads), the report gave a different answer for the same
// account, and a check that was skipped, refused or never saved still ended green.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  connectionStatus,
  statusInputFromRow,
} from "../node_modules/.cache/flas-connection-status.mjs";
import {
  classifyHealthObservation,
  isLegalTransition,
  missingScopesFor,
  notProvenFor,
  requiredScopesFor,
  scopesUnknown,
} from "../node_modules/.cache/flas-connection-state.mjs";
import {
  healthReportCsv,
  isVerifiedOutcome,
  needsAttention,
  summariseOutcomes,
} from "../node_modules/.cache/flas-health-model.mjs";

const HOUR = 3600_000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();

/** An account that has everything: identified, scopes known and complete, verified, synced. */
const good = (over = {}) => ({
  platform: "facebook",
  active: true,
  token_expires_at: null,
  last_synced_at: ago(HOUR),
  granted_scopes: requiredScopesFor("facebook"),
  external_id: "1000",
  connect_method: "oauth",
  connection_state: "connected",
  last_validation_success_at: ago(2 * HOUR),
  last_validation_attempt_at: ago(2 * HOUR),
  evidence: "ok",
  ...over,
});

describe("Connected needs a real, saved check", () => {
  test("an account with everything is Connected, and says what the check cannot prove", () => {
    const s = connectionStatus(good());
    assert.equal(s.state, "connected");
    assert.equal(s.code, "connected");
    assert.equal(s.tone, "good");
    assert.ok(s.params.verified && s.params.synced);
    // Facebook's Messenger, comment and insight features depend on Meta's app review.
    assert.ok(s.params.not_proven.includes("Read DMs"), "Messenger must be listed as not proven");
    assert.doesNotMatch(s.reason, /messag\w* (works|is working)/i);
  });

  test("each missing prerequisite alone keeps it from being Connected", () => {
    const cases = [
      ["no saved check", { last_validation_success_at: null }, "unverified", "not_verified"],
      [
        "saved checks cannot be read",
        { evidence: "unavailable" },
        "unverified",
        "evidence_unavailable",
      ],
      ["no account chosen", { external_id: null }, "unverified", "unidentified"],
      ["permissions unknown", { granted_scopes: null }, "unverified", "scopes_unknown"],
      ["pasted token", { connect_method: "manual" }, "unverified", "manual_token"],
      ["never synced", { last_synced_at: null }, "pending_review", "verified_not_synced"],
      ["stale sync", { last_synced_at: ago(9 * 24 * HOUR) }, "failing", "sync_stale"],
    ];
    for (const [name, over, state, code] of cases) {
      const s = connectionStatus(good(over));
      assert.notEqual(s.state, "connected", name);
      assert.equal(s.state, state, name);
      assert.equal(s.code, code, name);
    }
  });

  test("a missing permission is named in plain features, and is not Connected", () => {
    const granted = requiredScopesFor("facebook").filter((p) => p !== "pages_messaging");
    const s = connectionStatus(good({ granted_scopes: granted }));
    assert.equal(s.state, "needs_verification");
    assert.deepEqual(s.params.missing, ["Read DMs"]);
    assert.match(s.reason, /Read DMs/);
    // The technical name is for staff diagnostics, never for a status anyone can read.
    assert.doesNotMatch(JSON.stringify(s), /pages_messaging/);
  });

  test("connection_state = connected is written at connect time and proves nothing", () => {
    const s = connectionStatus(good({ last_validation_success_at: null }));
    assert.equal(s.state, "unverified");
  });

  test("an old success timestamp is ignored when saved checks cannot be read", () => {
    // statusInputFromRow is what both readers use; it must not let a stale value through.
    const input = statusInputFromRow(good(), { state: "unavailable" });
    assert.equal(input.last_validation_success_at, null);
    assert.equal(connectionStatus(input).state, "unverified");
  });

  test("the permissions of an account are granted_scopes, never `permissions`", () => {
    // `permissions` holds capability keys such as "publish", not the scopes the platform granted.
    const row = good({ granted_scopes: null, permissions: { granted: ["publish", "analytics"] } });
    const s = connectionStatus(statusInputFromRow(row, { state: "ok" }));
    assert.equal(s.code, "scopes_unknown");
    assert.deepEqual(
      s.params.missing ?? [],
      [],
      "capability keys must not show up as missing scopes",
    );
  });
});

describe("the next step follows the evidence (acceptance)", () => {
  const action = (over) => connectionStatus(good(over)).action;

  test("table: fact -> the one button", () => {
    const table = [
      ["verified and synced", {}, "none"],
      ["authorized, never verified", { last_validation_success_at: null }, "verify"],
      ["signed in, no account chosen", { external_id: null }, "choose_account"],
      [
        "a permission is missing",
        { granted_scopes: requiredScopesFor("facebook").slice(1) },
        "reconnect",
      ],
      ["permissions unknown", { granted_scopes: null }, "reconnect"],
      ["pasted token", { connect_method: "manual" }, "reconnect"],
      ["token refused", { connection_state: "revoked" }, "reconnect"],
      ["sign-in not accepted", { connection_state: "refresh_failed" }, "reconnect"],
      ["token expired", { token_expires_at: ago(HOUR), renews: false }, "reconnect"],
      ["platform not answering", { connection_state: "provider_unavailable" }, "retry"],
      ["disconnected on purpose", { connection_state: "disconnected" }, "connect"],
      ["first sync not finished", { last_synced_at: null }, "none"],
      ["verification cannot be saved", { evidence: "unavailable" }, "verify"],
    ];
    for (const [name, over, expected] of table) assert.equal(action(over), expected, name);
  });

  test("a connector with no live check never offers Verify now", () => {
    for (const platform of ["threads", "linkedin_ads"]) {
      const s = connectionStatus(
        good({
          platform,
          granted_scopes: requiredScopesFor(platform),
          last_validation_success_at: null,
        }),
      );
      assert.equal(s.code, "not_verified", platform);
      assert.equal(s.action, "coming_soon", platform);
    }
    // And the same account on a connector that can be checked does.
    assert.equal(action({ last_validation_success_at: null }), "verify");
  });

  test("a connector Flas has not built says coming soon instead of Continue with", () => {
    const s = connectionStatus(good({ platform: "tiktok_ads", connection_state: "disconnected" }));
    assert.equal(s.action, "coming_soon");
    assert.equal(connectionStatus(undefined).action, "connect");
  });
});

describe("a deliberate disconnect is not a failure", () => {
  for (const active of [true, false]) {
    test(`state disconnected (active=${active}) reads as Disconnected, not Failing`, () => {
      const s = connectionStatus(good({ connection_state: "disconnected", active }));
      assert.equal(s.state, "not_connected");
      assert.equal(s.label, "Disconnected");
      assert.equal(s.code, "disconnected");
      assert.match(s.reason, /on purpose/);
      assert.equal(needsAttention(s.state), false);
    });
  }

  test("a revoked or refused account is still Failing", () => {
    assert.equal(
      connectionStatus(good({ connection_state: "revoked", active: false })).state,
      "failing",
    );
    assert.equal(connectionStatus(good({ connection_state: "refresh_failed" })).state, "failing");
    assert.equal(
      connectionStatus(good({ active: false, connection_state: null })).state,
      "failing",
    );
  });
});

describe("a platform outage is not the customer's problem", () => {
  test("it has its own state, and never says reconnect", () => {
    const retryAt = new Date(Date.now() + HOUR).toISOString();
    const s = connectionStatus(
      good({ connection_state: "provider_unavailable", next_retry_at: retryAt }),
    );
    assert.equal(s.state, "provider_unavailable");
    assert.equal(s.label, "Platform unavailable");
    assert.equal(s.params.retry_at, retryAt);
    assert.doesNotMatch(`${s.reason} ${s.fix}`, /reconnect/i);
    assert.equal(needsAttention(s.state), true);
  });
});

describe("no sentence promises a check that does not run", () => {
  test("nothing in any status says it will be checked automatically", () => {
    const inputs = [
      good(),
      good({ last_validation_success_at: null }),
      good({ evidence: "unavailable" }),
      good({ granted_scopes: null }),
      good({ external_id: null }),
      good({ connection_state: "provider_unavailable" }),
      good({ connection_state: "provider_unavailable", next_retry_at: ago(-HOUR) }),
      good({ connection_state: "refresh_failed" }),
      good({ connection_state: "disconnected" }),
      good({ last_synced_at: null }),
      good({ token_expires_at: ago(-HOUR), renews: false }),
      good({ token_expires_at: ago(HOUR), renews: false }),
      undefined,
    ];
    for (const input of inputs) {
      const s = connectionStatus(input);
      assert.doesNotMatch(
        `${s.reason} ${s.fix}`,
        /automatic|next check|checks again|retries on/i,
        `${s.code}: ${s.reason} ${s.fix}`,
      );
    }
  });
});

describe("accounts built the old way keep their old answers", () => {
  test("an hour-lapsed token that renews is not Expired; one that cannot renew is", () => {
    const old = {
      platform: "youtube",
      active: true,
      token_expires_at: ago(HOUR),
      last_synced_at: ago(HOUR / 4),
      granted_scopes: requiredScopesFor("youtube"),
    };
    assert.notEqual(connectionStatus({ ...old, renews: true }).state, "expired");
    assert.equal(connectionStatus(old).state, "expired");
  });

  test("an account with nothing known about it is still not connected", () => {
    assert.equal(connectionStatus(undefined).state, "not_connected");
  });
});

describe("what a check's answer becomes", () => {
  const FROM = "connected";
  const call = (extra) =>
    classifyHealthObservation({
      from: FROM,
      validated: false,
      missingScopes: 0,
      reason: "",
      ...extra,
    });

  test("the status the platform sent decides, table-driven", () => {
    const table = [
      ["401", { httpStatus: 401 }, "revoked", "revoked", false],
      [
        "403 is a missing permission, not a revoked grant",
        { httpStatus: 403 },
        "refresh_failed",
        "refresh_failed",
        true,
      ],
      ["429", { httpStatus: 429 }, "rate_limited", "connected", true],
      ["500", { httpStatus: 500 }, "provider_unavailable", "provider_unavailable", true],
      ["503", { httpStatus: 503 }, "provider_unavailable", "provider_unavailable", true],
      ["408", { httpStatus: 408 }, "provider_unavailable", "provider_unavailable", true],
      ["no answer", { unreachable: true }, "provider_unavailable", "provider_unavailable", true],
      [
        "Meta code 190 on HTTP 400",
        { httpStatus: 400, providerCode: "190" },
        "revoked",
        "revoked",
        false,
      ],
      [
        "Meta code 17 on HTTP 400",
        { httpStatus: 400, providerCode: "17" },
        "rate_limited",
        "connected",
        true,
      ],
      ["any other refusal", { httpStatus: 404 }, "refresh_failed", "refresh_failed", true],
    ];
    for (const [name, extra, code, state, active] of table) {
      const out = call(extra);
      assert.equal(out.code, code, name);
      assert.equal(out.state, state, name);
      assert.equal(out.active, active, name);
      assert.ok(
        isLegalTransition(FROM, out.state),
        `${name}: the database would refuse ${out.state}`,
      );
    }
  });

  test("an explicit status beats a number that merely appears in the sentence", () => {
    // The old code read "401" out of text. A 403 whose message mentions 401 is still a 403.
    const out = call({
      httpStatus: 403,
      reason: "Refused (the 401 page, the 190 code and a timeout)",
    });
    assert.equal(out.code, "refresh_failed");
  });

  test("without a status the old sentence reading still works", () => {
    assert.equal(call({ reason: "HTTP 503 from upstream" }).code, "provider_unavailable");
    assert.equal(call({ reason: "too many requests" }).code, "rate_limited");
    assert.equal(call({ reason: "invalid_grant" }).code, "revoked");
    assert.equal(call({ reason: "something odd" }).code, "refresh_failed");
  });

  test("a validated token with a missing permission is never fully healthy", () => {
    const out = classifyHealthObservation({
      from: FROM,
      validated: true,
      missingScopes: 1,
      reason: "",
      httpStatus: 200,
    });
    assert.equal(out.code, "scope_incomplete");
  });
});

describe("permissions", () => {
  test("requiredScopesFor lists what Flas has built, and missingScopesFor subtracts", () => {
    const required = requiredScopesFor("facebook");
    assert.ok(required.length > 0 && required.includes("pages_messaging"));
    assert.deepEqual(missingScopesFor("facebook", required), []);
    assert.deepEqual(missingScopesFor("facebook", required.slice(1)), [required[0]]);
    assert.deepEqual(requiredScopesFor("not-a-platform"), []);
  });

  test("an unlisted set of permissions is unknown, not missing and not granted", () => {
    assert.deepEqual(missingScopesFor("facebook", []), []);
    assert.equal(scopesUnknown("facebook", []), true);
    assert.equal(scopesUnknown("facebook", null), true);
    assert.equal(scopesUnknown("facebook", requiredScopesFor("facebook")), false);
    // A connector that needs none has nothing to be unknown about.
    assert.equal(scopesUnknown("whatsapp", null), false);
  });

  test("Instagram and Facebook name the features a token check cannot prove", () => {
    for (const platform of ["facebook", "instagram"]) {
      assert.ok(notProvenFor(platform).length > 0, platform);
    }
    assert.ok(notProvenFor("facebook").includes("Read DMs"));
    assert.deepEqual(notProvenFor("not-a-platform"), []);
  });
});

describe("summarising a batch of checks", () => {
  test("verified, not checked and needs attention are counted apart", () => {
    const sum = summariseOutcomes([
      { outcome: "healthy" },
      { outcome: "refreshed" },
      { outcome: "recovered" },
      { outcome: "not_checkable" },
      { outcome: "skipped_disconnected" },
      { outcome: "save_failed" },
      { outcome: "provider_unavailable" },
      { outcome: "needs_reconnect" },
    ]);
    assert.deepEqual(sum, { checked: 8, verified: 3, skipped: 2, attention: 3 });
  });

  test("only three outcomes count as verified", () => {
    const verified = [
      "healthy",
      "recovered",
      "refreshed",
      "scopes_missing",
      "scopes_unknown",
      "provider_unavailable",
      "rate_limited",
      "forbidden",
      "needs_reconnect",
      "not_checkable",
      "save_failed",
      "evidence_unavailable",
      "skipped_disconnected",
      "not_identified",
      "reconnect_needed",
      "in_progress",
      "recently_checked",
      "not_found",
      "failed",
    ].filter(isVerifiedOutcome);
    assert.deepEqual(verified, ["healthy", "recovered", "refreshed"]);
  });

  test("every state except connected and not connected needs attention", () => {
    for (const state of [
      "unverified",
      "needs_verification",
      "pending_review",
      "expired",
      "failing",
      "provider_unavailable",
    ]) {
      assert.equal(needsAttention(state), true, state);
    }
    assert.equal(needsAttention("connected"), false);
    assert.equal(needsAttention("not_connected"), false);
  });
});

describe("the exported report carries the proof", () => {
  test("CSV has the verification time and the not-proven features", () => {
    const row = {
      platform: "facebook",
      platform_name: "Facebook",
      group: "social",
      account_id: "a1",
      account_label: "Acme",
      state: "connected",
      state_label: "Connected",
      reason: "Verified.",
      reason_code: "connected",
      reason_params: {},
      fix: "Nothing to do.",
      last_error: null,
      last_error_at: null,
      last_synced_at: null,
      last_verified_at: "2026-10-15T08:00:00.000Z",
      token_expires_at: null,
      granted_permissions: [],
      missing_permissions: [],
      not_proven: ["Read DMs"],
      retry_count: 0,
      next_retry_at: null,
      next_step: "Nothing to do.",
      evidence_state: "ok",
      diagnostics: null,
    };
    const csv = healthReportCsv({ rows: [row] });
    assert.match(csv, /Last verified/);
    assert.match(csv, /2026-10-15T08:00:00\.000Z/);
    assert.match(csv, /Read DMs/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   The words: every code the server can send has a sentence in all five languages.
   ══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
import * as text from "../node_modules/.cache/flas-health-text.mjs";
import { MESSAGES, TRANSLATED_LANGUAGES } from "../node_modules/.cache/flas-health-i18n.mjs";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
    .split("\r\n")
    .join("\n");
const blanksOf = (message) => [...message.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
const LANGUAGES = ["en", ...TRANSLATED_LANGUAGES];
const format = { time: (iso) => `at ${iso.slice(11, 16)}` };

/** A described sentence is real: in every language, with every blank filled by a value. */
function assertSentence(described, label) {
  assert.ok(described, `${label}: no sentence`);
  for (const language of LANGUAGES) {
    const message = MESSAGES[language]?.[described.key];
    assert.ok(message, `${label}: ${described.key} is missing in ${language}`);
    for (const blank of blanksOf(message)) {
      assert.ok(
        blank in described.values,
        `${label}: {${blank}} in ${language} has no value (${Object.keys(described.values)})`,
      );
    }
  }
}

describe("every status and outcome has words in five languages", () => {
  const row = (over = {}) => ({
    platform: "facebook",
    platform_name: "Facebook",
    reason_code: "not_verified",
    reason_params: {
      verified: "2026-10-15T08:00:00.000Z",
      synced: "2026-10-15T09:00:00.000Z",
      retry_at: "2026-10-15T10:00:00.000Z",
      missing: ["Read DMs"],
    },
    state: "unverified",
    action: "verify",
    not_proven: ["Read DMs"],
    ...over,
  });

  test("each reason and fix the server can send", () => {
    for (const code of [
      "not_verified",
      "evidence_unavailable",
      "scopes_unknown",
      "scopes_missing",
      "connected",
      "verified_not_synced",
      "disconnected",
      "provider_unavailable",
      "unidentified",
      "refresh_failed",
      "evidence_unreadable",
    ]) {
      assertSentence(text.describeReason(row({ reason_code: code }), format), `reason ${code}`);
    }
    for (const code of [
      "not_verified",
      "evidence_unavailable",
      "scopes_unknown",
      "scopes_missing",
      "verified_not_synced",
      "disconnected",
      "provider_unavailable",
      "unidentified",
      "refresh_failed",
      "evidence_unreadable",
    ]) {
      assertSentence(text.describeFix(row({ reason_code: code }), format), `fix ${code}`);
    }
    // Codes that keep the server's English (sync problems, expiry...) are not described here.
    assert.equal(text.describeReason(row({ reason_code: "revoked" }), format), null);
  });

  test("with no time to try again the fix says 'in a few minutes'", () => {
    const soon = text.describeFix(
      row({ reason_code: "provider_unavailable", reason_params: {} }),
      format,
    );
    assert.equal(soon.key, "healthReportDialog.fixProviderUnavailableSoon");
    assertSentence(soon, "soon");
  });

  test("each outcome of a check", () => {
    for (const outcome of text.ALL_OUTCOMES) {
      const parts = text.describeResult(
        {
          platform: "facebook",
          outcome,
          reason: "x",
          correlation_id: "abcd1234",
          http_status: 503,
          params: { permissions: ["Read DMs"], retry_at: "2026-10-15T10:00:00.000Z" },
        },
        format,
      );
      assert.ok(parts.length > 0, outcome);
      parts.forEach((part, i) => assertSentence(part, `outcome ${outcome}#${i}`));
    }
  });

  test("an outage with no HTTP status does not print 'HTTP undefined'", () => {
    const [part] = text.describeResult(
      { platform: "facebook", outcome: "provider_unavailable", reason: "x", http_status: null },
      format,
    );
    assert.equal(part.key, "healthReportDialog.outcomeUnavailable");
    assert.ok(!("status" in part.values));
  });

  test("each button", () => {
    for (const action of [
      "connect",
      "choose_account",
      "verify",
      "reconnect",
      "retry",
      "coming_soon",
    ]) {
      assertSentence(text.describeAction(row({ action })), `button ${action}`);
    }
    assert.equal(text.describeAction(row({ action: "none" })), null);
    assert.equal(MESSAGES.en["healthReportDialog.continueWith"], "Continue with {Platform}");
    assert.equal(
      text.describeAction(row({ action: "connect", platform: "instagram" })).values.Platform,
      "Facebook",
      "every Meta product is 'Continue with Facebook', as on the Connect cards",
    );
    assert.equal(
      text.describeAction(row({ action: "connect", platform: "youtube" })).values.Platform,
      "Google",
    );
  });

  test("the badge labels for the new states, and what a connected account cannot prove", () => {
    assert.equal(
      text.describeLabel(row({ reason_code: "disconnected", state: "not_connected" })),
      "healthReportDialog.labelDisconnected",
    );
    assert.equal(
      text.describeLabel(row({ state: "unverified" })),
      "healthReportDialog.labelUnverified",
    );
    assert.equal(
      text.describeLabel(
        row({ state: "provider_unavailable", reason_code: "provider_unavailable" }),
      ),
      "healthReportDialog.labelProviderUnavailable",
    );
    assertSentence(text.describeNotProven(row({ state: "connected" })), "not proven");
    assert.equal(text.describeNotProven(row({ state: "unverified" })), null);
  });

  test("the message after a check comes from what happened", () => {
    const none = text.describeChecks([], format);
    assert.equal(none.kind, "info");
    assert.equal(none.parts[0].key, "healthReportDialog.nothingNeededCheck");

    const one = text.describeChecks(
      [{ platform: "facebook", outcome: "healthy", reason: "x" }],
      format,
    );
    assert.equal(one.kind, "success");
    assert.equal(one.parts[0].key, "healthReportDialog.outcomeVerified");
    const refused = text.describeChecks(
      [{ platform: "facebook", outcome: "forbidden", reason: "x" }],
      format,
    );
    assert.equal(refused.kind, "warning");

    const many = text.describeChecks(
      [
        { platform: "facebook", outcome: "healthy", reason: "x" },
        { platform: "facebook", outcome: "forbidden", reason: "x" },
        { platform: "threads", outcome: "not_checkable", reason: "x" },
      ],
      format,
    );
    assert.equal(many.kind, "warning");
    assert.deepEqual(many.parts[0].values, { n: 3, verified: 1, attention: 1, skipped: 1 });
    assertSentence(many.parts[0], "summary");
  });
});

describe("the agreed English, and the promises it must not make", () => {
  test("the wording the coordinator fixed", () => {
    const en = MESSAGES.en;
    assert.equal(
      en["healthReportDialog.reasonEvidenceUnavailable"],
      "Flas cannot save verification results for this workspace yet, so this account cannot be marked verified.",
    );
    assert.equal(
      en["healthReportDialog.fixEvidenceUnavailable"],
      "Ask Flas support to finish the database update, then press Verify now.",
    );
    assert.equal(
      en["healthReportDialog.fixProviderUnavailable"],
      "Nothing to do now. Press Retry now after {time}.",
    );
    assert.equal(
      en["healthReportDialog.outcomeUnavailableStatus"],
      "{Platform} did not answer (HTTP {status}). Nothing was changed and the account was not marked verified. Try again after {time}.",
    );
  });

  test("no sentence on this screen promises an automatic check or says everything is healthy", () => {
    for (const language of LANGUAGES) {
      for (const [key, message] of Object.entries(MESSAGES[language])) {
        if (!key.startsWith("healthReportDialog.")) continue;
        if (language === "en") {
          assert.doesNotMatch(
            message,
            /automatic|checks again|tries again|every connection is healthy|all healthy/i,
            key,
          );
        }
      }
    }
    assert.ok(!("healthReportDialog.nothingToRetryEveryConnection" in MESSAGES.en));
    assert.ok(!("healthReportDialog.reCheckedConnectionSHealthy" in MESSAGES.en));
  });

  test("the technical diagnostics are Flas-staff-only, in the data and on the screen", () => {
    const source = read("src/components/integrations/HealthReportDialog.tsx");
    assert.match(source, /staff \? row\.diagnostics : null/);
    assert.match(source, /staff=\{isSuperAdmin\}/);
  });

  test("a row's button checks that row's own account, not the whole group", () => {
    const source = read("src/components/integrations/HealthReportDialog.tsx");
    assert.match(source, /onCheck\(row\.account_id\)/);
    assert.match(source, /runCheck\.variables === row\.account_id/);
    assert.doesNotMatch(source, /nothingToRetryEveryConnection/);
  });
});

describe("the Connect card's Last verified is the last verification (B9)", () => {
  test("it prints the saved check, not the last sync that the next line already shows", () => {
    const source = read("src/components/integrations-v2/IntegrationsAuditFixed.tsx");
    const verifiedLine = source
      .split("\n")
      .findIndex((line) => line.includes('"integrationsAuditFixed.lastVerified"'));
    assert.ok(verifiedLine > 0, "the Last verified label is gone");
    // The value sits in the lines under the label, up to the end of its block.
    const shown = source
      .split("\n")
      .slice(verifiedLine + 1, verifiedLine + 4)
      .join("\n");
    assert.match(shown, /last_validation_success_at/);
    assert.doesNotMatch(shown, /last_synced_at/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Round 2, finding 3: the edges a check may take, read from the migrations
   ══════════════════════════════════════════════════════════════════════════ */
import {
  allTransitions as targetEdges,
  isWriteSafeTransition,
  liveTransitions,
  resolveWriteSafeState,
} from "../node_modules/.cache/flas-connection-state.mjs";
import { BATCH1_EDGES, CONNECTION_STATES, LIVE_EDGES, accepts } from "./support/health-world.mjs";

describe("which state a check may write (finding 3)", () => {
  const key = ([from, to]) => `${from}>${to}`;

  test("the live table in the code is the SQL of the trigger the database has today", () => {
    assert.deepEqual(liveTransitions().map(key).sort(), [...LIVE_EDGES].sort());
  });

  test("the target table in the code is the SQL of batch 1", () => {
    assert.deepEqual(targetEdges().map(key).sort(), [...BATCH1_EDGES].sort());
  });

  test("a move is write-safe exactly when both triggers accept it", () => {
    for (const from of CONNECTION_STATES) {
      for (const to of CONNECTION_STATES) {
        assert.equal(
          isWriteSafeTransition(from, to),
          accepts(LIVE_EDGES, from, to) && accepts(BATCH1_EDGES, from, to),
          `${from} -> ${to}`,
        );
      }
    }
  });

  const observations = {
    "worked, every permission": { validated: true, missingScopes: 0, httpStatus: 200 },
    "worked, a permission missing": { validated: true, missingScopes: 1, httpStatus: 200 },
    401: { validated: false, missingScopes: 0, httpStatus: 401 },
    403: { validated: false, missingScopes: 0, httpStatus: 403 },
    404: { validated: false, missingScopes: 0, httpStatus: 404 },
    429: { validated: false, missingScopes: 0, httpStatus: 429 },
    500: { validated: false, missingScopes: 0, httpStatus: 500 },
    "no answer": { validated: false, missingScopes: 0, unreachable: true },
  };
  const classify = (from, o) =>
    classifyHealthObservation({ from, reason: "", ...o, writeSafe: true });

  test("no observation, from any state, is written along an edge either trigger refuses", () => {
    for (const from of CONNECTION_STATES) {
      for (const [name, o] of Object.entries(observations)) {
        const out = classify(from, o);
        assert.ok(
          accepts(LIVE_EDGES, from, out.state) && accepts(BATCH1_EDGES, from, out.state),
          `${from} + ${name} -> ${out.state}`,
        );
      }
    }
  });

  test("a check never brings back a disconnected or revoked account", () => {
    for (const from of ["disconnected", "revoked"]) {
      for (const [name, o] of Object.entries(observations)) {
        assert.equal(classify(from, o).state, from, `${from} + ${name}`);
      }
    }
  });

  test("the cells that used to be refused by the database today", () => {
    // 403, an unknown refusal and a failed renewal: connected -> refresh_failed is not an edge.
    assert.equal(classify("connected", observations["403"]).state, "connected");
    assert.equal(classify("scope_incomplete", observations["403"]).state, "scope_incomplete");
    assert.equal(classify("token_expiring", observations["403"]).state, "refresh_failed");
    // An outage on a sign-in that already failed, or on one with a missing permission, keeps its state.
    assert.equal(classify("refresh_failed", observations["500"]).state, "refresh_failed");
    assert.equal(classify("scope_incomplete", observations["500"]).state, "scope_incomplete");
    // A missing permission found from a state that cannot become scope_incomplete.
    assert.equal(
      classify("token_expiring", observations["worked, a permission missing"]).state,
      "token_expiring",
    );
  });

  test("a state is left only when it says the opposite of what the platform just said", () => {
    // "Not answering" after the platform answered; "sign-in failed" after the token worked.
    for (const name of ["worked, every permission", "worked, a permission missing"]) {
      assert.equal(classify("provider_unavailable", observations[name]).state, "connected", name);
      assert.equal(classify("refresh_failed", observations[name]).state, "connected", name);
    }
    for (const name of ["401", "403", "404"]) {
      assert.equal(
        classify("provider_unavailable", observations[name]).state,
        "token_expiring",
        name,
      );
    }
    // ...but an outage, a rate limit and no answer do not contradict "not answering".
    for (const name of ["429", "500", "no answer"]) {
      assert.equal(
        classify("provider_unavailable", observations[name]).state,
        "provider_unavailable",
        name,
      );
    }
  });

  test("resolveWriteSafeState keeps an observed state the database accepts", () => {
    assert.equal(resolveWriteSafeState("connected", "revoked", false), "revoked");
    assert.equal(
      resolveWriteSafeState("connected", "provider_unavailable", false),
      "provider_unavailable",
    );
    assert.equal(resolveWriteSafeState("provider_unavailable", "connected", true), "connected");
  });

  test("without the option the old batch-1 answer is unchanged (callers that do not write)", () => {
    const old = classifyHealthObservation({
      from: "connected",
      validated: false,
      missingScopes: 0,
      reason: "",
      httpStatus: 403,
    });
    assert.equal(old.state, "refresh_failed");
    assert.equal(accepts(LIVE_EDGES, "connected", "refresh_failed"), false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Round 2, findings 6, 7, 10: the words match the buttons, and say only what is true
   ══════════════════════════════════════════════════════════════════════════ */

describe("a sentence and the button under it agree (findings 6, 7)", () => {
  const inputs = () => [
    good(),
    good({ last_validation_success_at: null }),
    good({ external_id: null }),
    good({ granted_scopes: null }),
    good({ granted_scopes: requiredScopesFor("facebook").slice(1) }),
    good({ connect_method: "manual" }),
    good({ evidence: "unavailable" }),
    good({ evidence: "unreadable" }),
    good({ connection_state: "revoked", active: false }),
    good({ connection_state: "refresh_failed" }),
    good({ connection_state: "provider_unavailable" }),
    good({ connection_state: "disconnected" }),
    good({ token_expires_at: ago(-HOUR), renews: false }),
    good({ token_expires_at: ago(HOUR), renews: false }),
    good({ last_synced_at: null }),
    undefined,
  ];

  test("a fix that starts with a button's name is that button", () => {
    const lead = [
      [/^Press Retry now/, "retry"],
      [/^Press Verify now/, "verify"],
      [/^(Press )?Reconnect/, "reconnect"],
      [/^Press Connect/, "connect"],
    ];
    for (const input of inputs()) {
      const s = connectionStatus(input);
      for (const [pattern, action] of lead) {
        if (pattern.test(s.fix)) assert.equal(s.action, action, `${s.code}: "${s.fix}"`);
      }
    }
  });

  test("a failed sign-in says Reconnect, because Reconnect is the button", () => {
    const s = connectionStatus(good({ connection_state: "refresh_failed" }));
    assert.equal(s.action, "reconnect");
    assert.equal(s.fix, "Reconnect the account.");
    assert.doesNotMatch(s.fix, /Retry now/);
    const facts = {
      platform: "facebook",
      platform_name: "Facebook",
      reason_code: s.code,
      reason_params: s.params,
      state: s.state,
      action: s.action,
    };
    assertSentence(text.describeFix(facts, format), "fix refresh_failed");
    assertSentence(text.describeReason(facts, format), "reason refresh_failed");
  });

  test("Verify now does not say it asks once or changes nothing else", () => {
    const s = connectionStatus(good({ last_validation_success_at: null }));
    assert.equal(s.fix, "Press Verify now. Flas checks with Facebook and saves the result.");
    assert.equal(
      MESSAGES.en["healthReportDialog.fixNotVerified"],
      "Press Verify now. Flas checks with {Platform} and saves the result.",
    );
    for (const language of LANGUAGES) {
      assert.ok(MESSAGES[language]["healthReportDialog.fixNotVerified"], language);
    }
    // A check sends more than one request, can renew the token and writes its findings.
    assert.doesNotMatch(
      Object.values(MESSAGES.en).join(" "),
      /changes nothing else|asks \{Platform\} once/,
    );
  });
});

describe("when the saved results cannot be read, or the account is switched off (finding 10)", () => {
  test("unreadable is its own message, not 'cannot save verification results'", () => {
    const s = connectionStatus(good({ evidence: "unreadable" }));
    assert.equal(s.code, "evidence_unreadable");
    assert.equal(s.state, "unverified");
    assert.doesNotMatch(`${s.reason} ${s.fix}`, /database update|cannot save/i);
    const described = (code) =>
      text.describeReason(
        {
          platform: "facebook",
          platform_name: "Facebook",
          reason_code: code,
          reason_params: {},
          state: "unverified",
          action: "none",
        },
        format,
      );
    assertSentence(described("evidence_unreadable"), "reason evidence_unreadable");
    assert.notEqual(described("evidence_unreadable").key, described("evidence_unavailable").key);
    // The input builder passes the third kind through, and ignores any stored timestamp.
    const input = statusInputFromRow(good(), { state: "unreadable" });
    assert.equal(input.last_validation_success_at, null);
    assert.equal(connectionStatus(input).code, "evidence_unreadable");
  });

  test("a switched-off account with no token is Disconnected, whatever its saved state says", () => {
    for (const connection_state of [
      null,
      "connected",
      "token_expiring",
      "refresh_failed",
      "provider_unavailable",
    ]) {
      const s = connectionStatus(good({ active: false, has_token: false, connection_state }));
      assert.equal(s.code, "disconnected", String(connection_state));
      assert.equal(s.state, "not_connected");
      assert.doesNotMatch(s.reason, /revoked|refused/i);
    }
  });

  test("but a platform that revoked it, or an account that still holds its token, is still failing", () => {
    assert.equal(
      connectionStatus(good({ active: false, has_token: false, connection_state: "revoked" }))
        .state,
      "failing",
    );
    assert.equal(
      connectionStatus(good({ active: false, has_token: true, connection_state: "connected" }))
        .state,
      "failing",
    );
    // Not knowing whether it holds a token keeps the old answer.
    assert.equal(
      connectionStatus(good({ active: false, connection_state: null })).state,
      "failing",
    );
    // An account that is switched on is never read as disconnected from its missing token alone
    // (the channel picker's accounts keep their token elsewhere).
    assert.notEqual(
      connectionStatus(good({ active: true, has_token: false })).code,
      "disconnected",
    );
  });
});
