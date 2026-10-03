import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSync } from "esbuild";

buildSync({
  entryPoints: ["src/lib/whatsapp-broadcast-policy.ts"],
  outfile: "node_modules/.cache/whatsapp-broadcast-policy.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
});
const { whatsappMarketingBlockReason } =
  await import("../node_modules/.cache/whatsapp-broadcast-policy.mjs");

const allowed = {
  consentGiven: true,
  suppressed: false,
  templateApproved: true,
  marketingMessagesInLast3Days: 0,
  hasKnownOptInSource: true,
};

test("WhatsApp marketing rejects every unsafe recipient state", () => {
  assert.equal(whatsappMarketingBlockReason(allowed), null);
  assert.equal(
    whatsappMarketingBlockReason({ ...allowed, templateApproved: false }),
    "template_not_approved",
  );
  assert.equal(
    whatsappMarketingBlockReason({ ...allowed, consentGiven: false }),
    "consent_missing",
  );
  assert.equal(
    whatsappMarketingBlockReason({ ...allowed, hasKnownOptInSource: false }),
    "opt_in_evidence_missing",
  );
  assert.equal(whatsappMarketingBlockReason({ ...allowed, suppressed: true }), "unsubscribed");
  assert.equal(
    whatsappMarketingBlockReason({ ...allowed, marketingMessagesInLast3Days: 1 }),
    "frequency_cap",
  );
});
