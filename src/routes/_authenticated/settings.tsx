import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Copy, Save } from "lucide-react";
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
  component: SettingsPage;
});

function SettingsPage() {
  const { isAdmin, user } = useAuth();
  const qc = useQueryClient();
  const [origin, setOrigin] = useState("");
  const [form, setForm] = useState({ business_name: "", display_phone: "", phone_number_id: "" });

  useEffect(() => setOrigin(window.location.origin), []);

  const config = useQuery({
    queryKey: ["wa_config"],
    queryFn: async () => {
      const { data, error } = await supabase.from("wa_config").select("*").maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const team = useQuery({
    queryKey: ["team"],
    queryFn: async () => {
      const [profiles, roles] = await Promise.all([
        supabase.from("profiles").select("id, full_name, email, created_at"),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      if (profiles.error) throw profiles.error;
      if (roles.error) throw roles.error;
      return (profiles.data ?? []).map((p) => ({
        ...p,
        role: roles.data?.find((r) => r.user_id === p.id)?.role ?? "agent",
      }));
    },
  });

  useEffect(() => {
    const c = config.data;
    if (!c) return;
    setForm({
      business_name: c.business_name ?? "",
      display_phone: c.display_phone ?? "",
      phone_number_id: c.phone_number_id ?? "",
    });
  }, [config.data]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("wa_config").update({
        business_name: form.business_name || null,
        display_phone: form.display_phone || null,
        phone_number_id: form.phone_number_id || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("WhatsApp settings saved");
      void qc.invalidateQueries({ queryKey: ["wa_config"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const webhookUrl = `${origin}/api/public/whatsapp/webhook`;
  const embedSnippet = `<script src="${origin}/widget.js" async></script>`;

  function copy(value: string) {
    void navigator.clipboard.writeText(value);
    toast.success("Copied to clipboard");
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Connect WhatsApp, embed the website widget and manage teammates.
        </p>
      </header>

      <div className="grid max-w-3xl gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">WhatsApp Cloud API</CardTitle>
            <CardDescription>
              Add this webhook in Meta → WhatsApp → Configuration, using the verify token stored in
              your backend secrets.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-1.5">
              <Label>Webhook URL</Label>
              <div className="flex gap-2">
                <Input readOnly value={webhookUrl} />
                <Button variant="outline" onClick={() => copy(webhookUrl)}>
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="business_name">Business name</Label>
              <Input
                id="business_name"
                value={form.business_name}
                disabled={!isAdmin}
                onChange={(e) => setForm({ ...form, business_name: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="display_phone">Display phone number</Label>
              <Input
                id="display_phone"
                value={form.display_phone}
                disabled={!isAdmin}
                onChange={(e) => setForm({ ...form, display_phone: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="phone_number_id">Phone number ID</Label>
              <Input
                id="phone_number_id"
                value={form.phone_number_id}
                disabled={!isAdmin}
                onChange={(e) => setForm({ ...form, phone_number_id: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-3">
              <Button onClick={() => save.mutate()} disabled={!isAdmin || save.isPending}>
                <Save className="size-4" /> Save
              </Button>
              {config.data?.webhook_verified ? (
                <Badge className="bg-brand text-brand-foreground">Webhook verified</Badge>
              ) : (
                <Badge variant="secondary">Webhook not verified yet</Badge>
              )}
            </div>
            {!isAdmin && (
              <p className="text-xs text-muted-foreground">
                Only admins can change the WhatsApp connection.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Website chat widget</CardTitle>
            <CardDescription>
              Paste this snippet before the closing &lt;/body&gt; tag of your website. Chats appear
              in your inbox instantly.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            <div className="flex gap-2">
              <Input readOnly value={embedSnippet} />
              <Button variant="outline" onClick={() => copy(embedSnippet)}>
                <Copy className="size-4" />
              </Button>
            </div>
            <a
              href="/widget-demo"
              target="_blank"
              rel="noreferrer"
              className="text-xs font-medium text-brand hover:underline"
            >
              Preview the widget
            </a>
          </CardContent>
        </Card>

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
