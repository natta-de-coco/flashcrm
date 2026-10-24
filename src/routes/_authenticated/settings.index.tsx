import { BillingCard } from "@/components/settings/BillingCard";
import { RegionCard } from "@/components/settings/RegionCard";
import { CompanyBillingProfileCard } from "@/components/settings/CompanyBillingProfileCard";
import { AuditLogCard } from "@/components/settings/AuditLogCard";
import { DataPrivacyCard } from "@/components/settings/DataPrivacyCard";
import { SecurityCard } from "@/components/settings/SecurityCard";
import { TeamCard } from "@/components/settings/TeamCard";
import { EmailMarketingCard } from "@/components/settings/EmailMarketingCard";
import { LeadAlertsSettingsCard } from "@/components/settings/LeadAlertsSettingsCard";
import { StaffDepartmentRoutingCard } from "@/components/settings/StaffDepartmentRoutingCard";
import { InvoiceBrandingCard } from "@/components/settings/InvoiceBrandingCard";
import { PersonalProfileCard } from "@/components/settings/PersonalProfileCard";
import { AppearanceCard } from "@/components/settings/AppearanceCard";
import { SettingsNavigation } from "@/components/settings/SettingsNavigation";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/hooks/useTenant";
import { useI18n } from "@/hooks/useI18n";
import { SettingsDraftProvider } from "@/hooks/useSettingsDraft";
import {
  settingsSectionsFor,
  parseSettingsSearch,
  selectedSettingsSection,
  shouldLeaveSettings,
  type SettingsSection,
} from "@/lib/settings-workspace";
import { Link, createFileRoute, useBlocker, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Bot, ChevronRight, Mail, Plug } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings/")({
  validateSearch: parseSettingsSearch,
  head: () => ({
    meta: [
      { title: "Settings — Flas CRM" },
      {
        name: "description",
        content:
          "Manage your profile, company, invoice logo, notifications, team, billing and privacy.",
      },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { user } = useAuth();
  const { tenant, loading } = useTenant();
  if (loading)
    return (
      <main className="min-h-0 flex-1 p-4 sm:p-6">
        <Skeleton className="mb-6 h-12 w-56" />
        <Skeleton className="h-96 w-full" />
      </main>
    );
  // Remount drafts when identity changes; never carry another company's edits.
  return <SettingsWorkspace key={`${user?.id}:${tenant?.id ?? "personal"}`} />;
}

function SettingsWorkspace() {
  const { t, tr } = useI18n();
  const { isAdmin } = useAuth();
  const { tenant, staffRole } = useTenant();
  const role = tenant ? staffRole : null;
  const navigate = useNavigate();
  const { section } = Route.useSearch();
  const selected = selectedSettingsSection(section, role);
  const allowed = settingsSectionsFor(role);
  const [visited, setVisited] = useState<SettingsSection[]>([selected]);
  const [dirty, setDirty] = useState(false);
  const blocker = useBlocker({
    shouldBlockFn: ({ next }) => shouldLeaveSettings(dirty, next.pathname),
    enableBeforeUnload: dirty,
    withResolver: true,
  });
  const choose = (id: SettingsSection) => {
    setVisited((seen) => (seen.includes(id) ? seen : [...seen, id]));
    void navigate({ to: "/settings", search: { section: id } });
  };
  // Sections are mounted on first visit and kept mounted: changing tabs keeps a
  // draft without loading every settings card or making all its requests upfront.
  const mounted = allowed.filter((item) => item.id === selected || visited.includes(item.id));
  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="max-w-6xl">
        <PageHeader
          title={t("settingsIndex.settings")}
          description={t("settingsWorkspace.intro")}
        />
        <div className="mb-5 rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          {tr("settingsIndex.yourCompanySOwnPreferences", {
            link: (
              <Link to="/connect" className="font-medium text-primary underline underline-offset-2">
                {t("settingsIndex.integrations")}
              </Link>
            ),
          })}
        </div>
        <div className="grid items-start gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
          <SettingsNavigation role={role} selected={selected} onSelect={choose} />
          <SettingsDraftProvider onDirtyChange={setDirty}>
            <div className="min-w-0">
              {mounted.map((item) => (
                <section
                  id={`settings-${item.id}`}
                  key={item.id}
                  hidden={selected !== item.id}
                  aria-labelledby={`settings-heading-${item.id}`}
                >
                  <header className="mb-4">
                    <h2 id={`settings-heading-${item.id}`} className="text-xl font-semibold">
                      {t(`settingsWorkspace.${item.id}.label`)}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t(`settingsWorkspace.${item.id}.desc`)}
                    </p>
                  </header>
                  <div className="grid gap-4">
                    {item.id === "profile" && <PersonalProfileCard />}
                    {item.id === "appearance" && <AppearanceCard />}
                    {item.id === "security" && <SecurityCard />}
                    {item.id === "company" && (
                      <>
                        <RegionCard />
                        <CompanyBillingProfileCard />
                      </>
                    )}
                    {item.id === "invoices" && (
                      <>
                        <p className="text-sm text-muted-foreground">
                          {t("settingsWorkspace.invoiceCompanyHint")}{" "}
                          <button
                            type="button"
                            onClick={() => choose("company")}
                            className="font-medium text-primary underline underline-offset-2"
                          >
                            {t("settingsWorkspace.company.label")}
                          </button>
                        </p>
                        <InvoiceBrandingCard showCompanyDetails={false} />
                      </>
                    )}
                    {item.id === "notifications" && (
                      <>
                        <LeadAlertsSettingsCard />
                        <StaffDepartmentRoutingCard />
                      </>
                    )}
                    {item.id === "team" && <TeamCard />}
                    {item.id === "billing" && <BillingCard />}
                    {item.id === "connections" && (
                      <>
                        <ConnectionsSettings />
                        {isAdmin && <EmailMarketingCard />}
                      </>
                    )}
                    {item.id === "privacy" && (
                      <>
                        <DataPrivacyCard />
                        {isAdmin && <AuditLogCard />}
                      </>
                    )}
                  </div>
                </section>
              ))}
            </div>
          </SettingsDraftProvider>
        </div>
      </div>
      <Dialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open && blocker.status === "blocked") blocker.reset();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settingsWorkspace.leaveTitle")}</DialogTitle>
            <DialogDescription>{t("settingsWorkspace.leaveDesc")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => blocker.status === "blocked" && blocker.reset()}
            >
              {t("settingsWorkspace.keepEditing")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => blocker.status === "blocked" && blocker.proceed()}
            >
              {t("settingsWorkspace.leave")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function ConnectionsSettings() {
  const { t } = useI18n();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settingsWorkspace.connections.label")}</CardTitle>
        <CardDescription>{t("settingsWorkspace.connectionHint")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {[
          { to: "/connect" as const, icon: Plug, label: "settingsWorkspace.channels" as const },
          { to: "/chatbot" as const, icon: Bot, label: "settingsWorkspace.assistant" as const },
          {
            to: "/settings/email" as const,
            icon: Mail,
            label: "settingsWorkspace.mailboxes" as const,
          },
        ].map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="flex min-h-12 items-center gap-3 rounded-lg border px-4 py-3 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <item.icon className="size-4 text-primary" />
            {t(item.label)}
            <ChevronRight className="ms-auto size-4 text-muted-foreground rtl:rotate-180" />
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
