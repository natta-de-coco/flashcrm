import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "company"}-${Math.random().toString(36).slice(2, 8)}`;
}

const OnboardingSchema = z.object({
  companyName: z.string().trim().min(2).max(120),
  fullName: z.string().trim().min(2).max(120),
});

/**
 * 2-step onboarding: creates the company, links the caller as company_admin,
 * starts the 1-month free trial, and claims any pending team invites.
 */
export const completeOnboarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => OnboardingSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: existing } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .maybeSingle();
    if (existing?.tenant_id) {
      return { ok: true, alreadyDone: true };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const trialEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: org, error: orgError } = await supabaseAdmin
      .from("organizations")
      .insert({
        name: data.companyName,
        slug: slugify(data.companyName),
        plan: "flash_whatsapp_tool",
        subscription_status: "trial",
        subscription_renews_at: trialEnd,
      })
      .select("id")
      .single();
    if (orgError) throw orgError;

    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .update({
        tenant_id: org.id,
        full_name: data.fullName,
        staff_role: "company_admin",
      })
      .eq("id", userId);
    if (profileError) throw profileError;

    await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: userId, role: "admin" }, { onConflict: "user_id,role" });

    const { logAudit } = await import("@/lib/audit.server");
    await logAudit({
      action: "onboarding.company_created",
      tenantId: org.id,
      actorId: userId,
      entityType: "organization",
      entityId: org.id,
      details: { companyName: data.companyName, trialEnds: trialEnd },
    });

    return { ok: true, alreadyDone: false };
  });

const InviteSchema = z.object({
  email: z.string().email().max(320),
  staffRole: z.enum(["company_admin", "marketing_manager", "staff", "seo_editor"]),
});

/** Company admins invite a teammate by email with a starting role. */
export const inviteStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InviteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: me } = await context.supabase
      .from("profiles")
      .select("tenant_id, staff_role")
      .eq("id", context.userId)
      .maybeSingle();
    if (!me?.tenant_id) throw new Error("No company linked to your account");
    if (!["company_admin", "super_admin"].includes(me.staff_role)) {
      throw new Error("Only company admins can invite staff");
    }

    const { error } = await context.supabase.from("team_invites").insert({
      tenant_id: me.tenant_id,
      email: data.email.toLowerCase(),
      staff_role: data.staffRole,
      invited_by: context.userId,
    });
    if (error) throw error;

    const { logAudit } = await import("@/lib/audit.server");
    await logAudit({
      action: "team.invite",
      actorId: context.userId,
      entityType: "team_invite",
      entityId: data.email,
      details: { staffRole: data.staffRole },
    });
    return { ok: true };
  });

/** Lists the company's staff and pending invites. */
export const listTeam = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: me } = await context.supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", context.userId)
      .maybeSingle();
    if (!me?.tenant_id) throw new Error("No company linked to your account");

    const [{ data: members }, { data: invites }] = await Promise.all([
      context.supabase
        .from("profiles")
        .select("id, full_name, email, staff_role, created_at")
        .eq("tenant_id", me.tenant_id)
        .order("created_at", { ascending: true }),
      context.supabase
        .from("team_invites")
        .select("id, email, staff_role, status, created_at")
        .eq("tenant_id", me.tenant_id)
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
    ]);
    return { members: members ?? [], invites: invites ?? [], myId: context.userId };
  });

const RoleChangeSchema = z.object({
  userId: z.string().uuid(),
  staffRole: z.enum(["company_admin", "marketing_manager", "staff", "seo_editor"]),
});

/** Company admins change a teammate's role. */
export const setStaffRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RoleChangeSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: me } = await context.supabase
      .from("profiles")
      .select("tenant_id, staff_role")
      .eq("id", context.userId)
      .maybeSingle();
    if (!me?.tenant_id || !["company_admin", "super_admin"].includes(me.staff_role)) {
      throw new Error("Only company admins can change roles");
    }
    if (data.userId === context.userId) throw new Error("You cannot change your own role");

    const { error } = await context.supabase
      .from("profiles")
      .update({ staff_role: data.staffRole })
      .eq("id", data.userId)
      .eq("tenant_id", me.tenant_id);
    if (error) throw error;

    const { logAudit } = await import("@/lib/audit.server");
    await logAudit({
      action: "team.role_change",
      actorId: context.userId,
      entityType: "profile",
      entityId: data.userId,
      details: { staffRole: data.staffRole },
    });
    return { ok: true };
  });

/** Removes a teammate from the company (their login stays, access is revoked). */
export const removeStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: me } = await context.supabase
      .from("profiles")
      .select("tenant_id, staff_role")
      .eq("id", context.userId)
      .maybeSingle();
    if (!me?.tenant_id || !["company_admin", "super_admin"].includes(me.staff_role)) {
      throw new Error("Only company admins can remove staff");
    }
    if (data.userId === context.userId) throw new Error("You cannot remove yourself");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ tenant_id: null, staff_role: "staff" })
      .eq("id", data.userId)
      .eq("tenant_id", me.tenant_id);
    if (error) throw error;

    const { logAudit } = await import("@/lib/audit.server");
    await logAudit({
      action: "team.remove",
      actorId: context.userId,
      entityType: "profile",
      entityId: data.userId,
      details: {},
    });
    return { ok: true };
  });

/** Claims pending invites for the caller's email after they sign up. */
export const claimInvites = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: authData } = await context.supabase.auth.getUser();
    const email = authData.user?.email?.toLowerCase();
    if (!email) return { claimed: 0 };

    const { data: invites } = await context.supabase
      .from("team_invites")
      .select("id, tenant_id, staff_role")
      .eq("email", email)
      .eq("status", "pending");
    if (!invites?.length) return { claimed: 0 };

    const invite = invites[0];
    if (!invite) return { claimed: 0 };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("profiles")
      .update({ tenant_id: invite.tenant_id, staff_role: invite.staff_role })
      .eq("id", context.userId);
    await supabaseAdmin
      .from("team_invites")
      .update({ status: "accepted", accepted_at: new Date().toISOString() })
      .eq("id", invite.id);

    return { claimed: 1 };
  });
