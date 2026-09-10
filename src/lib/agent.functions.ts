// The agent's two endpoints: propose, and carry out one approved step.
//
// The browser is not trusted with either half. A step posted back for execution
// is re-validated against the action catalogue here — its name, its input, and
// its risk are all resolved server-side. A caller that edited the payload to
// relabel a `send` as a `read`, or to point a write at another workspace's row,
// gets the real action's rules and the caller's own RLS context regardless.
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { actionSpec, type JsonValue, type ValidatedStep } from "@/lib/agent-actions";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

async function callerTenantId(context: {
  supabase: import("@supabase/supabase-js").SupabaseClient;
  userId: string;
}): Promise<string> {
  const { data } = await context.supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", context.userId)
    .maybeSingle();
  if (!data?.tenant_id) {
    throw new Error("Your workspace is still being set up — try again in a moment.");
  }
  return data.tenant_id as string;
}

export const planAgentTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        task: z.string().trim().min(3).max(2000),
        priorResults: z
          .array(z.object({ action: z.string().max(60), result: z.unknown() }))
          .max(20)
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const tenantId = await callerTenantId(context);
    const { planTask } = await import("@/lib/agent.server");
    return planTask(
      { supabase: context.supabase, tenantId, userId: context.userId },
      data.task,
      // `result` is optional in the parsed shape but required downstream;
      // an absent one is a step that returned nothing, which is null.
      (data.priorResults ?? []).map((r) => ({ action: r.action, result: r.result ?? null })),
    );
  });

export const runAgentStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        action: z.string().trim().min(1).max(60),
        input: z.record(z.string(), z.unknown()).default({}),
        /**
         * Set by the confirmation click, never by the model.
         *
         * A read action ignores it. A write or send action is refused without
         * it, both here and again in executeStep.
         */
        confirmed: z.boolean().default(false),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const spec = actionSpec(data.action);
    if (!spec) throw new Error("There is no such action.");

    // Re-validated against the catalogue, not accepted because the browser
    // said it was valid when the plan was first shown.
    const parsed = spec.schema.safeParse(data.input);
    if (!parsed.success) {
      throw new Error(
        `That step is no longer valid: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      );
    }
    if (spec.risk !== "read" && !data.confirmed) {
      throw new Error("This step changes or sends something and has not been approved.");
    }

    const tenantId = await callerTenantId(context);
    const input = parsed.data as Record<string, JsonValue>;
    const step: ValidatedStep = {
      action: spec.name,
      title: spec.title,
      risk: spec.risk,
      input,
      summary: spec.summarize(input),
      why: null,
    };

    const { executeStep } = await import("@/lib/agent.server");
    const result = await executeStep(
      { supabase: context.supabase, tenantId, userId: context.userId },
      step,
      data.confirmed,
    );

    // Anything that changed or sent something is recorded against the person
    // who approved it, so an agent action is never anonymous in the audit log.
    if (spec.risk !== "read") {
      const { logAudit } = await import("@/lib/audit.server");
      await logAudit({
        action: `agent.${spec.name}`,
        tenantId,
        actorId: context.userId,
        entityType: "agent_action",
        entityId: spec.name,
        details: { ok: result.ok, summary: result.ok ? result.summary : result.error },
      });
    }
    // A JSON round trip before returning: `data` holds whatever the action
    // read from the database, and the framework will not serialize a value it
    // cannot prove is safe. Doing it explicitly is also honest about what
    // crossing this boundary actually does to the value.
    return result.ok
      ? {
          ok: true as const,
          summary: result.summary,
          data: JSON.parse(JSON.stringify(result.data ?? null)) as JsonValue,
        }
      : { ok: false as const, error: result.error };
  });
