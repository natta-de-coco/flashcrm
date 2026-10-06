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

import {
  referenceFor,
  WA_FAILURE_TEXT,
  WA_UNCONFIRMED_TEXT,
} from "../node_modules/.cache/flas-whatsapp.mjs";

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

  it("keeps one reference for the same text until the server answers for it", () => {
    let made = 0;
    const next = () => `ref-${++made}`;
    const first = referenceFor(null, "conv-1\nHello", next);
    // The request failed with no answer; the same text is tried again.
    assert.equal(referenceFor(first, "conv-1\nHello", next), first);
    // Different text, or another conversation, is a different message.
    assert.equal(referenceFor(first, "conv-1\nHello!", next).ref, "ref-2");
    assert.equal(referenceFor(first, "conv-2\nHello", next).ref, "ref-3");
    // Once answered the composer drops it, and the same words are a new message.
    assert.equal(referenceFor(null, "conv-1\nHello", next).ref, "ref-4");
  });

  it("drops the reference only on an answer, never on an error", () => {
    assert.match(
      inbox,
      /sendRef\.current = referenceFor\(sendRef\.current, `\$\{activeId\}\\n\$\{body\}`/,
    );
    assert.match(inbox, /clientRef: sendRef\.current\.ref/);
    assert.match(inbox, /templateRef\.current = referenceFor\(/);
    assert.match(inbox, /clientRef: templateRef\.current\.ref/);
    // The reference used to be dropped whatever happened, so a retry after a
    // lost response was a new message and the customer got two.
    assert.ok(!inbox.includes("onSettled"), "the reference is dropped on every outcome again");
    assert.equal(inbox.split("sendRef.current = null;").length - 1, 1);
    assert.equal(inbox.split("templateRef.current = null;").length - 1, 1);
    const afterAnswer = inbox.slice(inbox.indexOf('// No answer is not a "no".'));
    const errorHandler = afterAnswer.slice(0, afterAnswer.indexOf("});"));
    assert.match(errorHandler, /onError: \(e: Error\) => toast\.error\(e\.message\),/);
    assert.ok(!errorHandler.includes("sendRef.current"), "the error handler drops the reference");
    assert.match(inbox, /if \(!sendMutation\.isPending && sendBlocks\.length === 0\) \{/);
  });

  it("clears the box for a message the server says is already saved", () => {
    // A "duplicate" answer left the text in the box, where the next click sent
    // it again under a new reference.
    assert.ok(!inbox.includes('res.state !== "duplicate"'));
    const reply = inbox.slice(
      inbox.indexOf("const sendMutation = useMutation({"),
      inbox.indexOf("const suggestMutation = useMutation({"),
    );
    assert.ok(reply.indexOf('if (res.state === "blocked")') < reply.indexOf('setDraft("");'));
    assert.match(reply, /void qc\.invalidateQueries\(\{ queryKey: \["messages", activeId\] \}\);/);
  });

  it("looks again when a sending message goes stale, without waiting for other activity", () => {
    const label = inbox.slice(inbox.indexOf("function DeliveryState("));
    assert.match(
      label,
      /window\.setTimeout\(\(\) => lookAgain\(Date\.now\(\)\), remaining \+ 250\)/,
    );
    assert.match(label, /return \(\) => window\.clearTimeout\(timer\);/);
    assert.match(label, /\}, \[status, createdAt\]\);/);
  });

  it("does not say a template re-opens the reply window", () => {
    // Meta: a template may be sent outside the window, but only a new message
    // from the customer opens free-text replies again.
    const english = messages.slice(0, messages.indexOf("\n  ar: {"));
    assert.ok(english.length > 0 && english.length < messages.length);
    for (const key of [
      "inbox.useAnApprovedTemplateTo",
      "inbox.thisCustomerHasNotMessaged",
      "inbox.block.window_closed",
      "inbox.sendFailure.window_closed",
    ]) {
      assert.ok(english.includes(`"${key}"`), key);
    }
    assert.doesNotMatch(english, /re-?open (this|the) (chat|conversation|WhatsApp)/i);
    assert.doesNotMatch(
      english,
      /requires an approved template before you can send a normal reply/,
    );
    assert.match(WA_FAILURE_TEXT.window_closed, /after the customer sends a new message/);
    // The gate and the provider's refusal are described with one sentence.
    assert.match(
      read("src/lib/safety.server.ts"),
      /block\("window_closed", WA_FAILURE_TEXT\.window_closed\);/,
    );
    assert.ok(english.includes(JSON.stringify(WA_FAILURE_TEXT.window_closed)));
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
