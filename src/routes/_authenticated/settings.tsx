import { BillingCard } from "@/components/settings/BillingCard";
import { RegionCard } from "@/components/settings/RegionCard";
import { AuditLogCard } from "@/components/settings/AuditLogCard";
import { DataPrivacyCard } from "@/components/settings/DataPrivacyCard";
import { SecurityCard } from "@/components/settings/SecurityCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/hooks/useTenant";
import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Copy, Plus, Save, Star, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
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
  const { isAdmin, user } = useAuth();
  const { tenant } = useTenant();
  const qc = useQueryClient();

  // Teammates, scoped to this workspace and to admins.
  //
  // This query used to select every profile and every role with no filter at
  // all, trusting RLS -- and the RLS policy on profiles was USING (true), so
  // the owner opened Settings and saw people from other companies listed under
  // Team. 20260905000000 fixes the policy, but the filter belongs here too:
  // relying on a single layer is how the leak survived in the first place.
  const team = useQuery({
    queryKey: ["team", tenant?.id],
    enabled: isAdmin && Boolean(tenant?.id),
    queryFn: async () => {
      const [profiles, roles] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, email, created_at")
          .eq("tenant_id", tenant!.id),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      if (profiles.error) throw profiles.error;
      if (roles.error) throw roles.error;
      // A user can hold several legacy roles at once -- completeOnboarding
      // grants 'admin' while handle_new_user already granted 'agent' -- so
      // picking the first match showed a super admin as "Agent". Rank instead.
      const RANK = ["super_admin", "admin", "agent"];
      return (profiles.data ?? []).map((p) => {
        const mine = (roles.data ?? [])
          .filter((r) => r.user_id === p.id)
          .map((r) => r.role as string)
          .sort((a, b) => RANK.indexOf(a) - RANK.indexOf(b));
        return { ...p, role: mine[0] ?? "agent" };
      });
    },
  });

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

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Team</CardTitle>
            <CardDescription>
              Teammates sign up at {origin}/auth and are added as agents automatically.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(team.data ?? []).map((member) => (
              <div
                key={member.id}
                className="flex items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {member.full_name || member.email}
                    {member.id === user?.id ? " (you)" : ""}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                </div>
                <Badge variant="secondary" className="capitalize">
                  {member.role}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
