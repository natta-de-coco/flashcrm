import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { SettingsNavigation } from "@/components/settings/SettingsNavigation";
import { PersonalProfileCard } from "@/components/settings/PersonalProfileCard";
import { RegionCard } from "@/components/settings/RegionCard";
import { CompanyBillingProfileCard } from "@/components/settings/CompanyBillingProfileCard";
import { InvoiceBrandingCard } from "@/components/settings/InvoiceBrandingCard";
import { LeadAlertsSettingsCard } from "@/components/settings/LeadAlertsSettingsCard";
import { SettingsDraftProvider } from "@/hooks/useSettingsDraft";
import { selectedSettingsSection, type SettingsSection } from "@/lib/settings-workspace";
import { FlashLogoBadge } from "@/components/FlashLogoBadge";
import { WorkspaceNotificationBell } from "@/components/WorkspaceNotificationBell";
import { Button } from "@/components/ui/button";
import { FixtureContext, useI18n } from "./runtime";
import { fixtureState } from "./functions";
import { Toaster } from "@/components/ui/sonner";
import "./styles.css";
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function Preview() {
  const [scope, setScope] = useState("demo-A"),
    [role, setRole] = useState("company_admin"),
    [language, setLanguage] = useState("en"),
    [fail, setFail] = useState(false);
  fixtureState.scope = scope;
  fixtureState.fail = fail;
  return (
    <FixtureContext.Provider value={{ scope, role, language }}>
      <header className="flex flex-wrap items-center gap-3 bg-sidebar px-5 py-3 text-sidebar-foreground">
        <FlashLogoBadge className="size-9" />
        <span className="me-auto font-bold">Flas CRM · Settings preview</span>
        <WorkspaceNotificationBell />
        <select
          aria-label="Preview workspace"
          value={scope}
          onChange={(event) => setScope(event.target.value)}
          className="rounded border bg-background p-1 text-foreground"
        >
          <option value="demo-A">Workspace A</option>
          <option value="demo-B">Workspace B</option>
        </select>
        <select
          aria-label="Preview role"
          value={role}
          onChange={(event) => setRole(event.target.value)}
          className="rounded border bg-background p-1 text-foreground"
        >
          <option value="company_admin">Company admin</option>
          <option value="staff">Staff</option>
        </select>
        <Button
          variant="ghost"
          onClick={() => {
            const next = language === "en" ? "ar" : "en";
            setLanguage(next);
            document.documentElement.lang = next;
            document.documentElement.dir = next === "ar" ? "rtl" : "ltr";
          }}
        >
          {language === "en" ? "العربية" : "English"}
        </Button>
      </header>
      <div className="border-b px-5 py-2 text-xs text-muted-foreground">
        Isolated preview · sample workspaces only · saves to temporary memory · no live data,
        storage or external sends.{" "}
        <label className="ms-3 inline-flex gap-2">
          <input
            type="checkbox"
            checked={fail}
            onChange={(event) => setFail(event.target.checked)}
          />
          Simulate failed settings load
        </label>
      </div>
      <Content key={scope + role} fail={fail} />
      <Toaster richColors />
    </FixtureContext.Provider>
  );
}
function Content({ fail }: { fail: boolean }) {
  const { t } = useI18n(),
    { scope, role } = React.useContext(FixtureContext);
  const [selected, setSelected] = useState<SettingsSection>(
    selectedSettingsSection(undefined, role),
  );
  const [visited, setVisited] = useState<SettingsSection[]>([selected]);
  const [dirty, setDirty] = useState(false);
  const qc = useQueryClient();
  useEffect(() => {
    void qc.invalidateQueries();
  }, [fail, qc]);
  const choose = (id: SettingsSection) => {
    setSelected(id);
    setVisited((seen) => (seen.includes(id) ? seen : [...seen, id]));
  };
  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6">
      <h1 className="text-3xl font-bold">{t("settingsIndex.settings")}</h1>
      <p className="mb-6 mt-2 text-sm text-muted-foreground">{t("settingsWorkspace.intro")}</p>
      <div className="grid items-start gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
        <SettingsNavigation role={role} selected={selected} onSelect={choose} />
        <SettingsDraftProvider onDirtyChange={setDirty}>
          <div className="min-w-0">
            {visited.map((id) => (
              <section key={id} hidden={selected !== id}>
                <h2 className="mb-1 text-xl font-semibold">{t(`settingsWorkspace.${id}.label`)}</h2>
                <p className="mb-4 text-sm text-muted-foreground">
                  {t(`settingsWorkspace.${id}.desc`)}
                </p>
                <div className="grid gap-4">
                  {id === "company" ? (
                    <>
                      <RegionCard />
                      <CompanyBillingProfileCard />
                    </>
                  ) : id === "invoices" ? (
                    <InvoiceBrandingCard showCompanyDetails={false} />
                  ) : id === "profile" ? (
                    <PersonalProfileCard />
                  ) : id === "notifications" ? (
                    <LeadAlertsSettingsCard />
                  ) : (
                    <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
                      This preview focuses on the updated forms. The existing {id} tools remain
                      wired in the actual CRM.
                    </div>
                  )}
                </div>
              </section>
            ))}
            <p className="mt-4 text-xs text-muted-foreground" role="status">
              {dirty ? "Unsaved edits are retained between sections." : "No unsaved edits."}
            </p>
          </div>
        </SettingsDraftProvider>
      </div>
    </main>
  );
}
const previewRoot = createRoot(document.getElementById("root")!);
previewRoot.render(
  <QueryClientProvider client={queryClient}>
    <Preview />
  </QueryClientProvider>,
);
if (import.meta.hot) import.meta.hot.dispose(() => previewRoot.unmount());
