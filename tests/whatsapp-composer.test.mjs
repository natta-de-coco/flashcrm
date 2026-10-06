// The inbox composer says what the server decided, in the reader's language.
//
// The send pipeline returns reasons as stable codes (see
// tests/whatsapp-reliability.test.mjs for the behaviour). These hold the screen
// to them: every code has words in the message files, and the composer shows
// the sending number, refuses what the gate refuses, and never calls an
// unanswered send "sent" or "failed".
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { WA_FAILURE_TEXT, WA_UNCONFIRMED_TEXT } from "../node_modules/.cache/flas-whatsapp.mjs";

describe("what the composer says is what the server decided", () => {
  const read = (path) =>
    readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
      .split("\r\n")
      .join("\n");
  const messages = read("src/lib/i18n/screens/inbox.ts");
  const inbox = read("src/routes/_authenticated/inbox.tsx");

  it("has words, in the message files, for every reason the provider can give", () => {
    // The English shown is the library's own sentence, so the two cannot drift.
    for (const [reason, text] of Object.entries(WA_FAILURE_TEXT)) {
      assert.ok(
        messages.includes(`"inbox.sendFailure.${reason}"`),
        `no message for provider reason "${reason}"`,
      );
      assert.ok(messages.includes(JSON.stringify(text)), `English for "${reason}" differs`);
    }
    assert.ok(messages.includes(`"inbox.sendFailure.unconfirmed"`));
    assert.ok(messages.includes(JSON.stringify(WA_UNCONFIRMED_TEXT)));
  });

  it("has words for every reason the safety gate can give", () => {
    const gate = read("src/lib/safety.server.ts");
    const union = gate.slice(
      gate.indexOf("export type SendBlockCode ="),
      gate.indexOf("export type SendBlock ="),
    );
    const codes = [...union.matchAll(/\| "([a-z_]+)"/g)].map((m) => m[1]);
    assert.ok(codes.length >= 12, `found ${codes.length} block codes`);
    for (const code of codes) {
      assert.ok(messages.includes(`"inbox.block.${code}"`), `no message for block "${code}"`);
    }
  });

  it("shows which number a reply leaves from, and stops a send the gate would refuse", () => {
    assert.match(inbox, /queryKey: \["send-context", activeId\]/);
    assert.match(inbox, /i18n\.tr\("inbox\.sendingFromTo"/);
    assert.match(
      inbox,
      /sendBlocks\.length > 0\s*\n\s*\}/,
      "the Send button is disabled by a block",
    );
  });

  it("sends one reference per message, so a second Enter is the same message", () => {
    assert.match(inbox, /sendRef\.current \?\?= crypto\.randomUUID\(\);/);
    assert.match(inbox, /clientRef: sendRef\.current/);
    assert.match(inbox, /if \(!sendMutation\.isPending && sendBlocks\.length === 0\) \{/);
    assert.match(inbox, /templateRef\.current \?\?= crypto\.randomUUID\(\);/);
  });

  it("puts a suggested reply in the box for a person to read, and never sends it", () => {
    assert.match(inbox, /onSuccess: \(res\) => setDraft\(res\.draft\),/);
    // The server function that drafts has no way to send.
    const crm = read("src/lib/crm.functions.ts");
    const draftFn = crm.slice(
      crm.indexOf("export const draftBotReply ="),
      crm.indexOf("const RetrySchema ="),
    );
    assert.match(draftFn, /return \{ draft: draft\.text \};/);
    for (const sender of [
      "sendConversationMessage",
      "storeOutbound",
      "deliverWhatsApp",
      "sendWhatsApp",
    ]) {
      assert.ok(!draftFn.includes(sender), `the draft function reaches ${sender}`);
    }
  });

  it("labels a message WhatsApp never confirmed, instead of sent or failed", () => {
    assert.match(inbox, /if \(status === "unconfirmed" \|\| stale\) \{/);
    assert.match(inbox, /i18n\.t\("inbox\.status\.unconfirmed"\)/);
    // "Sent" is the provider accepting it; "Delivered" only comes from a receipt.
    assert.match(inbox, /if \(status === "delivered"\) \{/);
    assert.match(inbox, /if \(status === "sent"\) \{/);
  });
});
