import { formatDate, type TenantLocale } from "./locale";
export function formatInboxTime(value: string, locale: TenantLocale) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat(locale.locale, {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: locale.timezone,
    }).format(date);
  } catch {
    return date.toISOString().slice(11, 16);
  }
}
export function formatInboxDay(value: string, locale: TenantLocale) {
  if (!Number.isFinite(new Date(value).getTime())) return "—";
  return formatDate(value, locale);
}
export function deliveryPresentation(status: string | null | undefined) {
  const value = (status ?? "").toLowerCase();
  return value === "pending" || value === "sending"
    ? "waiting"
    : ["sent", "delivered", "read", "failed"].includes(value)
      ? (value as "sent" | "delivered" | "read" | "failed")
      : "unknown";
}
