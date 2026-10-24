/**
 * src/lib/staff-alert-template.ts
 *
 * Pure utility functions and constants for staff department alert formatting.
 * Isolated from TanStack Start to allow clean bundling in server/test harnesses.
 */

export type StaffDepartment =
  "sales" | "reception" | "maintenance" | "it_support" | "technician" | "department_head" | "other";

export const STAFF_DEPARTMENTS = [
  "sales",
  "reception",
  "maintenance",
  "it_support",
  "technician",
  "department_head",
  "other",
] as const;
export function staffDepartmentLabelKey(department: string) {
  const keys = {
    sales: "staffRouting.sales",
    reception: "staffRouting.reception",
    maintenance: "staffRouting.maintenance",
    it_support: "staffRouting.it",
    technician: "staffRouting.technician",
    department_head: "staffRouting.head",
    other: "staffRouting.other",
  } as const;
  return Object.hasOwn(keys, department) ? keys[department as StaffDepartment] : keys.other;
}

export const DEFAULT_STAFF_ALERT_TEMPLATE =
  "🚨 *New Customer Request - {{department}}*\n" +
  "👤 *Customer:* {{customer_name}}\n" +
  "📞 *Phone:* {{customer_phone}}\n" +
  "🏢 *Department:* {{department}}\n" +
  "📝 *Requirements:* {{customer_requirements}}\n" +
  "⏰ *Time:* {{timestamp}}";

/**
 * Replace merge tags for staff lead alert message.
 */
export function substituteStaffAlertTags(
  template: string,
  data: {
    customerName?: string | null;
    customerPhone?: string | null;
    department?: string | null;
    customerRequirements?: string | null;
    companyName?: string | null;
    timestamp?: string | null;
  },
): string {
  let result = template || DEFAULT_STAFF_ALERT_TEMPLATE;
  const now = data.timestamp || new Date().toLocaleString();
  const replacements: Record<string, string> = {
    customer_name: data.customerName?.trim() || "Prospective Client",
    customer_phone: data.customerPhone?.trim() || "Not provided",
    department: data.department
      ? data.department.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
      : "General Support",
    customer_requirements: data.customerRequirements?.trim() || "Inquiry via WhatsApp",
    company_name: data.companyName?.trim() || "Our Company",
    timestamp: now,
  };

  for (const [key, val] of Object.entries(replacements)) {
    const regex = new RegExp(`{{\\s*${key}\\s*}}`, "gi");
    // A lead containing "$&" is text, never a replacement-pattern instruction.
    result = result.replace(regex, () => val);
  }

  return result;
}
