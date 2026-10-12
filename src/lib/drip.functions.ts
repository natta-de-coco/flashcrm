/**
 * src/lib/drip.functions.ts
 *
 * Server functions for Multi-Step Email Drip Sequences and Enrollment stats.
 */

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

type Client = SupabaseClient<Database>;

async function resolveTenant(supabase: Client, userId: string): Promise<string> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", userId)
    .maybeSingle();

  if (!profile?.tenant_id) {
    throw new Error("No active workspace found for this user account");
  }

  return profile.tenant_id;
}

export interface DripOverviewData {
  sequenceId: string;
  name: string;
  description: string;
  active: boolean;
  steps: {
    id: string;
    stepNumber: number;
    delayDays: number;
    templateId: string;
    subject: string;
    discountCode: string | null;
  }[];
  stats: {
    totalEnrolled: number;
    inProgress: number;
    completed: number;
    unsubscribed: number;
  };
}

/**
 * Retrieves the drip sequence and funnel stats for the active workspace.
 */
export const getDripSequenceOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DripOverviewData> => {
    const tenantId = await resolveTenant(context.supabase, context.userId);
    const { getOrCreateDefaultSequence } = await import("@/lib/drip-automation.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const sequenceId = await getOrCreateDefaultSequence(tenantId);

    const [{ data: seq }, { data: steps }, { data: enrollments }] = await Promise.all([
      (supabaseAdmin as any).from("drip_sequences").select("*").eq("id", sequenceId).single(),
      (supabaseAdmin as any).from("drip_steps").select("*").eq("sequence_id", sequenceId).order("step_number"),
      (supabaseAdmin as any).from("drip_enrollments").select("status").eq("tenant_id", tenantId),
    ]);

    const allEnrollments: any[] = (enrollments as any[]) || [];

    return {
      sequenceId,
      name: seq?.name || "Automated Lead Growth Drip",
      description: seq?.description || "3-step nurture funnel: Day 0 Welcome -> Day 3 Showcase -> Day 7 Expiry",
      active: seq?.active ?? true,
      steps: (steps || []).map((s: any) => ({
        id: s.id,
        stepNumber: s.step_number,
        delayDays: s.delay_days,
        templateId: s.template_id,
        subject: s.subject,
        discountCode: s.discount_code,
      })),
      stats: {
        totalEnrolled: allEnrollments.length,
        inProgress: allEnrollments.filter((e) => e.status === "in_progress" || e.status === "enrolled").length,
        completed: allEnrollments.filter((e) => e.status === "completed").length,
        unsubscribed: allEnrollments.filter((e) => e.status === "unsubscribed").length,
      },
    };
  });

/**
 * Toggles whether the drip sequence is active or paused.
 */
export const toggleDripSequence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ sequenceId: z.string().uuid(), active: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    const tenantId = await resolveTenant(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await (supabaseAdmin as any)
      .from("drip_sequences")
      .update({ active: data.active, updated_at: new Date().toISOString() })
      .eq("id", data.sequenceId)
      .eq("tenant_id", tenantId);

    if (error) throw new Error(error.message);

    return { ok: true, active: data.active };
  });
