// Server side of the campaign audience: reads both consent tables through the
// caller's RLS client, then hands the rows to the pure resolver so the number
// the user sees and the number the AI writer is told are the same number.
//
// Defect H8 (QA, 26 Sep 2026): the writer's audience came from
// `gatherLeadSummary` in flash-ai.server.ts, which reads `leads` only. A
// consented *contact* was therefore reported to the model as zero opted-in
// people, and the model duly refused. This helper reads both tables.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  audienceBlockedReason,
  describeAudience,
  resolveCampaignAudience,
  type CampaignAudience,
  type CampaignChannel,
} from "./campaign-audience";
import { looksLikeRefusal, refusalSummary } from "./campaign-draft";
import { aiOptionsFor, callFlashAi, getBusinessContext } from "./flash-ai.server";

/** Same ceiling gatherAudienceSegments uses. A full page sets `truncated`. */
export const AUDIENCE_ROW_LIMIT = 2000;

/**
 * Both channels in one round trip: the page shows the email figure next to the
 * campaign form and the WhatsApp figure next to the writer, and re-querying per
 * channel switch would let the two disagree mid-edit.
 */
export async function gatherCampaignAudiences(
  supabase: SupabaseClient,
): Promise<Record<CampaignChannel, CampaignAudience>> {
  const [{ data: contacts }, { data: leads }] = await Promise.all([
    supabase.from("contacts").select("name, email, phone, consent_given").limit(AUDIENCE_ROW_LIMIT),
    // `subscribed` exists on leads only, and is read as a suppression flag.
    supabase
      .from("leads")
      .select("name, email, phone, consent_given, subscribed")
      .limit(AUDIENCE_ROW_LIMIT),
  ]);

  const resolve = (channel: CampaignChannel) =>
    resolveCampaignAudience({ contacts, leads, channel, rowLimit: AUDIENCE_ROW_LIMIT });

  return { email: resolve("email"), whatsapp: resolve("whatsapp") };
}

export async function gatherCampaignAudience(
  supabase: SupabaseClient,
  channel: CampaignChannel,
): Promise<CampaignAudience> {
  return (await gatherCampaignAudiences(supabase))[channel];
}

export type DraftRequest = {
  goal: string;
  audience?: string | null;
  tone: "friendly" | "professional" | "urgent" | "playful";
  channel: CampaignChannel;
};

export type DraftResult =
  | { ok: true; draft: string; audience: CampaignAudience }
  | { ok: false; reason: string; audience: CampaignAudience };

/**
 * Drafts a campaign message for the audience this workspace actually has.
 *
 * Two things the old path got wrong are structural here rather than left to the
 * model: an empty audience is refused in code, with a reason naming what the
 * user must do, and the model's own text is checked before it is handed back as
 * a draft — so a refusal can no longer surface as a success.
 */
export async function draftCampaignForAudience(
  supabase: SupabaseClient,
  input: DraftRequest,
  actor: { userId?: string | null },
): Promise<DraftResult> {
  const audience = await gatherCampaignAudience(supabase, input.channel);

  const blocked = audienceBlockedReason(audience);
  if (blocked) {
    // Refusing before the call also keeps a pointless request off the tenant's
    // AI quota, and gives the user a reason instead of the model's guess.
    return { ok: false, reason: blocked, audience };
  }

  const business = await getBusinessContext(supabase as never);

  const system = [
    "You are Flas AI, the built-in marketing assistant inside Flas CRM.",
    "You write short, high-converting marketing messages that strictly follow WhatsApp and email marketing rules:",
    "- the audience described below has already given recorded consent; write to them",
    "- never suggest sending to a pasted phone list, a purchased list, or a number whose opt-in has not been recorded",
    "- use the requested segment only as a strategy label; the CRM, not the model, decides the final eligible recipients",
    "- always end WhatsApp messages with a line like: Reply STOP to opt out",
    "- no spam trigger words (FREE!!!, guaranteed, act now in all caps), no misleading claims",
    "- use WhatsApp formatting (*bold*, line breaks) and at most 2 emojis",
    "- keep WhatsApp messages under 900 characters; use {name} once as a personalization placeholder",
    input.channel === "email"
      ? "- for email, output a subject line first (Subject: ...), then the body"
      : "- output ONLY the message body, ready to paste",
    "Output the message itself and nothing else. Never reply with an explanation of why you cannot write it — consent has already been verified in code before you were called.",
  ].join("\n");

  const user = [
    `Business: ${business?.business_name ?? "unknown"} (${business?.industry ?? "general"})`,
    business?.description ? `About the business: ${business.description}` : "",
    business?.learned_facts ? `Learned facts: ${business.learned_facts}` : "",
    `Verified audience: ${describeAudience(audience)}.`,
    input.audience ? `Target segment within that audience: ${input.audience}` : "",
    `Tone: ${input.tone}. Channel: ${input.channel}.`,
    `Campaign goal: ${input.goal}`,
  ]
    .filter(Boolean)
    .join("\n");

  const draft = await callFlashAi(
    system,
    user,
    await aiOptionsFor(supabase, "campaign_draft", actor.userId),
  );

  if (looksLikeRefusal(draft)) {
    return {
      ok: false,
      reason: `Flas AI did not write a draft: ${refusalSummary(draft) || "it returned an empty message"}`,
      audience,
    };
  }

  return { ok: true, draft, audience };
}
