import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSync } from "esbuild";

buildSync({ entryPoints: ["src/lib/whatsapp-broadcast.ts"], outfile: "node_modules/.cache/whatsapp-broadcast.mjs", bundle: true, platform: "node", format: "esm" });
const { selectInactiveWhatsAppRecipients } = await import("../node_modules/.cache/whatsapp-broadcast.mjs");

test("only consented, reachable, non-lost stale contacts enter a WhatsApp re-engagement audience", () => {
  const recipients = selectInactiveWhatsAppRecipients([
    { id: "keep", name: "Aisha", phone: "+971 50 123 4567", consent_given: true, stage: "proposal", last_message_at: "2026-08-01T00:00:00Z" },
    { id: "recent", name: "Recent", phone: "+971501234568", consent_given: true, stage: "new", last_message_at: "2026-10-01T00:00:00Z" },
    { id: "no-consent", name: "No", phone: "+971501234569", consent_given: false, stage: "new", last_message_at: "2026-08-01T00:00:00Z" },
    { id: "lost", name: "Lost", phone: "+971501234570", consent_given: true, stage: "lost", last_message_at: "2026-08-01T00:00:00Z" },
  ], 30, new Date("2026-10-03T00:00:00Z"));
  assert.deepEqual(recipients.map((r) => r.contactId), ["keep"]);
  assert.equal(recipients[0].phone, "+971501234567");
});
