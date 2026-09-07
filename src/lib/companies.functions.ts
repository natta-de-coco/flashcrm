import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

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

/** Manager portal: every company on the platform with usage stats. */
export const listCompanies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: orgs, error } = await supabaseAdmin
      .from("organizations")
      .select(
        "id, name, slug, plan, subscription_status, subscription_renews_at, suspended, created_at",
      )
      .order("created_at", { ascending: false });
    if (error) throw error;

    const companies = await Promise.all(
      (orgs ?? []).map(async (org) => {
        const count = async (table: string) => {
          const q = supabaseAdmin
            .from(table as never)
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", org.id);
          return (await q).count ?? 0;
        };
        const [users, contacts, leads, conversations, numbers] = await Promise.all([
          count("profiles"),
          count("contacts"),
          count("leads"),
          count("conversations"),
          // Was missing the tenant filter, so every company row reported the
          // same platform-wide total instead of its own numbers.
          count("wa_numbers"),
        ]);
        return { ...org, users, contacts, leads, conversations, numbers };
      }),
    );
    return companies;
  });

const StatusSchema = z.object({
  organizationId: z.string().uuid(),
  subscriptionStatus: z.enum(["trial", "active", "past_due", "canceled"]).optional(),
  suspended: z.boolean().optional(),
});

/** Manager portal: activate, suspend or cancel a company's subscription. */
export const updateCompanyStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => StatusSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { logAudit } = await import("@/lib/audit.server");

    const patch: OrgUpdate = {};
    if (data.subscriptionStatus) {
      patch["subscription_status"] = data.subscriptionStatus;
      if (data.subscriptionStatus === "active") {
        patch["subscription_renews_at"] = new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000,
        ).toISOString();
      }
    }
    if (typeof data.suspended === "boolean") patch["suspended"] = data.suspended;
    if (Object.keys(patch).length === 0) throw new Error("Nothing to update");

    const { error } = await supabaseAdmin
      .from("organizations")
      .update(patch)
      .eq("id", data.organizationId);
    if (error) throw error;

    await logAudit({
      action: "company.subscription_update",
      tenantId: data.organizationId,
      actorId: context.userId,
      entityType: "organization",
      entityId: data.organizationId,
      details: patch,
    });
    return { ok: true };
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
        "id, name, slug, plan, subscription_status, subscription_renews_at, suspended, created_at",
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
        .select("id, recipient_email, action_type, status, attempt_number, provider_error, requested_at, accepted_at")
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
 * Manager portal: one row per company with the billing facts the platform
 * owner actually asks for — has this company paid, until when, how many days
 * are left, and how many of its people are cut off.
 *
 * Reads company_billing_overview (20260907230000), which computes the state
 * rather than leaving the caller to derive "expired" from a timestamp.
 */
export const listCompanyBilling = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("company_billing_overview")
      .select("*")
      .order("subscription_renews_at", { ascending: true, nullsFirst: false });
    if (error) throw error;
    return data ?? [];
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
      .select("id, full_name, email, staff_role, suspended, suspended_at, suspended_reason, last_seen_at")
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
