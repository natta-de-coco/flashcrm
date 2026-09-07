import { BillingCard } from "@/components/settings/BillingCard";
import { RegionCard } from "@/components/settings/RegionCard";
import { AuditLogCard } from "@/components/settings/AuditLogCard";
import { DataPrivacyCard } from "@/components/settings/DataPrivacyCard";
import { SecurityCard } from "@/components/settings/SecurityCard";
import { TeamCard } from "@/components/settings/TeamCard";
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/hooks/useTenant";
import { Link, createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Flas CRM" },
      {
        name: "description",
        content: "Connect WhatsApp Cloud API, embed the website chat widget and manage your team.",
      },
      { property: "og:title", content: "Settings — Flas CRM" },
      {
        property: "og:description",
        content: "Connect WhatsApp Cloud API, embed the website chat widget and manage your team.",
      },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { isAdmin } = useAuth();
  const { tenant } = useTenant();

  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Your company&apos;s own preferences: region and currency, billing, security, data and
          teammates. Anything that connects Flas to an outside system lives under{" "}
          <Link to="/connect" className="underline underline-offset-2">
            Integrations
          </Link>
          .
        </p>
      </header>

      <div className="grid max-w-3xl gap-4">
        <RegionCard />

        <BillingCard />

        {isAdmin && <AuditLogCard />}

        <SecurityCard />

        <DataPrivacyCard />

        <TeamCard />

      </div>
    </main>
  );
}
