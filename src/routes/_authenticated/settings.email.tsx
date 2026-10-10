import { EmailMarketingCard } from "@/components/settings/EmailMarketingCard";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings/email")({
  head: () => ({
    meta: [
      { title: "Email settings — Flas CRM" },
      {
        name: "description",
        content:
          "Configure how your company sends transactional and marketing email (SMTP / IMAP / DNS).",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: EmailSettingsPage,
});

function EmailSettingsPage() {
  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className="mb-4">
        <Link
          to="/settings"
          className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
        >
          <ArrowLeft className="size-3.5" /> Back to Settings
        </Link>
      </div>

      <header className="mb-6">
        <h1 className="text-2xl font-bold">Workspace Email Configuration</h1>
        <p className="text-sm text-muted-foreground">
          Connect your custom SMTP and IMAP servers for marketing campaigns, automated welcome vouchers, and inbox reply ingestion.
        </p>
      </header>

      <div className="max-w-4xl">
        <EmailMarketingCard />
      </div>
    </main>
  );
}
