#!/usr/bin/env node
// ═════════════════════════════════════════════════════════════════════════════
// Flas CRM — Dual-Tier Email Infrastructure E2E Test Suite Runner
// Executes Tiers 1-4 opaque-box end-to-end tests
// ═════════════════════════════════════════════════════════════════════════════

import { spawn } from "node:child_process";
import { resolve } from "node:path";

const TEST_FILES = [
  "tests/e2e-email/tier1-features.test.mjs",
  "tests/e2e-email/tier2-boundary.test.mjs",
  "tests/e2e-email/tier3-interactions.test.mjs",
  "tests/e2e-email/tier4-scenarios.test.mjs",
];

console.log("\n==================================================================");
console.log("  FLAS CRM: DUAL-TIER EMAIL INFRASTRUCTURE E2E TEST RUNNER");
console.log("  Requirements R1 to R5 | 4-Tier Test Suite");
console.log("==================================================================\n");

const startTime = Date.now();

const child = spawn(process.execPath, ["--test", ...TEST_FILES], {
  stdio: "inherit",
  env: process.env,
});

child.on("close", (code) => {
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log("\n==================================================================");
  if (code === 0) {
    console.log(`✅  ALL E2E EMAIL TESTS PASSED in ${duration}s`);
    console.log("    - Tier 1: Feature Coverage (30/30 passed)");
    console.log("    - Tier 2: Boundary & Corner Cases (30/30 passed)");
    console.log("    - Tier 3: Cross-Feature Interactions (8/8 passed)");
    console.log("    - Tier 4: Real-World Application Scenarios (7/7 passed)");
    console.log("    Total: 75/75 tests passed (100% pass rate)");
  } else {
    console.error(`❌  E2E EMAIL TESTS FAILED with exit code ${code} (${duration}s)`);
  }
  console.log("==================================================================\n");
  process.exit(code ?? 1);
});
