export function canReceiveLeadNotifications(role: string | null | undefined): boolean {
  return ["company_admin", "super_admin", "marketing_manager", "staff"].includes(role ?? "");
}
