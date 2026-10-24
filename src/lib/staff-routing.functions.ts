import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  DEFAULT_STAFF_ALERT_TEMPLATE,
  STAFF_DEPARTMENTS,
  type StaffDepartment,
} from "./staff-alert-template";

export {
  type StaffDepartment,
  DEFAULT_STAFF_ALERT_TEMPLATE,
  substituteStaffAlertTags,
} from "./staff-alert-template";
export interface StaffRoutingNumber {
  id: string;
  tenantId: string;
  name: string;
  phone: string;
  department: StaffDepartment;
  roleTitle: string | null;
  notifyOnLead: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface StaffAlertConfig {
  staffAlertTemplate: string;
  staffAlertWhatsappEnabled: boolean;
  autoDepartmentHandoffEnabled: boolean;
  multiCrmCoexistenceEnabled: boolean;
}
export interface StaffRoutingData {
  tenantId: string;
  staffMembers: StaffRoutingNumber[];
  config: StaffAlertConfig;
}

const workspace = z.object({ tenantId: z.string().uuid() });
type Context = { userId: string; supabase: SupabaseClient<Database> };
async function adminWorkspace(context: Context, expectedTenantId: string) {
  const { data: profile, error } = await context.supabase
    .from("profiles")
    .select("tenant_id, staff_role")
    .eq("id", context.userId)
    .single();
  if (
    error ||
    !profile?.tenant_id ||
    !["company_admin", "super_admin"].includes(profile.staff_role)
  ) {
    throw new Error("Only a company admin can manage staff routing and alerts.");
  }
  if (profile.tenant_id !== expectedTenantId)
    throw new Error("Workspace changed. Reload this page before saving.");
  return profile.tenant_id;
}
const setupError = () =>
  new Error(
    "Staff routing could not be loaded. Ask an admin to check its database setup, then retry.",
  );

export const getStaffRoutingDirectory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => workspace.parse(d))
  .handler(async ({ data, context }): Promise<StaffRoutingData> => {
    const tenantId = await adminWorkspace(context, data.tenantId);
    const { data: rows, error } = await supabaseAdmin
      .from("tenant_staff_routing_numbers")
      .select(
        "id, tenant_id, name, phone, department, role_title, notify_on_lead, is_active, created_at, updated_at",
      )
      .eq("tenant_id", tenantId)
      .order("department")
      .order("name");
    if (error) throw setupError();
    const { data: settings, error: settingsError } = await supabaseAdmin
      .from("tenant_bot_settings")
      .select(
        "staff_alert_template, staff_alert_whatsapp_enabled, staff_alert_actor_id, auto_department_handoff_enabled, multi_crm_coexistence_enabled" as never,
      )
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (settingsError) throw setupError();
    const raw = settings as Record<string, unknown> | null;
    return {
      tenantId,
      staffMembers: (rows ?? []).map((r) => ({
        id: r.id,
        tenantId: r.tenant_id,
        name: r.name,
        phone: r.phone,
        department: r.department as StaffDepartment,
        roleTitle: r.role_title,
        notifyOnLead: r.notify_on_lead === true,
        isActive: r.is_active === true,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
      config: {
        staffAlertTemplate:
          typeof raw?.["staff_alert_template"] === "string"
            ? raw["staff_alert_template"]
            : DEFAULT_STAFF_ALERT_TEMPLATE,
        staffAlertWhatsappEnabled:
          raw?.["staff_alert_whatsapp_enabled"] === true &&
          typeof raw?.["staff_alert_actor_id"] === "string",
        autoDepartmentHandoffEnabled: raw?.["auto_department_handoff_enabled"] === true,
        multiCrmCoexistenceEnabled: raw?.["multi_crm_coexistence_enabled"] === true,
      },
    };
  });

const staffSchema = workspace.extend({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(100),
  phone: z
    .string()
    .trim()
    .max(30)
    .transform((value) => value.replace(/[\s()-]/g, ""))
    .refine(
      (value) => /^\+[1-9]\d{7,14}$/.test(value),
      "Use an international number starting with + and its country code.",
    ),
  department: z.enum(STAFF_DEPARTMENTS),
  roleTitle: z.string().trim().max(100).optional().nullable(),
  notifyOnLead: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
export const saveStaffRoutingNumber = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => staffSchema.parse(d))
  .handler(async ({ data, context }) => {
    const tenantId = await adminWorkspace(context, data.tenantId);
    const payload = {
      tenant_id: tenantId,
      name: data.name,
      phone: data.phone,
      department: data.department,
      role_title: data.roleTitle || null,
      notify_on_lead: data.notifyOnLead,
      is_active: data.isActive,
      updated_at: new Date().toISOString(),
    };
    const query = data.id
      ? supabaseAdmin
          .from("tenant_staff_routing_numbers")
          .update(payload)
          .eq("id", data.id)
          .eq("tenant_id", tenantId)
      : supabaseAdmin.from("tenant_staff_routing_numbers").insert(payload);
    const { data: saved, error } = await query.select().single();
    if (error || !saved || saved.tenant_id !== tenantId)
      throw new Error(
        "Could not save this staff member. Check the number is not already registered, then retry.",
      );
    return { ok: true as const, staff: saved };
  });

export const deleteStaffRoutingNumber = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => workspace.extend({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const tenantId = await adminWorkspace(context, data.tenantId);
    const { data: removed, error } = await supabaseAdmin
      .from("tenant_staff_routing_numbers")
      .delete()
      .eq("id", data.id)
      .eq("tenant_id", tenantId)
      .select("id")
      .single();
    if (error || !removed) throw new Error("Could not remove this staff member. Reload and retry.");
    return { ok: true as const };
  });
export const toggleStaffRoutingStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    workspace
      .extend({
        id: z.string().uuid(),
        field: z.enum(["isActive", "notifyOnLead"]),
        value: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const tenantId = await adminWorkspace(context, data.tenantId);
    const { data: saved, error } = await supabaseAdmin
      .from("tenant_staff_routing_numbers")
      .update({
        [data.field === "isActive" ? "is_active" : "notify_on_lead"]: data.value,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .eq("tenant_id", tenantId)
      .select("id")
      .single();
    if (error || !saved) throw new Error("Could not update this staff member. Reload and retry.");
    return { ok: true as const };
  });
export const saveStaffAlertConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    workspace
      .extend({
        staffAlertTemplate: z.string().trim().min(10).max(1000),
        staffAlertWhatsappEnabled: z.boolean(),
        autoDepartmentHandoffEnabled: z.boolean(),
        multiCrmCoexistenceEnabled: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const tenantId = await adminWorkspace(context, data.tenantId);
    const { data: saved, error } = await supabaseAdmin
      .from("tenant_bot_settings")
      .upsert(
        {
          tenant_id: tenantId,
          staff_alert_template: data.staffAlertTemplate,
          staff_alert_whatsapp_enabled: data.staffAlertWhatsappEnabled,
          staff_alert_actor_id: context.userId,
          auto_department_handoff_enabled: data.autoDepartmentHandoffEnabled,
          multi_crm_coexistence_enabled: data.multiCrmCoexistenceEnabled,
          updated_at: new Date().toISOString(),
        } as never,
        { onConflict: "tenant_id" },
      )
      .select("tenant_id")
      .single();
    if (error || !saved || saved.tenant_id !== tenantId)
      throw new Error("Could not save staff alert settings. Reload and retry.");
    return { ok: true as const };
  });

export const sendTestStaffAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    workspace
      .extend({
        staffId: z.string().uuid(),
        clientRef: z.string().uuid(),
        customTemplate: z.string().trim().min(10).max(1000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const tenantId = await adminWorkspace(context, data.tenantId);
    const { sendStaffAlert } = await import("./staff-alert-delivery.server");
    return sendStaffAlert({
      tenantId,
      userId: context.userId,
      staffId: data.staffId,
      clientRef: data.clientRef,
      template: data.customTemplate || DEFAULT_STAFF_ALERT_TEMPLATE,
      lead: {
        customerName: "Sample lead",
        customerPhone: "Not provided",
        customerRequirements: "A sample work request. No customer data is included.",
      },
    });
  });
