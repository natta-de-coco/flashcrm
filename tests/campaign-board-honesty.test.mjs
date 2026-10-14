import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync(
  "src/components/marketing/CampaignBoard.tsx",
  "utf8",
);
function block(name, next) {
  const start = source.indexOf("  const " + name + " = useMutation({");
  const end = source.indexOf("\n  const " + next, start);
  assert.ok(
    start >= 0 && end > start,
    "Production mutation could not be located",
  );
  return source.slice(start, end);
}
function handlers(verified = true) {
  const flag = source.match(/const EMAIL_CAMPAIGNS_CAN_SEND = (?:true|false);/);
  assert.ok(flag, "Delivery capability must be explicit");
  const writes = [],
    dispatches = [];
  const globals = {
    isSmtpVerified: verified,
    useMutation: (options) => options,
    t: (key) => key,
    toast: { success() {}, error() {} },
    qc: { invalidateQueries() {} },
    friendlyError: (e) => e.message,
    dispatchNowFn: async (request) => {
      dispatches.push(request);
      return { recipientsCount: 1 };
    },
    supabase: {
      from: () => ({
        update: (patch) => ({
          eq: async (key, value) => {
            writes.push({ patch, key, value });
            return { error: null };
          },
        }),
      }),
    },
  };
  const wrapper = `const { isSmtpVerified, useMutation, t, toast, qc, friendlyError, dispatchNowFn, supabase } = globals;
${flag[0]}
${block("dispatchNowMutation", "updateStatusMutation")}
${block("updateStatusMutation", "deleteCampaignMutation")}
return { dispatchNowMutation, updateStatusMutation };`;
  const js = ts.transpileModule(wrapper, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return { ...new Function("globals", js)(globals), writes, dispatches };
}
test("verified SMTP cannot invoke the non-delivering campaign endpoint", async () => {
  const h = handlers(true);
  await assert.rejects(
    h.dispatchNowMutation.mutationFn("test-campaign"),
    /sendingIsNotAutomatedYet/,
  );
  assert.equal(h.dispatches.length, 0);
  assert.equal(h.writes.length, 0);
});
test("unverified SMTP cannot invoke the campaign endpoint either", async () => {
  const h = handlers(false);
  await assert.rejects(
    h.dispatchNowMutation.mutationFn("test-campaign"),
    /sendingIsNotAutomatedYet/,
  );
  assert.equal(h.dispatches.length, 0);
});
test("a campaign cannot be manually marked sent", async () => {
  const h = handlers(true);
  await assert.rejects(
    h.updateStatusMutation.mutationFn({ id: "test-campaign", status: "sent" }),
  );
  assert.equal(h.writes.length, 0);
});
test("ordinary draft updates continue to work", async () => {
  const h = handlers(true);
  await h.updateStatusMutation.mutationFn({
    id: "test-campaign",
    status: "draft",
  });
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].patch.status, "draft");
});
test("unverified SMTP cannot move a campaign into a planned stage", async () => {
  const h = handlers(false);
  await assert.rejects(
    h.updateStatusMutation.mutationFn({
      id: "test-campaign",
      status: "scheduled",
    }),
  );
  assert.equal(h.writes.length, 0);
});
test("verified SMTP can save a planned date without dispatch", async () => {
  const h = handlers(true);
  await h.updateStatusMutation.mutationFn({
    id: "test-campaign",
    status: "scheduled",
  });
  assert.equal(h.writes.length, 1);
  assert.equal(h.dispatches.length, 0);
});
