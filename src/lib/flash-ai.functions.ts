import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const DraftSchema = z.object({
  goal: z.string().min(3).max(500),
  audience: z.string().max(300).optional(),
  tone: z.enum(["friendly", "professional", "urgent", "playful"]).default("friendly"),
  channel: z.enum(["whatsapp", "email"]).default("whatsapp"),
});

/** Flas AI campaign writer: drafts a message from the tenant's lead data + goal. */
export const draftCampaignMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DraftSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { callFlashAi, getBusinessContext, gatherLeadSummary } =
      await import("@/lib/flash-ai.server");
    const { logAudit } = await import("@/lib/audit.server");

    const supabase = context.supabase as never;
    const [business, leads] = await Promise.all([
      getBusinessContext(supabase),
      gatherLeadSummary(supabase),
    ]);

    const system = [
      "You are Flas AI, the built-in marketing assistant inside Flas CRM.",
      "You write short, high-converting marketing messages that strictly follow WhatsApp and email marketing rules:",
      "- only address an opted-in audience",
      "- always end WhatsApp messages with a line like: Reply STOP to opt out",
      "- no spam trigger words (FREE!!!, guaranteed, act now in all caps), no misleading claims",
      "- use WhatsApp formatting (*bold*, line breaks) and at most 2 emojis",
      "- keep WhatsApp messages under 900 characters; use {name} once as a personalization placeholder",
      data.channel === "email"
        ? "- for email, output a subject line first (Subject: ...), then the body"
        : "- output ONLY the message body, ready to paste",
    ].join("\n");

    const user = [
      `Business: ${business?.business_name ?? "unknown"} (${business?.industry ?? "general"})`,
      business?.description ? `About the business: ${business.description}` : "",
      business?.learned_facts ? `Learned facts: ${business.learned_facts}` : "",
      `Audience data: ${leads.totalLeads} leads (${leads.consentedLeads} consented), sources: ${
        Object.entries(leads.bySource)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ") || "none"
      }, top tags: ${leads.topTags.join(", ") || "none"}.`,
      `Pipeline: ${Object.entries(leads.contactsByStage)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")}`,
      data.audience ? `Target segment: ${data.audience}` : "",
      `Tone: ${data.tone}. Channel: ${data.channel}.`,
      `Campaign goal: ${data.goal}`,
    ]
      .filter(Boolean)
      .join("\n");

    const { data: tenantId } = await context.supabase.rpc("current_tenant_id");
    const draft = await callFlashAi(system, user, {
      tenantId: tenantId as string | null,
      feature: "campaign_draft",
      userId: context.userId,
    });

    await logAudit({
      action: "ai.campaign_draft",
      actorId: context.userId,
      entityType: "campaign",
      details: { channel: data.channel, tone: data.tone, goal: data.goal.slice(0, 140) },
    });

    return { draft };
  });

/** Messaging analytics: local database stats plus Meta's per-number analytics. */
export const getWhatsAppAnalytics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { gatherMessagingAnalytics } = await import("@/lib/flash-ai.server");
    return gatherMessagingAnalytics(context.supabase as never, 30);
  });

/** Flas AI reads the analytics and returns concrete recommendations. */
export const getAnalyticsInsights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { callFlashAi, gatherMessagingAnalytics, getBusinessContext } =
      await import("@/lib/flash-ai.server");
    const { logAudit } = await import("@/lib/audit.server");

    const supabase = context.supabase as never;
    const [stats, business] = await Promise.all([
      gatherMessagingAnalytics(supabase, 30),
      getBusinessContext(supabase),
    ]);

    const system = [
      "You are Flas AI, the operations advisor inside Flas CRM, a WhatsApp marketing platform.",
      "You analyse WhatsApp Business messaging metrics and give concrete, practical advice.",
      "Format: exactly 5 numbered recommendations, each one or two sentences, then a final line starting with 'Focus first:' naming the single highest-impact fix.",
      "Reference the actual numbers. Cover deliverability, response time, bot vs human balance, and compliance (opt-outs, quality rating) where relevant.",
    ].join("\n");

    const user = [
      `Business: ${business?.business_name ?? "unknown"} (${business?.industry ?? "general"})`,
      `Window: last ${stats.days} days`,
      `Messages: ${stats.totals.inbound} inbound, ${stats.totals.outbound} outbound (${stats.totals.botReplies} bot, ${stats.totals.agentReplies} agent)`,
      `Delivery: ${stats.totals.delivered} delivered, ${stats.totals.read} read, ${stats.totals.failed} failed`,
      `Conversations: ${stats.conversations.open} open, ${stats.conversations.pending} pending, ${stats.conversations.closed} closed, ${stats.conversations.unreadTotal} unread`,
      `Average first response: ${stats.avgFirstResponseMinutes != null ? `${stats.avgFirstResponseMinutes} minutes` : "not enough data"}`,
      `Per number: ${
        stats.perNumber
          .map(
            (n) =>
              `${n.label}: ${n.local.conversations} conversations, Meta sent=${n.meta.ok ? n.meta.sent : "n/a"}, delivered=${n.meta.ok ? n.meta.delivered : "n/a"}`,
          )
          .join("; ") || "no numbers connected"
      }`,
    ].join("\n");

    const { data: tenantId } = await context.supabase.rpc("current_tenant_id");
    const insights = await callFlashAi(system, user, {
      tenantId: tenantId as string | null,
      feature: "analytics_insights",
      userId: context.userId,
    });

    await logAudit({
      action: "ai.analytics_insights",
      actorId: context.userId,
      entityType: "analytics",
      details: { days: stats.days },
    });

    return { insights, stats };
  });
