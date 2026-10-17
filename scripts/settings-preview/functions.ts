// In-memory, labeled fixtures only. No keys, network, auth, messaging or payments.
export const fixtureState = {
  scope: "demo-A",
  fail: false,
  calls: [] as { operation: string; scope: string; data?: unknown }[],
};
const memory: Record<
  string,
  {
    profile: { fullName: string };
    region: Record<string, string>;
    billing: Record<string, unknown>;
    alerts: Record<string, unknown>;
  }
> = Object.fromEntries(
  ["demo-A", "demo-B"].map((scope) => [
    scope,
    {
      profile: { fullName: "Demo teammate" },
      region: {
        country: scope === "demo-A" ? "AE" : "GB",
        currency: scope === "demo-A" ? "AED" : "GBP",
        locale: "en",
        timezone: scope === "demo-A" ? "Asia/Dubai" : "Europe/London",
      },
      billing: {
        legal_name: scope === "demo-A" ? "Demo Trading A" : "Demo Trading B",
        trade_name: "Demo company",
        vat_number: "DEMO-TAX",
        tax_label: "VAT",
        default_tax_rate: 0,
        default_terms: "Payment within 30 days.",
        logo_url: "",
      },
      alerts: {
        leadAlertsEnabled: true,
        alertEmailAddresses: [],
        alertWhatsappEnabled: false,
        alertWhatsappPhone: null,
      },
    },
  ]),
);
function row(operation: string) {
  fixtureState.calls.push({ operation, scope: fixtureState.scope });
  if (fixtureState.fail) throw new Error("Simulated settings read failure");
  return memory[fixtureState.scope]!;
}
export const getOwnProfileSettings = async () => structuredClone(row("profile.read").profile);
export const saveOwnProfileSettings = async ({ data }: any) => {
  row("profile.save").profile = { fullName: data.fullName.trim() };
  return { ...memory[fixtureState.scope]!.profile };
};
export const getWorkspaceRegion = async () => ({
  ...row("region.read").region,
  staff_role: "company_admin",
});
export const saveWorkspaceRegion = async ({ data }: any) => {
  row("region.save").region = { ...data };
  return { ok: true };
};
export const getBillingProfile = async () => ({ ...row("billing.read").billing });
export const saveBillingProfile = async ({ data }: any) => {
  fixtureState.calls.push({
    operation: "billing.save",
    scope: fixtureState.scope,
    data: { ...data },
  });
  const current = row("billing.save");
  current.billing = { ...current.billing, ...data };
  return { ok: true };
};
export const uploadInvoiceLogo = async () => {
  throw new Error(
    "Logo upload is only available in the actual CRM; this preview has no storage connection.",
  );
};
export const getLeadAlertSettings = async () => ({ ...row("alerts.read").alerts });
export const saveLeadAlertSettings = async ({ data }: any) => {
  row("alerts.save").alerts = { ...data };
  return { ok: true };
};
const notifications = new Map<
  string,
  { id: string; title: string; body: string; created_at: string; read_at: string | null }[]
>();
export const listOwnNotifications = async () => {
  row("notifications.read");
  if (!notifications.has(fixtureState.scope))
    notifications.set(fixtureState.scope, [
      {
        id: "aaaaaaaa-0000-0000-0000-000000000001",
        title: "New lead captured",
        body: `Sample lead in ${fixtureState.scope}. No real customer data.`,
        created_at: new Date().toISOString(),
        read_at: null,
      },
    ]);
  const entries = structuredClone(notifications.get(fixtureState.scope)!);
  return { entries, unreadCount: entries.filter((item) => !item.read_at).length };
};
export const markOwnNotificationsRead = async ({ data }: { data: { ids: string[] } }) => {
  row("notifications.markRead");
  const items = notifications.get(fixtureState.scope) ?? [];
  const updated = items.filter((item) => data.ids.includes(item.id));
  updated.forEach((item) => (item.read_at = new Date().toISOString()));
  return { updatedIds: updated.map((item) => item.id) };
};
export const supabase = {
  from: (table: string) => {
    let scope = fixtureState.scope;
    const query = {
      select: () => query,
      eq: (_key: string, value: string) => {
        scope = value;
        return query;
      },
      maybeSingle: async () => {
        if (fixtureState.fail)
          return { data: null, error: new Error("Simulated settings read failure") };
        if (scope !== fixtureState.scope) throw new Error("Wrong fixture workspace");
        return { data: { ...memory[scope]!.billing }, error: null };
      },
    };
    if (table !== "billing_settings") throw new Error("Unsupported fixture table");
    return query;
  },
};
