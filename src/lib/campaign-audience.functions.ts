import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** The real, consent-checked audience behind both channels, for display. */
export const getCampaignAudience = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { gatherCampaignAudiences } = await import("@/lib/campaign-audience.server");
    return gatherCampaignAudiences(context.supabase);
  });

const SaveCampaignSchema = z.object({
  name: z.string().trim().min(1).max(200),
  subject: z.string().max(500).default(""),
  body: z.string().max(100_000).default(""),
});

/**
 * Saves a campaign as a draft, recording the audience it really has.
 *
 * The recipient count is worked out here from the database, not sent by the
 * page, so a save made while the page's own audience request is still loading
 * (or has failed) cannot record a zero. Returns `{ ok: false }` when the
 * audience could not be read and nothing was saved, so the page can say so.
 */
export const saveCampaignDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SaveCampaignSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { saveCampaignDraft: save } = await import("@/lib/campaign-audience.server");
    return save(context.supabase, data, { userId: context.userId });
  });

const DraftSchema = z.object({
  goal: z.string().trim().min(3).max(500),
  audience: z.string().trim().max(300).optional(),
  tone: z.enum(["friendly", "professional", "urgent", "playful"]).default("friendly"),
  channel: z.enum(["whatsapp", "email"]).default("whatsapp"),
});

/**
 * Flas AI campaign writer, audience-aware.
 *
 * Replaces the marketing page's use of `draftCampaignMessage`
 * (flash-ai.functions.ts), whose audience summary counted `leads` only and so
 * reported a consented *contact* as nobody — defect H8. Returns a tagged
 * result rather than throwing, because "you have no opted-in audience" is a
 * normal state the page has to explain, not an error.
 */
export const draftCampaignForAudience = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DraftSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { draftCampaignForAudience: draft } = await import("@/lib/campaign-audience.server");
    const result = await draft(
      context.supabase,
      {
        goal: data.goal,
        audience: data.audience ?? null,
        tone: data.tone,
        channel: data.channel,
      },
      { userId: context.userId },
    );

    const { logAudit } = await import("@/lib/audit.server");
    await logAudit({
      action: result.ok ? "ai.campaign_draft" : "ai.campaign_draft_refused",
      actorId: context.userId,
      entityType: "campaign",
      details: {
        channel: data.channel,
        tone: data.tone,
        goal: data.goal.slice(0, 140),
        audienceSize: result.audience.total,
        ...(result.ok ? {} : { reason: result.reason }),
      },
    });

    return result;
  });
