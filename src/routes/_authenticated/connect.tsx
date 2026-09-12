import { IntegrationsV2 } from "@/components/integrations-v2/IntegrationsV2";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/connect")({
  head: () => ({
    meta: [
      { title: "Integrations — Flas CRM" },
      {
        name: "description",
        content: "Connect and manage social channels, messaging, analytics, advertising, websites and commerce integrations in Flas CRM.",
      },
      { property: "og:title", content: "Integrations — Flas CRM" },
      {
        property: "og:description",
        content: "Connect your business tools to Flas CRM from one clear integrations center.",
      },
    ],
  }),
  component: IntegrationsV2,
});
