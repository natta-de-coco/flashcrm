import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getDocStage, STAGES } from "../node_modules/.cache/flas-sales-pipeline.mjs";

describe("Visual Sales Board — deal stages tracking", () => {
  it("maps draft quotation to draft stage", () => {
    const stage = getDocStage({
      id: "doc-1",
      kind: "quotation",
      doc_number: "QT-2026-0001",
      status: "draft",
      issue_date: "2026-10-08",
      currency: "AED",
      grand_total: 5000,
      paid_amount: 0,
      balance: 5000,
      customer_snapshot: { name: "Ahmed" },
      share_token: null,
      last_sent_at: null,
    });
    assert.equal(stage, "draft");
  });

  it("maps draft invoice to draft stage", () => {
    const stage = getDocStage({
      id: "doc-2",
      kind: "invoice",
      doc_number: "INV-2026-0001",
      status: "draft",
      issue_date: "2026-10-08",
      currency: "AED",
      grand_total: 3000,
      paid_amount: 0,
      balance: 3000,
      customer_snapshot: { name: "Sarah" },
      share_token: null,
      last_sent_at: null,
    });
    assert.equal(stage, "draft");
  });

  it("maps sent quotation to sent/review stage", () => {
    const stage = getDocStage({
      id: "doc-3",
      kind: "quotation",
      doc_number: "QT-2026-0002",
      status: "sent",
      issue_date: "2026-10-08",
      currency: "AED",
      grand_total: 8000,
      paid_amount: 0,
      balance: 8000,
      customer_snapshot: { name: "Company X" },
      share_token: "token-1",
      last_sent_at: "2026-10-08T08:00:00Z",
    });
    assert.equal(stage, "sent");
  });

  it("maps accepted quotation to accepted stage ready for invoice conversion", () => {
    const stage = getDocStage({
      id: "doc-4",
      kind: "quotation",
      doc_number: "QT-2026-0003",
      status: "accepted",
      issue_date: "2026-10-08",
      currency: "AED",
      grand_total: 12000,
      paid_amount: 0,
      balance: 12000,
      customer_snapshot: { name: "Enterprise Ltd" },
      share_token: "token-2",
      last_sent_at: "2026-10-08T08:00:00Z",
    });
    assert.equal(stage, "accepted");
  });

  it("maps finalized invoice with balance to unpaid / awaiting payment stage", () => {
    const stage = getDocStage({
      id: "doc-5",
      kind: "invoice",
      doc_number: "INV-2026-0002",
      status: "sent",
      issue_date: "2026-10-08",
      currency: "AED",
      grand_total: 7500,
      paid_amount: 0,
      balance: 7500,
      customer_snapshot: { name: "Buyer" },
      share_token: "token-3",
      last_sent_at: "2026-10-08T09:00:00Z",
    });
    assert.equal(stage, "unpaid");
  });

  it("maps invoice with status paid or balance <= 0 to paid stage", () => {
    const stagePaid = getDocStage({
      id: "doc-6",
      kind: "invoice",
      doc_number: "INV-2026-0003",
      status: "paid",
      issue_date: "2026-10-08",
      currency: "AED",
      grand_total: 4000,
      paid_amount: 4000,
      balance: 0,
      customer_snapshot: { name: "Buyer Paid" },
      share_token: "token-4",
      last_sent_at: "2026-10-08T10:00:00Z",
    });
    assert.equal(stagePaid, "paid");

    const stageZeroBalance = getDocStage({
      id: "doc-7",
      kind: "invoice",
      doc_number: "INV-2026-0004",
      status: "sent",
      issue_date: "2026-10-08",
      currency: "AED",
      grand_total: 2500,
      paid_amount: 2500,
      balance: 0,
      customer_snapshot: { name: "Buyer Zero Balance" },
      share_token: "token-5",
      last_sent_at: "2026-10-08T10:00:00Z",
    });
    assert.equal(stageZeroBalance, "paid");
  });

  it("defines the 5 core deal stages with headers and tones", () => {
    assert.equal(STAGES.length, 5);
    const ids = STAGES.map((s) => s.id);
    assert.deepEqual(ids, ["draft", "sent", "accepted", "unpaid", "paid"]);
    for (const stage of STAGES) {
      assert.ok(stage.label.length > 0);
      assert.ok(stage.headerColor.length > 0);
      assert.ok(stage.badgeTone.length > 0);
    }
  });
});
