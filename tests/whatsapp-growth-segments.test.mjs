import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSync } from "esbuild";

buildSync({ entryPoints: ["src/lib/whatsapp-growth-segments.ts"], outfile: "node_modules/.cache/whatsapp-growth-segments.mjs", bundle: true, platform: "node", format: "esm" });
const { buildWhatsAppGrowthSegments } = await import("../node_modules/.cache/whatsapp-growth-segments.mjs");

test("growth segments only count consented, reachable WhatsApp contacts", () => {
  const segments = buildWhatsAppGrowthSegments(
    [
      { id: "recent", consentGiven: true, hasPhone: true, stage: "new", lastMessageAt: "2026-10-02T00:00:00Z" },
      { id: "quiet", consentGiven: true, hasPhone: true, stage: "proposal", lastMessageAt: "2026-09-01T00:00:00Z" },
      { id: "won", consentGiven: true, hasPhone: true, stage: "won", lastMessageAt: "2026-09-01T00:00:00Z" },
      { id: "blocked", consentGiven: false, hasPhone: true, stage: "won", lastMessageAt: "2026-09-01T00:00:00Z" },
    ],
    [{ id: "c1", contactId: "recent" }, { id: "c2", contactId: "quiet" }],
    [
      { conversationId: "c1", direction: "inbound", createdAt: "2026-10-02T00:00:00Z" },
      { conversationId: "c2", direction: "outbound", createdAt: "2026-09-20T00:00:00Z" },
    ],
    new Date("2026-10-03T00:00:00Z"),
  );
  assert.deepEqual(Object.fromEntries(segments.map((segment) => [segment.id, segment.count])), {
    recent_repliers: 1,
    quiet_opted_in: 2,
    past_customers: 1,
    awaiting_reply: 1,
  });
});
