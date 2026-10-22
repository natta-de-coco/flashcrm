/**
 * src/lib/staff-routing.functions.ts
 *
 * Staff Department & Number Management, Alert Templates, and Lead Notification Engine.
 * Supports: Sales, Reception, Maintenance, IT Support, Technician, Department Head.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export {
  type StaffDepartment,
  DEFAULT_STAFF_ALERT_TEMPLATE,
  substituteStaffAlertTags,
} from "./staff-alert-template";
import { type StaffDepartment, DEFAULT_STAFF_ALERT_TEMPLATE } from "./staff-alert-template";

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
  debounceWindowSeconds: number;
  multiCrmCoexistenceEnabled: boolean;
}

export interface StaffRoutingData {
  staffMembers: StaffRoutingNumber[];
  config: StaffAlertConfig;
}

/**
 * Fetch all staff routing numbers and alert template configuration for current tenant.
 */
export const getStaffRoutingDirectory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StaffRoutingData> => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", context.userId)
      .single();

    if (!profile?.tenant_id) {
      throw new Error("No active workspace found");
    }

    const tenantId = profile.tenant_id;

    // Fetch staff routing records
    const { data: staffRows, error: staffErr } = await supabaseAdmin
      .from("tenant_staff_routing_numbers")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("department")
      .order("name");

    if (staffErr && (staffErr as { code?: string }).code !== "42P01") {
      console.warn("[staff-routing] Error fetching staff numbers:", staffErr.message);
    }

    // Fetch bot settings for template & debouncing
    const { data: botSettings } = await supabaseAdmin
      .from("tenant_bot_settings")
      .select(
        "staff_alert_template, staff_alert_whatsapp_enabled, auto_department_handoff_enabled, debounce_window_seconds, multi_crm_coexistence_enabled" as never,
      )
      .eq("tenant_id", tenantId)
      .maybeSingle();

    const rawSettings = botSettings as Record<string, unknown> | null;

    const config: StaffAlertConfig = {
      staffAlertTemplate:
        typeof rawSettings?.["staff_alert_template"] === "string" &&
        rawSettings["staff_alert_template"].trim()
          ? rawSettings["staff_alert_template"]
          : DEFAULT_STAFF_ALERT_TEMPLATE,
      staffAlertWhatsappEnabled: rawSettings?.["staff_alert_whatsapp_enabled"] !== false,
      autoDepartmentHandoffEnabled: rawSettings?.["auto_department_handoff_enabled"] !== false,
      debounceWindowSeconds:
        typeof rawSettings?.["debounce_window_seconds"] === "number"
          ? rawSettings["debounce_window_seconds"]
          : 6,
      multiCrmCoexistenceEnabled: rawSettings?.["multi_crm_coexistence_enabled"] !== false,
    };

    const staffMembers: StaffRoutingNumber[] = (staffRows || []).map(
      (r: Record<string, unknown>) => ({
        id: String(r["id"]),
        tenantId: String(r["tenant_id"]),
        name: String(r["name"] || ""),
        phone: String(r["phone"] || ""),
        department: (r["department"] as StaffDepartment) || "other",
        roleTitle: typeof r["role_title"] === "string" ? r["role_title"] : null,
        notifyOnLead: Boolean(r["notify_on_lead"] !== false),
        isActive: Boolean(r["is_active"] !== false),
        createdAt: String(r["created_at"] || new Date().toISOString()),
        updatedAt: String(r["updated_at"] || new Date().toISOString()),
      }),
    );

    return { staffMembers, config };
  });

const SaveStaffSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1, "Name is required").max(100),
  phone: z.string().min(7, "Valid phone number required").max(30),
  department: z.enum([
    "sales",
    "reception",
    "maintenance",
    "it_support",
    "technician",
    "department_head",
    "other",
  ]),
  roleTitle: z.string().max(100).optional().nullable(),
  notifyOnLead: z.boolean().default(true),
  isActive: z.boolean().default(true),
});

/**
 * Upsert a staff routing number.
 */
export const saveStaffRoutingNumber = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => SaveStaffSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("tenant_id, staff_role")
      .eq("id", context.userId)
      .single();

    if (!profile?.tenant_id) throw new Error("No active workspace found");

    // Canonicalize phone number digits with leading +
    const digits = data.phone.replace(/[^0-9]/g, "");
    const cleanPhone = digits ? `+${digits}` : data.phone.trim();

    const payload = {
      tenant_id: profile.tenant_id,
      name: data.name.trim(),
      phone: cleanPhone,
      department: data.department,
      role_title: data.roleTitle?.trim() || null,
      notify_on_lead: data.notifyOnLead,
      is_active: data.isActive,
      updated_at: new Date().toISOString(),
    };

    if (data.id) {
      const { data: updated, error } = await supabaseAdmin
        .from("tenant_staff_routing_numbers")
        .update(payload)
        .eq("id", data.id)
        .eq("tenant_id", profile.tenant_id)
        .select()
        .single();
      if (error) throw error;
      return { ok: true, staff: updated };
    } else {
      const { data: created, error } = await supabaseAdmin
        .from("tenant_staff_routing_numbers")
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      return { ok: true, staff: created };
    }
  });

/**
 * Delete a staff routing number.
 */
export const deleteStaffRoutingNumber = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", context.userId)
      .single();

    if (!profile?.tenant_id) throw new Error("No active workspace found");

    const { error } = await supabaseAdmin
      .from("tenant_staff_routing_numbers")
      .delete()
      .eq("id", data.id)
      .eq("tenant_id", profile.tenant_id);

    if (error) throw error;
    return { ok: true };
  });

/**
 * Toggle a staff member's active or notify status.
 */
export const toggleStaffRoutingStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { id: string; field: "isActive" | "notifyOnLead"; value: boolean }) =>
    z
      .object({
        id: z.string().uuid(),
        field: z.enum(["isActive", "notifyOnLead"]),
        value: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", context.userId)
      .single();

    if (!profile?.tenant_id) throw new Error("No active workspace found");

    const column = data.field === "isActive" ? "is_active" : "notify_on_lead";

    const { error } = await supabaseAdmin
      .from("tenant_staff_routing_numbers")
      .update({ [column]: data.value, updated_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("tenant_id", profile.tenant_id);

    if (error) throw error;
    return { ok: true };
  });

const SaveConfigSchema = z.object({
  staffAlertTemplate: z.string().min(10).max(1000),
  staffAlertWhatsappEnabled: z.boolean(),
  autoDepartmentHandoffEnabled: z.boolean(),
  debounceWindowSeconds: z.number().int().min(2).max(60),
  multiCrmCoexistenceEnabled: z.boolean(),
});

/**
 * Save staff alert template and AI debounce settings.
 */
export const saveStaffAlertConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => SaveConfigSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", context.userId)
      .single();

    if (!profile?.tenant_id) throw new Error("No active workspace found");

    const { error } = await supabaseAdmin.from("tenant_bot_settings").upsert(
      {
        tenant_id: profile.tenant_id,
        staff_alert_template: data.staffAlertTemplate.trim(),
        staff_alert_whatsapp_enabled: data.staffAlertWhatsappEnabled,
        auto_department_handoff_enabled: data.autoDepartmentHandoffEnabled,
        debounce_window_seconds: data.debounceWindowSeconds,
        multi_crm_coexistence_enabled: data.multiCrmCoexistenceEnabled,
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: "tenant_id" },
    );

    if (error) throw error;
    return { ok: true };
  });
