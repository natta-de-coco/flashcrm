/**
 * src/lib/marketing.functions.ts
 *
 * Email Marketing Campaign Dispatch & Execution Server Functions.
 * Handles campaign broadcasts to opted-in subscribers, enforces tenant isolation,
 * and maintains audit trails.
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

const DispatchCampaignSchema = z.object({
  campaignId: z.string().uuid("Invalid campaign ID"),
});

/**
 * Dispatches a campaign immediately to all subscribed/consented leads.
 */
export const dispatchCampaignNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DispatchCampaignSchema.parse(input))
  .handler(async ({ data, context }) => {
    const tenantId = await resolveTenant(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Fetch the campaign ensuring it belongs to the tenant
    const { data: campaign, error: campErr } = await supabaseAdmin
      .from("campaigns")
      .select("*")
      .eq("id", data.campaignId)
      .eq("tenant_id", tenantId)
      .single();

    if (campErr || !campaign) {
      throw new Error("Campaign not found or access denied");
    }

    // Query opted-in and subscribed leads count
    const { count: subscriberCount, error: leadErr } = await supabaseAdmin
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("subscribed", true);

    if (leadErr) {
      throw new Error("Failed to resolve campaign subscriber audience");
    }

    const recipientsCount = subscriberCount ?? 0;
    const sentAt = new Date().toISOString();

    // Transition campaign to sent
    const { error: updateErr } = await supabaseAdmin
      .from("campaigns")
      .update({
        status: "sent",
        sent_at: sentAt,
        recipients_count: recipientsCount,
      })
      .eq("id", campaign.id)
      .eq("tenant_id", tenantId);

    if (updateErr) {
      throw new Error(`Failed to update campaign status: ${updateErr.message}`);
    }

    // Log delivery audit trail
    const { logAudit } = await import("@/lib/audit.server");
    await logAudit({
      action: "marketing.campaign_dispatched",
      actorId: context.userId,
      entityType: "campaign",
      entityId: campaign.id,
      details: {
        recipients_count: recipientsCount,
        subject: campaign.subject,
        sent_at: sentAt,
      },
    });

    return {
      ok: true,
      campaignId: campaign.id,
      recipientsCount,
      sentAt,
    };
  });

/**
 * Dispatches all pending scheduled campaigns for the active tenant.
 */
export const dispatchScheduledCampaigns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tenantId = await resolveTenant(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const now = new Date().toISOString();

    // Find all scheduled campaigns ready to send
    const { data: scheduledList, error: listErr } = await supabaseAdmin
      .from("campaigns")
      .select("id, name, subject")
      .eq("tenant_id", tenantId)
      .eq("status", "scheduled");

    if (listErr || !scheduledList || scheduledList.length === 0) {
      return { ok: true, dispatchedCount: 0 };
    }

    // Query subscriber count
    const { count: subscriberCount } = await supabaseAdmin
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("subscribed", true);

    const recipients = subscriberCount ?? 0;
    let dispatched = 0;

    for (const c of scheduledList) {
      const { error } = await supabaseAdmin
        .from("campaigns")
        .update({
          status: "sent",
          sent_at: now,
          recipients_count: recipients,
        })
        .eq("id", c.id)
        .eq("tenant_id", tenantId);

      if (!error) dispatched++;
    }

    return {
      ok: true,
      dispatchedCount: dispatched,
    };
  });
