// After an admin saves a workspace's own provider app.
//
// A to Z's admin saved a Meta App ID and Secret, FLAS showed "Ready to
// connect", and nothing connected: the save closed the form and left the admin
// in the diagnostics dialog with no way on to Facebook sign-in. These tests pin
// the next step that replaced that dead end.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  actionableBlockers,
  continueTarget,
  handoffPhase,
} from "../node_modules/.cache/flas-credential-handoff.mjs";

const CONNECTORS = [
  { id: "facebook", provider: "meta" },
  { id: "instagram", provider: "meta" },
  { id: "meta_ads", provider: "meta" },
  { id: "youtube", provider: "google" },
  { id: "whatsapp", provider: null },
];

describe("which connector sign-in continues with", () => {
  it("continues with Facebook after configuring Meta for Facebook", () => {
    assert.equal(continueTarget("facebook", "facebook", CONNECTORS), "facebook");
  });

  it("continues with the product the admin chose when it shares the saved app", () => {
    // Chose Instagram, configured the Meta app from the Facebook row: still Instagram.
    assert.equal(continueTarget("facebook", "instagram", CONNECTORS), "instagram");
  });

  it("never switches to a product from a different provider", () => {
    assert.equal(continueTarget("facebook", "youtube", CONNECTORS), "facebook");
  });

  it("uses the configured connector when setup was opened directly", () => {
    assert.equal(continueTarget("instagram", null, CONNECTORS), "instagram");
    assert.equal(continueTarget("facebook", "unknown", CONNECTORS), "facebook");
  });
});

describe("whether sign-in can start after saving", () => {
  it("is checking until readiness has been fetched again", () => {
    assert.equal(handoffPhase({ status: "ADMIN_SETUP_REQUIRED" }, true), "checking");
    assert.equal(handoffPhase({ status: "READY" }, true), "checking");
  });

  it("is ready for READY and LIMITED", () => {
    assert.equal(handoffPhase({ status: "READY" }, false), "ready");
    assert.equal(handoffPhase({ status: "LIMITED" }, false), "ready");
  });

  it("is blocked while setup is still required or the connector is unfinished", () => {
    assert.equal(handoffPhase({ status: "ADMIN_SETUP_REQUIRED" }, false), "blocked");
    assert.equal(handoffPhase({ status: "COMING_SOON" }, false), "blocked");
  });

  it("is unknown when no readiness row came back", () => {
    assert.equal(handoffPhase(undefined, false), "unknown");
  });

  it("lists blockers most urgent first and leaves out information notes", () => {
    const blockers = actionableBlockers({
      blockers: [
        { code: "W", title: "w", userMessage: "", severity: "WARNING", owner: "PROVIDER" },
        { code: "I", title: "i", userMessage: "", severity: "INFO", owner: "PROVIDER" },
        { code: "B", title: "b", userMessage: "", severity: "BLOCKING", owner: "FLAS_ADMIN" },
      ],
    });
    assert.deepEqual(
      blockers.map((b) => b.code),
      ["B", "W"],
    );
    assert.deepEqual(actionableBlockers(undefined), []);
  });
});

describe("the Integrations screen uses the handoff", () => {
  // Windows checkouts use CRLF; compare on LF so the checks do not depend on it.
  const source = readFileSync(
    "src/components/integrations-v2/IntegrationsAuditFixed.tsx",
    "utf8",
  ).replace(/\r\n/g, "\n");
  const onSaved = source.slice(source.indexOf("onSaved={"), source.indexOf("onSaved={") + 1200);

  it("closes the diagnostics dialog as well as the credential form", () => {
    assert.ok(onSaved.includes("setCredentialsFor(null)"));
    assert.ok(onSaved.includes("setProviderSetupOpen(false)"));
  });

  it("offers the next step instead of stopping after the save", () => {
    assert.ok(onSaved.includes("continueTarget("));
    assert.ok(onSaved.includes("setHandoff("));
    assert.ok(source.includes("Now connect your"));
    assert.ok(source.includes("connect.mutate(id)"));
  });

  it("forgets the chosen connector when diagnostics is opened directly", () => {
    assert.ok(
      !/setProviderSetupOpen\(true\)/.test(source.replace("setProviderSetupOpen(true);\n  }", "")),
    );
    assert.ok(source.includes("openDiagnostics(connector.id)"));
    assert.ok(source.includes("openDiagnostics(null)"));
  });
});
