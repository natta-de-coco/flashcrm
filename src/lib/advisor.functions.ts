import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const ProfileSchema = z.object({
  business_name: z.string().max(160).nullable().default(null),
  industry: z.string().max(120).nullable().default(null),
  niche: z.string().max(160).nullable().default(null),
  city: z.string().max(120).nullable().default(null),
  country: z.string().max(120).nullable().default(null),
  currency: z.string().max(12).nullable().default(null),
  business_stage: z.string().max(60).nullable().default(null),
  monthly_revenue_target: z.number().nonnegative().nullable().default(null),
  main_goal: z.string().max(500).nullable().default(null),
  competitors: z.string().max(500).nullable().default(null),
  description: z.string().max(1500).nullable().default(null),
  website_url: z.string().max(300).nullable().default(null),
});

const AskSchema = z.object({
  question: z.string().min(3).max(1000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .max(20)
    .default([]),
});

const FollowUpSchema = z.object({
  answers: z
    .array(z.object({ question: z.string().min(3).max(300), answer: z.string().min(1).max(1500) }))
    .min(1)
    .max(6),
});

/** Business profile used by the advisor (location, niche, goals). */
export const getAdvisorContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getAdvisorProfile } = await import("@/lib/advisor.server");
    return { profile: await getAdvisorProfile(context.supabase) };
  });

/** Saves the advisor brief (city, country, niche, goals) for this workspace. */
export const saveAdvisorContext = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ProfileSchema.parse(input))
  .handler(async ({ context, data }) => {
    const supabase = context.supabase;
    const { data: tenantId, error: tenantError } = await supabase.rpc("current_tenant_id");
    if (tenantError) throw new Error(`Could not load your workspace: ${tenantError.message}`);
    if (!tenantId) throw new Error("No workspace found for this account.");

    const { error } = await supabase
      .from("business_profiles")
      .upsert({ tenant_id: tenantId as string, ...data }, { onConflict: "tenant_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Full strategic review from the Flas Business Advisor. */
export const runAdvisorAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { buildAdvisorAnalysis } = await import("@/lib/advisor.server");
    const { logAudit } = await import("@/lib/audit.server");

    const analysis = await buildAdvisorAnalysis(context.supabase);

    const { data: tenantId, error: tenantError } = await context.supabase.rpc(
      "current_tenant_id",
    );
    // A recursion/timeout failure of this lookup used to be reported as
    // "no workspace", which sent people hunting a problem that was not theirs.
    if (tenantError) throw new Error(`Could not load your workspace: ${tenantError.message}`);
    if (tenantId) {
      await context.supabase.from("advisor_reports").insert({
        tenant_id: tenantId as string,
        kind: "analysis",
        content: analysis as never,
        created_by: context.userId,
      });
    }
    await logAudit({
      action: "ai.advisor_analysis",
      actorId: context.userId,
      entityType: "advisor",
      details: { opportunities: analysis.opportunities.length },
    });

    return analysis;
  });

/** Latest saved review, so the page has content before running a new one. */
export const getLatestAdvisorAnalysis = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("advisor_reports")
      .select("content, created_at")
      .eq("kind", "analysis")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data ? { analysis: data.content as never, createdAt: data.created_at } : null;
  });

/** Ask the advisor a business question about this workspace. */
export const askAdvisor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AskSchema.parse(input))
  .handler(async ({ context, data }) => {
    const { askAdvisorQuestion } = await import("@/lib/advisor.server");
    const answer = await askAdvisorQuestion(context.supabase, data.question, data.history);

    const { data: tenantId, error: tenantError } = await context.supabase.rpc(
      "current_tenant_id",
    );
    // A recursion/timeout failure of this lookup used to be reported as
    // "no workspace", which sent people hunting a problem that was not theirs.
    if (tenantError) throw new Error(`Could not load your workspace: ${tenantError.message}`);
    if (tenantId) {
      await context.supabase.from("advisor_reports").insert({
        tenant_id: tenantId as string,
        kind: "question",
        question: data.question,
        content: { answer } as never,
        created_by: context.userId,
      });
    }
    return { answer };
  });

/** Structured follow-up mode: the advisor interviews the owner first. */
export const startAdvisorFollowUp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { buildFollowUpQuestions } = await import("@/lib/advisor.server");
    return { questions: await buildFollowUpQuestions(context.supabase) };
  });

/** Turns the owner's answers into a prioritised next-action plan. */
export const completeAdvisorFollowUp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => FollowUpSchema.parse(input))
  .handler(async ({ context, data }) => {
    const { buildFollowUpPlan } = await import("@/lib/advisor.server");
    const plan = await buildFollowUpPlan(context.supabase, data.answers);

    const { data: tenantId, error: tenantError } = await context.supabase.rpc(
      "current_tenant_id",
    );
    // A recursion/timeout failure of this lookup used to be reported as
    // "no workspace", which sent people hunting a problem that was not theirs.
    if (tenantError) throw new Error(`Could not load your workspace: ${tenantError.message}`);
    if (tenantId) {
      await context.supabase.from("advisor_reports").insert({
        tenant_id: tenantId as string,
        kind: "followup",
        content: plan as never,
        created_by: context.userId,
      });
    }
    return plan;
  });
