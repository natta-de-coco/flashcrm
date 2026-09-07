import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GoalSchema = z.object({
  goal: z.string().trim().min(4).max(500),
  product: z.string().trim().max(200).optional(),
  budgetNote: z.string().trim().max(300).optional(),
});

/** Generates a new campaign plan and saves it to this tenant's history. */
export const generateCampaignPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => GoalSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: tenantId } = await context.supabase.rpc("current_tenant_id");
    if (!tenantId) throw new Error("Your workspace is still being set up.");

    const { generateCampaignPlan: generate } = await import("@/lib/campaign-intel.server");
    const plan = await generate(context.supabase, {
      goal: data.goal,
      product: data.product ?? null,
      budgetNote: data.budgetNote ?? null,
    });

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: saved, error } = await supabaseAdmin
      .from("campaign_plans")
      .insert({
        tenant_id: tenantId as string,
        created_by: context.userId,
        goal: data.goal,
        product: data.product ?? null,
        budget_note: data.budgetNote ?? null,
        plan: plan as never,
      })
      .select("id, created_at")
      .single();
    if (error) throw error;

    const { logAudit } = await import("@/lib/audit.server");
    await logAudit({
      action: "campaign_planner.plan_generated",
      tenantId: tenantId as string,
      actorId: context.userId,
      entityType: "campaign_plan",
      entityId: saved.id,
      details: { goal: data.goal },
    });

    return { id: saved.id, createdAt: saved.created_at, plan };
  });

/** Lists this tenant's past campaign plans, most recent first. */
export const listCampaignPlans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("campaign_plans")
      .select("id, goal, product, budget_note, plan, created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw error;
    return data ?? [];
  });

const DeleteSchema = z.object({ id: z.string().uuid() });

export const deleteCampaignPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DeleteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("campaign_plans").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

/** Real audience/channel numbers shown alongside the AI's recommendations,
 *  so the user can see exactly what the plan was grounded in. */
export const getCampaignIntel = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { gatherAudienceSegments, gatherChannelPerformance } =
      await import("@/lib/campaign-intel.server");
    const [segments, channels] = await Promise.all([
      gatherAudienceSegments(context.supabase),
      gatherChannelPerformance(context.supabase),
    ]);
    return { segments, channels };
  });
