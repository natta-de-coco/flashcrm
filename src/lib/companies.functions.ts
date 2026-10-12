import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  billedBy,
  describeChanges,
  describeHistory,
  isDay,
  paidUntilDay,
  paidUntilTimestamp,
  type HistoryDetails,
  type SubscriptionStatus,
} from "@/lib/subscription-admin";

type Client = SupabaseClient<Database>;
type OrgUpdate = Database["public"]["Tables"]["organizations"]["Update"];

/** Throws unless the signed-in user is a Flas platform super admin. */
async function requireSuperAdmin(supabase: Client, userId: string): Promise<void> {
  const { data } = await supabase
    .from("profiles")
    .select("staff_role")
    .eq("id", userId)
    .maybeSingle();
  if (data?.staff_role !== "super_admin") {
    throw new Error("This area is only available to the Flas platform manager");
  }
}

/** True when the signed-in user manages the whole platform (all companies). */
export const isSuperAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("profiles")
      .select("staff_role")
      .eq("id", context.userId)
      .maybeSingle();
    return { superAdmin: data?.staff_role === "super_admin" };
  });

/**
 * Manager portal: every company with its subscription, access and usage.
 *
 * Reads list_subscribers() (20260904010000), which refuses anyone who is not a
 * super admin, in one query. The page used to run five count queries per
 * company, and showed billing from a second call it had to line up by hand.
 */
export const listSubscriptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireSuperAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase.rpc("list_subscribers");
    if (error) throw new Error(`Could not load companies: ${error.message}`);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: extra } = await supabaseAdmin
      .from("company_billing_overview")
      .select("id, members_suspended, last_active");
    const byId = new Map((extra ?? []).map((r) => [r.id, r]));

    return (data ?? []).flatMap((r) => {
      if (!r.tenant_id) return [];
      const more = byId.get(r.tenant_id);
      return [
        {
          id: r.tenant_id,
          name: r.company_name ?? "Unnamed company",
          slug: r.slug ?? "",
          plan: r.plan,
          subscription_status: r.subscription_status ?? "trial",
          subscription_renews_at: r.subscription_renews_at,
          suspended: Boolean(r.suspended),
          paddle_customer_id: r.paddle_customer_id,
          paddle_subscription_id: r.paddle_subscription_id,
          country: r.country,
          created_at: r.company_created_at,
          staff: Number(r.staff_count ?? 0),
          members_suspended: Number(more?.members_suspended ?? 0),
          wa_numbers: Number(r.active_wa_numbers ?? 0),
          social_accounts: Number(r.active_social_accounts ?? 0),
          contacts: Number(r.contacts_count ?? 0),
          messages: Number(r.messages_count ?? 0),
          last_active: more?.last_active ?? r.last_message_at ?? null,
        },
      ];
    });
  });

const SubscriptionSchema = z.object({
  organizationId: z.string().uuid(),
  plan: z
    .string()
    .regex(/^[a-z0-9_]{1,40}$/, "Unknown plan")
    .optional(),
  subscriptionStatus: z.enum(["trial", "active", "past_due", "canceled"]).optional(),
  suspended: z.boolean().optional(),
  /**
   * The day this company has paid up to, as YYYY-MM-DD.
   *
   * Activating used to hardcode 30 days from now, so a customer who paid for
   * a year was recorded as lapsing in a month, and one who paid in cash on the
   * 3rd could not be recorded accurately at all. The manager sets the real
   * date; access_state reads it to decide whether the workspace still works.
   */
  paidUntil: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date")
    .refine(isDay, "That date does not exist")
    .optional(),
  /** Why, for the history: "Cash AED 240 received for one year". */
  note: z.string().trim().max(280).optional(),
});

/**
 * Manager portal: change a company's plan, status, paid-until date or
 * suspension. Only what differs is written, and the history records each
 * change as a sentence alongside the before and after values.
 */
