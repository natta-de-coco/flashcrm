// Server side of the campaign audience: reads the consent tables (and the
// addresses kept beside them) through the caller's RLS client, then hands the
// rows to the pure resolver so the number the user sees and the number the AI
// writer is told are the same number.
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
  type ConsentRow,
  type ContactIdentityRow,
} from "./campaign-audience";
import { looksLikeRefusal, refusalSummary } from "./campaign-draft";
import { aiOptionsFor, callFlashAi, getBusinessContext } from "./flash-ai.server";

/** Same ceiling gatherAudienceSegments uses. A full page sets `truncated`. */
export const AUDIENCE_ROW_LIMIT = 2000;

/**
 * The same ceiling for `contact_identities`, which holds several rows per
 * contact. Reaching it also sets `truncated`.
 */
export const AUDIENCE_IDENTITY_LIMIT = 10_000;

/**
 * Rows asked for per request. A request returns at most the project's "max
 * rows" setting (1,000 by default) however large a `.limit()` it asks for, and
 * says nothing when rows were left behind, so a bigger single read would stop
 * there without anyone being told.
 */
const PAGE_SIZE = 1000;

/**
 * Reads up to `ceiling` rows of a table, a page at a time, in a stable order.
 * A failed read throws: it is never an empty table.
 */
async function readRows<T>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  ceiling: number,
): Promise<T[]> {
  const rows: T[] = [];
  while (rows.length < ceiling) {
    const from = rows.length;
    const asked = Math.min(PAGE_SIZE, ceiling - from);
    const { data, error, count } = await supabase
      .from(table)
      .select(columns, { count: "exact" })
      .order("id", { ascending: true })
      .range(from, from + asked - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as unknown as T[];
    rows.push(...page);
    // The response, not the request, says how much there is: stop at the
    // reported total, or at a page that came back short or empty.
    if (page.length === 0) break;
    if (count != null ? rows.length >= count : page.length < asked) break;
  }
  return rows;
}

/**
 * Both channels in one round trip: the page shows the email figure next to the
 * campaign form and the WhatsApp figure next to the writer, and re-querying per
 * channel switch would let the two disagree mid-edit.
 *
 * Throws when any of the reads fails: a refused or failed read is not an empty
 * table. Treating it as one reported "no audience" for a workspace that has
 * one, or let the writer draft from half the data with nothing on screen to
 * say so.
 */
export async function gatherCampaignAudiences(
  supabase: SupabaseClient,
): Promise<Record<CampaignChannel, CampaignAudience>> {
  const [contacts, leads, identities] = await Promise.all([
    readRows<ConsentRow>(
      supabase,
      "contacts",
      "id, name, email, phone, consent_given",
      AUDIENCE_ROW_LIMIT,
    ),
    // `subscribed` exists on leads only, and is read as a suppression flag.
    // `contact_id` ties a website lead to the contact made from it.
    readRows<ConsentRow>(
      supabase,
      "leads",
      "id, contact_id, name, email, phone, consent_given, subscribed",
      AUDIENCE_ROW_LIMIT,
    ),
    // An address added on the contact card lives here and is not copied to
    // `contacts.email` / `contacts.phone`.
    readRows<ContactIdentityRow>(
      supabase,
      "contact_identities",
      "id, contact_id, kind, value, is_primary",
      AUDIENCE_IDENTITY_LIMIT,
    ),
  ]);

  const resolve = (channel: CampaignChannel) =>
    resolveCampaignAudience({
      contacts,
      leads,
      identities,
      channel,
      rowLimit: AUDIENCE_ROW_LIMIT,
      identityRowLimit: AUDIENCE_IDENTITY_LIMIT,
    });

  return { email: resolve("email"), whatsapp: resolve("whatsapp") };
}

export async function gatherCampaignAudience(
  supabase: SupabaseClient,
  channel: CampaignChannel,
): Promise<CampaignAudience> {
  return (await gatherCampaignAudiences(supabase))[channel];
}

export type SaveCampaignInput = { name: string; subject: string; body: string };

export type SaveCampaignResult =
  { ok: true; recipientsCount: number } | { ok: false; reason: "audience_unavailable" };

/**
 * Saves a campaign as a draft with the audience it has right now.
 *
 * The recipient count is read here, as part of the save, and is not taken from
 * the page. The page used to send whatever its audience request had returned so
 * far: zero while that request was still loading, and zero again if it had
 * failed, and the campaign list later showed that zero as the audience "when
 * saved". If the audience cannot be read, nothing is saved: a campaign with a
 * made-up count is worse than one the user is asked to save again.
 *
 * A refused insert is thrown, as it always was.
 */
export async function saveCampaignDraft(
  supabase: SupabaseClient,
  input: SaveCampaignInput,
  actor: { userId?: string | null },
): Promise<SaveCampaignResult> {
  let audience: CampaignAudience;
  try {
    audience = await gatherCampaignAudience(supabase, "email");
  } catch (error) {
    console.error("[campaigns] not saved, the audience could not be read:", error);
    return { ok: false, reason: "audience_unavailable" };
  }

  const { error } = await supabase.from("campaigns").insert({
    name: input.name,
    subject: input.subject,
    body: input.body,
    recipients_count: audience.total,
    created_by: actor.userId ?? null,
  });
  if (error) throw new Error(error.message);
  return { ok: true, recipientsCount: audience.total };
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
