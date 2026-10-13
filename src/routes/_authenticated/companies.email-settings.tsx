import { Button } from "@/components/ui/button";
import { PlatformEmailSettingsCard } from "@/components/companies/PlatformEmailSettingsCard";
import { useAuth } from "@/hooks/useAuth";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Activity, ArrowLeft, Mail } from "lucide-react";

export const Route = createFileRoute("/_authenticated/companies/email-settings")({
  head: () => ({
    meta: [
      { title: "Platform System Email — Flas Manager" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PlatformEmailSettingsPage,
});

export function PlatformEmailSettingsPage() {
  const { isSuperAdmin, loading: authLoading } = useAuth();

  if (!authLoading && !isSuperAdmin) {
    return (
      <main className="grid flex-1 place-items-center p-6">
        <p className="text-sm text-muted-foreground">
          This area is only available to the Flas platform manager.
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-6">
      {/* Top Header & Breadcrumbs */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-1 h-7 gap-1 text-xs">
            <Link to="/companies">
              <ArrowLeft className="size-3.5" /> Companies
            </Link>
          </Button>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold tracking-tight">Platform System Email</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Configure platform SMTP &amp; IMAP credentials for system transactional emails (password
            resets, OTP verification, workspace invites).
          </p>
        </div>

        {/* Quick Manager Navigation */}
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to="/companies/emails">
              <Mail className="size-3.5 mr-1" /> Delivery Log
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/companies/errors">
              <Activity className="size-3.5 mr-1" /> Incidents
            </Link>
          </Button>
        </div>
      </div>

      <PlatformEmailSettingsCard />
    </main>
  );
}
