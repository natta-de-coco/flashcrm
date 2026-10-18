import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  AI_DRAFT_FIELD_LIMITS,
  AI_DRAFT_TOO_LONG,
  CAMPAIGN_EXTRA_LIMITS,
  CAMPAIGN_FIELD_LIMITS,
  CAMPAIGN_TOO_LONG,
} from "@/lib/campaign-audience";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Checks an input against its schema. A field that is too long is refused with
 * `tooLong`, a code the page puts into words; anything else is the validator's
 * own error, as before.
 */
function parseInput<S extends z.ZodTypeAny>(
  schema: S,
  input: unknown,
  tooLong: string,
): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  if (result.error.issues.some((issue) => issue.code === "too_big")) throw new Error(tooLong);
  throw result.error;
}

/** The real, consent-checked audience behind both channels, for display. */
export const getCampaignAudience = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { gatherCampaignAudiences } = await import("@/lib/campaign-audience.server");
    return gatherCampaignAudiences(context.supabase);
  });

const AttachmentSchema = z.object({
  id: z.string().max(100),
  name: z.string().max(CAMPAIGN_EXTRA_LIMITS.attachmentName),
  url: z.string().max(CAMPAIGN_EXTRA_LIMITS.attachmentUrl),
  type: z.string().max(100),
  size: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

const SaveCampaignSchema = z.object({
  /**
   * The campaign's id: the one the page made for the draft it is writing, or the
   * id of a campaign being edited. The same id is the same campaign, however
   * many times it is saved.
   */
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(CAMPAIGN_FIELD_LIMITS.name),
  subject: z.string().max(CAMPAIGN_FIELD_LIMITS.subject).default(""),
  body: z.string().max(CAMPAIGN_FIELD_LIMITS.body).default(""),
  templateId: z.string().max(CAMPAIGN_EXTRA_LIMITS.templateId).optional(),
  imageUrl: z.string().max(CAMPAIGN_EXTRA_LIMITS.imageUrl).optional(),
  attachments: z.array(AttachmentSchema).max(CAMPAIGN_EXTRA_LIMITS.attachments).optional(),
  /**
   * Only the two stages a person can choose when saving. Sent, in progress and
   * the rest are not something a save can claim.
   */
  status: z.enum(["draft", "scheduled"]).optional(),
});

/**
 * Creates or updates a campaign, recording the audience it really has. This is
 * the only way the campaign board saves one.
 *
 * The recipient count is worked out here from the database, not sent by the
 * page, so a save made while the page's own audience request is still loading
 * (or has failed) cannot record a zero. Returns `{ ok: false }` when the
 * audience could not be read and nothing was saved, so the page can say so.
 *
 * A save that names an id which already exists updates that campaign instead of
 * making another, so saving the same draft twice, a double click and a retry
 * after an answer that never arrived are all one campaign.
 */
export const saveCampaignDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => parseInput(SaveCampaignSchema, input, CAMPAIGN_TOO_LONG))
  .handler(async ({ data, context }) => {
    const { saveCampaignDraft: save } = await import("@/lib/campaign-audience.server");
    return save(context.supabase, data, { userId: context.userId });
  });

const DraftSchema = z.object({
  goal: z.string().trim().min(3).max(AI_DRAFT_FIELD_LIMITS.goal),
  audience: z.string().trim().max(AI_DRAFT_FIELD_LIMITS.audience).optional(),
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
  .inputValidator((input: unknown) => parseInput(DraftSchema, input, AI_DRAFT_TOO_LONG))
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
