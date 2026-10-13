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
 * Sends a campaign immediately to all subscribed/consented leads.
 *
 * This path calls no sender (email-dispatch.server.ts has HTTP senders, but nothing here uses
 * one), so it never sends: it refuses with the plain reason and changes nothing. In particular the campaign is not moved to "sent", no recipient count is
 * stored and no "dispatched" audit record is written, because none of that would be true. The
 * result type is what a real send will return.
 */
export const dispatchCampaignNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DispatchCampaignSchema.parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ ok: true; campaignId: string; recipientsCount: number; sentAt: string }> => {
      const tenantId = await resolveTenant(context.supabase, context.userId);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      // Fetch the campaign ensuring it belongs to the tenant
      const { data: campaign, error: campErr } = await supabaseAdmin
        .from("campaigns")
        .select("id")
        .eq("id", data.campaignId)
        .eq("tenant_id", tenantId)
        .single();

      if (campErr || !campaign) {
        throw new Error("Campaign not found or access denied");
      }

      const { whyMarketingEmailCannotBeSent } = await import("@/lib/lead-automation.server");
      throw new Error(whyMarketingEmailCannotBeSent());
    },
  );

/**
 * Sends all pending scheduled campaigns for the active tenant.
 *
 * Nothing scheduled is a true "nothing to send". Anything scheduled is refused with the plain
 * reason (this path calls no sender) and keeps its status; a database error reading the
 * list is an error, not "nothing to send".
 */
export const dispatchScheduledCampaigns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: true; dispatchedCount: number }> => {
    const tenantId = await resolveTenant(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Find all scheduled campaigns ready to send
    const { data: scheduledList, error: listErr } = await supabaseAdmin
      .from("campaigns")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("status", "scheduled");

    if (listErr) {
      throw new Error("Could not check which campaigns are scheduled");
    }
    if (!scheduledList || scheduledList.length === 0) {
      return { ok: true, dispatchedCount: 0 };
    }

    const { whyMarketingEmailCannotBeSent } = await import("@/lib/lead-automation.server");
    throw new Error(whyMarketingEmailCannotBeSent());
  });