export const updateCompanyStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SubscriptionSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { logAudit } = await import("@/lib/audit.server");

    const { data: before, error: readError } = await supabaseAdmin
      .from("organizations")
      .select(
        "plan, subscription_status, subscription_renews_at, suspended, paddle_subscription_id",
      )
      .eq("id", data.organizationId)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!before) throw new Error("Company not found.");

    const patch: OrgUpdate = {};
    if (data.plan !== undefined && data.plan !== before.plan) patch["plan"] = data.plan;
    if (data.subscriptionStatus && data.subscriptionStatus !== before.subscription_status) {
      patch["subscription_status"] = data.subscriptionStatus;
    }
    if (data.paidUntil && data.paidUntil !== paidUntilDay(before.subscription_renews_at)) {
      // End of the paid day, not its first second -- a customer paid up to the
      // 31st keeps the 31st.
      patch["subscription_renews_at"] = paidUntilTimestamp(data.paidUntil);
    }
    if (typeof data.suspended === "boolean" && data.suspended !== before.suspended) {
      patch["suspended"] = data.suspended;
    }
    if (Object.keys(patch).length === 0) throw new Error("Nothing changed.");

    // A paid company needs a real date rather than an invented one.
    const renewsAfter = patch["subscription_renews_at"] ?? before.subscription_renews_at;
    if (patch["subscription_status"] === "active" && !renewsAfter) {
      throw new Error("Set the date this company has paid until.");
    }

    const { error } = await supabaseAdmin
      .from("organizations")
      .update(patch)
      .eq("id", data.organizationId);
    // The guard trigger's own words, e.g. refusing to suspend the platform
    // owner's company, are the most useful thing to show.
    if (error) throw new Error(error.message);

    const changes = describeChanges(
      before,
      {
        plan: patch["plan"] ?? before.plan ?? "",
        status: (patch["subscription_status"] ?? before.subscription_status) as SubscriptionStatus,
        paidUntil: paidUntilDay(renewsAfter),
      },
      new Date(),
    );
    if (patch["suspended"] === true) {
      changes.push("Suspended: everyone at this company loses access now.");
    }
    if (patch["suspended"] === false) changes.push("Suspension lifted.");

    await logAudit({
      action: "company.subscription_update",
      tenantId: data.organizationId,
      actorId: context.userId,
      entityType: "organization",
      entityId: data.organizationId,
      details: {
        changes,
        note: data.note ?? null,
        billing: billedBy(before),
        before: {
          plan: before.plan,
          subscription_status: before.subscription_status,
          subscription_renews_at: before.subscription_renews_at,
          suspended: before.suspended,
        },
        after: patch,
      },
    });
    return { ok: true, changes };
  });

/**
 * Manager portal: read-only "view as company" workspace for troubleshooting.
 * Every view is recorded in the audit log. Never returns secrets (tokens, keys).
 */
export const getCompanyWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ organizationId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { logAudit } = await import("@/lib/audit.server");
    const orgId = data.organizationId;

    await logAudit({
      action: "company.impersonate_view",
      tenantId: orgId,
      actorId: context.userId,
      entityType: "organization",
      entityId: orgId,
      details: { mode: "read_only_troubleshoot" },
    });

    const { data: org, error } = await supabaseAdmin
      .from("organizations")
      .select(
        "id, name, slug, plan, subscription_status, subscription_renews_at, suspended, paddle_subscription_id, created_at",
      )
      .eq("id", orgId)
      .maybeSingle();
    if (error) throw error;
    if (!org) throw new Error("Company not found");

    const [staff, leads, conversations, audit, numbers, authEmails] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id, full_name, email, staff_role, created_at")
        .eq("tenant_id", orgId)
        .order("created_at", { ascending: true }),
      supabaseAdmin
        .from("leads")
        .select("id, name, email, phone, source, status, lead_score, consent_given, created_at")
        .eq("tenant_id", orgId)
        .order("created_at", { ascending: false })
        .limit(10),
      supabaseAdmin
        .from("conversations")
        .select(
          "id, channel, status, unread_count, last_message_at, last_message_preview, contacts!inner(name, tenant_id)",
        )
        .eq("contacts.tenant_id", orgId)
        .order("last_message_at", { ascending: false })
        .limit(10),
      supabaseAdmin
        .from("audit_log")
        .select("id, action, actor_label, entity_type, created_at")
        .eq("tenant_id", orgId)
        .order("created_at", { ascending: false })
        .limit(15),
      supabaseAdmin
        .from("wa_numbers")
        .select(
          "id, label, display_phone, phone_number_id, is_default, active, alerts_enabled, deliverability_min, read_rate_min",
        )
        .eq("tenant_id", orgId)
        .order("created_at", { ascending: true }),
      supabaseAdmin
        .from("auth_email_attempts")
        .select(
          "id, recipient_email, action_type, status, attempt_number, provider_error, requested_at, accepted_at",
        )
        .eq("tenant_id", orgId)
        .order("requested_at", { ascending: false })
        .limit(20),
    ]);

    type WorkspaceLead = {
      id: string;
      name: string | null;
      email: string;
      phone: string | null;
      source: string;
      status: string;
      lead_score: number;
      consent_given: boolean;
      created_at: string;
    };
    type WorkspaceConversation = {
      id: string;
      channel: string;
      status: string;
      unread_count: number;
      last_message_at: string;
      last_message_preview: string | null;
      contacts: { name: string } | null;
    };

    return {
      org,
      staff: staff.data ?? [],
      leads: (leads.data ?? []) as unknown as WorkspaceLead[],
      conversations: (conversations.data ?? []) as unknown as WorkspaceConversation[],
      audit: audit.data ?? [],
      numbers: numbers.data ?? [],
      authEmails: authEmails.data ?? [],
    };
  });

const PlanThresholdSchema = z.object({
  plan: z.string().min(1).max(40),
  deliverabilityMin: z.number().min(0).max(100),
  readRateMin: z.number().min(0).max(100),
});

/** Manager portal: set the default health thresholds for a subscription plan. */
export const updatePlanThresholds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => PlanThresholdSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { logAudit } = await import("@/lib/audit.server");

    const { error } = await supabaseAdmin.from("plan_thresholds").upsert({
      plan: data.plan,
      deliverability_min: data.deliverabilityMin,
      read_rate_min: data.readRateMin,
    });
    if (error) throw error;

    await logAudit({
      action: "plan.thresholds_update",
      actorId: context.userId,
      entityType: "plan_thresholds",
      entityId: data.plan,
      details: { deliverability_min: data.deliverabilityMin, read_rate_min: data.readRateMin },
    });
    return { ok: true };
  });

/**
 * Manager portal: who changed this company's subscription and when, and what
 * Paddle reported, newest first.
 */
export const getSubscriptionHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ organizationId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("audit_log")
      .select("id, action, actor_id, actor_label, details, created_at")
      .eq("tenant_id", data.organizationId)
      .in("action", ["company.subscription_update", "billing.subscription_sync"])
      .order("created_at", { ascending: false })
      .limit(25);
    if (error) throw new Error(error.message);

    const actorIds = [
      ...new Set((rows ?? []).map((r) => r.actor_id).filter((id): id is string => Boolean(id))),
    ];
    const names = new Map<string, string>();
    if (actorIds.length > 0) {
      const { data: actors } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, email")
        .in("id", actorIds);
      for (const a of actors ?? []) names.set(a.id, a.full_name || a.email || "A manager");
    }

    return (rows ?? []).map((r) => {
      const details = (r.details ?? {}) as HistoryDetails;
      const who =
        r.actor_label === "payments-webhook"
          ? "Paddle"
          : ((r.actor_id ? names.get(r.actor_id) : undefined) ?? r.actor_label ?? "System");
      return {
        id: r.id,
        at: r.created_at,
        who,
        text: describeHistory(r.action, details),
        note: typeof details.note === "string" ? details.note : null,
      };
    });
  });

/** Everyone inside one company, with their access state. */
export const listCompanyMembers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ orgId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("profiles")
      .select(
        "id, full_name, email, staff_role, suspended, suspended_at, suspended_reason, last_seen_at",
      )
      .eq("tenant_id", data.orgId)
      .order("email");
    if (error) throw error;
    return rows ?? [];
  });

/**
 * Suspend or restore one person. A platform super admin cannot be suspended --
 * a database trigger refuses it, so this cannot lock the owner out of their
 * own platform even by mistake.
 */
export const setUserSuspended = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        suspended: z.boolean(),
        reason: z.string().trim().max(280).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.supabase, context.userId);
    if (data.userId === context.userId) {
      throw new Error("You cannot suspend your own account.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({
        suspended: data.suspended,
        suspended_at: data.suspended ? new Date().toISOString() : null,
        suspended_reason: data.suspended ? (data.reason ?? null) : null,
      })
      .eq("id", data.userId);
    if (error) throw error;

    const { logAudit } = await import("@/lib/audit.server");
    await logAudit({
      action: data.suspended ? "user.suspended" : "user.restored",
      actorId: context.userId,
      entityType: "profile",
      entityId: data.userId,
      ...(data.reason ? { details: { reason: data.reason } } : {}),
    });
    return { ok: true };
  });
